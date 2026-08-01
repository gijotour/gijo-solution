// ① 실앱 검증 2 — 메뉴를 없앤 뒤 **대화창이 그 일을 받는가**.
//
// 보는 것 세 가지:
//   1. 기한초과 배지가 대시보드에 실제로 숫자를 띄우는가(옮겨만 놓고 안 채우면 묻힌다)
//   2. 「적어 넣기」가 명령창에 문장을 얹는가(prefill — 오늘 새로 만든 함수)
//   3. 대화창에서 "오늘 할 일"이 실제로 답하는가
//
// ⚠ 하네스 함정: 대시보드는 hub iframe 안에 있고, 스테일 프레임이 함께 남는다.
//   **보이는 프레임**을 골라야 한다(요소가 있어도 안 그려진 프레임일 수 있다).
const { createRequire } = await import("node:module");
const require_ = createRequire(new URL("../server/package.json", import.meta.url));
const { chromium } = require_("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
const 살아있는 = () => ctx.pages().filter((p) => { try { p.url(); return true; } catch { return false; } });

async function 프레임찾기(sel, 초 = 20) {
  for (let i = 0; i < 초 * 2; i++) {
    for (const p of 살아있는()) {
      for (const f of p.frames()) {
        try { if (await f.$(sel)) return f; } catch { /* 떨어진 프레임 */ }
      }
    }
    await 잠깐(500);
  }
  return null;
}

let 실패 = 0;
const 봄 = (ok, 말) => { if (!ok) 실패++; console.log((ok ? "  " : "✗ ") + 말); };

// ── 1. 기한초과 배지 ──────────────────────────────────────────────────
const nav = await 프레임찾기("#gijoNav .gn-workbadge");
if (!nav) { console.log("✗ 배지 요소를 못 찾았다"); 실패++; }
else {
  let 배지 = null;
  for (let i = 0; i < 24; i++) { // 갱신은 주기적이라 기다린다
    배지 = await nav.$$eval(".gn-workbadge", (els) => els.map((e) => ({
      글: (e.textContent || "").trim(), 보임: getComputedStyle(e).display !== "none",
      붙은곳: (e.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20),
    })));
    if (배지.some((x) => x.글)) break;
    await 잠깐(2500);
  }
  console.log("배지 상태:", JSON.stringify(배지));
  봄(배지.some((x) => x.붙은곳.includes("대시보드")), "배지가 대시보드에 붙어 있다");
  봄(배지.some((x) => /^\d+/.test(x.글) && x.보임), "기한 지난 건수가 실제로 떠 있다 (운영 DB에 6건 있음)");
}

// ── 2·3. 대시보드 → 적어 넣기 → 명령창 ────────────────────────────────
// 대시보드 탭을 먼저 연다 — 안 열려 있으면 #taskOpen이 아예 없다(하네스가 "없다"를 결함으로 오해한다).
const shell = 살아있는().find((p) => { try { return p.url().includes("app.html"); } catch { return false; } });
if (shell) {
  // ⚠ 사이드바 항목은 data-page를 안 단다(실측) — **글자로 찾아 누른다**.
  //   선택자를 짐작해서 쓰면 "안 눌렸는데 눌렀다고 믿는" 하네스가 된다.
  const 눌렀나 = await shell.evaluate(() => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item, #gijoNav a")]
      .find((e) => (e.textContent || "").includes("대시보드"));
    if (!it) return false;
    it.click();
    return true;
  }).catch(() => false);
  console.log("대시보드 메뉴 클릭:", 눌렀나 ? "OK" : "✗ 항목을 못 찾음");
  await 잠깐(3000);
}
const dash = await 프레임찾기("#taskOpen");
if (!dash) { console.log("✗ 대시보드(적어 넣기 버튼)를 못 찾았다 — 대시보드 탭을 여세요"); 실패++; }
else {
  // ⚠ 콘솔은 **셸(app.html)에 있다** — 화면(iframe) 안에서 찾으면 늘 "없다"가 나온다.
  //   실제로 이 착각 때문에 대시보드 버튼이 없는 객체를 부르고 있었다(2026-08-01).
  const 있나 = await shell.evaluate(() => ({
    콘솔: !!window.gijoConsole,
    prefill: typeof window.gijoConsole?.prefill,
    ask: typeof window.gijoConsole?.ask,
  })).catch(() => null);
  console.log("콘솔 API:", JSON.stringify(있나));
  봄(있나 && 있나.prefill === "function", "prefill()이 실재한다 (없으면 버튼이 조용히 죽는다)");

  await dash.click("#taskOpen").catch(() => {});
  await 잠깐(1200);
  const 입력 = await shell.evaluate(() => {
    const el = document.getElementById("chatInput");
    return el ? { 값: el.value, 초점: document.activeElement === el } : null;
  }).catch(() => null);
  console.log("명령창:", JSON.stringify(입력));
  봄(!!입력 && 입력.값.includes("할 일 추가"), "적어 넣기가 명령창에 문장을 얹는다");
  봄(!!입력 && 입력.초점, "커서가 명령창에 가 있다 (바로 이어 적을 수 있다)");

  await shell.evaluate(() => { const el = document.getElementById("chatInput"); if (el) el.value = ""; });
}

console.log("\n실패 " + 실패 + "건");
await b.close();
process.exit(실패 ? 1 : 0);
