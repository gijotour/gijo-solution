// tools/local-digest.mjs — gb10 로컬 LLM으로 **Claude 입력을 줄이는** 창구.
// 어느 모델인지는 아래 `두뇌들`이 단일 출처다(GIJO_DIGEST_BRAIN으로 고름) — 여기에 이름을 박지 말 것.
// (하이브리드 설계서 §6-⑴ · 1주차 게이트 통과 실측: 발췌 20/20 · 생성 69.8 tok/s · 압축 ~45×)
//
// ■ 무엇을 아끼나 (2026-08-27 사장님 「gb10으로 토큰 줄일 수 있는 거 있으면 해줘 — 검토관·소스관리·검사 등」)
//   이 저장소에서 Claude 토큰을 먹는 두 자리:
//   ① 큰 파일 통째 읽기(2,000줄급) → `file` 모드가 관련 줄만 원문으로 돌려준다
//   ② 검토관이 diff·파일을 전부 읽는 것 → `review` 모드가 의심 지점을 1차 선별한다
//
// ■ 지키는 선 (설계서 §3·§4 — 어기면 아낀 것보다 재작업이 비싸진다)
//   · 로컬 모델은 **어느 줄을 볼지 고르기만** 한다. 본문은 기계가 원문을 자른다(재서술 금지 —
//     실사고 주석 1,711건이 요약에 뭉개지면 함정을 두 번 밟는다).
//   · `review`는 **1차 선별이지 판정이 아니다.** 출력마다 「후보」라 박는다. 확정은 Claude/사람이
//     그 지점을 직접 열어 한다 — CLAUDE.md 「검토관 모델을 내리면 그럴듯한데 틀린 지적이 는다」는
//     그대로 유효하고, 이 도구는 검토관을 **대체하지 않고 읽을 양을 줄인다.**
//   · gb10이 죽어 있으면 **크고 시끄럽게** 실패한다(조용한 폴백 금지) — 그때는 그냥 원문을 읽는다.
//
// ■ 전송: win → ssh gb10 → localhost:$GIJO_DIGEST_PORT (llama-server는 루프백만 열려 있다 — WireGuard에
//   포트를 더 열지 않는다). 요청 JSON은 stdin 파이프라 한글·따옴표 안전.
//   ⚠ 서버는 --parallel 1로 떠 있어야 한다(2가 되면 ctx 반토막 — hybrid-probe.mjs 머리주석 실사고).
//
// 사용:
//   node tools/local-digest.mjs file <경로> "<질문>"     ← 관련 줄만 원문 발췌
//   node tools/local-digest.mjs review [커밋]            ← diff 의심 지점 1차 선별(기본 HEAD)
//   node tools/local-digest.mjs log <경로> "<질문>"      ← 긴 로그에서 관련 줄 발췌
//   node tools/local-digest.mjs up                       ← gb10 서버 상태/기동
import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const 이파일 = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(이파일), "..");
const [mode, 대상, 질문] = process.argv.slice(2);

