#!/usr/bin/env node
// tools/team-bench/material-r5.mjs — 회전 5 재료 빌더(계획서 §12.12·§12.13).
//
// 무엇을 하나: 회전 4의 재료(raft-vuln-v4 956행)를 **다시 고른다.** 새로 굽지 않는다 —
// 굽는 쪽(tools/build-raft-dataset.mjs)은 운영 4000에 로그인해야 하고, 회전 5가 바꾸려는 것은
// 「무엇을 넣느냐」이지 「어떻게 굽느냐」가 아니다(레시피는 변수 둘·판 둘로 고정했다).
//
// ■ 이 파일이 지키는 세 가지
//   ① **등급 O만 나간다.** 사장님 결정 ②ⓑ(2026-09-10) — C 1,597건은 학습에서 뺀다.
//      판정은 **두 잣대의 합집합**이다(하나만 쓰면 서로의 사각지대가 남는다 — 실측 2026-09-10):
//        · 질문 해시 : 행의 question = 승인 문답의 원질문 → 그 문답 문서의 등급(운영 sqlite documentId→grade)
//        · 창 해시   : 행의 근거 블록·답에 **C 승인문답 본문**이 40자 창으로 두 곳 이상 실렸는가
//      질문 해시만 쓰면 긴 형식(D) 행처럼 질문이 승인 문답에 없는 행을 **원리상 못 본다**
//      (실측: v4의 미매칭 151행 · 그중 창 해시가 잡아낸 C 근거 109행).
//   ② **모든 행에 grade 칸이 있다.** 칸이 없으면 그 행은 「모른다」이고, 모르는 것은 안 내보낸다
//      (fail-closed). 등급을 못 읽은 행을 조용히 통과시키면 감시가 감시가 아니다.
//   ③ **한국어 원천 비중**을 재고, 목표에 못 미치면 영어 원천 행을 **결정적으로** 덜어 낸다.
//      회전 1~4의 한글 하락 뿌리 하나가 재료 언어 구성이었다(§12.12 뿌리 ③).
//
// ⚠ 정직하게 — 이 빌더는 **덜어 내기만** 한다. v4가 이미 떨어뜨린 한국어 행은 되살릴 수 없다.
//   그래서 복사비율 언어별 상한(한 0.7 · 영 0.6)은 v4 입력에서는 **아무 행도 안 자른다**
//   (v4가 이미 0.6 상한을 지난 판이라). 이 상한은 다음에 **새로 구울 때** 값을 하는 관문이고,
//   지금은 「걸어 두고 0건」임을 보고서에 숫자로 적는다. 안 적으면 「했다」가 거짓이 된다.
//
// 쓰는 법:
//   node tools/team-bench/material-r5.mjs --base <v4.json> --grade-map <grade-map.json> \
//     --cwin <cwin.json> [--prompt-spec tools/team-bench/prompt-spec.json] \
//     [--holdout-n 100] [--min-hangul 0.5] [--out <v5.json>] [--holdout-out <f>] [--report <f>]
//   --dry-run : 세기만 하고 파일을 안 쓴다.
//
// 나가는 코드: 0=성립 · 1=등급 관문 불합격(C가 남았거나 grade 칸이 없다) · 2=쓰는 법 틀림.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));

// 저장소 도구를 부르는 자리는 **경로를 갈아 끼울 수 있게** 둔다 — 이 파일은 gb10의 저장소 밖
// (~/bench/ladder/r5)에서도 돌기 때문이다. 기본값은 저장소 안 제자리라 win에서는 그냥 돌아간다.
const 잣대경로 = process.env.GIJO_GATES || path.join(여기, "gates.mjs");
const 빌더경로 = process.env.GIJO_RAFT_BUILDER || path.join(여기, "..", "build-raft-dataset.mjs");
const { 베낀글자비율여럿, 제품거절문장 } = await import(pathToFileURL(잣대경로).href);
const { 문항정규화, 근거조각뽑기, 근거블록있나 } = await import(pathToFileURL(빌더경로).href);

// ── 등급 잣대 ────────────────────────────────────────────────────────────

/** 질문 열쇠 — **빌더의 문항정규화 그 함수**를 쓴다. 여기 다시 적으면 열쇠가 두 벌이 되어 조용히 갈린다. */
export const 질문해시 = (q) => crypto.createHash("sha256").update(문항정규화(q), "utf8").digest("hex").slice(0, 16);

