#!/usr/bin/env node
// 제목지목매치 실측기 — 「지목이 몇 개나 서는가」를 **재현 가능하게** 잰다.
//
// 왜 생겼나(2026-09-11 검토관 [하] 수리): 라틴 하한을 4자↑→3자↑로 내린 커밋(2b01e479)이
//   「코퍼스 67편 × 물음 436개 … 지목 17→25(+8), 오지목 0」을 주석 세 곳에 박아 놓고,
//   그 숫자를 낸 스크립트를 남기지 않았다. 이 저장소에서 주석의 숫자는 다음 라운드의 기준이
//   되는데 아무도 다시 잴 수 없으면 「낡은 숫자」가 그대로 굳는다(반복 사고 계보).
//
// ⚠ **잣대 사본을 만들지 않는다** — 제품의 hybridsearch.제목지목매치를 그대로 불러 쓴다.
//   옛 규칙과 견줄 때도 규칙을 베끼지 않고 `git show <ref>:…/hybridsearch.ts`로 **그때의 제품 소스**를
//   임시 파일에 꺼내 불러온다(node 24의 타입 스트리핑 — 이 파일은 import가 없는 순수부라 된다).
//
// 쓰기:
//   node tools/titlescope-measure.mjs                 # 지금 규칙으로 지목 세기 + 경계 스침 목록
//   node tools/titlescope-measure.mjs --vs 2b01e479^  # 그 판본과 견주기(늘어난/잃은 지목)
//   node tools/titlescope-measure.mjs --json          # 기계가 읽을 꼴
//
// 코퍼스(저장소에서 재현되는 것만 — 여기 없는 것은 세지 않는다):
//   문서: rag-seed/security-references/*.md(제품 동봉 지식) + server/docs-manifest.json(제품 문서)
//   물음: tools/evalgate/cases/{routing,korean,negative}.json + tools/doc-probe.json + tools/regress/cases.json
//   ⚠ ops-sim(152상황)·고객 QA 시험지는 코드가 아니라 하네스·운영 문서에 있어 이 셈에 안 들어간다.
//      그러니 이 스크립트의 수는 커밋 2b01e479가 적은 436문과 **같은 수가 아니다**(그쪽은 재현 불가).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const vsRef = argv.includes("--vs") ? argv[argv.indexOf("--vs") + 1] : null;
const asJson = argv.includes("--json");

function 문서목록() {
  const ids = [];
  const seedDir = path.join(ROOT, "rag-seed", "security-references");
  if (fs.existsSync(seedDir)) {
    for (const f of fs.readdirSync(seedDir)) if (f.endsWith(".md") && f !== "README.md") ids.push(f);
  }
  const manifest = path.join(ROOT, "server", "docs-manifest.json");
  if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    for (const e of m.files ?? []) if (e?.file) ids.push(e.file);
  }
  return [...new Set(ids)];
}

function 물음목록() {
  const qs = [];
  const 넣기 = (q, 출처) => { if (typeof q === "string" && q.trim()) qs.push({ q: q.trim(), 출처 }); };
  for (const 이름 of ["routing", "korean", "negative"]) {
    const p = path.join(ROOT, "tools", "evalgate", "cases", `${이름}.json`);
    if (!fs.existsSync(p)) continue;
    for (const c of JSON.parse(fs.readFileSync(p, "utf8")).cases ?? []) 넣기(c.q, `evalgate/${이름}`);
  }
  const dp = path.join(ROOT, "tools", "doc-probe.json");
  if (fs.existsSync(dp)) {
    for (const d of JSON.parse(fs.readFileSync(dp, "utf8")).문서 ?? []) 넣기(d.질문, "doc-probe");
  }
  const rg = path.join(ROOT, "tools", "regress", "cases.json");
  if (fs.existsSync(rg)) {
    for (const c of JSON.parse(fs.readFileSync(rg, "utf8")).cases ?? []) 넣기(c.q, "regress");
  }
  return qs;
}

