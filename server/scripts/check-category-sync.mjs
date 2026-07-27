// scripts/check-category-sync.mjs — 업무영역(category)이 두 곳에서 어긋났는지 읽기만 해서 본다.
//
// 왜 필요한가: 화면 목록은 SQLite(memory_documents.category)를 보여주고, 검색의 화면 맥락
// 부스트는 LanceDB 행의 category를 쓴다. 두 값이 다르면 "화면에는 취약점이라 적혀 있는데
// 취약점 화면에서 부스트를 못 받는" 조용한 어긋남이 생긴다(2026-07-27 마이그레이션이
// LanceDB 단계에서 죽어 실제로 이 상태가 될 수 있음을 확인했다).
//
// 읽기 전용이다 — 고치지 않는다. 무엇이 어긋났는지만 보여 준다.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("node:path");
const lancedb = require("@lancedb/lancedb");
const Database = require("better-sqlite3");

const DB_PATH = path.resolve("data/memory.lancedb");
const SQLITE = path.resolve("data/gijo-as.sqlite");
const TABLE = "documents";

const sq = new Database(SQLITE, { readonly: true });
const meta = new Map(
  sq.prepare("SELECT documentId, category FROM memory_documents").all().map((r) => [r.documentId, r.category])
);

const ldb = await lancedb.connect(DB_PATH);
const names = await ldb.tableNames();
if (!names.includes(TABLE)) { console.log("LanceDB 테이블 없음"); process.exit(0); }
const table = await ldb.openTable(TABLE);

// 조각 전체를 읽지 않고 문서별 첫 값만 모은다(대용량 PDF가 있어 통째로 읽으면 느리다).
const rows = await table.query().select(["documentId", "category"]).limit(1_000_000).toArray();
const vec = new Map();
for (const r of rows) if (!vec.has(r.documentId)) vec.set(r.documentId, r.category ?? null);

let same = 0;
const diff = [];
const onlyVec = [];
for (const [id, vcat] of vec) {
  if (!meta.has(id)) { onlyVec.push([id, vcat]); continue; }
  const scat = meta.get(id);
  if ((scat ?? null) === (vcat ?? null)) same++;
  else diff.push([id, scat, vcat]);
}
const onlyMeta = [...meta.keys()].filter((id) => !vec.has(id));

console.log(`LanceDB 문서 ${vec.size}건 · SQLite 메타 ${meta.size}건`);
console.log(`일치 ${same}건 · 어긋남 ${diff.length}건 · 벡터에만 ${onlyVec.length}건 · 메타에만 ${onlyMeta.length}건`);
if (diff.length) {
  console.log("\n[어긋남] 화면 표시(SQLite) ↔ 검색 부스트(LanceDB)");
  diff.forEach(([id, s, v]) => console.log(`  ${id}\n    화면=${s ?? "(없음)"} / 부스트=${v ?? "(없음)"}`));
}
if (onlyVec.length) {
  console.log("\n[벡터에만 있음] 검색은 되지만 화면 목록에 메타가 없다(업로드 시각·올린 사람·영역 모름)");
  onlyVec.forEach(([id, v]) => console.log(`  ${id} (부스트 영역=${v ?? "없음"})`));
}
if (onlyMeta.length) {
  console.log("\n[메타에만 있음] 조각이 지워졌는데 메타가 남았다 — 목록에 유령 문서로 보일 수 있다");
  onlyMeta.forEach((id) => console.log(`  ${id}`));
}
