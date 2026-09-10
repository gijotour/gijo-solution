// engine/analysis.ts — 콘텐츠 분석 기능 (스캔 결과 해석). 4.2절 구현체.
// StandardFinding[]을 LLM 프롬프트에 구조화해서 넣어 요약·우선순위·비전문가용 설명을 생성한다.

import { chat } from "./llm";
import type { StandardFinding } from "./bridge";

export interface FindingAnalysis {
  summary: string;
  prioritized: { index: number; severity: StandardFinding["severity"]; reason: string }[];
  plainExplanation: string;
  /**
   * 스키마 JSON을 **실제로 읽었나**(2026-09-10 검토관 상 — 부르는 쪽이 성공을 단정하고 있었다).
   *
   * ⚠ false면 summary는 **분석 결과가 아니다** — 모델이 준 원문이거나 「자동 분석에 실패했습니다」
   *   폴백 문구다. 부르는 쪽이 이 값을 안 보면 「N건을 분석했습니다」 바로 뒤에 「분석에 실패했습니다」가
   *   오는 자기모순 답이 나간다(폴백 문구를 정상 출력으로 취급 = 이 저장소 1원칙 위반).
   * ⚠ 판정을 **문구 대조로 흉내 내지 말 것** — 실패 문장은 여기 한 곳에만 있다.
   */
  ok: boolean;
}

const FEW_SHOT_EXAMPLE = `예시 입력:
[{"finding_type":"unsafe_deserialization","severity":"critical","evidence":"pickle.loads 사용","source_tool":"modelscan"}]

예시 출력(JSON만, 다른 텍스트 없이):
{"summary":"이 자산에서 발견된 1개 취약점 중 즉시 조치가 필요한 것은 1건입니다.","prioritized":[{"index":0,"severity":"critical","reason":"안전하지 않은 역직렬화는 임의 코드 실행으로 이어질 수 있어 최우선 조치가 필요합니다."}],"plainExplanation":"이 모델 파일을 불러올 때 위험한 코드가 함께 실행될 수 있는 취약점이 있습니다. 즉시 확인이 필요합니다."}`;

function buildPrompt(findings: StandardFinding[]): string {
  return [
    "너는 시니어 보안 분석가야. 아래 finding 배열을 검토해 보안담당자용 요약과 우선순위, 실무 설명을 작성해.",
    "지침: 심각도(critical>high>medium>low)에 더해 실제 악용 신호(KEV·EPSS)를 함께 고려해 우선순위를 정하고, 각 항목마다 왜 그 순위인지 조치 근거를 한 문장으로 제시해. 인사말·자기소개·군더더기 없이 사실만. summary는 '즉시 조치 N건, 순차 조치 M건' 식으로 핵심을 먼저 밝혀.",
    FEW_SHOT_EXAMPLE,
    "실제 입력:",
    JSON.stringify(findings),
    "출력은 아래 스키마의 JSON만(마크다운·설명 없이): {\"summary\":string,\"prioritized\":[{\"index\":number,\"severity\":string,\"reason\":string}],\"plainExplanation\":string}",
  ].join("\n\n");
}

// JSON 본문만 뽑아 파싱한다. 모델이 앞뒤에 문장을 붙이거나 코드블록으로 감싸도 견디도록
// 첫 { … 마지막 } 구간을 추출해 재시도한다.
function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```\s*$/, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* 다음 후보 시도 */
    }
  }
  return null;
}

export function parseAnalysis(raw: string, findingCount: number): FindingAnalysis {
  const parsed = extractJson(raw);
  if (parsed && typeof parsed.summary === "string" && parsed.summary.trim()) {
    // 일부 모델은 prioritized 대신 details/priorities 같은 키를 쓴다 — 배열이면 받아들인다.
    const list = [parsed.prioritized, parsed.details, parsed.priorities].find((v) => Array.isArray(v)) as
      | FindingAnalysis["prioritized"]
      | undefined;
    return {
      summary: parsed.summary.trim(),
      prioritized: list ?? [],
      plainExplanation: typeof parsed.plainExplanation === "string" ? parsed.plainExplanation : "",
      ok: true,
    };
  }
  // JSON 파싱 실패 시: 원문 JSON 덩어리를 그대로 노출하지 않고 사람이 읽을 문장만 남긴다.
  const fallback = raw.trim().startsWith("{") ? "" : raw.trim();
  return {
    summary: fallback || `발견된 ${findingCount}개 항목의 자동 분석에 실패했습니다. 원본 finding을 직접 확인하세요.`,
    prioritized: [],
    plainExplanation: "",
    ok: false, // ⚠ 원문 폴백도 false — 「형식대로 못 받았다」가 사실이고, 부르는 쪽이 그렇게 말해야 한다.
  };
}

// CVSS/KEV/EPSS 스코어링 연동은 미결 상태 (dispatcher.ts의 priorityForAction과 동일한 TODO, 8단계 문서 참고).
// 지금은 finding의 severity 필드만 근거로 LLM이 우선순위를 재정렬한다.
export async function analyzeFindings(findings: StandardFinding[]): Promise<FindingAnalysis> {
  if (findings.length === 0) {
    return { summary: "발견된 취약점이 없습니다.", prioritized: [], plainExplanation: "", ok: true };
  }
  const raw = await chat({ agentId: "analysis", message: buildPrompt(findings), trusted: true });
  return parseAnalysis(raw, findings.length);
}
