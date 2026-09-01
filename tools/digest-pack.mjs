// tools/digest-pack.mjs — gb10 발췌를 **미리 만들어 프롬프트에 먹이는** 꾸러미 (2026-09-01 신설)
//
// ■ 왜 만들었나 (실측이 시킨 것)
//   워크플로 프롬프트에 「800줄 넘는 파일은 gb10 먼저 쓰라」고 적어 놨는데,
//   **120명 중 3명만 썼다**(2차 검토는 0명). 안내를 읽고도 그냥 Read로 갔고,
//   그 검토가 하위 에이전트 토큰 1,290만을 썼다.
//   → **고를 수 있게 두면 안 고른다.** 안내가 아니라 **구조**여야 한다.
//     이 도구가 발췌를 먼저 만들어 두면, 워크플로는 그 글을 **프롬프트에 박아** 넘긴다.
//     에이전트는 이미 손에 든 발췌를 쓰게 되고, 원문을 열지 안 열지는 그다음 문제가 된다.
//
// ■ 무엇을 하나 / 안 하나
//   · 한다: (파일, 질문) 짝들을 받아 gb10으로 **원문 그대로 발췌**하고 한 덩어리 글로 묶는다.
//   · 안 한다: 요약·재서술. 로컬 모델은 **줄 범위만 고르고** 본문은 원문을 그대로 자른다
//     (이 저장소의 실사고 주석 1,711건이 요약에 뭉개지면 함정을 두 번 밟는다).
//   · 안 한다: 조용한 폴백. gb10이 죽어 있으면 **크고 시끄럽게** 실패한다.
//
// 쓰는 법:
//   node tools/digest-pack.mjs --out <경로.md> --job '<JSON>'
//     JSON: [{"file":"server/src/x.ts","q":"무엇을 물을까"}, ...]
//   node tools/digest-pack.mjs --out p.md --commit <ref>      ← 그 커밋이 건드린 큰 파일 자동
//
// 워크플로에서:
//   1) 이 도구로 발췌 꾸러미를 만든다
//   2) 그 글을 읽어 각 검토 프롬프트 **안에** 넣는다
//   3) 에이전트는 「이미 발췌를 받았다」는 상태에서 시작한다
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const 값 = (이름) => {
  const i = argv.indexOf(이름);
  return i >= 0 ? argv[i + 1] : null;
};

const 나갈곳 = 값("--out");
if (!나갈곳) {
  console.error("--out <경로.md> 가 필요하다");
  process.exit(2);
}

/** 이 파일이 gb10을 쓸 만큼 큰가 — 작은 파일은 그냥 읽는 게 싸다. */
const 큰파일기준 = Number(값("--min") ?? 700);

