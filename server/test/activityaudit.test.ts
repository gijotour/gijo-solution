// 전 메뉴 사용 감사 — 라우트마다 손으로 붙이면 반드시 빠진다는 게 이번 사고의 교훈이다
// (보안제품 화면 전체에 감사가 없어, 제품이 지워졌는데 누가 지웠는지 알 수 없었다).
// 미들웨어가 실제로 "바꾸는 행위만" 남기는지, 민감 경로를 건너뛰는지 검증한다.
import { describe, it, expect } from "vitest";
import { describePath } from "../src/engine/activityaudit";

describe("전 메뉴 감사 — 경로 해석", () => {
  it("메뉴 이름을 사람이 읽는 말로 바꾼다", () => {
    expect(describePath("/api/security-products/abc").menu).toBe("보안제품");
    expect(describePath("/api/work-sessions/xyz").menu).toBe("작업 내역");
    expect(describePath("/api/assets/vuln:web01/scan").menu).toBe("자산");
    expect(describePath("/api/law/config").menu).toBe("법령 조회");
  });

  it("대상(무엇을 건드렸는지)을 함께 남긴다", () => {
    expect(describePath("/api/assets/vuln:web01/scan").target).toBe("vuln:web01/scan");
    expect(describePath("/api/security-products/abc").target).toBe("abc");
  });

  it("이름을 모르는 메뉴는 경로를 그대로 쓴다 — 새 화면이 생겨도 기록은 남는다", () => {
    expect(describePath("/api/brand-new-thing/1").menu).toBe("brand-new-thing");
  });

  it("목록 경로는 대상이 비어도 무너지지 않는다", () => {
    expect(describePath("/api/tasks").target).toBe("-");
  });
});
