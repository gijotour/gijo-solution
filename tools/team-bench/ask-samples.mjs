#!/usr/bin/env node
// tools/team-bench/ask-samples.mjs — 표본 12문항을 **세 조건**으로 던져 답을 남긴다(근거 있음 · 방해만 · 맨 질문).
//
// ■ 왜 저장소로 옮겼나 (2026-09-04)
//   이 하네스는 gb10 홈(`~/bench/ladder/ask12-out.mjs`)에만 있었다. 즉 **게이트가 읽는 표본 파일을
//   만드는 자가 저장소 밖**이었다 — 그 기계를 지우면 판정 근거를 다시 만들 길이 없고, 무슨 조건으로
//   던졌는지도 파일로 못 가린다(실측: `--system`을 줬는지조차 결과에 안 남았다).
//   문항·요청 조건(temperature 0 · max_tokens 900 · cache_prompt false · 워밍업 1회 버림)은
//   **한 글자도 안 바꿨다** — 바꾸면 v3 회전(samples-base/lora/prompt.json)과 못 견준다.
//
// ■ 왜 조건이 셋인가 — RAFT가 가르치려는 것을 재려면 근거를 **줘 봐야** 안다
//   지금까지의 표본은 전부 「맨 질문」이었다. RAFT형 학습의 목적은 「섞인 자료에서 골라 인용하기」인데,
//   근거를 한 번도 안 준 채로 재고 있었다 — 목적을 재는 관문이 0개였다는 뜻이다(2026-09-04 정찰).
//     · grounded          : 팀원 프롬프트 + 참고자료([정답 조각, 방해 조각]) → **인용하는가**(관문 ⑧)
//     · distractor-only   : 팀원 프롬프트 + 참고자료([방해 조각])            → **없다고 말하는가**(관문 ⑩)
//     · bare              : 맨 질문(지금까지의 꼴, 대조군)                    → **지어내는가**(관문 ⑨)
//   ⚠ grounded의 조각 순서는 [정답, 방해] 고정이다. 학습 쪽(행만들기)은 섞지만 여기서는 **재는 자**라
//     회전마다 같은 자리여야 베이스와 견줄 수 있다 — 「맨 앞이 정답」을 배웠는지는 이 잣대가 아니라
//     distractor-only(관문 ⑩)가 가른다.
//
// ■ 근거 꼴을 베끼지 않는다
//   머리말·번호 규칙은 서버 창구(GET /api/learnloop/raft/prompt)가 준 것을 그대로 쓰고, 조립은
//   tools/build-raft-dataset.mjs의 `참고자료블록`을 **불러서** 한다(학습이 쓰는 그 함수 그대로).
//   서버가 없으면 grounded·distractor-only는 **실패한다** — 근거 꼴을 지어내면 재는 것이 딴것이 된다.
//
// ■ 문항 파일(samples-questions.json)의 조각은 어떻게 채웠나
//   `cites`의 `store:<문서>#<sha12>`를 build-raft-dataset.mjs의 회수 함수(refParse·방해조각고르기)로
//   **같은 방식** 되찾아 `chunk`·`distractor`에 넣었다(2026-09-04, 운영 4000 읽기 전용 창구).
//   ⚠ 방해 후보는 **라이선스 허용목록으로 먼저 걸렀다** — 안 거르면 타사 상용 문서 본문이 저장소에 실린다
//     (실측: 처음 회수한 방해 8개 중 4개가 타사 제품 가이드였다. 방해조각고르기에는 그 판정이 없다).
//   조각을 못 찾은 문항(원천이 chat이라 ref가 없다)은 빈칸이고, 아래에서 **건너뛰며 그 수를 남긴다**.
//
// ■ 내부 프롬프트는 결과 파일에 안 적는다
//   팀원 프롬프트는 관리자 전용 값이다(learnloop.ts 창구 주석). 결과에는 **지문(promptSha12)과 길이**만
//   남긴다 — 어느 프롬프트로 쟀는지는 가릴 수 있고, 원문은 저장소로 새지 않는다.
//
// 사용:
//   PORT=8093 node tools/team-bench/ask-samples.mjs <출력파일> --mode grounded \
//        [--server http://localhost:4000] [--agent normaltic] [--questions <경로>]
//   ⚠ day2-train.sh의 harness/ 사본 폴더로 **복사해 쓰지 않는다** — 위쪽 `../build-raft-dataset.mjs`를
//     불러 쓰므로 저장소 자리에서 그대로 실행해야 한다(gates.mjs와 같다).
//   나가는 코드: 0=정상 · 2=쓰는 법 틀림 · 3=env/서버 없음

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { 참고자료블록 } from "../build-raft-dataset.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

/** 조건 세 가지 — 이름은 결과 행의 `mode`에 그대로 적힌다(나중에 파일만 보고 가릴 수 있게). */
export const MODES = ["grounded", "distractor-only", "bare"];