// ── 어느 두뇌를 쓰나 ─────────────────────────────────────────────────────────
// 포트와 「그 포트를 띄우는 명령」은 **짝이다.** 전엔 포트만 바꿔 놓고 기동 명령은
// 옛것을 그대로 둬서, `up` 한 번이면 조용히 딴 모델이 딴 포트에 떴다(반쪽 수리).
// 그래서 여기서 둘을 함께 정한다. GIJO_DIGEST_BRAIN 으로 고른다.
const 두뇌들 = {
  // 2026-09-01부터 기본. 125B MoE(6B 활성) — 24.5 tok/s로 coder-30b(67)보다 느리지만
  // 답이 2.2배 상세하고, 무엇보다 coder-30b와 **동시에 못 올린다**(둘 다 올리면 여유 7GiB).
  // ⚠ 생각하는 모델이라 --reasoning off 가 없으면 토큰을 전부 생각에 쓰고 답이 0자로 나온다.
  // 2026-09-01부터 기본. 125B MoE(6B 활성) — 24.5 tok/s로 coder-30b(67)보다 느리지만 답이 2.2배 상세하다.
  // ★ **제품(node dist/index.js)이 8080에서 직접 관리한다** — 손으로 띄우지 마라.
  //   app_state.defaultModelId = qwen38-flash-next 라 node가 뜨면 자동으로 올라온다.
  //   ⚠ 여기 기동 명령은 **node가 죽어 있을 때의 비상용**이다. node가 살아 있는데 이걸 쓰면
  //     8080이 이미 잡혀 있어 실패하고, node를 재기동하면 reapOrphanEngines가 죽인다.
  "qwen38": {
    port: 8080,
    이름: "Qwen3.8-Flash-Next 125B-A6B",
    // ⚠ **슬롯당** 문맥이다(전체 아님). 제품이 --parallel 2로 띄우므로 32768÷2 = 16384다.
    //   전체 ctx를 적으면 조각이 두 배로 커져 400이 난다(2026-09-02에 실제로 밟았다).
    슬롯문맥: 16384,
    기동: "cd ~/gijo-as/server && nohup node dist/index.js >> /tmp/gijo-server.log 2>&1 & sleep 1",
  },
  // 예전 기본. 3배 빠르니 「빨리 훑기」가 필요하면 GIJO_DIGEST_BRAIN=coder30 로 쓴다.
  "coder30": {
    port: 8082,
    이름: "Qwen3-Coder-30B-A3B",
    슬롯문맥: 65536, // --parallel 1이라 전체가 곧 슬롯이다
    기동: "cd ~/gijo-as/server && nohup llama.cpp/build/bin/llama-server" +
      " -m models/qwen3-coder-30b-a3b/qwen3-coder-30b-a3b.gguf -ngl -1 --ctx-size 65536" +
      " --parallel 1 --port 8082 --jinja >> /tmp/qwen3coder2.log 2>&1 & sleep 1",
  },
};
const 두뇌 = 두뇌들[process.env.GIJO_DIGEST_BRAIN ?? "qwen38"] ?? 두뇌들.qwen38;
const DIGEST_PORT = 두뇌.port;

// ── gb10 창구 ────────────────────────────────────────────────────────────────
// ⚠⚠ **실패 이유를 버리고 있었다**(2026-09-05 실사고 · 수리).
//   큰 파일 발췌가 「⚠ 조각 786~1181 실패: ssh 실패:」 **한 줄만** 내고 400줄을 통째로 버렸다.
//   원인이 안 적힌 게 아니라 **원인 자체를 버렸다** — curl에 `-s`(silent)가 붙어 있어 curl이
//   제 실패 이유를 stderr에 한 글자도 안 쓴다. 그래서 (r.stderr || "")가 빈 문자열이 되고
//   문구가 「ssh 실패: 」로 끝난다. 실측 재현(2026-09-05):
//     · `-s  --max-time 1` → status 28 · stderr **0바이트** → 문구 「ssh 실패: 」  ← 옛 모습
//     · `-sS --max-time 1` → status 28 · stderr 77바이트 "curl: (28) Operation timed out …"
//   ★ 이 파일의 첫 원칙이 「조용한 폴백 금지」인데, 정작 **실패의 이유**를 조용히 버렸다.
//   ⚠ 문맥 초과(400)는 여기 안 온다 — 그건 status 0에 JSON 본문으로 온다(실측: 35,703토큰
//     요청 → {"error":{"code":400,…"exceed_context_size_error"}}). 그래서 아래 j.error가 잡는다.
const CURL_뜻 = {
  6: "호스트 이름을 못 찾음",
  7: "붙지 못함 — llama-server가 안 떠 있다",
  22: "HTTP 오류",
  28: "시간 초과(--max-time) — 두뇌가 다른 요청에 물렸거나 조각이 너무 크다",
  52: "서버가 빈 응답 — 요청 도중 llama-server가 내려갔나(제품이 모델을 갈아끼웠을 수 있다)",
  56: "받는 중 연결이 끊김",
  255: "ssh 자체가 실패 — WireGuard·키·호스트를 본다",
};
/** spawnSync 결과를 **빈 문구가 될 수 없는** 한 줄로 옮긴다. */
export function 실패설명(r) {
  const 조각 = [];
  if (r.error) 조각.push("spawn 오류 " + (r.error.code ?? r.error.message));
  if (r.signal) 조각.push("신호 " + r.signal + "로 죽음");
  if (r.status !== 0 && r.status !== null && r.status !== undefined) {
    조각.push("종료코드 " + r.status + (CURL_뜻[r.status] ? " = " + CURL_뜻[r.status] : ""));
  }
  const 에 = (r.stderr || "").trim();
  if (에) 조각.push("stderr: " + 에.slice(0, 300));
  // ⚠ **여기가 비면 옛 「ssh 실패: 」가 그대로 돌아온다.** 마지막 그물을 둔다.
  if (!조각.length) 조각.push("설명 없음(status=" + JSON.stringify(r.status) + " · stderr 0바이트) — 그 자체를 적는다");
  return 조각.join(" · ");
}
/** 다시 하면 될 수 있는 실패인가. 문맥 초과·스키마 오류는 여기 오지 않는다(status 0). */
export function 다시해볼만한가(r) {
  return [7, 28, 52, 56, 255].includes(r.status) || !!r.error || !!r.signal;
}
const 최대시도 = Math.max(1, Number(process.env.GIJO_DIGEST_RETRY ?? 3));
const 제한초 = Math.max(10, Number(process.env.GIJO_DIGEST_TIMEOUT ?? 300));
// ssh를 **말없이 오래 매달리게 두지 않는다**: 비밀번호 프롬프트 금지(BatchMode)·붙는 데 10초·
//   끊긴 연결은 살아있는지 물어 15초×4에 포기. WireGuard RTT 70~106ms라 blip이 실제로 난다.
const SSH옵션 = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];
const 잠깐 = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* 못 자면 그냥 간다 */ } };

