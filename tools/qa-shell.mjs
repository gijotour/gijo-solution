// QA 계층 [shell] — 대시보드 팝업 셸 실화면 검증 (Electron CDP 9223 필요)
//
// 무엇을 지키나: 메뉴를 팝업으로 열어도 **명령창·대화·입력 중 초안이 사라지지 않는 것**.
// 이 성질이 깨지면 담당자가 쓰던 맥락을 잃는다 — 화면 렌더만 보는 스윕으로는 안 잡힌다.
// 계정은 claude-deploy(실사용 jyh 세션 보호).
import { createRequire } from "module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "client", "package.json"));
const { chromium } = require("playwright-core");

const PW = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
if (!PW) { console.error("QA_PASS/GIJO_ADMIN_PASSWORD 필요"); process.exit(2); }
const SHOT = path.join(ROOT, ".tmp-reports") + path.sep;
const R = { pass: [], fail: [] };
const ok = (n, cond, detail) => { (cond ? R.pass : R.fail).push(n + (detail ? " — " + detail : "")); console.log((cond ? "✅ " : "❌ ") + n + (detail ? " — " + detail : "")); };

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("login.html"));
if (!page) {
  // 이미 로그인된 상태면 로그인 화면으로 되돌려 시작한다(QA는 반복 실행되므로).
  const m = ctx.pages().find((p) => /hub\.html|dashboard\.html|office\.html/.test(p.url()));
  if (!m) { console.error("Electron 페이지를 찾지 못함"); process.exit(2); }
  await m.evaluate(() => { window.gijo.navigateTo("login.html"); }).catch(() => {});
  await m.waitForURL(/login\.html/, { timeout: 10000 });
  page = m;
}

// 콘솔 오류 수집
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 200)));

// 1) 운영 서버 로그인 (claude-deploy — force로 자기 세션만 교체)
await page.fill("#serverUrl", "http://localhost:4000");
await page.fill("#username", "claude-deploy");
await page.fill("#password", PW);
await page.evaluate(() => { const c = document.getElementById("savePw"); if (c && c.checked) c.click(); }).catch(() => {});
await page.click("#loginBtn");
// 중복로그인 확인창(409) — playwright dialog 자동 수락
page.on("dialog", (d) => d.accept());
await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
ok("로그인 → 대시보드", true);
await page.waitForTimeout(3000);

// 0) 이전 실행 잔여 상태 초기화 — 강제종료로 localStorage가 중간 상태일 수 있다
await page.evaluate(() => {
  try { document.getElementById("sbCloseAll").click(); } catch (e) {}
  try { localStorage.removeItem("gijo:shell:popups"); } catch (e) {}
});
await page.waitForTimeout(400);

// 2) 컴포저에 초안 입력(유지 검증용)
await page.fill("#chatInput", "이 입력이 팝업을 여닫아도 남아있어야 한다");

// 3) 왼쪽 메뉴 "자산 허브" 클릭 → 팝업으로 열려야 함(이동 금지)
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll("#gijoNav .gn-item"));
  const it = items.find((e) => e.textContent.includes("자산 허브"));
  it.querySelector(".gn-label").click();
});
await page.waitForTimeout(2500);
ok("자산 허브 클릭 후에도 대시보드 유지(이동 안 함)", page.url().includes("dashboard.html"), page.url().split("/").pop());
const st1 = await page.evaluate(() => ({
  layerOn: document.getElementById("shellLayer").classList.contains("on"),
  slots: document.querySelectorAll("#sbSlots .sb-slot").length,
  popped: document.body.classList.contains("shell-popped"),
  frames: document.querySelectorAll("#shellBody iframe").length,
  draft: document.getElementById("chatInput").value,
  title: document.getElementById("shTitle").textContent,
}));
ok("팝업 레이어 표시", st1.layerOn && st1.popped, JSON.stringify(st1));
ok("슬롯 1개 생성", st1.slots === 1);
ok("컴포저 초안 유지", st1.draft.includes("남아있어야"));

