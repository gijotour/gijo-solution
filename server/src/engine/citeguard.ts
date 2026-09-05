// engine/citeguard.ts — **지어낸 인용을 코드가 뗀다**(2026-09-05, 사장님 「추천안수용」 묶음).
//
// ■ 무엇을 막나
//   모델(7B/14B)이 근거가 없는데도 「원문: "…"」·「[2]에 따르면 "…"」 꼴을 만들어 **자기 문장을
//   남의 원문이라 인용한** 실물이 있다(사다리 표본 실측 50건 — bare·persona·distractor-only).
//   보안 담당자에게 이건 오답보다 나쁘다: 없는 출처를 근거로 결재가 올라간다.
//
// ■ 왜 프롬프트가 아니라 코드인가 (CLAUDE.md 원칙 — 이 저장소가 네 번 실패한 자리)
//   실측 2026-09-04: 「원문 그대로 인용하라」는 **지시 문구를 넣었더니 지어낸 출처가 5→8건으로
//   늘었다.** 프롬프트는 「꼴」을 가르칠 뿐 「없을 때 안 쓰는 것」을 가르치지 못한다.
//   그래서 프롬프트는 꼴 안내까지만 하고, **가리킬 근거가 실제로 있는지는 이 파일이 판정**한다.
//
// ■ 잣대를 새로 짓지 않는다(단일 출처)
//   · 20자 겹침 = 근거겹침(원래 learncandidates.ts에 있던 것을 **여기로 옮겼다**).
//     옮긴 이유는 순환이다 — llm → learncandidates → learnloop → llm. 이 파일은 engine 안의
//     **잎**이라(엔진 모듈을 하나도 안 문다) llm이 안전하게 물 수 있다. learncandidates는
//     여기서 재수출해 기존 import 경로(distillintake·distillprecheck 시험)를 그대로 지킨다.
//   · 꼬리표 정규식 두 개는 관문(tools/team-bench/gates.mjs ⑨ 창작인용)의 것과 **글자 그대로**
//     같다 — 짝 시험(citeguard.test.ts)이 두 소스를 대조한다. 관문이 「모델이 지어냈나」를 재고,
//     이 파일이 「제품이 그것을 사람에게 내보내나」를 막는다. 잣대가 갈리면 둘이 딴말을 한다.
//
// ■ 이 파일이 **판정하지 않는 것**(정직한 한계 — 늘려 잡으면 정상 답을 지운다)
//   · 조각 목록이 null일 때: RAG를 아예 안 돌린 호출(remember:false — 도구 답 합성 등)이다.
//     그 경로는 agentloop가 `[1] tool: …` 꼴로 **자기 번호**를 매겨 넣으므로, 여기서 「블록이
//     없다」고 뗐다가는 진짜 참조를 지운다. 근거를 모르는 자리에서는 판정을 보류한다.
//   · 20자 미만 따옴표(예: "MFA 필수"): 겹침 창이 20자라 애초에 대조할 수 없다. 손대지 않는다.
//   · 따옴표 없는 풀어쓴 참조(「[1]에 따르면 …를 해야 합니다」): 번호 범위만 본다.
//     글자 대조가 불가능한 것을 대조한 척하지 않는다.
//   · 코드블록(``` … ```) 안: 사용자가 일부러 요청한 원문(SBOM·설정)이라 한 글자도 안 건드린다
//     (rawleak.ts와 같은 판단).

/** 겹침 창 크기 — 이 값이 「20자」 잣대의 단일 출처다(사유 문자열도 이 상수로 짓는다). */
export const OVERLAP_CHARS = 20;

/**
 * 답이 근거 본문과 20자 이상 그대로 겹치는가 — 겹친 창을 돌려준다(없으면 null). 공백은 무시.
 * ⚠ 사본이 셋이다(여기 · tools/distill-precheck.mjs overlap20 · gates.mjs가 그것을 import).
 *   distillprecheck.test.ts:38이 두 함수가 **같은 답**을 내는지 대조한다 — 규칙을 고치면 함께 고친다.
 */
export function 근거겹침(answer: string, sourceText: string): string | null {
  const a = String(answer ?? "").replace(/\s+/g, "");
  const s = String(sourceText ?? "").replace(/\s+/g, "");
  if (a.length < OVERLAP_CHARS || s.length < OVERLAP_CHARS) return null;
  for (let i = 0; i + OVERLAP_CHARS <= s.length; i += 4) {
    const w = s.slice(i, i + OVERLAP_CHARS);
    if (a.includes(w)) return w;
  }
  return null;
}

