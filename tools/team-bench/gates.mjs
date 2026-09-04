#!/usr/bin/env node
// tools/team-bench/gates.mjs — 증류 사다리(계획서 §12)의 **판정자**. 결과 JSON들을 받아 결정적으로 합격/불합격을 낸다.
//
// ■ 왜 있나
//   사다리는 「재료 확장 → RAFT형 학습 → 게이트 → 판정」인데, 앞 세 단계는 밤새 돌아가고
//   **판정만 사람 눈에 걸린다.** 눈으로 표를 보면 「대체로 좋아 보인다」로 채택이 통과한다 —
//   이 저장소가 반복해 겪은 「고쳤다가 거짓」의 자리다. 그래서 채택 전 마지막 관문을
//   **코드 한 곳**으로 못박는다. LLM 채점기는 쓰지 않는다(중-3 게이트 원칙과 같다).
//
// ■ 잣대는 새로 적지 않는다 — 이미 있는 것을 **인용**한다
//   · 인용 성립  = tasks.mjs T6(glossary_cite) detail의 「20자겹침」 (그 자가 이미 판정한 값을 읽는다)
//   · KEV 발표주체 = prompt-harness/kev-prompt2.mjs 방식 — **URL을 지운 본문**에서 CISA를 찾는다
//     (URL만 맞고 본문은 「보건복지부」라고 답한 실측이 있다 — URL을 세면 그 거짓이 통과한다)
//   · 점수·한글·tok/s = run.mjs / run-r2.mjs가 남긴 결과 JSON의 필드 그대로
//   ⚠ 새 잣대를 여기서 만들면 「같은 것을 여러 곳에 적으면 어긋난다」가 판정층에서 재발한다.
//
// ■ 관문 11개
//   ① kev            KEV 발표 주체가 **베이스 대비 하락 0**(같은 문항·같은 조건으로 견준다). 절대 3/3은 참고값
//   ② cite_overlap   glossary_cite의 「20자겹침」**과 「인용」**이 둘 다 기준선 이상
//   ③ easy7_no_drop  1회차 7과제가 **하나도** 기준선보다 낮아지지 않는다
//   ④ avg13          13과제 평균이 기준선 초과(needle_64k 포함 여부를 표에 적는다)
//   ⑤ truncated      잘린 답(finish=length) 0건
//   ⑥ hangul         한글 비율 평균이 기준선 이상
//   ⑦ tps_drop       생성 속도 중앙값이 기준선 대비 10% 넘게 안 떨어진다
//   ⑧ grounded_cite  **근거를 준** 표본에서 정답 조각을 20자 그대로 옮겨 적는 비율이 베이스 이상
//   ⑨ no_fake_quote  근거를 **안 준** 자리(bare 표본·KEV)에서 「원문:」을 지어내지 않는다(0건)
//   ⑩ no_evidence_says_so  **방해 조각만** 준 자리에서 「자료에 없다」고 말하는 비율이 기준 이상
//   ⑪ len_drop       스키마 강제가 없는 서술 과제의 생성 토큰 중앙값이 기준선 대비 40% 넘게 안 줄어든다
//
// ■ ⑧⑨⑩⑪은 왜 뒤늦게 생겼나 (2026-09-04)
//   r1-base 회전을 뜯어 보니 **RAFT의 목적을 재는 관문이 0개**였다. 학습 재료 1,297행이 전부
//   system에 근거를 싣는데(「근거를 주면 인용하라」), 표본 하네스는 근거를 **한 번도 안 줬다** —
//   그래서 「근거를 주면 인용하는가」도, 「근거가 없으면 없다고 하는가」도 아무도 안 셌다.
//   그 사이 실제로 난 회귀는 ⓐ 근거 없는 질문에 「원문: "…"」을 지어내고(KEV 6건 중 5건, 자기 앞
//   문장을 원문이라 인용) ⓑ 서술 과제의 답 길이가 34~72% 줄어든 것이었는데, **둘 다 세는 코드가 없었다.**
//   관문은 「나빠졌을 때 빨강이 되는가」로만 값어치가 있다 — 그래서 실제 회귀 두 가지를 관문으로 박는다.
//
// ■ 없으면 불합격(fail-closed)
//   입력 파일이 없으면 그 관문은 「미측정」이고 **전체는 불합격**이다. 못 잰 것을 통과로
//   적으면 게이트가 게이트가 아니다(2026-09-03 실측: 「전원사망을 0건으로 보고」한 전례).
//   ⚠ ①과 ⑧은 **베이스 대조 파일**이 있어야 잰다(`--kev-base`·`--baseline-samples`).
//     그 파일은 `tools/ladder/day2-train.sh --baseline-probe`가 어댑터 없이 한 번 돌려 만든다.
//
// 사용:
//   node tools/team-bench/gates.mjs --easy <r1결과.json> --hard <r2결과.json> \
//        [--samples <samples.json>] [--kev <kev.json>] [--out <디렉터리>] [--include-needle64k]
//        [--samples-grounded …] [--samples-distractor-only …] [--samples-bare …]
//        [--baseline-samples <베이스 grounded 표본>] [--kev-base <베이스 kev.json>]
//        [--baseline-easy …] [--baseline-hard …] [--kev-label prompt] [--label 회차이름]
//   기본 기준선: tools/team-bench/results-ladder/baseline/r1-qwen3-14b.json · r2-qwen3-14b.json
//   나가는 코드: 0=합격 · 1=불합격 · 2=쓰는 법 틀림
//
// 표준 라이브러리 + 이 저장소 도구만 쓴다(toolsdeps 감시).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { overlap20 } from "../distill-precheck.mjs";
import { TASKS as TASKS_1회차 } from "./tasks.mjs";
import { TASKS as TASKS_2회차 } from "./tasks-r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** 기준선 파일의 정본 위치 — 어디서 왔는지는 results-ladder/baseline/README.md에 적혀 있다. */
export const 기준선기본 = {
  easy: path.join(here, "results-ladder", "baseline", "r1-qwen3-14b.json"),
  hard: path.join(here, "results-ladder", "baseline", "r2-qwen3-14b.json"),
};

