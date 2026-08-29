// 이 요청이 지정한 근거 범위 — 요청 하나 동안만 따라다니는 꼬리표(viewerctx.ts와 같은 무늬).
//
// 왜 필요한가(2026-08-30 노트북형 개편 설계관 검토):
//   「내 문서」에서 문서를 ☑ 체크해 「이 문서들을 근거로」 지정하는 기능인데, 그 지정을
//   소비해야 할 자리가 한 곳이 아니다 — 대화 RAG(llm.ts ragContextFor), normaltic 엄격
//   그라운딩(llm.ts), 근거 배지(dispatcher.ts computeOfferSignals), 그리고 **AI 도구**
//   (search·explain — 「이 문서에서 X 뭐야」 말투는 agentloop가 explain 도구로 강제한다).
//   도구는 run(args) 한 모양이라 지정을 넘길 자리가 없다 — viewer 때와 똑같은 문제다.
//   시그니처를 다 바꾸는 대신 요청 시작에 꼬리표를 달고, 검색(memory.ts hybridSearch)이
//   where 절에서 집어 가게 한다. **한 기계**라서 답·배지·도구가 같은 범위를 본다.
//
// ⚠ 보안: 지정 필터는 기존 등급 가림(hiddenDocIds NOT IN)에 **AND로 겹친다** — 지정이
//   가림을 푸는 일은 원리상 없다(교집합만 좁아진다). ragscope.test가 이 겹침을 못박는다.
// ⚠ 첨부(attachText)는 검색 질의가 아니라 **LLM 맥락 전용**이다 — buildRagQuery에 태우면
//   질의가 희석돼 근거 배지가 엉뚱한 문서를 가리킨다(2026-08-10 「배지가 답과 다른 문서」
//   사고 계보). 그래서 message/contextText에 섞지 않고 이 꼬리표로만 나른다.
import { AsyncLocalStorage } from "node:async_hooks";

export interface RagScopeTag {
  /** ☑로 지정한 문서 documentId 목록(검색 세계의 키 — 개인 문서는 "personal:<uuid>"). */
  docIds?: string[];
  /** 📎로 첨부한 지난 작업의 결정적 압축 텍스트(이미 조립 완료). */
  attachText?: string;
}

const store = new AsyncLocalStorage<RagScopeTag>();

/** 이 함수가 도는 동안(그 안의 비동기 포함) 근거 범위 꼬리표를 달아 둔다. */
export function runWithRagScope<T>(tag: RagScopeTag | undefined | null, fn: () => T): T {
  if (!tag || (!tag.docIds?.length && !tag.attachText)) return fn();
  return store.run(tag, fn);
}

/** 지정 문서 목록. 지정이 없으면 빈 배열(= 전체 검색, 기존과 동일). */
export function currentDocIds(): string[] {
  return store.getStore()?.docIds ?? [];
}

/** 첨부한 지난 작업 텍스트. 없으면 undefined. */
export function currentAttachText(): string | undefined {
  return store.getStore()?.attachText || undefined;
}

// ── 입구 소독 — docIds는 사용자가 임의 문자열을 넣을 수 있는 새 창구다 ──────────
// 상한 선례: 보는목록 50건·200자(app.html). 개수·길이 상한이 없으면 where 절이 폭주한다.
// ⚠ 쉼표·공백 금지 검사는 안 한다 — 문서명(documentId=파일명)에 공백·한글이 흔하다.
//   작은따옴표는 여기서 거르지 않고 검색부의 escapeLiteral이 처리한다(한 곳 원칙).
export const DOC_IDS_MAX = 50;
export const DOC_ID_LEN_MAX = 200;

export function sanitizeDocIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim().slice(0, DOC_ID_LEN_MAX);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= DOC_IDS_MAX) break;
  }
  return out;
}

/** 첨부 세션 id 소독 — 최대 3개(예산: 세션당 ≈1,200자 압축 × 3 ≈ 3,600자 — 라이트 ctx 8K 고려). */
export const ATTACH_MAX = 3;
export function sanitizeAttachIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && !!v.trim())
    .map((v) => v.trim().slice(0, 80))
    .slice(0, ATTACH_MAX);
}
