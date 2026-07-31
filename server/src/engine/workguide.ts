// engine/workguide.ts — 업무별 "이렇게 하면 됩니다" 진행 가이드.
//
// ■ 이 파일이 '내 업무' 화면의 핵심이다 (2026-07-31 사용자 지시)
//   "사용자가 주요 업무를 해당 화면에서 **가이드 주는 대로 일하는 데 문제없게** 하는 게 핵심.
//    가이드를 받고 진행한다가 핵심."
//   즉 이 화면은 할 일 목록이 아니라 **일을 끝내게 해 주는 안내판**이다. 업무를 고르면
//   무엇을 어떤 순서로 하면 되는지가 나오고, 각 단계 버튼이 실제로 화면을 열거나 AI에게 묻는다.
//
// ■ 왜 LLM으로 단계를 만들지 않는가
//   이 저장소의 확립된 원칙이다 — **7B에 프롬프트를 더해 행동을 교정하지 말 것, 코드로 해결할 것.**
//   가이드는 "틀리면 담당자가 엉뚱한 일을 하는" 자리라 확률적이면 안 된다. 매번 같은 순서가
//   나와야 담당자가 믿고 따라간다. 그래서 **결정적 템플릿**으로 둔다.
//   (단계 안에서 AI에게 묻는 것은 얼마든지 한다 — 순서 자체를 AI가 정하지 않을 뿐이다.)
//
// ■ 단계는 세 가지뿐이다 — 담당자가 배울 것을 늘리지 않는다
//   open : 그 일을 하는 화면을 연다
//   ask  : 대화창에 정해진 질문을 넣어 AI에게 묻는다
//   note : 사람이 눈으로 확인하는 것(열 화면도 물을 것도 없는 단계)

export type StepKind = "open" | "ask" | "note";

export interface GuideStep {
  kind: StepKind;
  title: string; // 무엇을 하는 단계인지 — 명령형으로 짧게
  desc?: string; // 왜/어디서 하는지 한 줄
  page?: string; // kind=open일 때 열 화면
  question?: string; // kind=ask일 때 넣을 질문
}

export interface WorkGuide {
  key: string;
  label: string; // 이 가이드가 다루는 업무 이름
  steps: GuideStep[];
}

// ⚠ 화면 이름은 실재하는 것만 쓴다. 없는 화면을 열면 담당자는 "고장났다"고 느끼고
//   그 순간 가이드 전체를 안 믿는다. (실제로 assets.html 같은 없는 이름을 쓴 적이 있다.)
const GUIDES: WorkGuide[] = [
  {
    key: "product-maint",
    label: "보안제품 정기 점검",
    steps: [
      { kind: "open", title: "제품 상태 확인하기", desc: "보안제품 등록부에서 대상 제품의 상태와 마지막 점검일을 봅니다", page: "products.html" },
      { kind: "ask", title: "점검 항목 물어보기", desc: "무엇을 봐야 하는지 AI가 사내 자료로 알려 줍니다", question: "방화벽 월간 정기점검 절차를 알려줘" },
      { kind: "open", title: "원격 점검 실행하기", desc: "원격 정기점검 화면에서 실제로 점검합니다 — 결과가 자동 기록됩니다", page: "hardening.html" },
      { kind: "open", title: "점검 결과 보고서 만들기", desc: "이번 점검 결과를 격식 문서로 정리합니다", page: "report.html" },
    ],
  },
  {
    key: "vuln-remediate",
    label: "취약점 조치",
    steps: [
      { kind: "open", title: "취약점 내용 확인하기", desc: "어떤 자산의 무슨 취약점인지, 얼마나 급한지 봅니다", page: "vulnscan.html" },
      { kind: "ask", title: "조치 방법 물어보기", desc: "어떻게 막는지 AI가 표준·사내 자료로 알려 줍니다", question: "이 취약점 조치 방법을 알려줘" },
      { kind: "open", title: "조치 승인 올리기", desc: "실제 변경은 승인을 거칩니다 — 조치·승인 화면에서 올립니다", page: "approvals.html" },
      { kind: "open", title: "조치됐는지 확인하기", desc: "다시 점검해 정말 닫혔는지 확인합니다", page: "vulnscan.html" },
    ],
  },
  {
    key: "hardening-check",
    label: "원격 정기점검",
    steps: [
      { kind: "open", title: "점검 대상 확인하기", desc: "이번에 점검할 장비가 맞는지 봅니다", page: "hardening.html" },
      { kind: "ask", title: "점검 기준 물어보기", desc: "어떤 기준으로 보는지 확인합니다", question: "원격 정기점검은 어떤 기준으로 점검해?" },
      { kind: "open", title: "점검 실행하고 결과 보기", desc: "점검을 돌리고 통과·실패 항목을 확인합니다", page: "hardening.html" },
    ],
  },
  {
    key: "weekly-report",
    label: "주간 현황 보고서",
    steps: [
      { kind: "ask", title: "이번 주 상황 물어보기", desc: "무엇을 보고할지 AI가 먼저 정리해 줍니다", question: "이번 주 보안 현황을 요약해줘" },
      { kind: "open", title: "보고서 만들기", desc: "리포트 화면에서 격식 문서로 뽑습니다", page: "report.html" },
      { kind: "note", title: "받는 사람에게 보내기", desc: "만든 문서를 확인하고 전달합니다 — 파일로 내려받아 보내면 됩니다" },
    ],
  },
  {
    key: "handover",
    label: "담당자 인수인계",
    steps: [
      { kind: "open", title: "인수인계 문서 만들기", desc: "지금까지 한 일과 아는 것을 자동으로 모아 줍니다", page: "handover.html" },
      { kind: "ask", title: "빠진 것 물어보기", desc: "더 넣을 것이 없는지 AI에게 확인합니다", question: "인수인계에 빠뜨리기 쉬운 항목이 뭐야?" },
      { kind: "note", title: "확인하고 넘기기", desc: "내용을 읽어 보고 후임에게 전달합니다" },
    ],
  },
  {
    key: "compliance-check",
    label: "규정 확인",
    steps: [
      { kind: "ask", title: "규정에 맞는지 물어보기", desc: "하려는 일이 사내 규정·법령에 맞는지 AI가 근거와 함께 답합니다", question: "이 작업이 사내 규정에 맞는지 확인해줘" },
      { kind: "open", title: "컴플라이언스 현황 보기", desc: "지금 우리가 어느 항목을 지키고 있는지 봅니다", page: "compliance.html" },
    ],
  },
  {
    key: "rescan",
    label: "전체 자산 재스캔",
    steps: [
      { kind: "open", title: "자산 목록 확인하기", desc: "스캔할 자산이 빠짐없이 등록돼 있는지 봅니다", page: "inventory.html" },
      { kind: "open", title: "스캔 결과 올리기", desc: "스캐너 결과 파일을 넣으면 취약점으로 정리됩니다", page: "vulnscan.html" },
      { kind: "ask", title: "무엇부터 할지 물어보기", desc: "새로 나온 것 중 급한 순서를 AI가 정리해 줍니다", question: "이번 스캔에서 뭐부터 조치해야 해?" },
    ],
  },
  {
    key: "policy-backup",
    label: "보안제품 정책 백업 점검",
    steps: [
      { kind: "open", title: "제품별 백업 상태 보기", desc: "보안제품 등록부에서 설정 백업이 최신인지 확인합니다", page: "products.html" },
      { kind: "ask", title: "백업 기준 물어보기", desc: "얼마나 자주, 무엇을 백업해야 하는지 확인합니다", question: "보안장비 설정 백업은 어떤 주기로 해야 해?" },
    ],
  },
  {
    key: "log-review",
    label: "보안로그 검토",
    steps: [
      { kind: "open", title: "통합 관제에서 로그 보기", desc: "스캐너·보안로그·제품 리포트를 한자리에서 봅니다", page: "analysis.html" },
      { kind: "ask", title: "이상한 것 물어보기", desc: "눈에 띄는 징후가 있는지 AI가 짚어 줍니다", question: "오늘 로그에서 이상 징후가 있어?" },
    ],
  },
];

