// ② 실화면 확인 — 대화창 첨부의 **결정 카드에 3소스 유형이 있고, 골라서 실제로 인입되는가.**
//
// ★ 이 하네스가 지키는 것: 서버만 고치고 화면을 안 고치면 담당자는 여전히 못 고른다.
//   오늘 그 함정을 두 번 밟았다 — 라우트 허용 목록이 옛 5유형 그대로여서 골라도 조용히
//   버려졌고, 그 전엔 preload에만 있고 부르는 화면이 없었다.
//
// ⚠ 하네스 함정(이 저장소에서 데인 것)
//   - 콘솔은 **셸(app.html)에 있다**. iframe 안에서 찾으면 늘 "없다"가 나온다.
//   - 파일 입력이 display:none이어도 setInputFiles는 동작한다(실제 사용자 경로와 같다).
//   - 스테일 프레임이 남는다 — 살아 있는 페이지만 고른다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { createRequire } = await import("node:module");
const require_ = createRequire(new URL("../server/package.json", import.meta.url));
const { chromium } = require_("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
const 살아있는 = () => ctx.pages().filter((p) => { try { p.url(); return true; } catch { return false; } });

let 실패 = 0;
const 봄 = (ok, 말, 덧 = "") => { if (!ok) 실패++; console.log((ok ? "  " : "✗ ") + 말 + (덧 ? "\n     " + 덧 : "")); };

const shell = 살아있는().find((p) => { try { return p.url().includes("app.html"); } catch { return false; } });
if (!shell) { console.log("✗ 셸(app.html)을 못 찾았다 — 로그인부터 하세요"); process.exit(1); }

// ── 결정 카드를 띄운다 — 파일명·내용 모두 애매해야 카드가 뜬다 ──────────────
const 임시 = path.join(os.tmpdir(), "정리자료-2026-08-01.csv");
fs.writeFileSync(임시, "구분,건수\n차단,152\n탐지,37\n정책위반,8\n", "utf-8");

const 첨부 = await shell.$("#csUploadInput");
봄(!!첨부, "대화창에 첨부 입력이 있다");
if (!첨부) { await b.close(); process.exit(1); }

await 첨부.setInputFiles(임시);
await 잠깐(6000);

const 카드 = await shell.evaluate(() => {
  const el = document.querySelector(".cs-updec");
  if (!el) return null;
  return {
    버튼: [...el.querySelectorAll(".btns button")].map((x) => ({ t: x.getAttribute("data-t"), 글: x.textContent.trim() })),
  };
});
봄(!!카드, "결정 카드가 떴다", 카드 ? "" : "카드가 없다 — 자동 분류로 끝났을 수 있다(그 자체는 정상일 수 있음)");

if (카드) {
  console.log("     유형: " + 카드.버튼.map((x) => x.t).join(" · "));
  봄(카드.버튼.some((x) => x.t === "securitylog"), "🚨 보안 로그 원본 유형이 보인다");
  봄(카드.버튼.some((x) => x.t === "opsreport"), "📈 운영 리포트 유형이 보인다");
  봄(카드.버튼.some((x) => x.t === "vulnreport"), "🩹 취약점 리포트 유형이 그대로 있다");

  // ── 골라서 실제로 인입되는가 ────────────────────────────────────────────
  await shell.evaluate(() => {
    const btn = [...document.querySelectorAll(".cs-updec .btns button")].find((x) => x.getAttribute("data-t") === "opsreport");
    if (btn) btn.click();
  });
  await 잠깐(9000);
  const 결과 = await shell.evaluate(() => {
    const rows = [...document.querySelectorAll(".cm")].map((x) => x.textContent.trim());
    return rows[rows.length - 1] || "";
  });
  console.log("     결과 문구: " + 결과.replace(/\s+/g, " ").slice(0, 150));
  봄(/통합 분석에 \d+건 등록|탐지 규칙에 걸린 항목이 없어/.test(결과),
    "고른 유형으로 실제 인입되고 결과를 말한다",
    "‹0건이면 왜 0건인지 말해야 한다 — 조용히 끝나면 '올렸는데 아무 일도 없다'가 된다›");
}

fs.unlinkSync(임시);
console.log("\n실패 " + 실패 + "건");
await b.close();
process.exit(실패 ? 1 : 0);
