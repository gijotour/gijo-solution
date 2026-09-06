// engine/docorigin.ts — 「이 문서가 회사 지식 목록에 뜨는가」를 재는 **잣대 한 곳**(잎 모듈, import 0).
// 재료는 memory_documents의 두 칸이다 — origin(제품이 쌓았나)과 documentId 접두(개인 문서인가).
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

// ── 개인 문서(내 문서) ─────────────────────────────────────────────────────
// 갈리는 칸이 다르다 — origin이 아니라 **documentId 접두**다(personaldocs.ragDocumentId가
// "personal:<uuid>"를 만든다). 그래도 **같은 결정**이라 여기 함께 둔다: 「회사 지식 목록에
// 안 뜨는 문서는 회사 지식을 세는 자리의 모집단에서도 뺀다」. 결정이 하나면 잣대도 하나여야
// 한다 — 이 접두 문자열이 자리마다 손으로 적혀 있으면 승인 문답이 겪은 「세 곳만 고치고 초록」이
// 그대로 재발한다(2026-09-04, docdigest 한 곳에만 적혀 있던 것을 여기로 모았다).
const 개인문서_접두 = "personal:";

/**
 * 개인 문서(내 문서)인가 — **중복 후보 · 반입 대장 · 지식 위생 점검**의 모집단에서 뺀다.
 *
 * 왜 빼나(셋 다 성립해야 넣을 이유가 생긴다):
 *  ① AI 지식 화면·문서 허브 목록이 이미 뺀다(memory.html:783 · 요약 카드·배지와 같은 계보).
 *     목록에 없는 문서를 「중복이니 정리하세요」라고 지적하면 담당자가 누를 자리가 없다.
 *  ② 문서 이름이 「personal:<uuid>」다 — 사람이 못 읽는다(읽을 이름은 sourcePath에만 있다).
 *  ③ 이 창구들은 **보는 사람을 모른다**(도구 run·주기 점검에 viewer가 없다). 모집단에 두면
 *     남의 개인 메모가 아무에게나 간다 — 검색 격리(hiddenDocIds)를 우회하는 옆문이 된다.
 *
 * ⚠ 「개인 것이니 무조건 숨긴다」는 뜻이 **아니다.** 본인이 제 문서를 보고 정리하는 자리는
 *   「내 문서」 화면이고, 거기서는 제목으로 보인다. 여기서 빼는 것은 **회사 지식 창고를 세는
 *   자리**뿐이다 — 뜻이 다른 자리(개인 문서 목록·격리 판정)는 이 술어를 쓰지 않는다.
 */
export function 개인문서(documentId: string | null | undefined): boolean {
  return String(documentId ?? "").startsWith(개인문서_접두);
}

/**
 * SQL 조건 — 개인 문서를 뺀다. col에는 별칭을 붙여 넘긴다(예: "m.documentId").
 * 접두에 LIKE 와일드카드(%·_)가 없어 이스케이프가 필요 없다 — 이 파일의 고정 문자열뿐이다.
 */
export function 개인문서_제외SQL(col = "documentId"): string {
  return `${col} NOT LIKE '${개인문서_접두}%'`;
}

// ── 승인 문답(사내 문답) ───────────────────────────────────────────────────
// 갈리는 칸이 **둘**이다 — origin(approved-qa)과 documentId 접두("승인문답:<로그 id>").
// 검색 자르기(memory.문서를섞어자르기)는 LanceDB 조각만 손에 쥐는데 그 스키마에는 origin 칸이
// 없다(등급 차단이 documentId 제외 목록으로 도는 것과 같은 이유). 그래서 **접두로 가른다** —
// SQLite를 다시 뜨지 않는다(uploadedDocIds가 이미 매 질의 3,858개를 뜨고 있어, 한 벌 더 뜨면
// 같은 사실을 두 곳에서 세게 된다).
//
// 왜 여기로 옮겼나(2026-09-07): 접두 문자열이 learnmemory.ts에만 있었는데, 검색 층(memory.ts)이
// learnmemory를 물지 않는다(정적 화살이 없다 — 의존 수리 원칙). 잣대를 memory.ts에 새로 적으면
// 2026-09-04에 다섯 벌을 여기로 모은 그 통합을 되돌리는 것이라, 접두를 이 잎으로 내리고
// learnmemory는 여기서 **재수출**한다(APPROVED_QA_DOC_PREFIX 소비자 네 곳은 한 글자도 안 바뀐다).
export const 승인문답_접두 = "승인문답:";

/**
 * 승인 문답 문서인가 — **검색 자리 배분**(문서를섞어자르기)이 이 가족을 한 몫으로 묶는다.
 *
 * 왜 묶나(2026-09-07 라이브 사고): 운영 코퍼스는 memory_documents 3,921건 중 3,778건(96.4%)이
 * 승인 문답이고 **문서당 조각이 1.006개**다(내장 권위 문서는 63건에 1,424조각 — 문서당 22.6).
 * 자리 배분이 documentId만 세니 승인 문답은 **문서마다 제 몫을 하나씩** 챙기고, 권위 문서는
 * 관련 조각이 아무리 많아도 문서당 3칸으로 묶인다. 그래서 top-4가 [지식 1 + 뜻이 겹치는 사내
 * 문답 3]이 되어 다수결이 넘어갔다 — 안내서의 **「예시: 연 2회」**가 답에서 **「연 2회 이상
 * 실시해야 합니다」**가 됐다.
 *
 * ⚠ 침해사고 사례(incident-case)는 **넣지 않는다** — 20문서·60조각뿐이고, 「[사례] 제목」을 붙여
 *   사람에게 내보내기로 한 제품 결정이 따로 있다(incidentcases ①). 조이면 그 결정과 충돌한다.
 */
export function 승인문답문서(documentId: string | null | undefined): boolean {
  return String(documentId ?? "").startsWith(승인문답_접두);
}