function 줄수(경로) {
  try {
    return fs.readFileSync(경로, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

/**
 * 이 커밋이 그 파일에서 **실제로 건드린 이름들**을 뽑는다 — 질문을 여기서 만든다.
 *
 * ⚠⚠ 왜 이렇게까지 하나(2026-09-01 실측): 질문을 「이 커밋이 바꾼 자리를 보여라」처럼
 *   두루뭉술하게 쓰면 발췌가 **쓸모없어진다.** 같은 커밋에서
 *   handlers.ts(4,079줄) → **3줄**(너무 좁아 아무것도 안 나옴),
 *   screenguide.ts(1,567줄) → **804줄**(절반이라 줄인 뜻이 없음)이 나왔다.
 *   반면 「runVexStatus 함수 전체와 runEolCheck 함수 전체」처럼 **이름을 대니** 161줄이 나왔다.
 *   → 질문의 좋고 나쁨이 발췌의 전부다. 그러니 **사람이 짓지 말고 diff에서 뽑는다.**
 */
function 바뀐이름들(ref, file) {
  let diff = "";
  try {
    diff = execFileSync("git", ["show", "--no-color", "-U0", ref, "--", file], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch { return []; }
  const 이름 = new Set();
  for (const line of diff.split("\n")) {
    // ① hunk 머리의 문맥(@@ … @@ 뒤에 git이 붙여 주는 함수 이름)
    const h = line.match(/^@@[^@]*@@\s*(.+)$/);
    if (h) {
      for (const m of h[1].matchAll(/([A-Za-z_$가-힣][\w$가-힣]{2,})/g)) 이름.add(m[1]);
      continue;
    }
    // ② 더해진 줄에서 **선언된 이름**만 — 호출까지 모으면 이름이 수십 개가 되어 질문이 흐려진다
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const re of [
      /(?:export\s+)?(?:async\s+)?function\s+([\w$가-힣]+)/g,
      /(?:const|let|var)\s+([\w$가-힣]+)\s*[:=]/g,
      /^\+\s*([\w$가-힣]+)\s*\(/g,
    ]) {
      for (const m of line.matchAll(re)) if (m[1] && m[1].length > 2) 이름.add(m[1]);
    }
  }
  const 흔한말 = new Set(["const", "return", "await", "import", "export", "function", "true", "false", "null", "undefined", "string", "number", "boolean"]);
  return [...이름].filter((x) => !흔한말.has(x)).slice(0, 12);
}

/** 커밋이 건드린 파일 중 **큰 것만** 골라, diff에서 뽑은 이름으로 질문을 짓는다. */
function 커밋에서일감(ref) {
  const 목록 = execFileSync("git", ["show", "--name-only", "--format=", ref], { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.endsWith(".ts") || s.endsWith(".html"));
  const 일감 = [];
  for (const f of 목록) {
    const n = 줄수(f);
    if (n < 큰파일기준) continue;
    const 이름 = 바뀐이름들(ref, f);
    if (!이름.length) {
      // 이름을 못 뽑았으면 **그렇다고 말하고** 넘긴다 — 나쁜 질문으로 나쁜 발췌를 만드느니 낫다.
      일감.push({ file: f, q: null, 줄: n, 이유: "diff에서 바뀐 이름을 못 뽑았다 — 원문을 직접 읽어라" });
      continue;
    }
    일감.push({
      file: f,
      q: `다음 이름들의 **정의 전체**와, 그것을 부르는 자리를 보여라: ${이름.join(", ")}`,
      줄: n,
      이름수: 이름.length,
    });
  }
  return 일감;
}

let 일감;
const 잡 = 값("--job");
const 커밋 = 값("--commit");
if (잡) 일감 = JSON.parse(잡);
else if (커밋) 일감 = 커밋에서일감(커밋);
else {
  console.error("--job 또는 --commit 이 필요하다");
  process.exit(2);
}

if (!일감.length) {
  console.error(`발췌할 큰 파일이 없다(${큰파일기준}줄 기준) — 그냥 원문을 읽어라.`);
  fs.writeFileSync(나갈곳, `# gb10 발췌 꾸러미\n\n(${큰파일기준}줄 넘는 파일이 없어 발췌하지 않았다 — 원문을 직접 읽어라.)\n`);
  process.exit(0);
}

const 조각 = [];
let 성공 = 0;
let 실패 = [];
let 원본줄합 = 0;
let 발췌줄합 = 0;

/** 이 커밋이 그 파일에서 **실제로 바꾼 줄 번호들**(바뀐 뒤 기준). */
function 바뀐줄번호(ref, file) {
  let diff = "";
  try {
    diff = execFileSync("git", ["show", "--no-color", "-U0", ref, "--", file], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch { return []; }
  const 줄 = [];
  let 현재 = 0;
  for (const l of diff.split("\n")) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) { 현재 = Number(h[1]); continue; }
    if (l.startsWith("+") && !l.startsWith("+++")) { 줄.push(현재); 현재++; }
    else if (!l.startsWith("-") && !l.startsWith("\\")) 현재++;
  }
  return 줄;
}

/**
 * 발췌를 꾸러미에 담는다 — **바뀐 줄이 하나도 안 담겼으면 크게 알린다.**
 *
 * ⚠⚠ 발췌가 나왔다는 것과 **검토에 쓸 만하다**는 것은 다르다(2026-09-01 완결성 비평 [상]).
 *   이름은 diff에서 뽑았는데 그 이름의 **정의부만** 담기고 이 커밋이 바꾼 줄이 빠지면,
 *   검토관은 「봤다」고 믿으면서 정작 커밋이 한 일을 못 본다 — 안 보는 것보다 나쁘다.
 */
function 담기(j, 원줄수, out, 머리말) {
  const 발췌줄 = out.split("\n").length;
  발췌줄합 += 발췌줄;
  let 경고 = 머리말;
  // ⚠ --job 모드에서도 커밋을 알면 담긴 비율을 잰다 — 보충 꾸러미가 바로 그 모드다
  //   (2026-09-01 완결성 비평 [중]: 정직 표시가 --job에선 통째로 꺼져 있었다).
  const 기준커밋 = 커밋 || 값("--ref");
  if (기준커밋) {
    const 담긴 = new Set();
    for (const m of out.matchAll(/^(\d+)\t/gm)) 담긴.add(Number(m[1]));
    const 바뀐 = 바뀐줄번호(기준커밋, j.file);
    const 겹침 = 바뀐.filter((x) => 담긴.has(x)).length;
    if (바뀐.length && 겹침 === 0) {
      경고 = `⚠⚠ **이 발췌에는 이 커밋이 바꾼 줄이 하나도 없다**(바뀐 줄 ${바뀐.length}개) — 질문이 빗나갔다. 원문을 직접 읽어라.\n${경고}`;
      실패.push(`${j.file}: 발췌에 바뀐 줄이 0개 — 원문을 직접 읽어라`);
    } else if (바뀐.length) {
      경고 = `(이 커밋이 바꾼 ${바뀐.length}줄 중 ${겹침}줄이 발췌에 담겼다)\n${경고}`;
    }
  }
  조각.push(
    `## ${j.file} (원문 ${원줄수}줄 → 발췌 ${발췌줄}줄)\n\n물음: ${j.q}\n${경고 ? 경고 + "\n" : ""}\n\`\`\`\n${out.trim()}\n\`\`\``,
  );
  성공++;
  process.stderr.write(`${발췌줄}줄\n`);
}

for (const j of 일감) {
  const n = j.줄 ?? 줄수(j.file);
  원본줄합 += n;
  if (!j.q) {
    // 질문을 못 지었으면 **발췌하지 않는다.** 나쁜 질문은 나쁜 발췌를 만들고,
    // 나쁜 발췌는 「봤다」는 착각을 준다 — 그게 안 보는 것보다 나쁘다.
    조각.push(`## ${j.file} (원문 ${n}줄)\n\n⚠ **발췌하지 않았다** — ${j.이유}`);
    실패.push(`${j.file}: ${j.이유}`);
    process.stderr.write(`gb10 발췌: ${j.file} (${n}줄) … 건너뜀(${j.이유})\n`);
    continue;
  }
  process.stderr.write(`gb10 발췌: ${j.file} (${n}줄, 이름 ${j.이름수}개) … `);
  try {
    const out = execFileSync("node", ["tools/local-digest.mjs", "file", j.file, j.q], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 300000,
    });
    담기(j, n, out, "");
  } catch (e) {
    // ⚠⚠ **일부만 못 본 발췌를 통째로 버리지 않는다**(2026-09-01 완결성 비평 [중]).
    //   앞 커밋에서 local-digest가 「조각 하나를 못 읽었다」를 알리려고 **종료코드 1**을 내게
    //   했는데, execFileSync는 그걸 예외로 던지므로 여기서 **쓸 만한 발췌가 통째로 날아갔다** —
    //   정직하게 알리려고 만든 장치가 그 정보를 버리게 만든 셈이다.
    //   → 표준출력에 내용이 있으면 **살려 쓰되 「일부만 봤다」고 크게 적는다.**
    const 살릴것 = String(e.stdout ?? "").trim();
    if (살릴것) {
      담기(j, n, 살릴것, "⚠ **이 발췌는 파일의 일부만 본 것이다**(gb10이 일부 구간을 못 읽었다). 아래 머리글의 「못 본 구간」을 보고, 중요하면 원문을 열어라.");
      실패.push(`${j.file}: 일부 구간을 못 읽음(발췌는 살려 담았다)`);
      process.stderr.write(`일부만\n`);
    } else {
      // ⚠ **조용한 폴백 금지.** 살릴 것이 없으면 실패라고 적고, 원문을 읽으라고 말한다.
      실패.push(`${j.file}: ${String(e.message ?? e).slice(0, 120)}`);
      조각.push(`## ${j.file} (원문 ${n}줄)\n\n⚠ **gb10 발췌 실패** — 이 파일은 원문을 직접 읽어라.\n오류: ${String(e.message ?? e).slice(0, 200)}`);
      process.stderr.write(`실패\n`);
    }
  }
}

const 머리 = [
  "# gb10 발췌 꾸러미 (Qwen3-Coder-30B-A3B · 원문 그대로)",
  "",
  "⚠ 아래는 **원문을 그대로 자른 것**이지 요약이 아니다 — 줄 번호가 붙어 있다.",
  "⚠ 발췌는 **물음에 맞는 구간만** 담는다. 여기 없는 것이 없다는 뜻은 아니다 —",
  "  판단에 더 필요하면 그 파일을 직접 열어라(다만 통째로 열기 전에 여기를 먼저 보라).",
  "",
  // ⚠ **「성공/실패」로 나누어 세지 않는다**(2026-09-01 4차 검토 [중]). 둘은 배타가 아니다 —
  //   발췌가 붙었는데 「바뀐 줄이 0개」인 파일은 **담기기도 하고 경고도 받는다.** 그걸
  //   성공 3 + 실패 3 = 5파일처럼 적으면 읽는 사람이 셈을 못 맞춘다.
  //   → **담긴 것**과 **주의할 것**을 따로, 겹칠 수 있다고 밝힌다.
  `파일 ${일감.length}개 · 발췌 담김 ${성공} · **주의 ${실패.length}건**(담긴 파일도 주의를 받을 수 있다) · 원문 ${원본줄합}줄 → 발췌 ${발췌줄합}줄` +
    (원본줄합 ? ` (${(원본줄합 / Math.max(1, 발췌줄합)).toFixed(1)}× 줄임)` : ""),
  실패.length ? `\n⚠ 주의 — 이 파일들은 원문을 직접 읽어라:\n${실패.map((x) => `  · ${x}`).join("\n")}` : "",
  "",
].join("\n");

fs.writeFileSync(나갈곳, 머리 + "\n" + 조각.join("\n\n"));
console.log(`${나갈곳} — 파일 ${일감.length}개 · 원문 ${원본줄합}줄 → 발췌 ${발췌줄합}줄 · 실패 ${실패.length}`);
if (실패.length) process.exit(1); // 실패를 조용히 넘기지 않는다
