// 「눌러도 아무 일 없는 자리」 전수 점검 — 실앱에서 버튼을 하나씩 눌러 보고,
// 아무 변화도 안 일어나는 것을 골라낸다.
//
// ⚠ 왜 필요한가. 사흘에 세 번 같은 사고가 났다(전부 조용히 실패):
//   · 2026-07-31 복구 열쇠 재발급 — 없는 함수(gijoDialog)를 불러 TypeError로 죽음
//   · 2026-08-01 팀 사무실 「AI 팀에 맡기기」 — 결재판을 버려 실행이 안 됨
//   · 2026-08-01 자산 목록 「미점검 보기」 — 사라진 요소에 .querySelector로 죽음
//   셋 다 **화면은 멀쩡하고 버튼도 눌리는데 반응만 없었다.** 지금 시험들은
//   "화면이 뜨는가"(스윕)와 "이름이 있는가"(clientglobals)만 본다 — 누르지는 않는다.
//
// 판정: 누른 뒤 ①네트워크 요청 ②DOM 변화 ③새 탭/창 ④콘솔 오류 넷 다 없으면 "무반응".
//   콘솔 오류가 났으면 무반응보다 나쁜 **고장**으로 따로 표시한다.
//
// ⚠ 파괴적인 버튼은 누르지 않는다(삭제·초기화·재발급·해지…). 오늘 규칙: 파괴적 동작은
//   증명하려 들지 말 것. 목록은 아래 위험말에 있고, 건너뛴 것도 보고에 남긴다.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const 위험말 = /삭제|지우|제거|초기화|리셋|재발급|해지|중단|종료|끄기|비활성|취소|되돌리|복원|폐기|내보내|다운로드|백업|재시작|로그아웃|승인|반려|실행|시작|생성|등록|저장|적용|전송|보내기|추가/;
const 건너뛸화면 = new Set(["설정"]); // 계정·열쇠가 있어 자동 클릭 위험

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
if (/login\.html/.test(p.url())) {
  await p.fill("#username", "claude-deploy").catch(() => {});
  await p.fill("#password", process.env.GIJO_ADMIN_PASSWORD).catch(() => {});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(6000);
  const f = await p.$('button:has-text("강제"), button:has-text("계속")');
  if (f) { await f.click(); await p.waitForTimeout(4000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
p.on("dialog", (d) => d.dismiss().catch(() => {})); // 확인창은 **취소**로 닫는다(실행 금지)
console.log("설치본:", p.url().includes("app.asar"));
await p.waitForTimeout(2000);

const 화면들 = await p.evaluate(() =>
  [...document.querySelectorAll("#gijoNav .gn-item")]
    .map((e) => (e.querySelector(".gn-label")?.textContent || "").trim())
    .filter(Boolean));
console.log("메뉴", 화면들.length + "개:", 화면들.join(" · "), "\n");

const 무반응 = [], 고장 = [], 건너뜀 = [];
let 누른수 = 0;

for (const 라벨 of 화면들) {
  if (건너뛸화면.has(라벨)) { 건너뜀.push(라벨 + ": 화면 통째로 제외(계정·열쇠)"); continue; }
  await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
  await p.waitForTimeout(400);
  const 열림 = await p.evaluate((lab) => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item")].find(
      (e) => (e.querySelector(".gn-label")?.textContent || "").trim() === lab);
    if (!it) return false;
    it.querySelector(".gn-label").click();
    return true;
  }, 라벨);
  if (!열림) { 건너뜀.push(라벨 + ": 메뉴를 못 찾음"); continue; }
  await p.waitForTimeout(6500);

  // 이 화면의 누를 만한 것 목록을 먼저 뽑는다(누르면 DOM이 바뀌므로 매번 다시 찾는다).
  //
  // ⚠ **글자가 같은 것은 하나만 누른다.** 온톨로지 화면에서 누를 수 있는 것이 6,566개였다 —
  //   관계 칩이 전부 잡혀 한 화면에 2시간 반이 걸렸다(첫 판에 실제로 여기서 멈췄다).
  //   같은 글자의 줄 1,000개를 누르는 건 같은 코드를 1,000번 확인하는 것이라 얻는 게 없다.
  //   화면당 상한도 둔다 — 전수의 목적은 "무반응인 **종류**"를 찾는 것이다.
  const 화면당상한 = 45;
  const 후보 = await p.evaluate((상한) => {
    const f = document.querySelector("#screens iframe.on");
    const d = f && f.contentDocument;
    if (!d) return [];
    const els = [...d.querySelectorAll('button, [role="button"], .row-actions, .tb-mi, .chip, .g-go, [data-action]')];
    const 본것 = new Set();
    const out = [];
    els.forEach((e, i) => {
      if (!(e.offsetParent || e.getClientRects().length)) return;
      const 글 = (e.textContent || "").trim().slice(0, 30);
      if (!글 || 본것.has(글)) return;
      본것.add(글);
      out.push({ i, 글 });
    });
    return { 목록: out.slice(0, 상한), 전체: els.length, 서로다른글: out.length };
  }, 화면당상한);
  const 목록 = 후보.목록 || [];
  if (!목록.length) { 건너뜀.push(라벨 + ": 누를 것이 없음(표·카드만)"); continue; }
  if (후보.서로다른글 > 화면당상한) {
    건너뜀.push(라벨 + ": 서로 다른 글 " + 후보.서로다른글 + "종 중 앞 " + 화면당상한 + "종만 (전체 요소 " + 후보.전체 + "개)");
  }

  for (const c of 목록) {
    if (위험말.test(c.글)) { 건너뜀.push(`${라벨} / ${c.글}: 위험말`); continue; }
    const 요청 = [];
    const 오류 = [];
    const onReq = (r) => { if (/\/api\//.test(r.url())) 요청.push(r.url().replace(/^https?:\/\/[^/]+/, "")); };
    const onErr = (e) => 오류.push(String(e).slice(0, 120));
    const onCon = (m) => { if (m.type() === "error") 오류.push(m.text().slice(0, 120)); };
    p.on("request", onReq); p.on("pageerror", onErr); p.on("console", onCon);
    const 탭전 = ctx.pages().length;

    const r = await p.evaluate(({ i, 글 }) => {
      const f = document.querySelector("#screens iframe.on");
      const d = f && f.contentDocument;
      if (!d) return { 못봄: true };
      const els = [...d.querySelectorAll('button, [role="button"], .row-actions, .tb-mi, .chip, .g-go, [data-action]')]
        .filter((e) => (e.offsetParent || e.getClientRects().length) && (e.textContent || "").trim());
      // 인덱스가 아니라 **글자로** 찾는다 — 앞선 클릭으로 목록이 바뀌면 인덱스는 엉뚱한 것을 가리킨다.
      const el = els.find((e) => (e.textContent || "").trim().slice(0, 30) === 글) || els[i];
      if (!el) return { 사라짐: true };
      const 전 = d.body.innerHTML.length;
      el.click();
      return { 전, 글: (el.textContent || "").trim().slice(0, 30) };
    }, { i: c.i, 글: c.글 });

    if (r.못봄 || r.사라짐) { p.off("request", onReq); p.off("pageerror", onErr); p.off("console", onCon); continue; }
    await p.waitForTimeout(1400);
    const 후 = await p.evaluate(() => {
      const f = document.querySelector("#screens iframe.on");
      const d = f && f.contentDocument;
      return d ? d.body.innerHTML.length : -1;
    });
    const 탭후 = ctx.pages().length;
    p.off("request", onReq); p.off("pageerror", onErr); p.off("console", onCon);
    누른수++;

    const 변화 = 요청.length > 0 || 후 !== r.전 || 탭후 !== 탭전;
    if (오류.length) 고장.push(`${라벨} / ${r.글} — ${오류[0]}`);
    else if (!변화) 무반응.push(`${라벨} / ${r.글}`);
  }
}

const 보고 = [
  `# 눌러도 아무 일 없는 자리 — 전수 점검`,
  ``,
  `누른 것 **${누른수}개** · 화면 ${화면들.length}개`,
  ``,
  `## 고장 (콘솔 오류가 남 — 무반응보다 나쁘다) ${고장.length}건`,
  ...(고장.length ? 고장.map((x) => "- " + x) : ["- 없음"]),
  ``,
  `## 무반응 (요청·화면변화·창 셋 다 없음) ${무반응.length}건`,
  ...(무반응.length ? 무반응.map((x) => "- " + x) : ["- 없음"]),
  ``,
  `> 무반응이 전부 결함은 아니다 — 이미 그 상태인 필터를 다시 누르거나, 접힘 토글이 원래 자리로`,
  `> 돌아온 경우가 섞인다. **사람이 하나씩 읽고 판단할 목록**이지 자동 판정이 아니다.`,
  ``,
  `## 안 누른 것 ${건너뜀.length}건`,
  ...건너뜀.map((x) => "- " + x),
].join("\n");

fs.mkdirSync(new URL("../.tmp-reports/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../.tmp-reports/click-census.md", import.meta.url), 보고, "utf8");
console.log(보고);
await b.close();
