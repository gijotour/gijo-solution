// 담당자가 우리말로 물으면 도구가 알아듣는가 — "할 일이 없다"는 거짓말을 막는 시험.
//
// ⚠ 실사고(2026-08-01, 챗봇 전수 점검):
//   "컴플라이언스 대응 안 된 항목 알려줘" → "미이행 항목이 없습니다"  (실제 21건 중 16건 미대응)
//   "미조치 취약점 알려줘"               → "미조치 취약점이 없습니다" (실제 활성 46건·조치율 0%)
//   모델은 지시에서 "미이행"·"미조치"를 정확히 뽑아 넘겼다. 도구가 그 글자를 저장값
//   (open·partial·pending)에 **글자 그대로** 대조해 언제나 0건이었다.
//   보안담당자에게 "할 일이 없다"고 잘못 답하는 것은 이 제품에서 가장 나쁜 실패다.
import { describe, it, expect } from "vitest";
import { 상태값들, 필터에맞나 } from "../src/engine/statuswords";

describe("우리말 상태어", () => {
  it("아직 손이 필요한 말을 저장값으로 옮긴다", () => {
    for (const 말 of ["미조치", "미대응", "미이행", "미처리", "미해결"]) {
      expect(상태값들(말), `${말}을 못 알아듣는다`).toContain("open");
    }
    expect(상태값들("미조치")).toContain("pending");
  });

  it("끝난 쪽 말도 옮긴다", () => {
    expect(상태값들("조치완료")).toContain("approved");
    expect(상태값들("이행")).toContain("covered");
    expect(상태값들("반려")).toContain("rejected");
    expect(상태값들("오탐")).toContain("rejected");
  });

  it("보통 검색어는 상태어로 착각하지 않는다", () => {
    // 자산 이름·코드가 상태어로 잘못 잡히면 엉뚱한 것이 걸린다.
    for (const 말 of ["FW-01", "방화벽", "D01", "openssl", "log4j"]) {
      expect(상태값들(말), `${말}이 상태어로 잘못 잡힌다`).toEqual([]);
    }
  });
});

describe("도구 필터", () => {
  const 미대응 = ["D01 불균형 데이터 담당 미지정", "open"] as const;
  const 대응됨 = ["D02 데이터 출처 완료", "covered"] as const;

  it("우리말 상태어로 미대응 행을 찾는다", () => {
    expect(필터에맞나(미대응[0], "미이행", 미대응[1])).toBe(true);
    expect(필터에맞나(미대응[0], "미조치", 미대응[1])).toBe(true);
    expect(필터에맞나(대응됨[0], "미이행", 대응됨[1])).toBe(false);
  });

  it("우리말 상태어로 완료 행도 찾는다", () => {
    expect(필터에맞나(대응됨[0], "이행", 대응됨[1])).toBe(true);
    expect(필터에맞나(미대응[0], "이행", 미대응[1])).toBe(false);
  });

  it("영문 저장값으로 물어도 그대로 통한다", () => {
    expect(필터에맞나(미대응[0], "open", 미대응[1])).toBe(true);
    expect(필터에맞나(대응됨[0], "covered", 대응됨[1])).toBe(true);
  });

  // ★ 실측 오탐(2026-08-01). 상태를 본문에서 찾으면 제품 이름에 걸린다.
  //    `OpenSSH < 9.6 …`(상태 approved)이 "미조치"로 잡혔다 — openssl·OpenVPN도 마찬가지다.
  it("제품 이름에 상태값이 섞여 있어도 상태로 오인하지 않는다", () => {
    const 조치완료 = "vuln:sample-web01 OpenSSH < 9.6 사용자 열거 CVE-2024-6387 김도희";
    expect(필터에맞나(조치완료, "미조치", "approved"), "OpenSSH의 open이 미조치로 잡힌다").toBe(false);
    expect(필터에맞나(조치완료, "조치완료", "approved")).toBe(true);
    // 이름으로 찾는 것은 그대로 되어야 한다.
    expect(필터에맞나(조치완료, "openssh", "approved")).toBe(true);
  });

  it("상태를 모르면 상태 조건은 통과 못 한다", () => {
    // 상태 칸이 없는 자료에 "미조치"를 물으면 **찾지 못한 것**이지 미조치인 것이 아니다.
    expect(필터에맞나("이름만 있는 줄", "미조치")).toBe(false);
  });

  it("낱말을 늘리면 좁아진다(AND)", () => {
    expect(필터에맞나(미대응[0], "미이행 데이터", 미대응[1])).toBe(true);
    expect(필터에맞나(미대응[0], "미이행 방화벽", 미대응[1])).toBe(false);
  });

  it("빈 조건은 전부 통과", () => {
    expect(필터에맞나(미대응[0], "", 미대응[1])).toBe(true);
    expect(필터에맞나(미대응[0], "   ", 미대응[1])).toBe(true);
  });
});

describe("0건일 때의 말", () => {
  it("도구 소스가 '못 찾았습니다'와 '없습니다'를 구분한다", async () => {
    // 조건에 안 맞는 것과 아예 없는 것은 담당자에게 뜻이 완전히 다르다.
    // "조건에 맞는 게 없다"를 "없다"로 말하면 담당자는 할 일이 없다고 믿는다.
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/engine/agenttools.ts", import.meta.url), "utf8");
    const 못찾음 = (src.match(/못 찾았습니다/g) ?? []).length;
    expect(못찾음, "조건 불일치를 '없습니다'로 말하는 곳이 남았다").toBeGreaterThanOrEqual(4);
  });
});
