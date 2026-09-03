// route-explain — "담당자가 이 말을 치면 어디로 갑니까?"에 한 화면으로 답한다.
//
//   node tools/route-explain.mjs "오늘 뭐부터 해야 해?"
//   node tools/route-explain.mjs --겹침          ← 서로 잡아채는 규칙 찾기
//   node tools/route-explain.mjs --표            ← 규칙표 전체를 실제 호출 순서로
//
// ⚠ 이 도구는 **제품을 흉내 내지 않는다.** 도착지 판정은 제품 함수 하나가 한다 —
//   `결정적도착지`(server/src/engine/dispatcher.ts). 여기서는 그 답을 사람이 읽게 꾸미기만 한다.
//
// ★★ 왜 이렇게 바꿨나 (2026-09-04 실측 — 설명이 거짓이었다)
//   예전 판은 FORCED_INTENTS(agentloop)와 routes.ts 표에서 **정규식을 글자로 긁어** 흉내 냈고,
//   dispatcher가 agentloop **앞에서** 부르는 결정적 판별자들(picklist·datacard·incidentsteps·
//   screenguide…)을 아예 몰랐다. 그래서 이렇게 답했다:
//     · 「미조치 취약점 뭐 있어?」 → 「search로 갑니다」  (실제: isFindingListAsk → 목록+체크칸)
//     · 「취약점 알려주세여」       → 「걸리는 규칙 없음」 (실제: isFindingListAsk → 목록+체크칸)
//     · 「방화벽이 멈췄어」         → 「걸리는 규칙 없음」 (실제: 장애초동절차)
//   설명 도구의 도착지가 제품과 다르면 겹침 경보도 문서도 통째로 거짓이 된다 —
//   2026-08-10 「거짓 겹침 경보」와 같은 부류다(그때는 거짓 경보가 진짜 겹침을 묻었다).
//
// ⚠ 제품 함수를 부르려면 **빌드된 판(server/dist)** 이 필요하다. 낡은 dist로 설명하면
//   「낡은 제품」을 설명하게 되므로, 아래 `빌드확인()`이 소스보다 낡으면 **답하지 않고 멈춘다.**
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ⚠ DB를 건드리지 않는다 — db.ts의 기본 경로는 **cwd 기준 `data/gijo-as.sqlite`**라,
//   저장소 뿌리에서 이 도구를 돌리면 엉뚱한 자리에 빈 DB가 생긴다(운영 DB와도 무관한 유령).
//   이 도구는 글자만 보므로 메모리 DB면 충분하다.
process.env.GIJO_DB_PATH ??= ":memory:";

// ── 빌드가 지금 소스와 같은 체인인가 ───────────────────────────────────────────
// ⚠ 시각(mtime)으로 재지 않는다 — 이 저장소는 두 세션이 같은 작업트리를 만지므로, 내가 안
//   건드린 파일이 방금 바뀌어 있는 일이 흔하다(실측 2026-09-04: 남의 registry.ts가 내 빌드
//   3초 뒤에 바뀌어 「낡았다」 거짓 경보). 시각은 **관계 없는 변화까지** 세는 자다.
// → 대신 **내용으로** 잰다: 빌드된 체인이 들고 있는 `감시` 글자(= dispatchInstructionCore를
//   여는 코드 그대로)가 지금 소스 본문에 **그 순서대로** 있는지 본다. 하나라도 없거나 순서가
//   어긋나면 빌드가 낡았거나 체인이 바뀐 것이므로 **답하지 않는다** — 틀린 설명보다 낫다.
//   (같은 계약을 server/test/routeexplain.route.test.ts가 CI에서 다시 잰다.)
function 체인이소스와같나(체인) {
  const src = fs.readFileSync(path.join(뿌리, "server/src/engine/dispatcher.ts"), "utf8");
  const 시작 = src.indexOf("async function dispatchInstructionCore(");
  const 끝 = src.indexOf("export interface 도착단계");
  if (시작 < 0 || 끝 < 시작) return ["dispatchInstructionCore / 도착단계를 소스에서 못 찾았다 — 이 도구가 낡았다"];
  // ⚠ 주석 줄은 걷어내고 본다 — 「isHelpIntent보다 먼저 본다」 같은 **설명문**이 실제 호출보다
  //   앞에 있어, 안 걷어내면 순서를 거꾸로 읽는다(2026-08-05·08-10 실사고와 같은 함정).
  const 본문 = src.slice(시작, 끝).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const 탈 = [];
  let 앞자리 = -1, 앞이름 = "(시작)";
  for (const 단계 of 체인) {
    const i = 본문.indexOf(단계.감시);
    if (i < 0) { 탈.push(`[${단계.차례}] ${단계.이름} — 소스에 「${단계.감시}」가 없다`); continue; }
    if (i < 앞자리) 탈.push(`[${단계.차례}] ${단계.이름}이 「${앞이름}」보다 앞에 있다 — 순서가 어긋났다`);
    앞자리 = i; 앞이름 = 단계.이름;
  }
  return 탈;
}

