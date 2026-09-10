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
//   「낡은 제품」을 설명하게 되므로, 빌드를 **서로 다른 두 자**로 잰다:
//     ① `필요하면빌드()`   — 소스(.ts)가 짝 .js보다 새로우면 **그 자리에서 다시 빌드**한다.
//     ② `체인이소스와같나()` — 빌드된 체인의 순서가 지금 dispatcher.ts와 같은지 **글자로** 본다.
//   둘은 **다른 함정**을 잡는다(각 함수 머리글 참고). 하나로 줄이면 다른 쪽 함정이 되살아난다.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ⚠ DB를 건드리지 않는다 — db.ts의 기본 경로는 **cwd 기준 `data/gijo-as.sqlite`**라,
//   저장소 뿌리에서 이 도구를 돌리면 엉뚱한 자리에 빈 DB가 생긴다(운영 DB와도 무관한 유령).
//   이 도구는 글자만 보므로 메모리 DB면 충분하다.
process.env.GIJO_DB_PATH ??= ":memory:";

// ── 인자는 **맨 앞에서** 읽는다 — 아래 자동 재빌드가 `--no-build`를 봐야 하기 때문이다 ──
const 빌드끄기 = process.argv.includes("--no-build");
const 인자 = process.argv.slice(2).filter((a) => a !== "--no-build");

// ── 직접 실행일 때만 CLI로 돈다 ───────────────────────────────────────────────
// ⚠ 왜 갈랐나 (2026-09-05): 아래 `승인된겹침` 표를 **시험이 그대로 읽어야** 한다.
//   표를 시험에 베껴 두면 두 곳이 어긋나고, 어긋난 줄 아무도 모른다(이 저장소가 반복해 겪은
//   「같은 것을 여러 곳에 적으면 어긋난다」). 그런데 import만으로 재빌드(약 40초)가 돌거나
//   CLI가 답을 찍어 버리면 시험에서 못 부른다 — docs-drift.mjs와 같은 방식으로 진입점을 가른다.
const 직접실행 = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// ── ① 소스가 dist보다 새로우면 — **멈추지 말고 다시 빌드한다** ────────────────
// ★★ 왜 mtime을 다시 들였나 (실측 2026-09-04 · 9b7b9ac5)
//   아래 ②(`체인이소스와같나`)는 **dispatcher.ts의 체인 순서만** 글자로 대조한다. 그래서
//   datacard.ts처럼 **다른 소스**만 고치고 빌드를 안 하면 아무 말도 못 한다 — 그날 겹침이
//   9로 그대로 나왔고 경보도 없었다(사람이 `npm run build`를 손으로 하고서야 답이 바뀌었다).
//   낡은 dist를 설명하면 **겹침 표도 문서도 통째로 거짓**이 되는데, 그 사각을 ②는 원리상 못 본다.
// ⚠ 00b47a67에서 mtime을 뺀 이유는 **거짓 경보**였다(다른 세션이 registry.ts를 고쳐 「낡았다」).
//   그런데 그때 잘못은 mtime이 아니라 **거기서 멈춘 것**이다. 낡았으면 다시 빌드하면 되고,
//   거짓 경보의 값은 tsc 한 번(약 40초)뿐이다 — 틀린 설명을 믿는 값보다 훨씬 싸다.
// ⚠ 자산 복사(scripts/copy-assets.mjs)는 부르지 않는다 — 이 도구는 .js만 불러 쓴다.
function 낡은소스찾기() {
  const src뿌리 = path.join(뿌리, "server/src");
  const dist뿌리 = path.join(뿌리, "server/dist");
  if (!fs.existsSync(dist뿌리)) return ["server/dist가 통째로 없다"];
  const 낡은것 = [];
  const 훑기 = (디렉터리) => {
    for (const e of fs.readdirSync(디렉터리, { withFileTypes: true })) {
      const p = path.join(디렉터리, e.name);
      if (e.isDirectory()) { 훑기(p); continue; }
      // .d.ts는 tsc가 .js를 안 뽑는다 — 세면 **영원히 낡은** 상태가 된다.
      if (!e.name.endsWith(".ts") || e.name.endsWith(".d.ts")) continue;
      const js = path.join(dist뿌리, path.relative(src뿌리, p)).replace(/\.ts$/, ".js");
      const 짝 = fs.existsSync(js) ? fs.statSync(js).mtimeMs : -1;
      if (짝 < 0) 낡은것.push(`${path.relative(뿌리, p).replace(/\\/g, "/")} (빌드된 짝이 없다)`);
      else if (fs.statSync(p).mtimeMs > 짝) 낡은것.push(path.relative(뿌리, p).replace(/\\/g, "/"));
    }
  };
  훑기(src뿌리);
  return 낡은것;
}

