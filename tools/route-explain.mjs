// route-explain — "담당자가 이 말을 치면 어디로 갑니까?"에 한 화면으로 답한다.
//
//   node tools/route-explain.mjs "오늘 뭐부터 해야 해?"
//   node tools/route-explain.mjs --겹침          ← 서로 잡아채는 규칙 찾기
//   node tools/route-explain.mjs --표            ← 규칙표 전체를 층 순서로
//
// ⚠ 이 도구는 **제품을 흉내 내지 않는다.** 실제 라우팅은 dispatcher.ts와 agentloop.ts가 한다.
//   여기서는 그 두 파일에서 정규식을 **그대로 읽어와** 어느 것이 걸리는지 보여 준다 —
//   따로 베껴 두면 반드시 어긋나고, 어긋난 설명은 없느니만 못하다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const 엔진 = (f) => fs.readFileSync(path.join(뿌리, "server/src/engine", f), "utf8");

// ── 규칙표(routes.ts)를 읽는다. TS라 import 못 하니 필요한 필드만 뽑는다 ──────────
function 규칙표() {
  const s = 엔진("routes.ts");
  const 층 = {};
  for (const m of s.matchAll(/^\s{2}([가-힣]+): (\d+),/gm)) 층[m[1]] = Number(m[2]);
  const 길 = [];
  const re = /이름: "([^"]+)", 층: "([^"]+)", 파일: "([^"]+)", 판별: "([^"]+)",\s*\n?\s*도착: "([^"]+)",\s*\n?\s*왜: "([^"]+)"/g;
  for (const m of s.matchAll(re))
    길.push({ 이름: m[1], 층: m[2], 파일: m[3], 판별: m[4], 도착: m[5], 왜: m[6], 순: 층[m[2]] ?? 99 });
  return { 층, 길 };
}

// ── 코드에서 정규식 리터럴을 이름으로 꺼낸다 ────────────────────────────────────
function 정규식들(파일) {
  const s = 엔진(파일);
  const out = {};
  for (const m of s.matchAll(/(?:const|let)\s+([A-Za-z_가-힣][\w가-힣]*)\s*(?::[^=]+)?=\s*(\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*)\s*;/g)) {
    try { out[m[1]] = eval(m[2]); } catch { /* 못 읽는 것은 건너뛴다 */ }
  }
  return out;
}

// FORCED_INTENTS는 배열이라 따로 읽는다 — **자리 번호가 곧 우선순위**다.
function 강제도구들() {
  const a = 엔진("agentloop.ts");
  const i = a.indexOf("const FORCED_INTENTS");
  const 블록 = a.slice(i, a.indexOf("\n];", i));
  const out = [];
  for (const m of 블록.matchAll(/\{([\s\S]*?)tool: "([a-z_]+)"/g)) {
    const 몸 = m[1];
    const 걸림 = [...몸.matchAll(/\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([gimsuy]*)/g)];
    const 정규식 = [];
    for (const r of 걸림) { try { 정규식.push(new RegExp(r[1], r[2])); } catch { /* 건너뜀 */ } }
    out.push({ 자리: out.length, 도구: m[2], 정규식 });
  }
  return out;
}

function 설명(말) {
  const { 길 } = 규칙표();
  const d = 정규식들("dispatcher.ts");
  const 강제 = 강제도구들();
  const 걸린것 = [];

  for (const r of 길.sort((a, b) => a.순 - b.순)) {
    const m = /^FORCED_INTENTS\[(\d+)\]$/.exec(r.판별);
    if (m) {
      const f = 강제[Number(m[1])];
      if (f && f.정규식.length && f.정규식.some((re) => re.test(말))) 걸린것.push(r);
      continue;
    }
    const 이름들 = r.판별.split(" + ");
    const 있는것 = 이름들.map((n) => d[n]).filter(Boolean);
    if (있는것.length === 이름들.length && 있는것.every((re) => re.test(말))) 걸린것.push(r);
  }

  console.log(`\n  「${말}」\n`);
  if (!걸린것.length) {
    console.log("  걸리는 규칙 없음 →  ⑨ 모델 선택 — LLM이 도구를 고릅니다.");
    console.log("  (정규식으로 못 읽는 판별자 — parsePickCommand·내할일완료말 같은 함수 —");
    console.log("   는 여기서 안 잡힙니다. 그건 데이터가 있어야 판단되는 것들입니다.)\n");
    return;
  }
  걸린것.forEach((r, i) => {
    const 표 = i === 0 ? "→ 여기로 갑니다" : "   (뒤에 있어 안 걸림)";
    console.log(`  ${i === 0 ? "▸" : " "} ${r.층.padEnd(6)} ${r.이름.padEnd(16)} → ${r.도착.padEnd(24)} ${표}`);
    if (i === 0) console.log(`      왜: ${r.왜}`);
  });
  if (걸린것.length > 1) console.log(`\n  ⚠ ${걸린것.length}개가 겹칩니다 — 앞의 것이 이깁니다.`);
  console.log("");
}

function 겹침찾기() {
  // 실제 답변에서 자주 나오는 말투로 겹침을 훑는다. 겹침 자체는 잘못이 아니다 —
  // **앞의 것이 이기는 게 맞는지**를 사람이 보라고 보여 주는 것이다.
  // ⚠ 표본은 **내가 지어낸 말이 아니라 실전 147상황에서 담당자가 실제로 친 말**을 쓴다.
  //   내가 만든 문장으로 재면 내 규칙에 맞는 문장만 만들게 된다 — 재는 사람이 답을 아는 시험이다.
  const 실전 = path.join(뿌리, ".tmp-reports/ops-sim.json");
  let 표본 = [];
  if (fs.existsSync(실전)) {
    const j = JSON.parse(fs.readFileSync(실전, "utf8"));
    표본 = (Array.isArray(j) ? j : j.results || []).map((x) => x.q).filter(Boolean);
  }
  if (!표본.length) {
    console.log("  ⚠ 실전 기록(.tmp-reports/ops-sim.json)이 없어 표본을 못 만들었습니다.");
    return;
  }
  const { 길 } = 규칙표();
  const d = 정규식들("dispatcher.ts");
  const 강제 = 강제도구들();
  const 겹친것 = [];
  let 걸린수 = 0;
  for (const 말 of 표본) {
    const 걸림 = [];
    for (const r of 길.sort((a, b) => a.순 - b.순)) {
      const m = /^FORCED_INTENTS\[(\d+)\]$/.exec(r.판별);
      if (m) { const f = 강제[Number(m[1])]; if (f?.정규식.some((re) => re.test(말))) 걸림.push(r); continue; }
      const n = r.판별.split(" + ").map((x) => d[x]).filter(Boolean);
      if (n.length === r.판별.split(" + ").length && n.every((re) => re.test(말))) 걸림.push(r);
    }
    if (걸림.length > 1) 겹친것.push({ 말, 걸림 });
    if (걸림.length) 걸린수++;
  }
  // ⚠ **이 점검이 헛돌고 있지 않은가.** 정규식을 하나도 못 읽었으면 겹침도 당연히 0이 된다 —
  //   "겹침 없음"과 "아무것도 안 재고 있음"은 화면에 똑같이 보인다. 그래서 걸린 수를 함께 낸다.
  console.log(`\n  겹침 점검 — 실전 질문 ${표본.length}개`);
  console.log(`    규칙에 걸림 ${걸린수}개 · 모델이 고름 ${표본.length - 걸린수}개  (읽은 규칙 ${길.length}개)`);
  if (!걸린수) {
    console.log("\n  ✗ 하나도 안 걸렸습니다 — 이 점검이 헛돌고 있습니다(정규식을 못 읽었을 가능성).\n");
    return;
  }
  console.log(`    둘 이상 걸림 ${겹친것.length}개\n`);
  for (const { 말, 걸림 } of 겹친것) {
    console.log(`  「${말}」`);
    걸림.forEach((r, i) => console.log(`     ${i === 0 ? "▸ 이김" : "  밀림"}  ${r.이름} → ${r.도착}`));
  }
  console.log(겹친것.length ? "\n  ⚠ 앞의 것이 이기는 게 맞는지 사람이 봐야 합니다.\n" : "\n  ✓ 겹치는 것이 없습니다.\n");
}

function 표보이기() {
  const { 길 } = 규칙표();
  let 앞층 = "";
  console.log(`\n  라우팅 규칙표 — ${길.length}개 (위에 있을수록 먼저 본다)\n`);
  for (const r of 길.sort((a, b) => a.순 - b.순)) {
    if (r.층 !== 앞층) { console.log(`\n  【${r.층}】`); 앞층 = r.층; }
    console.log(`    ${r.이름.padEnd(18)} → ${r.도착.padEnd(26)} (${r.파일})`);
  }
  console.log("");
}

const 인자 = process.argv.slice(2);
if (인자[0] === "--겹침") 겹침찾기();
else if (인자[0] === "--표") 표보이기();
else if (인자.length) 설명(인자.join(" "));
else {
  console.log("\n  쓰는 법:");
  console.log('    node tools/route-explain.mjs "오늘 뭐부터 해야 해?"');
  console.log("    node tools/route-explain.mjs --겹침");
  console.log("    node tools/route-explain.mjs --표\n");
}