// ── 제품 함수 부르기 ──────────────────────────────────────────────────────────
let 제품캐시 = null;
async function 제품() {
  if (제품캐시) return 제품캐시;
  const dist = path.join(뿌리, "server/dist/engine/dispatcher.js");
  if (!fs.existsSync(dist)) {
    console.log("\n  ✗ server/dist가 없습니다 — 제품 함수를 부를 수 없습니다.");
    console.log("    server 폴더에서 `npm run build` 후 다시 돌리세요.\n");
    process.exit(1);
  }
  const m = await import(pathToFileURL(dist).href);
  if (typeof m.결정적도착지 !== "function" || typeof m.결정적체인 !== "function") {
    console.log("\n  ✗ 빌드된 dispatcher가 `결정적도착지`를 안 내보냅니다 — 빌드가 낡았습니다.");
    console.log("    server 폴더에서 `npm run build` 후 다시 돌리세요.\n");
    process.exit(1);
  }
  const 탈 = 체인이소스와같나(await m.결정적체인());
  if (탈.length) {
    console.log("\n  ✗ 빌드된 체인이 지금 소스와 다릅니다 — 낡은 제품을 설명하게 됩니다:");
    for (const x of 탈) console.log(`     · ${x}`);
    console.log("\n    server 폴더에서 `npm run build` 후 다시 돌리세요.");
    console.log("    (빌드를 했는데도 나오면 dispatchInstructionCore의 갈래가 바뀐 것입니다 —");
    console.log("     `결정적도착지`의 순서·`감시` 글자를 그 코드에 맞춰 고치세요.)\n");
    process.exit(1);
  }
  제품캐시 = m;
  return m;
}