function 목록몇줄(낡은것) {
  for (const f of 낡은것.slice(0, 5)) console.log(`     · ${f}`);
  if (낡은것.length > 5) console.log(`     · … 외 ${낡은것.length - 5}개`);
}

function 필요하면빌드() {
  const 낡은것 = 낡은소스찾기();
  if (!낡은것.length) return;
  if (빌드끄기) {
    // ⚠ 「경고만」은 **답을 믿지 말라는 뜻**이다 — 조용히 넘어가면 사각이 그대로 돌아온다.
    console.log(`\n  ⚠ 빌드가 소스보다 낡았을 수 있습니다(${낡은것.length}개) — --no-build라 그대로 답합니다.`);
    목록몇줄(낡은것);
    console.log("     (아래 설명은 **낡은 제품**의 것일 수 있습니다. 정확히 보려면 --no-build를 빼세요.)\n");
    return;
  }
  console.log(`\n  ⟳ 소스가 빌드보다 새롭습니다(${낡은것.length}개) — 먼저 빌드합니다(약 40초):`);
  목록몇줄(낡은것);
  // ⚠ `npx`로 부르지 않는다 — win에서 `npx.cmd`는 **spawnSync EINVAL로 즉사**한다
  //   (Node 20.12+/22+가 shell 없이 .cmd 실행을 막는다 · 실측 2026-09-04). shell:true로 우회하면
  //   따옴표 함정이 따라오므로, `npm run build`가 쓰는 **그 tsc**를 node로 직접 부른다.
  //   못 찾을 때만(다른 기계·미설치) npx로 물러선다.
  const 서버 = path.join(뿌리, "server");
  const 로컬tsc = path.join(서버, "node_modules/typescript/lib/tsc.js");
  const r = fs.existsSync(로컬tsc)
    ? spawnSync(process.execPath, [로컬tsc, "-p", "tsconfig.json"], { cwd: 서버, encoding: "utf8" })
    : spawnSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: 서버, encoding: "utf8", shell: true });
  if (r.status !== 0) {
    console.log("\n  ✗ 빌드에 실패했습니다 — 낡은 dist로 답하면 거짓 설명이 되므로 멈춥니다.");
    const 원문 = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || String(r.error?.message ?? "(출력 없음)");
    console.log(원문.split("\n").map((l) => `     ${l}`).join("\n"));
    console.log("");
    process.exit(2);
  }
  console.log("  ✓ 빌드 완료.\n");
}

// 도움말만 보는 길에서는 40초를 쓰지 않는다 — 부를 제품 함수가 없다.
// (시험이 표만 import할 때도 안 돈다 — 빌드는 **사람이 이 도구를 부를 때** 할 일이다.)
if (직접실행 && 인자.length) 필요하면빌드();