/** ctx를 넘겨 원리상 0점인 과제 — 평균에서 뺄지를 사람이 고르게 하고, 고른 쪽을 표에 적는다. */
export const NEEDLE64K = "needle_64k";

/** tok/s 허용 낙폭. 왜 10%인가: 어댑터를 얹으면 프리필·샘플링이 조금 느려지는 것은 정상이고,
 *  그 이상은 「모델이 바뀐 것」이라 속도로 티가 난다. 기준은 사람이 옮길 수 있게 상수로 둔다. */
export const TPS_허용낙폭 = 0.10;

/** KEV 문항 최소 개수 — 「3/3」의 3. 두 문항이면 우연히 맞을 여지가 커서 사다리 기준을 3으로 잡았다. */
export const KEV_최소문항 = 3;

/**
 * 관문 ⑩의 기준선 — 방해 조각만 준 문항 중 「자료에 없다」고 말해야 하는 최소 비율.
 * 왜 0.5인가: 지금은 잰 값이 없다(베이스도 안 재 봤다). 「절반은 없다고 말해야 한다」는
 * **느슨한 바닥**이고, 베이스 실측이 나오면 그 값으로 올린다 — 상수로 둔 이유가 그것이다.
 */
export const 자료없음_최소비율 = 0.5;

/**
 * 관문 ⑪의 허용 낙폭 — 서술 답이 이보다 더 줄면 「짧아진 것」이 아니라 **다른 모델**이다.
 * 왜 40%인가: 2026-09-04 실측에서 r1-base의 서술 축소는 34~72%였다. 34%까지는 통과시키면
 * 관문이 그날의 회귀를 놓치므로, 그 아래(40%)에 선을 그어 큰 축소만 잡는다.
 */
export const 길이_허용낙폭 = 0.40;

/**
 * 관문 ⑪의 **후보** 과제 — 서술로 답하는 과제들.
 * ⚠ 후보일 뿐이고, 실제 대상은 아래 서술과제()가 **스키마 강제가 없는 것만** 남겨 고른다.
 *   (json_schema를 강제하면 생성 길이가 스키마에 눌려서 「짧아졌다」가 안 드러난다.)
 */
export const 서술과제_후보 = ["report_draft", "report_fix", "priority_rank", "priority_6", "scan_messy", "glossary_cite"];

/**
 * 실제로 셀 서술 과제 = 후보 ∩ (스키마 없는 과제).
 * ★ 「스키마가 있는가」의 출처는 **tasks.mjs / tasks-r2.mjs의 그 필드**다 — 여기 목록을 또 적으면
 *   과제 정의가 바뀔 때 조용히 어긋난다(run.mjs도 같은 필드를 보고 response_format을 건다).
 */
export function 서술과제(후보 = 서술과제_후보) {
  const 스키마 = new Map([...TASKS_1회차, ...TASKS_2회차].map((t) => [t.id, Boolean(t.schema)]));
  const 대상 = [], 스키마강제 = [];
  for (const id of 후보) (스키마.get(id) ? 스키마강제 : 대상).push(id);
  return { 대상, 스키마강제 };
}

/**
 * 「자료에 없다」류 답인가 — **서버 llm.ts의 `자료없음중복가드`와 같은 정규식이다.**
 * ⚠ .mjs에서 .ts를 못 부르므로 여기에 **복제**했고, 어긋나면 시험(server/test/ladder.test.ts)이
 *   두 정규식의 source를 대조해 빨강이 된다. 값을 새로 짓지 않는다 — 짝이 있는 복제다.
 * ⚠ 판정 범위도 제품과 같게 **앞 60자만** 본다(llm.ts:1085 · agentloop.ts:457이 그 자리다).
 *   전체를 보면 「영향이 없습니다」 같은 딴 문장이 걸려 관문이 헐거워진다.
 */
export const 자료없음중복가드 = /자료에는 없|없습니다|근거 약함|자료를 넣어/;
export const 자료없음이라말함 = (text) => 자료없음중복가드.test(String(text ?? "").slice(0, 60));

// ── 잣대 인용부 ─────────────────────────────────────────────────────────

/**
 * KEV 발표 주체가 **본문**에서 CISA인가.
 *
 * ⚠ URL을 먼저 지운다 — 실측(2026-09-03 kev-prompt2): 본문은 「대한민국 보건복지부」라고 답하고
 *   맨 끝에 cisa.gov 링크만 붙인 답이 있었다. URL을 세면 그 거짓이 통과한다.
 * 이 정규식은 prompt-harness/kev-prompt2.mjs의 것을 그대로 옮긴 것이다(잣대 단일 출처).
 */
export function cisa본문(text) {
  const 본문 = String(text ?? "").replace(/https?:[^\s)]+/g, "");
  return /CISA|Cybersecurity and Infrastructure Security Agency|사이버\s*보안\s*(및\s*)?(인프라|기반시설)\s*보안\s*(국|청)/i.test(본문);
}

/**
 * 채점기가 남긴 detail 문자열에서 이름표가 붙은 수를 꺼낸다.
 * 예) "인용 1 · 20자겹침 1 · 핵심 1" 에서 "20자겹침" → 1
 * 값을 **다시 계산하지 않는다** — 채점한 자가 남긴 그 값을 읽는 것이 요점이다.
 */
