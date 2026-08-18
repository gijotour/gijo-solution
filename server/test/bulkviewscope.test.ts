// 「이것들 전부 배정해줘」가 **전건**을 건드리지 않는지 본다. (계획서 중-1 · 대량 쓰기 안전)
//
// ⚠ 실결함 (2026-08-18 발견):
//   `runBulkUpdate`는 "조건 없는 일괄 쓰기는 금지"를 지키려고 **빈 filter**를 막았다
//   (picklist.test.ts 「조건도 선택도 없으면 아무것도 안 한다」). 그런데 막은 것이
//   **틀린 것**이었다 — 「비었는가」가 아니라 **「실제로 좁혔는가」**를 봤어야 했다.
//
//   `matchFindingsByFilter("이것들")`을 따라가 보면:
//     · 심각도·KEV·미배정·기한초과 어느 것도 안 걸린다
//     · 남는 낱말은 "이것들"에서 집합어(것들)를 뺀 **"이"** — 한 글자라 `kw.length >= 2`가
//       거짓이 되어 **키워드 거르기도 건너뛴다**
//     · 결과: 아무 조건도 안 걸린 **전건**이 그대로 돌아온다
//   사람이 "이것들 전부 정요한한테 배정해줘"라고 말하면 모델이 filter를 "이것들"로 채우고,
//   **전사 취약점 전부**가 대상이 된다. 빈 filter는 막았는데 뜻 없는 filter는 그대로 통과다.
//
// ⚠ 지금 완전한 사고는 아니다 — 결재판이 "N건에 일괄 적용"으로 건수를 보여 주므로
//   사람이 보고 안 누를 수 있다. 하지만 결재판은 **마지막 관문**이지 유일한 관문이 아니다.
//   4,700건이 뜬 것을 못 보고 누르는 순간 되돌릴 일이 커진다.
//
// ■ 고친 뒤의 규칙: 조건이 아무것도 못 좁혔으면
//     ⓐ 화면에서 보고 있던 목록(viewIds)이 있으면 **그것**을 대상으로 삼는다 (사람이 눈으로 본 범위)
//     ⓑ 없으면 거부한다 — 무엇을 가리키는지 모른 채 전건을 건드리지 않는다
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../src/db";
import { findAgentTool } from "../src/engine/agenttools";
import { matchFindingsByFilter, 조건이좁히나 } from "../src/engine/agenttools/handlers";
import { registerAsset, recordFindings, resetAssetsForTests } from "../src/engine/assets";
import { prioritizedReviews, listFindingReviews } from "../src/engine/approvals";

const 전체id = () => prioritizedReviews(2000).map((r) => `${r.assetId}::${r.findingKey}`);

