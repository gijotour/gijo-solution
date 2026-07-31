// 목록에서 **골라서 조치하기** — (2026-07-31 사용자 질문 "미조치 취약점에 리스트를 보고 선택도 가능한거지?")
//
// 이 기능의 위험은 하나다: **엉뚱한 취약점이 처리되는 것.**
// 담당자가 3건을 골랐는데 4건이 오탐 처리되면, 그 4번째는 아무도 다시 안 본다.
// 그래서 "고른 것만 정확히" 를 여러 각도로 두들긴다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findAgentTool, matchFindingsByIds } from "../src/engine/agenttools";
import { registerAsset, recordFindings, resetAssetsForTests } from "../src/engine/assets";
import { prioritizedReviews, listFindingReviews } from "../src/engine/approvals";
import { buildFindingPicks, parsePickCommand, pickToolArgs, isFindingListAsk, findingListAnswer, stripPickMarks } from "../src/engine/picklist";

function 아이디들(): string[] {
  return prioritizedReviews(50)
    .filter((r) => r.assetId === "pick-web")
    .map((r) => `${r.assetId}::${r.findingKey}`);
}

describe("고른 것만 정확히", () => {
  afterEach(() => resetAssetsForTests());
  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "pick-web", name: "웹서버-픽", path: "-", assetType: "서버" });
    recordFindings("pick-web", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "CVE-2026-1111", source_tool: "scanner" },
      { finding_type: "약한 암호화", severity: "high", evidence: "TLS 1.0", source_tool: "scanner" },
      { finding_type: "디렉터리 노출", severity: "medium", evidence: "/backup", source_tool: "scanner" },
    ]);
  });

  it("고른 id만 찾아온다", () => {
    const ids = 아이디들();
    expect(ids.length).toBe(3);
    const { matched, unknown } = matchFindingsByIds([ids[0], ids[2]].join(","));
    expect(matched).toHaveLength(2);
    expect(unknown).toHaveLength(0);
  });

  it("★ 없는 id는 조용히 넘어가지 않고 세어서 알린다", () => {
    // 골랐는데 안 된 걸 모르면, 안 한 일을 했다고 믿는다 — 그게 제일 나쁘다.
    const { matched, unknown } = matchFindingsByIds(아이디들()[0] + ",pick-web::없는키0000000000");
    expect(matched).toHaveLength(1);
    expect(unknown).toEqual(["pick-web::없는키0000000000"]);
  });

  it("같은 것을 두 번 골라도 한 번만 처리한다", () => {
    const one = 아이디들()[0];
    expect(matchFindingsByIds(`${one},${one}`).matched).toHaveLength(1);
  });

  it("빈 값은 아무것도 고르지 않은 것이다 — 전건이 걸리면 안 된다", () => {
    expect(matchFindingsByIds("").matched).toHaveLength(0);
    expect(matchFindingsByIds("   ").matched).toHaveLength(0);
  });

  it("고른 것에만 적용된다 — 나머지는 그대로", () => {
    const ids = 아이디들();
    const out = findAgentTool("bulk_update")!.run({ ids: ids[0], status: "오탐" }) as string;
    expect(out).toContain("1건");
    const rows = listFindingReviews().filter((r) => r.assetId === "pick-web");
    expect(rows.filter((r) => r.status === "rejected"), "고른 1건만 오탐이어야 한다").toHaveLength(1);
  });

  it("못 찾은 건이 섞이면 결과 문장에 남는다", () => {
    const out = findAgentTool("bulk_update")!.run({
      ids: 아이디들()[0] + ",pick-web::없는키0000000000",
      assignee: "정요한",
    }) as string;
    expect(out).toContain("1건");
    expect(out).toContain("건너뛰었습니다");
  });

  it("고른 게 전부 사라졌으면 처리하지 않고 알린다", () => {
    expect(() => findAgentTool("bulk_update")!.run({ ids: "pick-web::없는키0000000000", status: "오탐" }))
      .toThrow(/목록에서 찾지 못했습니다|다시 불러/);
  });
});