/** 창 해시 규격 — 등급 C 본문을 **본문 없이** 알아보는 열쇠. 값은 셋 다 짝 시험이 못 박는다. */
export const 창길이 = 40;
/**
 * 찾을 때의 걸음 = **1**.
 *
 * ★ 왜 1인가 — 자리 어긋남 함정(2026-09-10에 밟고 시험이 잡았다). C 창 집합은 **그 문서 본문의**
 *   0·20·40…자리에서 떴는데, 재료 행에서는 그 본문이 **아무 자리에서나** 시작한다(팀원 프롬프트와
 *   머리말이 앞에 붙는다). 찾는 쪽이 10자씩 건너뛰면, 시작 자리가 10의 배수가 아닌 행은
 *   **원리상 한 창도 못 맞춘다** — 있는데 없다고 답하는 감시가 된다. 1자씩 훑어야 모든 자리를 덮는다.
 * ⚠ 값이 조금 비싸다(행 하나에 글자 수만큼 sha1). 재료가 1,000행·3,000자면 300만 번인데,
 *   이 일은 **굽기 전 한 번**이라 그 값을 치른다. 빨리 틀리는 것보다 느리게 맞는 편이 낫다.
 */
export const 창걸음 = 1;
export const 창최소적중 = 2; // 한 창만 겹치는 것은 정형 문구일 수 있다 — 둘 이상이라야 「그 문서에서 왔다」

export const 창정규화 = (s) => String(s ?? "").replace(/\s+/g, "");

/**
 * 이 파일이 쓰는 **잣대의 지문** — 산출물(보고서)에 함께 적는다.
 *
 * ★ 왜 필요한가(2026-09-10 검토관 적발): 회전 5의 첫 v5는 **창걸음 10이던 옛 도구**가 구웠는데,
 *   걸음을 1로 고친 뒤 **다시 굽지 않았다.** 보고서에는 「관문 통과 · 글이C 0」이 그대로 남아
 *   지금 잣대로 재면 105행이 빨강인 판을 초록이라 말했다. 산출물에 잣대를 적어 두면, 잣대가
 *   바뀌는 날 짝 시험이 **옛 판을 옛 판이라 부른다** — 「고쳤다」와 「다시 구웠다」를 가른다.
 */
export const 잣대지문 = () => ({
  창길이, 창걸음, 창최소적중, 질문열쇠: "sha256/16", 창열쇠: "sha1/12",
});

/** 행 묶음의 등급 분포 — 「이 파일에 C가 몇 행인가」를 **한 잣대로** 세는 자리. */
export function 등급세기(rows, 지도, 창집합) {
  const c = {};
  for (const r of rows ?? []) { const g = 등급판정(r, 지도, 창집합); c[g] = (c[g] ?? 0) + 1; }
  return c;
}

/** 글에서 C 창이 몇 개나 걸리나(최소적중에 닿으면 바로 멈춘다 — 세는 것이 목적이 아니라 가르는 것이다). */
export function 창적중수(text, 창집합) {
  const t = 창정규화(text);
  const 본 = new Set();
  for (let i = 0; i + 창길이 <= t.length; i += 창걸음) {
    const h = crypto.createHash("sha1").update(t.slice(i, i + 창길이), "utf8").digest("hex").slice(0, 12);
    if (창집합.has(h)) {
      본.add(h);
      if (본.size >= 창최소적중) return 본.size;
    }
  }
  return 본.size;
}

/**
 * 행 하나의 등급 — "O" | "C" | "미매칭" | "?" .
 * ⚠ **모르면 O가 아니다.** 미매칭(승인 문답에 그 질문이 없다)·?(문서가 아직 반입 안 됨)는
 *   O가 아니라 「모른다」이고, 아래 고르기()가 안 싣는다. 모르는 것을 실으면 감시가 헛돈다.
 */
export function 등급판정(row, 지도, 창집합) {
  if (창집합 && (창적중수(row?.system, 창집합) >= 창최소적중 || 창적중수(row?.answer, 창집합) >= 창최소적중)) return "C";
  const g = 지도?.[질문해시(row?.question)];
  return g === undefined ? "미매칭" : g;
}

