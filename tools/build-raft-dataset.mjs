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
//     [--server http://localhost:4000] [--dry-run] [--prompt-spec tools/team-bench/prompt-spec.json]
//   --dry-run : 만들기·회수율 측정까지만 하고 **저장하지 않는다**(운영에 쓰기 금지 — 읽기만 한다).
//   --prompt-spec : 근거 꼴(머리말·조립 예시)을 창구 대신 **규격 파일**에서 읽는다.
//                   tools/ladder/export-prompt-spec.mjs가 win에서 만들어 저장소에 넣어 둔 그 파일이다.
//                   창구가 주는 값과 **대조**해 어긋나면 그 자리에서 죽는다(규격 파일이 낡았다는 뜻).
//
// ── 2회전(2026-09-04) 판 짜기 인자 — 1회전 어댑터가 무엇을 배웠는지 실측한 결과로 생겼다 ──────
//   1회전(raft-vuln-v1) 실측: 1,297행 **전부**가 「근거 + 정답 + 방해」였다(P=100%). 「모른다」를
//   시연하는 행이 0이었고, 답의 53.7%가 「원문: "…"」 꼬리를 달았는데 그 인용의 98%가 영문이었다.
//   결과로 어댑터는 **근거가 없어도 「원문:」을 지어냈고**(KEV 6문항 중 5), 서술 과제가 34~72% 짧아졌다.
//   아래 인자들은 그 넷을 각각 겨눈다 — 「모른다」를 시연할 행, 근거 없이 답하는 행, 인용의 출처 고정, 긴 답.
//
//   --p-oracle <0~1>        정답 조각을 싣는 행의 비율(기본 1.0 = 1회전과 같다).
//                           나머지 행은 **정답을 빼고** 방해를 하나 더 실어 「모른다」고 답하게 한다(ⓑ).
//   --noevidence-from-uncited  근거가 없어 버리던 승인 문답을 참고 자료 **없는** 거절 행으로 살린다(ⓑ′).
//   --closedbook-ratio <0~1>   근거를 아예 안 주고 원래 답을 하게 하는 폐쇄형 행 비율(ⓒ, 기본 0).
//                           ★ 2026-09-04 결정: **회전 2에는 ⓒ를 싣지 않는다**(기본 0 그대로 둔다).
//                             왜: 팀원 프롬프트 자신이 「참고 자료가 없으면 지어내지 말고 '등록된 사내
//                             자료에는 관련 내용이 없습니다'라고 먼저 밝힙니다」라고 규칙을 두는데,
//                             ⓒ는 **그 규칙을 어기는 답**을 가르친다. 제품은 언제나 RAG를 주고,
//                             자료가 없으면 거절이 정답이다 — 그 자리를 배우는 갈래는 ⓑ′다.
//                             그래서 ⓒ>0은 --allow-closedbook-conflict 없이는 사전검사가 막는다.
//   --quote-rule strict     인용 규칙 고정 — 근거 있는 행은 근거에서 뽑은 문장을 「원문: "…"」로 달고
//                           (이미 달린 인용도 근거와 **대조해** 아니면 떼고 다시 붙인다),
//                           근거 없는 행은 「원문:」 0%로 강제한다(지어낸 인용을 가르치지 않는다).
//   --allow-closedbook-conflict  ⓒ 폐쇄형과 ⓑ′ 무근거 거절을 **함께** 싣는 것을 사람이 판단해 허용한다
//                           (둘은 같은 프롬프트에 정반대 답을 단다 — 기본은 사전검사가 막는다).
//   --longform-dataset <id|경로>  긴 형식 행(3절 이상·긴 답)을 섞는다(ⓓ). 파일이 없으면 **명확히 실패**한다.
//                           ★ D행은 **근거 블록을 실은 긴 A행**이다(2026-09-04 결정). 인용 정책도 A와 같다:
//                             strict면 D행의 「원문:」도 그 행의 근거 조각에서 온 문장이어야 하고,
//                             아니면 근거에서 다시 붙이며, 못 붙이면 그 행을 뺀다.
//                             (실측: longform-vuln-v1.json 121행이 **전부** 근거 블록을 싣고 있고
//                              121행 전부에 인용이 달려 있다 — 예전 코드는 strict에서 그걸 통째로 뗐다.)
//   --no-distractor-allowlist  방해 조각에 라이선스 허용목록 판정을 **걸지 않는다**(1회전 판 재현용).
//                           기본은 **건다** — 안 걸면 타사 상용 문서 본문이 학습 재료의 system 칸에
//                           그대로 실린다(실측: v1 방해 자리에 Tenable 사용자 가이드 본문이 있었다).
//
//   ⚠ 갈래를 고르는 것은 전부 **결정적**이다(sha12(씨앗+문답id) 앞 4자리 → 0~1). 같은 씨앗이면 같은 판이
//     나와야 「이 판으로 구웠다」는 지문이 뜻을 갖는다. 무작위를 쓰면 재현이 안 돼 A/B가 성립하지 않는다.
//
// ⚠ **로그인을 밀어내지 않는다**(--force-login 없음). 같은 계정으로 강제 로그인하면 돌고 있는
//   증류 세션이 끊긴다(계정당 1세션). 「이미 로그인됨」이 뜨면 그 세션이 끝나기를 기다린다.
//
// ⚠ 만든 행을 **파일로 떨구지 않는다.** 저장은 오직 POST /api/dataset/save(종류 「근거」)로 한다 —
//   그 창구가 위생(시험 문항·시점 데이터·주입 표식)을 거는 유일한 관문이기 때문이다.
//   2026-09-03 실측: gb10 수동 경로가 이 관문을 건너뛰어 **평가 게이트 문항 4건이 학습에 섞였다.**
//   행을 손에 쥐면 또 건너뛰게 된다 — 그래서 쥐지 않는다(맛보기는 갈래마다 한 행씩만 보고서에 남긴다).
//
// 산출: tools/team-bench/results-ladder/<name>/build-report.json
//   (회수율 · 라이선스 제외(문서별) · 행 수 · 토큰 추정 — 숫자로 말한다)
//
// 표준 라이브러리만 쓴다(toolsdeps 감시).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
// 20자 겹침·시점데이터는 **증류기 사전검사와 같은 잣대**를 쓴다(서버 learncandidates·datasethygiene의 사본).
// 여기에 또 적으면 세 곳이 되고, 한 곳만 고쳐지는 날 「인용이 근거에서 왔나」가 조용히 갈린다.
import { overlap20, 시점데이터 } from "./distill-precheck.mjs";

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
  // 정답 조각은 하나일 수도, 여럿일 수도 있다(문답이 두 문서를 인용하면 여럿) — **전부** 뺀다.
  // ⚠ 2026-09-04 적발: 예전엔 호출부가 정답들[0]만 넘겨 둘째 정답 문서가 방해로 실릴 수 있었다.
  //   그 행은 답을 눈앞에 두고 「모른다」고 답하는 법을 가르친다(오늘 재료에선 빈도 0 — 승인 문답 하나에
  //   근거가 정확히 하나뿐이었다. 증류기가 근거를 둘 이상 달기 시작하면 조용히 발현한다).
  const 정답들 = (Array.isArray(정답) ? 정답 : [정답]).filter(Boolean);
  if (!정답들.length) return [];
  const 문서들 = new Set(정답들.map((c) => c.문서));
  const 본문들 = new Set(정답들.map((c) => c.text));
  const 갈래 = 정답들[0].category;
  const 풀 = 후보들.filter(
    (c) => !문서들.has(c.문서) && !본문들.has(c.text) && (갈래 ? c.category === 갈래 : true)
  );
  // ⚠ 고르는 키는 **정답들[0].ref**로 둔다 — 바꾸면 같은 씨앗이 다른 판을 내어 1회전과 비교가 끊긴다.
  return 풀
    .map((c) => ({ c, k: sha12(씨앗 + 정답들[0].ref + "|" + c.ref) }))
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

/**
 * 참고자료블록의 **반대 방향** — 이미 만들어진 system에서 근거 조각 본문들을 되찾는다.
 *
 * ★ 왜 필요한가(2026-09-04): ⓓ 긴 형식 행은 바깥 파일에서 오는데 그 행들도 **근거 블록을 싣고 있다**
 *   (실측: longform-vuln-v1.json 121행 전부). 그 행의 인용이 근거에서 온 것인지 대조하려면
 *   근거 조각이 손에 있어야 하는데, 우리가 가진 것은 조립이 끝난 system 문자열뿐이다.
 *   ⚠ 갈래 이름으로 「D는 근거가 없다」고 단정하던 자리가 바로 결함이었다 — **글을 보고 판단한다.**
 *
 * @returns 조각 본문 배열. 블록이 없으면 **빈 배열**(「근거 없음」과 「조각 0개」는 부르는 쪽이 가른다 —
 *   블록 유무는 `근거블록있나`가 따로 답한다).
 */
