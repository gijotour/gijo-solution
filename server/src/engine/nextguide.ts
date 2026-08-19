// engine/nextguide.ts — 답 끝에 자동으로 붙는 「다음 작업」 제안 칩 (QA ④, 2026-08-19).
//
// ■ 왜: 사장님 QA 실측 — 「스캔된 파일 리스트 보여줘」·「오늘 해야할일」 답이 목록에서 끝나고,
//   다음 프로세스는 따로 물어야 나왔다(「다음 작업 가이드가 머야?」). 외부사례(Microsoft
//   Security Copilot dynamic prompt suggestions)처럼 답마다 후속 지시를 자동으로 붙인다.
// ■ 정직 원칙: 칩은 LLM이 만들지 않는다. 아래 표의 문장은 전부 **시나리오 실측 보고서
//   (GIJO_AS_시나리오_실측보고서_2026-08-19.md)에서 ✓로 완주가 확인된 지시**에서 골랐다 —
//   눌렀는데 안 받아주는 칩은 막다른 길보다 나쁘다(없는 기능을 파는 것).
// ■ 계약: DispatchResult.nextChips → 클라 chatparts.js nextChips()가 그린다(지휘소·분리창 공용).
//   경로 식별은 dispatcher 공통 출구에서 — 도구 답은 마지막 도구 이름, 결정적 분기 답은
//   부품(picklist.kind·dataCard.title)으로 간접 식별한다(분기 32곳을 일일이 안 고치는 대신).

const 표: Record<string, string[]> = {
  // ── 결정적 분기(부품으로 식별) ──
  "분기:내업무": ["오늘 뭐부터 할까?", "자주 하는 일 뭐 있어?", "지금 손댈 일 뭐야?"],
  "분기:우선순위": ["오늘 뭐부터 할까?", "긴급한 취약점 알려줘", "자산 현황 어때?"],
  "분기:검증현황": ["하드닝 점검 스케줄 알려줘", "미조치 취약점 뭐 있어?", "오늘 브리핑"],
  "분기:자산현황": ["미조치 취약점 뭐 있어?", "SBOM 없는 자산 알려줘", "인터넷에 노출된 자산 있어?"],
  // ── 도구(마지막 도구 이름으로 식별) — 실측 ✓ 문장만 ──
  today: ["긴급한 취약점 알려줘", "오늘 브리핑", "미조치 취약점 뭐 있어?"],
  briefing: ["오늘 뭐부터 할까?", "지금 손댈 일 뭐야?", "공격 경로 보여줘"],
  finding_status: ["오늘 뭐부터 할까?", "반려 사유 주로 뭐였어?"],
  urgent_todo: ["오늘 브리핑", "미조치 취약점 뭐 있어?"],
  list_assets: ["자산 현황 어때?", "자산 정보 어디가 비어 있어?", "인터넷에 노출된 자산 있어?"],
  get_asset: ["미조치 취약점 뭐 있어?", "이 자산 SBOM 생성해줘"],
  asset_coverage: ["자산 현황 어때?", "SBOM 없는 자산 알려줘"],
  exposed_assets: ["오늘 뭐부터 할까?", "공격 경로 보여줘"],
  sbom_coverage: ["SBOM 없는 자산 알려줘", "자산 현황 어때?"],
  assign_finding: ["미조치 취약점 뭐 있어?", "오늘 뭐부터 할까?"],
  update_finding_status: ["재스캔 상태 알려줘", "미조치 취약점 뭐 있어?"],
  bulk_update: ["미조치 취약점 뭐 있어?", "오늘 뭐부터 할까?"],
  scan_status: ["미조치 취약점 뭐 있어?", "오늘 브리핑"],
  run_hardening_scan: ["검증 현황 보여줘", "하드닝 점검 스케줄 알려줘"],
  hardening_schedule_list: ["검증 현황 보여줘", "하드닝 점검해줘"],
  product_status: ["점검 일정 현황 알려줘", "보안제품 등록해줘"],
  maintenance_status: ["보안제품 현황 알려줘", "이번 주 보고서 썼어?"],
  report_list: ["경영진 보고용으로 리포트 만들어줘", "다음 정기 리포트 언제야?"],
  report_activity: ["보안 KPI 현황 알려줘", "경영진 보고용으로 리포트 만들어줘"],
  kpi_status: ["뭐가 점수를 깎아?", "AI가 시간 얼마나 아꼈어?"],
  compliance_status: ["보안 KPI 현황 알려줘", "경영진 보고용으로 리포트 만들어줘"],
  workflow_status: ["오늘 뭐부터 할까?", "지금 손댈 일 뭐야?"],
  analysis_status: ["새로 들어온 취약점 몇 건이야?", "공격 경로 보여줘"],
  threats: ["오늘 뭐부터 할까?", "공격 경로 보여줘"],
  law_lookup: ["개인정보 유출 관련 판례 찾아줘", "이거 해도 돼? (하려는 일)"],
  knowledge_status: ["최근 반입 문서 보여줘", "중복 문서 있어?"],
  recent_documents: ["지식 저장소 상태 알려줘", "중복 문서 있어?"],
  handover_status: ["업무 넘기기 어디서 해?", "작업 내역 뭐 있어?"],
  work_session_status: ["오늘 무슨 일 있었어?", "내 업무 뭐부터 하면 돼?"],
  audit_search: ["처리 실패 내역 있어?", "반려 사유 주로 뭐였어?"],
  system_log_status: ["작업 기록 보여줘", "자가 진단 돌려줘"],
  system_health: ["처리 실패 내역 있어?", "오늘 브리핑"],
  register_asset: ["자산 현황 어때?", "이 자산 SBOM 생성해줘"],
  complete_task: ["오늘 할 일", "오늘 뭐부터 할까?"],
  add_task: ["오늘 할 일", "내 업무 뭐부터 하면 돼?"],
};

/** 경로 이름(도구 이름 또는 "분기:○○")으로 다음 칩을 찾는다 — 없으면 빈 배열(안 붙임). */
export function nextChipsFor(route: string): string[] {
  return 표[route] ?? [];
}

/** 응답 부품으로 결정적 분기를 간접 식별한다 — 분기 32곳을 안 고치는 대신 여기 한 곳. */
export function routeFromParts(r: {
  picklist?: { kind: string } | null;
  dataCard?: { title: string } | null;
  toolCalls?: { tool: string }[];
}): string | null {
  const tools = r.toolCalls ?? [];
  if (tools.length) return tools[tools.length - 1].tool;
  if (r.picklist?.kind === "task") return "분기:내업무";
  if (r.picklist?.kind === "finding") return "분기:우선순위";
  const t = r.dataCard?.title ?? "";
  if (t.startsWith("검증")) return "분기:검증현황";
  if (t.startsWith("자산")) return "분기:자산현황";
  return null;
}