/**
 * **반출 감시** — 재료 파일이 학습에 나가도 되는가. 이 함수가 이 저장소의 잣대 한 곳이다.
 *   · grade 칸이 없는 행이 하나라도 있으면 불합격(fail-closed)
 *   · grade 가 "O"가 아닌 행이 하나라도 있으면 불합격
 *   · 창집합을 주면 **글로도** 다시 본다(칸은 O라 적어 놓고 C 본문이 실린 행을 잡는다)
 * ⚠ 칸만 보고 통과시키면, 칸을 잘못 적은 빌더를 감시가 그대로 통과시킨다 — 그래서 둘 다 본다.
 */
/**
 * 참고 자료 블록을 **번호별로** 나눈다 — 「[n] 《문서》 본문」과 「[n] 본문」 두 꼴을 같이 읽는다.
 * ⚠ 두 꼴인 이유: 제목 붙이기(제목맞추기)를 켠 판(v6)과 안 켠 판(v4·v5)이 둘 다 남아 있다.
 *   한 꼴만 읽으면 다른 판을 **전부 「인용 없음」으로 오판**한다(실측: 《》만 읽는 그물로 v4를 재니
 *   531건 전부가 거짓 빨강이었다).
 */
export function 블록나누기(system) {
  const t = String(system ?? "");
  const 자리 = [];
  const re = /(?:^|\n)\[(\d+)\]\s*(?:《[^》]*》)?/g;
  let m;
  while ((m = re.exec(t))) 자리.push({ n: m[1], 시작: m.index + m[0].length });
  const 블록 = new Map();
  for (let i = 0; i < 자리.length; i += 1) {
    const 끝 = i + 1 < 자리.length ? 자리[i + 1].시작 : t.length;
    if (!블록.has(자리[i].n)) 블록.set(자리[i].n, t.slice(자리[i].시작, 끝));
  }
  return 블록;
}

/** 답에 달린 제품 규약 인용 「[n]에 따르면 "X"」를 모두 뽑는다. */
export const 제품인용들 = (answer) => [...String(answer ?? "").matchAll(/\[(\d+)\]에 따르면\s*"([^"]{5,})"/g)]
  .map((m) => ({ 번호: m[1], 인용: m[2] }));

/**
 * 인용 관문 — 답이 「[n]에 따르면」이라 적은 인용이 **그 번호의 블록에 그대로 있나**.
 *
 * ■ 왜 이 관문이 생겼나 (2026-09-10 저녁 · 검토관 적발)
 *   번호를 매기는 자(build-raft-dataset.mjs 블록번호찾기)는 **20자 겹침**으로 블록을 고른다. 그래서
 *   인용 전체가 그 블록에 없어도 20자만 겹치면 번호가 붙는다. 실측으로 그 자리가 사람을 속였다 —
 *   승인 답의 인용 "knownRansomwareCampaignUse: Known"이 [1]에 붙었는데, [1] 블록은 같은 항목을
 *   **Unknown**이라 적고 있었다(홀드아웃 2행 · raft-vuln-v4 4행). 값이 정반대인 인용을 「근거에 따르면」이라
 *   부르는 법을 가르치는 셈이다.
 *   제품 가드(citeguard)는 20자 겹침이 잣대라 이런 인용을 **안 뗀다** — 그러니 재료 쪽에서 막는다.
 *
 * ⚠ 잣대는 **글자 그대로 들어 있나**다(공백만 걷어낸다). 20자 겹침이 아니다 — 그 잣대가 이 결함을 낸 자다.
 */