const BY_KEY = new Map(GUIDES.map((g) => [g.key, g]));

export function getGuide(key: string | undefined | null): WorkGuide | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function listGuides(): WorkGuide[] {
  return GUIDES;
}

/**
 * 업무 문장·참조로 가이드를 고른다.
 *
 * ⚠ 확신이 없으면 **아무것도 붙이지 않는다**(null). 엉뚱한 가이드를 붙이면 담당자가 엉뚱한
 *   순서로 일한다 — 가이드가 없어 스스로 하는 것보다 나쁘다. 애매하면 비우는 쪽이 정직하다.
 */
export function guessGuideKey(text: string, ref?: string): string | null {
  const t = String(text || "");
  const r = String(ref || "");

  // 참조(ref)가 있으면 그게 가장 확실한 신호다 — today 항목이 이 형태로 들어온다.
  if (r.startsWith("vulnhost:") || r.startsWith("vuln:")) return "vuln-remediate";
  if (r.startsWith("hardening:")) return "hardening-check";
  if (r.startsWith("maint:")) return "product-maint";

  // 문장은 **동사+대상**이 함께 잡힐 때만 인정한다. 낱말 하나로 고르면 오분류가 는다.
  //
  // ⚠ 어순을 하나만 가정하지 말 것(2026-07-31 시험이 잡음). 한국어는 "방화벽 월간 정기점검"과
  //   "정기점검할 방화벽"이 둘 다 자연스러운데, 예전 규칙은 (점검).*(방화벽) 순서만 봐서
  //   가장 흔한 문장을 놓쳤다. 두 어순을 함께 받거나, 뜻이 분명한 낱말은 단독으로 인정한다.
  if (/(방화벽|제품|장비|보안).*(정기\s*점검|월간\s*점검|유지보수)|(정기|월간|분기)\s*점검|보안제품.*(점검|관리)/.test(t)) return "product-maint";
  if (/취약점.*(조치|대응|처리|패치)|패치.*적용|(조치|대응).*취약점/.test(t)) return "vuln-remediate";
  if (/(원격|하드닝|CCE|취약\s*항목).*점검|점검.*(원격|하드닝)/.test(t)) return "hardening-check";
  if (/(주간|월간|분기).*(보고서|현황|리포트)|보고서.*(만들|작성|초안)|(현황|리포트).*(보고|정리)/.test(t)) return "weekly-report";
  if (/인수인계|인계.*(문서|자료)/.test(t)) return "handover";
  if (/(규정|법령|컴플라이언스|준수).*(확인|검토|맞는)/.test(t)) return "compliance-check";
  if (/(재스캔|전체.*스캔|자산.*스캔)/.test(t)) return "rescan";
  if (/(정책|설정).*백업/.test(t)) return "policy-backup";
  if (/(로그).*(검토|판독|분석|확인)/.test(t)) return "log-review";
  return null;
}
