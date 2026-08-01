// 화면별 **실제 폭 사용률**을 잰다 — "꽉 차게" 작업의 근거이자 전후 대조표.
//
// ⚠ 정규식으로 CSS를 훑으면 색상값·미디어쿼리까지 걸려 엉뚱한 숫자가 나온다(실제로 그랬다).
//   실앱에서 **계산된 값**을 재는 것이 유일하게 믿을 수 있는 방법이다.
//
// 무엇을 재나: 화면 안 최상위 내용 덩어리가 창 폭의 몇 %를 쓰는가.
//   낮을수록 오른쪽이 비어 있다는 뜻이다. 폭을 푼 뒤 이 표가 올라가야 한다.
import { createRequire } from "module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "client", "package.json"));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const 살아있는 = () => ctx.pages().filter((p) => { try { p.url(); return true; } catch { return false; } });
const shell = 살아있는().find((p) => { try { return p.url().includes("app.html"); } catch { return false; } });
if (!shell) { console.log("셸 없음 — 로그인부터"); process.exit(1); }

const 메뉴 = await shell.$$eval("#gijoNav .gn-item", (els) =>
  els.map((e) => ({ 이름: e.querySelector(".gn-label")?.textContent || "", 페이지: e.getAttribute("data-page") || "" })).filter((x) => x.이름));

const 결과 = [];
for (const m of 메뉴) {
  await shell.evaluate((이름) => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent === 이름);
    it?.querySelector(".gn-label")?.click();
  }, m.이름);
  await shell.waitForTimeout(2200);
  const r = await shell.evaluate(() => {
    const f = document.querySelector("#screens iframe.on");
    if (!f) return null;
    try {
      const d = f.contentDocument, w = f.getBoundingClientRect().width;
      // ⚠ 바깥 껍데기(.app 같은 그리드)는 늘 전폭이라 재 봐야 소용없다(2026-08-01 실측에서
      //   전 화면이 99%로 나와 "문제 없음"으로 오독할 뻔했다). **폭을 실제로 묶는 것**을 찾는다:
      //   계산된 max-width가 걸려 있고 내용이 실린 덩어리 중 **가장 좁은 것**이 병목이다.
      // ★ 2차 수정(2026-08-01): max-width만 봤더니 "전부 제한 없음"이 나왔다 — 사실이지만
      //   담당자가 보는 **빈 오른쪽**은 그것 때문이 아니었다. 진짜로 재야 할 것은
      //   **내용이 오른쪽 끝까지 닿는가**다. 카드 그리드가 열 수를 고정해 두면 폭 제한이
      //   없어도 오른쪽이 통째로 빈다. 그래서 자식들의 오른쪽 끝을 잰다.
      let 오른끝 = 0, 범인 = "";
      const 뿌리 = d.querySelector("main, .main, .content, .wrap, .page") || d.body;
      const 왼쪽 = 뿌리.getBoundingClientRect().left;
      const 폭 = 뿌리.getBoundingClientRect().width;
      for (const el of 뿌리.querySelectorAll("*")) {
        const cs = d.defaultView.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
        const rr = el.getBoundingClientRect();
        if (rr.height < 24 || rr.width < 24) continue;
        if (rr.right > 오른끝) { 오른끝 = rr.right; 범인 = String(el.className || el.tagName).slice(0, 24); }
      }
      const 쓴폭 = Math.max(0, Math.round(오른끝 - 왼쪽));
      return { 창: Math.round(폭), 본문: 쓴폭, 덩어리: 범인 };
    } catch { return null; }
  });
  if (!r || !r.창) continue;
  결과.push({ 화면: m.이름, 페이지: m.페이지, ...r, 사용률: +(r.본문 / r.창).toFixed(2) });
}

결과.sort((a, b2) => a.사용률 - b2.사용률);
const 낮음 = 결과.filter((x) => x.사용률 < 0.85);
console.log(`창 폭 사용률 — ${결과.length}화면 (85% 미만 ${낮음.length}개)\n`);
for (const r of 결과) {
  const bar = "█".repeat(Math.round(r.사용률 * 20)).padEnd(20, "·");
  console.log(`${(r.사용률 * 100).toFixed(0).padStart(3)}% ${bar} ${r.화면}  (${r.본문}/${r.창}px · ${r.덩어리})`);
}
fs.writeFileSync(path.join(ROOT, ".tmp-reports", "width-census.json"), JSON.stringify(결과, null, 1), "utf8");
console.log("\n표: .tmp-reports/width-census.json");
await b.close();
