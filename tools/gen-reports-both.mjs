// tools/gen-reports-both.mjs — 실데이터 기반 리포트 2종 생성(내부 검토용 + 대표 보고용), DOCX+PDF.
import * as fs from "fs";
import * as path from "path";
const BASE = "http://127.0.0.1:4100";
const j = (r) => r.json();
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "jyh", password: "changeme", force: true }) }).then(j);
const H = { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` };

const OUT = "C:/Users/user/AppData/Local/Temp/claude/D--Connect-AI/3c62e902-0e3a-4884-b2d8-f265c345cc6a/scratchpad/reports";
fs.mkdirSync(OUT, { recursive: true });

for (const [audience, label] of [["internal", "내부검토용"], ["official", "대표보고용"]]) {
  console.log(`\n=== ${label}(${audience}) 리포트 생성 중 — LLM 요약 포함, 최대 3분 ===`);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/report/generate`, {
    method: "POST", headers: H,
    body: JSON.stringify({ type: "quarterly", audience, format: "both" }),
  });
  const r = await res.json();
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  if (!res.ok || !r.filePath) { console.log(`✗ 실패(${res.status}):`, JSON.stringify(r).slice(0, 200)); continue; }
  console.log(`✓ 생성 완료 (${sec}초)`);
  console.log("  경영 요약 발췌:", (r.executiveSummary || "").slice(0, 160).replace(/\n/g, " "), "…");
  // 산출 파일을 스크래치패드로 복사(사용자 확인용)
  const base = path.basename(r.filePath, ".docx");
  const srcDir = path.join("D:/Connect AI/server", "data", "reports");
  for (const ext of ["docx", "pdf"]) {
    const src = path.join(srcDir, `${base}.${ext}`);
    if (fs.existsSync(src)) {
      const dst = path.join(OUT, `GIJO_보안현황_${label}.${ext}`);
      fs.copyFileSync(src, dst);
      console.log(`  → ${path.basename(dst)} (${Math.round(fs.statSync(dst).size / 1024)}KB)`);
    } else if (ext === "pdf" && r.pdfError) {
      console.log("  PDF:", r.pdfError);
    }
  }
}
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: H, body: JSON.stringify({ refreshToken: login.refreshToken }) });
console.log("\n완료 — 산출물:", OUT);