export function 인용관문(rows) {
  const 목록 = Array.isArray(rows) ? rows : [];
  let 인용 = 0, 맞음 = 0;
  const 번호틀림 = [], 없음 = [];
  목록.forEach((r, i) => {
    const 블록 = 블록나누기(r?.system);
    for (const { 번호, 인용: q } of 제품인용들(r?.answer)) {
      인용 += 1;
      const 글 = 창정규화(q);
      if (블록.has(번호) && 창정규화(블록.get(번호)).includes(글)) { 맞음 += 1; continue; }
      const 다른칸 = [...블록.entries()].filter(([, v]) => 창정규화(v).includes(글)).map(([k]) => k);
      if (다른칸.length) 번호틀림.push({ 자리: i, 적힌번호: 번호, 실제: 다른칸.join(","), 인용: q.slice(0, 60) });
      else 없음.push({ 자리: i, 적힌번호: 번호, 인용: q.slice(0, 60) });
    }
  });
  const 사유 = [];
  if (번호틀림.length) 사유.push(`인용이 **다른 번호의 블록**에서 온 행 ${번호틀림.length}건(예: 자리 ${번호틀림.slice(0, 3).map((x) => x.자리).join(", ")}) — [n]이 남의 조각을 가리킨다`);
  if (없음.length) 사유.push(`인용이 **참고 자료 어디에도 그대로 없는** 행 ${없음.length}건(예: 자리 ${없음.slice(0, 3).map((x) => x.자리).join(", ")}) — 근거가 반대말을 하고 있을 수 있다`);
  return { ok: 사유.length === 0, 사유, 인용, 맞음, 번호틀림: 번호틀림.length, 없음: 없음.length, 걸린행: [...번호틀림, ...없음] };
}
/**
 * 겹침 관문 — 학습 재료가 **시험 문항을 물고 있나**(2026-09-10 저녁 · 검토관 적발).
 *
 * ■ 왜 (먹이는 자리에) 필요한가
 *   빌더는 「시험지를 먼저 떼고 남은 것으로 굽는다」는 차례로 이것을 지킨다. 그런데 그 차례를 안 지나는
 *   경로가 있다 — 이미 구워진 재료 파일을 집어 학습기에 바로 먹이는 길, 그리고 등급을 모르는 옛 빌더가
 *   재료를 **다시 굽는** 길(day2-train.sh ① 단계). 그 길로 새면 시험이 재는 것이 「배웠나」가 아니라
 *   **「외웠나」**가 되는데, 손실 값은 오히려 좋아 보인다 — 그래서 아무도 눈치채지 못한다.
 *
 * 잣대는 **질문 열쇠**(질문해시)다 — 공백·문장부호가 달라도 같은 문항이면 같은 열쇠다.
 */
export function 겹침관문(rows, 시험행들, 이름 = "시험 문항") {
  const 재료 = Array.isArray(rows) ? rows : [];
  const 시험 = Array.isArray(시험행들) ? 시험행들 : [];
  const 시험열쇠 = new Set(시험.map((r) => 질문해시(r?.question ?? "")));
  const 걸린 = [];
  재료.forEach((r, i) => { if (시험열쇠.has(질문해시(r?.question ?? ""))) 걸린.push(i); });
  const 사유 = 걸린.length
    ? [`**${이름}** ${걸린.length}건이 재료에 들어 있다(예: 자리 ${걸린.slice(0, 3).join(", ")}) — 그 시험은 「배웠나」가 아니라 「외웠나」를 잰다`]
    : [];
  return { ok: !걸린.length, 사유, 겹침: 걸린.length, 자리: 걸린.slice(0, 20), 시험문항: 시험열쇠.size };
}
export function 등급관문(rows, 창집합 = null) {
  const 사유 = [];
  const 목록 = Array.isArray(rows) ? rows : [];
  const 칸없음 = [], 등급아님 = [], 글이C = [];
  목록.forEach((r, i) => {
    const g = r?.grade;
    if (g === undefined || g === null || String(g).trim() === "") { 칸없음.push(i); return; }
    if (String(g) !== "O") { 등급아님.push(i); return; }
    if (창집합 && (창적중수(r?.system, 창집합) >= 창최소적중 || 창적중수(r?.answer, 창집합) >= 창최소적중)) 글이C.push(i);
  });
  if (!목록.length) 사유.push("행이 하나도 없다 — 빈 재료는 통과가 아니라 미측정이다");
  if (칸없음.length) 사유.push(`grade 칸이 없는 행 ${칸없음.length}건(예: ${칸없음.slice(0, 3).join(", ")}) — 모르는 등급은 O가 아니다`);
  if (등급아님.length) 사유.push(`등급이 O가 아닌 행 ${등급아님.length}건(예: ${등급아님.slice(0, 3).join(", ")})`);
  if (글이C.length) 사유.push(`칸은 O인데 **글에 등급 C 본문**이 실린 행 ${글이C.length}건(예: ${글이C.slice(0, 3).join(", ")})`);
  // ★ 인용 관문을 **여기서** 부른다(2026-09-10 저녁). 따로 부르게 두면 부르는 것을 잊는 경로가 생기고,
  //   그것이 이 저장소가 반복해 밟은 「만드는 쪽에만 관문을 둔다」의 다음 판이다.
  const 인용 = 인용관문(목록);
  사유.push(...인용.사유);
  return {
    ok: 사유.length === 0, 사유, 칸없음: 칸없음.length, 등급아님: 등급아님.length, 글이C: 글이C.length,
    인용: { 셈: 인용.인용, 맞음: 인용.맞음, 번호틀림: 인용.번호틀림, 없음: 인용.없음, 걸린행: 인용.걸린행.slice(0, 20) },
    행: 목록.length,
  };
}

