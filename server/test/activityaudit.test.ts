// 전 메뉴 사용 감사 — 라우트마다 손으로 붙이면 반드시 빠진다는 게 이번 사고의 교훈이다
// (보안제품 화면 전체에 감사가 없어, 제품이 지워졌는데 누가 지웠는지 알 수 없었다).
// 미들웨어가 실제로 "바꾸는 행위만" 남기는지, 민감 경로를 건너뛰는지 검증한다.
import { describe, it, expect } from "vitest";
import { describePath, 세부행위이름 } from "../src/engine/activityaudit";

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

// 감사 기록이 **무슨 일이었는지**를 말하는가 (2026-08-09).
//
// 실측: 비밀번호를 바꾸고 기록을 찾았더니 `계정 관리 추가·실행 · umrnt7…/password` 였다.
// **계정을 새로 만든 것과 글자 그대로 같은 문구**다. 구분은 target 끝의 `/password` 뿐이라
// 「누가 언제 비밀번호를 바꿨나」를 뽑으려면 사람이 경로를 읽어야 했다.
// 감사 대응은 대개 남이, 급할 때 본다 — 그때 경로를 읽게 두면 안 된다.
describe("감사 기록 — 민감한 조작은 이름으로 남는다", () => {
  it("비밀번호 변경이 계정 생성과 구분된다", () => {
    expect(세부행위이름("umrnt7chkjh2peq/password")).toBe("비밀번호 변경");
    expect(세부행위이름("umrnt7chkjh2peq")).toBeNull(); // 계정 생성·수정은 기존 동사 그대로
  });

  it("두 마디짜리 조작도 잡는다", () => {
    expect(세부행위이름("someuser/mfa/reset")).toBe("2차 인증 해제");
  });

  it("★ 모르는 것에 이름을 붙이지 않는다", () => {
    // 감사 기록은 **틀린 이름이 붙는 것이 안 붙는 것보다 나쁘다.**
    // 끝마디가 영문이면 다 싣는 식으로 넓히지 않는다.
    expect(세부행위이름("abc/scan")).toBeNull();
    expect(세부행위이름("vuln:web01/rebuild")).toBeNull();
    expect(세부행위이름("-")).toBeNull();
    expect(세부행위이름("")).toBeNull();
  });
});