function gb10Chat(prompt, schema, nPredict) {
  const body = {
    model: "local",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: nPredict ?? 512,
  };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "out", strict: true, schema } };
  // ⚠ 본문은 **stdin으로만** 보낸다(--data-binary @-). argv에 실으면 명령줄 길이 한계(ARG_MAX)에
  //   걸리는데, 조각이 17,000자급이라 언제든 닿는다. 지금은 argv에 짧은 curl 한 줄뿐이다.
  const 보낼것 = JSON.stringify(body);
  let 마지막 = "";
  for (let 시도 = 1; 시도 <= 최대시도; 시도++) {
    const r = spawnSync("ssh", [...SSH옵션, "gb10", `curl -sS --max-time ${제한초} -X POST http://localhost:${DIGEST_PORT}/v1/chat/completions -H 'content-type: application/json' --data-binary @-`],
      { input: 보낼것, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: (제한초 + 60) * 1000 });
    if (r.status === 0) {
      let j;
      try { j = JSON.parse(r.stdout); } catch { throw new Error("gb10 응답이 JSON이 아님(서버 죽음?): " + String(r.stdout).slice(0, 200)); }
      if (j.error) throw new Error("llama-server 오류: " + JSON.stringify(j.error).slice(0, 300));
      return j.choices?.[0]?.message?.content ?? "";
    }
    마지막 = 실패설명(r);
    if (!다시해볼만한가(r) || 시도 === 최대시도) break;
    console.error("  ↻ gb10 재시도 " + 시도 + "/" + (최대시도 - 1) + " — " + 마지막);
    잠깐(2000 * 시도);
  }
  throw new Error("gb10 호출 실패(" + 최대시도 + "회 시도) — " + 마지막);
}

function 서버확인() {
  const r = spawnSync("ssh", [...SSH옵션, "gb10", `curl -sS --max-time 5 http://localhost:${DIGEST_PORT}/health`], { encoding: "utf8", timeout: 30000 });
  if (!/ok/.test(r.stdout || "")) { 서버확인.마지막실패 = 실패설명(r); return false; }
  return true;
}

// ── 공통: 줄범위 발췌 (hybrid-probe 검증 패턴 — 20/20) ──────────────────────────
const RANGE_SCHEMA = {
  type: "object",
  properties: {
    ranges: { type: "array", items: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 }, minItems: 0, maxItems: 12 },
  },
  required: ["ranges"],
};