// ── routes.ts의 「왜」를 곁들인다 — 표는 실행하지 않지만 **이유**는 거기 적혀 있다 ─────
// ⚠ 순서·도착지는 **표에서 읽지 않는다**(그게 예전 판의 병이었다). 표는 설명문 출처일 뿐이다.
function 왜사전() {
  const s = fs.readFileSync(path.join(뿌리, "server/src/engine/routes.ts"), "utf8");
  const 사전 = new Map();
  const re = /이름: "([^"]+)", 층: "[^"]+", 파일: "[^"]+", 판별: "([^"]+)",\s*\n?\s*도착: "([^"]+)",\s*\n?\s*왜: "((?:[^"\\]|\\.)*)"/g;
  for (const m of s.matchAll(re)) {
    사전.set(m[3], { 이름: m[1], 판별: m[2], 왜: m[4].replace(/\\"/g, '"') });
    사전.set(m[2], { 이름: m[1], 판별: m[2], 왜: m[4].replace(/\\"/g, '"') });
  }
  return 사전;
}

function 왜한줄(사전, 단계) {
  return 사전.get(단계.도착)?.왜 ?? 사전.get(단계.판별)?.왜 ?? null;
}

async function 설명(말, 화면) {
  const { 결정적도착지 } = await 제품();
  const 걸린것 = await 결정적도착지(말, { 화면, 역할: "admin" });
  const 사전 = 왜사전();

  console.log(`\n  「${말}」\n`);
  if (!걸린것.length) {
    console.log("  걸리는 규칙 없음 →  ⑨ 모델 선택 — LLM이 도구를 고릅니다.");
    console.log("  (제품 함수로 잰 결과입니다 — 결정적 갈래 어디에도 안 걸립니다.)\n");
    return;
  }
  걸린것.forEach((r, i) => {
    const 표 = i === 0 ? (r.조건부 ? "→ 데이터가 겹치면 여기로" : "→ 여기로 갑니다") : "   (뒤에 있어 안 걸림)";
    console.log(`  ${i === 0 ? "▸" : " "} [${String(r.차례).padStart(2)}] ${r.층.padEnd(6)} ${r.이름.padEnd(20)} → ${r.도착.padEnd(30)} ${표}`);
    if (i === 0) {
      const 왜 = 왜한줄(사전, r);
      if (왜) console.log(`      왜: ${왜}`);
      if (r.조건부) console.log("      ⚠ 글자로는 걸렸지만 **최종 도착은 데이터에 달렸습니다**(내 할 일 이름·내 문서 조각과 겹칠 때만).");
    }
  });
  if (걸린것.length > 1) console.log(`\n  ⚠ ${걸린것.length}개가 겹칩니다 — 앞의 것(차례가 작은 것)이 이깁니다.`);
  console.log("");
}

// ── 승인된 겹침 ──────────────────────────────────────────────────────────────
// ⚠ **왜 표가 필요한가**: 겹침 자체가 잘못은 아니다. 다만 아무도 모르게 생기면 안 된다.
//   그런데 코드는 겹침이 하나라도 있으면 무조건 실패였고, 승인된 겹침이 실제로 있어서
//   이 관문은 **원리상 통과할 수가 없었다** — qa-full의 routing 계층이 영구 빨간불이었고,
//   그러면 사람은 빨간불을 배경으로 여기게 된다(2026-08-31 조사).
// → 뜻대로 고친다: **새 겹침만** 실패로 잡는다. 승인된 것은 이유와 함께 여기 적는다.
// ⚠ 표가 낡아도 실패한다 — 승인해 둔 겹침이 사라졌으면 줄을 지워야 한다. 안 그러면
//   「예외 목록」이 쌓이기만 하고 아무도 안 지운다(예외엔 이유를 강제하는 이 저장소 관례).
// ⚠ 이김은 **차례가 가장 작은 단계의 이름**이다(제품 체인 순서 그대로).
const 승인된겹침 = [
  {
    말: "중복된 문서 있어?",
    이김: "지식베이스 정리",
    이유: "정리 리포트가 중복 목록을 **포함해서** 답한다 — 사람이 원하는 답이 한 번에 나온다. " +
          "doc_duplicates만 따로 부르면 정리 맥락이 빠진 반쪽 답이 된다(2026-08-31 승인).",
  },
];

async function 겹침찾기() {
  // 실제 답변에서 자주 나오는 말투로 겹침을 훑는다. 겹침 자체는 잘못이 아니다 —
  // **앞의 것이 이기는 게 맞는지**를 사람이 보라고 보여 주는 것이다.
  // ⚠ 표본은 **내가 지어낸 말이 아니라 실전 상황에서 담당자가 실제로 친 말**을 쓴다.
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
  const { 결정적도착지, 결정적체인 } = await 제품();
  const 체인 = await 결정적체인();
  const 겹친것 = [];
  let 걸린수 = 0;
  for (const 말 of 표본) {
    const 걸림 = await 결정적도착지(말, { 역할: "admin" });
    if (걸림.length > 1) 겹친것.push({ 말, 걸림 });
    if (걸림.length) 걸린수++;
  }
  // ⚠ **이 점검이 헛돌고 있지 않은가.** 아무것도 못 재면 겹침도 당연히 0이 된다 —
  //   "겹침 없음"과 "아무것도 안 재고 있음"은 화면에 똑같이 보인다. 그래서 걸린 수를 함께 낸다.
  console.log(`\n  겹침 점검 — 실전 질문 ${표본.length}개`);
  console.log(`    규칙에 걸림 ${걸린수}개 · 모델이 고름 ${표본.length - 걸린수}개  (제품 체인 ${체인.length}단계)`);
  if (!걸린수) {
    console.log("\n  ✗ 하나도 안 걸렸습니다 — 이 점검이 헛돌고 있습니다(제품 함수를 못 불렀을 가능성).\n");
    process.exitCode = 1;
    return;
  }
  console.log(`    둘 이상 걸림 ${겹친것.length}개\n`);
  const 승인집합 = new Map(승인된겹침.map((a) => [`${a.말}|${a.이김}`, a]));
  const 새겹침 = [];
  const 본것 = new Set();
  for (const { 말, 걸림 } of 겹친것) {
    const k = `${말}|${걸림[0].이름}`;
    const 승인 = 승인집합.get(k);
    console.log(`  「${말}」${승인 ? "  (승인된 겹침)" : "  ← 새 겹침"}`);
    걸림.forEach((r, i) => console.log(`     ${i === 0 ? "▸ 이김" : "  밀림"}  [${String(r.차례).padStart(2)}] ${r.이름} → ${r.도착}${r.조건부 ? " (데이터 조건부)" : ""}`));
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

async function 표보이기() {
  const { 결정적체인 } = await 제품();
  const 체인 = await 결정적체인();
  let 앞층 = "";
  console.log(`\n  결정적 라우팅 체인 — ${체인.length}단계 (위에 있을수록 먼저 본다 · 제품 코드에서 그대로 읽었다)\n`);
  for (const r of 체인) {
    if (r.층 !== 앞층) { console.log(`\n  【${r.층}】`); 앞층 = r.층; }
    console.log(`    [${String(r.차례).padStart(2)}] ${r.이름.padEnd(20)} → ${r.도착.padEnd(32)} (${r.판별})${r.조건부 ? "  ※데이터 조건부" : ""}`);
  }
  console.log("\n  ⑨ 모델 선택 — 위에서 안 걸리면 LLM이 도구를 고릅니다.");
  console.log(`\n  (강제도구 [${체인.length - 1}]은 FORCED_INTENTS 규칙 전체를 한 자리로 접은 것입니다 —`);
  console.log("   그 안에서 어느 규칙이 걸리는지는 문장을 하나 넣어 보면 도착지로 나옵니다:");
  console.log('     node tools/route-explain.mjs "침해사고 히스토리 보여줘")\n');
  console.log("  ※데이터 조건부 = 글자로는 걸리지만 최종 도착은 데이터에 달렸습니다");
  console.log("    (내 할 일 이름·내 문서 조각과 겹칠 때만 채 갑니다).\n");
}

const 인자 = process.argv.slice(2);
const 실행 =
  인자[0] === "--겹침" ? 겹침찾기()
  : 인자[0] === "--표" ? 표보이기()
  : 인자.length ? 설명(인자.join(" "))
  : (async () => {
      console.log("\n  쓰는 법:");
      console.log('    node tools/route-explain.mjs "오늘 뭐부터 해야 해?"');
      console.log("    node tools/route-explain.mjs --겹침");
      console.log("    node tools/route-explain.mjs --표\n");
    })();
실행.catch((e) => { console.error("\n  ✗ 실패:", e?.message ?? e, "\n"); process.exit(1); });
