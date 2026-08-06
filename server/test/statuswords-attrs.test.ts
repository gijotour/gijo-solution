// 속성어(미배정·기한·고위험) — [2026-08-07 · 147상황 4차가 잡은 자기모순]
//
// 실측: "미배정 취약점 몇 건이야?" → "조건('미배정')에 맞는 취약점을 못 찾았습니다."
//       같은 회차의 현황 답 → "담당자 미배정 4,820건"
//   한 제품이 같은 사실을 두 입으로 다르게 말했다. 미배정은 상태 칸이 아니라 **담당 칸이
//   비었다**는 뜻이라 상태어 사전으로는 영영 0건이었다. "기한"·"고위험,미배정"(쉼표)도 같은 병.
import { describe, it, expect } from "vitest";
import { 필터에맞나 } from "../src/engine/statuswords";

const 행 = (담당자: string | null, 기한지남: boolean, 심각도 = "high") => ({ 심각도, 담당자, 기한지남 });

describe("속성어 — 상태 칸에 없는 것을 묻는 말", () => {
  it("★ 실측 문장: 「미배정」이 담당 칸 빈 줄을 잡는다", () => {
    expect(필터에맞나("vuln:10.0.0.1 Log4Shell critical", "미배정", "pending", 행(null, false))).toBe(true);
    expect(필터에맞나("vuln:10.0.0.1 Log4Shell critical", "미배정", "pending", 행("김도희", false))).toBe(false);
  });

  it("★ 실측 문장: 「기한」·「기한초과」가 기한 지난 줄을 잡는다", () => {
    expect(필터에맞나("아무거나", "기한", "pending", 행("김도희", true))).toBe(true);
    expect(필터에맞나("아무거나", "기한초과", "pending", 행("김도희", false))).toBe(false);
  });

  it("★ 실측 문장: 쉼표 구분 「고위험,미배정」이 AND로 갈라진다", () => {
    expect(필터에맞나("x", "고위험,미배정", "pending", 행(null, false, "critical"))).toBe(true);
    expect(필터에맞나("x", "고위험,미배정", "pending", 행("김도희", false, "critical")), "배정된 건은 빠져야").toBe(false);
    expect(필터에맞나("x", "고위험,미배정", "pending", 행(null, false, "low")), "저위험은 빠져야").toBe(false);
  });

  it("★★ 속성을 못 받은 호출자(다른 도메인)에서는 예전과 똑같이 동작한다 — 회귀 금지", () => {
    // 속성 인자 없이 부르면 「미배정」은 본문 대조로 남는다(예전 동작 그대로)
    expect(필터에맞나("미배정 상태 메모", "미배정", "pending")).toBe(true);
    expect(필터에맞나("OpenSSH < 9.6", "미조치", "approved"), "상태어는 여전히 상태 칸만").toBe(false);
    expect(필터에맞나("OpenSSH < 9.6", "미조치", "open")).toBe(true);
  });

  it("속성어가 본문에 우연히 섞여도 속성 칸으로만 판정한다(OpenSSH 함정과 같은 계열)", () => {
    // 본문에 "고위험"이라는 글자가 있어도 심각도가 low면 안 잡힌다
    expect(필터에맞나("고위험 문구가 들어간 증적", "고위험", "pending", 행("김도희", false, "low"))).toBe(false);
  });
});
