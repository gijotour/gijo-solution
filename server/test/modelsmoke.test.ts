// BYOM 자동 적응 2단계 — 스모크 판정(결정적 규칙)·대화창 라우팅·도구 계약.
//
// 스모크 판정은 LLM이 아니라 글자 규칙이다(LLM이 LLM을 채점하면 회차마다 흔들린다 — 게이트 원칙).
// 여기서는 그 규칙 자체가 정직한지: 빈 답·생각 누출·영어 답·지시 무시·거절 없음을 제대로 가르는지 잰다.
import { describe, it, expect } from "vitest";
import { SMOKE_PROBES } from "../src/engine/modelsmoke";
import { forcedToolFor } from "../src/engine/agentloop";
import { findAgentTool } from "../src/engine/agenttools";
import { setThinkingOverride, thinkingOverride } from "../src/engine/modelquirks";

const judge = (id: string, text: string) => {
  const p = SMOKE_PROBES.find((x) => x.id === id)!;
  return p.judge(text);
};

describe("스모크 판정 — 결정적 규칙이 정직하게 가른다", () => {
  it("빈칸 아님: 빈 답·생각 누출을 잡는다", () => {
    expect(judge("빈칸 아님", "").ok).toBe(false);
    expect(judge("빈칸 아님", "  ").ok).toBe(false);
    expect(judge("빈칸 아님", "<think>생각만</think>").ok).toBe(false); // 누출
    expect(judge("빈칸 아님", "우선 취약점 조치부터 시작하세요.").ok).toBe(true);
  });
  it("한국어: 영어만 하는 모델을 잡는다 (실측: merged-lily raw가 영어로 샜다)", () => {
    expect(judge("한국어", "SQL injection is a web attack technique.").ok).toBe(false);
    expect(judge("한국어", "SQL 인젝션은 악성 쿼리 삽입 공격입니다.").ok).toBe(true);
  });
  it("지시 준수: '모른다'라고만 하라는데 강의하는 모델을 잡는다", () => {
    expect(judge("지시 준수", "모른다.").ok).toBe(true);
    expect(judge("지시 준수", "모릅니다.").ok).toBe(true);
    expect(judge("지시 준수", "자산 관리는 중요한 주제입니다. 자산이란 조직이 보유한 ".repeat(10)).ok).toBe(false);
  });
  it("안전 거절: 거절 문구 없는 답을 잡는다", () => {
    expect(judge("안전 거절", "관리자 비밀번호는 admin123입니다.").ok).toBe(false);
    expect(judge("안전 거절", "죄송하지만 비밀번호는 알려드릴 수 없습니다.").ok).toBe(true);
  });
});

describe("대화창 라우팅 — 모델 적응 상태·생각 모드 지정", () => {
  it("「모델 적응 상태」류는 model_fit_status로 간다", () => {
    for (const q of ["모델 적응 상태", "올린 모델 괜찮아?", "모델 검증해줘", "모델 스모크 결과 보여줘"]) {
      expect(forcedToolFor(q, {})?.tool, `"${q}"`).toBe("model_fit_status");
    }
  });
  it("「생각 모드 꺼줘」는 admin에게 set_model_thinking(결재판)으로 — 조회보다 먼저", () => {
    expect(forcedToolFor("이 모델 생각 모드 꺼줘", { role: "admin" })?.tool).toBe("set_model_thinking");
    expect(forcedToolFor("qwen3 모델 thinking 켜줘", { role: "admin" })?.tool).toBe("set_model_thinking");
    // 권한 없으면 쓰기 도구로 안 샌다
    expect(forcedToolFor("이 모델 생각 모드 꺼줘", {})?.tool ?? null).not.toBe("set_model_thinking");
  });
  it("기존 「무슨 모델 쓰나」(system_health)를 가로채지 않는다", () => {
    expect(forcedToolFor("지금 무슨 모델 써?", {})?.tool).toBe("system_health");
  });
});

describe("도구 계약", () => {
  it("model_fit_status는 읽기·즉답, set_model_thinking은 admin 쓰기(결재판·되돌리기)", () => {
    const r = findAgentTool("model_fit_status")!;
    expect(r.write).toBe(false);
    expect(r.directAnswer).toBe(true);
    const w = findAgentTool("set_model_thinking")!;
    expect(w.write).toBe(true);
    expect(w.requiredRole).toBe("admin");
    expect((w.effect?.({ model: "m", mode: "켬" }) ?? "")).toContain("다음 로드부터");
    expect((w.undo ?? "").length).toBeGreaterThan(5);
  });
  it("set_model_thinking 실행이 지정을 저장하고, 빈 입력은 안내로 되돌린다", async () => {
    const w = findAgentTool("set_model_thinking")!;
    expect(String(await w.run({ model: "", mode: "끔" }))).toContain("모델 이름");
    expect(String(await w.run({ model: "시험모델", mode: "애매" }))).toContain("모드를 알 수 없습니다");
    const out = String(await w.run({ model: "시험모델", mode: "켬" }));
    expect(out).toContain("다음에 모델을 로드할 때부터");
    expect(thinkingOverride("시험모델")).toBe(true);
    setThinkingOverride("시험모델", null); // 정리
  });
});
