// engine/screencontext.ts — 지시가 들어온 화면을 라우팅 신호로 쓴다.
//
// 왜 필요한가: 지금까지 라우팅 근거는 지시문 텍스트뿐이었다. 그래서 "정리해줘"·"이거 처리해줘"처럼
// 동사가 없는 지시는 어느 액션인지 알 수 없어 전부 일반 대화(chat)로 떨어졌다. 하지만 담당자는
// 늘 **어떤 화면을 보면서** 지시한다 — 취약점 화면에서 "정리해줘"는 취약점 우선순위 정리다.
// 화면은 사용자가 이미 표현한 맥락인데 지금까지 버리고 있었다.
//
// 이 표는 메뉴 전수 조사(tools/menu-audit.mjs, Notion "메뉴 기능 정의")에서 나온 것이다.
// 화면이 늘면 여기에 한 줄 추가한다 — 라우팅 로직 자체는 건드리지 않는다.
//
// 주의: 화면은 **힌트지 명령이 아니다.** 지시문에 명확한 동사가 있으면 그쪽이 이긴다.
// 취약점 화면에서 "리포트 뽑아줘"라고 하면 리포트가 맞다.

import type { RoutedIntent } from "./intent";

export interface ScreenContext {
  /** 화면 이름 — 프롬프트와 로그에 쓴다 */
  label: string;
  /** 이 화면의 업무 영역. LLM 라우팅 프롬프트에 힌트로 실린다 */
  domain: string;
  /**
   * 지시문에 동사가 없을 때 가정할 액션. undefined면 추측하지 않는다
   * (설정·로그처럼 오케스트레이션 대상이 아닌 화면).
   */
  defaultAction?: RoutedIntent["action"];
}

// 키는 페이지 파일명. 클라이언트가 보내는 값과 같아야 한다.
const SCREENS: Record<string, ScreenContext> = {
  "dashboard.html": { label: "대시보드", domain: "전체 현황 — 어느 영역이든 지시가 올 수 있다" },
  "kpi.html": { label: "보안 KPI", domain: "보안 지표 추이" },
  "analysis.html": { label: "통합 관제", domain: "스캐너·로그·운영리포트 통합 분석", defaultAction: "analyze" },
  "sessions.html": { label: "작업 세션", domain: "진행 중인 작업 대화" },

  "inventory.html": { label: "자산 목록", domain: "AI·IT 자산 인벤토리", defaultAction: "scan" },
  "sbom.html": { label: "AI-BOM 구성", domain: "AI-BOM/SBOM 구성요소·견고성" },
  "vulnscan.html": { label: "취약점", domain: "취약점 스캔 결과·조치 우선순위", defaultAction: "analyze" },
  "approvals.html": { label: "조치·승인", domain: "탐지 항목 승인·반려" },

  "threat.html": { label: "위협 인텔리전스", domain: "외부 위협 인텔·CTI 피드" },
  "products.html": { label: "보안제품", domain: "보안제품 등록부·매뉴얼" },
  "opsguide.html": { label: "유지보수", domain: "정기 점검 일정·이력" },

  "report.html": { label: "내부 리포트", domain: "보고서 작성·배포", defaultAction: "report" },
  "compliance.html": { label: "컴플라이언스", domain: "규제·통제 항목 대응 현황" },

  "agent.html": { label: "에이전트 AI", domain: "에이전트 설정·직접 지시" },
  "memory.html": { label: "기억·학습", domain: "장기기억(RAG) 문서" },
  "ontology.html": { label: "온톨로지", domain: "지식 그래프·표준 매핑" },
  "redteam.html": { label: "AI 견고성", domain: "레드팀·가드레일" },

  // 오케스트레이션 대상이 아닌 화면들 — defaultAction 없음(추측하지 않는다).
  "merge.html": { label: "LLM 합성", domain: "모델 병합" },
  "llmguide.html": { label: "LLM 가이드", domain: "모델 안내" },
  "learnloop.html": { label: "학습 루프", domain: "파인튜닝 파이프라인" },
  "docenrich.html": { label: "문서 보강", domain: "문서 보강 인입" },
  "logs.html": { label: "로그", domain: "시스템 로그" },
  "settings.html": { label: "설정", domain: "서버·계정·엔진 설정" },
  "billing.html": { label: "사용량·요금", domain: "사용량 집계" },
};

export function getScreenContext(screen?: string): ScreenContext | undefined {
  if (!screen) return undefined;
  // 클라이언트가 경로째 보내도("pages/vulnscan.html", "/vulnscan.html") 받아들인다.
  const key = screen.split(/[\\/]/).pop() ?? screen;
  return SCREENS[key];
}

// 화면 설명을 LLM 프롬프트에 힌트로 넣어보는 방식은 폐기했다 — 7B 분류기가 같은 입력에 매번
// 다른 답을 냈고, 힌트의 존재 자체가 "뭔가 실행하라"는 신호로 읽혀 지시 대상이 아닌 화면에서도
// 액션을 만들어냈다. 지금은 intent.ts가 분류 결과를 받은 뒤 결정적으로 보정한다(그 주석 참고).

/** 지시문에서 액션을 못 찾았을 때만 쓰는 화면 기반 추정. 없으면 undefined. */
export function fallbackActionForScreen(screen?: string): RoutedIntent["action"] | undefined {
  return getScreenContext(screen)?.defaultAction;
}
