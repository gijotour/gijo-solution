#!/usr/bin/env node
// tools/build-raft-dataset.mjs — RAFT형 학습 데이터 빌더 (증류 사다리 ②, 계획서 §12)
//
// 무엇을 만드나: 사람이 **승인한 문답**(👍)에 그 답이 인용한 **근거 조각**을 되찾아 붙이고,
// 같은 업무영역의 **방해 조각**을 섞어, 학습 행 하나를 이렇게 만든다.
//
//   system  = <팀원 system 프롬프트> \n\n <참고 자료 블록: [1] 정답조각 [2] 방해조각 …(순서 섞음)>
//   question = 담당자가 실제로 물은 **원질문 그대로**(짧다)
//   answer   = 승인된 답(근거를 인용한 글)
//
// ★ 왜 근거를 question이 아니라 system에 싣나 — 제품 추론이 그렇게 싣기 때문이다
//   (llm.ts systemContent = [systemPromptFor, grounding, rag, 첨부].join("\n\n")).
//   배우는 자리와 쓰는 자리가 다르면 모델은 배운 것을 못 꺼낸다. 게다가 맥락을 질문에 이어 붙이면
//   위생의 **시험 문항 대조가 통째로 헛돈다**(질문 전체 일치로 보는데 질문이 길어지므로 —
//   datasethygiene.ts의 오케스트레이터 시드 계보). 그래서 질문은 원질문 그대로 둔다.
//
// ★ 왜 방해 조각을 섞나 — 검색이 늘 정답만 물어오지는 않는다. 정답만 보여 주며 가르치면
//   「참고 자료에 있는 것은 다 맞다」를 배운다. 섞인 자료에서 **골라 인용하는 법**을 가르치는 것이 RAFT다.
//
// 사용:
//   GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=… node tools/build-raft-dataset.mjs \
//     --name raft-vuln-v1 [--topic 취약점] [--agent normaltic] [--distractors 1] [--limit 5000] \
//     [--server http://localhost:4000] [--dry-run]
//   --dry-run : 만들기·회수율 측정까지만 하고 **저장하지 않는다**(운영에 쓰기 금지 — 읽기만 한다).
//
// ⚠ **로그인을 밀어내지 않는다**(--force-login 없음). 같은 계정으로 강제 로그인하면 돌고 있는
//   증류 세션이 끊긴다(계정당 1세션). 「이미 로그인됨」이 뜨면 그 세션이 끝나기를 기다린다.
//
// ⚠ 만든 행을 **파일로 떨구지 않는다.** 저장은 오직 POST /api/dataset/save(종류 「근거」)로 한다 —
//   그 창구가 위생(시험 문항·시점 데이터·주입 표식)을 거는 유일한 관문이기 때문이다.
//   2026-09-03 실측: gb10 수동 경로가 이 관문을 건너뛰어 **평가 게이트 문항 4건이 학습에 섞였다.**
//   행을 손에 쥐면 또 건너뛰게 된다 — 그래서 쥐지 않는다(맛보기 3행만 보고서에 남긴다).
//
// 산출: tools/team-bench/results-ladder/<name>/build-report.json
//   (회수율 · 라이선스 제외(문서별) · 행 수 · 토큰 추정 — 숫자로 말한다)
//
// 표준 라이브러리만 쓴다(toolsdeps 감시).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
export const 저장소 = path.resolve(여기, "..");

// ── 순수 함수들 (짝 시험 raftdataset.test.ts가 이 넷을 직접 부른다) ─────────────────

export const sha12 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/**
 * 근거 ref를 갈라 읽는다. 두 꼴뿐이다(설계관 실측 2026-09-03: 저장소 390건 · 파일 97건).
 *   store:<documentId>#<sha12(본문)>   ← 지식 저장소 조각(코퍼스 창구가 낸 것)
 *   <저장소 상대경로>#<sha12(본문)>     ← 저장소 문서 파일을 증류기가 자른 것
 * ⚠ documentId 자체에 ':'가 들어갈 수 있으므로(personal:…) **맨 앞 접두만** 떼고 나머지는 건드리지 않는다.
 */