// ── 언어·복사 잣대 ───────────────────────────────────────────────────────

/** 글자 중 한글 비율(글자가 아닌 것은 셈에서 뺀다 — 숫자·기호가 많은 답이 부당하게 낮아지지 않게). */
export function 한글비율(s) {
  const 글자 = [...String(s ?? "")].filter((c) => /[\p{L}]/u.test(c));
  if (!글자.length) return 0;
  return 글자.filter((c) => /[가-힣]/.test(c)).length / 글자.length;
}

/**
 * 행의 **원천 언어** — 근거 조각(그 행이 배우는 원천)의 한글 비율로 가른다.
 * ⚠ 답이 아니라 **원천**을 보는 이유: 회전 1~4의 실측 결함은 「영문 원천을 한국어로 답하게 배운 행」이
 *   아니라 「원천 자체가 영어라 답도 영어로 흘러간 행」이었다(§12.12 뿌리 ③). 근거 블록이 없는 행은
 *   답으로 판단한다(그 행이 배우는 원천이 답뿐이다).
 */
export function 원천언어(row, 머리말) {
  const 조각들 = 근거블록있나(row?.system, 머리말) ? 근거조각뽑기(row?.system, 머리말) : [];
  const 글 = 조각들.length ? 조각들.join("\n") : String(row?.answer ?? "");
  return { 언어: 한글비율(글) >= 0.5 ? "ko" : "en", 한글: 한글비율(글), 조각수: 조각들.length };
}

/** 복사비율 상한 — 언어별. 한국어 원천이 상한에 더 자주 걸려 통째로 걸러지던 것을 되돌린다(§12.12 뿌리 ③). */
export const 복사상한 = { ko: 0.7, en: 0.6 };

/** 그 행이 근거를 얼마나 베꼈나 — 관문 ⑫와 **같은 함수**로 잰다(잣대는 gates.mjs 한 곳). */
export function 베낀비율행(row, 머리말) {
  const 조각들 = 근거블록있나(row?.system, 머리말) ? 근거조각뽑기(row?.system, 머리말) : [];
  if (!조각들.length) return null;
  return 베낀글자비율여럿(row?.answer, 조각들);
}

/**
 * **사실 주장 행인가** — 밤에 27B로 되물을 대상을 고른다.
 * 왜 고르나: 27B 되묻기는 GPU를 쓰고 밤에만 돌 수 있어 전 행을 못 본다. 틀리면 값이 비싼 것부터 본다 —
 * 발표 주체·연도·번호·수치처럼 **틀렸는지 기계가 나중에 셀 수 있는** 주장들이다.
 */
export const 사실표식 = [
  /CVE-\d{4}-\d{3,7}/i, /KEV|Known Exploited/i, /CISA|KISA|과기정통부|국정원|NIST|MITRE|OWASP/i,
  /\b(19|20)\d{2}년?\b/, /\d+(\.\d+)?\s?(%|건|개|일|시간|점|GB|MB)/,
];
export function 사실주장인가(row) {
  const a = String(row?.answer ?? "");
  return 사실표식.some((re) => re.test(a));
}

/**
 * **거절로 시작하는 행인가** — 관문 ⑬이 재는 그 꼴을 재료 쪽에서 미리 센다.
 * ★ 왜 세나(2026-09-10 실측): 회전 4 재료 956행 중 거절 시작은 425행(44%)인데, 등급 O만 남기면
 *   229행 중 167행(73%)이 된다 — 즉 **등급으로 거르는 일이 재료의 성격을 바꾼다.** 회전 3이 깨진
 *   자리가 바로 「근거를 줬는데 거절부터 한다」(⑬)라, 그 비중을 모르고 구우면 재료가 그 회귀를
 *   **직접 가르친다.** 굽기 전에 숫자로 보이게 한다.
 * ⚠ 잣대는 gates.mjs의 제품거절문장 하나다(제품 llm.ts의 그 문장) — 여기 다시 적지 않는다.
 */