/** 「원문:」 꼬리표 — gates.mjs 원문꼬리표와 **글자 그대로 같다**(짝 시험이 대조). */
export const 원문꼬리표 = /원문\s*[:：]/;
/** 제품 규약 꼬리표 「[n]에 따르면」 — gates.mjs 제품인용꼬리표와 **글자 그대로 같다**. */
export const 제품인용꼬리표 = /\[\d+\]\s*에\s*따르면/;

/**
 * 실제로 훑을 때 쓰는 꼬리표 — 위 둘의 **상위집합**이다.
 * ⚠ 왜 상위집합인가: 실측 표본에 「[2]에서는 "…"」·「[3]에 의하면 "…"」이 함께 나온다(같은 창작).
 *   관문 ⑨는 회전 1~4의 판정 기록이 걸려 있어 지금 넓히면 옛 판정과 갈리므로 그대로 두고,
 *   **제품 쪽만** 넓힌다. 좁은 쪽(관문)이 잡는 것은 넓은 쪽(제품)도 반드시 잡는다 — 짝 시험이 그것을 본다.
 */
const 꼬리표_RE = /(원문\s*[:：]|\[(\d+)\]\s*(?:에\s*따르면|에서는|에\s*의하면))/g;

/**
 * 꼬리표 바로 뒤에 붙은 따옴표 토막. 종류는 gates.mjs 인용토막들과 같은 네 가지.
 * ⚠ 길이 하한을 안 둔다 — 짧은 토막도 **꼬리표와 한 덩어리로** 떼야 「[1]에 따르면」만 지우고
 *   따옴표가 덩그러니 남는 꼴을 안 만든다. 겹침 판정(③④)에만 20자 하한을 건다.
 */
const 뒤따른인용_RE = /^[\s,·:：]{0,12}("[^"]{1,600}"|“[^”]{1,600}”|「[^」]{1,600}」|'[^']{1,600}')/;

export type 뗀사유종류 = "블록없음" | "범위밖" | "겹침없음" | "자기인용";

export interface 뗀인용 {
  kind: 뗀사유종류;
  /** 가리킨 번호 — 「원문:」 꼴이면 없다. */
  n?: number;
  /** 뗀 인용 토막(따옴표 안). 따옴표가 없던 참조면 빈 문자열. */
  quote: string;
  /** 사람이 읽는 한 줄 — 감독 화면(llm:event)의 detail에 실린다. */
  reason: string;
}

export interface CiteGuardResult {
  text: string;
  removed: 뗀인용[];
}

