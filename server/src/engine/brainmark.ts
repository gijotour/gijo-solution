// engine/brainmark.ts — **어느 두뇌가 답했나**를 요청 밖으로 올려 보내는 통로(잎 모듈, import 0).
//
// ■ 왜 생겼나 (2026-09-10)
//   운영은 전역 원격이 켜진 채 팀원 셋(report·normaltic·ti)이 원격(gb10 Flash-Next)으로 간다.
//   그런데 답을 받아 보는 쪽 — 담당자도, 회귀 하네스도 — **누가 답했는지 알 길이 없었다.**
//   같은 질문이 어느 날은 125B, 어느 날은 이 PC 14B로 답하는데 기록에는 둘이 똑같이 남는다.
//   원격이 죽어 이 PC로 되돌린 답(llm.ts 폴백)도 겉보기가 같아, 성능이 뚝 떨어진 날의 원인을
//   사후에 못 가린다. 「무엇을 쟀는지 모르는 숫자」는 이 저장소가 가장 경계하는 부류다.
//
// ■ 왜 반환값이 아니라 꼬리표인가
//   chat()은 `Promise<string>` 한 모양이다(llm.ts). 반환에 칸을 더하면 부르는 자리 전부와
//   스트림 싱크가 함께 흔들린다. citesource.ts가 **같은 이유로 고른 같은 무늬**다.
//
// ■ 왜 llm.ts가 아니라 **따로 선 파일**인가
//   llm을 통째로 흉내 내는 시험이 66파일이고(`vi.mock("../src/engine/llm", …)`), 그 목은 표면을
//   손으로 나열한다 — dispatcher가 llm에서 심볼을 **하나만 더** 가져와도 그 66개가 통째로 죽는다
//   (citesource.ts 머리말이 같은 함정을 이미 적어 두었다). 잎 모듈은 아무도 목으로 안 덮는다.
//
// ⚠ **그릇은 /api/dispatch·/api/dispatch/stream 두 입구가 모두 놓는다**(citesource와 다른 점).
//   여기 담기는 것은 조각 본문 같은 사내 자료가 아니라 「local/remote·폴백 여부」뿐이라
//   사람 응답에 실어도 노출면이 안 넓어진다 — 오히려 **정직**의 문제라 사람이 봐야 한다.
//   ⚠ 단 **모델 이름은 qa에만** 싣는다(아래 두뇌표식실어보내기). 담당자에게 필요한 것은
//     「지금 바깥으로 나갔나」이고, 모델 id는 하네스가 회차를 견주는 재료다 — 기본값을 좁게 둔다.
//   ⚠⚠ **그런데 qa는 권한 경계가 아니다.** dispatcher.ts가 `req.body?.qa === true`로만 읽으므로
//     로그인한 사람이면 누구나 켤 수 있다(같은 파일 :276이 근거원천에 대해 이미 못박아 둔 사실).
//     그러니 여기 「qa에만」은 **기본값을 좁힌 것**이지 비밀을 지키는 담이 아니다 — 담이 필요해지면
//     역할 검사를 라우트에 따로 걸어야 한다. 새는 값이 모델 id 하나뿐이라(주소·토큰은 /where도
//     안 준다) 지금은 담을 안 세운다. ★ 처음엔 이 자리에 「설정 권한의 몫」이라 적었는데 코드가
//     그 말을 지키지 않았다 — 검토관이 잡았다(2026-09-10). **말을 코드에 맞춘다.**
import { AsyncLocalStorage } from "node:async_hooks";

/** 두뇌가 도는 자리 — 「이 PC」인가 「원격 GPU」인가. */
export type 두뇌위치 = "local" | "remote";

/** 한 번의 요청에서 **답을 만든 두뇌**. 하네스가 「누가 답했나」를 기록하는 재료다. */
export interface 두뇌표식 {
  location: 두뇌위치;
  /** 원격으로 가려다 못 닿아 이 PC로 되돌린 답인가(llm.ts 원격 폴백). */
  fallback: boolean;
  /** 원격/로컬이 스스로 밝힌 모델 id. 못 받으면 null. */
  model: string | null;
  /**
   * 이 요청에서 **답을 만든** chat이 돈 횟수(분류기·결정 호출은 안 센다 — 아래 두뇌표식보고).
   * 1이 아니면 이 표식은 **답 전체의 두뇌가 아니다**(오케스트레이션은 여러 팀원을 거친다).
   */
  보고횟수: number;
}

/** 한 요청 동안 표식을 담아 두는 그릇. 부르는 쪽이 만들어 넘긴다(만든 사람이 읽는다). */
export interface 두뇌표식수거 { 값?: 두뇌표식 }

const store = new AsyncLocalStorage<두뇌표식수거>();

/** 새 그릇 하나. */
export function 새두뇌표식수거(): 두뇌표식수거 {
  return {};
}

/** fn이 도는 동안(그 안의 비동기 포함) chat이 표식을 담을 수 있게 한다. */
export function 두뇌표식을수거하며<T>(그릇: 두뇌표식수거, fn: () => T): T {
  return store.run(그릇, fn);
}

