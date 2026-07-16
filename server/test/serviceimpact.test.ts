import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { computeServiceImpact } from "../src/engine/serviceimpact";
import { emptyAiBom, type Asset } from "../src/engine/assets";
import type { StandardFinding } from "../src/engine/bridge";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

function asset(over: Partial<Asset>): Asset {
  return {
    id: "a", name: "asset", path: "p", assetType: "t", owner: "-", service: null,
    components: [], findings: [], scanHistory: [], aibom: emptyAiBom(),
    registeredAt: 0, lastScannedAt: null, sbomGeneratedAt: null, ...over,
  };
}
const finding = (severity: StandardFinding["severity"]): StandardFinding => ({
  finding_type: "x", severity, evidence: "e", source_tool: "modelscan",
});

describe("serviceimpact (서비스 영향도)", () => {
  it("groups assets by service and rolls up impact from findings, CTI, and overdue inspections", () => {
    const assets = [
      asset({ id: "a1", service: "웹서비스", findings: [finding("high")] }), // 고위험
      asset({ id: "a2", service: "웹서비스" }), // CTI 매칭(아래)
      asset({ id: "a3", service: "결제", findings: [finding("medium")] }), // 중위험
      asset({ id: "a4", service: null }), // 미지정
    ];
    const cti = new Set(["a2"]);
    const overdue = new Map([["a1", 2]]);
    const { services, summary } = computeServiceImpact(assets, cti, overdue);

    const web = services.find((s) => s.service === "웹서비스")!;
    expect(web.assetCount).toBe(2);
    expect(web.highRiskAssets).toBe(1);
    expect(web.ctiAffectedAssets).toBe(1);
    expect(web.overdueInspections).toBe(2);
    expect(web.impactLevel).toBe("high");

    const pay = services.find((s) => s.service === "결제")!;
    expect(pay.impactLevel).toBe("mid"); // medium finding만

    const un = services.find((s) => s.service === "미지정")!;
    expect(un.impactLevel).toBe("none");

    expect(summary.totalServices).toBe(3);
    expect(summary.atRisk).toBe(1); // 웹서비스만 high
    expect(summary.unassignedAssets).toBe(1);
    // 영향도 높은 서비스가 먼저 온다
    expect(services[0].service).toBe("웹서비스");
  });

  it("a low-severity-only service is low, an empty-finding service is none", () => {
    const { services } = computeServiceImpact(
      [asset({ id: "x", service: "S1", findings: [finding("low")] }), asset({ id: "y", service: "S2" })],
      new Set(),
      new Map()
    );
    expect(services.find((s) => s.service === "S1")!.impactLevel).toBe("low");
    expect(services.find((s) => s.service === "S2")!.impactLevel).toBe("none");
  });

  it("GET /api/service-impact returns the seeded services (all CTI-affected → high) and requires auth", async () => {
    const app = createApp();
    const token = await login(app);
    const res = await request(app).get("/api/service-impact").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = res.body.services.map((s: { service: string }) => s.service);
    // 시드 자산 3종의 서비스
    expect(names).toContain("임직원 보안 포털");
    expect(names).toContain("문서관리 시스템");
    expect(names).toContain("SOC 관제 플랫폼");
    // 시드 CTI가 세 자산 모두 매칭하므로 세 서비스 다 high, atRisk 3
    expect(res.body.summary.atRisk).toBe(3);
    expect((await request(app).get("/api/service-impact")).status).toBe(401);
  });
});
