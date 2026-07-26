// 401 경합 대조 검증 — 실제 Electron 앱(CDP 9223) 두 창에서 세션 갱신 경합을 결정적으로 유발한다.
//
// 배경(2026-07-26 검증 완료): 서버 refresh token은 회전형(한 번 쓰면 폐기)이라, 여러 창이 낡은
// 사본으로 동시에 갱신하면 한쪽만 성공한다. 4e15c3d 수정 전에는 진 쪽이 공용 로그인 상태를
// 지워 멀쩡한 세션이 통째로 끊겼다("업로드는 되는데 리포트 저장 실패 401" 사고).
//
// 지난 실패(2026-07-25)의 교훈: 페이지가 초기 fetch 콜백에서 "나중에" 등록하는 인터벌이 있어
// 한 번의 타이머 청소로는 부족하다 — 배경 폴링이 만료 직후 먼저 갱신해 경합을 선점한다.
// 그래서 만료 대기 중에도 2초마다 두 창의 타이머를 전멸시킨 뒤, 만료 후 동시에 인증 호출을 쏜다.
//
// 절차: ① auth-test-server.mjs 기동(매 실행 재시작) ② 개발 앱을 CDP 9223으로 기동
//       ③ node tools/auth-race-check/race-cdp.mjs <라벨>
// 판정: 경합 후 두 창 모두 재호출(me) 성공+인증 유지면 SURVIVE, 한쪽이라도 죽으면 DEAD.
// A/B 대조로 옛 코드를 검증할 땐 파일 전체 교체 금지(이후 추가된 API로 빌드가 깨짐) —
// 해당 커밋의 diff 헝크만 외과적으로 되돌리고, 끝나면 git restore로 원복할 것.
import { createRequire } from "module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const TTL_WAIT_MS = 19_000; // 토큰 만료 15s + 여유
const label = process.argv[2] || "run";

function log(...a) { console.log(`[${label}]`, ...a); }

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = browser.contexts()[0];

// 1) 로그인 페이지 찾기 — 다른 화면에 있으면 로그인으로 되돌린다(운영 서버 세션은 건드리지 않음)
let pageD = null;
for (const p of ctx.pages()) {
  const u = p.url();
  if (u.includes("login.html")) { pageD = p; break; }
}
if (!pageD) {
  const main = ctx.pages().find((p) => /hub\.html|dashboard\.html/.test(p.url()));
  if (!main) throw new Error("메인 창을 못 찾음: " + ctx.pages().map((p) => p.url()).join(", "));
  log("로그인 화면 아님(" + main.url().split("/").pop() + ") → login.html로 이동");
  await main.evaluate(() => { window.gijo.navigateTo("login.html"); }).catch(() => {}); // 네비게이션으로 컨텍스트가 죽는 건 정상
  await main.waitForURL(/login\.html/, { timeout: 10_000 });
  pageD = main;
}

// 2) 시험 서버로 로그인 (jyh/changeme — :memory: 개발 기본 계정)
await pageD.fill("#serverUrl", "http://127.0.0.1:4100");
await pageD.fill("#username", "jyh");
await pageD.fill("#password", "changeme");
// 비밀번호 저장 체크 해제(이 PC 자격증명 보관 안 건드림)
await pageD.evaluate(() => { const c = document.getElementById("savePw"); if (c && c.checked) c.click(); }).catch(() => {});
await pageD.click("#loginBtn");
await pageD.waitForURL(/dashboard\.html/, { timeout: 15_000 });
log("로그인 완료 → dashboard");
await pageD.waitForTimeout(2500); // 초기 API 버스트가 지나가게

// 3) 사무실 창 열기 (두 번째 컨텍스트 = 두 번째 토큰 사본)
const officePromise = ctx.waitForEvent("page", { timeout: 15_000 });
await pageD.evaluate(() => window.gijo.openTeamOffice());
const pageO = await officePromise;
await pageO.waitForLoadState("domcontentloaded");
log("사무실 창 열림:", pageO.url().split("/").pop());
await pageO.waitForTimeout(2500);

// 4) 두 창의 타이머 전멸 — 배경 폴링이 경합을 선점하지 못하게
const killTimers = () => {
  const top = setInterval(() => {}, 1e9);
  for (let i = 1; i <= top + 10; i++) { try { clearInterval(i); } catch {} try { clearTimeout(i); } catch {} }
  return top;
};
const kd = await pageD.evaluate(killTimers);
const ko = await pageO.evaluate(killTimers);
log(`타이머 정리 dashboard=${kd}개 office=${ko}개`);

// 5) 만료 대기 — 대기 중에도 2초마다 타이머를 재청소한다(늦게 등록되는 인터벌 대비)
log(`토큰 만료 대기 ${TTL_WAIT_MS / 1000}s (2초마다 타이머 재청소)...`);
const waitStart = Date.now();
while (Date.now() - waitStart < TTL_WAIT_MS) {
  await new Promise((r) => setTimeout(r, 2000));
  await Promise.all([pageD.evaluate(killTimers), pageO.evaluate(killTimers)]).catch(() => {});
}

// 6) 동시 트리거 — 두 창에서 같은 순간 인증 호출 → 둘 다 401 → 둘 다 낡은 사본으로 갱신 경합
const probe = async () => {
  try {
    const me = await window.gijo.me();
    return { ok: true, who: me && (me.username || me.id) };
  } catch (e) {
    return { ok: false, err: String(e && e.message || e).slice(0, 140) };
  }
};
log("동시 트리거 발사");
const [t1, t2] = await Promise.all([pageD.evaluate(probe), pageO.evaluate(probe)]);
log("트리거 결과 dashboard:", JSON.stringify(t1));
log("트리거 결과 office   :", JSON.stringify(t2));

// 7) 정착 후 재검침 — 진짜 판정은 여기: 경합이 끝난 뒤에도 두 창이 살아 있는가
await new Promise((r) => setTimeout(r, 2000));
const [p1, p2] = await Promise.all([pageD.evaluate(probe), pageO.evaluate(probe)]);
const [a1, a2] = await Promise.all([
  pageD.evaluate(() => window.gijo.isAuthenticated()),
  pageO.evaluate(() => window.gijo.isAuthenticated()),
]);
log("재검침 dashboard:", JSON.stringify(p1), "auth=" + a1);
log("재검침 office   :", JSON.stringify(p2), "auth=" + a2);

const survive = p1.ok && p2.ok && a1 && a2;
log("판정:", survive ? "SURVIVE (세션 유지)" : "DEAD (세션 사망)");
console.log(JSON.stringify({ label, survive, trigger: { d: t1, o: t2 }, probe: { d: p1, o: p2 }, auth: { d: a1, o: a2 } }));
await browser.close();
process.exit(0);
