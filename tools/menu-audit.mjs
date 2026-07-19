// 메뉴 전수 조사 — 각 화면이 제공하는 "작업"을 코드에서 뽑는다.
//
// 실행: node tools/menu-audit.mjs
// 결과 문서: Notion "🧱 GIJO AS 메뉴 기능 정의 (전수 조사)"
//   — 화면이 늘거나 작업이 바뀌면 이 스크립트를 다시 돌려 그 문서를 갱신한다.
//   오케스트레이션 재정의·역량 레지스트리·권한 분리의 기준표라 손으로 세지 않는다.
// 신호 3가지: (1) window.gijo.* 호출 = 실제 기능, (2) 버튼 라벨 = 사용자에게 보이는 작업,
// (3) 그 중 쓰기 성격(생성/실행/삭제)만 추려 오케스트레이션 후보로 본다.
import { readFileSync, readdirSync } from "fs";

const DIR = "D:/Connect AI/client/src/renderer/pages";
const nav = readFileSync(`${DIR}/nav.js`, "utf-8");

// 메뉴 구조 파싱 (그룹 → 페이지)
const groups = [];
let cur = null;
for (const m of nav.matchAll(/ic:\s*"([^"]*)",\s*label:\s*"([^"]*)"|page:\s*"([^"]*)",\s*label:\s*"([^"]*)"/g)) {
  if (m[1] !== undefined) { cur = { icon: m[1], label: m[2], pages: [] }; groups.push(cur); }
  else if (cur) cur.pages.push({ page: m[3], label: m[4] });
}

// 쓰기 성격 판별 — 이름만으로 보수적으로
const WRITE = /^(create|add|start|run|stop|delete|remove|save|update|set|apply|approve|reject|generate|build|export|import|ingest|upload|scan|merge|train|dispatch|send|reset|rebuild|sync|enrich|seed|undo)/i;

function audit(page) {
  let html;
  try { html = readFileSync(`${DIR}/${page}`, "utf-8"); } catch { return null; }

  const calls = [...new Set([...html.matchAll(/window\.gijo\.(\w+)\s*\(/g)].map((m) => m[1]))];
  const writes = calls.filter((c) => WRITE.test(c));
  const reads = calls.filter((c) => !WRITE.test(c));

  // 버튼 텍스트(사용자에게 보이는 작업 이름)
  const btns = [...new Set([...html.matchAll(/<button[^>]*>([^<]{2,24})<\/button>/g)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((t) => t && !/^[×✕✖⟳↻⛶🗗]+$/.test(t)))];

  return { calls: calls.length, writes, reads: reads.length, btns: btns.slice(0, 8), lines: html.split("\n").length };
}

console.log("# GIJO AS 메뉴 전수 조사\n");
let totalPages = 0, totalWrites = 0;
const rows = [];

for (const g of groups) {
  for (const p of g.pages) {
    const a = audit(p.page);
    if (!a) { console.log(`- (파일 없음) ${p.page}`); continue; }
    totalPages++; totalWrites += a.writes.length;
    rows.push({ 그룹: g.label, 화면: p.label, 파일: p.page, 쓰기작업: a.writes.length, 조회: a.reads, 줄수: a.lines });
    console.log(`\n## [${g.icon} ${g.label}] ${p.label}  (${p.page}, ${a.lines}줄)`);
    console.log(`   쓰기 작업 ${a.writes.length} / 조회 ${a.reads}`);
    if (a.writes.length) console.log(`   실행: ${a.writes.join(", ")}`);
    if (a.btns.length) console.log(`   버튼: ${a.btns.join(" · ")}`);
  }
}

console.log("\n\n# 요약\n");
console.table(rows);
console.log(`총 ${totalPages}개 화면, 쓰기 성격 작업 ${totalWrites}종`);