// 큰 파일은 겹침 분할(프로브 실사고: 2,000줄급이 슬롯 ctx를 넘으면 400) — 조각마다 묻고 범위 병합.
//
// ⚠⚠ **줄이 아니라 글자로 자른다**(2026-09-01 실측으로 고침).
//   1,500줄 고정이었는데 **한글이 많은 파일에서 ctx를 넘겼다** — screenguide.ts의 1,500줄이
//   66,597토큰이라 65,536을 초과해 **조각 하나가 통째로 날아갔다.** 줄 수는 토큰 수를 못 재는
//   자다: 같은 1,500줄이 screenguide 102,719자 / handlers 68,261자로 **1.5배 차이**가 난다
//   (한글 비율 45% vs 21%). 줄로 자르면 한글 많은 파일만 조용히 실패한다.
//   실측 비율 1.54자/토큰 기준, 안전 예산 50,000토큰 ≈ 77,000자로 잡는다(ctx 65,536의 76%).
//
// ⚠⚠ **두뇌에서 계산한다**(2026-09-02에 또 밟고 고침). 상수 70,000을 박아 두었더니
//   두뇌를 coder-30b(ctx 65,536) → Qwen3.8(슬롯 16,384)로 바꾸는 순간 조각이 ctx의 4배가 되어
//   **파일 하나가 통째로 실패**했다. 「모델을 바꾸면 같이 움직여야 하는 값」을 상수로 두면
//   바꾸는 사람이 반드시 잊는다 — 그래서 두뇌 정의에서 끌어온다.
// ⚠ **자/토큰 비율은 1.54를 쓴다**(가장 나쁜 경우). 같은 70,000자가 한글 많은 파일에선
//   45,000토큰, ASCII 많은 파일에선 19,600토큰이었다 — 2.3배 차이다. 넉넉한 쪽으로 잡으면
//   조각이 많아질 뿐이지만, 모자라게 잡으면 **조용히 통째로 날아간다.**
const 자당토큰 = 1.54;   // 한글 많은 파일 실측(가장 나쁜 경우)
const 입력몫 = 0.70;      // 나머지는 답·프롬프트 몫
export const 조각글자수 = Math.floor(두뇌.슬롯문맥 * 입력몫 * 자당토큰);
export const 겹침줄 = 150;

/** 줄 배열을 **글자 예산에 맞춘 조각**들로 나눈다 — [시작(0기준), 끝(미포함)] 목록.
 *  ⚠ 순수 함수로 꺼내 둔 이유: 조각 나누기가 틀리면 gb10을 부르기도 전에 실패가 예약된다.
 *    실호출 없이 예산·덮임을 시험으로 잰다(server/test/localdigest.test.ts). */
export function 조각나누기(lines, 예산 = 조각글자수, 겹침 = 겹침줄) {
  const 조각끝 = (시작) => {
    let 글자 = 0;
    for (let i = 시작; i < lines.length; i++) {
      글자 += lines[i].length + 1;
      if (글자 > 예산) return Math.max(시작 + 1, i); // 최소 한 줄은 담는다
    }
    return lines.length;
  };
  const 목록 = [];
  for (let s = 0; s < lines.length; ) {
    const e = 조각끝(s);
    목록.push([s, e]);
    if (e >= lines.length) break;
    s = Math.max(s + 1, e - 겹침); // 겹쳐서 다음 조각 — 경계에 걸친 함수를 놓치지 않는다
  }
  return 목록;
}

// ⚠ 조각 하나가 실패했다고 **수백 줄을 통째로 버리지 않는다**(2026-09-05 수리).
//   옛 코드는 실패한 조각을 그대로 「못 본 구간」에 넣고 끝냈다 — 실측 사고에서 396줄이
//   한 번에 날아갔다. 실패 이유의 상당수가 「크거나 오래 걸려서」(시간 초과·문맥 초과)라
//   **반으로 자르면 대개 통과한다.** 실측(2026-09-05): 조각 하나가 찬 두뇌에서 18.9초 ·
//   같은 프롬프트 재요청 1.3초 · 제한 300초는 15배 여유다 → 제한에 걸렸다면
//   「원래 그만큼 걸린다」가 아니라 **크기·대기** 문제다.
const 최소조각줄 = Number(process.env.GIJO_DIGEST_MIN_LINES ?? 40); // 이 밑으로는 안 쪼갠다
const 최대분할 = Number(process.env.GIJO_DIGEST_MAX_SPLIT ?? 3);    // 무한 분할 금지

