import { describe, it, expect, afterEach } from "vitest";
import { listAgentTools, listToolsFor, findAgentTool, TOOL_DOMAINS } from "../src/engine/agenttools";
import { createProduct, deleteProduct, listProducts } from "../src/engine/securityproducts";
import { resetComplianceForTests, listCompliance, setComplianceStatus } from "../src/engine/compliance";

describe("보안제품(products) 역량", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const id of made.splice(0)) deleteProduct(id);
  });

  it("products 도메인에 등록돼 있다", () => {
    expect(listAgentTools().filter((t) => t.domain === "products").map((t) => t.name)).toContain("product_status");
    expect(listToolsFor(["products"]).map((t) => t.name)).toContain("product_status");
  });

  it("문서 없는 제품을 따로 짚어준다 — 장애 시 대응이 늦어지는 지점이다", () => {
    const p = createProduct({ name: "테스트방화벽", category: "방화벽", vendor: "테스트벤더" });
    made.push(p.id);

    const out = findAgentTool("product_status")!.run({}) as string;
    expect(out).toContain("테스트방화벽");
    expect(out).toContain("운영문서 없는 제품");
    expect(out).toContain("문서 미등록");
  });

  it("검색어로 좁히고, 없으면 지어내지 않는다", () => {
    const p = createProduct({ name: "테스트방화벽", category: "방화벽" });
    made.push(p.id);
    expect(findAgentTool("product_status")!.run({ query: "방화벽" }) as string).toContain("테스트방화벽");
    expect(findAgentTool("product_status")!.run({ query: "존재하지않는제품xyz" }) as string).toContain("맞는 보안제품이 없습니다");
  });
});

describe("유지보수(maintenance) 역량", () => {
  it("maintenance 도메인에 등록돼 있다", () => {
    expect(listAgentTools().filter((t) => t.domain === "maintenance").map((t) => t.name)).toContain("maintenance_status");
  });

  it("일정이 없으면 없다고 답한다(빈 상태에서 깨지지 않는다)", () => {
    const out = findAgentTool("maintenance_status")!.run({}) as string;
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("리포트·컴플라이언스(report) 역량", () => {
  afterEach(() => resetComplianceForTests());

  it("report 도메인에 등록돼 있다", () => {
    expect(listAgentTools().filter((t) => t.domain === "report").map((t) => t.name)).toContain("compliance_status");
  });

  it("미대응·부분대응을 조치 필요로 묶어 보여준다", () => {
    const rows = listCompliance();
    expect(rows.length).toBeGreaterThan(0); // 기준 위협 목록이 시드돼 있다
    const out = findAgentTool("compliance_status")!.run({}) as string;
    expect(out).toContain("컴플라이언스");
    // 상태 코드가 아니라 한국어 라벨로 보여야 한다
    expect(out).not.toContain("covered ");
  });

  it("대응 완료로 바꾸면 조치 필요 목록에서 빠진다", () => {
    const first = listCompliance()[0];
    setComplianceStatus(first.code, "covered", "테스트");
    const out = findAgentTool("compliance_status")!.run({ filter: first.code }) as string;
    expect(out).toContain("미대응 항목이 없습니다");
  });
});

describe("지식(knowledge) 역량", () => {
  it("knowledge 도메인에 등록돼 있다", () => {
    expect(listAgentTools().filter((t) => t.domain === "knowledge").map((t) => t.name)).toContain("knowledge_status");
  });

  it("비동기 조회라도 문자열을 돌려준다", async () => {
    const out = await findAgentTool("knowledge_status")!.run({});
    expect(typeof out).toBe("string");
  });
});

describe("도메인 전반", () => {
  it("모든 도구의 domain이 정의된 축에 속한다(오타·미정의 방지)", () => {
    const valid = new Set<string>([...TOOL_DOMAINS, "cross"]);
    for (const t of listAgentTools()) {
      expect(valid.has(t.domain), `${t.name}의 domain="${t.domain}"`).toBe(true);
    }
  });

  it("6개 도메인에 최소 하나씩 역량이 있다 — 주인 없는 도메인을 없애는 게 B단계 목표였다", () => {
    for (const d of ["assets", "vuln", "sbom", "products", "maintenance", "report", "knowledge"]) {
      const has = listAgentTools().some((t) => t.domain === d);
      expect(has, `${d} 도메인에 역량 없음`).toBe(true);
    }
  });
});