export function 근거조각뽑기(system, 머리말) {
  const s = String(system ?? ""), h = String(머리말 ?? "");
  if (!h || !s.includes(h)) return [];
  // 머리말 **마지막** 등장 뒤부터 읽는다 — 팀원 프롬프트가 머리말을 인용할 일은 없지만,
  // 있더라도 실제 블록(맨 뒤에 붙는다)을 읽게 된다.
  const 뒤 = s.slice(s.lastIndexOf(h) + h.length);
  if (!뒤.startsWith("\n")) return [];
  // 조각은 `[1] 본문` 꼴로 줄바꿈으로 이어 붙는다. 본문 안에 줄바꿈이 있어도 되도록
  // **줄머리의 `[n] `** 에서만 자른다(참고자료블록의 조립 규칙을 그대로 뒤집은 것).
  const 몸 = 뒤.slice(1);
  if (!/^\[1\] /.test(몸)) return [];
  return 몸.split(/\n(?=\[\d+\] )/).map((t) => t.replace(/^\[\d+\] /, ""));
}

/** system에 참고 자료 블록이 실려 있나 — **갈래 이름이 아니라 글**로 가른다(2026-09-04 결정 D3). */
export function 근거블록있나(system, 머리말) {
  const h = String(머리말 ?? "");
  return !!h && String(system ?? "").includes(h);
}

/**
 * 프롬프트 규격 파일 읽기 — `tools/ladder/export-prompt-spec.mjs`가 만든 그 파일.
 *
 * ★ 왜 파일인가(2026-09-04, R3): 표본 하네스는 근거 머리말을 `GET /api/learnloop/raft/prompt`에서
 *   받는데, 사슬이 도는 곳은 **gb10**이다. 거기서는 gb10 자신의 4000(계정이 다를 수 있다)이나
 *   win 운영 4000(VPN 너머)에 붙어야 해서, 「재는 자」가 남의 기계 사정에 매여 있었다.
 *   규격을 **파일로 못 박아** 저장소에 두면 하네스는 서버 없이도 학습과 같은 꼴로 잰다.
 * ⚠ fail-closed다 — 파일이 없거나 칸이 비었으면 **그 자리에서 죽는다.** 조용히 기본값으로 떨어지면
 *   학습 꼴과 다른 틀로 재고도 전부 초록이 뜬다(이 저장소가 반복해 겪은 그 실패).
 * ⚠ 규격이 **낡을 수 있다** — 서버 llm.ts가 바뀌면 이 파일은 자동으로 안 따라온다. 그래서
 *   짝 시험(raftdataset.test.ts)이 이 파일의 ragHeader를 RAG_BLOCK_HEADER와 글자 단위로 대조하고,
 *   빌더는 실행 중에 창구와 대조한다. 어긋나면 빨강 = 「다시 뽑아라」는 뜻이다.
 */
export function 규격읽기(경로, root = 저장소) {
  const p = path.resolve(root, String(경로 ?? "").trim());
  if (!String(경로 ?? "").trim()) throw new Error("--prompt-spec 값이 비었습니다");
  if (!fs.existsSync(p)) {
    throw new Error(`--prompt-spec 파일이 없습니다: ${p} — win에서 「node tools/ladder/export-prompt-spec.mjs」로 먼저 뽑으세요`);
  }
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const 칸 of ["ragHeader", "ragBlockSample", "system"]) {
    if (!String(j?.[칸] ?? "").trim()) throw new Error(`--prompt-spec 파일에 ${칸}이 없습니다: ${p}(규격 파일이 깨졌거나 옛 판입니다)`);
  }
  // 파일 안에서 스스로 앞뒤가 맞는가 — 머리말과 예시가 어긋난 규격은 규격이 아니다.
  if (참고자료블록(j.ragHeader, ["<조각 본문>"]) !== j.ragBlockSample) {
    throw new Error(`--prompt-spec 파일의 ragHeader와 ragBlockSample이 서로 어긋납니다: ${p} — 다시 뽑으세요`);
  }
  return j;
}

