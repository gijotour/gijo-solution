// engine/gateway.ts — LLM 입력 단일 관문.
//
// 왜 필요한가: 가드레일을 호출 지점마다 개별로 심으면 반드시 빠지는 곳이 생긴다.
// 실제로 그랬다 — 같은 인젝션 페이로드로 실측(2026-07-19)했더니 /api/dispatch만 탐지하고
// /api/llm/chat(에이전트 직접 대화)과 /api/memory/query는 그대로 통과했다.
// guardInput() 호출이 dispatcher.ts 한 곳뿐이었기 때문이다.
//
// 그래서 "새 경로를 만들 때 가드레일을 기억해야 하는" 구조를 버리고, 사용자 입력이 LLM으로
// 들어가는 길목 자체를 이 함수 하나로 모은다. 앞으로 늘어날 검사(PII 마스킹·출력 필터·권한
// 확인 등)도 여기에 얹으면 모든 경로에 한 번에 적용된다.
//
// 이중 집계 주의: dispatch는 지시문을 검사한 뒤 같은 텍스트를 chat()에 넘긴다. 그런 내부
// 재진입은 이미 관문을 지난 것이므로 trusted로 표시해 다시 세지 않는다.

import { guardInput } from "./guardrail";
import type { AttackCategory } from "./redteam";

// cloud — 외부 클라우드 LLM으로 나가는 질문. **밖으로 나가는 경로일수록 관문을 지나야 한다**.
// 2026-07-30 전수 점검에서 이 입구만 관문 밖에 있었다(내부정보 유출 게이트 screenForCloud는
// 지나지만 인젝션 검사는 아니었다). gateway가 선언한 "모든 입구" 원칙을 실제로 지킨다.
export type GateSource = "chat" | "dispatch" | "memory-query" | "capability" | "cloud";

export interface GateResult {
  allowed: boolean; // false면 호출자는 실행을 멈추고 거절 사유를 돌려줘야 한다
  flagged: boolean;
  categories: AttackCategory[];
  /** 차단됐을 때 사용자에게 보여줄 문구. allowed=true면 undefined. */
  message?: string;
}

const PASS: GateResult = { allowed: true, flagged: false, categories: [] };

/**
 * 사용자 입력이 LLM으로 들어가기 전 반드시 지나야 하는 관문.
 * @param text   사용자가 준 원문
 * @param source 어느 입구인지(가드레일 로그에 남아 사후 추적에 쓰인다)
 */
export function gateUserInput(text: string, source: GateSource): GateResult {
  if (!text || !text.trim()) return PASS;

  const guard = guardInput(text, source);
  if (!guard.flagged) return PASS;

  return {
    allowed: guard.allowed,
    flagged: true,
    categories: guard.categories,
    message: guard.allowed
      ? undefined
      : `🛡 가드레일이 이 요청을 차단했습니다 — 프롬프트 인젝션 시도로 판단(${guard.categories.join(", ")}). ` +
        `정상 요청이면 표현을 바꿔 다시 시도하거나, 설정에서 가드레일 모드를 조정하세요.`,
  };
}