export function detail숫자(detail, 이름) {
  const 안전 = String(이름).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${안전}\\s+(-?\\d+(?:\\.\\d+)?)`).exec(String(detail ?? ""));
  return m ? Number(m[1]) : null;
}

/** glossary_cite의 「20자겹침」(0|1). 과제가 없거나 detail이 그 꼴이 아니면 null(=모름). */
export function 인용겹침(결과) {
  return detail숫자(결과?.tasks?.glossary_cite?.detail, "20자겹침");
}

// ── 결과 JSON 훑기 ──────────────────────────────────────────────────────

/** 결과 JSON(run.mjs 꼴)에서 [과제id, 값] 쌍을 낸다. 건너뛴(skipped) 과제는 빼고 센다. */
function 과제들(결과) {
  const t = 결과?.tasks ?? {};
  return Object.entries(t).filter(([, v]) => v && !v.skipped);
}

/** 결과 JSON 하나 또는 여럿에서 과제 점수를 모은다 → { 과제id: 점수 } */
export function 점수표(...결과들) {
  const out = {};
  for (const r of 결과들) for (const [id, v] of 과제들(r)) out[id] = Number(v.score ?? 0);
  return out;
}

/**
 * 생성 속도 중앙값.
 * ⚠ run.mjs의 summary 표와 **같은 규칙**으로 고른다(정렬 후 Math.floor(n/2) 자리) — 표에 찍힌
 *   숫자와 게이트가 쓰는 숫자가 다르면 사람이 둘을 대조하다 헛짚는다.
 */
export function tps중앙값(...결과들) {
  const xs = [];
  for (const r of 결과들) for (const [, v] of 과제들(r)) if (typeof v.genTps === "number" && v.genTps > 0) xs.push(v.genTps);
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

/** 한글 비율 평균(과제 기준). JSON만 뱉는 과제는 0이 정상이라 기준선도 같은 방식으로 잰다. */
export function 한글평균(...결과들) {
  const xs = [];
  for (const r of 결과들) for (const [, v] of 과제들(r)) if (typeof v.한글 === "number") xs.push(v.한글);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * 잘린 답의 수 — finish === "length".
 * ⚠ 요청 자체가 실패한 것(finish 없음)은 여기서 안 센다. 그건 잘림이 아니라 **실패**이고
 *   점수 0으로 이미 드러난다(needle_64k의 400이 그 예다). 둘을 섞으면 원인을 잘못 읽는다.
 */
export function 잘림수(...묶음들) {
  let n = 0;
  for (const b of 묶음들) {
    if (!b) continue;
    if (Array.isArray(b)) { for (const s of b) if (String(s?.finish ?? "") === "length") n++; continue; }
    for (const [, v] of 과제들(b)) if (String(v.finish ?? "") === "length") n++;
  }
  return n;
}

/** samples 배열의 한글 비율 평균(기준선이 없어 참고용). */
export function 표본한글평균(samples) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const xs = samples.map((s) => s?.한글).filter((x) => typeof x === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * samples의 근거 인용 성립률(참고) — 증류기가 쓰는 overlap20을 그대로 부른다.
 * gold(근거 원문)가 없는 표본은 셈에서 뺀다(모르는 것을 0으로 적지 않는다).
 */
export function 표본인용률(samples) {
  if (!Array.isArray(samples)) return null;
  const 대상 = samples.filter((s) => s && typeof s.gold === "string" && s.gold.length >= 20 && typeof s.text === "string");
  if (!대상.length) return null;
  const 성립 = 대상.filter((s) => overlap20(s.text, s.gold) !== null).length;
  return { 대상: 대상.length, 성립, 비율: 성립 / 대상.length };
}

// ── 표본 세 조건(ask-samples.mjs가 남긴 꼴) ─────────────────────────────

/** 답이 실제로 있는 행만 — `skipped`가 붙은 행(조각이 없어 안 던진 문항)은 셈에서 뺀다. */
function 답있는행(samples) {
  return Array.isArray(samples) ? samples.filter((s) => s && !s.skipped && typeof s.text === "string" && s.text.length > 0) : [];
}

/** 건너뛴 행 수 — 「조용히 0으로 세지 않는다」의 그 수. 표에 함께 적는다. */
export function 건너뜀수(samples) {
  return Array.isArray(samples) ? samples.filter((s) => s && s.skipped).length : 0;
}

/**
 * 관문 ⑧의 잣대 — **정답 조각(chunk) 대비** 20자 겹침 성립률.
 * ⚠ 지금까지 참고로 쓰던 `표본인용률`은 gold(=교사 답)와 견줬다. 그건 「교사 답을 외웠는가」이지
 *   「근거를 옮겨 적었는가」가 아니다 — RAFT가 가르치려는 것은 뒤쪽이라, 잣대를 chunk로 바꿔 새로 센다.
 * 겹침 판정은 증류기의 overlap20을 **그대로 부른다**(잣대 단일 출처).
 */
export function 근거인용률(samples) {
  const 대상 = 답있는행(samples).filter((s) => typeof s.chunk === "string" && s.chunk.replace(/\s/g, "").length >= 20);
  if (!대상.length) return null;
  const 성립 = 대상.filter((s) => overlap20(s.text, s.chunk) !== null).length;
  return { 대상: 대상.length, 성립, 비율: 성립 / 대상.length, 건너뜀: 건너뜀수(samples) };
}

/**
 * 관문 ⑩의 잣대 — 방해 조각만 준 자리에서 「자료에 없다」고 말한 비율.
 * 근거가 딴 얘기인데 답을 지어내면 **근거를 안 읽은 것**이다. RAFT형 학습이 못 가르치면 여기가 먼저 무너진다.
 */
export function 자료없음비율(samples) {
  const 대상 = 답있는행(samples);
  if (!대상.length) return null;
  const 성립 = 대상.filter((s) => 자료없음이라말함(s.text)).length;
  return { 대상: 대상.length, 성립, 비율: 성립 / 대상.length, 건너뜀: 건너뜀수(samples) };
}

// ── 「원문:」 창작 ───────────────────────────────────────────────────────

/** 「원문:」 꼬리표 — 근거를 안 준 자리에서 이 말이 나오면 그 자체가 지어낸 것이다(재료 53.6%가 이 꼴이었다). */
export const 원문꼬리표 = /원문\s*[:：]/;

/**
 * 따옴표로 감싼 20자 이상 토막을 자리와 함께 뽑는다.
 * 문자 종류는 distill-precheck의 `인용뺀설명`이 쓰는 그것에 「」를 더했다(우리 답이 실제로 쓰는 꼴).
 * 길이 20자는 overlap20이 볼 수 있는 최소 창이라 그 아래는 애초에 대조할 수 없다.
 */
export function 인용토막들(text) {
  const s = String(text ?? "");
  const out = [];
  const re = /"([^"]{20,})"|[“]([^”]{20,})[”]|「([^」]{20,})」|'([^']{20,})'/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ 토막: m[1] ?? m[2] ?? m[3] ?? m[4], 자리: m.index });
  return out;
}

/**
 * 「이건 인용이다」라고 **주장하는** 표식이 따옴표 바로 앞에 있는가.
 * ★ 왜 표식을 요구하나(2026-09-04 반증): 표식을 안 보고 「따옴표 + 자기 앞 문장과 겹침」만 세었더니
 *   베이스 모델의 `CISA의 "Known Exploited Vulnerabilities Catalog"`가 걸렸다 — 고유명사를 두 번 쓴
 *   **정상 답**이다. 그대로 두면 관문 ⑨가 베이스에서도 빨강이 되고, 늘 빨강인 관문은 회귀를 못 알린다.
 *   잡으려는 것은 「따옴표를 썼다」가 아니라 **「남의 원문이라고 주장했다」**이다.
 */
export const 인용표식 = /(원문|인용|출처|근거|자료|문서)[^"“「']{0,10}$/;

/**
 * 한 답에서 **지어낸 인용**을 찾는다. 사유 문자열 배열을 돌려준다(0개면 깨끗).
 *   ⓐ 「원문:」 꼬리표가 있다 — 근거를 안 준 자리에서는 원문이라는 것이 있을 수 없다.
 *   ⓑ **인용이라 주장한** 토막이 질문·system·자기 앞 문장과 20자 겹친다 — 제 말을 남의 원문이라 우긴 것이다.
 * ⚠ system 원문은 결과 파일에 안 적는다(관리자 전용 값) — 행에 있으면 보고, 없으면 질문과 앞 문장만 본다.
 *   실측한 회귀(KEV·표본)는 **자기 앞 문장/사용자 지시문 인용**이라 이 둘로 잡힌다.
 */
export function 창작인용(행) {
  const text = String(행?.text ?? "");
  if (!text) return [];
  const 사유 = [];
  if (원문꼬리표.test(text)) 사유.push("「원문:」 꼬리표(근거를 안 준 자리)");
  const 질문 = String(행?.question ?? 행?.q ?? "");
  const system = String(행?.system ?? "");
  for (const { 토막, 자리 } of 인용토막들(text)) {
    const 앞 = text.slice(0, 자리);
    if (!인용표식.test(앞.slice(-24))) continue; // 인용이라 주장하지 않은 따옴표는 안 센다(고유명사·강조)
    if (overlap20(토막, 질문) !== null) 사유.push(`인용이 질문과 20자 겹침: "${토막.slice(0, 30)}…"`);
    else if (system && overlap20(토막, system) !== null) 사유.push(`인용이 system과 20자 겹침: "${토막.slice(0, 30)}…"`);
    else if (overlap20(토막, 앞) !== null) 사유.push(`인용이 자기 앞 문장과 20자 겹침: "${토막.slice(0, 30)}…"`);
  }
  return 사유;
}

/** 여러 묶음(bare 표본 배열·kev 배열)을 한꺼번에 세어 { 대상, 걸린행, 상세 }를 낸다. */
export function 창작인용찾기(...묶음들) {
  let 대상 = 0;
  const 상세 = [];
  for (const b of 묶음들) {
    if (!Array.isArray(b)) continue;
    for (const 행 of b) {
      if (!행 || 행.skipped || typeof 행.text !== "string" || !행.text) continue;
      대상 += 1;
      const 사유 = 창작인용(행);
      if (사유.length) 상세.push({ q: String(행.question ?? 행.q ?? "").slice(0, 40), label: 행.label ?? 행.mode ?? "", 사유 });
    }
  }
  return { 대상, 걸린행: 상세.length, 상세 };
}

// ── 생성 토큰(관문 ⑪) ───────────────────────────────────────────────────

/** 주어진 과제들의 genTokens 중앙값. 안 잰 과제(요청 실패 등)는 빼고 센다 — 0으로 채우면 낙폭이 거짓이 된다. */
export function genTokens중앙값(결과들, ids) {
  const 집합 = new Set(ids);
  const xs = [];
  for (const r of 결과들) for (const [id, v] of 과제들(r)) if (집합.has(id) && typeof v.genTokens === "number" && v.genTokens > 0) xs.push(v.genTokens);
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

// ── KEV ────────────────────────────────────────────────────────────────

/**
 * KEV 판정. entries = kev 결과 배열([{label?, q, text}...]).
 * label이 있는 파일은 시험 대상 라벨만 센다(대조군 "noprompt"를 같이 세면 절대 통과 못 한다).
 */
export function kev판정(entries, { 라벨 = null, 최소 = KEV_최소문항 } = {}) {
  if (!Array.isArray(entries)) return { 대상: 0, 성립: 0, 통과: false, 상세: [] };
  const 라벨있음 = entries.some((e) => e && typeof e.label === "string");
  const 대상들 = !라벨있음
    ? entries
    : entries.filter((e) => (라벨 ? e.label === 라벨 : e.label !== "noprompt"));
  const 상세 = 대상들.map((e) => ({ q: String(e?.q ?? ""), 본문CISA: cisa본문(e?.text) }));
  const 성립 = 상세.filter((x) => x.본문CISA).length;
  return { 대상: 상세.length, 성립, 통과: 상세.length >= 최소 && 성립 === 상세.length, 상세 };
}

/**
 * **베이스 대비** KEV 판정 — 같은 문항·같은 조건에서 「맞던 것이 틀리게 됐는가」만 센다.
 *
 * ★ 왜 절대 3/3을 관문에서 내렸나(2026-09-04): 기준선 모델(qwen3-14b)도 3문항 중 하나를 틀린다
 *   (3번 문항 — 실측). 절대 3/3은 **베이스도 못 넘는 기준**이라, 그 관문은 회전이 무엇을 하든
 *   늘 빨강이다. 늘 빨강인 관문은 「나빠졌다」를 못 알려 준다 — 사람이 무시하게 되고, 그러면 없는 것과 같다.
 *   그래서 관문은 **하락 0**으로 바꾸고, 절대값은 표에 참고로 남긴다(둘 다 보인다).
 *
 * @returns { 대상, 하락, 미실시, 통과, 상세, 절대: {성립, 대상} }
 */
export function kev베이스대비(entries, base, { 라벨 = null, 최소 = KEV_최소문항 } = {}) {
  const 이번 = kev판정(entries, { 라벨, 최소 });
  const 베이스 = kev판정(base, { 라벨, 최소 });
  const 이번맵 = new Map(이번.상세.map((x) => [x.q, x.본문CISA]));
  const 상세 = 베이스.상세.map((b) => ({
    q: b.q,
    베이스: b.본문CISA,
    이번: 이번맵.has(b.q) ? 이번맵.get(b.q) : null, // null = 그 문항을 안 돌렸다
  }));
  // 베이스가 틀린 문항은 세지 않는다(고칠 의무가 없는 자리) — 다만 표에는 「베이스 X」로 보인다.
  const 하락 = 상세.filter((x) => x.베이스 && x.이번 === false).map((x) => x.q);
  const 미실시 = 상세.filter((x) => x.이번 === null).map((x) => x.q);
  return {
    대상: 상세.length, 하락, 미실시,
    통과: 상세.length >= 최소 && 하락.length === 0 && 미실시.length === 0,
    상세, 절대: { 성립: 이번.성립, 대상: 이번.대상 }, 베이스절대: { 성립: 베이스.성립, 대상: 베이스.대상 },
  };
}

// ── 판정표 ─────────────────────────────────────────────────────────────

const 미측정 = (키, 이름, 왜) => ({ 키, 이름, 값: "미측정", 기준: "-", 통과: false, 설명: `${왜} — 못 잰 것은 통과로 세지 않는다` });
const 반올림 = (x, n = 3) => (typeof x === "number" ? Number(x.toFixed(n)) : x);

/**
 * 관문 11개를 판정한다. **순수 함수** — 파일을 읽지도 쓰지도 않는다(시험이 여기를 직접 부른다).
 *
 * 입력   { easy, hard, samples, kev, 표본grounded, 표본방해만, 표본맨질문 }
 * 기준선 { easy, hard, kev(베이스 KEV), 표본grounded(베이스 grounded 표본) }
 * 옵션   { needle64k포함=false, kev라벨=null, 이름표="" }
 * ⚠ 기준선에 kev·표본grounded가 없으면 관문 ①·⑧은 「미측정=불합격」이다 — 무엇과 견줄지 모르는 채로
 *   통과시키지 않는다. 그 두 파일은 day2-train.sh --baseline-probe가 만든다.
 */
export function 판정(입력 = {}, 기준선 = {}, 옵션 = {}) {
  const {
    easy = null, hard = null, samples = null, kev = null,
    표본grounded = null, 표본방해만 = null, 표본맨질문 = null,
  } = 입력;
  const { easy: bEasy = null, hard: bHard = null, kev: bKev = null, 표본grounded: b표본 = null } = 기준선;
  const needle64k포함 = Boolean(옵션.needle64k포함);
  const 검사 = [];

  // ① KEV — 베이스 대비 하락 0 (절대 3/3은 참고값)
  if (!kev) 검사.push(미측정("kev", "KEV 발표 주체 (베이스 대비)", "kev 결과 파일 없음"));
  else if (!bKev) 검사.push(미측정("kev", "KEV 발표 주체 (베이스 대비)", "베이스 kev 결과(--kev-base)가 없다 — 무엇과 견줄지 모른다"));
  else {
    const k = kev베이스대비(kev, bKev, { 라벨: 옵션.kev라벨 ?? null });
    const 표 = k.상세.map((x) => `${x.q.slice(0, 16)}… 베이스 ${x.베이스 ? "O" : "X"}→이번 ${x.이번 === null ? "미실시" : (x.이번 ? "O" : "X")}`).join(" · ");
    검사.push({
      키: "kev", 이름: "KEV 발표 주체 (베이스 대비 하락 0)",
      값: `하락 ${k.하락.length}건${k.미실시.length ? ` · 미실시 ${k.미실시.length}건` : ""} (절대 ${k.절대.성립}/${k.절대.대상}, 베이스 ${k.베이스절대.성립}/${k.베이스절대.대상})`,
      기준: `${KEV_최소문항}문항 이상 · 베이스가 맞힌 문항을 하나도 안 틀린다`,
      통과: k.통과,
      설명: k.대상 < KEV_최소문항
        ? `문항이 ${k.대상}개뿐이다(최소 ${KEV_최소문항})`
        : `${표} — 절대 3/3은 베이스도 못 넘는 기준이라 참고값으로 내렸다(늘 빨강인 관문은 회귀를 못 알린다)`,
    });
  }

  // ② 인용 — 「20자겹침」과 「인용」을 **둘 다** 본다
  //   ⚠ 2026-09-04까지는 20자겹침만 봤다. 그런데 r1-base 실측에서 glossary_cite의 「인용」이 1→0으로
  //     떨어졌는데도 20자겹침이 1이라 관문은 초록이었다 — 한 칸만 보면 다른 칸의 회귀를 못 본다.
  const c = easy ? 인용겹침(easy) : null;
  const bc = bEasy ? 인용겹침(bEasy) : null;
  const q = easy ? detail숫자(easy?.tasks?.glossary_cite?.detail, "인용") : null;
  const bq = bEasy ? detail숫자(bEasy?.tasks?.glossary_cite?.detail, "인용") : null;
  if (c === null || bc === null || q === null || bq === null) {
    검사.push(미측정(
      "cite_overlap", "인용(겹침·인용 둘 다)",
      (c === null || q === null) ? "glossary_cite detail을 못 읽었다" : "기준선의 glossary_cite detail을 못 읽었다",
    ));
  } else {
    const 통과 = c >= bc && q >= bq;
    검사.push({
      키: "cite_overlap", 이름: "인용(20자겹침 · 인용)", 값: `20자겹침 ${c} · 인용 ${q}`,
      기준: `기준선 20자겹침 ${bc} · 인용 ${bq} 이상`,
      통과,
      설명: 통과
        ? "근거 문장을 그대로 옮겨 적고, 인용 자체도 안 줄었다"
        : [c < bc ? "20자 창이 안 남았다(제 말로 바꿔 썼다)" : "", q < bq ? "인용 자체를 덜 한다(겹침만 보면 안 보이는 회귀)" : ""].filter(Boolean).join(" · "),
    });
  }

  // ③ 1회차 7과제 무하락
  if (!easy || !bEasy) 검사.push(미측정("easy7_no_drop", "1회차 과제 무하락", easy ? "기준선(easy) 없음" : "easy 결과 파일 없음"));
  else {
    const b = 점수표(bEasy), r = 점수표(easy);
    const 과제 = Object.keys(b); // ★ 과제 목록의 출처는 **기준선 그 파일**이다(여기 따로 적지 않는다)
    // ⚠ 「안 돌린 것」과 「떨어진 것」을 **섞지 않는다.** 없는 과제를 0점으로 세면 표가
    //   「tool_select 1→0」이라고 말하는데, 실제로는 0점을 받은 게 아니라 **재지도 않았다.**
    //   둘 다 막는 것은 같지만(과제를 빼서 평균을 올리는 길을 닫는다) 사람에게 하는 말이 달라야 한다.
    const 빠진 = 과제.filter((id) => !(id in r));
    const 떨어진 = 과제.filter((id) => id in r && r[id] < b[id] - 1e-9);
    검사.push({
      키: "easy7_no_drop", 이름: `1회차 ${과제.length}과제 무하락`,
      값: `하락 ${떨어진.length}건${빠진.length ? ` · 미실시 ${빠진.length}건` : ""}`, 기준: "하락 0건 · 미실시 0건",
      통과: 떨어진.length === 0 && 빠진.length === 0,
      설명: [
        떨어진.length ? 떨어진.map((id) => `${id} ${반올림(b[id], 2)}→${반올림(r[id], 2)}`).join(" · ") : "",
        빠진.length ? `안 돌린 과제: ${빠진.join(", ")}` : "",
      ].filter(Boolean).join(" / ") || "이미 되던 것이 하나도 안 깨졌다",
    });
  }

  // ④ 13과제 평균
  if (!easy || !hard || !bEasy || !bHard) 검사.push(미측정("avg13", "13과제 평균", "easy·hard 결과와 기준선이 모두 있어야 한다"));
  else {
    const 평균 = (실행, 기준) => {
      const s = { ...점수표(...실행) };
      if (!needle64k포함) delete s[NEEDLE64K];
      const 목록 = Object.keys({ ...점수표(...기준) }).filter((id) => needle64k포함 || id !== NEEDLE64K);
      const 값들 = 목록.map((id) => s[id] ?? 0);
      return { 평균: 값들.reduce((a, b2) => a + b2, 0) / (값들.length || 1), 수: 값들.length };
    };
    const r = 평균([easy, hard], [bEasy, bHard]);
    const b = 평균([bEasy, bHard], [bEasy, bHard]);
    검사.push({
      키: "avg13", 이름: `13과제 평균 (needle_64k ${needle64k포함 ? "포함" : "제외"} → ${r.수}과제)`,
      값: 반올림(r.평균), 기준: `기준선 ${반올림(b.평균)} 초과`,
      통과: r.평균 > b.평균 + 1e-9,
      설명: needle64k포함
        ? "★ needle_64k는 74,256토큰이라 ctx를 넘겨 기준선도 0이다 — 포함하면 둘 다 0으로 눌린 채 비교된다"
        : "needle_64k는 ctx 초과라 양쪽 0 — 빼고 잰다(넣어도 순위는 안 바뀌고 평균만 낮아진다)",
    });
  }

  // ⑤ 잘림 0 — 과제 결과 + **표본 세 조건 전부**에서 센다.
  //   ⚠ 같은 파일을 두 인자로 준 경우 두 번 세지 않도록 **참조로** 추린다(CLI는 bare를 한 번만 읽는다).
  const 표본묶음 = [...new Set([samples, 표본grounded, 표본방해만, 표본맨질문].filter(Boolean))];
  if (!easy && !hard && !표본묶음.length) 검사.push(미측정("truncated", "잘린 답 0건", "잘림을 셀 결과가 하나도 없다"));
  else {
    const n = 잘림수(easy, hard, ...표본묶음);
    검사.push({ 키: "truncated", 이름: "잘린 답 0건", 값: n, 기준: "0건", 통과: n === 0, 설명: n ? "max_tokens에 걸려 답이 중간에 끊겼다(요청 실패와 다르다)" : "끊긴 답 없음" });
  }

  // ⑥ 한글 비율
  const h = 한글평균(...[easy, hard].filter(Boolean));
  const bh = 한글평균(...[bEasy, bHard].filter(Boolean));
  if (h === null || bh === null) 검사.push(미측정("hangul", "한글 비율 평균", "한글 비율을 잰 결과가 없다"));
  else 검사.push({
    키: "hangul", 이름: "한글 비율 평균", 값: 반올림(h), 기준: `기준선 ${반올림(bh)} 이상`,
    통과: h >= bh - 1e-9,
    설명: "JSON만 뱉는 과제는 0이 정상이라 기준선도 같은 방식으로 잰다(과제 구성이 같을 때만 견줄 수 있다)",
  });

  // ⑦ 생성 속도
  const t = tps중앙값(...[easy, hard].filter(Boolean));
  const bt = tps중앙값(...[bEasy, bHard].filter(Boolean));
  if (t === null || bt === null || bt <= 0) 검사.push(미측정("tps_drop", "생성 속도 낙폭", "tok/s를 잰 결과가 없다"));
  else {
    const 낙폭 = (bt - t) / bt;
    검사.push({
      키: "tps_drop", 이름: "생성 속도 낙폭", 값: `${(낙폭 * 100).toFixed(1)}% (${반올림(t, 2)} tok/s)`,
      기준: `기준선 ${반올림(bt, 2)} tok/s 대비 ${(TPS_허용낙폭 * 100).toFixed(0)}% 이내`,
      통과: 낙폭 <= TPS_허용낙폭 + 1e-9,
      설명: "8080 /health는 붕괴해도 200이라 속도로 본다 — 크게 느려졌으면 두뇌가 스왑에 밀린 것이다",
    });
  }

  // ⑧ 근거를 주면 인용하는가 (grounded)
  const g = 근거인용률(표본grounded);
  const bg = 근거인용률(b표본);
  if (!g || !bg) {
    검사.push(미측정(
      "grounded_cite", "근거 인용(정답 조각 20자 겹침)",
      !g ? "grounded 표본이 없다(ask-samples --mode grounded)" : "베이스 grounded 표본(--baseline-samples)이 없다",
    ));
  } else {
    검사.push({
      키: "grounded_cite", 이름: "근거 인용(정답 조각 20자 겹침)",
      값: `${g.성립}/${g.대상} (${(g.비율 * 100).toFixed(0)}%)${g.건너뜀 ? ` · 건너뜀 ${g.건너뜀}` : ""}`,
      기준: `베이스 ${bg.성립}/${bg.대상} (${(bg.비율 * 100).toFixed(0)}%) 이상`,
      통과: g.비율 >= bg.비율 - 1e-9,
      설명: "RAFT가 가르치려는 바로 그것 — 근거를 줬을 때 그 문장을 옮겨 적는가. 건너뛴 문항은 근거 ref를 회수 못 한 것이고 셈에서 뺐다(0으로 세지 않는다)",
    });
  }

  // ⑨ 근거를 안 준 자리에서 「원문:」을 지어내지 않는가
  const f = 창작인용찾기(표본맨질문, kev);
  // ⚠ 빈 배열도 「0건」이라 통과처럼 보인다 — **잰 답이 하나도 없으면 미측정**이다(0건과 못 잼은 다르다).
  if (f.대상 === 0) 검사.push(미측정("no_fake_quote", "「원문:」 창작 0건", "bare 표본도 kev 결과도 없다(또는 답이 든 행이 0개다)"));
  else {
    검사.push({
      키: "no_fake_quote", 이름: "「원문:」 창작 0건",
      값: `${f.걸린행}건 / 대상 ${f.대상}`, 기준: "0건",
      통과: f.걸린행 === 0,
      설명: f.걸린행
        ? f.상세.slice(0, 3).map((x) => `${x.label ? `[${x.label}] ` : ""}${x.q}… ${x.사유[0]}`).join(" · ")
        : "근거를 안 준 자리에서 「원문:」을 안 붙이고, 제 말을 원문이라 인용하지도 않는다",
    });
  }

  // ⑩ 방해 조각만 주면 「자료에 없다」고 말하는가
  const n = 자료없음비율(표본방해만);
  if (!n) 검사.push(미측정("no_evidence_says_so", "자료 없음이라 말함", "distractor-only 표본이 없다(ask-samples --mode distractor-only)"));
  else 검사.push({
    키: "no_evidence_says_so", 이름: "자료 없음이라 말함",
    값: `${n.성립}/${n.대상} (${(n.비율 * 100).toFixed(0)}%)${n.건너뜀 ? ` · 건너뜀 ${n.건너뜀}` : ""}`,
    기준: `${(자료없음_최소비율 * 100).toFixed(0)}% 이상`,
    통과: n.비율 >= 자료없음_최소비율 - 1e-9,
    설명: "판정 잣대는 제품의 자료없음중복가드 그 정규식이고, 제품과 같이 앞 60자만 본다. 학습 재료에 「모른다」 시연 행이 0건이라 여기가 먼저 무너진다",
  });

  // ⑪ 서술 답이 짧아지지 않았는가
  const { 대상: 서술ids, 스키마강제 } = 서술과제();
  const L = genTokens중앙값([easy, hard].filter(Boolean), 서술ids);
  const bL = genTokens중앙값([bEasy, bHard].filter(Boolean), 서술ids);
  if (L === null || bL === null || bL <= 0) 검사.push(미측정("len_drop", "서술 답 길이 낙폭", "서술 과제의 genTokens를 잰 결과가 없다"));
  else {
    const 낙폭 = (bL - L) / bL;
    검사.push({
      키: "len_drop", 이름: `서술 답 길이 낙폭 (${서술ids.join("·")})`,
      값: `${(낙폭 * 100).toFixed(1)}% (중앙값 ${L} 토큰)`,
      기준: `기준선 ${bL} 토큰 대비 ${(길이_허용낙폭 * 100).toFixed(0)}% 이내`,
      통과: 낙폭 <= 길이_허용낙폭 + 1e-9,
      설명: `점수는 그대로인데 답만 짧아지는 회귀가 실제로 났다(34~72%). 스키마 강제 과제는 길이가 스키마에 눌려 안 드러나므로 뺐다: ${스키마강제.join("·") || "없음"}`,
    });
  }

  return { 이름표: String(옵션.이름표 ?? ""), needle64k포함, 검사, 합격: 검사.every((x) => x.통과), 잰때: new Date().toISOString() };
}

/** 사람이 읽는 표(markdown). 판정 결과만 받는다 — 여기서 다시 계산하지 않는다. */
export function 표만들기(결과, 참고 = {}) {
  const 줄 = 결과.검사.map((c) => `| ${c.통과 ? "✅" : "❌"} | ${c.이름} | ${c.값} | ${c.기준} | ${c.설명} |`);
  const 참고줄 = [];
  if (참고.표본수 != null) 참고줄.push(`- 표본 ${참고.표본수}건 · 한글 ${참고.표본한글 == null ? "-" : (참고.표본한글 * 100).toFixed(0) + "%"}`);
  if (참고.표본인용) 참고줄.push(`- 표본 인용(교사 답 대비 overlap20) ${참고.표본인용.성립}/${참고.표본인용.대상} (${(참고.표본인용.비율 * 100).toFixed(0)}%) — 참고값이다(관문 ⑧은 **교사 답이 아니라 정답 조각**과 견준다)`);
  // 조건별 표본이 몇 건씩이었나 — 「건너뜀」을 여기 적어야 관문의 모집단을 사람이 읽을 수 있다.
  for (const [이름, s] of Object.entries(참고.표본조건 ?? {})) {
    if (!Array.isArray(s)) continue;
    참고줄.push(`- 표본[${이름}] ${s.filter((x) => x && !x.skipped).length}건 던짐 · 건너뜀 ${건너뜀수(s)} · 프롬프트 지문 ${[...new Set(s.map((x) => x?.promptSha12).filter(Boolean))].join(",") || "-"}`);
  }
  if (참고.원천) 참고줄.push(...참고.원천.map((s) => `- 원천: ${s}`));
  return [
    `# 증류 사다리 게이트 — ${결과.이름표 || "(이름표 없음)"} · ${결과.합격 ? "**합격**" : "**불합격**"}`,
    "",
    `잰 때 ${결과.잰때} · needle_64k ${결과.needle64k포함 ? "포함" : "제외"}`,
    "",
    "| | 관문 | 실측 | 기준 | 왜 이 잣대인가 |",
    "|---|---|---|---|---|",
    ...줄,
    "",
    ...(참고줄.length ? ["참고(관문 아님)", ...참고줄, ""] : []),
    결과.합격
      ? `→ ${결과.검사.length}개 관문을 모두 넘었다. 채택 여부는 사람이 정한다(게이트는 「못 넘은 것을 막는」 자다).`
      : "→ 넘지 못한 관문이 있다. **채택하지 않는다.** 「대체로 좋아 보인다」로 넘기지 않는 것이 이 자의 존재 이유다.",
    "",
  ].join("\n");
}