/** 지문 12자 — 프롬프트 원문 대신 이것만 남긴다(원문은 관리자 전용 값이라 파일에 안 적는다). */
export const sha12 = (s) => crypto.createHash("sha1").update(String(s ?? "")).digest("hex").slice(0, 12);

/** 한글 비율·한자 수 — 원본 ask12-out.mjs의 그 식 그대로(잣대를 새로 만들지 않는다). */
export const 한글비율 = (s) => { const m = String(s).match(/[가-힣A-Za-z]/g) || []; if (!m.length) return 0; return (String(s).match(/[가-힣]/g) || []).length / m.length; };
export const 한자수 = (s) => (String(s).match(/[一-鿿]/g) || []).length;

/**
 * 조건에 맞는 조각 목록을 고른다. **없으면 null** — 부르는 쪽이 그 문항을 건너뛰고 그 수를 적는다.
 * ⚠ 조각이 없는 문항을 「근거 없이」 돌려서 grounded 칸에 적으면, 관문 ⑧이 재는 모집단이 조용히 오염된다.
 */
export function 조각들(문항, mode) {
  const chunk = String(문항?.chunk ?? "");
  const dis = String(문항?.distractor ?? "");
  if (mode === "bare") return [];
  if (mode === "grounded") return chunk ? (dis ? [chunk, dis] : [chunk]) : null;
  if (mode === "distractor-only") return dis ? [dis] : null;
  throw new Error(`모르는 조건: ${mode}`);
}

/** system 문자열 만들기 — 학습(행만들기)이 쓰는 조립과 같은 꼴: [팀원프롬프트, 참고자료블록].join("\n\n") */
export function system만들기(팀원프롬프트, ragHeader, 조각) {
  if (!조각 || !조각.length) return "";
  return [팀원프롬프트, 참고자료블록(ragHeader, 조각)].join("\n\n");
}

async function login(base, user, password) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }), redirect: "error",
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) {
    throw new Error(
      "로그인 실패: " + JSON.stringify(j).slice(0, 200) +
      "\n(계정당 1세션이다 — 다른 작업이 같은 계정으로 붙어 있으면 끝날 때까지 기다린다. 밀어내지 않는다.)"
    );
  }
  // ⚠ refreshToken을 들고 있어야 **끝날 때 세션을 실제로 닫을 수 있다.**
  //   /api/auth/logout은 body의 refreshToken이 없으면 {ok:true}만 주고 아무것도 안 지운다
  //   (auth.ts:495-499). 그걸 모르고 빈 몸으로 부르면 「로그아웃했다」는 거짓말이 된다.
  return { auth: { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken }, refreshToken: j.refreshToken };
}