/** 그 판본의 **제품 소스**를 그대로 꺼내 불러온다(규칙을 베끼지 않는다). */
async function 판본함수(ref) {
  if (!ref) return (await import(pathToFileURL(path.join(ROOT, "server/src/engine/hybridsearch.ts")).href)).제목지목매치;
  const src = execFileSync("git", ["show", `${ref}:server/src/engine/hybridsearch.ts`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "titlescope-")), "hybridsearch.ts");
  fs.writeFileSync(tmp, src, "utf8");
  return (await import(pathToFileURL(tmp).href)).제목지목매치;
}

/**
 * **경계 스침** — 맞힌 라틴 토큰이 물음 안에서 앞뒤가 영숫자인 자리에만 있는가.
 * 지금 판정은 낱말 경계를 안 본다(`q.includes(t)`)라 `cis`가 "cisco"에, `any`가 "company"에 스친다.
 * 여기서 세는 것은 **그 토큰이 오직 더 긴 낱말 속에만 있는** 경우다 — 낱말 경계 안을 넣으면 사라질 자리.
 */
function 경계스침(질문, docId) {
  const q = String(질문).toLowerCase().replace(/\s+/g, "");
  const base = docId.replace(/^.*[\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "").toLowerCase();
  const 스침 = [];
  for (const t of new Set(base.split(/[ _\-.]+/))) {
    if (!t || /[가-힣]/.test(t) || t.length < 3 || /^\d+$/.test(t)) continue;
    if (!q.includes(t)) continue;
    let 홀로선적있나 = false;
    for (let i = q.indexOf(t); i >= 0; i = q.indexOf(t, i + 1)) {
      const 앞 = q[i - 1] ?? "", 뒤 = q[i + t.length] ?? "";
      if (!/[a-z0-9]/.test(앞) && !/[a-z0-9]/.test(뒤)) { 홀로선적있나 = true; break; }
    }
    if (!홀로선적있나) 스침.push(t);
  }
  return 스침;
}

const docs = 문서목록();
const qs = 물음목록();
const 지금 = await 판본함수(null);
const 옛 = vsRef ? await 판본함수(vsRef) : null;

const 결과 = [];
for (const { q, 출처 } of qs) {
  const 새 = [...지금(q, docs)];
  const 예전 = 옛 ? [...옛(q, docs)] : null;
  결과.push({ q, 출처, 지목: 새, 옛지목: 예전, 스침: 새.flatMap((d) => 경계스침(q, d).map((t) => `${d}:${t}`)) });
}

const 지목건수 = 결과.filter((r) => r.지목.length).length;
const 옛건수 = 옛 ? 결과.filter((r) => r.옛지목.length).length : null;
const 늘어난 = 옛 ? 결과.filter((r) => r.지목.length && !r.옛지목.length) : [];
const 잃은 = 옛 ? 결과.filter((r) => !r.지목.length && r.옛지목.length) : [];
const 스친것 = 결과.filter((r) => r.스침.length);

if (asJson) {
  console.log(JSON.stringify({ 문서수: docs.length, 물음수: qs.length, 지목건수, 옛건수, 늘어난, 잃은, 스친것 }, null, 2));
} else {
  console.log(`코퍼스: 문서 ${docs.length}편 · 물음 ${qs.length}개 (저장소에서 재현되는 것만)`);
  console.log(`지목이 선 물음: ${지금 ? 지목건수 : 0}개${옛 ? ` (${vsRef}: ${옛건수}개)` : ""}`);
  if (옛) {
    console.log(`\n늘어난 지목 ${늘어난.length}건:`);
    for (const r of 늘어난) console.log(`  + ${r.q}  →  ${r.지목.join(", ")}  [${r.출처}]`);
    console.log(`잃은 지목 ${잃은.length}건:`);
    for (const r of 잃은) console.log(`  - ${r.q}  →  ${r.옛지목.join(", ")}  [${r.출처}]`);
  }
  console.log(`\n경계 스침(맞힌 라틴 토큰이 더 긴 낱말 속에만 있음) ${스친것.length}건:`);
  for (const r of 스친것) console.log(`  ! ${r.q}  →  ${r.스침.join(", ")}  [${r.출처}]`);
  if (!스친것.length) console.log("  (없음)");
}
