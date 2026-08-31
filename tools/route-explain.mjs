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
  // ⚠ 항목 시작은 **줄 혼자 있는 `{`** 로만 본다(2026-08-10 실사고).
  //   예전엔 아무 `{`나 시작으로 봤는데, 정규식 안의 수량자 `{0,12}`·`{0,6}` 를 여는 괄호로
  //   오인해 **앞 규칙의 정규식이 뒷 규칙 몸통에 섞였다.** 그 결과 「레드팀 점검 결과 알려줘」가
  //   set_model_thinking에도 걸린다는 **거짓 겹침**이 났다(실제로는 안 걸린다 — 직접 대조로 확인).
  //   겹침 0은 QA 관문이라, 거짓 경보는 진짜 겹침을 묻어 버린다.
  for (const m of 블록.matchAll(/^\s*\{\s*$([\s\S]*?)tool: "([a-z_]+)"/gm)) {
    // ⚠ **주석 줄은 걷어내고 본다**(2026-08-05 실사고). 규칙 몸통에서 `/.../`를 통째로 뽑다 보니
    //   주석에 슬래시로 낱말을 나열한 것(예: `(켜져/꺼져/있어/인가)`)까지 정규식으로 읽어,
    //   `/있어/`가 「…있어?」로 끝나는 7문항에 걸리며 **거짓 겹침 7건**을 냈다.
    //   겹침 0은 QA 관문이라, 거짓 경보는 진짜 겹침을 묻어 버린다 — 읽는 자리에서 잘라 낸다.
    const 몸 = m[1].split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
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
  // ── 승인된 겹침 ────────────────────────────────────────────────────────────
  // ⚠ **왜 표가 필요한가**: 아래 주석이 원래부터 「겹침 자체가 잘못은 아니다. 다만 아무도
  //   모르게 생기면 안 된다」고 적어 두었는데, 코드는 **겹침이 하나라도 있으면 무조건 실패**
  //   였다. 그런데 승인된 겹침이 실제로 하나 있어서(아래 표), 이 관문은 **원리상 통과할 수가
  //   없었다** — qa-full의 routing 계층이 영구 빨간불이었고, 그러면 사람은 빨간불을 배경으로
  //   여기게 된다. 「통과 불가능한 시험」은 이 저장소가 반복해 겪은 부류다(2026-08-31 조사).
  // → 뜻대로 고친다: **새 겹침만** 실패로 잡는다. 승인된 것은 이유와 함께 여기 적는다.
  // ⚠ 표가 낡아도 실패한다 — 승인해 둔 겹침이 사라졌으면 줄을 지워야 한다. 안 그러면
  //   「예외 목록」이 쌓이기만 하고 아무도 안 지운다(예외엔 이유를 강제하는 이 저장소 관례).
  const 승인된겹침 = [
    {
      말: "중복된 문서 있어?",
      이김: "지식베이스 정리",
      이유: "정리 리포트가 중복 목록을 **포함해서** 답한다 — 사람이 원하는 답이 한 번에 나온다. " +
            "doc_duplicates만 따로 부르면 정리 맥락이 빠진 반쪽 답이 된다(2026-08-31 승인).",
    },
  ];
  const 열쇠 = (x) => `${x.말}|${x.걸림 ? x.걸림[0].이름 : x.이김}`;
  const 승인집합 = new Map(승인된겹침.map((a) => [`${a.말}|${a.이김}`, a]));
  const 새겹침 = [];
  const 본것 = new Set();
  for (const { 말, 걸림 } of 겹친것) {
    const k = 열쇠({ 말, 걸림 });
    const 승인 = 승인집합.get(k);
    console.log(`  「${말}」${승인 ? "  (승인된 겹침)" : "  ← 새 겹침"}`);
    걸림.forEach((r, i) => console.log(`     ${i === 0 ? "▸ 이김" : "  밀림"}  ${r.이름} → ${r.도착}`));
    if (승인) { console.log(`     이유: ${승인.이유}`); 본것.add(k); }
    else 새겹침.push({ 말, 걸림 });
  }
  const 낡은승인 = 승인된겹침.filter((a) => !본것.has(`${a.말}|${a.이김}`));
  if (낡은승인.length) {
    console.log("\n  ⚠ 승인 표가 낡았습니다 — 아래는 이제 안 겹칩니다. route-explain.mjs의 `승인된겹침`에서 지우세요:");
    for (const a of 낡은승인) console.log(`     · 「${a.말}」 (이김: ${a.이김})`);
  }
  console.log(
    새겹침.length
      ? `\n  ✗ 새 겹침 ${새겹침.length}개 — 앞의 것이 이기는 게 맞는지 사람이 봐야 합니다.\n     맞다면 route-explain.mjs의 \`승인된겹침\`에 **이유와 함께** 적으세요.\n`
      : 겹친것.length
        ? "\n  ✓ 새 겹침 없음(승인된 것만 있습니다).\n"
        : "\n  ✓ 겹치는 것이 없습니다.\n",
  );
  // QA 전수조사가 이 값을 본다 — **새** 겹침이 생기면 실패로 잡아 **사람이 보게** 만든다.
  // ⚠ 겹침 자체가 잘못은 아니다. 다만 **아무도 모르게** 생기면 안 된다:
  //   2026-08-02에 넓은 규칙을 앞에 넣어 today를 가로챘고 라우팅이 100%→96.9%로 떨어졌다.
  //   그때는 평가 게이트를 돌리고서야 알았다. 여기서는 규칙을 고친 그 자리에서 알린다.
  if (새겹침.length || 낡은승인.length) process.exitCode = 1;
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
