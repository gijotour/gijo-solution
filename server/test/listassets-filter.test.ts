// 자산 목록이 **물어본 것만** 보여 주는가.
//
// 실측(2026-08-02 147상황): "방화벽 장비 목록 알려줘"에 **전체 57건**(2,061자)이 나왔다.
//   LLM 서비스·이상탐지 모델까지 전부. 담당자는 2,061자를 읽지 않는다.
//   원인은 단순했다 — list_assets에 **거르는 인자가 아예 없어서** 언제나 전부 냈다.
//
// ★ 여기서 지키는 것 셋:
//   ① 조건을 주면 거른다
//   ② 못 찾으면 **전체를 쏟지 않는다** — 조건을 흘려버리고 전부 주면 담당자는 그게 답인 줄 안다
//   ③ 많으면 **잘랐다고 밝힌다** — 57건이라 쓰고 15건만 보여 주면 다 봤다고 생각한다
import { describe, it, expect, beforeEach } from "vitest";
import { resetAssetsForTests, registerAsset } from "../src/engine/assets";
import { findAgentTool } from "../src/engine/agenttools";

const 목록 = async (args: Record<string, string> = {}) => {
  const t = findAgentTool("list_assets");
  if (!t) throw new Error("list_assets 도구가 없다 — 이름이 바뀌었으면 이 시험도 고쳐야 한다");
  return String(await t.run(args));
};

beforeEach(() => {
  resetAssetsForTests();
  registerAsset({ id: "fw-1", name: "본사 방화벽", path: "10.0.0.1", assetType: "infra-host" });
  registerAsset({ id: "fw-2", name: "지사 방화벽", path: "10.0.0.2", assetType: "infra-host" });
  registerAsset({ id: "llm-1", name: "사내 보안 어시스턴트", path: "m.gguf", assetType: "LLM 서비스" });
  registerAsset({ id: "ids-1", name: "이상거래 탐지 AI", path: "d.gguf", assetType: "이상탐지 모델" });
});

describe("자산 목록 — 물어본 것만 보여 준다", () => {
  it("① 이름으로 거른다 — 방화벽을 물으면 방화벽만", async () => {
    const out = await 목록({ query: "방화벽" });
    expect(out).toContain("본사 방화벽");
    expect(out).toContain("지사 방화벽");
    expect(out, "묻지 않은 자산이 섞였다").not.toContain("사내 보안 어시스턴트");
    expect(out).not.toContain("이상거래 탐지 AI");
  });

  it("① 유형으로도 거른다", async () => {
    const out = await 목록({ query: "LLM 서비스" });
    expect(out).toContain("사내 보안 어시스턴트");
    expect(out).not.toContain("본사 방화벽");
  });

  it("② 못 찾으면 전체를 쏟지 않는다 — 조건을 흘려버리면 안 된다", async () => {
    const out = await 목록({ query: "존재하지않는장비" });
    expect(out, "0건인데 자산 이름이 나왔다 = 전체를 쏟았다").not.toContain("본사 방화벽");
    expect(out).toContain("검색되지 않았습니다");
    expect(out, "어떻게 하면 되는지 없으면 막다른 길이다").toMatch(/전체|다른 말/);
  });

  it("③ 많으면 잘랐다고 밝힌다", async () => {
    for (let i = 0; i < 30; i++) registerAsset({ id: `h-${i}`, name: `호스트 ${i}`, path: `10.1.0.${i}`, assetType: "infra-host" });
    const out = await 목록();
    expect(out, "총 개수를 말해야 한다").toMatch(/34개/);
    expect(out, "자른 것을 안 밝히면 다 봤다고 생각한다").toContain("아래는");
  });

  it("조건이 없으면 전체를 준다 — 기존 동작은 그대로", async () => {
    const out = await 목록();
    expect(out).toContain("본사 방화벽");
    expect(out).toContain("사내 보안 어시스턴트");
  });

  it("자산이 하나도 없으면 그렇게 말한다", async () => {
    resetAssetsForTests();
    expect(await 목록({ query: "방화벽" })).toContain("없습니다");
  });
});
