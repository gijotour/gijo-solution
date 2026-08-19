// engine/scenarios.ts — 시나리오 실행(프롬프트북) (기능 가이드 ④, 2026-08-19).
//
// ■ 왜: 대화 시나리오 대장(GIJO_AS_대화시나리오_대장)이 문서로만 있으면 신규 담당자가 못 찾는다.
//   Microsoft Security Copilot의 promptbook 패턴 — 정해진 지시 사슬을 제품 안에서 골라 시작한다.
// ■ 정직 원칙: 단계 문장은 전부 시나리오 실측 보고서(2026-08-19, 177단계 완주)에서 ✓ 확인된
//   지시만 쓴다. 시나리오는 안내이지 자동 실행이 아니다 — 각 단계는 사람이 칩을 눌러 보낸다
//   (쓰기 단계는 어차피 결재판이 선다. SOAR 승인게이트 원칙).
// ■ 배관: 결정적 분기(dispatcher) → 목록/단계 답 + nextChips(다음 단계 칩). 상태 저장 없음 —
//   저장하면 화면·대화 두 곳의 진실이 갈린다. 사슬은 칩이 이어 준다.

export interface Scenario { id: string; name: string; area: string; steps: string[] }

export const SCENARIOS: Scenario[] = [
  { id: "scan-intake", name: "신규 스캔 결과 처리", area: "①발견·수집→②우선순위", steps: [
    "자산 현황 보여줘", "미조치 취약점 뭐 있어?", "오늘 뭐부터 할까?"] },
  { id: "morning", name: "아침 브리핑", area: "매일 시작", steps: [
    "오늘 브리핑", "지금 손댈 일 뭐야?", "오늘 할 일"] },
  { id: "assign", name: "취약점 담당자 배정", area: "②우선순위→③조치", steps: [
    "미조치 취약점 뭐 있어?", "이거 담당자 배정해줘", "이거 조치 절차 알려줘"] },
  { id: "fix-close", name: "조치 마감(시작→검증→확정)", area: "③조치→④검증", steps: [
    "이거 조치 시작할게", "이거 검증 실행해줘", "이거 조치완료 처리해줘"] },
  { id: "verify-status", name: "검증 현황 점검", area: "④검증", steps: [
    "검증 현황 보여줘", "하드닝 점검 스케줄 알려줘", "하드닝 점검해줘"] },
  { id: "exec-report", name: "경영 보고 준비", area: "⑤보고", steps: [
    "보안 KPI 현황 알려줘", "AI가 시간 얼마나 아꼈어?", "경영진 보고용으로 리포트 만들어줘"] },
  { id: "asset-hygiene", name: "자산 정리(결손 채우기)", area: "⓪자산", steps: [
    "자산 현황 어때?", "자산 정보 어디가 비어 있어?", "인터넷에 노출된 자산 있어?"] },
  { id: "threat-watch", name: "위협 정보 확인", area: "①발견·수집", steps: [
    "위협 인텔 새로 온 거 있어?", "공격 경로 보여줘", "오늘 뭐부터 할까?"] },
  { id: "law-check", name: "법령·행동 대조", area: "법령·판례", steps: [
    "개인정보 보호법 제34조 알려줘", "개인정보 유출 관련 판례 찾아줘", "이거 해도 돼? (하려는 일)"] },
  { id: "handover", name: "인수인계 점검", area: "업무 넘기기", steps: [
    "인수인계 어디까지 됐어?", "최근 반입 문서 보여줘", "작업 내역 뭐 있어?"] },
  { id: "ai-ops", name: "AI 운영 점검", area: "AI", steps: [
    "어댑터 현황 알려줘", "레드팀 지난 결과 알려줘", "지식 저장소 상태 알려줘"] },
  { id: "incident", name: "침해 의심 초동", area: "비상", steps: [
    "침해 의심될 때 대응 절차 알려줘", "오늘 로그에서 이상 징후 있어?", "처리 실패 내역 있어?"] },
];

const 목록_RE = /시나리오\s*(목록|리스트|뭐\s*있|보여|알려)/;
const 시작_RE = /시나리오\s*[:：]?\s*(.+?)\s*(시작|실행|해\s*줘|할래)?\s*$/;

export function isScenarioAsk(text: string): boolean {
  const t = String(text || "").trim();
  if (!/시나리오/.test(t)) return false;
  return 목록_RE.test(t) || SCENARIOS.some((s) => t.includes(s.name)) || 시작_RE.test(t);
}

export function scenarioAnswer(text: string): { output: string; nextChips?: string[] } {
  const t = String(text || "").trim();
  const picked = SCENARIOS.find((s) => t.includes(s.name));
  if (picked) {
    return {
      output: [
        `📖 시나리오 「${picked.name}」 (${picked.area}) — ${picked.steps.length}단계입니다.`,
        ...picked.steps.map((s, i) => `${i + 1}. "${s}"`),
        "",
        "아래 칩을 차례로 누르면 됩니다 — 각 단계는 사람이 보내고, 바꾸는 일은 결재판이 섭니다.",
      ].join("\n"),
      nextChips: picked.steps.slice(0, 3),
    };
  }
  // 목록 — 5단계 절차 순으로
  return {
    output: [
      `📖 업무 시나리오 ${SCENARIOS.length}개 — 이름을 말하면 단계를 안내합니다(예: "시나리오: 아침 브리핑").`,
      ...SCENARIOS.map((s) => `- **${s.name}** (${s.area}) — ${s.steps.length}단계`),
    ].join("\n"),
    nextChips: ["시나리오: 아침 브리핑", "시나리오: 신규 스캔 결과 처리", "시나리오: 조치 마감(시작→검증→확정)"],
  };
}