describe("★ 조건도 선택도 없으면 아무것도 안 한다", () => {
  afterEach(() => resetAssetsForTests());
  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "pick-all", name: "전건테스트", path: "-", assetType: "서버" });
    recordFindings("pick-all", [
      { finding_type: "취약점A", severity: "critical", evidence: "a", source_tool: "scanner" },
      { finding_type: "취약점B", severity: "high", evidence: "b", source_tool: "scanner" },
    ]);
  });

  it("filter도 ids도 비면 던진다 — 비면 전건이 걸린다", () => {
    // filter를 선택값으로 바꾸면서 생긴 구멍이다. 빈 filter로 matchFindingsByFilter를 부르면
    // 아무 조건도 안 걸려 **전건**이 나온다 — 모르고 승인하면 전사 취약점이 한 번에 바뀐다.
    expect(() => findAgentTool("bulk_update")!.run({ status: "오탐" })).toThrow(/무엇에 적용할지/);
    expect(() => findAgentTool("bulk_update")!.run({ filter: "  ", ids: "", assignee: "정요한" })).toThrow(/무엇에 적용할지/);
    // 정말로 아무것도 안 바뀌었는지 확인한다(던지기만 하고 이미 고쳤으면 소용없다).
    expect(listFindingReviews().filter((r) => r.assetId === "pick-all" && r.status === "rejected")).toHaveLength(0);
  });

  it("담당자·기한·판정이 하나도 없으면 던진다", () => {
    expect(() => findAgentTool("bulk_update")!.run({ filter: "critical" })).toThrow(/하나는 지정/);
  });
});

describe("체크칸은 화면에 보이는 것만 만든다", () => {
  afterEach(() => resetAssetsForTests());
  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "pick-a", name: "가나서버", path: "-", assetType: "서버" });
    recordFindings("pick-a", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "x", source_tool: "scanner" },
      { finding_type: "정보노출", severity: "low", evidence: "y", source_tool: "scanner" },
    ]);
  });

  it("답 본문에 나온 건만 고를 수 있다", () => {
    // 화면에 없는 것이 체크칸에 나타나면 "내가 뭘 고른 거지"가 된다.
    const 본문 = "- [critical] pick-a · 원격코드실행 (pending, 담당 미배정)";
    const pl = buildFindingPicks(본문, ["finding_status"]);
    expect(pl).not.toBeNull();
    expect(pl!.items).toHaveLength(1);
    expect(pl!.items[0].label).toContain("원격코드실행");
  });

  it("목록을 낸 도구가 없으면 체크칸도 없다", () => {
    const 본문 = "- [critical] pick-a · 원격코드실행";
    expect(buildFindingPicks(본문, ["system_health"]), "목록이 아닌 답에 체크칸이 붙으면 안 된다").toBeNull();
    expect(buildFindingPicks(본문, []), "도구를 안 쓴 답에도 붙으면 안 된다").toBeNull();
  });

  it("자산만 언급되고 취약점 유형이 없으면 붙지 않는다", () => {
    expect(buildFindingPicks("pick-a 자산은 정상입니다", ["finding_status"])).toBeNull();
  });

  it("고를 수 있는 항목엔 담당·기한이 함께 보인다", () => {
    const pl = buildFindingPicks("- [critical] pick-a · 원격코드실행", ["finding_status"])!;
    expect(pl.items[0]).toHaveProperty("id");
    expect(pl.items[0].id).toContain("pick-a::");
    expect(pl.actions.map((a) => a.key)).toEqual(["assign", "due", "done", "false"]);
  });
});

describe("★ 목록 질문만 규칙으로 가로챈다", () => {
  // 이 경로는 LLM을 건너뛴다. 넓게 잡으면 잘 되던 기능(배정·스캔·리포트)이 조용히 죽는다.
  const 목록질문 = [
    "미조치 취약점 뭐 있어?",
    "취약점 목록 보여줘",
    "조치 안 한 취약점 리스트",
    "남은 취약점 뭐 있지",
    "취약점 현황 보여줘",
  ];
  for (const q of 목록질문) {
    it(`목록으로 답한다: ${q}`, () => expect(isFindingListAsk(q)).toBe(true));
  }

  const 건드리면안됨 = [
    "가장 급한 취약점에 담당자 배정해줘",         // 배정 — 쓰기 기능
    "Critical 취약점 전부 오탐 처리해줘",          // 오탐 — 쓰기 기능
    "높은 취약점 기한 2026-08-10으로",             // 기한 — 쓰기 기능
    "이 취약점 조치 방법 알려줘",                  // 플레이북
    "취약점 스캔 돌려줘",                          // 스캔
    "취약점 리포트 만들어줘",                      // 리포트
    "취약점 관리 어떻게 하는 거야",                // 화면 안내
    "오늘 뭐부터 해야 해?",                        // today
    "우리 자산 현황 알려줘",                       // 자산(취약점 아님)
  ];
  for (const q of 건드리면안됨) {
    it(`그냥 지나간다: ${q}`, () => {
      expect(isFindingListAsk(q), "가로채면 원래 기능이 죽는다").toBe(false);
    });
  }
});