export function refParse(ref) {
  const s = String(ref ?? "").trim();
  const m = s.match(/^(.*)#([0-9a-f]{12})$/i);
  if (!m) return null;
  const [, 몸통, 해시] = m;
  if (!몸통) return null;
  return 몸통.startsWith("store:")
    ? { kind: "store", id: 몸통.slice("store:".length), sha12: 해시.toLowerCase(), ref: s }
    : { kind: "file", id: 몸통, sha12: 해시.toLowerCase(), ref: s };
}

/**
 * 저장소 문서를 조각으로 자른다 — **tools/distill.mjs의 chunk()와 글자 그대로 같아야 한다.**
 * 왜: 파일 근거의 ref는 그쪽이 자른 조각의 sha12다. 자르는 규칙이 한 글자라도 다르면 해시가 안 맞아
 * 회수율이 0이 되는데, **오류는 안 나고 그냥 「못 찾음」으로 조용히 샌다.**
 * 그래서 짝 시험이 distill.mjs의 원문과 이 함수의 원문을 대조한다(raftdataset.test.ts).
 * ⚠ 손대야 하면 두 곳을 같은 커밋에서 함께 고친다.
 */
export function chunk(text, size = 800, overlap = 100) {
  // 빈 줄 없이 이어진 문서(변환된 PDF 등)는 문단 하나가 수만 자다 — 그대로 두면 한 조각이 교사 문맥(16K)을 넘긴다
  // (2026-09-03 실측: KISA 가이드 조각이 149,612토큰으로 교사 400). 긴 문단은 문장 경계에서 size로 다시 자른다.
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).flatMap((p) => {
    if (p.length <= size * 2) return [p];
    const out = []; let buf = "";
    for (const s of p.split(/(?<=[.!?。]|다\.|니다\.)\s+/)) {
      if ((buf + " " + s).length > size && buf) { out.push(buf); buf = s; } else buf = buf ? buf + " " + s : s;
    }
    if (buf) out.push(buf);
    return out.flatMap((c) => (c.length > size * 2 ? (c.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) || []) : [c]));
  });
  const chunks = []; let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) { chunks.push(cur); cur = cur.slice(-overlap) + "\n\n" + p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.replace(/\s/g, "").length >= 200);
}

/**
 * 라이선스 허용목록 — **우리가 배포권을 가진 글만** 학습에 넣는다(계획서 §12, AGPL 사고 계보).
 *
 * 왜 필요한가: 지식 저장소에는 타사 상용 문서·유형이 확인 안 된 공공 발간물이 함께 들어 있다.
 * 그것으로 학습한 어댑터는 **그 문장을 외운 채 고객에게 나간다** — 인용이 아니라 재배포다.
 * 「참고만 했다」는 항변이 안 통하는 자리라, 재료 단계에서 막는다.
 *
 * 허용: ① server/docs-manifest.json files[]의 문서(고객사에 나가도 되는 문서의 진실 원천)
 *       ② GIJO_* 로 시작하는 우리 글  ③ knowledge/*.md (우리가 쓴 지식 번들)
 *       ④ tools/ladder/allowed-sources.json 의 **규칙**(공개 원천·사다리 재료) — 다만 이 규칙을
 *          해석하는 것은 ladderlib뿐이라, 아래 라이선스판정기가 그쪽을 쓸 때만 산다. 내장 대비책은 ①~③만.
 * 제외: 그 밖 **전부**(fail-closed). 애매하면 안 넣는다.
 */
