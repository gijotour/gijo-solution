// ③ 잔여 — **없앤 화면 탭이 영구 빈 화면이 되지 않는가** (검토 지적 2026-08-01).
//
// 상황: 업데이트 **전에** 「내 업무」 탭을 열어 둔 담당자. 셸은 localStorage의 탭을 그대로
// 복원해 iframe에 물리는데, 그 화면 파일은 이제 없다 → 영구 빈 화면(healFrames는 2회 재시도 후 포기).
// nav.js의 TAB_REDIRECT가 이 경우를 대시보드로 돌려보내야 한다.
//
// ⚠ 이 시험은 **실제로 그 상황을 만들어** 본다 — localStorage에 옛 탭을 심고 셸을 새로 고친다.
//   "코드에 표가 있다"만 보면 표가 안 읽히는 경우를 못 잡는다(오늘 그런 결함을 여러 개 봤다).
const { createRequire } = await import("node:module");
const require_ = createRequire(new URL("../server/package.json", import.meta.url));
const { chromium } = require_("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
const 살아있는 = () => ctx.pages().filter((p) => { try { p.url(); return true; } catch { return false; } });

let 실패 = 0;
const 봄 = (ok, 말, 덧 = "") => { if (!ok) 실패++; console.log((ok ? "  " : "✗ ") + 말 + (덧 ? "\n     " + 덧 : "")); };

let shell = 살아있는().find((p) => { try { return p.url().includes("app.html"); } catch { return false; } });
if (!shell) { console.log("✗ 셸을 못 찾았다 — 로그인부터"); process.exit(1); }

// 지금 탭을 저장해 뒀다가 끝나고 되돌린다 — 검증이 담당자 상태를 망가뜨리면 안 된다.
const 원래 = await shell.evaluate(() => localStorage.getItem("gijo:tabs:v1"));

// 업데이트 전 상태를 재현: 「내 업무」 탭이 열려 있었다.
await shell.evaluate(() => {
  localStorage.setItem("gijo:tabs:v1", JSON.stringify([{ page: "mywork.html", title: "내 업무" }]));
});
await shell.reload({ waitUntil: "domcontentloaded" });
await 잠깐(7000);

shell = 살아있는().find((p) => { try { return p.url().includes("app.html"); } catch { return false; } }) ?? shell;

const 상태 = await shell.evaluate(() => {
  const frames = [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src") || "");
  const tabs = [...document.querySelectorAll(".tab")].map((t) => t.textContent.trim());
  return { frames, tabs, saved: localStorage.getItem("gijo:tabs:v1") };
});
console.log("     복원된 iframe: " + JSON.stringify(상태.frames));
console.log("     탭: " + JSON.stringify(상태.tabs));

봄(!상태.frames.some((s) => s.includes("mywork.html")),
  "없어진 화면을 iframe에 물리지 않는다",
  "물리면 그 탭은 영구 빈 화면이 된다");
봄(상태.frames.some((s) => s.includes("dashboard.html")) || 상태.frames.length === 0,
  "대시보드로 돌려보냈다(또는 탭을 안 만들었다)",
  "돌려보낼 곳이 없으면 담당자는 빈 탭을 붙들고 있게 된다");

// 원상복구
await shell.evaluate((v) => {
  if (v) localStorage.setItem("gijo:tabs:v1", v); else localStorage.removeItem("gijo:tabs:v1");
}, 원래);
await shell.reload({ waitUntil: "domcontentloaded" });
await 잠깐(4000);
console.log("     (탭 상태 원복 완료)");

console.log("\n실패 " + 실패 + "건");
await b.close();
process.exit(실패 ? 1 : 0);
