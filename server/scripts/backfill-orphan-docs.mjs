// scripts/backfill-orphan-docs.mjs — 벡터 저장소에만 있고 메타데이터가 없는 문서를 메운다.
//
// 무엇을 고치나 (2026-07-27 RAG 점검에서 발견)
//   LanceDB에는 77건인데 SQLite memory_documents에는 67건뿐이었다. 나머지 10건은
//   검색은 되지만 ① 화면 목록에 업로드 시각·올린 사람이 안 나오고 ② 업무영역이
//   addColumns 기본값 '일반'으로 굳어 있어 화면 맥락 부스트를 못 받는다.
//   실제로 "2025년 사이버 위협 전망.pdf" 같은 위협대응 자료가 '일반'에 묶여 있었다.
//
// 어떻게
//   ① 문서의 조각 몇 개를 읽어 규칙(categorizeByRules)으로 업무영역을 정한다 — LLM 안 쓴다.
//   ② SQLite에 메타 행을 만든다(위험 없음).
//   ③ LanceDB의 그 문서 조각만 골라 category를 고친다.
//
// ⚠ ③은 문서 하나씩 따로 처리하고 실패해도 다음으로 넘어간다. 전체 테이블을 한 번에 훑는
//   방식(migrate-category.mjs)은 이 데이터에서 lance 디코드 오류로 죽는 것을 확인했다.
//   지식 자체는 건드리지 않는다 — category 컬럼만 고친다.
//
// 실행: cd /home/gijo/gijo-as/server && node scripts/backfill-orphan-docs.mjs [--apply]
//   --apply 없이 돌리면 무엇을 바꿀지 보여주기만 한다(기본은 시늉만).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("node:path");
const lancedb = require("@lancedb/lancedb");
const Database = require("better-sqlite3");
const { categorizeByRules } = require(path.resolve("dist/engine/memory.js"));

const APPLY = process.argv.includes("--apply");
const DB_PATH = path.resolve("data/memory.lancedb");
const SQLITE = path.resolve("data/gijo-as.sqlite");
const TABLE = "documents";

// 저장 암호화 이후 일반 드라이버로는 못 연다 — 이유를 분명히 말하고 멈춘다(2026-08-09).
const { 잠긴DB인가_확인 } = await import("./_dbguard.mjs");
잠긴DB인가_확인(SQLITE, "backfill-orphan-docs");

const sq = new Database(SQLITE);
const have = new Set(sq.prepare("SELECT documentId FROM memory_documents").all().map((r) => r.documentId));

const ldb = await lancedb.connect(DB_PATH);
const table = await ldb.openTable(TABLE);
const rows = await table.query().select(["documentId", "scope", "category"]).limit(1_000_000).toArray();

const docs = new Map();
for (const r of rows) {
  const cur = docs.get(r.documentId) ?? { scope: r.scope, chunks: 0, category: r.category ?? null };
  cur.chunks += 1;
  docs.set(r.documentId, cur);
}
const orphans = [...docs.entries()].filter(([id]) => !have.has(id));
console.log(`벡터 ${docs.size}건 · 메타 ${have.size}건 · 메타 없는 문서 ${orphans.length}건`);
if (!orphans.length) { console.log("고칠 것 없음"); process.exit(0); }

const upsert = sq.prepare(
  `INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, sourcePath, ingestedAt, uploadedBy, category)
   VALUES (@documentId, @scope, @chunks, @embeddingModel, @sourcePath, @ingestedAt, @uploadedBy, @category)
   ON CONFLICT(documentId) DO UPDATE SET scope=excluded.scope, chunks=excluded.chunks, category=excluded.category`
);

let meta = 0, vec = 0, failed = 0;
for (const [documentId, info] of orphans) {
  // 앞 조각 몇 개만 읽어 분류한다 — 대용량 PDF를 통째로 읽지 않기 위해서다.
  let sample = "";
  try {
    const esc = documentId.replace(/'/g, "''");
    const some = await table.query().where(`documentId = '${esc}'`).limit(6).toArray();
    sample = some.map((r) => r.text ?? "").join("\n").slice(0, 4000);
  } catch (e) {
    console.log(`  ⚠ ${documentId}: 조각 읽기 실패(${e.message.slice(0, 60)}) — 파일명만으로 분류`);
  }
  const cat = categorizeByRules(documentId, sample) ?? "일반";
  const changed = cat !== (info.category ?? null);
  console.log(`  ${documentId}\n    조각 ${info.chunks} · 영역 ${info.category ?? "(없음)"} → ${cat}${changed ? " (변경)" : " (그대로)"}`);
  if (!APPLY) continue;

  upsert.run({
    documentId, scope: info.scope ?? "global", chunks: info.chunks,
    embeddingModel: "local-embedding-server", sourcePath: null,
    ingestedAt: new Date().toISOString(), uploadedBy: null, category: cat,
  });
  meta++;

  if (changed) {
    // 문서 하나만 골라 고친다. 실패해도 다음 문서로 넘어간다(지식은 그대로 남는다).
    try {
      const esc = documentId.replace(/'/g, "''");
      await table.update({ where: `documentId = '${esc}'`, values: { category: cat } });
      vec++;
    } catch (e) {
      failed++;
      console.log(`    ✗ 벡터 쪽 영역 갱신 실패 — 검색은 그대로 되고 부스트만 '일반'으로 남는다: ${e.message.slice(0, 100)}`);
    }
  }
}
console.log(APPLY ? `\n메타 ${meta}건 기록 · 벡터 영역 ${vec}건 갱신 · 실패 ${failed}건` : "\n(시늉만 — 실제로 바꾸려면 --apply)");