/**
 * chat이 「이 두뇌로 답했다」고 알린다. 수거 중이 아니면 조용히 무시한다.
 *
 * ★ 부르는 쪽(llm.ts)은 **조건 없이 한 줄**로 부른다 — 「어떤 호출이 답한 두뇌인가」는
 *   **이 한 곳에서만** 가른다(잣대 한 곳). 부르는 자리마다 조건을 적으면 새 호출부가 그 조건을
 *   빼먹고, 이 저장소가 이름 붙인 「같은 것을 여러 곳에 적으면 어긋난다」가 된다.
 *
 * ★★ **내부 호출은 답한 두뇌가 아니다** — citesource가 겪은 함정의 대칭이다.
 *   한 요청의 **첫** chat()은 답이 아니라 의도 분류기다(dispatcher:1946 routeIntent → intent.ts:106).
 *   총괄은 언제나 이 PC라(llm.ts resolveRemoteTarget ⓪) 그 호출을 담으면 표식이 **언제나
 *   local**이 되어, 원격으로 답한 날에도 「이 PC가 답했다」는 거짓 기록이 남는다.
 *
 *   ★ 2026-09-10 검토관 적발 — 처음엔 이 함정을 `결정호출`(responseSchema) 하나로 막았는데
 *     **정작 머리말이 지목한 그 분류기를 못 걸렀다.** intent.ts:106은 스키마 없이 산문으로 부른다
 *     (`chat({ agentId: "orchestrator", message: buildFewShotPrompt(text), trusted: true })`).
 *     그래서 실측에서 답 본문은 「원격 두뇌가 닿지 않아…」인데 같은 응답의 brain은
 *     `{location:"local", fallback:false}`였다 — **사람이 읽는 줄과 기계가 읽는 칸이 서로 반대**.
 *     스키마 잣대는 agentloop:2820(도구 인자 뽑기)만 걸렀다. 「막았다고 적어 둔 것」과
 *     「막힌 것」이 달랐던 셈이라, 잣대를 사실에 맞게 다시 세운다.
 *
 * ★★★ **잣대는 「사람이 그대로 읽는 답인가」(llm.ts args.explain)**다. llm.ts가 이미 같은 자리에서
 *   같은 잣대를 쓴다 — 용어 그라운딩이 `args.responseSchema || !args.explain`으로 갈린다(llm.ts:979).
 *   「내부 결정문·분류문에 사람용 처리를 걸지 않는다」는 그 규칙과 **같은 경계**다.
 *   explain을 켠 자리는 셋뿐이고 전부 담당자 화면에 그대로 나가는 최종 답이다 —
 *   dispatcher:489·503(라우팅된 본답)·agentloop:906(도구 실행 뒤 최종 답).
 *   ⚠ 그래서 **총괄이라고 무조건 빼지 않는다**: agentloop:906은 총괄이 쓰는 **진짜 답**이라
 *     agentId로 걸렀다면 그 경로의 표식이 통째로 사라졌을 것이다(과잉 수리).
 * ⚠ 스키마 갈래도 그대로 둔다 — `/api/llm/chat`은 `{...req.body, explain:true}`라 부르는 쪽이
 *   responseSchema를 함께 실을 수 있다(llm.ts:1548). 둘 중 하나만으로는 새는 자리가 남는다.
 * ⚠ **LLM이 안 돈 답·내부 호출만 돈 답에는 표식이 없다.** 그것은 결함이 아니라 사실이고,
 *   소비자(dispatcher 응답 칸·ops-sim ⑲)가 이미 「없으면 건너뛴다」로 읽는다.
 * ⚠ 답을 만든 chat이 여러 번이면 **첫 것만 담고 횟수를 센다**(citesource와 같은 규칙).
 */
export function 두뇌표식보고(보고: {
  location: 두뇌위치;
  fallback: boolean;
  model: string | null;
  /** 도구 고르는 JSON 결정 호출인가(llm.ts args.responseSchema). */
  결정호출: boolean;
  /** 담당자가 그대로 읽는 답인가(llm.ts args.explain). 분류기·내부 프롬프트는 false. */
  사람이읽는답: boolean;
}): void {
  const 그릇 = store.getStore();
  if (!그릇) return;
  // ★★ 잣대는 여기 한 줄 — 부르는 쪽은 사실만 넘긴다(위 머리말 ★★★).
  if (보고.결정호출 || !보고.사람이읽는답) return;
  if (그릇.값) { 그릇.값.보고횟수++; return; }
  그릇.값 = { location: 보고.location, fallback: 보고.fallback, model: 보고.model, 보고횟수: 1 };
}

/**
 * 응답에 실을 모양으로 깎는다 — **모델 이름을 가리는 잣대는 여기 한 곳**이다.
 *
 * ⚠ 두 입구(/api/dispatch·/api/dispatch/stream)가 같은 함수를 쓴다. 라우트마다 `if (qa)`를
 *   적으면 한쪽만 고쳐져 **사람 응답에 모델 이름이 새는 날**이 온다(두 입구가 딴말을 한 전례가
 *   dispatcher.ts에 여럿이다 — 빈 지시 400·☑📎 처리).
 * ⚠ 보고횟수는 안 싣는다 — 지금 소비자(하네스)가 쓰지 않는 값을 응답 계약에 넣으면 그것부터
 *   「소비자 없는 값」이 된다. 필요해지는 날 이 한 곳에 더한다.
 */
export function 두뇌표식실어보내기(값: 두뇌표식, qa: boolean): { location: 두뇌위치; fallback: boolean; model?: string } {
  const 실을것: { location: 두뇌위치; fallback: boolean; model?: string } = { location: 값.location, fallback: 값.fallback };
  if (qa && 값.model) 실을것.model = 값.model;
  return 실을것;
}