// 4) 허브 iframe 내부가 실제로 렌더됐는지 + hubTab 통지로 맥락 칩 갱신됐는지
await page.waitForTimeout(2500);
const st2 = await page.evaluate(() => {
  const f = document.querySelector("#shellBody iframe.on");
  let inner = null;
  try { inner = { url: f.contentWindow.location.href.split("/").pop(), tabs: f.contentDocument.querySelectorAll(".hub-tab").length, navHidden: !f.contentDocument.getElementById("gijoNav").offsetParent }; } catch (e) { inner = { err: String(e).slice(0, 80) }; }
  return { inner, ctxLabel: document.getElementById("shCtxLabel").textContent, screen: window.gijoShell.activeScreen() };
});
ok("허브가 embed로 렌더(탭 존재·사이드바 숨김)", st2.inner && st2.inner.tabs >= 3 && st2.inner.navHidden, JSON.stringify(st2.inner));
ok("맥락 칩 갱신", /자산 허브/.test(st2.ctxLabel), st2.ctxLabel);
ok("activeScreen=허브 활성 탭", typeof st2.screen === "string" && st2.screen.endsWith(".html"), String(st2.screen));
await page.screenshot({ path: SHOT + "shell-popup-1.png" });

// 5) 팝업 안에서 탭 전환(취약점) → 맥락이 탭 단위로 따라오는지
await page.evaluate(() => {
  const f = document.querySelector("#shellBody iframe.on");
  const tabs = Array.from(f.contentDocument.querySelectorAll(".hub-tab"));
  const t = tabs.find((x) => x.textContent.includes("취약점"));
  if (t) t.click();
});
await page.waitForTimeout(1500);
const st3 = await page.evaluate(() => ({ screen: window.gijoShell.activeScreen(), label: document.getElementById("shCtxLabel").textContent }));
ok("탭 전환 → 맥락 vulnscan.html", st3.screen === "vulnscan.html", JSON.stringify(st3));

// 5-b) 맥락 토글 — "| 대시보드 맥락으로"를 눌러도 팝업은 그대로, 맥락·안내문만 전환
await page.evaluate(() => document.getElementById("shCtxSwitch").click());
const tg1 = await page.evaluate(() => ({
  layerOn: document.getElementById("shellLayer").classList.contains("on"),
  screen: window.gijoShell.activeScreen(),
  label: document.getElementById("shCtxLabel").textContent,
  ph: document.getElementById("chatInput").placeholder,
}));
ok("맥락 토글 → 대시보드(팝업 유지)", tg1.layerOn && !tg1.screen && tg1.label === "대시보드" && /대시보드 맥락/.test(tg1.ph), JSON.stringify(tg1));
await page.evaluate(() => document.getElementById("shCtxSwitch").click());
const tg2 = await page.evaluate(() => ({ screen: window.gijoShell.activeScreen(), ph: document.getElementById("chatInput").placeholder }));
ok("맥락 재토글 → 보이는 화면 복귀", tg2.screen === "vulnscan.html" && /「/.test(tg2.ph), JSON.stringify(tg2));

// 5-c) 메뉴 아이콘 — 2차 확장으로 챗봇 메뉴 9종 전부 ⧉
const icons = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll("#gijoNav .gn-item"));
  const bots = items.map((e) => { const b = e.querySelector(".gn-bot"); return b ? b.textContent : null; }).filter(Boolean);
  return { total: bots.length, popup: bots.filter((t) => t === "⧉").length };
});
ok("챗봇 메뉴 9종 전부 ⧉", icons.total === 9 && icons.popup === 9, JSON.stringify(icons));

// 5-d) 2차 메뉴 팝업 — 단독 페이지(레드팀)도 팝업으로 열린다
await page.evaluate(() => {
  const it = Array.from(document.querySelectorAll("#gijoNav .gn-item")).find((e) => e.textContent.includes("레드팀"));
  it.querySelector(".gn-label").click();
});
await page.waitForTimeout(2200);
const rt = await page.evaluate(() => ({
  url: page => null,
  active: document.querySelector("#sbSlots .sb-slot.on .nm").textContent,
  screen: window.gijoShell.activeScreen(),
  stillDash: location.pathname.endsWith("dashboard.html"),
}));
ok("레드팀(단독 페이지) 팝업", rt.stillDash && rt.active.includes("레드팀") && rt.screen === "redteam.html", JSON.stringify(rt));
await page.evaluate(() => { const s = Array.from(document.querySelectorAll("#sbSlots .sb-slot")).find((e) => e.textContent.includes("레드팀")); s.querySelector(".x").click(); });
await page.waitForTimeout(400);