/** 코드블록(```)의 [시작,끝) 구간 — 이 안은 손대지 않는다. */
function 코드구간(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /```[\s\S]*?(?:```|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * **지어낸 인용을 뗀다.** 순수 함수 — 입력만 보고 판단하며 아무것도 부르지 않는다.
 *
 * @param answer  모델이 낸 답(후처리를 이미 지난 최종 문자열)
 * @param chunks  이 답에 실제로 붙여 준 참고 자료 조각들. `[]`=검색했는데 0건, `null`=RAG를
 *                안 돌림(판정 보류 — 위 머리 주석 「판정하지 않는 것」).
 *
 * 규칙(위에서부터):
 *   ① 블록 없음 — 조각이 0건인데 인용 꼬리표를 썼다. 가리킬 것이 없으므로 전부 뗀다.
 *   ② 범위 밖   — [n]이 1..조각수 밖이다. 없는 번호는 담당자가 찾아볼 수도 없다.
 *   ③ 겹침 없음 — 인용 토막이 **어느 조각과도** 20자 안 겹친다. 지어낸 원문이다.
 *                 (가리킨 번호가 아니라 전체 조각과 견준다 — 번호만 틀린 정상 인용을 안 지우려고.)
 *   ④ 자기 인용 — ③인데 그 토막이 **자기 앞 문장**과 20자 겹친다. 제 말을 남의 원문이라 우긴 것.
 *   ⑤ 빈 답 방지 — 다 떼서 **글자가 하나도 안 남을 때만** 원답을 그대로 둔다(답 전체가 인용뿐).
 *                 ⚠ 문턱을 「20자 미만」으로 뒀다가 짝 시험이 잡았다: 「패치는 빨리 설치해야
 *                 합니다. [5]에 따르면 "…"」처럼 **짧은 진짜 답 + 지어낸 인용**이 통째로 되돌아와
 *                 없는 출처가 그대로 나갔다. 짧고 참인 답이 길고 거짓인 답보다 낫다 —
 *                 보안 제품에서 지어낸 출처는 오답보다 나쁘다.
 */
export function guardCitations(answer: string, chunks: string[] | null): CiteGuardResult {
  const text = String(answer ?? "");
  if (!text.trim()) return { text, removed: [] };
  // 근거를 모르는 자리(RAG 미실행)에서는 판정하지 않는다.
  if (chunks === null || chunks === undefined) return { text, removed: [] };

  const 보호 = 코드구간(text);
  const 보호중 = (i: number) => 보호.some(([a, b]) => i >= a && i < b);

  const removed: 뗀인용[] = [];
  const 지울구간: [number, number][] = [];

  꼬리표_RE.lastIndex = 0;
  let 마지막끝 = 0; // 이미 뗀 구간 안에서 또 잡지 않는다(인용 토막 안에 꼬리표가 또 있는 꼴)
  let m: RegExpExecArray | null;
  while ((m = 꼬리표_RE.exec(text)) !== null) {
    if (보호중(m.index) || m.index < 마지막끝) continue;
    const 꼬리표끝 = m.index + m[0].length;
    const n = m[2] ? Number(m[2]) : undefined;
    const 뒤 = 뒤따른인용_RE.exec(text.slice(꼬리표끝));
    const 인용원문 = 뒤 ? 뒤[1] : "";
    const quote = 인용원문 ? 인용원문.slice(1, -1) : "";
    const 구간끝 = 뒤 ? 꼬리표끝 + 뒤[0].length : 꼬리표끝;

    let kind: 뗀사유종류 | null = null;
    if (chunks.length === 0) {
      kind = "블록없음";
    } else if (n !== undefined && (n < 1 || n > chunks.length)) {
      kind = "범위밖";
    } else if (quote.replace(/\s+/g, "").length >= OVERLAP_CHARS) {
      const 조각겹침 = chunks.some((c) => 근거겹침(quote, c) !== null);
      if (!조각겹침) kind = 근거겹침(quote, text.slice(0, m.index)) !== null ? "자기인용" : "겹침없음";
    }
    if (!kind) continue;

    removed.push({
      kind,
      n,
      quote,
      reason:
        kind === "블록없음" ? `참고 자료가 0건인데 인용 꼬리표를 썼다(${m[1].trim()})`
        : kind === "범위밖" ? `참고 자료는 ${chunks.length}개인데 [${n}]을 가리켰다`
        : kind === "자기인용" ? "인용 토막이 자기 앞 문장과 20자 겹친다(제 말을 원문이라 인용)"
        : "인용 토막이 어느 참고 자료와도 20자 안 겹친다",
    });
    지울구간.push([m.index, 구간끝]);
    마지막끝 = 구간끝;
  }

  if (!지울구간.length) return { text, removed: [] };

  let out = "";
  let 커서 = 0;
  for (const [a, b] of 지울구간) { out += text.slice(커서, a); 커서 = b; }
  out += text.slice(커서);
  // 뗀 자리에 남는 겹공백·홀로 남은 문장부호를 정리한다(문단 구조는 그대로).
  // ⚠ 코드블록이 하나라도 있으면 **정리를 통째로 건너뛴다.** 뗀 자리는 코드블록 밖이지만
  //   이 손질은 글 전체에 걸리므로, 설정 파일 안의 빈 줄·들여쓰기를 조용히 바꿀 수 있다.
  //   사용자가 그대로 복사해 쓰는 글이라 「보기 좋게」가 「틀리게」가 된다.
  const 정리 = 보호.length > 0
    ? out
    : out
        .split("\n")
        .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,·;])/g, "$1").trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

  // ⑤ 빈 답 방지 — **글자가 하나도 안 남을 때만** 원답을 유지한다(뗀 것으로 세지도 않는다).
  //   문턱을 길이로 두면 짧은 진짜 답까지 되돌려 지어낸 인용을 함께 통과시킨다(짝 시험이 잡았다).
  if (!/[\p{L}\p{N}]/u.test(정리)) return { text, removed: [] };
  return { text: 정리, removed };
}

/** 감독 화면(llm:event detail)에 실을 한 줄 — 뗀 건수와 사유 종류만. 인용 원문은 안 싣는다. */
export function 뗀인용요약(removed: 뗀인용[]): string {
  const 종류: Record<string, number> = {};
  for (const r of removed) 종류[r.kind] = (종류[r.kind] ?? 0) + 1;
  const 목록 = Object.entries(종류).map(([k, v]) => `${k} ${v}`).join(" · ");
  return `근거 없는 인용 ${removed.length}건 제거 — ${목록}`;
}