export function 허용목록읽기(root = 저장소) {
  const 매니페스트 = new Set();
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, "server", "docs-manifest.json"), "utf8"));
    // documentId는 파일의 **basename**이다(docsbundle.ts markDocumentsBuiltin가 그렇게 넣는다).
    for (const f of m.files ?? []) {
      const p = typeof f === "string" ? f : f?.file;
      if (p) { 매니페스트.add(path.basename(String(p))); 매니페스트.add(String(p).replace(/\\/g, "/")); }
    }
  } catch { /* 매니페스트를 못 읽으면 ②③만으로 판정한다 — 아래 보고서에 매니페스트 0으로 드러난다 */ }
  // ④ 사다리 허용목록은 **규칙 목록**이다 — `{허용:[{kind:"원천폴더", 값:[…]}, …]}`.
  //   이름 목록이 아니라서 여기서 파일 이름으로 펼칠 수 없다(kind마다 판정이 다르다).
  //   규칙을 해석하는 곳은 ladderlib 한 곳뿐이고(위 라이선스판정기), 내장 대비책은 그 파일이
  //   **있다는 사실만** 적는다 — 보고서가 「사다리가 있는데 내장으로 쟀다」를 드러내라고.
  //   ⚠ 2026-09-03 합치기에서 고침: 예전 코드는 `{allowed:[…]}`·`{files:[…]}` 꼴을 넓게 받아
  //     이름을 뽑으려 했는데, ④갈래가 실제로 만든 꼴이 `{허용:[규칙]}`이라 **늘 0건**이었다.
  //     맞는 척하는 빈 통은 「여기도 본다」고 읽히므로 없앤다(있는 척이 가장 나쁘다).
  const 사다리파일있음 = fs.existsSync(path.join(root, "tools", "ladder", "allowed-sources.json"));
  return { 매니페스트, 사다리파일있음 };
}

/**
 * 라이선스 판정기를 고른다 — **정본은 사다리(④갈래)의 ladderlib이다.**
 *
 * ★ 왜 남의 파일을 부르나: 「무엇을 학습 재료로 써도 되나」는 사다리 전체가 한 잣대로 봐야 한다.
 *   여기에 규칙을 또 적으면, 사다리 쪽에서 원천을 하나 늘렸을 때 이쪽만 조용히 막는다(또는 그 반대).
 *   그쪽 판정기는 `..` 경로 차단·store: 접두 해석까지 이미 한다 — 베끼면 그 방어까지 두 벌이 된다.
 * ⚠ 없으면 **내장 규칙으로 떨어진다**(매니페스트 + GIJO_* + knowledge/). 사다리 파일이 아직 없는
 *   기계에서도 빌더가 돌아야 하고, 떨어졌다는 사실은 보고서 `라이선스판정` 칸에 남는다 —
 *   조용히 느슨해지지 않게, 어느 잣대로 쟀는지를 숫자와 함께 적는다.
 */
export async function 라이선스판정기(root = 저장소) {
  const libPath = path.join(root, "tools", "ladder", "ladderlib.mjs");
  const 목록경로 = path.join(root, "tools", "ladder", "allowed-sources.json");
  if (fs.existsSync(libPath) && fs.existsSync(목록경로)) {
    try {
      const lib = await import(pathToFileURL(libPath).href);
      const 허용목록 = lib.허용목록읽기(목록경로);
      // docs-manifest kind는 **파일을 부르는 쪽이 읽어** 넘긴다(그쪽 계약) — 30개를 베껴 적지 않는다.
      const 매니페스트 = JSON.parse(fs.readFileSync(path.join(root, "server", "docs-manifest.json"), "utf8"));
      const 문맥 = { 매니페스트파일들: lib.매니페스트파일들(매니페스트) };
      return {
        출처: "ladderlib(사다리 허용목록)",
        판정: (식별자) => { const v = lib.허용인가(식별자, 허용목록, 문맥); return v.허용 ? null : v.왜; },
      };
    } catch (e) {
      // 못 읽으면 내장으로 떨어지되 **말은 한다** — 조용한 완화가 가장 나쁘다.
      console.warn(`[raft] ⚠ ladderlib을 못 썼습니다(${e.message}) — 내장 허용 규칙으로 판정합니다`);
    }
  }
  const 목록 = 허용목록읽기(root);
  return { 출처: "내장(매니페스트+GIJO_*+knowledge/)", 판정: (식별자) => 허용안되는이유(식별자, 목록) };
}

/**
 * 내장 허용 판정(사다리 파일이 없을 때의 대비책). 되면 null, 안 되면 **사유 문자열**을 돌려준다.
 * ⚠ 정본이 아니다 — 사다리가 있으면 위 라이선스판정기가 그쪽을 쓴다.
 */