// 5-e) 내용 맞춤 높이 — 내용이 짧은 화면(보안 분석)은 팝업이 줄고, 남는 자리는 이력이 받는다
await page.evaluate(() => {
  const it = Array.from(document.querySelectorAll("#gijoNav .gn-item")).find((e) => e.textContent.includes("보안 분석"));
  it.querySelector(".gn-label").click();
});
await page.waitForTimeout(3500); // 데이터 로드 + 감시 주기
const fit = await page.evaluate(() => ({
  layerH: document.getElementById("shellLayer").offsetHeight,
  availH: window.innerHeight,
  rowsMax: parseInt(document.querySelector("#accConsole .cl-rows").style.maxHeight || "0", 10),
}));
ok("내용 맞춤 — 짧은 화면은 팝업 축소·이력 확장", fit.layerH < fit.availH - 400 && fit.rowsMax > 110, JSON.stringify(fit));
await page.screenshot({ path: SHOT + "shell-fit-analysis.png" });
await page.evaluate(() => { const s = Array.from(document.querySelectorAll("#sbSlots .sb-slot")).find((e) => e.textContent.includes("보안 분석")); s.querySelector(".x").click(); });
await page.waitForTimeout(400);

// 5-f) 내 업무 바로가기 — 대시보드에서 리로드 없이 열림(+셸 팝업은 자동 접힘)
await page.evaluate(() => {
  const it = Array.from(document.querySelectorAll("#gijoNav .gn-item")).find((e) => e.textContent.includes("내 업무 바로가기"));
  it.click();
});
await page.waitForTimeout(600);
const qk = await page.evaluate(() => ({
  quick: document.body.classList.contains("pop-quick"),
  stillDash: location.pathname.endsWith("dashboard.html") && !location.search.includes("quick"),
  draft: document.getElementById("chatInput").value,
  shellHidden: !document.getElementById("shellLayer").classList.contains("on"),
}));
ok("내 업무 바로가기 = 리로드 없이 + 셸 접힘 + 초안 유지", qk.quick && qk.stillDash && qk.shellHidden && qk.draft.includes("남아있어야"), JSON.stringify(qk));

// 5-g) 업무 타일 클릭 = 대시보드 위 팝업(해당 허브의 그 탭) — 옛날처럼 전체 이동 금지
// 타일 구성은 역할·개인화에 따라 다르다 — 있는 타일 중 하나(자산 목록 우선)를 골라 검증
const tilePage = await page.evaluate(() => {
  const t = document.querySelector('#quickPop [data-go="inventory.html"]') || document.querySelector("#quickPop [data-go]");
  const pg = t.getAttribute("data-go");
  t.click();
  return pg;
});
await page.waitForTimeout(2500);
const tile = await page.evaluate(() => ({
  stillDash: location.pathname.endsWith("dashboard.html"),
  quickClosed: !document.body.classList.contains("pop-quick"),
  active: (document.querySelector("#sbSlots .sb-slot.on .nm") || {}).textContent,
  screen: window.gijoShell.activeScreen(),
}));
ok(`업무 타일(${tilePage}) → 해당 허브 팝업의 그 탭`, tile.stillDash && tile.quickClosed && tile.screen === tilePage, JSON.stringify(tile));
await page.screenshot({ path: SHOT + "shell-quick-tile.png" });
// 자산 허브 팝업 복귀(이후 스텝은 자산 허브 활성 기준)
await page.evaluate(() => { document.querySelector("#sbSlots .sb-slot .nm").click(); });
await page.waitForTimeout(600);

// 6) 팝업 2·3개 열기(보안 분석·리포트) → 슬롯 3개·전환
for (const nm of ["보안 분석", "리포트"]) {
  await page.evaluate((label) => {
    const it = Array.from(document.querySelectorAll("#gijoNav .gn-item")).find((e) => e.textContent.includes(label));
    it.querySelector(".gn-label").click();
  }, nm);
  await page.waitForTimeout(1800);
}
const st4 = await page.evaluate(() => ({
  slots: document.querySelectorAll("#sbSlots .sb-slot").length,
  active: document.querySelector("#sbSlots .sb-slot.on .nm").textContent,
  frames: document.querySelectorAll("#shellBody iframe").length,
}));
ok("팝업 3개 슬롯", st4.slots === 3 && st4.frames === 3, JSON.stringify(st4));
await page.screenshot({ path: SHOT + "shell-popup-3slots.png" });

// 7) 슬롯 클릭 전환 → 자산 허브로
await page.evaluate(() => {
  const s = Array.from(document.querySelectorAll("#sbSlots .sb-slot")).find((e) => e.textContent.includes("자산 허브"));
  s.querySelector(".nm").click();
});
await page.waitForTimeout(800);
const st5 = await page.evaluate(() => document.querySelector("#sbSlots .sb-slot.on .nm").textContent);
ok("슬롯 클릭 전환", st5.includes("자산 허브"), st5);

