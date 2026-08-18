// 감사 로그의 **「무엇을 바꿨나」**가 다건 처리에서 빈칸으로 남지 않는지 본다.
//
// ⚠ 실결함 (2026-08-18 검토에서 발견):
//   승인 실행 감사는 대상을 `args.assetId ?? args.code ?? null`로만 적었다.
//   그런데 이 제품에서 **한 번에 가장 많이 바꾸는 쓰기**인 `bulk_update_findings`는
//   자산 하나를 받지 않는다 — 조건(`filter`: "critical kev")이나 고른 목록(`ids`)을 받아
//   **수백 건을 한꺼번에** 배정·판정한다. 둘 다 위 식에 없어서 감사 로그의 대상 칸이
//   **비어 있었다.** 「누가 언제 승인했다」는 남는데 **「무엇을」이 없다** — 사고가 나면
//   그 기록으로는 되짚을 수가 없다.
//
// ⚠ 이 부류가 왜 눈에 안 띄나: 화면도 멀쩡하고 실행도 성공한다. 감사 화면을 열어
//   대상 칸이 비어 있는 걸 **누군가 이상하게 여겨야만** 발견된다. 그래서 시험으로 못 박는다.
import { describe, it, expect } from "vitest";
import { 감사대상 } from "../src/engine/dispatcher";

describe("감사 로그 대상 — 다건 처리도 무엇을 바꿨는지 남긴다", () => {
  it("콕 집은 자산·코드가 있으면 그것을 쓴다 (옛 동작 보존)", () => {
    expect(감사대상({ assetId: "web-01" })).toBe("web-01");
    expect(감사대상({ code: "CVE-2026-1234" })).toBe("CVE-2026-1234");
    // 둘 다 있으면 자산이 먼저 — 더 구체적인 쪽이다.
    expect(감사대상({ assetId: "web-01", code: "CVE-2026-1234" })).toBe("web-01");
  });

  it("목록에서 고른 건들(ids)이 남는다 — 건수를 앞에 적는다", () => {
    const t = 감사대상({ ids: "web-01::CVE-2026-1,web-02::CVE-2026-2,db-01::CVE-2026-3" });
    expect(t).toContain("고른 3건");
    expect(t).toContain("web-01::CVE-2026-1");
  });

  it("조건(filter)으로 한 다건 처리도 남는다", () => {
    // ⚠ 이것이 실제로 비어 있던 자리다 — "Critical KEV 전부 정요한한테 배정"이 그 예다.
    expect(감사대상({ filter: "critical kev" })).toBe("조건: critical kev");
  });

  it("아주 긴 ids도 200자를 넘기지 않되, 건수는 앞에 남는다", () => {
    // 잘려도 **몇 건이었는지**는 알 수 있어야 한다 — 감사 칸은 열람용이지 원본이 아니다.
    const 많이 = Array.from({ length: 80 }, (_, i) => `asset-${i}::CVE-2026-${i}`).join(",");
    const t = 감사대상({ ids: 많이 }) ?? "";
    expect(t.length).toBeLessThanOrEqual(200);
    expect(t.startsWith("고른 80건"), `건수가 앞에 없다: ${t.slice(0, 40)}`).toBe(true);
  });

  it("빈 값·공백만 있는 값은 없는 것으로 본다", () => {
    expect(감사대상({})).toBe(null);
    expect(감사대상({ assetId: "   ", filter: "  " })).toBe(null);
    // 공백뿐인 assetId 때문에 뒤의 진짜 조건을 놓치면 안 된다.
    expect(감사대상({ assetId: "  ", filter: "critical" })).toBe("조건: critical");
  });

  it("이름표라도 있으면 빈칸보다 낫다", () => {
    expect(감사대상({ name: "주간 점검 일정" })).toBe("주간 점검 일정");
    expect(감사대상({ title: "분기 보고서" })).toBe("분기 보고서");
  });
});
