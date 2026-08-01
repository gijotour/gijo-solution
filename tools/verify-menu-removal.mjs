// ① 실앱 검증 — 내 업무 메뉴 제거 후 공용 사이드바가 성한가.
//
// ⚠ 이 하네스가 스스로를 속이지 않게 지키는 것:
//   - app.asar 여부를 먼저 확인한다(설치본을 개발본으로 착각한 적 있음)
//   - hub iframe 안을 봐야 한다 — 셸만 보면 메뉴가 안 보인다
//   - 스테일 중복 프레임이 있으니 **렌더된 프레임**을 골라야 한다
const { createRequire } = await import("node:module");
const require_ = createRequire(new URL("../server/package.json", import.meta.url));
const { chromium } = require_("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));

function 살아있는페이지() {
  return ctx.pages().filter((p) => { try { p.url(); return true; } catch { return false; } });
}

let page = 살아있는페이지().find((p) => /app\.html|hub\.html|index\.html/.test(p.url())) ?? 살아있는페이지()[0];
console.log("창 주소:", page.url());
console.log("설치본인가(app.asar):", page.url().includes("app.asar") ? "★ 설치본 — 개발본이 아니다" : "개발본 OK");

// ── 로그인 ────────────────────────────────────────────────────────────
const 아이디 = await page.$('input[name="username"], #username, #loginUser');
if (아이디) {
  await 아이디.fill("claude-deploy");
  await page.fill('input[type="password"]', process.env.GIJO_ADMIN_PASSWORD);
  await page.click('button[type="submit"], #loginBtn');
  await 잠깐(2500);
  // 중복 로그인 확인창이 뜨면 강제 로그인
  const 강제 = await page.$('#forceLoginBtn, button:has-text("강제 로그인")');
  if (강제) { await 강제.click(); await 잠깐(2500); }
  console.log("로그인 시도 완료");
}
await 잠깐(4000);
page = 살아있는페이지().find((p) => /app\.html|hub\.html/.test(p.url())) ?? page;

// ── 사이드바 검사 ─────────────────────────────────────────────────────
async function 사이드바있는프레임() {
  for (const p of 살아있는페이지()) {
    for (const f of p.frames()) {
      try {
        if (await f.$("#gijoNav .gn-item, #gijoNav a")) return { p, f };
      } catch { /* 떨어진 프레임 */ }
    }
  }
  return null;
}

let 자리 = await 사이드바있는프레임();
for (let i = 0; i < 10 && !자리; i++) { await 잠깐(1500); 자리 = await 사이드바있는프레임(); }
if (!자리) { console.log("✗ 사이드바를 못 찾았다 — 셸이 안 떴거나 로그인 실패"); process.exit(1); }

const f = 자리.f;
const 메뉴 = await f.$$eval("#gijoNav .gn-item, #gijoNav a", (els) =>
  els.map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean));
console.log("\n메뉴 " + 메뉴.length + "개:");
console.log("  " + 메뉴.join(" · "));

const 내업무있나 = 메뉴.some((m) => m.includes("내 업무"));
console.log("\n★ 「내 업무」 메뉴:", 내업무있나 ? "✗ 아직 있다" : "없다 OK");

// 배지가 대시보드로 옮겨졌나 (숨김이어도 요소는 있어야 한다)
const 배지 = await f.$$eval(".gn-workbadge", (els) => els.map((e) => ({
  글: e.textContent, 보임: getComputedStyle(e).display !== "none",
  붙은곳: (e.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
})));
console.log("★ 기한초과 배지:", 배지.length ? JSON.stringify(배지) : "✗ 요소 자체가 없다");

// 죽은 링크 — 사이드바가 가리키는 화면이 실재하는가
const 링크 = await f.$$eval("#gijoNav [data-page]", (els) => els.map((e) => e.getAttribute("data-page")));
console.log("★ 사이드바가 가리키는 화면:", 링크.filter((x) => /mywork/.test(x)).length ? "✗ mywork 잔존" : "mywork 없음 OK");

await f.screenshot?.({ path: ".tmp-reports/verify-nav-after.png" }).catch(() => {});
await 자리.p.screenshot({ path: ".tmp-reports/verify-app-after.png" }).catch(() => {});
console.log("\n스크린샷: .tmp-reports/verify-app-after.png");
await b.close();
