// tools/opslog-report.mjs — opslog-watch.mjs가 쌓아온 findings를 사람이 읽을 요약으로 출력.
// 요청 시("서버 로그 뭐 있어?") 이 스크립트 결과를 그대로 답변 근거로 쓴다.
// 실행: node tools/opslog-report.mjs [--json]

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINDINGS_PATH = process.env.GIJO_OPSLOG_FINDINGS ?? path.join(__dirname, "..", "data", "opslog-findings.json");

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_LABEL = { critical: "🔴 심각", high: "🟠 높음", medium: "🟡 보통", low: "⚪ 낮음" };

function main() {
  if (!existsSync(FINDINGS_PATH)) {
    console.log("아직 수집된 findings가 없습니다 (opslog-watch.mjs가 한 번도 안 돌았거나 이슈 없음).");
    return;
  }
  const data = JSON.parse(readFileSync(FINDINGS_PATH, "utf8"));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const items = Object.values(data.items || {}).sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.count - a.count
  );
  console.log(`# GIJO AS 운영 로그 감시 요약 — ${new Date(data.generatedAt).toLocaleString("sv-SE")}`);
  console.log(`누적 스캔 라인: ${data.scannedLines} · 이슈 종류: ${items.length}\n`);
  if (items.length === 0) {
    console.log("현재까지 감지된 이상 패턴 없음 (정상).");
    return;
  }
  for (const it of items) {
    console.log(`${SEV_LABEL[it.severity] ?? it.severity} [${it.count}회] ${it.title}`);
    console.log(`  최초: ${new Date(it.firstSeen).toLocaleString("sv-SE")} · 최근: ${new Date(it.lastSeen).toLocaleString("sv-SE")}`);
    console.log(`  예시: ${it.sample}`);
    console.log(`  해결방안: ${it.remediation}\n`);
  }
}

main();
