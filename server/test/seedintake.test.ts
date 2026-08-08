// 사내 문서에서 뽑은 문답을 학습 재료로 넣을 때 **출처가 지워지지 않는가**.
//
// 왜 중요한가(2026-08-09): 개시선 300건을 실사용만으로 채우려면 언제 될지 모른다.
// 그래서 문서에서 뽑은 문답을 마중물로 넣는데, 이때 실사용 문답과 **섞어 버리면**
// 나중에 "이 어댑터는 현장에서 배웠나 문서에서 배웠나"에 답할 수 없다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "learncandidates.ts"), "utf8");

describe("학습 재료 시드 편입", () => {
  it("출처를 seed-docs로 박는다 — 실사용 문답과 섞지 않는다", () => {
    expect(src).toContain('agentId: "seed-docs"');
  });

  it("관리자만 넣을 수 있다", () => {
    expect(src).toMatch(/"\/api\/learnloop\/seed", authMiddleware, adminMiddleware/);
  });

  it("제품 제외 규칙을 그대로 지난다 — 시드라고 봐주지 않는다", () => {
    const 블록 = src.slice(src.indexOf('"/api/learnloop/seed"'));
    expect(블록).toContain("excluded(q, a)");
  });

  it("이미 있는 문답은 다시 안 넣는다(지문 대조)", () => {
    const 블록 = src.slice(src.indexOf('"/api/learnloop/seed"'));
    expect(블록).toContain("있는지문");
    expect(블록).toContain("fingerprint(q, a)");
  });

  it("작업 기록에 몇 건 넣고 몇 건 걸렀는지 남긴다", () => {
    const 블록 = src.slice(src.indexOf('"/api/learnloop/seed"'));
    expect(블록).toContain("학습 재료 시드 편입");
    expect(블록).toContain("거른것");
  });
});