export const 거절로시작하나 = (row) => String(row?.answer ?? "").trim().startsWith(제품거절문장);

// ── 고르기 ──────────────────────────────────────────────────────────────

/** 결정적 순서 — 같은 입력이면 같은 판이 나와야 「이 판으로 구웠다」가 뜻을 갖는다(무작위 금지). */
const 순서키 = (row) => crypto.createHash("sha1").update(문항정규화(row?.question) + " " + String(row?.answer ?? ""), "utf8").digest("hex");

/**
 * 회전 5 재료 고르기.
 * @returns { 재료, 홀드아웃, 보고 }
 */
export function 고르기(rows, { 지도, 창집합, 머리말, 목표한글 = 0.5, 홀드아웃수 = 100, 홀드아웃질문 = new Set() }) {
  const 통계 = { 입력: rows.length, 등급: {}, 제외: {}, 언어: { ko: 0, en: 0 }, 복사제외: { ko: 0, en: 0 } };
  const 센다 = (칸, 키) => { 통계[칸][키] = (통계[칸][키] ?? 0) + 1; };

  const 후보 = [];
  for (const r of rows) {
    const g = 등급판정(r, 지도, 창집합);
    센다("등급", g);
    if (g !== "O") { 센다("제외", `등급 ${g}`); continue; }
    if (홀드아웃질문.has(문항정규화(r.question))) { 센다("제외", "옛 홀드아웃 문항"); continue; }
    const { 언어, 한글, 조각수 } = 원천언어(r, 머리말);
    const cp = 베낀비율행(r, 머리말);
    if (cp !== null && cp > 복사상한[언어] + 1e-9) { 센다("제외", `복사비율 상한(${언어} ${복사상한[언어]})`); 통계.복사제외[언어] += 1; continue; }
    후보.push({ ...r, grade: "O", _언어: 언어, _한글: 한글, _조각수: 조각수, _복사: cp, _키: 순서키(r) });
  }
  후보.sort((a, b) => (a._키 < b._키 ? -1 : a._키 > b._키 ? 1 : 0));
  후보.forEach((r) => { 통계.언어[r._언어] += 1; });

  // 한국어 원천 비중 맞추기 — 영어 원천 행을 **뒤에서부터**(결정적 순서의 끝) 덜어 낸다.
  const ko = 후보.filter((r) => r._언어 === "ko");
  const en = 후보.filter((r) => r._언어 === "en");
  let 남길en = en.length;
  if (후보.length && ko.length / 후보.length < 목표한글) {
    // ko / (ko + en') >= 목표  →  en' <= ko(1-목표)/목표
    남길en = Math.max(0, Math.floor((ko.length * (1 - 목표한글)) / 목표한글));
  }
  const 덜어낸en = en.length - 남길en;
  const 고른 = [...ko, ...en.slice(0, 남길en)].sort((a, b) => (a._키 < b._키 ? -1 : 1));

  // 홀드아웃 — **질문 단위**로 통째 뗀다(반쪽을 떼면 같은 질문이 양쪽에 남아 「외웠나」를 재게 된다).
  const 뭉치 = new Map();
  for (const r of 고른) {
    const q = 문항정규화(r.question);
    if (!뭉치.has(q)) 뭉치.set(q, []);
    뭉치.get(q).push(r);
  }
  const 질문차례 = [...뭉치.keys()].sort((a, b) => {
    const ha = crypto.createHash("sha1").update(a, "utf8").digest("hex");
    const hb = crypto.createHash("sha1").update(b, "utf8").digest("hex");
    return ha < hb ? -1 : 1;
  });
  const 홀드질문 = new Set();
  let 센수 = 0;
  for (const q of 질문차례) {
    if (센수 >= 홀드아웃수) break;
    홀드질문.add(q);
    센수 += 뭉치.get(q).length;
  }
  const 벗기기 = (r) => { const { _언어, _한글, _조각수, _복사, _키, ...나머지 } = r; return 나머지; };
  const 홀드아웃 = 고른.filter((r) => 홀드질문.has(문항정규화(r.question))).map(벗기기);
  const 재료 = 고른.filter((r) => !홀드질문.has(문항정규화(r.question))).map(벗기기);

  const 한글행 = (목록) => 목록.filter((r) => 원천언어(r, 머리말).언어 === "ko").length;
  const 보고 = {
    ...통계,
    후보: 후보.length,
    한국어원천: { 후보: ko.length, 영어후보: en.length, 덜어낸영어: 덜어낸en, 목표: 목표한글 },
    재료: {
      행: 재료.length, 한국어원천: 한글행(재료), 사실주장: 재료.filter(사실주장인가).length,
      거절시작: 재료.filter(거절로시작하나).length,
      입력거절시작: rows.filter(거절로시작하나).length,
    },
    홀드아웃: { 행: 홀드아웃.length, 질문: 홀드질문.size, 요청: 홀드아웃수 },
  };
  보고.재료.한국어비중 = 재료.length ? 보고.재료.한국어원천 / 재료.length : 0;
  return { 재료, 홀드아웃, 보고 };
}

