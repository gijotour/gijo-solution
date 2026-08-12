// tools/sweep-sanitize-store.mjs — **지식 저장소 전 조각에 살균 규칙을 돌려 오탐을 찾는다.**
//
// ■ 왜 이 방법인가 (2026-08-12 Mac 인계에서 배운 것)
//   처음엔 문서 원문(md·txt)만 훑어 「오탐 1건」이라 보고했다가 **3문서 4조각**으로 정정됐다.
//   원문 훑기로는 PDF가 통째로 빠진다 — 그런데 고객이 올리는 위협 보고서는 대부분 PDF다.
//   그래서 **LanceDB `documents` 표의 조각을 그대로** 본다. 이유 둘:
//     ① PDF 추출본이 들어온다  ② **실제로 검색에 뽑히는 형태 그대로**다(조각 경계까지 같다).
//   살균은 조각 단위로 돌기 때문에, 조각 경계가 다르면 걸리는 규칙도 달라진다.
//
// ■ 무엇을 재나
//   조각마다 sanitizeChunk를 돌려 **한 글자라도 바뀌면** 오탐 후보로 센다.
//   원문은 안 건드린다 — 읽기만 한다(운영 DB에 쓰지 않는다).
//
// 사용:
//   운영 코드로 재기(=지금 배포된 규칙):
//     cd /home/gijo/gijo-as/server && node ../tools/sweep-sanitize-store.mjs
//   고친 코드로 재기(운영 데이터 + 시험 사본의 새 규칙):
//     cd /home/gijo/gijo-as-test/server \
//       && GIJO_MEMORY_DB_PATH=/home/gijo/gijo-as/server/data/memory.lancedb \
//          node "/mnt/d/Connect AI/tools/sweep-sanitize-store.mjs"
//
// 환경변수
//   GIJO_MEMORY_DB_PATH  : lancedb 폴더(기본 ./data/memory.lancedb — 실행 위치 기준)
//   GIJO_SANITIZE_MODULE : sanitizeChunk를 가진 모듈(기본 ./dist/engine/ragsanitize.js)
//
// ⚠ 반드시 **server/ 안에서** 실행할 것 — 이 파일은 tools/에 있어서 제 위치에는 node_modules가
//   없다. node는 **스크립트 위치** 기준으로 패키지를 찾으므로(실행 위치가 아니다 — 2026-08-12에
//   밟았다), 아래에서 createRequire로 **실행 위치 기준** 해석으로 바꿔 준다.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const DB_PATH = process.env.GIJO_MEMORY_DB_PATH ?? path.join("data", "memory.lancedb");
const MODULE_PATH = process.env.GIJO_SANITIZE_MODULE ?? path.resolve("dist/engine/ragsanitize.js");

// 실행 위치(server/)의 node_modules에서 찾게 한다.
const requireFromCwd = createRequire(path.resolve("package.json"));
const lancedb = await import(pathToFileURL(requireFromCwd.resolve("@lancedb/lancedb")).href).catch((e) => {
  console.error(`★ @lancedb/lancedb를 못 불렀다 — server/ 안에서 실행했는가?\n  ${e.message}`);
  process.exit(2);
});

const { sanitizeChunk } = await import(pathToFileURL(path.resolve(MODULE_PATH)).href).catch((e) => {
  console.error(`★ 살균 모듈을 못 불렀다: ${MODULE_PATH}\n  ${e.message}`);
  process.exit(2);
});

console.log(`지식 저장소: ${path.resolve(DB_PATH)}`);
console.log(`살균 규칙  : ${path.resolve(MODULE_PATH)}\n`);

const db = await lancedb.connect(DB_PATH);
const table = await db.openTable("documents");
const total = await table.countRows();

// 전 조각을 읽는다. vector 열은 안 쓰니 빼서 메모리를 아낀다.
const rows = await table.query().select(["documentId", "chunkIndex", "text"]).limit(total + 10).toArray();

const 걸린것 = [];
for (const r of rows) {
  const 원문 = String(r.text ?? "");
  if (!원문) continue;
  const s = sanitizeChunk(원문);
  if (s.removed.length === 0) continue;
  걸린것.push({
    문서: String(r.documentId ?? "?"),
    조각: Number(r.chunkIndex ?? -1),
    라벨: s.labels,
    잘린문장: s.removed,
    남은비율: 원문.length ? Math.round((s.text.length / 원문.length) * 100) : 0,
  });
}

console.log(`전체 조각 ${rows.length.toLocaleString()}개 중 **살균으로 바뀐 조각 ${걸린것.length}개**` +
  ` (${((걸린것.length / Math.max(rows.length, 1)) * 100).toFixed(2)}%)`);

const 문서별 = new Map();
for (const g of 걸린것) {
  if (!문서별.has(g.문서)) 문서별.set(g.문서, []);
  문서별.get(g.문서).push(g);
}
console.log(`걸린 문서 ${문서별.size}개\n`);

for (const [문서, 목록] of 문서별) {
  console.log(`── ${문서}  (조각 ${목록.length}개)`);
  for (const g of 목록) {
    console.log(`   #${g.조각}  [${g.라벨.join(", ")}]  남은 글자 ${g.남은비율}%`);
    for (const 문장 of g.잘린문장) console.log(`     ✂ ${문장.slice(0, 120)}`);
  }
  console.log("");
}

if (걸린것.length === 0) console.log("✓ 살균으로 바뀌는 조각이 없다.");
