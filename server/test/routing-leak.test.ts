// 조회 문구가 **쓰기 결재판으로 새지 않는지** — 2026-08-05 검토관 지적(중간).
//
// 배경: 쓰기 규칙을 조회보다 **먼저** 두는 것은 옳다("번들 넣어줘"가 조회로 새면 안 되니까).
// 그런데 반대 방향 누수를 안 막았다 — 쓰기 정규식이 넓어 **묻기만 한 말**이 결재판을 띄웠다:
//   · "번들 언제 적용됐어?"  → `번들`+4글자+`적용` → 반입(admin 쓰기) 결재판
//   · "생각 모드 켜져 있어?"  → `켜`가 걸려 지정(쓰기) 결재판
// 즉시 파괴는 아니지만(결재판이 앞을 막는다) **오승인의 시작점**이고,
// 담당자가 "현황을 물었는데 왜 실행 확인이 뜨지?"를 겪는다 — 안내한 말과도 어긋난다.
import { describe, it, expect } from "vitest";
import { forcedToolFor } from "../src/engine/agentloop";

describe("조회 문구는 쓰기 결재판으로 새지 않는다", () => {
  it("번들 조회형은 상태로 간다 (반입 아님)", () => {
    for (const q of [
      "번들 언제 적용됐어?",
      "지식 번들 언제 갱신됐나?",
      "번들 업데이트 있어?",
      "번들 적용 언제 됐는지 알려줘",
      "지식 번들 최신인가요?",
    ]) {
      const t = forcedToolFor(q, { role: "admin" })?.tool;
      expect(t, `"${q}" → ${t}`).not.toBe("knowledge_bundle_import");
    }
  });

  it("생각 모드 조회형은 지정(쓰기)으로 가지 않는다", () => {
    for (const q of [
      "이 모델 생각 모드 켜져 있어?",
      "생각 모드 켜져 있나요?",
      "이 모델 추론 모드 꺼져 있어?",
      "생각 모드 켜졌는지 알려줘",
    ]) {
      const t = forcedToolFor(q, { role: "admin" })?.tool;
      expect(t, `"${q}" → ${t}`).not.toBe("set_model_thinking");
    }
  });

  // 막기만 하고 답을 못 주면 반쪽이다 — 비켜선 조회는 **제 상태 도구가 받아야** 한다.
  it("비켜선 조회는 상태 도구가 받는다 (막다른 길이 아니다)", () => {
    expect(forcedToolFor("번들 언제 적용됐어?", { role: "admin" })?.tool).toBe("knowledge_bundle_status");
    expect(forcedToolFor("지식 번들 최신인가요?", { role: "admin" })?.tool).toBe("knowledge_bundle_status");
    expect(forcedToolFor("이 모델 생각 모드 켜져 있어?", { role: "admin" })?.tool).toBe("model_fit_status");
  });

  it("★ 진짜 쓰기 지시는 그대로 결재판으로 간다 (과잉 교정 방지)", () => {
    expect(forcedToolFor("지식 번들 넣어줘", { role: "admin" })?.tool).toBe("knowledge_bundle_import");
    expect(forcedToolFor("새 번들 반입해줘", { role: "admin" })?.tool).toBe("knowledge_bundle_import");
    expect(forcedToolFor("번들 적용해줘", { role: "admin" })?.tool).toBe("knowledge_bundle_import");
    expect(forcedToolFor("이 모델 생각 모드 꺼줘", { role: "admin" })?.tool).toBe("set_model_thinking");
    expect(forcedToolFor("qwen3 모델 thinking 켜줘", { role: "admin" })?.tool).toBe("set_model_thinking");
  });
});
