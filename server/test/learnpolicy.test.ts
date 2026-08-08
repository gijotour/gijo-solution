// 무엇으로 모델을 가르치지 않을 것인가 — 정책이 **실제로 불리는지**까지 본다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { isNonLearningAccount, isNonLearningSessionOwner } from "../src/engine/learnpolicy";

describe("학습에서 빼는 계정", () => {
  it("배포·게시 계정은 대화 로그 수집에서 빠진다", () => {
    expect(isNonLearningAccount("claude-deploy")).toBe(true);
    expect(isNonLearningAccount("gijo-publish")).toBe(true);
    expect(isNonLearningAccount("jyh")).toBe(false);
  });
});

describe("작업 내역 경로도 학습 정책을 본다 (2026-08-08 후보함 오염)", () => {
  // 실측: 후보 13건 중 7건이 내 QA·리허설 대화였다. 대화 로그 경로는 isNonLearningAccount로
  // 막혀 있었는데 **작업 내역(세션) 경로만 그 정책을 안 보고 있었다** — 정책이 있어도
  // 부르지 않으면 소용없다는 이 저장소의 반복 교훈이 또 나온 자리다.
  it("배포·게시 계정이 연 세션은 학습 후보가 아니다", () => {
    expect(isNonLearningSessionOwner("배포 자동화 전용")).toBe(true);
    expect(isNonLearningSessionOwner("claude-deploy")).toBe(true);
    expect(isNonLearningSessionOwner("인수인계-자동검증")).toBe(true);
    expect(isNonLearningSessionOwner("시스템")).toBe(true);
  });

  it("사람이 연 세션은 그대로 후보가 된다 — 담당자 문답이 빠지면 학습이 굶는다", () => {
    expect(isNonLearningSessionOwner("김도희")).toBe(false);
    expect(isNonLearningSessionOwner("jyh")).toBe(false);
    expect(isNonLearningSessionOwner(null)).toBe(false);
    expect(isNonLearningSessionOwner(undefined)).toBe(false);
  });

  it("후보함이 실제로 그 판별자를 부른다(소스 감시)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "learncandidates.ts"), "utf8");
    expect(src).toContain("isNonLearningSessionOwner(");
    // 세션 소유자를 못 읽으면 판별이 늘 false가 되어 검사가 헛돈다.
    expect(src).toContain("s.createdBy");
  });
});