describe("규칙으로 만든 목록 답", () => {
  afterEach(() => resetAssetsForTests());
  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "list-a", name: "목록서버", path: "-", assetType: "서버" });
    recordFindings("list-a", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "z", source_tool: "scanner" },
    ]);
  });

  it("건수·미배정·기한을 먼저 말하고 목록을 준다", () => {
    const { output, picklist } = findingListAnswer();
    expect(output).toContain("담당자 미배정");
    expect(output).toContain("원격코드실행");
    expect(picklist, "이 답에는 반드시 고를 수 있어야 한다").not.toBeNull();
    expect(picklist!.items.length).toBeGreaterThan(0);
  });

  it("고를 항목과 본문이 어긋나지 않는다", () => {
    const { output, picklist } = findingListAnswer();
    for (const it2 of picklist!.items) {
      const 유형 = it2.label.split("] ")[1].split(" @ ")[0];
      expect(output, "화면에 없는 것이 체크칸에 있으면 안 된다").toContain(유형);
    }
  });

  it("취약점이 없으면 체크칸도 없다 — 빈 목록을 그리지 않는다", () => {
    resetAssetsForTests();
    const { output, picklist } = findingListAnswer();
    expect(picklist).toBeNull();
    expect(output).toContain("없습니다");
  });
});

describe("고른 것 → 조치 표식 읽기", () => {
  it("표식이 없으면 평소 지시다", () => {
    expect(parsePickCommand("미조치 취약점 뭐 있어?")).toBeNull();
  });

  it("고른 건과 조치를 읽는다", () => {
    const cmd = parsePickCommand("고른 2건을 조치완료로\n#고른건 a::1,b::2\n#조치 done");
    expect(cmd).not.toBeNull();
    expect(cmd!.ids).toEqual(["a::1", "b::2"]);
    expect(cmd!.action).toBe("done");
  });

  it("★ 값이 필요한 조치에 값이 없으면 처리하지 않는다", () => {
    // 빈 값으로 결재판을 만들면 "담당 (없음)으로 배정"이라는 뜻 모를 승인이 뜬다.
    expect(parsePickCommand("고른 1건\n#고른건 a::1\n#조치 assign")).toBeNull();
    expect(parsePickCommand("고른 1건\n#고른건 a::1\n#조치 due")).toBeNull();
    expect(parsePickCommand("고른 1건\n#고른건 a::1\n#조치 assign\n#값 정요한")!.value).toBe("정요한");
  });

  it("모르는 조치는 받지 않는다", () => {
    expect(parsePickCommand("#고른건 a::1\n#조치 삭제")).toBeNull();
    expect(parsePickCommand("#고른건 a::1")).toBeNull();
  });

  it("★ 기록에는 기계용 표식이 남지 않는다", () => {
    // 표식을 그대로 저장하면 작업 내역·이어보기가 sha1 해시 범벅이 되어 자기 대화를 못 알아본다.
    const 원문 = "고른 2건을 오탐으로\n#고른건 vuln:1.2.3.4::3e1068a568d14e69,vuln:1.2.3.4::5c15799a042468e8\n#조치 false";
    const 기록 = stripPickMarks(원문);
    expect(기록).toBe("고른 2건을 오탐으로");
    expect(기록).not.toContain("#");
    expect(기록).not.toContain("3e1068a568d14e69");
  });

  it("표식이 없는 평범한 지시는 그대로 남는다", () => {
    expect(stripPickMarks("미조치 취약점 뭐 있어?")).toBe("미조치 취약점 뭐 있어?");
    expect(stripPickMarks("#해시태그는 지우지 않는다")).toBe("#해시태그는 지우지 않는다");
  });

  it("조치가 bulk_update 인자로 바뀐다", () => {
    expect(pickToolArgs({ ids: ["a::1"], action: "done", value: "" })).toEqual({ ids: "a::1", status: "조치완료" });
    expect(pickToolArgs({ ids: ["a::1"], action: "false", value: "" })).toEqual({ ids: "a::1", status: "오탐" });
    expect(pickToolArgs({ ids: ["a::1", "b::2"], action: "assign", value: "정요한" }))
      .toEqual({ ids: "a::1,b::2", assignee: "정요한" });
    expect(pickToolArgs({ ids: ["a::1"], action: "due", value: "2026-08-10" }))
      .toEqual({ ids: "a::1", dueDate: "2026-08-10" });
  });
});
