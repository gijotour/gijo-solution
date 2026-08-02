// tools/menu-scenarios.mjs — 메뉴별 챗봇 명령 시나리오 카탈로그.
//
// 용도 2가지: (1) 사용자·매뉴얼용 "메뉴별로 이런 명령을 할 수 있다" 카탈로그,
//            (2) 디스패치 라우팅 정확도 측정(menu-dispatch-accuracy.mjs)의 입력.
// 각 시나리오는 같은 의도의 여러 변형(commands)을 담아 "비슷한 명령"이 같은 도구/액션으로
// 라우팅되는지 본다. expect.tool = 도구 이름 후보, expect.action = 상위 액션(scan/analyze/report/chat).
// 둘 중 하나라도 맞으면 통과. cross 도구(search·briefing·run_hardening_scan 등)는 전 메뉴 공용.

export const CATALOG = [
  { screen: "vulnscan.html", menu: "취약점", scenarios: [
    { desc: "취약점 현황 조회", expect: { tool: ["finding_status"], action: ["analyze"] },
      commands: ["지금 열린 취약점 뭐 있어?", "취약점 현황 정리해서 보여줘"] },
    { desc: "취약점 승인/반려", expect: { tool: ["review_finding", "update_finding_status"] },
      commands: ["웹서버-01의 critical 취약점 승인 처리해줘", "이건 오탐이야 반려해줘"] },
    { desc: "담당자/기한 배정", expect: { tool: ["assign_finding", "assign_owner"] },
      commands: ["가장 급한 취약점 담당자랑 기한 배정해줘"] },
  ]},
  { screen: "inventory.html", menu: "자산 목록", scenarios: [
    { desc: "자산 목록", expect: { tool: ["list_assets"] },
      commands: ["등록된 자산 목록 보여줘", "자산 몇 개나 돼?"] },
    { desc: "커버리지 결손", expect: { tool: ["asset_coverage"] },
      commands: ["담당부서 없는 자산 찾아줘", "관리 결손 있는 자산 정리해줘"] },
    { desc: "자산 등록", expect: { tool: ["register_asset"] },
      commands: ["새 자산 등록해줘. 이름은 사내챗봇, 경로는 models/chat.gguf"] },
  ]},
  { screen: "sbom.html", menu: "AI-BOM 구성", scenarios: [
    { desc: "AI-BOM 현황", expect: { tool: ["aibom_status"] },
      commands: ["AI-BOM 현황 보여줘", "자산별 구성요소 정리해줘"] },
    { desc: "SBOM 생성", expect: { tool: ["generate_sbom"] },
      commands: ["웹서버-01 SBOM 만들어줘"] },
  ]},
  { screen: "approvals.html", menu: "조치·승인", scenarios: [
    { desc: "미검토 항목", expect: { tool: ["finding_status"] },
      commands: ["아직 검토 안 한 항목 보여줘"] },
    { desc: "승인 처리", expect: { tool: ["review_finding", "update_finding_status"] },
      commands: ["이 항목 승인해줘"] },
  ]},
  { screen: "products.html", menu: "보안제품", scenarios: [
    { desc: "제품 현황", expect: { tool: ["product_status"] },
      commands: ["등록된 보안제품 보여줘", "우리 방화벽 뭐 쓰고 있지?"] },
    { desc: "제품 등록", expect: { tool: ["register_product"] },
      commands: ["보안제품 등록해줘. 이름 팔로알토, 종류 방화벽"] },
  ]},
  { screen: "maintenance.html", menu: "정기 점검", scenarios: [
    { desc: "점검 일정 현황", expect: { tool: ["maintenance_status"] },
      commands: ["정기 점검 일정 보여줘", "이번 달 점검 뭐 있어?"] },
    { desc: "점검 예약", expect: { tool: ["schedule_maintenance"] },
      commands: ["다음주 월요일에 방화벽 정기점검 잡아줘"] },
  ]},
  { screen: "compliance.html", menu: "컴플라이언스", scenarios: [
    { desc: "대응 현황", expect: { tool: ["compliance_status"] },
      commands: ["KISA 위협 대응 현황 보여줘", "컴플라이언스 정리해줘"] },
    { desc: "대응 상태 갱신", expect: { tool: ["set_compliance_status"] },
      commands: ["M06 위협 대응완료로 표시해줘"] },
  ]},
  { screen: "report.html", menu: "리포트", scenarios: [
    { desc: "리포트 작성", expect: { action: ["report"] },
      commands: ["주간 보안 리포트 작성해줘", "임원 보고서 뽑아줘"] },
  ]},
  { screen: "memory.html", menu: "기억·학습", scenarios: [
    { desc: "지식 현황", expect: { tool: ["knowledge_status"] },
      commands: ["장기기억에 문서 얼마나 쌓였어?"] },
  ]},
  { screen: "redteam.html", menu: "AI 견고성", scenarios: [
    { desc: "레드팀 점검", expect: { tool: ["run_redteam"] },
      commands: ["사내챗봇 레드팀 점검 돌려줘", "이 AI 인젝션 안전한지 봐줘"] },
  ]},
  { screen: "threat.html", menu: "위협 인텔리전스", scenarios: [
    { desc: "위협×자산", expect: { tool: ["threats"] },
      commands: ["최근 위협 중 우리 자산에 영향 있는 거 있어?"] },
  ]},
  // ── cross 도구(전 메뉴 공용) — 대시보드에서 ──
  { screen: "dashboard.html", menu: "대시보드(공용)", scenarios: [
    { desc: "오늘 브리핑", expect: { tool: ["briefing", "today"] },
      commands: ["오늘 브리핑 해줘", "지금 상황 요약해줘"] },
    { desc: "하드닝 점검", expect: { tool: ["run_hardening_scan"] },
      commands: ["방화벽 하드닝 점검해줘", "보안장비 설정 점검 돌려줘"] },
    { desc: "통합 검색", expect: { tool: ["search"] },
      commands: ["log4j 관련된 거 다 찾아줘"] },
  ]},
];

// 카탈로그를 사람이 읽는 마크다운 표로.
export function toMarkdown() {
  const lines = ["# GIJO AS 챗봇 명령 시나리오 (메뉴별)\n",
    "> 각 메뉴에서 챗봇(지휘 콘솔)에 이렇게 지시하면 해당 기능이 실행됩니다. 표현은 예시이며, **비슷한 말로 해도** 의미가 같으면 같은 기능으로 처리됩니다(LLM 의미 매칭). 화면 맥락도 함께 쓰이므로, 그 메뉴를 보고 있으면 동사가 없어도(\"정리해줘\") 그 메뉴 기준으로 해석됩니다.\n"];
  for (const m of CATALOG) {
    lines.push(`\n## ${m.menu}  \`(${m.screen})\``);
    for (const s of m.scenarios) {
      const ex = [...(s.expect.tool ?? []), ...(s.expect.action ?? []).map((a) => a + "(액션)")].join(" / ");
      lines.push(`- **${s.desc}** → \`${ex}\``);
      for (const c of s.commands) lines.push(`    - "${c}"`);
    }
  }
  lines.push("\n> 새 명령/기능이 늘면 `server/tools/menu-scenarios.mjs`에 추가하고 정확도를 다시 측정하세요(`menu-dispatch-accuracy.mjs`).");
  return lines.join("\n");
}

// 직접 실행하면 마크다운을 출력한다: node tools/menu-scenarios.mjs
if (import.meta.url === `file://${process.argv[1]}`) console.log(toMarkdown());