/** 사람이 읽는 구성 표 — 「무엇을 왜 뺐나」가 한 장에 보여야 한다. */
export function 구성표(보고) {
  const 줄 = (k, v) => `| ${k} | ${v} |`;
  return [
    "| 칸 | 값 |", "|---|---|",
    줄("입력 행", 보고.입력),
    ...Object.entries(보고.등급).map(([k, v]) => 줄(`등급 ${k}`, v)),
    ...Object.entries(보고.제외).map(([k, v]) => 줄(`제외 — ${k}`, v)),
    줄("후보(등급 O · 상한 통과)", 보고.후보),
    줄("한국어 원천 후보", `${보고.한국어원천.후보} · 영어 ${보고.한국어원천.영어후보} · 덜어낸 영어 ${보고.한국어원천.덜어낸영어}`),
    줄("재료 행", `${보고.재료.행} (한국어 원천 ${보고.재료.한국어원천} · ${(보고.재료.한국어비중 * 100).toFixed(1)}%)`),
    줄("사실 주장 행(27B 되묻기 대상)", 보고.재료.사실주장),
    줄("거절로 시작하는 행", `${보고.재료.거절시작} (${보고.재료.행 ? (보고.재료.거절시작 / 보고.재료.행 * 100).toFixed(1) : "0"}%) · 입력 ${보고.재료.입력거절시작}/${보고.입력} (${(보고.재료.입력거절시작 / 보고.입력 * 100).toFixed(1)}%)`),
    줄("홀드아웃", `${보고.홀드아웃.행}행 / 질문 ${보고.홀드아웃.질문} (요청 ${보고.홀드아웃.요청})`),
    "",
    보고.홀드아웃.요청 > 0
      ? `⚠ **이 판은 재료에서 새 시험지를 뗐다**(요청 ${보고.홀드아웃.요청}행 · 실제 ${보고.홀드아웃.행}행 / 질문 ${보고.홀드아웃.질문}). 회전 간 eval_loss를 견주려면 시험지가 같아야 하므로, 옛 고정 파일을 쓰려면 --holdout-n 0 으로 돌려라.`
      : "⚠ **홀드아웃 제외 기준은 하나다** — 「홀드아웃 파일에 든 질문」(--holdout-in). 이 판은 새로 떼지 않았다 — 회전 4까지의 두 갈래(그 회전 안에서 떼기 · 파일로 고정)를 섞지 않는다.",  ].join("\n");
}