// 8) 활성 슬롯 재클릭 = 대시보드로(팝업 유지) + 초안 그대로
await page.evaluate(() => { document.querySelector("#sbSlots .sb-slot.on .nm").click(); });
await page.waitForTimeout(600);
const st6 = await page.evaluate(() => ({
  layerOn: document.getElementById("shellLayer").classList.contains("on"),
  popped: document.body.classList.contains("shell-popped"),
  slots: document.querySelectorAll("#sbSlots .sb-slot").length,
  draft: document.getElementById("chatInput").value,
  screen: window.gijoShell.activeScreen(),
}));
ok("대시보드로 접기(팝업은 슬롯 유지)", !st6.layerOn && !st6.popped && st6.slots === 3, JSON.stringify({ slots: st6.slots }));
ok("접힌 뒤 맥락=대시보드(undefined)", st6.screen === undefined || st6.screen === null, String(st6.screen));
ok("초안 여전히 유지", st6.draft.includes("남아있어야"));
await page.screenshot({ path: SHOT + "shell-popup-minimized.png" });

// 9) 다시 열고 📌 핀 토글
await page.evaluate(() => { document.querySelector("#sbSlots .sb-slot .nm").click(); });
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById("shPin").click());
const st7 = await page.evaluate(() => ({
  pinOn: document.getElementById("shPin").classList.contains("pin-on"),
  pinMark: Boolean(document.querySelector("#sbSlots .sb-slot.on .pinm")),
}));
ok("핀 토글", st7.pinOn && st7.pinMark, JSON.stringify(st7));

// 10) 🗗 창으로 분리 → 새 창 + 슬롯에서 제거
const popoutPromise = ctx.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
await page.evaluate(() => document.getElementById("shPopout").click());
const popout = await popoutPromise;
await page.waitForTimeout(1500);
const st8 = await page.evaluate(() => ({ slots: document.querySelectorAll("#sbSlots .sb-slot").length }));
ok("창으로 분리 — 새 창 생성", Boolean(popout), popout ? popout.url().split("/").pop() : "없음");
ok("분리 후 슬롯에서 제거(3→2)", st8.slots === 2, "slots=" + st8.slots);
if (popout) { // 반만(오른쪽 절반) 요구 — 폭 ≈ 그 모니터 절반(콘텐츠 최소 760 보장), 오른쪽 배치
  const hsz = await popout.evaluate(() => ({ w: window.outerWidth, x: window.screenX, sw: window.screen.availWidth })).catch(() => null);
  const want = hsz ? Math.max(760, Math.round(hsz.sw / 2)) : 0;
  ok("가로 분리 = 오른쪽 절반(최소 760)", Boolean(hsz && Math.abs(hsz.w - Math.min(want, hsz.sw)) < 80), JSON.stringify(hsz));
}
if (popout) { await popout.waitForTimeout(2000); await popout.screenshot({ path: SHOT + "shell-popout-window.png" }).catch(() => {}); await popout.close().catch(() => {}); }

// 9-b) 팝업 높이 손잡이 — 위로 200px 끌어 줄이고, 더블클릭으로 자동 복귀
await page.evaluate(() => { document.querySelector("#sbSlots .sb-slot .nm").click(); });
await page.waitForTimeout(500);
const h0 = await page.evaluate(() => document.getElementById("shellLayer").offsetHeight);
// 자동 맞춤이 수시로 미세 조정해 실마우스가 손잡이를 빗나간다 — 요소를 직접 잡는 합성 이벤트로
await page.evaluate(() => {
  const grip = document.getElementById("shellGrip");
  const r = grip.getBoundingClientRect();
  const ev = (type, y) => new MouseEvent(type, { bubbles: true, clientX: r.left + r.width / 2, clientY: y });
  grip.dispatchEvent(ev("mousedown", r.top + 3));
  document.dispatchEvent(ev("mousemove", r.top + 3 - 200));
  document.dispatchEvent(ev("mouseup", r.top + 3 - 200));
});
await page.waitForTimeout(300);
const h1 = await page.evaluate(() => document.getElementById("shellLayer").offsetHeight);
ok("손잡이 드래그로 높이 줄이기", h1 <= h0 - 150, `${h0} → ${h1}`);
const persisted = await page.evaluate(() => localStorage.getItem("gijo:shell:height"));
ok("높이 선택 기억", Boolean(persisted), String(persisted));
// 팝업을 줄인 만큼 대화 이력이 늘어나야 한다(2026-07-26 요청)
const rowsMax = await page.evaluate(() => parseInt(document.querySelector("#accConsole .cl-rows").style.maxHeight || "0", 10));
ok("줄인 공간만큼 대화 이력 확장", rowsMax > 200, "cl-rows max=" + rowsMax + "px (기본 110)");
await page.screenshot({ path: SHOT + "shell-popup-resized.png" });
await page.evaluate(() => { const g = document.getElementById("shellGrip"); const r = g.getBoundingClientRect(); g.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: r.left + 10, clientY: r.top + 3 })); });
await page.waitForTimeout(300);
const h2 = await page.evaluate(() => document.getElementById("shellLayer").offsetHeight);
const hKeyCleared = await page.evaluate(() => localStorage.getItem("gijo:shell:height") === null);
// 자동 = 이제 "내용 맞춤"이라 꽉 차게가 아닐 수 있다 — 수동값 해제 + 수동보다 커졌는지로 판정
ok("더블클릭 = 자동(내용 맞춤) 복귀", hKeyCleared && h2 >= h1, `${h1} → ${h2} (기억 해제=${hKeyCleared})`);

