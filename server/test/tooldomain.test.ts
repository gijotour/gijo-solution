import { describe, it, expect } from "vitest";
import { listToolsFor, toolCatalogText, listAgentTools } from "../src/engine/agenttools";
import { toolDomainsForScreen } from "../src/engine/screencontext";

describe("도구 도메인 필터", () => {
  it("범위를 안 주면 전체를 그대로 준다(종전 동작 유지)", () => {
    expect(listToolsFor()).toHaveLength(listAgentTools().length);
    expect(listToolsFor([])).toHaveLength(listAgentTools().length);
  });

  it("도메인을 주면 그 영역 + cross 만 남는다", () => {
    const tools = listToolsFor(["assets"]);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.domain === "assets" || t.domain === "cross")).toBe(true);
    // 좁혔으므로 전체보다 적거나 같아야 한다
    expect(tools.length).toBeLessThanOrEqual(listAgentTools().length);
  });

  it("cross 도구는 어느 도메인에서도 빠지지 않는다 — 검색·설명은 어디서나 필요하다", () => {
    const crossNames = listAgentTools().filter((t) => t.domain === "cross").map((t) => t.name);
    for (const d of ["assets", "vuln", "sbom", "report"]) {
      const names = listToolsFor([d]).map((t) => t.name);
      for (const c of crossNames) expect(names, `${d}에서 ${c}`).toContain(c);
    }
  });

  it("등록된 도구가 없는 도메인은 cross만 남는다", () => {
    const tools = listToolsFor(["maintenance"]); // 아직 도구 미등록 영역
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

  it("admin에게는 전부 보인다", () => {
    expect(listToolsFor(undefined, "admin")).toHaveLength(listAgentTools().length);
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