function 발췌(경로, 물음) {
  const abs = path.isAbsolute(경로) ? 경로 : path.join(ROOT, 경로);
  const src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");
  // ⚠ **못 본 조각을 세어 둔다.** 예전에는 실패를 stderr 경고로만 흘리고 종료코드 0을 냈다.
  //   그러면 이 발췌를 받아 쓰는 쪽(digest-pack·워크플로)은 **다 봤다고 믿는다** —
  //   실제로는 파일의 일부를 아예 안 본 발췌인데도. 2026-09-01 screenguide.ts에서 그랬고,
  //   꾸러미가 「실패 0」이라고 적었다. 조용한 폴백 금지가 이 파일의 첫 원칙인데 어겼다.
  const 못본조각 = [];
  const 전체범위 = [];
  /** 조각 하나를 묻는다. 실패하면 **반으로 잘라 다시** 묻고, 그래도 안 되면 못 본 것으로 적는다. */
  const 조각묻기 = (s, e, 깊이 = 0) => {
    const 번호원문 = lines.slice(s, e).map((l, i) => `${s + i + 1}\t${l}`).join("\n");
    const prompt =
      `아래는 줄번호가 붙은 파일 일부다(${s + 1}~${e}줄/총 ${lines.length}줄). 질문에 답하는 데 필요한 부분의 **줄 범위**만 골라라.\n` +
      `내용을 요약하거나 다시 쓰지 마라 — 줄 범위 선택만. 관련이 없으면 빈 배열.\n\n질문: ${물음}\n\n파일 ${경로}:\n${번호원문}`;
    try {
      const out = JSON.parse(gb10Chat(prompt, RANGE_SCHEMA, 256));
      for (const [a, b] of out.ranges || []) if (a >= s + 1 && b <= e) 전체범위.push([a, b]);
      return;
    } catch (e2) {
      const 반 = Math.floor((s + e) / 2);
      // 더 못 쪼개는 자리에서만 「못 봤다」로 적는다 — 그 전에는 반씩 다시 묻는다.
      if (깊이 >= 최대분할 || e - s <= 최소조각줄 || 반 <= s || 반 >= e) {
        못본조각.push([s + 1, e]);
        console.error(`⚠ 조각 ${s + 1}~${e} 실패(더 못 쪼갬 · 깊이 ${깊이}): ${e2.message}`);
        return;
      }
      console.error(`⚠ 조각 ${s + 1}~${e} 실패 → 반으로 잘라 다시 묻는다(깊이 ${깊이 + 1}): ${e2.message}`);
      조각묻기(s, 반, 깊이 + 1);
      조각묻기(반, e, 깊이 + 1);
    }
  };
  for (const [s, e] of 조각나누기(lines)) 조각묻기(s, e);
  // 병합·출력 — 본문은 **기계가 원문을 자른다**
  전체범위.sort((x, y) => x[0] - y[0]);
  const 병합 = [];
  for (const r of 전체범위) {
    const last = 병합[병합.length - 1];
    if (last && r[0] <= last[1] + 3) last[1] = Math.max(last[1], r[1]);
    else 병합.push([...r]);
  }
  const 총 = 병합.reduce((a, [x, y]) => a + (y - x + 1), 0);
  // ⚠ 못 본 구간을 **머리글에 적는다** — 받는 쪽이 읽는 첫 줄이라 여기 없으면 못 본 것이 된다.
  const 못본줄 = 못본조각.reduce((a, [x, y]) => a + (y - x + 1), 0);
  console.log(
    `# ${경로} — ${lines.length}줄 중 ${총}줄 발췌 (${병합.length}구간 · gb10 ${두뇌.이름} · 원문 그대로)` +
      (못본조각.length
        ? `
# ⚠⚠ **못 본 구간이 있다** — ${못본조각.length}조각 ${못본줄}줄(${못본조각.map(([x, y]) => `${x}~${y}`).join(", ")})을 gb10이 못 읽었다.
` +
          "# 이 발췌는 **파일 전체를 본 것이 아니다** — 그 구간이 중요하면 원문을 직접 읽어라."
        : ""),
  );
  for (const [a, b] of 병합) {
    console.log(`\n── ${a}~${b}줄 ──`);
    console.log(lines.slice(a - 1, b).map((l, i) => `${a + i}\t${l}`).join("\n"));
  }
  if (!병합.length) console.log("(관련 구간 없음 — 질문을 좁히거나 원문을 직접 읽어라)");
  // ⚠ **실패는 종료코드로도 말한다.** 글로만 적으면 자동으로 엮는 쪽(digest-pack)이 못 알아챈다.
  if (못본조각.length) process.exitCode = 1;
}

