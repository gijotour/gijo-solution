import { describe, it, expect } from "vitest";
import { parseAnalysis } from "../src/engine/analysis";

// parseAnalysis는 합성 모델이 스키마를 조금 어기거나 앞뒤에 문장·코드블록을 붙여도 견뎌야 한다
// (실사고: 보안모델이 prioritized 대신 details 키 + 약한 요약을 내보내 원본 JSON이 화면에 노출됨).
describe("parseAnalysis (분석 출력 강건 파싱)", () => {
  it("parses clean JSON", () => {
    const r = parseAnalysis('{"summary":"즉시 조치 1건.","prioritized":[{"index":0,"severity":"critical","reason":"RCE"}],"plainExplanation":"쉬운 설명"}', 1);
    expect(r.summary).toBe("즉시 조치 1건.");
    expect(r.prioritized).toHaveLength(1);
    expect(r.plainExplanation).toBe("쉬운 설명");
  });

  it("strips markdown fences and surrounding prose", () => {
    const raw = "분석 결과입니다:\n```json\n{\"summary\":\"조치 불필요.\",\"prioritized\":[]}\n```\n이상입니다.";
    expect(parseAnalysis(raw, 2).summary).toBe("조치 불필요.");
  });

  it("accepts alternate array keys (details/priorities) as prioritized", () => {
    const r = parseAnalysis('{"summary":"2건 검토.","details":[{"index":0,"severity":"high","reason":"x"},{"index":1,"severity":"low","reason":"y"}]}', 2);
    expect(r.summary).toBe("2건 검토.");
    expect(r.prioritized).toHaveLength(2);
  });

  it("does NOT surface a raw JSON blob as the summary when parsing fails", () => {
    // summary 키가 없는 깨진 JSON — 원문 덩어리를 그대로 요약에 노출하면 안 된다.
    const r = parseAnalysis('{"result":"모델 스캔 작업에 오류","details":[]}', 4);
    expect(r.summary).not.toContain("{");
    expect(r.summary).toContain("자동 분석에 실패");
  });

  it("keeps a plain-text fallback (not JSON) as the summary", () => {
    const r = parseAnalysis("발견된 취약점 4건 모두 저위험입니다.", 4);
    expect(r.summary).toBe("발견된 취약점 4건 모두 저위험입니다.");
  });
});
