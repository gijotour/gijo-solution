// 감사 로그의 **「무엇을 바꿨나」**가 빈칸이거나 틀린 값으로 남지 않는지 본다.
//
// ⚠ 실결함 ① (2026-08-18 검토에서 발견):
//   승인 실행 감사는 대상을 `args.assetId ?? args.code ?? null`로만 적었다.
//   그런데 이 제품에서 **한 번에 가장 많이 바꾸는 쓰기**인 `bulk_update`는 자산 하나를 받지 않는다 —
//   조건(`filter`)이나 고른 목록(`ids`)으로 **수백 건을 한꺼번에** 배정·판정한다.
//   둘 다 위 식에 없어 감사 로그의 대상 칸이 **비어 있었다.**
//
// ⚠ 실결함 ② (같은 검토, 더 나쁜 것):
//   고쳤다고 한 뒤에도 **쓰기 도구 21개 중 10개가 여전히 빈칸**이었다. 손으로 인자 이름을
//   6개만 나열했기 때문이다. 그리고 `??` 연쇄는 **빈 문자열("")을 통과시켜 거기서 멈춘다** —
//   결재판이 안 채운 칸을 ""로 보내므로(console.js collect) 실제로 밟히는 함정이었다.
//   ⇒ 이제 도구가 **스스로 가진 인자 이름표**에서 받아 온다. 새 도구가 생겨도 빠질 수 없다.
//
// ⚠ 실결함 ③: 「보던 목록」으로 실행한 다건이 감사에 `조건: 이것들`로 남았다 —
//   빈칸 대신 **틀린 값**이다. 빈칸은 모른다는 뜻이지만 틀린 값은 안다고 거짓말하는 것이다.
//
// ⚠ 이 부류가 왜 눈에 안 띄나: 화면도 멀쩡하고 실행도 성공한다. 감사 화면을 열어
//   대상 칸이 비어 있는 걸 **누군가 이상하게 여겨야만** 발견된다. 그래서 시험으로 못 박는다.
import { describe, it, expect } from "vitest";
import { 감사대상 } from "../src/engine/dispatcher";
import { listAgentTools } from "../src/engine/agenttools";

describe("감사 로그 대상 — 다건 처리도 무엇을 바꿨는지 남긴다", () => {
  it("콕 집은 자산·코드가 있으면 그것을 쓴다 (옛 동작 보존)", () => {
    expect(감사대상("assign_owner", { assetId: "web-01" })).toBe("web-01");
    expect(감사대상("set_compliance_status", { code: "CVE-2026-1234" })).toBe("CVE-2026-1234");
    // 둘 다 있으면 자산이 먼저 — 더 구체적인 쪽이다.
    expect(감사대상("review_finding", { assetId: "web-01", code: "CVE-2026-1234" })).toBe("web-01");
  });

  it("목록에서 고른 건들(ids)이 남는다 — 건수를 앞에 적는다", () => {
    const t = 감사대상("bulk_update", { ids: "web-01::CVE-1,web-02::CVE-2,db-01::CVE-3" });
    expect(t).toContain("고른 3건");
    expect(t).toContain("web-01::CVE-1");
  });

  it("조건(filter)으로 한 다건 처리도 남는다", () => {
    // ⚠ 이것이 실제로 비어 있던 자리다 — "Critical KEV 전부 정요한한테 배정"이 그 예다.
    expect(감사대상("bulk_update", { filter: "critical kev" })).toBe("조건: critical kev");
  });

  it("★ 조건이 뜻을 잃으면 **실제로 바뀐** 보던 목록을 적는다 (빈칸보다 틀린 값이 나쁘다)", () => {
    const t = 감사대상("bulk_update", { filter: "이것들", viewIds: "a::1,b::2", assignee: "정요한" }) ?? "";
    expect(t, "조건을 적으면 실제로 바뀐 것과 다른 값이 남는다").not.toContain("조건: 이것들");
    expect(t).toContain("보던 목록 2건");
  });

  it("★ 조건이 멀쩡하면 보던 목록이 끼어들지 않는다 — runBulkUpdate와 같은 순서", () => {
    expect(감사대상("bulk_update", { filter: "critical", viewIds: "a::1,b::2" })).toBe("조건: critical");
    // 콕 집어 고른 것이 언제나 우선이다.
    expect(감사대상("bulk_update", { ids: "a::1", filter: "이것들", viewIds: "b::2,c::3" })).toContain("고른 1건");
  });

  it("아주 긴 ids도 200자를 넘기지 않되, 건수는 앞에 남는다", () => {
    const 많이 = Array.from({ length: 80 }, (_, i) => `asset-${i}::CVE-2026-${i}`).join(",");
    const t = 감사대상("bulk_update", { ids: 많이 }) ?? "";
    expect(t.length).toBeLessThanOrEqual(200);
    expect(t.startsWith("고른 80건"), `건수가 앞에 없다: ${t.slice(0, 40)}`).toBe(true);
  });

  it("빈 값·공백만 있는 값은 없는 것으로 본다", () => {
    expect(감사대상("bulk_update", {})).toBe(null);
    expect(감사대상("bulk_update", { assetId: "   ", filter: "  " })).toBe(null);
    // 공백뿐인 assetId 때문에 뒤의 진짜 조건을 놓치면 안 된다.
    expect(감사대상("bulk_update", { assetId: "  ", filter: "critical" })).toBe("조건: critical");
  });

  it("★ 빈 문자열에서 멈추지 않는다 — ?? 연쇄가 밟던 함정", () => {
    // `args.name?.trim() ?? args.title?.trim()`은 name이 ""일 때 ""를 돌려주고 멈춘다.
    // 결재판은 안 채운 칸을 ""로 보내므로(console.js collect) 실제로 일어나는 일이다.
    const t = 감사대상("schedule_maintenance", { productName: "", scheduleDate: "", title: "분기 점검" });
    expect(t, "앞 칸이 빈 문자열이면 뒤 칸으로 못 넘어간다").toContain("분기 점검");
  });

  it("★★ 쓰기 도구 전수 — 값이 있는데 빈칸으로 남는 도구가 하나도 없다", () => {
    // ⚠ 이 검사가 핵심이다. 예전엔 인자 이름을 손으로 6개만 적어 **21개 중 10개가 빈칸**이었다.
    //   새 쓰기 도구가 생겨도 여기서 걸리므로 같은 일이 되풀이되지 않는다.
    const 쓰기 = listAgentTools().filter((t) => t.write);
    expect(쓰기.length, "쓰기 도구를 못 읽었다 — 이 검사가 헛돈다").toBeGreaterThan(15);

    const 빈칸 = [];
    for (const t of 쓰기) {
      if (!t.params.length) continue; // 인자가 아예 없는 도구는 적을 대상도 없다
      // 그 도구의 **첫 인자에 그럴듯한 값**을 넣어 본다 — 이 정도면 대상이 남아야 한다.
      const args = { [t.params[0].name]: "시험값-가나다" };
      const 대상 = 감사대상(t.name, args);
      if (!대상) 빈칸.push(`${t.name}(${t.params[0].name})`);
    }
    expect(빈칸.join(", "), `이 도구들은 값이 있는데도 감사 대상이 빈칸이다: ${빈칸.join(", ")}`).toBe("");
  });

  it("모르는 도구 이름을 줘도 죽지 않는다", () => {
    // 도구를 못 찾으면 이름표를 못 쓰지만, 마지막 후보(name·title)는 여전히 본다.
    expect(감사대상("없는도구", { name: "무언가" })).toBe("무언가");
    expect(감사대상("없는도구", {})).toBe(null);
  });
});