export function 허용안되는이유(식별자, 목록) {
  const id = String(식별자 ?? "").replace(/\\/g, "/");
  const base = id.split("/").pop() ?? id;
  if (목록.매니페스트.has(id) || 목록.매니페스트.has(base)) return null;
  // ⚠ 사다리 규칙(원천폴더·재료폴더 등)은 여기서 못 본다 — 규칙 해석은 ladderlib 몫이다.
  //   그래서 이 대비책은 정본보다 **좁다**(공개 원천이 여기선 막힌다). 좁은 쪽으로 틀리는 게 맞다.
  if (/^GIJO[_-]/i.test(base)) return null;             // 우리가 쓴 글
  if (/^knowledge\//i.test(id)) return null;            // 우리가 쓴 지식 번들
  return "허용목록 밖(타사·유형 미확인)";
}

/**
 * 방해 조각 고르기 — 「그럴듯하지만 답이 아닌」 조각이라야 훈련이 된다.
 *   · 같은 업무영역(category)에서 고른다 — 딴 영역 조각은 너무 쉽게 걸러져 배울 것이 없다.
 *   · **다른 문서**에서 고른다 — 같은 문서의 이웃 조각은 정답의 연장이라 방해가 아니라 정답의 일부다.
 *   · 본문이 같은 것은 뺀다(중복 인입된 문서).
 * 고르기는 **결정적**이다(ref+씨앗 해시 정렬) — 같은 입력이면 같은 데이터셋이 나와야 지문이 뜻을 갖는다.
 */
export function 방해조각고르기(정답, 후보들, 개수, 씨앗 = "") {
  if (개수 <= 0) return [];
  const 풀 = 후보들.filter(
    (c) => c.문서 !== 정답.문서 && c.text !== 정답.text && (정답.category ? c.category === 정답.category : true)
  );
  return 풀
    .map((c) => ({ c, k: sha12(씨앗 + 정답.ref + "|" + c.ref) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, 개수)
    .map((x) => x.c);
}

/**
 * 참고 자료 블록 — **서버 llm.ts ragBlock()과 한 글자도 다르면 안 된다.**
 * 머리말은 창구(GET /api/learnloop/raft/prompt)가 준 것을 그대로 쓴다(베끼지 않는다).
 * 번호 매김만 여기서 하는데, 그 꼴이 맞는지는 창구가 함께 준 ragBlockSample과 대조해 확인한다.
 */
export function 참고자료블록(머리말, 조각들) {
  return 머리말 + "\n" + 조각들.map((c, i) => `[${i + 1}] ${c}`).join("\n");
}

/** 조각 순서를 결정적으로 섞는다 — 정답이 늘 [1]이면 「맨 앞이 정답」을 배운다. */
export function 섞기(항목들, 씨앗) {
  return 항목들
    .map((v, i) => ({ v, k: sha12(씨앗 + "#" + i + "#" + String(v).slice(0, 64)) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((x) => x.v);
}

/**
 * 토큰 추정 — 실측 기준(2026-09-03): 한국어 본문 800자 ≈ 504토큰.
 * 정확한 토크나이저를 못 부르는 자리라 **추정임을 이름으로 밝힌다**(보고서 키도 추정).
 */
export const 토큰추정 = (s) => Math.ceil(String(s ?? "").length * (504 / 800));

/** 시험 문항 정규화 — 서버 datasethygiene와 같은 규칙(공백·문장부호 제거). */
export const 문항정규화 = (s) => String(s ?? "").replace(/\s+/g, "").replace(/[?!.,·…]/g, "");

/**
 * 시험 문항 목록(사전검사용). **최종 관문은 서버다** — POST /api/dataset/save가 위생을 다시 건다.
 * 여기서 미리 빼는 이유는 왕복과 보고 숫자를 맞추기 위해서다(distill.mjs 사전검사와 같은 취지).
 * 목록을 베껴 두지 않고 **파일을 읽는다** — 시험지가 늘면 여기도 따라 는다.
 */
export function 시험문항목록(root = 저장소) {
  const out = new Set();
  const 파일들 = [
    "server/src/engine/examquestions.json",
    "tools/regress/cases.json",
    "tools/evalgate/cases/routing.json",
    "tools/evalgate/cases/safety.json",
    "tools/evalgate/cases/korean.json",
  ];
  for (const rel of 파일들) {
    try {
      const p = path.join(root, rel);
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      if (Array.isArray(raw?.문항)) { for (const q of raw.문항) out.add(String(q)); continue; }
      const rows = Array.isArray(raw) ? raw : (raw?.cases ?? []);
      for (const c of rows) { const q = c?.q ?? c?.question; if (q) out.add(문항정규화(q)); }
    } catch { /* 한 파일을 못 읽어도 나머지로 거른다 — 최종 관문은 서버다 */ }
  }
  return out;
}

/**
 * 승인 문답 + 근거 색인 → **학습 행**. 빌더의 심장이고, 여기가 곧 회수율·제외 숫자의 출처다.
 *
 * ★ main()에서 떼어 낸 이유(2026-09-03): 안에 두면 **서버가 있어야만** 검증되는데,
 *   그 서버는 이 코드가 배포된 뒤에야 생긴다 — 즉 「배포 전에는 아무도 못 재는 코드」가 된다.
 *   순수 함수로 빼서 짝 시험이 회수 실패·라이선스 제외·시험 문항·방해 없음을 전부 재현한다.
 *
 * @param 문답들  [{ id, question, answer, cites:[ref…] }]
 * @param 색인    Map<ref, { ref, text, 문서, category }>
 * @param 옵션    { 판정: (문서)=>사유|null, system, ragHeader, distractors, 씨앗, 시험 }
 * @returns { rows, 통계 }  통계 = 회수·제외·회수실패상세·라이선스제외 (보고서에 그대로 실린다)
 */
export function 행만들기(문답들, 색인, 옵션) {
  const { 판정, system: 팀원프롬프트, ragHeader, distractors = 1, 씨앗 = "", 시험 = new Set() } = 옵션;
  const 후보풀 = [...색인.values()];
  const 통계 = {
    ref총: 0,
    회수: { store: 0, file: 0, 실패: 0 },
    회수실패상세: {},
    라이선스제외: { 행: 0, 문서별: {} },
    제외: { "근거 없음": 0, "회수 실패": 0, "라이선스": 0, "시험 문항(사전검사)": 0, "방해 조각 없음": 0 },
  };
  const rows = [];
  for (const l of 문답들) {
    const refs = (l.cites ?? []).map(refParse).filter(Boolean);
    if (!refs.length) { 통계.제외["근거 없음"] += 1; continue; }
    통계.ref총 += refs.length;
    const 정답들 = [];
    for (const p of refs) {
      const hit = 색인.get(p.ref);
      if (hit) { 통계.회수[p.kind] += 1; 정답들.push(hit); }
      else {
        통계.회수.실패 += 1;
        // 문서가 재인입되면 본문이 바뀌어 해시가 안 맞는다 — 어느 문서에서 얼마나 놓쳤는지 숫자로 남긴다.
        통계.회수실패상세[p.id] = (통계.회수실패상세[p.id] ?? 0) + 1;
      }
    }
    if (!정답들.length) { 통계.제외["회수 실패"] += 1; continue; }
    // ⚠ **하나라도** 막히면 그 행을 버린다(막힌 조각만 빼지 않는다). 답은 그 조각을 인용해 쓰인 글이라,
    //   근거만 빼면 「출처 없이 남의 문장을 외운 행」이 된다 — 막으려던 것이 그대로 남는다.
    const 막힌것 = 정답들.map((c) => ({ c, why: 판정(c.문서) })).filter((x) => x.why);
    if (막힌것.length) {
      통계.제외["라이선스"] += 1; 통계.라이선스제외.행 += 1;
      for (const x of 막힌것) 통계.라이선스제외.문서별[x.c.문서] = (통계.라이선스제외.문서별[x.c.문서] ?? 0) + 1;
      continue;
    }
    if (시험.has(문항정규화(l.question))) { 통계.제외["시험 문항(사전검사)"] += 1; continue; }
    const 방해 = 방해조각고르기(정답들[0], 후보풀, distractors, 씨앗);
    // 방해를 넣기로 했는데 못 넣었으면 **그 행은 안 만든다.** 섞어서 고르는 법을 가르치려는 판에
    // 정답만 든 행이 섞이면, 그 행들은 「참고 자료는 다 맞다」를 도로 가르친다.
    if (distractors > 0 && !방해.length) { 통계.제외["방해 조각 없음"] += 1; continue; }
    const 조각들 = 섞기([...정답들.map((c) => c.text), ...방해.map((c) => c.text)], 씨앗 + l.id);
    rows.push({
      question: l.question,
      answer: l.answer,
      system: [팀원프롬프트, 참고자료블록(ragHeader, 조각들)].join("\n\n"),
    });
  }
  return { rows, 통계 };
}

// ── 여기서부터는 실행 경로(직접 실행할 때만 돈다) ─────────────────────────────

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

async function login(base, user, password) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }), redirect: "error",
  });
  const j = await r.json();
  if (!j.accessToken) {
    throw new Error(
      "로그인 실패: " + JSON.stringify(j).slice(0, 160) +
      "\n(계정당 1세션이다 — 증류가 같은 계정으로 돌고 있으면 끝날 때까지 기다린다. 밀어내지 않는다.)"
    );
  }
  return { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken };
}

async function 받기(base, 길, auth) {
  const r = await fetch(base + 길, { headers: auth, redirect: "error" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${길} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function main() {
  const NAME = String(opt("--name", "")).trim();
  const TOPIC = String(opt("--topic", "")).trim();
  const AGENT = String(opt("--agent", "normaltic")).trim();
  const DISTRACTORS = Math.max(0, Math.min(2, Number(opt("--distractors", 1))));
  const LIMIT = Math.max(1, Math.min(10000, Number(opt("--limit", 5000))));
  const SERVER = String(opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
  const DRY = has("--dry-run");
  const DATASET_ID = String(opt("--dataset-id", NAME)).trim();

  if (!NAME) { console.error("--name <이름> 이 필요합니다 (보고서 폴더·데이터셋 id로 쓰인다)"); process.exit(2); }
  // 서버 dataset.ts DATASET_ID_RE와 같은 규칙 — 여기서 먼저 말해 준다(만들고 나서 저장에서 죽으면 교사 시간이 사라진다).
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(DATASET_ID)) {
    console.error(`데이터셋 id는 영문 소문자·숫자·하이픈만 됩니다(받은 값: ${DATASET_ID}) — 예: raft-vuln-v1`);
    process.exit(2);
  }
  const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
  if (!user || !password) { console.error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 환경변수가 필요합니다(창구 셋 다 admin)"); process.exit(2); }

  const 보고 = {
    name: NAME, datasetId: DATASET_ID, topic: TOPIC || null, agentId: AGENT, distractors: DISTRACTORS,
    server: SERVER, dryRun: DRY, startedAt: new Date().toISOString(),
    승인문답: 0, ref총: 0, 회수: { store: 0, file: 0, 실패: 0 }, 회수율: 0,
    회수실패상세: {}, 라이선스제외: { 행: 0, 문서별: {} },
    제외: { "근거 없음": 0, "회수 실패": 0, "라이선스": 0, "시험 문항(사전검사)": 0, "방해 조각 없음": 0 },
    행: 0, 토큰추정: { 합계: 0, 평균: 0, p95: 0 }, 저장: null, errors: [],
  };

  const auth = await login(SERVER, user, password);

  // ① 승인 문답 — 이 문답이 인용한 ref가 근거의 주소다.
  const 승인 = await 받기(SERVER, `/api/learnloop/approved?limit=${LIMIT}${TOPIC ? `&topic=${encodeURIComponent(TOPIC)}` : ""}`, auth);
  const 문답들 = 승인.logs ?? [];
  보고.승인문답 = 문답들.length;
  보고.상한도달 = !!승인.상한도달;
  console.log(`[raft] 승인 문답 ${문답들.length}건${승인.상한도달 ? " (⚠ 상한 도달 — --limit을 올리세요)" : ""}`);

  // ② 제품이 쓰는 근거 꼴 — 베끼지 않고 받아 온다.
  const 프롬프트 = await 받기(SERVER, `/api/learnloop/raft/prompt?agentId=${encodeURIComponent(AGENT)}`, auth);
  // 조립 꼴이 서버와 같은지 **여기서 즉시 대조한다** — 어긋나면 학습 꼴과 추론 꼴이 갈리는데 오류가 안 난다.
  if (프롬프트.ragBlockSample && 참고자료블록(프롬프트.ragHeader, ["<조각 본문>"]) !== 프롬프트.ragBlockSample) {
    throw new Error("참고 자료 블록 조립 꼴이 서버(llm.ts ragBlock)와 다릅니다 — 빌더를 서버에 맞춰 고칠 것(학습 꼴과 추론 꼴이 갈리면 오류 없이 모델만 나빠진다)");
  }

  // ③ 근거 되찾기 — 두 길. store는 코퍼스 창구에서, file은 저장소 파일을 같은 규칙으로 다시 잘라서.
  const 색인 = new Map(); // ref → { ref, text, 문서, category }
  const 코퍼스 = await (async () => {
    const r = await fetch(SERVER + "/api/learnloop/distill/corpus", {
      method: "POST", headers: auth, redirect: "error",
      // 업무영역을 안 준다 — 승인 문답의 근거는 여러 영역에 걸쳐 있다(주제로 자르면 회수율이 떨어진다).
      body: JSON.stringify({ maxChunks: 20000, maxPerDoc: 2000 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`코퍼스 창구 ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  })();
  for (const c of 코퍼스.chunks ?? []) 색인.set(c.ref, { ref: c.ref, text: c.text, 문서: c.documentId, category: c.category ?? null });
  console.log(`[raft] 저장소 코퍼스: 문서 ${코퍼스.docs} · 조각 ${(코퍼스.chunks ?? []).length} · 거름 ${JSON.stringify(코퍼스.skipped)}`);

  // file 근거: 필요한 파일만 읽어 같은 규칙으로 자른다.
  const 파일필요 = new Set();
  for (const l of 문답들) for (const ref of l.cites ?? []) { const p = refParse(ref); if (p?.kind === "file") 파일필요.add(p.id); }
  보고.파일근거 = { 지목: 파일필요.size, 읽음: 0, 없음: [] };
  for (const rel of 파일필요) {
    const abs = path.resolve(저장소, rel);
    // 저장소 밖을 읽지 않는다 — ref는 DB에서 온 값이라 신뢰 입력이 아니다.
    if (!abs.startsWith(저장소 + path.sep) || !fs.existsSync(abs)) {
      // 조용히 넘기면 「회수 실패」로만 보여 원인이 파일이 사라진 것인지 규칙이 어긋난 것인지 모른다.
      보고.파일근거.없음.push(rel);
      continue;
    }
    보고.파일근거.읽음 += 1;
    try {
      for (const t of chunk(fs.readFileSync(abs, "utf8"))) {
        const ref = `${rel}#${sha12(t)}`;
        if (!색인.has(ref)) 색인.set(ref, { ref, text: t, 문서: rel, category: null });
      }
    } catch (e) { 보고.errors.push(`${rel}: ${e.message}`); }
  }
  console.log(
    `[raft] 파일 근거 후보: 지목 ${파일필요.size} · 읽음 ${보고.파일근거.읽음}` +
    `${보고.파일근거.없음.length ? ` · ⚠ 없는 파일 ${보고.파일근거.없음.length}(${보고.파일근거.없음.slice(0, 3).join(", ")})` : ""} → 색인 ${색인.size}조각`
  );

  // ④ 행 만들기
  const 판정기 = await 라이선스판정기();
  보고.라이선스판정 = 판정기.출처; // 어느 잣대로 쟀는지 — 숫자만 있고 잣대가 없으면 나중에 못 읽는다
  console.log(`[raft] 라이선스 판정: ${판정기.출처}`);
  const 시험 = 시험문항목록();
  보고.시험문항수 = 시험.size;
  const { rows, 통계 } = 행만들기(문답들, 색인, {
    판정: 판정기.판정, system: 프롬프트.system, ragHeader: 프롬프트.ragHeader,
    distractors: DISTRACTORS, 씨앗: sha12(NAME + "|" + (TOPIC || "전체")), 시험,
  });
  Object.assign(보고, 통계);
  const 토큰들 = rows.map((r) => 토큰추정(r.system) + 토큰추정(r.question) + 토큰추정(r.answer));
  보고.행 = rows.length;
  보고.회수율 = 보고.ref총 ? Number(((보고.회수.store + 보고.회수.file) / 보고.ref총).toFixed(4)) : 0;
  if (토큰들.length) {
    const 정렬 = [...토큰들].sort((a, b) => a - b);
    보고.토큰추정 = {
      합계: 토큰들.reduce((a, b) => a + b, 0),
      평균: Math.round(토큰들.reduce((a, b) => a + b, 0) / 토큰들.length),
      p95: 정렬[Math.min(정렬.length - 1, Math.floor(정렬.length * 0.95))],
    };
  }

  // ⑤ 저장 — 위생 관문을 지나는 유일한 길. --dry-run이면 여기서 멈춘다(운영에 쓰기 금지).
  if (DRY) {
    console.log(`[raft] DRY-RUN — 저장하지 않습니다. 만든 행 ${rows.length}개`);
    보고.저장 = { 함: false, 이유: "--dry-run" };
  } else if (!rows.length) {
    보고.저장 = { 함: false, 이유: "만든 행이 0개" };
  } else {
    const r = await fetch(SERVER + "/api/dataset/save", {
      method: "POST", headers: auth, redirect: "error",
      body: JSON.stringify({ id: DATASET_ID, examples: rows, kind: "근거" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { 보고.저장 = { 함: false, 이유: `${r.status}: ${JSON.stringify(j).slice(0, 200)}` }; 보고.errors.push(String(보고.저장.이유)); }
    else {
      // 서버 위생이 더 걸러낸다 — 보낸 수와 저장된 수가 다르면 그 차이가 곧 위생 적발이다.
      보고.저장 = { 함: true, ...j, 보낸행: rows.length, 위생에걸린행: rows.length - Number(j.examples ?? 0) };
      console.log(`[raft] 저장 ${j.id} — ${j.examples}행(보낸 ${rows.length}, 위생 제외 ${보고.저장.위생에걸린행})`);
    }
  }

  // 맛보기 3행만 남긴다(system은 400자로 자른다) — 전체 행은 파일로 안 떨군다(머리 주석의 ⚠).
  보고.맛보기 = rows.slice(0, 3).map((r) => ({ question: r.question, answerHead: r.answer.slice(0, 120), systemHead: r.system.slice(0, 400) }));
  보고.finishedAt = new Date().toISOString();

  const dir = path.join(저장소, "tools", "team-bench", "results-ladder", NAME);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "build-report.json");
  fs.writeFileSync(out, JSON.stringify(보고, null, 2), "utf8");
  console.log(
    `[raft] 끝 — 승인 ${보고.승인문답} · ref ${보고.ref총} · 회수 ${(보고.회수율 * 100).toFixed(1)}%` +
    `(저장소 ${보고.회수.store}·파일 ${보고.회수.file}·실패 ${보고.회수.실패}) · 제외 ${JSON.stringify(보고.제외)}` +
    ` · 행 ${보고.행} · 토큰추정 평균 ${보고.토큰추정.평균}/p95 ${보고.토큰추정.p95} · 보고서 ${out}`
  );
}

// 짝 시험이 위 순수 함수들을 import한다 — **직접 실행할 때만** 본체가 돈다(import로는 안 돈다).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main().catch((e) => { console.error("[raft] 실패:", e.message); process.exit(1); });
}