/** 조각 순서를 결정적으로 섞는다 — 정답이 늘 [1]이면 「맨 앞이 정답」을 배운다. */
export function 섞기(항목들, 씨앗) {
  return 항목들
    .map((v, i) => ({ v, k: sha12(씨앗 + "#" + i + "#" + String(v).slice(0, 64)) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((x) => x.v);
}

/**
 * 갈래 고르기용 결정적 난수 — sha12(키) 앞 4자리를 0~1로 편다. 값의 범위는 [0, 1)이다.
 *
 * ★ 왜 [0,1)인가: `--p-oracle 1.0`이 「1회전과 한 글자도 다르지 않다」여야 하기 때문이다.
 *   `값 < P` 로 판정하므로 P=1.0이면 모든 행이 정답을 싣고, P=0이면 한 행도 안 싣는다.
 *   (인자 설명의 「P 미만 행」은 **정답을 싣는 쪽**을 가리킨다 — RAFT 원논문의 P와 같은 뜻이다.)
 */
export function 결정값(키) {
  return parseInt(sha12(String(키)).slice(0, 4), 16) / 0x10000;
}

/**
 * 「자료가 없다」고 답하는 문구 — **제품이 시키는 그 문장 그대로다**(server/src/engine/llm.ts).
 *   · llm.ts:254 팀원 프롬프트 규칙: 「…지어내지 말고 '등록된 사내 자료에는 관련 내용이 없습니다'라고 먼저 밝힙니다」
 *   · llm.ts:759 제품이 실제로 돌려주는 답: 아래 문장 전체
 * 여기서 새로 짓지 않는 이유: 배우는 문구와 제품이 내는 문구가 다르면, 어댑터는 **제품이 쓰지 않는 말**을
 * 배운다(그리고 그 차이는 오류를 안 낸다). 타입이 다른 두 파일이라 import가 안 되므로 복제하되,
 * 짝 시험(raftdataset.test.ts)이 llm.ts 원문과 **글자 단위로 같은지** 감시한다.
 */
export const 거절답 = "등록된 사내 자료에는 관련 내용이 없습니다. 사내 문서를 먼저 등록하시거나, 다른 에이전트에게 물어보세요.";

/**
 * 「원문: "…"」 인용 꼬리표 — 실물 꼴은 데이터에서 확인해 정했다(raft-vuln-v1 1,297행 실측 2026-09-04).
 *   · `원문: "…"`   맨 꼴 …… 답 끝 414건
 *   · `「원문: "…"」` 괄호 꼴 …… 어디든 204건(끝 29건 — 문장 중간에 박힌 것이 더 많다)
 * 두 꼴을 한 정규식으로 잡으면 「원문」이 든 답 696건 중 694건이 걸린다(나머지 둘은 「원문 대목」처럼
 * 인용이 아닌 말과, 따옴표가 없는 깨진 꼬리 하나다 — 인용으로 안 본다).
 * ⚠ 꼬리가 **끝에만** 있는 게 아니라서 `$` 앵커를 걸면 절반을 놓친다(그래서 안 건다).
 */
const 인용꼴 = '「?\\s*원문\\s*[:：]\\s*["“][^"”]*["”]\\s*」?';
/** 인용 **본문**까지 꺼내는 꼴 — 「근거에서 온 인용인가」를 대조할 때 쓴다(여는 꼴은 인용꼴과 같다). */
const 인용본문꼴 = '「?\\s*원문\\s*[:：]\\s*["“]([^"”]*)["”]\\s*」?';
/**
 * 「원문:」 + **여는 따옴표까지만** 보는 꼴 — 닫는 따옴표가 없어도 걸린다.
 * ⚠ 왜 따로 두나(2026-09-04 검토 적발): 관문(인용있나)과 수리기(인용떼기)를 같은 정규식으로 만들면
 *   깨진 꼬리(`… 원문: "This catalog is maintained by CISA`)를 **둘 다** 못 보고 지나친다 —
 *   폐쇄형·거절 행에 「원문: "」가 남은 채 저장되는데 보고서는 「비A행 인용 0%」라고 말한다.
 *   **세는 자(구성비·사전검사)와 떼는 자(인용떼기)는 이 넓은 꼴을 쓴다.**
 */
const 인용흔적꼴 = '「?\\s*원문\\s*[:：]\\s*["“]';
export const 인용있나 = (a) => new RegExp(인용꼴).test(String(a ?? ""));
/** 「원문: "」 흔적이 있나 — **깨진 꼬리까지** 센다. 보고 숫자와 사전검사는 이쪽을 본다. */
export const 인용흔적있나 = (a) => new RegExp(인용흔적꼴).test(String(a ?? ""));
/** 답에 달린 인용의 **본문**들(완전한 꼴만) — 근거 대조에 쓴다. */
export const 인용들뽑기 = (a) => [...String(a ?? "").matchAll(new RegExp(인용본문꼴, "g"))].map((m) => m[1]);
/**
 * 인용 꼬리표를 뗀다(폐쇄형·거절 행에 쓴다). 뗀 자리는 공백 하나로 메우고 줄바꿈은 보존한다.
 * 닫는 따옴표가 없는 **깨진 꼬리**는 그 줄 끝까지 뗀다 — 줄은 넘지 않는다(뒤 문단까지 지우면 답이 사라진다).
 */
export const 인용떼기 = (a) =>
  String(a ?? "")
    .replace(new RegExp("[ \\t]*" + 인용꼴 + "[ \\t]*", "g"), " ")
    .replace(new RegExp("[ \\t]*" + 인용흔적꼴 + '[^"”\\n]*$', "gm"), " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

/** 근거 조각을 문장으로 쪼갠다 — chunk()의 문장 경계와 같은 규칙(한국어 종결형 포함). */
export function 문장들(text) {
  return String(text ?? "")
    .split(/(?<=[.!?。]|다\.|니다\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);
}

/**
 * 인용 규칙 strict — **근거에서 뽑은 문장만** 인용으로 붙인다.
 *
 * ★ 왜 필요한가(1회전 실측 2026-09-04): 1회전은 답의 53.7%에 인용 꼬리를 달았는데, 그 인용의 **98%가 영문**
 *   이었고 「어디서 가져오는가」는 한 번도 가르치지 않았다. 어댑터는 「답 끝에 원문을 단다」는 **꼴만** 배워
 *   근거가 없는 자리에서도 인용을 지어냈다(KEV 6문항 중 5 — 제 답과 사용자 지시문을 원문이라 인용했다).
 *   그래서 ① 근거 있는 행은 **반드시** 근거에서 온 문장을 달고 ② 근거 없는 행은 **한 건도** 안 단다.
 *
 * 고르는 규칙(전부 결정적이다):
 *   · **이미 달린 인용도 근거와 대조한다** — 근거에 없으면 떼고 다시 붙인다(그대로 두면 「아무 문장이나
 *     원문이라 부르기」를 가르친다. 2026-09-04 적발 전까지 실제로 그랬다).
 *   · 답과 **20자 이상 겹치는** 문장만(증류기·서버와 같은 overlap20) — 답이 실제로 근거로 삼은 대목이라야 인용이다.
 *   · 따옴표·낫표가 든 문장은 뺀다 — 인용 안에 인용이 들면 위 정규식이 되짚을 때 잘려 **못 떼는 꼬리**가 된다.
 *   · 시점데이터(날짜·「N건」·내부 식별자)가 든 문장은 뺀다 — 서버 위생이 그 행을 통째로 버린다.
 *   · **한글 문장이 하나라도 있으면 영문 후보는 버린다** — 「한국어 근거인데 영문만 인용」하던 습관을 끊는다.
 *     ⚠ 조각 전체의 한글 비율로 재지 않는다: 한글 설명 + 영문 원문이 한 조각에 섞이면 비율이 0.25까지
 *       떨어져(짝 시험 실측) 「한국어 근거」인데도 영문이 뽑힌다. **고를 수 있는 한글 문장이 있느냐**가
 *       물어야 할 것이고, 영문뿐인 조각(KEV·CVE 원문)은 영문을 인용하는 게 맞다.
 *   · 길이는 **40~300자**를 노린다. 40자는 아래 하한(distill.mjs가 교사에게 시키는 그 값 — 짧으면 20자 창이
 *     어긋나 겹침이 약하다), 300자는 상한이다. 그 안에서 **가장 짧은** 문장을 고른다(같으면 사전순).
 *     ⚠ 처음엔 「가장 긴 것」을 골랐다가 재구성 실측(1,297행)에서 답 p90이 349자 → 870자로 뛰었다.
 *       긴 인용은 ① 서버 위생의 1,200자 관문에 다가가고 ② distill.mjs가 못 박은 「인용은 한 문장 —
 *       통째로 옮기면 인용이 아니라 복제」에 어긋난다. 필요한 만큼만 인용한다.
 *     ⚠ 300자 넘는 「문장」은 대개 문장이 아니라 줄바꿈 없는 PDF 덩어리다 — 후보에서 뺀다.
 * 못 고르면 **행을 버린다** — 근거 없는 인용을 붙이느니 그 행을 안 배우는 게 낫다.
 */
/**
 * 인용 한 건의 길이 상한. **이 숫자 하나가 「행을 살릴까 짧게 인용할까」를 정한다** —
 * 재구성 실측(raft-vuln-v1 1,297행, 2026-09-04)으로 두 길을 다 재 봤다.
 *   300자로 자르고 넘는 것은 행을 버림 …… 행 963 · A 64.1% · 답 p90 353 · max  638
 *   상한 없이 가장 짧은 덩어리를 붙임 …… 행 1,169 · A 70.4% · 답 p90 844 · max 1,260
 * 앞쪽을 골랐다. 뒤쪽이 살리는 206행의 인용은 600~800자짜리 **문서 덩어리**라, distill.mjs가 못 박은
 * 「인용은 한 문장 — 통째로 옮기면 인용이 아니라 복제」에 정면으로 어긋나고 서버 위생의 1,200자
 * 관문에도 다가간다(그 판에서 실제로 1행이 넘었다). 긴 답이 필요하면 그 자리는 --longform-dataset이다.
 * ⚠ 이 값을 올릴 거면 위 두 줄을 다시 재고 함께 고칠 것 — 숫자 없이 바꾸면 어느 쪽이 나은지 아무도 모른다.
 */
const 인용상한 = 300;

/**
 * 이 인용이 **이 행의 근거에서 온 것인가.** 공백을 지운 뒤 근거에 통째로 들어 있으면 맞고,
 * 다듬어졌더라도 20자 이상 이어서 겹치면(overlap20 — 증류기·서버와 같은 잣대) 근거로 본다.
 * ⚠ 8자 미만은 대조하지 않는다(우연히 걸린다) — 그런 토막은 「근거에서 뽑은 문장」이 아니다.
 */
export function 인용근거대조(인용문, 근거텍스트들) {
  const q = String(인용문 ?? "").replace(/\s+/g, "").replace(/[.…·]+$/, "");
  if (q.length < 8) return false;
  for (const t of 근거텍스트들 ?? []) {
    const s = String(t ?? "").replace(/\s+/g, "");
    if (s.includes(q)) return true;
    if (overlap20(s, q)) return true;
  }
  return false;
}

export function 인용붙이기(answer, 근거텍스트들) {
  let a = String(answer ?? "").trim();
  // ★ 이미 인용이 달려 있어도 **그냥 통과시키지 않는다**(2026-09-04 검토 적발).
  //   1회전 재료는 답의 53.7%에 이미 인용을 달고 있었는데, 그 인용이 **어디서 왔는지는 아무도 안 봤다.**
  //   그대로 통과시키면 이 회전의 개입이 A행의 일부에만 닿고, 나머지는 「근거에 없는 문장을 원문이라
  //   부르는 법」을 그대로 가르친다 — 1회전 어댑터가 KEV 6문항 중 5에서 저지른 바로 그 버릇이다.
  //   그래서 ① 근거에서 온 인용이면 두고 ② 아니면 **떼고 근거에서 다시 붙인다**(못 붙이면 행을 버린다).
  let 뗌 = false;
  if (인용흔적있나(a)) {
    const 인용들 = 인용들뽑기(a);
    const 흔적수 = (a.match(new RegExp(인용흔적꼴, "g")) || []).length;
    const 깨진꼬리 = 인용들.length !== 흔적수; // 닫는 따옴표가 없는 꼬리가 섞였다
    const 근거에서왔나 = 인용들.length > 0 && 인용들.every((q) => 인용근거대조(q, 근거텍스트들));
    if (근거에서왔나 && !깨진꼬리) return { answer: a, 붙임: false, 뗌: false };
    a = 인용떼기(a);
    뗌 = true;
    if (!a) return { answer: null, 왜: "인용을 떼니 남는 글이 없음", 뗌 };
  }
  const 후보 = [];
  for (const t of 근거텍스트들 ?? []) {
    for (const s of 문장들(t)) {
      if (/["“”「」]/.test(s)) continue;
      if (시점데이터(s)) continue;
      if (!overlap20(a, s)) continue;
      후보.push(s);
    }
  }
  if (!후보.length) return { answer: null, 왜: "인용할 문장 없음(20자 겹침)", 뗌 };
  // ⚠ 길이 상한을 **한글 우선보다 먼저** 건다. 뒤에 걸면, 한글 후보가 300자 덩어리 하나뿐인 행이
  //   쓸 만한 영문 한 문장을 옆에 두고도 버려진다.
  //   ⚠ 정직하게: 이 재료(raft-vuln-v1)에서는 두 순서가 **같은 수**를 냈다(둘 다 963행) — 그 갈림이
  //     생기는 행이 여기엔 없었을 뿐이다. 숫자가 안 갈렸다고 순서가 뜻 없는 건 아니라서 이대로 둔다.
  const 쓸만한 = 후보.filter((s) => s.length <= 인용상한);
  if (!쓸만한.length) return { answer: null, 왜: `인용할 문장 없음(${인용상한}자 넘는 덩어리뿐)`, 뗌 };
  const 한글후보 = 쓸만한.filter((s) => /[가-힣]/.test(s));
  const 최종후보 = 한글후보.length ? 한글후보 : 쓸만한;
  const 짧은것부터 = (묶음) => [...묶음].sort((x, y) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0));
  const 알맞은 = 짧은것부터(최종후보.filter((s) => s.length >= 40));
  const 고를것 = 알맞은.length ? 알맞은 : 짧은것부터(최종후보);
  return { answer: `${a} 원문: "${고를것[0]}"`, 붙임: true, 뗌 };
}

/**
 * 긴 형식 재료 파일의 자리 — 데이터셋 id면 서버 데이터 폴더에서, 경로면 그 경로에서 읽는다.
 * ⚠ 없으면 **조용히 0건이 아니라 실패**여야 한다(호출부가 던진다) — 「섞었다」고 믿은 채로 안 섞이는 것이
 *   이 저장소가 반복해 겪은 실패다.
 */
export function 긴형식경로(지정, root = 저장소) {
  const s = String(지정 ?? "").trim();
  if (!s) return null;
  if (/[\\/]/.test(s) || /\.json$/i.test(s)) return path.resolve(root, s);
  return path.join(root, "server", "data", "datasets", `${s}.json`);
}

/** 긴 형식 행 읽기 — 행 스키마는 학습 데이터와 같다({question, answer, system?}). */
export function 긴형식읽기(지정, root = 저장소) {
  const p = 긴형식경로(지정, root);
  if (!p) throw new Error("--longform-dataset 값이 비었습니다");
  if (!fs.existsSync(p)) throw new Error(`--longform-dataset 파일이 없습니다: ${p}`);
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const rows = Array.isArray(raw) ? raw : (raw?.examples ?? raw?.rows ?? null);
  if (!Array.isArray(rows) || !rows.length) throw new Error(`--longform-dataset 에 행이 없습니다: ${p}`);
  return rows;
}

/**
 * 절(節) 세기 — 「## 제목」·「1) …」·「① …」 꼴을 센다. 1회전 실측에 쓴 규칙과 같아야 숫자를 비교할 수 있다.
 * ⚠ team-bench의 `절세기(text, 절이름들)`와 **다른 일**이다(그쪽은 「요구한 이름의 절이 있나」를 본다).
 *   이쪽은 재료의 생김새를 재는 자다 — 이름을 요구하지 않는다. 합치지 말 것.
 */
export const 절수 = (a) => (String(a ?? "").match(/^\s*(#{1,3}\s|\d+[.)]\s|[①-⑨])/gm) || []).length;

/**
 * 구성비 표 — **무슨 판으로 구웠는지**를 숫자 한 장으로 남긴다.
 * 1회전이 남긴 보고서에는 이 표가 없어서 「전부 A행이었다」를 나중에 **데이터를 다시 읽어** 알아냈다.
 */
export function 구성비(rows, 종류들, 옵션 = {}) {
  const { ragHeader = "" } = 옵션;
  const 이름 = { A: "근거+정답", B: "방해만→거절", B2: "무근거→거절(B′)", C: "폐쇄형", D: "긴 형식" };
  const 표 = {};
  for (const k of Object.keys(이름)) 표[k] = { 뜻: 이름[k], 행: 0, 비율: 0, 인용: 0 };
  // 갈래마다 「원문:」이 몇 개인지도 함께 센다 — 사전검사가 걸렸을 때 **어느 갈래가 범인인지** 바로
  // 말해 주기 위해서다. 숫자만 있고 갈래가 없으면 사람이 재료를 처음부터 다시 열어 봐야 한다.
  // ⚠ 세는 자는 **인용흔적있나**다(인용있나가 아니다) — 닫는 따옴표가 없는 깨진 꼬리를 놓치면
  //   「원문: "」가 남은 행이 실리는데 보고서는 0%라고 말한다(2026-09-04 적발).
  종류들.forEach((k, i) => { if (!표[k]) return; 표[k].행 += 1; if (인용흔적있나(rows[i].answer)) 표[k].인용 += 1; });
  const n = rows.length || 1;
  for (const k of Object.keys(표)) 표[k].비율 = Number((표[k].행 / n).toFixed(4));

  const 세기 = (골라낸) => {
    const 인용 = 골라낸.filter((r) => 인용흔적있나(r.answer)).length;
    return { 행: 골라낸.length, 인용, 비율: Number((인용 / (골라낸.length || 1)).toFixed(4)) };
  };
  const A행 = rows.filter((_, i) => 종류들[i] === "A");
  const 비A행 = rows.filter((_, i) => 종류들[i] !== "A");

  // ★ 인용을 **가르는 잣대는 갈래 이름이 아니라 글**이다(2026-09-04 결정 D3).
  //   예전에는 「비A행이면 인용 0%」였는데, ⓓ 긴 형식 행은 갈래가 D면서도 **근거 블록을 싣는다**
  //   (실측 121/121). 이름으로 가르면 그 행들의 정당한 인용이 「지어낸 인용」으로 몰려,
  //   strict가 근거에서 온 인용까지 떼어 버렸다 — 재료의 값어치를 지우는 수리였다.
  //   그래서 셋으로 가른다:
  //     · 근거블록없음 — system에 참고 자료 블록이 없다. 여기서 인용하면 **없는 것을 인용**하는 것이다.
  //     · 거절행     — 답이 제품의 거절 문구 그대로다(ⓑ·ⓑ′). 블록이 있어도 답이 「없습니다」라
  //                    인용이 붙으면 거짓이 된다. **명시적 예외**로 따로 센다.
  //     · 근거인용가능 — 블록이 있고 거절이 아닌 행(ⓐ·근거 실은 ⓓ). 인용이 **있어야 하는** 자리다.
  //   ⚠ ragHeader를 안 주면 블록을 가릴 수 없다 — 그때는 「전부 근거 없음」으로 본다(fail-closed).
  //     그래야 규격을 안 넘긴 호출부가 조용히 통과하지 않는다.
  const 블록있음 = rows.map((r) => 근거블록있나(r.system, ragHeader));
  // ⚠ **똑같은가**가 아니라 **거절로 시작하는가**로 본다. 우리가 잡으려는 결함이 바로
  //   「거절 문구 뒤에 인용을 덧붙인 답」이라, 완전 일치로 재면 그 행이 검사망을 그대로 빠져나간다
  //   (2026-09-04 실측: 첫 판이 이 자리에서 헛돌았다 — 세는 자가 잡으려는 것을 못 세고 있었다).
  const 거절 = rows.map((r) => String(r.answer ?? "").trim().startsWith(거절답));
  const 근거블록없음 = rows.filter((_, i) => !블록있음[i]);
  const 거절행 = rows.filter((_, i) => 거절[i]);
  const 근거인용가능 = rows.filter((_, i) => 블록있음[i] && !거절[i]);
  /** 조건에 맞는 행을 **갈래별로** 센다(0인 갈래는 안 싣는다 — 죄 없는 이름을 부르지 않으려고). */
  const 갈래별세기 = (조건) => {
    const m = {};
    rows.forEach((_, i) => { if (조건(i)) m[종류들[i]] = (m[종류들[i]] ?? 0) + 1; });
    return m;
  };

  const 길이 = rows.map((r) => String(r.answer ?? "").length).sort((a, b) => a - b);
  const q = (p) => (길이.length ? 길이[Math.min(길이.length - 1, Math.floor(길이.length * p))] : 0);
  return {
    표,
    인용: {
      A행: 세기(A행), 비A행: 세기(비A행),
      근거블록없음: 세기(근거블록없음), 거절행: 세기(거절행), 근거인용가능: 세기(근거인용가능),
    },
    // 어느 갈래가 근거 블록을 실었나 — 사전검사가 걸렸을 때 사람이 읽을 지도다.
    근거블록: Object.fromEntries(
      Object.keys(이름).map((k) => [k, rows.filter((_, i) => 종류들[i] === k && 블록있음[i]).length])
    ),
    // ★ **걸린 행만** 갈래별로 센다(2026-09-04). 표[k].인용은 「그 갈래의 인용 수」라 죄 없는 인용까지
    //   포함한다 — 그 숫자로 범인을 부르면 근거 블록을 실은 D행 121개가 통째로 지목된다(정반대의 뜻).
    //   실패 문구는 **실제로 규칙을 어긴 행**의 갈래와 수를 대야 사람이 고칠 자리를 찾는다.
    인용위반: {
      무근거: 갈래별세기((i) => !블록있음[i] && 인용흔적있나(rows[i].answer)),
      거절: 갈래별세기((i) => 거절[i] && 인용흔적있나(rows[i].answer)),
    },
    답길이: { p50: q(0.5), p90: q(0.9), max: 길이.length ? 길이[길이.length - 1] : 0 },
    절3이상: rows.filter((r) => 절수(r.answer) >= 3).length,
  };
}

/**
 * 사전검사 — 판이 **스스로를 배반하지 않는가**. 최종 관문은 서버 위생이지만, 이 넷은 서버가 못 본다.
 *   실패: **참고 자료 블록이 없는** 행에 「원문:」이 하나라도 있다 → 근거 없는 자리에서 인용을
 *         지어내는 습관을 그대로 가르친다(1회전 결함).
 *   실패: **거절 답을 다는 행**에 「원문:」이 있다 → 블록은 있지만 「없습니다」라고 답하는 자리라
 *         인용이 붙으면 거짓이 된다(ⓑ의 명시적 예외).
 *   ⚠ 2026-09-04 결정 D3 이전에는 이 둘이 「비A행이면 인용 0%」 하나였다. 그 규칙은 **근거 블록을 실은
 *     ⓓ 긴 형식 행**까지 범인으로 몰아, strict가 근거에서 온 정당한 인용을 떼게 만들었다(121행 전부).
 *   실패: ⓒ 폐쇄형과 ⓑ′ 무근거 거절이 **함께** 있다 → 글자 단위로 같은 프롬프트에 정반대 답을 단다(아래 참조).
 *   경고: A행의 「원문:」이 95% 미만 → 인용을 「가끔 하는 것」으로 배운다(어디서 가져오는지는 못 배운 채).
 *   경고: A행의 **비중**이 절반 미만 → --p-oracle 오타(0.8을 0.08로)를 잡는 유일한 자리다.
 * ⚠ 위 둘째 경고는 첫째와 **다른 것을 잰다**. 첫째는 A행 「안에서」 인용률을, 둘째는 A행이 「몇 할인가」를 본다.
 *   2026-09-04 검토 적발: 커밋 e23b11eb는 「A행이 95% 미만이면 경고」라 적었는데 코드에는 비중을 보는 자가
 *   아예 없었다 — pOracle 0(전부 거절)인 판도 실패 0·경고 0으로 통과했다.
 */
export function 사전검사(구성, 옵션 = {}) {
  const { 폐쇄형충돌허용 = false } = 옵션;
  const 실패 = [], 경고 = [];
  const A = 구성.인용.A행;
  // 어느 갈래인지 함께 말한다. 특히 D(긴 형식)는 바깥 파일에서 오므로, 범인이 D면 고칠 자리가
  // 이 빌더가 아니라 **그 파일을 만든 쪽**이다 — 이름을 안 대면 엉뚱한 곳을 뒤진다.
  // ★ 범인은 **걸린 행**의 갈래별 수로 부른다(구성.인용위반). 갈래의 전체 인용 수(표[k].인용)로 부르면
  //   근거 블록을 실은 D행처럼 **죄 없는 인용**까지 지목한다 — 121행이 전부 정당한 판에서 「D 121/121」이
  //   범인으로 찍히면 사람은 멀쩡한 파일을 뒤진다(2026-09-04 자기검토에서 잡은 자리).
  const 범인대기 = (m) => Object.entries(m ?? {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}행`)
    .join(" · ") || "갈래 미상";

  // ★ 판별은 **글**로 한다(2026-09-04 결정 D3) — 「비A행이면 인용 0%」는 근거 블록을 실은 ⓓ까지 잡았다.
  const 무근거 = 구성.인용.근거블록없음 ?? { 행: 0, 인용: 0 };
  if (무근거.인용 > 0) {
    실패.push(
      `참고 자료 블록이 **없는** 행 ${무근거.행}개 중 ${무근거.인용}개에 「원문:」이 남아 있다` +
      `(${범인대기(구성.인용위반?.무근거)}) — 근거가 없는 자리에서 인용하는 법을 가르치게 된다`
    );
  }
  // 명시적 예외 — ⓑ(방해만)는 블록이 **있지만** 답이 거절이다. 거절하면서 인용하면 그 인용은 거짓이다.
  const 거절 = 구성.인용.거절행 ?? { 행: 0, 인용: 0 };
  if (거절.인용 > 0) {
    실패.push(
      `거절 답(「${거절답.slice(0, 20)}…」)을 다는 행 ${거절.행}개 중 ${거절.인용}개에 「원문:」이 있다` +
      `(${범인대기(구성.인용위반?.거절)}) — 「없습니다」라고 답하면서 인용하면 그 인용은 거짓이다`
    );
  }
  // ★ ⓒ 폐쇄형과 ⓑ′ 무근거 거절은 **글자 단위로 같은 system**(참고 자료 블록 없음)을 쓰면서 정반대 답을
  //   가르친다 — 게다가 그 system 안에는 「참고 자료가 없으면 지어내지 말고 '등록된 사내 자료에는 관련
  //   내용이 없습니다'라고 먼저 밝힙니다」라는 팀원 프롬프트의 규칙이 들어 있다. 둘을 함께 실으면 모델은
  //   같은 입력에 두 라벨을 보고, 제품에서 이 자리가 열리는 때(임베딩 검색이 죽어 rag=null)에 어느 쪽이
  //   나올지 아무도 모른다. **굽기 전에 사람이 정할 일**이라 기본은 막는다.
  const C행 = 구성.표.C?.행 ?? 0, B2행 = 구성.표.B2?.행 ?? 0;
  if (C행 > 0 && B2행 > 0 && !폐쇄형충돌허용) {
    실패.push(
      `ⓒ 폐쇄형 ${C행}행과 ⓑ′ 무근거 거절 ${B2행}행이 **같은 프롬프트**(참고 자료 블록 없음)에 정반대 답을 답니다` +
      ` — 한쪽을 끄거나, 사람이 판단해 받아들였다면 --allow-closedbook-conflict 를 붙이세요`
    );
  } else if (C행 > 0) {
    경고.push(
      `ⓒ 폐쇄형 ${C행}행은 팀원 프롬프트 자신의 규칙(「참고 자료가 없으면 … 없습니다라고 먼저 밝힙니다」)을` +
      ` 어기는 답을 가르칩니다 — 제품에서 이 자리가 열리는 때는 임베딩 검색이 죽어 rag=null이 된 순간뿐입니다`
    );
  }
  if (A.행 > 0 && A.비율 < 0.95) {
    경고.push(`A행의 「원문:」이 ${(A.비율 * 100).toFixed(1)}%다(95% 미만) — --quote-rule strict 를 켜면 근거에서 뽑아 채운다`);
  }
  // ★ A행의 **비중** — 위 검사는 A행 안쪽만 보므로, A행이 몇 개인지는 아무도 안 본다.
  const 전체 = Object.values(구성.표).reduce((n, v) => n + v.행, 0);
  if (전체 > 0) {
    const A비중 = (구성.표.A?.행 ?? 0) / 전체;
    if (A비중 < 0.5) {
      경고.push(
        `A행(근거+정답)이 전체의 ${(A비중 * 100).toFixed(1)}%다(절반 미만) — --p-oracle 값을 확인하세요` +
        ` (0.8을 0.08로 잘못 치면 92%가 거절 행인 판을 다섯 시간 굽고도 모든 관문이 초록이다)`
      );
    }
  }
  return { 통과: !실패.length, 실패, 경고 };
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
 * 갈래는 다섯이다(보고서 구성비 표의 그 이름들):
 *   ⓐ A  근거+정답 — 정답 조각 + 방해 조각. 1회전이 만든 유일한 갈래다.
 *   ⓑ B  방해만→거절 — 정답을 빼고 방해를 하나 더. 답은 제품이 시키는 거절 문구.
 *        ⚠ **정답만 빼고 원래 답을 그대로 두는 길은 만들지 않는다** — 그건 「근거에 없는 말을 지어내라」를
 *          글자 그대로 가르치는 판이라, 1회전이 겪은 인용 창작을 더 키운다.
 *   ⓑ′ B2 무근거→거절 — 참고 자료 블록 자체가 없다(llm.ts rag=null 꼴). 답은 같은 거절 문구.
 *   ⓒ C  폐쇄형 — 블록 없이 원래 답(인용 꼬리는 뗀다). 근거가 없을 때도 말이 되는 답을 유지시킨다.
 *   ⓓ D  긴 형식 — 바깥 파일에서 온다(main에서 붙인다. 여기서는 안 만든다).
 *
 * @param 문답들  [{ id, question, answer, cites:[ref…] }]
 * @param 색인    Map<ref, { ref, text, 문서, category }>
 * @param 옵션    { 판정: (문서)=>사유|null, system, ragHeader, distractors, 씨앗, 시험,
 *                  pOracle, noEvidenceFromUncited, closedbookRatio, quoteRule, distractorAllowlist }
 * @returns { rows, 종류들, 통계 }  종류들[i]는 rows[i]의 갈래("A"|"B"|"B2"|"C")다.
 *   ⚠ 갈래를 **행 안에 넣지 않는다** — rows는 그대로 저장 창구로 나가는 몸이라, 스키마에 없는 칸을
 *     끼우면 서버 위생이 무엇을 하는지 알 수 없다. 자리 번호로 짝지어 나른다.
 */
export function 행만들기(문답들, 색인, 옵션) {
  const {
    판정, system: 팀원프롬프트, ragHeader, distractors = 1, 씨앗 = "", 시험 = new Set(),
    pOracle = 1, noEvidenceFromUncited = false, closedbookRatio = 0, quoteRule = "off",
    distractorAllowlist = true,
  } = 옵션;
  // ★ 방해 조각에도 허용목록을 건다(2026-09-04 결정 D2, 기본 on). 지금까지는 정답 조각만 걸러서
  //   타사 상용 문서 본문이 방해 자리로 학습 재료의 system 칸에 실려 나갔다(v1 실측: Tenable 가이드).
  //   재배포 위험은 「정답으로 실렸나 방해로 실렸나」를 가리지 않는다 — 실리면 실린 것이다.
  //   ⚠ 이걸 켜면 후보풀이 줄어 **1회전과 다른 판**이 된다(다른 방해가 뽑힌다). v1 재현이 필요하면
  //     --no-distractor-allowlist 로 끈다.
  const 전체후보 = [...색인.values()];
  const 문서판정 = new Map(); // 문서 → 사유|null (판정기를 문서마다 한 번만 부른다)
  const 문서사유 = (문서) => {
    if (!문서판정.has(문서)) 문서판정.set(문서, 판정(문서));
    return 문서판정.get(문서);
  };
  const 후보풀 = distractorAllowlist ? 전체후보.filter((c) => !문서사유(c.문서)) : 전체후보;
  const 통계 = {
    ref총: 0,
    회수: { store: 0, file: 0, 실패: 0 },
    회수실패상세: {},
    라이선스제외: { 행: 0, 문서별: {} },
    // 허용목록 밖 문서의 문장이 **방해 조각으로** 실린 행 수. 기본(허용목록 on)에서는 **0이라야 한다** —
    // 0이 아니면 거르는 자가 새고 있다는 뜻이다. --no-distractor-allowlist 로 끈 판에서만 0이 아닐 수 있다.
    방해라이선스노출: { 행: 0, 문서별: {} },
    // 허용목록이 방해 후보를 얼마나 걷어냈나 — 「걸었다」는 말을 숫자로 뒷받침한다(0이면 안 걸린 것과 같다).
    방해허용목록: {
      켬: distractorAllowlist, 후보총: 전체후보.length,
      남은후보: distractorAllowlist ? 후보풀.length : 전체후보.length,
      거른후보: distractorAllowlist ? 전체후보.length - 후보풀.length : 0,
      거른문서별: {},
    },
    제외: {
      "근거 없음": 0, "회수 실패": 0, "라이선스": 0, "시험 문항(사전검사)": 0, "방해 조각 없음": 0,
      "인용 없음(strict)": 0,
    },
    // strict 인용 규칙이 한 일. 「그대로」만 크면 개입이 재료에 안 닿은 것이다(2026-09-04 적발의 그 자리).
    인용규칙: {
      "그대로(근거에서 온 인용)": 0, "새로 붙임": 0, "갈아끼움(근거 밖 인용을 떼고 다시)": 0,
      "버림(근거 밖 인용·대신 붙일 문장 없음)": 0, "버림(겹치는 문장 없음)": 0,
    },
  };
  if (distractorAllowlist) {
    for (const c of 전체후보) {
      const why = 문서사유(c.문서);
      if (why) 통계.방해허용목록.거른문서별[c.문서] = (통계.방해허용목록.거른문서별[c.문서] ?? 0) + 1;
    }
  }
  const rows = [], 종류들 = [];
  const 담기 = (종류, row) => { rows.push(row); 종류들.push(종류); };
  // 블록 없는 행의 system — llm.ts systemContent가 rag=null일 때 만드는 것과 **글자 단위로 같다**
  // ([systemPromptFor, null, null, null].filter(Boolean).join("\n\n") = systemPromptFor 하나).
  const 블록없는system = 팀원프롬프트;

  for (const l of 문답들) {
    const refs = (l.cites ?? []).map(refParse).filter(Boolean);
    if (!refs.length) {
      // ⓑ′ — 지금까지 버리던 「근거 없음」을 「모른다고 답하는 법」의 재료로 살린다(플래그가 켜졌을 때만).
      if (!noEvidenceFromUncited) { 통계.제외["근거 없음"] += 1; continue; }
      if (시험.has(문항정규화(l.question))) { 통계.제외["시험 문항(사전검사)"] += 1; continue; }
      담기("B2", { question: l.question, answer: 거절답, system: 블록없는system });
      continue;
    }
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
    //   ⚠ 갈래를 고르기 **전에** 본다: B·C 갈래로 새면 라이선스에 막힌 문답이 다른 옷을 입고 되살아난다.
    const 막힌것 = 정답들.map((c) => ({ c, why: 문서사유(c.문서) })).filter((x) => x.why);
    if (막힌것.length) {
      통계.제외["라이선스"] += 1; 통계.라이선스제외.행 += 1;
      for (const x of 막힌것) 통계.라이선스제외.문서별[x.c.문서] = (통계.라이선스제외.문서별[x.c.문서] ?? 0) + 1;
      continue;
    }
    if (시험.has(문항정규화(l.question))) { 통계.제외["시험 문항(사전검사)"] += 1; continue; }

    // ⓒ 폐쇄형 — 근거를 아예 안 준다. 인용 꼬리는 뗀다(줄 근거가 없으니 인용도 없어야 한다).
    if (closedbookRatio > 0 && 결정값(씨앗 + "|closedbook|" + l.id) < closedbookRatio) {
      담기("C", { question: l.question, answer: 인용떼기(l.answer), system: 블록없는system });
      continue;
    }

    const 정답실림 = 결정값(씨앗 + "|oracle|" + l.id) < pOracle;
    const 필요방해 = 정답실림 ? distractors : distractors + 1;
    // ⚠ 정답 조각 **전부**의 문서를 뺀다(맨 앞 하나가 아니라 — 2026-09-04 적발). 문답이 두 문서를 인용하면
    //   둘째 정답 조각이 방해로 실려, ⓑ 행이 **답을 눈앞에 두고 「모른다」고 답하는 법**을 가르치게 된다.
    const 방해 = 방해조각고르기(정답들, 후보풀, 필요방해, 씨앗);
    // 방해를 넣기로 했는데 못 넣었으면 **그 행은 안 만든다.** 섞어서 고르는 법을 가르치려는 판에
    // 정답만 든 행이 섞이면, 그 행들은 「참고 자료는 다 맞다」를 도로 가르친다.
    if (필요방해 > 0 && !방해.length) { 통계.제외["방해 조각 없음"] += 1; continue; }
    // ⚠ 방해의 라이선스 노출은 **행이 실제로 실린 뒤에** 센다(2026-09-04 적발). 아래 strict 인용 필터에서
    //   버려질 행까지 미리 세면, 「재배포 위험을 사람이 판단하라」고 내민 그 숫자에 유령 행이 섞인다.
    const 막힌방해 = 방해.map((c) => ({ c, why: 문서사유(c.문서) })).filter((x) => x.why);
    const 방해노출세기 = () => {
      if (!막힌방해.length) return;
      통계.방해라이선스노출.행 += 1;
      for (const x of 막힌방해) {
        통계.방해라이선스노출.문서별[x.c.문서] = (통계.방해라이선스노출.문서별[x.c.문서] ?? 0) + 1;
      }
    };

    if (!정답실림) {
      // ⓑ 방해만 — 정답 조각들의 **문서가 통째로** 빠진다(방해조각고르기가 그 문서들을 안 고른다).
      const 조각들 = 섞기(방해.map((c) => c.text), 씨앗 + l.id);
      방해노출세기();
      담기("B", {
        question: l.question, answer: 거절답,
        system: [팀원프롬프트, 참고자료블록(ragHeader, 조각들)].join("\n\n"),
      });
      continue;
    }

    // ⓐ 근거+정답
    let answer = String(l.answer ?? "");
    if (quoteRule === "strict") {
      const 결과 = 인용붙이기(answer, 정답들.map((c) => c.text));
      if (!결과.answer) {
        통계.제외["인용 없음(strict)"] += 1;
        통계.인용규칙[결과.뗌 ? "버림(근거 밖 인용·대신 붙일 문장 없음)" : "버림(겹치는 문장 없음)"] += 1;
        continue;
      }
      answer = 결과.answer;
      통계.인용규칙[결과.붙임 ? (결과.뗌 ? "갈아끼움(근거 밖 인용을 떼고 다시)" : "새로 붙임") : "그대로(근거에서 온 인용)"] += 1;
    }
    const 조각들 = 섞기([...정답들.map((c) => c.text), ...방해.map((c) => c.text)], 씨앗 + l.id);
    방해노출세기();
    담기("A", {
      question: l.question, answer,
      system: [팀원프롬프트, 참고자료블록(ragHeader, 조각들)].join("\n\n"),
    });
  }
  return { rows, 종류들, 통계 };
}

// ── 여기서부터는 실행 경로(직접 실행할 때만 돈다) ─────────────────────────────

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

/**
 * 열어 둔 세션 하나. login()이 채우고 **직접 실행 꼬리의 finally**가 비운다.
 *
 * ★ 왜 main() 안의 지역 변수가 아닌가(2026-09-04): 세션을 닫아야 하는 자리는 일이 끝나는 자리가 아니라
 *   **프로세스가 끝나는 자리**다. main()은 330줄이라 그 전체를 try로 감싸면 정작 봐야 할 diff가
 *   들여쓰기 아래 묻힌다. 그래서 여는 자(login)와 닫는 자(로그아웃)를 붙여 두고 꼬리에서 닫는다.
 */
let 열린세션 = null;

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
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken };
  // ⚠ refreshToken을 여기서 챙겨 두지 않으면 **끝날 때 세션을 닫을 길이 없다**(아래 로그아웃의 ⚠).
  열린세션 = { server: base, auth, refreshToken: j.refreshToken };
  return auth;
}

/**
 * 세션 닫기 — 성공이든 실패든 **반드시** 부른다.
 *
 * ⚠ 몸(body)에 refreshToken을 실어야 실제로 지워진다. 서버 쪽은 「if (refreshToken) revokeRefreshToken(…)」
 *   한 줄이라(server/src/auth/auth.ts 의 POST /api/auth/logout), 빈 몸으로 부르면 {ok:true}만 돌아오고
 *   세션은 그대로 남는다 — 「로그아웃했다」가 거짓말이 된다.
 *   team-bench/ask-samples.mjs 의 로그아웃()과 **같은 꼴**이다(두 파일이 갈리지 않게).
 *
 * ★ 왜 필요했나(2026-09-04 실측): 이 빌더가 로그아웃을 안 해서 유휴 30분짜리 유령 세션이 남았고,
 *   계정당 1세션이라 다음 도구가 **26분을 기다렸다.** 재료를 굽는 시간보다 기다린 시간이 길었다.
 */
async function 로그아웃() {
  const 세션 = 열린세션;
  if (!세션) return;
  열린세션 = null;                                    // 두 번 불려도 한 번만 나간다
  await fetch(세션.server + "/api/auth/logout", {
    method: "POST", headers: 세션.auth, redirect: "error",
    body: JSON.stringify({ refreshToken: 세션.refreshToken }),
  }).catch(() => {});                                // 닫기에 실패해도 이 회차의 산출물은 이미 파일에 있다
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
  const 비율읽기 = (키, 기본) => {
    const v = Number(opt(키, 기본));
    if (!Number.isFinite(v) || v < 0 || v > 1) { console.error(`${키}는 0~1 사이 숫자여야 합니다(받은 값: ${opt(키, 기본)})`); process.exit(2); }
    return v;
  };
  const P_ORACLE = 비율읽기("--p-oracle", 1);
  const CLOSEDBOOK = 비율읽기("--closedbook-ratio", 0);
  const NOEV = has("--noevidence-from-uncited");
  const QUOTE_RULE = String(opt("--quote-rule", "off")).trim();
  if (!["off", "strict"].includes(QUOTE_RULE)) { console.error(`--quote-rule은 off 또는 strict입니다(받은 값: ${QUOTE_RULE})`); process.exit(2); }
  // ⓒ 폐쇄형과 ⓑ′ 무근거 거절은 **같은 프롬프트에 정반대 답**을 가르친다 — 기본은 막고, 사람이 판단해
  // 받아들였을 때만 이 플래그로 연다(그 사실이 보고서 「판」에 남는다).
  const ALLOW_CB = has("--allow-closedbook-conflict");
  const LONGFORM = String(opt("--longform-dataset", "")).trim();
  // 기본은 **건다**(2026-09-04 결정 D2). 끄는 쪽이 인자를 대야 한다 — v1 재현이 특수한 경우다.
  const DISTRACTOR_ALLOWLIST = !has("--no-distractor-allowlist");
  const PROMPT_SPEC = String(opt("--prompt-spec", "")).trim();

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
    // 판 짜기 인자 — 「어떤 판으로 구웠나」를 보고서 첫머리에 남긴다(1회전은 이게 없어 나중에 데이터를 다시 읽었다).
    판: {
      pOracle: P_ORACLE, closedbookRatio: CLOSEDBOOK, noEvidenceFromUncited: NOEV, quoteRule: QUOTE_RULE,
      longform: LONGFORM || null, allowClosedbookConflict: ALLOW_CB,
      distractorAllowlist: DISTRACTOR_ALLOWLIST, promptSpec: PROMPT_SPEC || null,
    },
    server: SERVER, dryRun: DRY, startedAt: new Date().toISOString(),
    승인문답: 0, ref총: 0, 회수: { store: 0, file: 0, 실패: 0 }, 회수율: 0,
    회수실패상세: {}, 라이선스제외: { 행: 0, 문서별: {} }, 방해라이선스노출: { 행: 0, 문서별: {} },
    제외: {
      "근거 없음": 0, "회수 실패": 0, "라이선스": 0, "시험 문항(사전검사)": 0, "방해 조각 없음": 0,
      "인용 없음(strict)": 0,
    },
    // strict 인용 규칙이 **실제로 무엇을 했나**. 「그대로」만 크면 이 회전의 개입이 재료에 안 닿은 것이다
    // (2026-09-04 적발: 이미 인용이 달린 답을 대조 없이 통과시켜 A행의 1/5에만 닿고 있었다).
    인용규칙: {
      "그대로(근거에서 온 인용)": 0, "새로 붙임": 0, "갈아끼움(근거 밖 인용을 떼고 다시)": 0,
      "버림(근거 밖 인용·대신 붙일 문장 없음)": 0, "버림(겹치는 문장 없음)": 0,
    },
    행: 0, 구성: null, 토큰추정: { 합계: 0, 평균: 0, p95: 0 }, 저장: null, errors: [],
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
  // ⚠ fail-open 금지(2026-09-04 검토관 적발): 예전에는 `프롬프트.ragBlockSample &&` 라서 창구가 그 값을
  //   안 주면 **대조가 조용히 사라졌다.** 그러면 학습 꼴과 추론 꼴이 갈려도 오류 없이 통과하고,
  //   그 판으로 몇 시간을 굽고 나서야 안다. 「없으면 검사를 건너뛴다」는 검사가 아니다.
  //   (ask-samples.mjs가 같은 자리를 같은 꼴로 이미 고쳤다 — 두 파일이 어긋나 있었다.)
  if (!프롬프트.ragBlockSample) {
    throw new Error("창구가 ragBlockSample을 안 줍니다 — 조립 꼴을 대조할 길이 없습니다(대조 없이 구우면 학습 꼴과 추론 꼴이 갈려도 아무도 모릅니다)");
  }
  // 조립 꼴이 서버와 같은지 **여기서 즉시 대조한다** — 어긋나면 학습 꼴과 추론 꼴이 갈리는데 오류가 안 난다.
  if (참고자료블록(프롬프트.ragHeader, ["<조각 본문>"]) !== 프롬프트.ragBlockSample) {
    throw new Error("참고 자료 블록 조립 꼴이 서버(llm.ts ragBlock)와 다릅니다 — 빌더를 서버에 맞춰 고칠 것(학습 꼴과 추론 꼴이 갈리면 오류 없이 모델만 나빠진다)");
  }
  // ② ′ 규격 파일을 줬으면 **창구와 대조한다**(창구를 대신하는 것이 아니라 서로를 겨눈다).
  //   이 빌더는 승인 문답·코퍼스 때문에 어차피 서버가 있어야 돈다 — 그러니 여기서 규격 파일의 값어치는
  //   「gb10에서 도는 하네스가 쓰는 그 규격이 지금 서버와 같은가」를 **굽기 전에** 가려 주는 것이다.
  if (PROMPT_SPEC) {
    const 규격 = 규격읽기(PROMPT_SPEC);
    if (규격.ragHeader !== 프롬프트.ragHeader) {
      throw new Error(`규격 파일(${PROMPT_SPEC})의 ragHeader가 지금 서버와 다릅니다 — tools/ladder/export-prompt-spec.mjs 로 다시 뽑으세요(낡은 규격으로 잰 표본은 학습 꼴과 딴 틀입니다)`);
    }
    보고.규격파일 = { 경로: PROMPT_SPEC, fetchedAt: 규격.fetchedAt ?? null, 창구와일치: true };
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
  const { rows, 종류들, 통계 } = 행만들기(문답들, 색인, {
    판정: 판정기.판정, system: 프롬프트.system, ragHeader: 프롬프트.ragHeader,
    distractors: DISTRACTORS, 씨앗: sha12(NAME + "|" + (TOPIC || "전체")), 시험,
    pOracle: P_ORACLE, noEvidenceFromUncited: NOEV, closedbookRatio: CLOSEDBOOK, quoteRule: QUOTE_RULE,
    distractorAllowlist: DISTRACTOR_ALLOWLIST,
  });
  Object.assign(보고, 통계);
  console.log(
    `[raft] 방해 허용목록: ${DISTRACTOR_ALLOWLIST ? "건다" : "끈다(--no-distractor-allowlist)"}` +
    ` — 후보 ${통계.방해허용목록.후보총} 중 ${통계.방해허용목록.거른후보}개 거름(남은 ${통계.방해허용목록.남은후보})`
  );

  // ④-2 긴 형식(ⓓ) — 바깥 파일에서 섞는다. 파일이 없으면 **여기서 던져** 만들기가 통째로 멈춘다
  //     (조용히 0건이면 「긴 답도 넣었다」고 믿은 채 짧은 답만 배운 어댑터가 나온다).
  if (LONGFORM) {
    보고.긴형식 = {
      지정: LONGFORM, 경로: 긴형식경로(LONGFORM), 읽음: 0, 실림: 0,
      제외: { "빈 문답": 0, "시험 문항(사전검사)": 0, "인용 없음(strict)": 0 },
      // ⓓ가 근거 블록을 실었나 — **갈래 이름이 아니라 글**로 센다(2026-09-04 결정 D3).
      근거블록: { 있음: 0, 없음: 0 },
      인용규칙: {
        "그대로(근거에서 온 인용)": 0, "새로 붙임": 0, "갈아끼움(근거 밖 인용을 떼고 다시)": 0,
        "버림(근거 밖 인용·대신 붙일 문장 없음)": 0, "버림(겹치는 문장 없음)": 0, "뗌(근거 블록 없는 행)": 0,
      },
    };
    const 긴것들 = 긴형식읽기(LONGFORM);
    보고.긴형식.읽음 = 긴것들.length;
    for (const r of 긴것들) {
      const q = String(r.question ?? "").trim(), a0 = String(r.answer ?? "").trim();
      if (!q || !a0) { 보고.긴형식.제외["빈 문답"] += 1; continue; }
      if (시험.has(문항정규화(q))) { 보고.긴형식.제외["시험 문항(사전검사)"] += 1; continue; }
      const system = String(r.system ?? "").trim() || 프롬프트.system;
      // ★ D행 = **근거 블록을 실은 긴 A행**이다(2026-09-04 결정 D3). 인용 정책도 A와 같다.
      //   예전 코드는 「긴 형식 행은 근거 블록이 없다」고 **단정**하고 strict에서 인용을 통째로 뗐는데,
      //   실측하면 longform-vuln-v1.json 121행이 전부 블록을 싣고 121행 전부에 인용이 달려 있다 —
      //   즉 그 한 줄이 재료의 값어치(근거에서 뽑아 길게 쓰는 법)를 매번 지우고 있었다.
      const 근거들 = 근거조각뽑기(system, 프롬프트.ragHeader);
      if (근거들.length) 보고.긴형식.근거블록.있음 += 1; else 보고.긴형식.근거블록.없음 += 1;
      let answer = a0;
      if (QUOTE_RULE === "strict") {
        if (근거들.length) {
          // A행과 **같은 자**로 잰다(인용붙이기): 근거 밖 인용은 떼고 근거에서 다시 붙인다.
          const 결과 = 인용붙이기(a0, 근거들);
          if (!결과.answer) {
            보고.긴형식.제외["인용 없음(strict)"] += 1;
            보고.긴형식.인용규칙[결과.뗌 ? "버림(근거 밖 인용·대신 붙일 문장 없음)" : "버림(겹치는 문장 없음)"] += 1;
            continue;
          }
          answer = 결과.answer;
          보고.긴형식.인용규칙[결과.붙임 ? (결과.뗌 ? "갈아끼움(근거 밖 인용을 떼고 다시)" : "새로 붙임") : "그대로(근거에서 온 인용)"] += 1;
        } else {
          // 블록이 없는 D행은 인용할 근거가 없다 — 옛 규칙 그대로 뗀다.
          answer = 인용떼기(a0);
          보고.긴형식.인용규칙["뗌(근거 블록 없는 행)"] += 1;
        }
      }
      rows.push({ question: q, answer, system });
      종류들.push("D");
      보고.긴형식.실림 += 1;
    }
    console.log(
      `[raft] 긴 형식: 읽음 ${보고.긴형식.읽음} · 실림 ${보고.긴형식.실림}` +
      ` · 근거블록 있음 ${보고.긴형식.근거블록.있음}/없음 ${보고.긴형식.근거블록.없음}` +
      ` · 제외 ${JSON.stringify(보고.긴형식.제외)}`
    );
    if (QUOTE_RULE === "strict") {
      console.log("[raft] 긴 형식 인용 규칙(strict) " + Object.entries(보고.긴형식.인용규칙).map(([k, v]) => `${k} ${v}`).join(" · "));
    }
  }

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

  // ④-3 구성비·사전검사 — **저장하기 전에** 판이 스스로를 배반하지 않는지 본다.
  // ⚠ ragHeader를 **반드시** 넘긴다 — 안 넘기면 구성비가 「전부 근거 없음」으로 보고(fail-closed)
  //   근거 블록을 실은 A·D행이 통째로 사전검사에 걸린다.
  const 구성 = 구성비(rows, 종류들, { ragHeader: 프롬프트.ragHeader });
  보고.구성 = 구성;
  보고.사전검사 = 사전검사(구성, { 폐쇄형충돌허용: ALLOW_CB });
  const 표줄 = (k, 이름) =>
    `  ${이름.padEnd(14)} ${String(구성.표[k].행).padStart(5)}행 ${(구성.표[k].비율 * 100).toFixed(1).padStart(5)}%`;
  console.log(
    "[raft] 구성비\n" +
    [표줄("A", "A 근거+정답"), 표줄("B", "B 방해만→거절"), 표줄("B2", "B′ 무근거→거절"), 표줄("C", "C 폐쇄형"), 표줄("D", "D 긴 형식")].join("\n") +
    `\n  「원문:」 A행 ${구성.인용.A행.인용}/${구성.인용.A행.행}(${(구성.인용.A행.비율 * 100).toFixed(1)}%)` +
    ` · 비A행 ${구성.인용.비A행.인용}/${구성.인용.비A행.행}(${(구성.인용.비A행.비율 * 100).toFixed(1)}%)` +
    // ★ 사전검사가 **실제로 보는** 세 칸(글로 가른 것). 위 A/비A는 갈래 이름으로 센 참고용이다.
    `\n  근거블록 있고 거절 아님 ${구성.인용.근거인용가능.인용}/${구성.인용.근거인용가능.행}` +
    ` · 근거블록 없음 ${구성.인용.근거블록없음.인용}/${구성.인용.근거블록없음.행}(0이라야 한다)` +
    ` · 거절행 ${구성.인용.거절행.인용}/${구성.인용.거절행.행}(0이라야 한다)` +
    `\n  답 길이 p50 ${구성.답길이.p50} · p90 ${구성.답길이.p90} · max ${구성.답길이.max} · 3절 이상 ${구성.절3이상}행`
  );
  // strict가 **무엇을 했는지** 사람 눈에도 보인다 — 「그대로」만 크면 개입이 재료에 안 닿은 것이다.
  if (QUOTE_RULE === "strict") {
    console.log("[raft] 인용 규칙(strict) " + Object.entries(보고.인용규칙).map(([k, v]) => `${k} ${v}`).join(" · "));
  }
  for (const w of 보고.사전검사.경고) console.warn(`[raft] ⚠ ${w}`);

  // 맛보기는 **갈래마다 하나씩** 본다 — 앞에서 3행만 뜨면 A행만 보여 「거절 행이 정말 만들어졌나」를 못 본다.
  //   사전검사에 걸렸을 때는 **걸린 행**(비A행인데 인용이 남은 것)을 맨 앞에 붙인다. 사유만 있고 실물이 없으면
  //   사람이 그 판을 못 고친다.
  const 맛보기만들기 = () => {
    const 고른자리 = ["A", "B", "B2", "C", "D"].map((k) => 종류들.indexOf(k)).filter((i) => i >= 0);
    // 걸린 행을 고르는 잣대도 사전검사와 **같은 잣대**여야 한다(글로 판단 — 갈래 이름이 아니라).
    // 다르면 「사유는 D를 가리키는데 맛보기는 B를 보여 주는」 어긋남이 생긴다.
    const 걸린자리 = rows.findIndex((r) =>
      인용흔적있나(r.answer) &&
      (!근거블록있나(r.system, 프롬프트.ragHeader) || String(r.answer ?? "").trim().startsWith(거절답))
    );
    const 자리들 = [...new Set([...(걸린자리 >= 0 ? [걸린자리] : []), ...고른자리])];
    return 자리들.map((i) => ({
      갈래: 종류들[i], question: rows[i].question,
      answerHead: rows[i].answer.slice(0, 120), systemHead: rows[i].system.slice(0, 400),
    }));
  };

  const 보고서쓰기 = () => {
    보고.finishedAt = new Date().toISOString();
    const dir = path.join(저장소, "tools", "team-bench", "results-ladder", NAME);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, "build-report.json");
    fs.writeFileSync(out, JSON.stringify(보고, null, 2), "utf8");
    return out;
  };

  if (!보고.사전검사.통과) {
    // 여기서 멈춘다 — 위생(서버)이 못 보는 결함이라, 저장해 버리면 그 판으로 몇 시간을 굽는다.
    보고.저장 = { 함: false, 이유: "사전검사 실패: " + 보고.사전검사.실패.join(" / ") };
    보고.맛보기 = 맛보기만들기();
    const out = 보고서쓰기();
    for (const f of 보고.사전검사.실패) console.error(`[raft] ✖ ${f}`);
    console.error(`[raft] 사전검사에 걸려 저장하지 않았습니다 — 보고서 ${out}`);
    // ⚠ process.exit()로 튀지 않는다 — 튀면 꼬리의 finally가 **안 돌아** 세션이 남는다
    //   (계정당 1세션이라 그 유령이 다음 도구를 30분 막는다). 종료 코드는 그대로 1이다.
    process.exitCode = 1;
    return;
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

  // 맛보기만 남긴다(system은 400자로 자른다) — 전체 행은 파일로 안 떨군다(머리 주석의 ⚠).
  보고.맛보기 = 맛보기만들기();

  const out = 보고서쓰기();
  console.log(
    `[raft] 끝 — 승인 ${보고.승인문답} · ref ${보고.ref총} · 회수 ${(보고.회수율 * 100).toFixed(1)}%` +
    `(저장소 ${보고.회수.store}·파일 ${보고.회수.file}·실패 ${보고.회수.실패}) · 제외 ${JSON.stringify(보고.제외)}` +
    ` · 행 ${보고.행} · 토큰추정 평균 ${보고.토큰추정.평균}/p95 ${보고.토큰추정.p95} · 보고서 ${out}`
  );
  if (보고.방해라이선스노출.행) {
    console.warn(
      `[raft] ⚠ 허용목록 밖 문서의 문장이 **방해 조각으로** ${보고.방해라이선스노출.행}행에 실렸습니다` +
      ` (${Object.keys(보고.방해라이선스노출.문서별).slice(0, 3).join(", ")}…) —` +
      ` 재배포 위험을 사람이 판단해야 합니다.` +
      ` (**데이터셋에 실제로 실린 행만** 셉니다 — strict 인용 규칙에 걸려 버려진 행은 안 셉니다.)` +
      (DISTRACTOR_ALLOWLIST
        // 허용목록을 걸었는데도 새면 **거르는 자가 새는 것**이다 — 경보의 뜻이 완전히 다르다.
        ? ` ★ 허용목록을 걸었는데도 0이 아닙니다 — 거르는 자가 새고 있습니다(판정기 ${보고.라이선스판정}를 보세요).`
        : ` (--no-distractor-allowlist 로 껐습니다 — 기본값이면 이 숫자는 0입니다.)`)
    );
  }
}

// 짝 시험이 위 순수 함수들을 import한다 — **직접 실행할 때만** 본체가 돈다(import로는 안 돈다).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  // ★ try/finally — 성공·실패·사전검사 중단 **어디로 끝나든 세션을 닫는다.**
  //   process.exit()는 finally를 건너뛰므로 여기서도 main() 안에서도 안 쓴다(exitCode만 세운다).
  try {
    await main();
  } catch (e) {
    console.error("[raft] 실패:", e.message);
    process.exitCode = 1;
  } finally {
    await 로그아웃();
  }
}