describe("★ 뜻 없는 조건이 전건을 건드리지 않는다", () => {
  afterEach(() => resetAssetsForTests());
  beforeEach(() => {
    resetAssetsForTests();
    // ⚠ resetAssetsForTests는 자산·스캔만 지우고 **판정 기록(finding_approvals)은 남긴다.**
    //   같은 자산 id를 다시 쓰는 이 시험에선 앞 시험의 배정이 그대로 살아 있어
    //   「1건만 바뀌어야 한다」가 2건으로 보인다 — 제품 결함이 아니라 시험 오염이다.
    db.exec("DELETE FROM finding_approvals;");
    registerAsset({ id: "vs-a", name: "가서버", path: "-", assetType: "서버" });
    registerAsset({ id: "vs-b", name: "나서버", path: "-", assetType: "서버" });
    recordFindings("vs-a", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "CVE-2026-9001", source_tool: "scanner" },
      { finding_type: "약한 암호화", severity: "high", evidence: "TLS 1.0", source_tool: "scanner" },
    ]);
    recordFindings("vs-b", [
      { finding_type: "디렉터리 노출", severity: "medium", evidence: "/backup", source_tool: "scanner" },
      { finding_type: "정보 노출", severity: "low", evidence: "banner", source_tool: "scanner" },
    ]);
  });

  it("「이것들」·「전부」처럼 아무것도 안 좁히는 조건을 알아본다", () => {
    // 이 판정이 고침의 뿌리다 — 「비었는가」가 아니라 「좁혔는가」를 본다.
    expect(조건이좁히나("이것들"), "「이것들」이 조건으로 인정됐다").toBe(false);
    expect(조건이좁히나("전부"), "「전부」가 조건으로 인정됐다").toBe(false);
    expect(조건이좁히나("다"), "「다」가 조건으로 인정됐다").toBe(false);
    expect(조건이좁히나("   "), "공백이 조건으로 인정됐다").toBe(false);
    expect(조건이좁히나("이 취약점들 전체"), "지시대명사+집합어 조합이 조건으로 인정됐다").toBe(false);
    // 진짜 조건은 그대로 인정돼야 한다 — 과하게 막으면 되던 것이 안 된다.
    expect(조건이좁히나("critical"), "critical이 조건에서 빠졌다").toBe(true);
    expect(조건이좁히나("critical kev"), "critical kev가 조건에서 빠졌다").toBe(true);
    expect(조건이좁히나("미배정"), "미배정이 조건에서 빠졌다").toBe(true);
    expect(조건이좁히나("Oracle"), "키워드가 조건에서 빠졌다").toBe(true);
    expect(조건이좁히나("고위험 미배정"), "묶음 조건이 빠졌다").toBe(true);
  });

  it("「이것들 전부 배정」에 목록이 없으면 **아무것도 바꾸지 않고** 되묻는다", () => {
    expect(() => findAgentTool("bulk_update")!.run({ filter: "이것들", assignee: "정요한" })).toThrow(/좁혀지지 않습니다|무엇에 적용할지/);
    // 던지기만 하고 이미 고쳤으면 소용없다 — 실제로 안 바뀌었는지 센다.
    expect(listFindingReviews().filter((r) => r.assignee === "정요한")).toHaveLength(0);
  });

  it("옛 가드(빈 조건)는 그대로 살아 있다", () => {
    expect(() => findAgentTool("bulk_update")!.run({ status: "오탐" })).toThrow(/무엇에 적용할지|좁혀지지 않습니다/);
    expect(listFindingReviews().filter((r) => r.status === "rejected")).toHaveLength(0);
  });

  it("진짜 조건은 여전히 통한다 — 과하게 막지 않았다", () => {
    const out = findAgentTool("bulk_update")!.run({ filter: "critical", assignee: "정요한" });
    expect(out).toContain("정요한");
    const 바뀐 = listFindingReviews().filter((r) => r.assignee === "정요한");
    expect(바뀐, "critical 1건만 바뀌어야 한다").toHaveLength(1);
    expect(바뀐[0].assetId).toBe("vs-a");
  });

  it("보던 목록(viewIds)이 있으면 그것을 대상으로 삼는다 — 사람이 눈으로 본 범위", () => {
    const 보던 = 전체id().slice(0, 2); // 화면에 2건만 걸러 보고 있던 상황
    const out = findAgentTool("bulk_update")!.run({ filter: "이것들", assignee: "정요한", viewIds: 보던.join(",") });
    const 바뀐 = listFindingReviews().filter((r) => r.assignee === "정요한");
    expect(바뀐, "보던 2건만 바뀌어야 한다").toHaveLength(2);
    expect(out).toMatch(/보고 계신|보시던|목록/);
    // ⚠ 나머지는 손대지 않았다 — 「보던 목록」이 전건으로 새면 고치기 전과 같아진다.
    expect(listFindingReviews().filter((r) => !r.assignee)).not.toHaveLength(0);
  });

  it("콕 집어 고른 것(ids)이 보던 목록보다 우선한다", () => {
    const 전 = 전체id();
    const out = findAgentTool("bulk_update")!.run({ ids: 전[0], viewIds: 전.join(","), assignee: "정요한" });
    expect(listFindingReviews().filter((r) => r.assignee === "정요한"), "고른 1건만 바뀌어야 한다").toHaveLength(1);
    expect(out).toContain("정요한");
  });

  it("진짜 조건이 있으면 보던 목록이 끼어들지 않는다", () => {
    // ⚠ 「보던 목록」은 **조건이 뜻을 잃었을 때만** 나선다. 조건이 멀쩡한데 끼어들면
    //   담당자가 말한 범위를 화면이 조용히 덮어쓰는 셈이 된다 — 그건 반대 방향의 사고다.
    const 전 = 전체id();
    findAgentTool("bulk_update")!.run({ filter: "critical", viewIds: 전.join(","), assignee: "정요한" });
    expect(listFindingReviews().filter((r) => r.assignee === "정요한"), "조건대로 1건만").toHaveLength(1);
  });

  it("matchFindingsByFilter 자체는 그대로다 — 판정만 밖에서 한다", () => {
    // 거르는 함수의 뜻은 안 바꿨다(다른 곳에서도 쓴다). 「좁혔나」 판정을 따로 두었을 뿐이다.
    expect(matchFindingsByFilter("critical")).toHaveLength(1);
    expect(matchFindingsByFilter("이것들"), "거르는 함수 자체는 여전히 전건을 준다").toHaveLength(4);
  });
});