// ── review: diff 1차 선별 ────────────────────────────────────────────────────
const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      // ⚠ 8건 — 예산(max_tokens)과 **함께** 정해야 하는 값이다. 15건일 때 1024토큰으로는
      //   출력이 잘려 JSON이 깨졌고, 그래서 이 모드는 **한 번도 성공한 적이 없었다**(2026-08-31).
      type: "array", maxItems: 8,
      items: {
        type: "object",
        // ⚠ **defect(참/거짓)를 필수로 둔다**(2026-08-31). 문구로 거르려 했더니 모델이
        //   말만 바꿔 빠져나갔다(「결함이 없으며」→「따라서 …」). 이 저장소의 오래된 교훈
        //   그대로다 — **모델을 프롬프트로 교정하지 말고 코드로 해결한다.** boolean은 못 돌린다.
        required: ["file", "quote", "why", "defect"],
        properties: {
          file: { type: "string" },
          // ⚠ **길이를 스키마로 묶는다**(2026-08-31). 산문이 길어 출력이 예산을 넘으면 JSON이
          //   잘려 조각 전체가 날아간다 — 실측으로 두 번 겪었다. 「짧게 써 달라」는 부탁이
          //   아니라 **maxLength로 못 박는 것**이 코드로 해결하는 방식이다.
          quote: { type: "string", maxLength: 160, description: "diff에서 그대로 복사한 한 줄(재서술 금지)" },
          why: { type: "string", maxLength: 140, description: "왜 의심되나 **한 문장**(한국어, 140자 안)" },
          kind: { type: "string", enum: ["logic", "leftover", "mismatch", "contract", "type", "other"] },
          defect: { type: "boolean", description: "정말 결함이라고 보는가. 아니면 false — false는 버려진다." },
        },
      },
    },
  },
  required: ["findings"],
};