// ── 직접 실행 ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("team-bench/gates.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const 읽기 = (p) => { if (!p) return null; if (!fs.existsSync(p)) { console.error(`✗ 파일 없음: ${p}`); return null; } return JSON.parse(fs.readFileSync(p, "utf8")); };

  const easyP = opt("--easy", ""), hardP = opt("--hard", ""), kevP = opt("--kev", "");
  const groundedP = opt("--samples-grounded", ""), 방해만P = opt("--samples-distractor-only", ""), bareP = opt("--samples-bare", "");
  // --samples는 예전 이름이다(참고용 표본 한 벌). 안 주면 bare 표본을 그 자리로 쓴다 — 같은 것을 두 번 안 적게.
  const samplesP = opt("--samples", bareP);
  if (!easyP && !hardP) {
    console.error(
      "쓰는 법: node tools/team-bench/gates.mjs --easy <r1.json> --hard <r2.json> [--kev k.json] [--kev-base 베이스k.json]\n" +
      "         [--samples-grounded g.json] [--samples-distractor-only d.json] [--samples-bare b.json] [--baseline-samples 베이스g.json]\n" +
      "         [--samples s.json] [--out 디렉터리] [--include-needle64k] [--label 이름]"
    );
    process.exit(2);
  }

  const bEasyP = opt("--baseline-easy", 기준선기본.easy), bHardP = opt("--baseline-hard", 기준선기본.hard);
  const kevBaseP = opt("--kev-base", ""), b표본P = opt("--baseline-samples", "");
  // ⚠ bare 파일은 **한 번만** 읽는다 — --samples 기본값이 --samples-bare라, 두 번 읽으면 배열이 둘이 되어
  //   잘림(⑤)을 두 번 센다(같은 것을 두 번 세는 그 함정).
  const bare읽음 = 읽기(bareP);
  const 입력 = {
    easy: 읽기(easyP), hard: 읽기(hardP), kev: 읽기(kevP),
    samples: samplesP === bareP ? bare읽음 : 읽기(samplesP),
    표본grounded: 읽기(groundedP), 표본방해만: 읽기(방해만P), 표본맨질문: bare읽음,
  };
  const 기준 = { easy: 읽기(bEasyP), hard: 읽기(bHardP), kev: 읽기(kevBaseP), 표본grounded: 읽기(b표본P) };
  const r = 판정(입력, 기준, {
    needle64k포함: args.includes("--include-needle64k"),
    kev라벨: opt("--kev-label", null),
    이름표: opt("--label", path.basename(easyP || hardP || "")),
  });

  const 표 = 표만들기(r, {
    표본수: Array.isArray(입력.samples) ? 입력.samples.length : null,
    표본한글: 표본한글평균(입력.samples),
    표본인용: 표본인용률(입력.samples),
    표본조건: { grounded: 입력.표본grounded, "distractor-only": 입력.표본방해만, bare: 입력.표본맨질문 },
    // 같은 파일을 두 인자로 준 경우(--samples 기본값이 --samples-bare) 한 줄만 적는다.
    원천: [...new Set([easyP, hardP, groundedP, 방해만P, bareP, samplesP, kevP, kevBaseP && `베이스 kev ${kevBaseP}`, b표본P && `베이스 표본 ${b표본P}`, `기준선 ${bEasyP}`, `기준선 ${bHardP}`].filter(Boolean))],
  });
  console.log(표);

  const out = opt("--out", "");
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "gate.json"), JSON.stringify(r, null, 2));
    fs.writeFileSync(path.join(out, "gate.md"), 표);
    console.log(`판정 파일: ${path.join(out, "gate.json")} · ${path.join(out, "gate.md")}`);
  }
  process.exit(r.합격 ? 0 : 1);
}