// ── 직접 실행 ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("material-r5.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const baseP = opt("--base", ""), mapP = opt("--grade-map", ""), cwinP = opt("--cwin", "");
  if (!baseP || !mapP) {
    console.error("쓰는 법: node tools/team-bench/material-r5.mjs --base <v4.json> --grade-map <grade-map.json> [--cwin <cwin.json>]\n" +
      "         [--prompt-spec tools/team-bench/prompt-spec.json] [--holdout-in <옛 홀드아웃>] [--holdout-n 100]\n" +
      "         [--min-hangul 0.5] [--out <v5.json>] [--holdout-out <f>] [--report <f>] [--dry-run]");
    process.exit(2);
  }
  const 읽기 = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const rows = 읽기(baseP);
  const 지도 = 읽기(mapP).map ?? 읽기(mapP);
  const 창집합 = cwinP ? new Set(읽기(cwinP).windows) : null;
  const specP = opt("--prompt-spec", path.join(여기, "prompt-spec.json"));
  const 머리말 = 읽기(specP).ragHeader;
  if (!머리말) { console.error(`✗ 규격 파일에 ragHeader가 없다: ${specP}`); process.exit(2); }
  const 옛홀드 = opt("--holdout-in", "");
  const 홀드아웃질문 = new Set(옛홀드 && fs.existsSync(옛홀드) ? 읽기(옛홀드).map((r) => 문항정규화(r.question)) : []);

  // 홀드아웃수 0 = **새 시험지를 만들지 않는다**(옛 고정 홀드아웃 파일을 그대로 쓴다는 뜻).
  // 회전 간 eval_loss를 견주려면 시험지가 같아야 하므로, 이 자리를 0으로 두는 것이 **기본값**이다.
  // ⚠ 2026-09-10 검토관 적발: 주석은 「0이 기본 선택」이라 적어 놓고 코드 기본값은 100이었다.
  //   깃발을 빼고 돌리면 재료에서 새 시험지를 통째로 떼어 내(v4 기준 재료 124행 → 24행) 두 갈래를
  //   섞는데, 그 판에서도 구성표는 「기준은 하나다」를 그대로 찍었다. 기본값을 말과 맞추고,
  //   구성표가 **어느 갈래를 썼는지** 말하게 했다(위 구성표()).
  const 홀드아웃수 = Number(opt("--holdout-n", "0"));
  const { 재료, 홀드아웃, 보고 } = 고르기(rows, {
    지도, 창집합, 머리말,
    목표한글: Number(opt("--min-hangul", "0.5")),
    홀드아웃수,
    홀드아웃질문,
  });

  // ★ 스스로 만든 것을 스스로의 감시에 건다 — 「빌더가 C를 쓰면 빨강」이 여기서 성립한다.
  const 관문 = 등급관문(재료, 창집합);
  const 홀드관문 = 홀드아웃수 > 0 ? 등급관문(홀드아웃, 창집합) : { ok: true, 사유: [], 건너뜀: "홀드아웃수 0 — 옛 고정 시험지를 쓴다" };
  console.log(구성표(보고));
  console.log("");
  console.log(`등급 관문 — 재료 ${관문.ok ? "✅ 통과" : "❌ " + 관문.사유.join(" / ")}`);
  console.log(`등급 관문 — 홀드아웃 ${홀드아웃수 > 0 ? (홀드관문.ok ? "✅ 통과" : "❌ " + 홀드관문.사유.join(" / ")) : "— 새로 안 뗀다(옛 고정 시험지 사용)"}`);

  const dry = args.includes("--dry-run");
  const outP = opt("--out", ""), holdP = opt("--holdout-out", ""), repP = opt("--report", "");
  if (!dry && (관문.ok && 홀드관문.ok)) {
    if (outP) { fs.mkdirSync(path.dirname(outP), { recursive: true }); fs.writeFileSync(outP, JSON.stringify(재료, null, 2)); console.log(`재료: ${outP}`); }
    if (holdP) { fs.mkdirSync(path.dirname(holdP), { recursive: true }); fs.writeFileSync(holdP, JSON.stringify(홀드아웃, null, 2)); console.log(`홀드아웃: ${holdP}`); }
    if (repP) {
      fs.mkdirSync(path.dirname(repP), { recursive: true });
      // ★ 잣대와 **산출물 지문**을 함께 적는다 — 보고서만 남고 판이 갈리는 일을 막는다.
      const 지문 = (p2) => (p2 && fs.existsSync(p2) ? crypto.createHash("sha256").update(fs.readFileSync(p2)).digest("hex").slice(0, 16) : null);
      fs.writeFileSync(repP, JSON.stringify({
        만든때: new Date().toISOString(), 입력: baseP, 규격: specP,
        잣대: 잣대지문(), 산출물: { 재료: outP || null, 재료지문: 지문(outP), 홀드아웃: holdP || null, 홀드아웃지문: 지문(holdP) },
        보고, 관문, 홀드관문,
      }, null, 2));
      console.log(`보고서: ${repP}`);
    }
  } else if (!dry) {
    console.error("✗ 등급 관문 불합격 — 파일을 쓰지 않는다(C가 섞인 재료를 굽는 것이 이 회전이 막으려는 그것이다)");
  }
  process.exit(관문.ok && 홀드관문.ok ? 0 : 1);
}
