// engine/docorigin.ts — memory_documents.origin을 읽는 **잣대 한 곳**(잎 모듈, import 0).
//
// 왜 이 파일이 생겼나(2026-09-04): 「승인 문답·침해사고 사례 문서는 사람이 올린 문서가 아니니
// 목록에서 뺀다」는 결정은 **하나**인데 그 잣대가 다섯 벌로 흩어져 있었다(docdigest 대장 ·
// docdupe 중복후보 · memory 새문서배지 · AI 지식 화면 · 문서 허브). 실제로 서버 세 곳만 고치고
// 클라 두 곳을 잊어, 사람이 못 읽는 「incident-case:ic-…」 20줄이 화면에 떴다(2026-09-03 검토 적발).
// 지식 위생 점검이 여섯 번째 자리라, 손으로 또 적는 대신 잣대를 여기로 모은다.
//
// ⚠ 왜 memory.ts가 아닌가: docdigest·docdupe는 memory(지식 층)로 가는 **정적 화살이 없다**
//   (의존 수리 2026-08-28 원칙 — 코퍼스 창구조차 동적 import를 쓴다). 술어를 memory.ts에 두면
//   그 화살을 새로 긋게 된다. 그래서 아무것도 import하지 않는 잎으로 둔다.
//
// ⚠ 여기 없는 소비처(teamview·observability·handlers)는 **뜻이 다르다** — 승인 문답만 빼고
//   사례 문서는 「지식 건수」에 든다(incidentcases 결정 ①). 뜻이 다른 자리를 같은 술어로 묶지 않는다.

/** 제품이 스스로 쌓는 문서의 origin — 승인 문답(learnmemory) · 침해사고 사례(incidentcases). */
export const 제품자동_ORIGIN = ["approved-qa", "incident-case"] as const;
/** 「사람이 새로 반입한 문서」로 세지 않는 origin — 위 + 제품 내장(builtin: 반입이 아니라 동봉물). */
export const 반입아님_ORIGIN = ["builtin", ...제품자동_ORIGIN] as const;

// ⚠ 반드시 **blacklist**(든 것만 뺀다)로 판정한다 — whitelist(origin===null만 통과)로 뒤집으면
//   origin을 안 채운 옛 문서·모의 객체가 통째로 사라진다(같은 결정, 반대 사고).
const 든다 = (list: readonly string[], origin: string | null | undefined): boolean =>
  list.includes(String(origin ?? ""));

/**
 * 제품이 스스로 쌓은 문서인가 — **새 문서 대장 · 중복 후보 · 지식 위생 점검**의 모집단에서 뺀다.
 * 이 문서들은 AI 지식 목록·문서 허브에도 안 뜬다. 즉 위생 점검이 「지우라」고 말해도
 * 담당자가 누를 자리가 없다 — 모집단에 넣으면 못 고치는 지적만 쌓인다.
 */
export function 제품이쌓은문서(origin: string | null | undefined): boolean {
  return 든다(제품자동_ORIGIN, origin);
}

/** 「새로 들어온 문서」로 안 세는가 — 사이드바 배지처럼 **반입만** 세는 자리. */
export function 반입문서아님(origin: string | null | undefined): boolean {
  return 든다(반입아님_ORIGIN, origin);
}

const 목록SQL = (list: readonly string[]): string => list.map((o) => `'${o}'`).join(",");

/**
 * SQL 조건 — 제품이 쌓은 문서를 **뺀다**(origin NULL = 고객 업로드는 남는다).
 * col에는 별칭을 붙여 넘긴다(예: "m.origin"). 값은 이 파일의 고정 문자열뿐이라 주입 여지가 없다.
 */
export function 제품이쌓은문서_제외SQL(col = "origin"): string {
  return `COALESCE(${col},'') NOT IN (${목록SQL(제품자동_ORIGIN)})`;
}

/** SQL 조건 — 「새로 들어온 문서」가 아닌 것을 뺀다(내장까지). */
export function 반입문서아님_제외SQL(col = "origin"): string {
  return `COALESCE(${col},'') NOT IN (${목록SQL(반입아님_ORIGIN)})`;
}
