// scripts/recategorize-2026-08-07.mjs — 업무영역 소급 재분류(2차).
//
// 왜: 2026-08-07 분류 신호 보강(방화벽·피싱·IPS·랜섬웨어 등) 뒤, **이미 들어와 있는 문서에는
// 새 규칙이 적용되지 않았다**. 실측: 지식의 절반(2,866조각)이 「일반」에 묶여 있고 사내규정은
// 21조각뿐이었다 — 역할별 검색 정책이 효과를 내려면 분류가 먼저 바로 서야 한다.
//
// ⚠ 본문은 SQLite가 아니라 **LanceDB**에 있다(memory_documents는 메타만). 첫 측정에서 이걸
//   놓쳐 "바뀔 것 0건"이라는 거짓 결과를 봤다 — 파일명만 보고 판정했기 때문이다.
// ⚠ 규칙이 확신 못 하는 문서는 **그대로 둔다**(억지 분류가 오분류보다 나쁘다).
// 실행: cd /home/gijo/gijo-as/server && node scripts/recategorize-2026-08-07.mjs [--dry]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lancedb = require("@lancedb/lancedb");
const path = require("node:path");
const { db } = require(path.resolve("dist/db.js"));
const { categorizeByRules } = require(path.resolve("dist/engine/memory.js"));

const DRY = process.argv.includes("--dry");
const ldb = await lancedb.connect("data/memory.lancedb");
const t = await ldb.openTable("documents");
const rows = await t.query().select(["documentId", "chunkIndex", "text", "category"]).limit(50000).toArray();

const 본문 = new Map();
const 현재 = new Map();
for (const r of rows) {
  현재.set(r.documentId, r.category);
  if (r.chunkIndex < 3) 본문.set(r.documentId, (본문.get(r.documentId) || "") + " " + String(r.text || ""));
}

const 바꿀것 = [];
let 확신못함 = 0;
for (const [id, txt] of 본문) {
  const 새 = categorizeByRules(id, txt.slice(0, 3000));
  const 옛 = 현재.get(id) || "일반";
  if (!새) { 확신못함++; continue; }
  if (새 !== 옛) 바꿀것.push({ id, 옛, 새 });
}

console.log(`문서 ${본문.size}건 · 바꿀 것 ${바꿀것.length}건 · 규칙이 확신 못 함 ${확신못함}건(그대로 둠)`);
for (const x of 바꿀것) console.log(`  ${x.id.slice(0, 44)}  ${x.옛} → ${x.새}`);
if (DRY) { console.log("(--dry — 아무것도 바꾸지 않았습니다)"); process.exit(0); }

const up = db.prepare("UPDATE memory_documents SET category=? WHERE documentId=?");
for (const x of 바꿀것) {
  up.run(x.새, x.id);
  const esc = x.id.replace(/'/g, "''");
  await t.update({ where: `documentId = '${esc}'`, values: { category: x.새 } });
}
console.log(`완료 — SQLite·LanceDB 양쪽 ${바꿀것.length}건 갱신`);