// ── ② 빌드가 지금 소스와 같은 체인인가 ─────────────────────────────────────────
// ⚠ 위 ①과 **겹치지 않는다**: ①은 「빌드를 했나」를 시각으로 재고, 여기는 「체인이 그대로인가」를
//   내용으로 잰다. 빌드를 갓 했어도 dispatchInstructionCore의 갈래를 옮겼거나 판별자를 갈면
//   `결정적도착지`(사본)와 어긋나는데, 그건 mtime으로는 원리상 못 본다.
// ⚠ 여기서는 시각(mtime)으로 재지 않는다 — 이 저장소는 두 세션이 같은 작업트리를 만지므로, 내가 안
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
    console.log("  (제품 함수로 잰 결과입니다 — 결정적 갈래 어디에도 안 걸립니다.)");
    // ★★ 2026-09-08 검토관 [중] — **이 도구가 못 보는 갈래가 하나 있다.**
    //   [37] 강제 도구의 꼬리(제목 지목)는 문서 목록을 **DB에서 조회해** 갈리는데, 이 도구는
    //   위에서 `GIJO_DB_PATH=:memory:`로 못박아 돌린다(유령 DB를 안 만들려고). 그래서 지목
    //   후보가 늘 0이고, 이름을 정확히 댄 물음도 여기로 떨어져 **「규칙 없음」이 거짓**이 된다.
    //   숨기지 않고 말한다 — 이 도구의 값은 「제품을 그대로 부른다」이지 「전지」가 아니다.
    console.log("  ⚠ 단, [37] 강제 도구의 **제목 지목** 갈래는 문서 목록(DB)에 달렸습니다 —");
    console.log("     이 도구는 빈 DB로 돌므로, 사내 문서 제목을 그대로 댄 말은 실제로 explain으로 갈 수 있습니다.\n");
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
// ⚠ 밀림은 **그 다음으로 걸리는 단계의 이름**이다 — 승인은 「이 앞/뒤 짝」에 대해서만 유효하다.
//   뒤엣것이 딴 것으로 바뀌었으면 사람이 다시 봐야 하므로, 아래 점검이 짝까지 대조한다.
// ★ 시험이 이 표를 그대로 읽는다(server/test/routeexplain.route.test.ts) — 표에 적은 「이김」이
//   실제 승자와 갈리면 거기서 빨간불이 난다. 그래서 이 표는 **베낀 사본이 아니라 단일 출처**다.
export const 승인된겹침 = [
  {
    말: "중복된 문서 있어?",
    이김: "지식베이스 정리",
    밀림: "강제 도구",
    이유: "정리 리포트가 중복 목록을 **포함해서** 답한다 — 사람이 원하는 답이 한 번에 나온다. " +
          "doc_duplicates만 따로 부르면 정리 맥락이 빠진 반쪽 답이 된다(2026-08-31 승인).",
    승인일: "2026-08-31",
    승인자: "(기록 없음 — 등록 당시 승인자를 안 적었다)",
  },

  // ── 2026-09-05 사장님 「추천안수용」 — 실전 152문항에서 나온 8건을 현 승자 그대로 승인 ──
  // 판단 기준 한 줄: **묻는 말이 조회면 조회로, 자리·방법을 물으면 안내로 간다.**
  //   담당자가 「알려줘」·「어디 있어?」라고 물었는데 제품이 점검을 새로 돌리거나 리포트를 한 장
  //   만들어 버리면, 시키지 않은 일을 한 것이다(2026-09-05 승인).
  {
    말: "웹서버 취약점만 보여줘",
    이김: "취약점 목록 고르기",
    밀림: "강제 도구",
    이유: "「보여줘」는 **목록 물음**이다 — 체크칸 목록이 나와야 바로 골라 조치로 넘어간다. " +
          "search는 문서를 찾아 주는 도구라 「어느 취약점을 고를까」에 답하지 못한다.",
    승인일: "2026-09-05",
    승인자: "사장님",
  },
  {
    말: "sample-web01 취약점만 보여줘",
    이김: "취약점 목록 고르기",
    밀림: "강제 도구",
    이유: "자산 이름이 앞에 붙어도 여전히 목록 물음이다 — 목록 답이 그 자산으로 걸러 준다. " +
          "이름이 있다고 search로 보내면 자산 화면이 아니라 문서를 뒤진다.",
    승인일: "2026-09-05",
    승인자: "사장님",
  },
  // ⚠ 2026-09-10 예행 ㉔ 수리로 아래 두 줄을 지웠다 — FORCED_INTENTS[3](run_hardening_scan)
  //   정규식에 「결과」 배제어를 넣어 애초에 안 겹치게 만들었다(승인 예외로 이기게 하는 대신
  //   규칙 자체를 좁혔다). 「하드닝 점검 결과 알려줘」·「보안설정 점검 결과 알려줘」는 이제
  //   [17] 검증(하드닝) 현황 **하나만** 걸린다 — routeexplain.route.test.ts가 이 사실을 잰다.
  {
    말: "리포트 정기적으로 자동 생성되게 하려면?",
    이김: "「○○ 하려면?」 방법 안내",
    밀림: "리포트 만들기",
    이유: "「…하려면?」은 **설정하는 법**을 묻는 말이다 — 리포트를 한 장 만들어 주면 " +
          "「정기적으로·자동」이라는 물음의 알맹이가 통째로 빠진다.",
    승인일: "2026-09-05",
    승인자: "사장님",
  },
  {
    말: "지난달 리포트 어디 있어?",
    이김: "「○○ 어디서 해?」 자리 안내",
    밀림: "강제 도구",
    이유: "「어디 있어?」는 **자리**를 묻는 말이다 — 리포트 화면 위치를 알려 주고 그 화면을 " +
          "열어 주는 것이 맞다. 목록만 뱉으면 「그래서 다음엔 어디로 가나」가 남는다.",
    승인일: "2026-09-05",
    승인자: "사장님",
  },
  {
    말: "터미널로 장비 접속하려면?",
    이김: "설정 켜는 법",
    밀림: "「○○ 하려면?」 방법 안내",
    이유: "터미널 접속은 **먼저 켜야 쓸 수 있는** 기능이다 — 켜는 순서를 건너뛴 화면 안내는 " +
          "「눌러도 안 되는」 길을 알려 주는 셈이 된다.",
    승인일: "2026-09-05",
    승인자: "사장님",
  },
  {
    말: "취약점",
    이김: "화면 이름 카드",
    밀림: "한 낱말만",
    이유: "「취약점」은 **화면 이름 그대로**다 — 이름을 아는 낱말까지 되물으면 한 번 더 " +
          "치게 만든다. 되묻기는 무슨 화면인지 모를 낱말에 쓸 자리다.",
    승인일: "2026-09-05",
    승인자: "사장님",
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
  const 짝어긋남 = [];
  const 본것 = new Set();
  for (const { 말, 걸림 } of 겹친것) {
    const k = `${말}|${걸림[0].이름}`;
    const 승인 = 승인집합.get(k);
    console.log(`  「${말}」${승인 ? "  (승인된 겹침)" : "  ← 새 겹침"}`);
    걸림.forEach((r, i) => console.log(`     ${i === 0 ? "▸ 이김" : "  밀림"}  [${String(r.차례).padStart(2)}] ${r.이름} → ${r.도착}${r.조건부 ? " (데이터 조건부)" : ""}`));
    if (승인) {
      console.log(`     이유: ${승인.이유}`);
      console.log(`     승인: ${승인.승인일} · ${승인.승인자}`);
      본것.add(k);
      // ⚠ 승인은 「이 앞/뒤 짝」에 대해서만 유효하다 — 뒤에 밀리던 것이 딴 것으로 바뀌었으면
      //   사람이 승인한 그 상황이 아니다(승인 문구가 조용히 헛것을 가리키게 된다).
      if (승인.밀림 && !걸림.slice(1).some((r) => r.이름 === 승인.밀림)) {
        짝어긋남.push(`「${말}」 표의 밀림=「${승인.밀림}」인데 지금은 ${걸림.slice(1).map((r) => `「${r.이름}」`).join("·")}`);
      }
    } else 새겹침.push({ 말, 걸림 });
  }
  const 낡은승인 = 승인된겹침.filter((a) => !본것.has(`${a.말}|${a.이김}`));
  if (낡은승인.length) {
    console.log("\n  ⚠ 승인 표가 낡았습니다 — 아래는 이제 안 겹치거나 승자가 바뀌었습니다.");
    console.log("     route-explain.mjs의 `승인된겹침`에서 지우거나 지금 승자로 고치세요:");
    for (const a of 낡은승인) console.log(`     · 「${a.말}」 (표의 이김: ${a.이김})`);
  }
  if (짝어긋남.length) {
    console.log("\n  ⚠ 승인한 짝이 아닙니다 — 이기는 쪽은 그대로인데 **밀리는 쪽**이 바뀌었습니다:");
    for (const x of 짝어긋남) console.log(`     · ${x}`);
    console.log("     (사람이 승인한 상황과 다르므로 표의 `밀림`을 고치고 이유를 다시 보세요.)");
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
  if (새겹침.length || 낡은승인.length || 짝어긋남.length) process.exitCode = 1;
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

// ⚠ 직접 실행일 때만 답을 찍는다 — 시험이 `승인된겹침`만 import할 때는 아무것도 안 돈다.
const 실행 = !직접실행 ? Promise.resolve()
  : 인자[0] === "--겹침" ? 겹침찾기()
  : 인자[0] === "--표" ? 표보이기()
  : 인자.length ? 설명(인자.join(" "))
  : (async () => {
      console.log("\n  쓰는 법:");
      console.log('    node tools/route-explain.mjs "오늘 뭐부터 해야 해?"');
      console.log("    node tools/route-explain.mjs --겹침");
      console.log("    node tools/route-explain.mjs --표\n");
      console.log("  소스가 빌드(server/dist)보다 새로우면 **알아서 다시 빌드**합니다(약 40초).");
      console.log("    --no-build  ← 빌드를 건너뛰고 「낡았을 수 있음」 경고만 봅니다\n");
    })();
실행.catch((e) => { console.error("\n  ✗ 실패:", e?.message ?? e, "\n"); process.exit(1); });
