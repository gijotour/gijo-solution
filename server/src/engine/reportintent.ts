// engine/reportintent.ts — 「보고서를 만들어 달라」는 의도의 **단일 출처**(import 0개 잎 모듈).
//
// ■ 왜 따로 뺐나 (2026-09-11 검토관 [상] — B6-① 뒷수습)
//   dispatcher.ts가 REPORT_CREATE_RE로 [36] 리포트 만들기를 가르는데, datacard.ts는 그 배제를
//   **자기 정규식으로 베껴** 두었다(`/(보고서|리포트).{0,4}(만들|작성|생성|뽑아|써)/`).
//   동사 「출력·뽑」이 빠지고 사이 간격이 4자 대 12자라, 「하드닝 점검 **결과** 리포트 출력해줘」가
//   [36]을 못 가고 [17] 현황 카드에 붙들렸다(route-explain 실측 — 「결과」만 빼면 [36]으로 간다).
//   담당자가 월간·감사 제출용 보고서를 못 받는다. 앞뒤 모두 결정적 갈래라 확률이 아니라 100%다.
// ■ 왜 dispatcher.ts에 둔 채 import하지 않나 — dispatcher.ts가 datacard.ts를 부르므로(동적
//   import) 반대 방향 static import는 순환이 된다. import 0개인 잎 모듈로 내려 두 곳이 **같은
//   상수**를 본다(tone.ts 준수율집계전단서와 같은 처방).
// ⚠ dispatcher.ts는 이 둘을 그대로 **재수출**한다 — routingfixes.test.ts가 거기서 가져다 쓴다.

/** "보고서를 만들어 달라"는 의도 — 조회(스케줄·이력)와 갈라야 한다. */
export const REPORT_CREATE_RE = /(리포트|보고서)[^\n]{0,12}(만들|생성|작성|뽑|출력)|(만들|생성|작성)[^\n]{0,8}(리포트|보고서)/;
/** 위에 걸려도 **조회**면 리포트를 만들지 않는다("리포트 자동 생성 언제야"). */
export const REPORT_QUERY_EXCLUDE_RE = /스케줄|일정|예약|언제|이력|목록/;

/** [36] 리포트 만들기로 **실제로 가는** 말인가 — 두 조건을 한 곳에서 묶는다.
 *  ⚠ 배제하는 쪽(datacard.ts 결과꼴)은 반드시 이 함수를 쓴다. 두 조건 중 하나만 베끼면
 *    「[36]에 가지도 않는데 [17]에서 배제되는」 말이 생겨 어느 갈래에도 안 걸린다. */
export function 리포트만들기지시(text: string): boolean {
  const t = String(text || "");
  return REPORT_CREATE_RE.test(t) && !REPORT_QUERY_EXCLUDE_RE.test(t);
}
