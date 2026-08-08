// 대화창 답의 길이 상한 — 담당자는 30초를 못 기다린다.
//
// 실측(2026-08-09, 150상황에서 나온 느린 답 5건 추적):
//   · "Log4Shell 있어?"        18.2 / 51.2 / 63.6 / 53.0 / 58.3초 (회차마다 크게 흔들림)
//   · "고위험인데 담당자 없는 거" 45.4초 → 이후 1.8 / 1.8 / 1.7초
//   · "머부터해야되나요"        42.7초 → 이후 0.6 / 0.7초
// 라우팅 문제가 아니었다(도구는 매번 옳게 골랐다). 캐시(감시 ping)도, 모델 교체도 아니었다
// — ping을 직접 쏴 봐도 뒤 호출이 빨라지지 않았고, 적재 모델은 하나뿐이었다.
// 남은 것은 **생성 시간**이다. 초당 15~20토큰에 상한이 800토큰이면 40~50초가 그냥 든다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");

describe("대화창 답 길이 상한", () => {
  it("최종답 생성에 상한이 걸려 있다", () => {
    expect(src).toMatch(/maxTokens:\s*Number\(process\.env\.GIJO_ANSWER_MAX_TOKENS/);
  });

  it("기본값이 30초 안에 쓸 수 있는 크기다 (초당 15토큰 기준 ≤ 30초)", () => {
    const m = src.match(/GIJO_ANSWER_MAX_TOKENS \?\? (\d+)/);
    expect(m, "기본값을 못 찾았다").toBeTruthy();
    const 상한 = Number(m![1]);
    expect(상한).toBeLessThanOrEqual(450);
    expect(상한 / 15, "가장 느린 속도로도 30초를 넘으면 안 된다").toBeLessThanOrEqual(30);
    // 너무 짧으면 답이 잘린다 — 아래 선도 지킨다.
    expect(상한).toBeGreaterThanOrEqual(300);
  });

  it("리포트처럼 긴 출력이 필요한 경로는 이 상한에 걸리지 않는다", () => {
    // 기본 상한(llm.ts DEFAULT_MAX_TOKENS)은 그대로 두고, 대화창 최종답만 낮췄다.
    const llm = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "llm.ts"), "utf8");
    expect(llm).toContain("const DEFAULT_MAX_TOKENS = 800;");
  });
});
