// engine/analysis.ts — 콘텐츠 분석 기능 (스캔 결과 해석). 4.2절 구현체.
// StandardFinding[]을 LLM 프롬프트에 구조화해서 넣어 요약·우선순위·비전문가용 설명을 생성한다.

import { chat } from "./llm";
import type { StandardFinding } from "./bridge";

export interface FindingAnalysis {
  summary: string;
  prioritized: { index: number; severity: StandardFinding["severity"]; reason: string }[];
  plainExplanation: string;
}

const FEW_SHOT_EXAMPLE = `예시 입력:
[{"finding_type":"unsafe_deserialization","severity":"critical","evidence":"pickle.loads 사용","source_tool":"modelscan"}]

예시 출력(JSON만, 다른 텍스트 없이):
{"summary":"이 자산에서 발견된 1개 취약점 중 즉시 조치가 필요한 것은 1건입니다.","prioritized":[{"index":0,"severity":"critical","reason":"안전하지 않은 역직렬화는 임의 코드 실행으로 이어질 수 있어 최우선 조치가 필요합니다."}],"plainExplanation":"이 모델 파일을 불러올 때 위험한 코드가 함께 실행될 수 있는 취약점이 있습니다. 즉시 확인이 필요합니다."}`;

function buildPrompt(findings: StandardFinding[]): string {
  return [
    "너는 보안 스캔 결과를 해석하는 분석가야. 아래 finding 배열을 보고 비전문가 개발자도 이해할 수 있는 요약과 우선순위, 쉬운 설명을 JSON으로만 출력해.",
    FEW_SHOT_EXAMPLE,
    "실제 입력:",
    JSON.stringify(findings),
    "실제 출력(JSON만, 마크다운 코드블록 없이):",
  ].join("\n\n");
}

function parseAnalysis(raw: string, findingCount: number): FindingAnalysis {
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as FindingAnalysis;
    if (parsed.summary && parsed.prioritized) return parsed;
  } catch {
    // LLM이 JSON 포맷을 지키지 못한 경우 원문을 요약으로 그대로 반환
  }
  return {
    summary: raw || `이 자산에서 발견된 ${findingCount}개 취약점에 대한 분석에 실패했습니다.`,
    prioritized: [],
    plainExplanation: "",
  };
}

// CVSS/KEV/EPSS 스코어링 연동은 미결 상태 (dispatcher.ts의 priorityForAction과 동일한 TODO, 8단계 문서 참고).
// 지금은 finding의 severity 필드만 근거로 LLM이 우선순위를 재정렬한다.
export async function analyzeFindings(findings: StandardFinding[]): Promise<FindingAnalysis> {
  if (findings.length === 0) {
    return { summary: "발견된 취약점이 없습니다.", prioritized: [], plainExplanation: "" };
  }
  const raw = await chat({ agentId: "analysis", message: buildPrompt(findings) });
  return parseAnalysis(raw, findings.length);
}
