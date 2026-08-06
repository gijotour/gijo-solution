// engine/agenttools.ts — 에이전트 루프가 호출할 수 있는 도구 레지스트리.
//
// ⚠ 설계 축: **화면 메뉴가 아니라 사용자 의도** (2026-07-17 확정).
// 처음엔 메뉴를 1:1로 미러링했는데(list_assets/get_asset/get_aibom = 자산 메뉴), 그러면 LLM이
// "이 질문은 어느 메뉴인가"를 먼저 풀어야 하고 메뉴를 가로지르는 질문("오늘 뭐부터?", "Log4Shell
// 관련된 거 다 찾아줘")에 도구를 3~4개 조합해야 해서 실패율이 올라간다. 그래서 도구를 의도 단위로
// 잡고, 메뉴 경계를 서버가 가로지른다:
//   찾기(search) · 설명(explain) · 상세(get_asset) · 목록(list_assets) · 오늘(today) · 등록(register_asset)
// 온톨로지(지식 그래프)가 그 접착제다 — 위협→완화통제→보안제품→자산 관계가 이미 메뉴를 가로지른다.
//
// 원칙(QA 보고서 2026-07-17): 판단·검증·실행은 여기(규칙 코드), LLM은 도구 선택·인자 추출만.
// 도구 결과는 LLM에 재주입되므로 장황한 JSON 대신 짧은 한국어 요약 텍스트를 돌려준다.
//
// 쓰기 도구(write:true)는 루프가 바로 실행하지 않는다 — 값을 결재판(PendingApproval)으로
// 만들어 돌려주고, 사람이 승인한 뒤 /api/agent/approve로만 실행된다(시안 B, 2026-07-17 확정).

//
// [2026-08-06 소스 정리 3단계] 3,956줄 한 파일을 agenttools/ 둘로 나눴다 — 겉문은 그대로:
// 임포트 경로 "./agenttools"와 export 표면이 안 바뀌었다(11개 임포터·시험 무수정).
// ⚠ 소스 감시 시험은 이 파일이 아니라 test/util/toolsrc.ts(3파일 합본)를 읽어야 한다.
export * from "./agenttools/handlers";
export * from "./agenttools/registry";