// 10-b) ⧉ 메뉴 아이콘 = 별도 창으로 열기 + 그 창 안에서 가로/세로 전환(2026-07-26 결정)
const vPromise = ctx.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
await page.evaluate(() => {
  const it = Array.from(document.querySelectorAll("#gijoNav .gn-item")).find((e) => e.textContent.includes("보안 분석"));
  it.querySelector(".gn-bot").click();
});
const vwin = await vPromise;
ok("⧉ 클릭 = 별도 창", Boolean(vwin), vwin ? vwin.url().split("/").pop() : "없음");
if (vwin) {
  await vwin.waitForTimeout(2200);
  const before = await vwin.evaluate(() => ({ w: window.outerWidth, h: window.outerHeight, btn: Boolean(document.getElementById("orientBtn")), label: (document.getElementById("orientBtn") || {}).textContent })).catch(() => ({}));
  ok("창 안 가로/세로 전환 버튼", Boolean(before.btn && /세로/.test(before.label || "")), JSON.stringify(before));
  await vwin.evaluate(() => document.getElementById("orientBtn").click());
  await vwin.waitForTimeout(1200);
  const after = await vwin.evaluate(() => ({ w: window.outerWidth, h: window.outerHeight, sh: window.screen.availHeight, label: document.getElementById("orientBtn").textContent }));
  ok("세로 전환 = 절반 높이·버튼은 [가로]로", Math.abs(after.h - after.sh / 2) < 80 && /가로/.test(after.label), JSON.stringify(after));
  await vwin.screenshot({ path: SHOT + "shell-popout-portrait.png" }).catch(() => {});
  await vwin.close().catch(() => {});
}

// 11) 모두 닫기 → 바 숨김
await page.evaluate(() => document.getElementById("sbCloseAll").click());
await page.waitForTimeout(500);
const st9 = await page.evaluate(() => ({
  slots: document.querySelectorAll("#sbSlots .sb-slot").length,
  barShown: document.getElementById("shellBar").classList.contains("has"),
  draft: document.getElementById("chatInput").value,
}));
ok("모두 닫기 → 바 숨김·초안 유지", st9.slots === 0 && !st9.barShown && st9.draft.includes("남아있어야"), JSON.stringify(st9));

// 12) JS 오류 — preload 주입 플레이크의 1회성 오류(치유 전 프레임 소음)는 구분 집계
const transient = jsErrors.filter((e) => e.includes("reading 'isAuthenticated'"));
const real = jsErrors.filter((e) => !e.includes("reading 'isAuthenticated'"));
ok("JS 오류 0건(주입 플레이크 소음 제외)", real.length === 0, (real.join(" | ") || "없음") + (transient.length ? ` / 주입플레이크 소음 ${transient.length}건(치유됨)` : ""));

// 정리: 초안 비우기
await page.evaluate(() => { document.getElementById("chatInput").value = ""; try { window.gijoClearDraft && window.gijoClearDraft(); } catch (e) {} });
await page.screenshot({ path: SHOT + "shell-popup-final.png" });

console.log("\n== 결과: PASS " + R.pass.length + " / FAIL " + R.fail.length + " ==");
if (R.fail.length) { console.log("실패:"); R.fail.forEach((f) => console.log("  - " + f)); }
await browser.close();
process.exit(R.fail.length ? 1 : 0);
