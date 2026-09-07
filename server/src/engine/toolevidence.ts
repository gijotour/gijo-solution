// engine/toolevidence.ts — **도구가 실제로 읽은 근거를 위로 올려 보내는 통로**(잎 모듈, import 0).
//
// ■ 왜 생겼나 (2026-09-08 라이브 실측)
//   근거 배지(sources·근거세기·quotes)의 **생산자가 한 곳뿐**이다 — dispatcher의 재검색 블록
//   (computeOfferSignals → queryMemoryGraded). 그런데 근거재검색대상인가()는 explain·search·
//   law_lookup 같은 조회 도구가 돌면 그 블록을 **건너뛴다**. 즉 도구가 답한 자리에는
//   **소비자만 있고 생산자가 없다** — 라이브에서 explain이 답한 두 물음이 전부 sources=null ·
//   근거세기=「-」였다. 문서를 읽고 답해 놓고 「무엇을 근거로 했는지」를 못 말한 것이다.
//
// ■ 이것은 계약 **우회가 아니라 이행**이다
//   sourcebadge.test:37은 「법령·개념 설명은 자기 근거라 사내 문서 **재검색**을 하지 않는다」고
//   못박아 두었다. 재검색을 하지 말라는 뜻이지 근거를 대지 말라는 뜻이 아니다 — explain이
//   **자기가 읽은 것**을 실으면 dispatcher의 `result.sources !== undefined`가 먼저 false를 내고,
//   집계조회도구_RE는 한 글자도 안 바뀐 채 계약이 지켜진다.
//
// ■ 왜 반환값이 아니라 꼬리표인가
//   AgentTool.run은 `Promise<string>` 한 모양이다(registry.ts). 도구마다 시그니처를 바꾸면
//   30여 개 도구와 결재판·인자 검증이 함께 흔들린다 — viewer·문서 범위 때 이미 같은 문제를
//   겪었고 그때도 답은 **요청 하나 동안만 따라다니는 꼬리표**였다(ragscope.ts·viewerctx.ts와
//   같은 무늬). 여기서는 반대 방향으로 흐른다: 위에서 아래가 아니라 **아래에서 위로**.
//
// ⚠ 첫 보고만 담는다 — 한 턴에 도구가 여러 번 돌면 **먼저 읽은 근거**가 답의 근거다.
//   나중 것으로 덮으면 「배지가 답과 다른 문서」(2026-08-10 사고 계보)가 되돌아온다.
// ⚠ 근거세기를 **반드시 함께** 싣는다. 클라(chatparts.js)는 `약함 = (근거세기==="약함")`이라
//   근거세기가 비면 초록 「📄 근거」로 그린다 — sources만 실으면 **새 거짓 배지**가 생긴다.
import { AsyncLocalStorage } from "node:async_hooks";

export interface SourceQuoteLite {
  documentId: string;
  text: string;
}

/** 도구가 실제로 읽은 근거 — dispatcher의 재검색 블록이 내는 값과 **같은 세 칸**이다. */
export interface 도구근거 {
  sources: string[];
  근거세기: "강함" | "약함";
  quotes?: SourceQuoteLite[];
}

/** 한 턴 동안 근거를 담아 두는 그릇. 부르는 쪽이 만들어 넘긴다(만든 사람이 읽는다). */
export interface 근거수거 {
  값?: 도구근거;
}

const store = new AsyncLocalStorage<근거수거>();

/** 새 그릇 하나. */
export function 새근거수거(): 근거수거 {
  return {};
}

/** fn이 도는 동안(그 안의 비동기 포함) 도구가 근거를 담을 수 있게 한다. */
export function 근거를수거하며<T>(그릇: 근거수거, fn: () => T): T {
  return store.run(그릇, fn);
}

/** 도구가 「내가 읽은 것은 이것이다」라고 알린다. 수거 중이 아니면 조용히 무시한다. */
export function 도구근거보고(근거: 도구근거): void {
  const 그릇 = store.getStore();
  if (!그릇 || 그릇.값) return; // ⚠ 첫 보고만 — 나중 것으로 덮지 않는다(위 머리말)
  if (!근거.sources.length) return; // 빈 근거는 「근거 없음 확정」과 뜻이 달라 싣지 않는다
  그릇.값 = 근거;
}
