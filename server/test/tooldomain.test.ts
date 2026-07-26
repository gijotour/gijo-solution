import { describe, it, expect } from "vitest";
import { listToolsFor, toolCatalogText, listAgentTools } from "../src/engine/agenttools";
import { toolDomainsForScreen } from "../src/engine/screencontext";

// 꺼져 있는 선택 기능(법령 조회 — 기본 꺼짐)의 도구는 목록에서 빠진다.
// 2026-07-26 회귀에서 나온 계약: 꺼진 기능이 목록에 남아 있으면 질문을 가로채고
// "인증키를 넣으세요"로 막아, 예전에 사내 문서로 답하던 것을 못 답하게 만든다.
const OPTIONAL_OFF = ["law_lookup"];
const alwaysOn = () => listAgentTools().filter((t) => !OPTIONAL_OFF.includes(t.name));

describe("도구 도메인 필터", () => {
  it("범위를 안 주면 (꺼진 선택 기능만 빼고) 전체를 준다", () => {
    expect(listToolsFor()).toHaveLength(alwaysOn().length);
    expect(listToolsFor([])).toHaveLength(alwaysOn().length);
  });

  it("꺼진 선택 기능의 도구는 목록에 없다 — 질문을 가로채 막다른 답을 주지 않게", () => {
    const names = listToolsFor().map((t) => t.name);
    expect(names).not.toContain("law_lookup"); // 법제처 인증키 미등록 = 기능 꺼짐
  });

  it("도메인을 주면 그 영역 + cross 만 남는다", () => {
    const tools = listToolsFor(["assets"]);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.domain === "assets" || t.domain === "cross")).toBe(true);
    // 좁혔으므로 전체보다 적거나 같아야 한다
    expect(tools.length).toBeLessThanOrEqual(listAgentTools().length);
  });

  it("cross 도구는 어느 도메인에서도 빠지지 않는다 — 검색·설명은 어디서나 필요하다", () => {
    const crossNames = alwaysOn().filter((t) => t.domain === "cross").map((t) => t.name);
    for (const d of ["assets", "vuln", "sbom", "report"]) {
      const names = listToolsFor([d]).map((t) => t.name);
      for (const c of crossNames) expect(names, `${d}에서 ${c}`).toContain(c);
    }
  });

  // 실재하는 도메인 이름을 쓰면 나중에 그 도메인에 도구가 생겨 테스트가 깨진다(실제로 겪었다 —
  // maintenance를 예시로 썼다가 거기 도구를 추가하자 실패했다). 존재하지 않는 이름으로 고정한다.
  it("등록된 도구가 없는 도메인은 cross만 남는다", () => {
    const tools = listToolsFor(["__없는도메인__"]);
    expect(tools.length).toBeGreaterThan(0); // cross는 남아야 한다
    expect(tools.every((t) => t.domain === "cross")).toBe(true);
  });

  it("카탈로그 텍스트도 같은 범위로 줄어든다", () => {
    const all = toolCatalogText();
    const scoped = toolCatalogText(["assets"]);
    expect(scoped.length).toBeLessThanOrEqual(all.length);
    expect(scoped.split("\n").length).toBe(listToolsFor(["assets"]).length);
  });
});

describe("권한 게이팅 (requiredRole)", () => {
  it("admin 전용 도구는 일반 권한에게 목록에서 아예 안 보인다", () => {
    const adminOnly = listAgentTools().filter((t) => t.requiredRole === "admin");
    const forOfficer = listToolsFor(undefined, "security_officer").map((t) => t.name);
    for (const t of adminOnly) expect(forOfficer).not.toContain(t.name);
  });

  it("admin에게는 (꺼진 선택 기능만 빼고) 전부 보인다", () => {
    expect(listToolsFor(undefined, "admin")).toHaveLength(alwaysOn().length);
  });
});

describe("화면 → 도구 영역 연결", () => {
  it("업무 화면은 자기 영역을 준다", () => {
    expect(toolDomainsForScreen("vulnscan.html")).toEqual(["vuln", "assets"]);
    expect(toolDomainsForScreen("products.html")).toEqual(["products"]);
    expect(toolDomainsForScreen("opsguide.html")).toEqual(["maintenance"]);
  });

  it("대시보드·설정처럼 영역이 없는 화면은 undefined — 좁히지 않는다", () => {
    expect(toolDomainsForScreen("dashboard.html")).toBeUndefined();
    expect(toolDomainsForScreen("settings.html")).toBeUndefined();
    expect(toolDomainsForScreen(undefined)).toBeUndefined();
  });

  it("선언한 영역은 전부 실재하는 도메인이어야 한다(오타 방지)", async () => {
    const { TOOL_DOMAINS } = await import("../src/engine/agenttools");
    const screens = ["vulnscan.html", "sbom.html", "products.html", "opsguide.html", "report.html", "memory.html", "threat.html", "inventory.html"];
    for (const s of screens) {
      for (const d of toolDomainsForScreen(s) ?? []) {
        expect(TOOL_DOMAINS as readonly string[], `${s}의 ${d}`).toContain(d);
      }
    }
  });
});