function 리뷰(커밋) {
  // --wip = 아직 커밋 안 한 변경(working tree vs HEAD) — 커밋 전에 1차 선별을 돌리라고 있다.
  //   (만든 날 실측: git show 기반이라 미커밋을 못 봤다 — 커밋 후에야 선별이 가능했던 한계.)
  const ref = 커밋 || "HEAD";
  const diff = ref === "--wip"
    ? execFileSync("git", ["diff", "--no-color", "HEAD"], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    : execFileSync("git", ["show", "--no-color", ref], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (!diff.trim()) { console.log(`# ${ref} — 변경 없음`); return; }
  // ⚠⚠ **지워진 줄을 아예 안 보여 준다**(2026-09-01 실측으로 고침).
  //   diff를 통째로 주면 모델이 `-` 줄(방금 고친 **옛 결함**)을 읽고 그것을 결함으로 올린다.
  //   수리 커밋에서 특히 심하다 — ea8dc515 선별에서 후보 8건이 **전부** 「고쳤지만 이전에는
  //   문제가 있었다」였다. 커밋 메시지를 되풀이한 것이지 결함을 찾은 게 아니다.
  //   「옛 코드는 보지 마라」고 **부탁하면 안 지킨다** — 이 저장소의 오래된 교훈대로
  //   **코드로 해결한다**: 지워진 줄을 물리적으로 빼서 볼 수가 없게 만든다.
  //   (남는 것은 새 코드 `+`와 둘레 문맥 — 「지금 코드에 남아 있는 결함」만 볼 수 있다.)
  const 줄바꿈 = String.fromCharCode(10);
  const 새코드만 = diff
    .split(줄바꿈)
    .filter((l) => !(l.startsWith("-") && !l.startsWith("---")))
    .join(줄바꿈);
  // ⚠⚠ **두뇌에서 계산한다** — 상수 60,000을 박아 두었더니 두뇌가 coder-30b(슬롯 65,536)에서
  //   Qwen3.8(슬롯 **16,384**)로 바뀌는 순간 조각 하나가 슬롯의 두 배를 넘어 `review` 모드가
  //   **전 조각 400으로 죽었다**(2026-09-03 갈래 D 검토에서 확인). 위 발췌 몫(입력몫 0.70)이
  //   이미 같은 사고를 한 번 겪고 두뇌 계산으로 옮겼는데, 이 줄만 남아 있었다 — 「모델을 바꾸면
  //   같이 움직여야 하는 값」을 상수로 두면 바꾸는 사람이 반드시 잊는다는 것의 두 번째 실증이다.
  // ⚠ **입력 몫이 발췌(0.70)보다 작다**: review는 답이 훨씬 크다 — 스키마 예산 3,072토큰에
  //   프롬프트 머리글·잘림 재시도 몫까지 같은 슬롯에서 나눠 쓴다. 그래서 입력은 0.40만 준다
  //   (16,384 슬롯 기준 ≈ 6,553토큰 ≈ 10,092자 · coder30이면 ≈ 40,370자). 모자라면 조각이
  //   많아질 뿐이지만, 넘치면 **조각이 통째로 날아간다**(위 발췌 주석과 같은 이유).
  const 검토입력몫 = 0.40;
  const 조각크기 = Math.floor(두뇌.슬롯문맥 * 검토입력몫 * 자당토큰); // 문자 기준(자당토큰=1.54는 한글 많은 파일 실측)
  const all = [];
  let 실패조각 = 0;
  let 버린수 = 0; // 스스로 「결함 없다」고 적은 후보 — 숫자를 정직하게 밝힌다
  for (let i = 0; i < 새코드만.length; i += 조각크기) {
    const 부분 = 새코드만.slice(i, i + 조각크기);
    const prompt =
      `아래는 git 커밋의 **바뀐 뒤 코드**다(지워진 줄은 빼 놓았다 — 옛 코드는 볼 수 없다).\n` +
      `**지금 이 코드에 남아 있는 결함 후보**를 골라라 — 로직 오류, 옮기다 남긴 것(leftover), ` +
      `약속(주석·메시지)과 코드의 불일치, 반쪽 수리. 스타일 지적 금지.\n` +
      `⚠ 「전에는 …였는데 고쳤다」는 결함이 아니다 — 그건 이 커밋이 한 일이다. 그런 것은 올리지 마라.\n` +
      `⚠ 확실하지 않으면 빼라(적은 게 낫다). quote는 아래에서 **그대로 복사**한 줄이어야 한다.\n\n${부분}`;
    // 잘림에 강하게: 넉넉히 주고(3072), 그래도 깨지면 **더 좁은 스키마로 한 번 더** 묻는다.
    //   두 번 다 실패하면 조용히 넘기지 않고 **실패로 센다**(아래 머리글이 그 수를 말한다).
    let 담았나 = false;
    for (const [스키마, 예산] of [[REVIEW_SCHEMA, 3072], [좁은스키마(3), 1536]]) {
      try {
        const out = JSON.parse(gb10Chat(prompt, 스키마, 예산));
        // ⚠ **스스로 부정하는 후보를 버린다**(2026-08-31 실측). 30B 모델이 「이 줄은 …
        //   결함이 없으며」라고 적으면서도 후보로 올린다 — 그대로 두면 Claude 검토관이
        //   읽을 양이 안 줄고, 「후보 8건」이라는 숫자가 뜻을 잃는다(실측: 8건 전부 그랬다).
        //   판정은 여전히 사람/Claude 몫이지만, **자기가 아니라고 표시한 것**은 여기서 뺀다.
        const 걸러낸 = (out.findings || []).filter((f) => f.defect === true);
        버린수 += (out.findings || []).length - 걸러낸.length;
        all.push(...걸러낸);
        담았나 = true;
        break;
      } catch (e2) {
        console.error(`⚠ diff 조각 ${i} 실패(예산 ${예산}): ${e2.message}`);
      }
    }
    if (!담았나) 실패조각++;
  }
  // ⚠ **실패를 0건으로 포장하지 않는다.** 전부 실패해도 「후보 0건」이라 적으면 깨끗하다는
  //   뜻으로 읽힌다 — 이 저장소가 이미 겪은 거짓 초록이다.
  console.log(
    실패조각
      ? `# ${ref} 1차 선별 — ⚠ **선별 실패 ${실패조각}조각** · 읽어낸 후보 ${all.length}건 (gb10 ${두뇌.이름})`
      : `# ${ref} 1차 선별 — 후보 ${all.length}건${버린수 ? ` (스스로 「결함 없다」고 적은 ${버린수}건은 버림)` : ""} (gb10 ${두뇌.이름})`,
  );
  console.log(`# ⚠ **후보이지 판정이 아니다.** 각 지점은 Claude/사람이 직접 열어 확정할 것 —`);
  console.log(`#    이 선별은 검토관을 대체하지 않고 읽을 양을 줄인다(CLAUDE.md 검토관 원칙 유효).`);
  for (const f of all) console.log(`\n[후보·${f.kind || "other"}] ${f.file}\n  인용: ${f.quote}\n  왜: ${f.why}`);
  if (!all.length && !실패조각) console.log("(후보 없음 — 로컬 선별이 못 보는 부류일 수 있다. 게시 전엔 정식 검토관을 태울 것)");
  if (실패조각) {
    console.log(`\n✗ ${실패조각}조각을 못 읽었다 — 이 결과를 「깨끗하다」로 읽지 말 것.`);
    process.exitCode = 1;
  }
}

/** 잘림이 났을 때 쓰는 더 좁은 스키마 — 건수를 줄여 출력이 예산 안에 들어오게 한다. */
function 좁은스키마(최대) {
  return {
    ...REVIEW_SCHEMA,
    properties: {
      findings: { ...REVIEW_SCHEMA.properties.findings, maxItems: 최대 },
    },
  };
}

// ── 실행 ────────────────────────────────────────────────────────────────────
// ⚠ **진입점 관문** — import(시험)로 들어오면 아무것도 돌지 않는다. 없으면 시험이 gb10을
//   부르게 되고, 그 순간 시험이 「네트워크가 살아 있는가」를 재는 물건으로 바뀐다.
function main() {
  if (!서버확인() && mode !== "up") {
    console.error(`✗ gb10:${DIGEST_PORT}가 응답하지 않는다 — 조용한 폴백은 하지 않는다.`);
    if (서버확인.마지막실패) console.error("  이유: " + 서버확인.마지막실패);
    console.error("  기동:  node tools/local-digest.mjs up");
    process.exit(2);
  }
  if (mode === "file" || mode === "log") 발췌(대상, 질문 || "핵심 내용");
  else if (mode === "review") 리뷰(대상);
  else if (mode === "up") {
    if (서버확인()) { console.log("이미 떠 있음 ✅"); process.exit(0); }
    spawnSync("ssh", [...SSH옵션, "gb10", `. ~/gijo-env.sh 2>/dev/null; ${두뇌.기동}`], { encoding: "utf8", timeout: 20000 });
    console.log(`기동 명령 보냄 (${두뇌.이름} · 포트 ${DIGEST_PORT}) — 적재 45~60초 뒤 다시 확인`);
  } else {
    console.log("사용: node tools/local-digest.mjs file <경로> \"<질문>\" | review [커밋] | log <경로> \"<질문>\" | up");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(이파일)) main();