/** 제품이 쓰는 근거 꼴을 **받아 온다**(베끼지 않는다). 조립 꼴이 서버와 다르면 그 자리에서 죽는다. */
async function 프롬프트받기(server, agent) {
  const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
  if (!user || !password) { console.error("✗ GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 가 필요하다(근거 꼴을 서버에서 받아 온다)"); process.exit(3); }
  const { auth, refreshToken } = await login(server, user, password);
  const r = await fetch(server + `/api/learnloop/raft/prompt?agentId=${encodeURIComponent(agent)}`, { headers: auth, redirect: "error" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    await 로그아웃({ auth, refreshToken, server });
    throw new Error(`raft/prompt ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }
  // ⚠ fail-open 금지(2026-09-04 검토관 적발): 예전에는 `j.ragBlockSample &&` 라서 창구가 그 값을
  //   안 주면 **대조가 조용히 사라졌다.** 그러면 학습 꼴과 다른 틀로 재도 그대로 통과한다 —
  //   「없으면 검사를 건너뛴다」는 검사가 아니다. 지금은 learnloop.ts가 늘 주므로 이 자리가 살아 있고,
  //   나중에 창구에서 그 필드가 사라지면 여기가 **먼저** 말한다.
  if (!j.ragBlockSample) {
    await 로그아웃({ auth, refreshToken, server });
    throw new Error("창구가 ragBlockSample을 안 준다 — 조립 꼴을 대조할 길이 없다(대조 없이 재면 학습 때와 딴 틀을 재게 된다)");
  }
  if (참고자료블록(j.ragHeader, ["<조각 본문>"]) !== j.ragBlockSample) {
    await 로그아웃({ auth, refreshToken, server });
    throw new Error("참고 자료 블록 조립 꼴이 서버(llm.ts ragBlock)와 다르다 — 이 꼴로 재면 학습 때와 딴 틀을 재게 된다");
  }
  return { system: j.system, ragHeader: j.ragHeader, auth, refreshToken, server };
}

async function 로그아웃(ctx) {
  if (!ctx?.auth) return;
  // 계정당 1세션이라 남겨 두면 다음 사람이 막힌다. **refreshToken을 함께 보내야 실제로 닫힌다.**
  await fetch(ctx.server + "/api/auth/logout", {
    method: "POST", headers: ctx.auth, redirect: "error",
    body: JSON.stringify({ refreshToken: ctx.refreshToken }),
  }).catch(() => {});
}

// ── 직접 실행 ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("team-bench/ask-samples.mjs")) {
  // 첫 번째 「--로 시작하지 않고, 앞이 옵션 이름이 아닌」 인자가 출력 경로다.
  const OUT = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))) ?? "";
  const MODE = String(opt("--mode", "bare"));
  if (!OUT || !MODES.includes(MODE)) {
    console.error(`쓰는 법: node tools/team-bench/ask-samples.mjs <출력파일> --mode ${MODES.join("|")} [--server URL] [--agent id] [--questions 경로]`);
    process.exit(2);
  }
  const PORT = Number(process.env.PORT || opt("--port", 8093));
  const SERVER = String(opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
  const AGENT = String(opt("--agent", "normaltic"));
  const QFILE = path.resolve(opt("--questions", path.join(here, "samples-questions.json")));
  const REQ_MS = Number(process.env.REQ_MS || 600_000);

  const qs = JSON.parse(fs.readFileSync(QFILE, "utf8"));
  const 근거필요 = MODE !== "bare";
  const ctx = 근거필요 ? await 프롬프트받기(SERVER, AGENT) : null;
  const 팀원지문 = ctx ? sha12(ctx.system) : "";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function ask(system, q) {
    const t0 = Date.now();
    const messages = system ? [{ role: "system", content: system }, { role: "user", content: q }] : [{ role: "user", content: q }];
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "local", messages, temperature: 0, max_tokens: 900, cache_prompt: false }),
      signal: AbortSignal.timeout(REQ_MS),
    });
    const j = await r.json();
    const ms = Date.now() - t0;
    const c = j.choices?.[0];
    const text = c?.message?.content ?? "";
    const u = j.usage || {};
    return { text, ms, finish: c?.finish_reason, genTokens: u.completion_tokens, genTps: u.completion_tokens && (u.completion_tokens / (ms / 1000)), 한글: 한글비율(text), 한자: 한자수(text), len: text.length };
  }

  const 실행인자 = process.argv.slice(1).join(" ");
  const out = [];
  let 건너뜀 = 0;
  // ⚠ try/finally — 중간에 죽어도 **세션은 닫는다.** 계정당 1세션이라 남은 세션이 다음 사람을 막는다
  //   (실측 2026-09-04: 남의 스크립트가 남긴 유휴 세션 때문에 이 하네스가 30분 막혔다).
  // ★ 워밍업도 **이 안**에 있어야 한다(2026-09-04 검토관 적발): 프롬프트를 받느라 이미 로그인한
  //   뒤라, 가장 흔한 실패인 「$PORT에 두뇌가 없다」(ECONNREFUSED)가 워밍업에서 터지면 로그아웃이
  //   한 번도 안 불렸다 — 세션을 닫으려고 만든 try가 정작 그 실패를 못 덮고 있었다.
  //   kev-probe.mjs는 처음부터 안쪽이었다(두 파일이 서로 달랐다).
  try {
  // ★ 워밍업 1회를 버린다 — 기동 직후 첫 요청이 반복 루프로 깨진 적이 있다(원본 ask12.mjs와 같다).
  await ask("", "안녕하세요");
  await sleep(500);
  for (let i = 0; i < qs.length; i++) {
    const 문항 = qs[i];
    const 조각 = 조각들(문항, MODE);
    const 공통 = {
      i: i + 1, origin: 문항.origin, question: 문항.question, gold: 문항.answer, cites: 문항.cites,
      mode: MODE, argv: 실행인자, agentPromptSha12: 팀원지문,
    };
    if (조각 === null) {
      // ⚠ 조용히 0으로 세지 않는다 — 왜 건너뛰었는지가 파일에 남아야 관문의 모집단을 사람이 읽을 수 있다.
      건너뜀 += 1;
      out.push({ ...공통, skipped: MODE === "grounded" ? "정답 조각(chunk)이 비어 있다 — 근거 ref를 회수하지 못한 문항" : "방해 조각(distractor)이 비어 있다" });
      console.log(`${i + 1}/${qs.length} 건너뜀(${MODE}: 조각 없음)`);
      continue;
    }
    const system = system만들기(ctx?.system, ctx?.ragHeader, 조각);
    const a = await ask(system, 문항.question);
    out.push({
      ...공통,
      chunk: MODE === "grounded" ? 문항.chunk : "",
      distractor: 근거필요 ? 문항.distractor : "",
      promptSha12: sha12(system), systemChars: system.length,
      ...a,
    });
    console.log(`${i + 1}/${qs.length} ${a.finish} ${a.len}자 한글${a.한글.toFixed(2)} sys${system.length}자 ${(a.ms / 1000).toFixed(1)}s`);
  }
  } finally {
    await 로그아웃(ctx);
  }
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`저장 ${OUT} — 조건 ${MODE} · 던짐 ${out.length - 건너뜀} · 건너뜀 ${건너뜀}`);
}
