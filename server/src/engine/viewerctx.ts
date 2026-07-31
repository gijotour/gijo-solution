// 지금 묻고 있는 사람이 누구인가 — 요청 하나 동안만 따라다니는 꼬리표.
//
// 왜 필요한가(2026-08-01 실검증에서 잡힌 뚫린 문):
//   등급 통제는 "검색할 때 열람 등급을 같이 넘긴다"로 동작한다. 그런데 넘기는 자리가
//   한 곳이 아니다 — 대화(llm.ts), 지식검색 화면(/api/memory/query), 그리고 **AI 도구**
//   (search·explain)가 각각 검색을 부른다. 도구는 `run(args)` 한 가지 모양으로 등록돼 있어
//   사람을 넘길 자리가 아예 없었다. 그래서 담당자가 대화창에서 "log4shell 찾아줘"라고 하면
//   기밀 문서 본문이 그대로 딸려 나왔다 — 대화는 막고 도구는 열어 둔 셈이다.
//
//   도구 40여 개의 시그니처를 전부 바꾸는 대신, 요청이 시작될 때 한 번 꼬리표를 달아 두고
//   검색이 그걸 집어 가게 한다(Node 표준 AsyncLocalStorage — 요청 단위 문맥의 정석).
//
// ⚠ 이건 **덧문**이지 대문이 아니다. 명시로 넘긴 viewer가 있으면 그쪽이 항상 이긴다.
//   꼬리표가 없으면(배치·부팅 시 인입 같은 시스템 작업) 아무것도 가리지 않는다 —
//   내부 작업이 통째로 죽는 편이 더 나쁘기 때문이다.
import { AsyncLocalStorage } from "node:async_hooks";

export interface ViewerTag {
  userId?: string | null;
  clearance?: string | null;
}

const store = new AsyncLocalStorage<ViewerTag>();

/** 이 함수가 도는 동안(그 안에서 부른 비동기 포함) 사람 꼬리표를 달아 둔다. */
export function runWithViewer<T>(viewer: ViewerTag | undefined | null, fn: () => T): T {
  if (!viewer) return fn();
  return store.run(viewer, fn);
}

/** 지금 요청의 사람. 요청 밖(배치 등)이면 undefined. */
export function currentViewer(): ViewerTag | undefined {
  return store.getStore();
}
