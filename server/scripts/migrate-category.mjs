// scripts/migrate-category.mjs — 기존 지식베이스 문서에 업무영역(category)을 소급 부여한다.
// 2026-07-25 RAG 전면 검토: 새 인입은 ingestText가 분류하지만, 이전 문서(운영 67건)는
// category가 비어 있어 화면 맥락 검색(부스트)에서 빠진다. 이 스크립트가 한 번 채운다.
//
// 실행(운영 WSL): cd /home/gijo/gijo-as/server && node scripts/migrate-category.mjs
//  - 재실행해도 안전(멱등) — 같은 규칙은 같은 결과를 내고, 이미 같은 값이면 그대로다.
//  - 분류는 결정적 규칙만 쓴다(LLM 없이) — 규칙이 확신 못 하는 문서는 '일반'으로 두고,
//    담당자가 화면에서 고치는 것(승인카드)이 다음 단계다.
//
// 순서: ① SQLite memory_documents.category 갱신 ② LanceDB documents 테이블에
//       category 컬럼 보장(addColumns) 후 문서별 update. 서버가 떠 있어도 동작하지만
//       재시작 직후(조용한 시점) 실행을 권장한다.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("node:path");

// 컴파일된 엔진에서 분류 규칙을 그대로 빌린다 — 스크립트와 서버가 다른 규칙을 쓰면 안 된다.
const { categorizeByRules } = require(path.resolve("dist/engine/memory.js"));
const Database = require("better-sqlite3");
const lancedb = require("@lancedb/lancedb");

const DB_PATH = process.env.GIJO_MEMORY_DB_PATH ?? path.join("data", "memory.lancedb");

// 저장 암호화 이후 일반 드라이버로는 못 연다 — 이유를 분명히 말하고 멈춘다(2026-08-09).
const { 잠긴DB인가_확인 } = await import("./_dbguard.mjs");
잠긴DB인가_확인(path.join("data", "gijo-as.sqlite"), "migrate-category");

const sqlite = new Database(path.join("data", "gijo-as.sqlite"));

const esc = (s) => s.replace(/'/g, "''");

const docs = sqlite.prepare("SELECT documentId, category FROM memory_documents").all();
console.log(`대상 문서 ${docs.length}건`);

const ldb = await lancedb.connect(DB_PATH);
const names = await ldb.tableNames();
if (!names.includes("documents")) {
  console.error("LanceDB documents 테이블이 없습니다 — 중단");
  process.exit(1);
}
const table = await ldb.openTable("documents");

// ① category 컬럼 보장 — 없으면 추가(기본 '일반'). 서버의 ensureCategoryColumn과 같은 방식.
const schema = await table.schema();
if (!schema.fields.some((f) => f.name === "category")) {
  await table.addColumns([{ name: "category", valueSql: "'일반'" }]);
  console.log("LanceDB에 category 컬럼 추가(기본 '일반')");
} else {
  console.log("LanceDB category 컬럼 이미 존재");
}

// ② 문서별 재분류 — 파일명 + 첫 조각 텍스트(내용 신호)로 규칙 분류.
const setStmt = sqlite.prepare("UPDATE memory_documents SET category = ? WHERE documentId = ?");
const counts = {};
let changed = 0;
for (const d of docs) {
  const first = await table
    .query()
    .where(`documentId = '${esc(d.documentId)}'`)
    .limit(1)
    .toArray();
  const sample = String(first[0]?.text ?? "");
  const cat = categorizeByRules(d.documentId, sample) ?? "일반";
  counts[cat] = (counts[cat] ?? 0) + 1;
  if (d.category !== cat) {
    setStmt.run(cat, d.documentId);
    await table.update({ where: `documentId = '${esc(d.documentId)}'`, values: { category: cat } });
    changed++;
  }
}

console.log("\n분류 결과:");
for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}건`);
console.log(`\n갱신 ${changed}건 / 전체 ${docs.length}건 — 완료`);

// ③ 전문 검색 인덱스 갱신 — addColumns·update가 테이블 조각을 재작성하므로, 이걸 빠뜨리면
// BM25(구문 검색)가 조용히 0건을 낸다(2026-07-25 실측: CWE-79 구문 검색 0건 회귀).
await table.optimize();
console.log("\n전문 검색 인덱스 갱신(optimize) 완료");

// ④ 검증 — LanceDB 실제 분포를 다시 읽어 확인한다(믿지 말고 재측정).
const all = await table.query().select(["documentId", "category"]).limit(1_000_000).toArray();
const byCat = {};
for (const r of all) byCat[r.category ?? "(없음)"] = (byCat[r.category ?? "(없음)"] ?? 0) + 1;
console.log("\nLanceDB 조각 분포(검증):");
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}조각`);
