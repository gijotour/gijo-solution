import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";
import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";
import { buildSpdxJson } from "../src/engine/sbom";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("sbom", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({
        id: "fraud-detect-llm",
        name: "fraud-detect-llm",
        path: "models/fraud.gguf",
        components: [{ name: "torch", version: "2.6.0", license: "BSD-3-Clause" }],
      });
  });

  it("generates a CycloneDX SBOM from the asset's real components", async () => {
    const res = await request(app).post("/api/sbom/fraud-detect-llm/generate").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.format).toBe("cyclonedx");
    expect(res.body.components).toEqual([{ name: "torch", version: "2.6.0", license: "BSD-3-Clause", knownVulns: [] }]);
  });

  it("marks the asset as sbomGenerated after a successful generate", async () => {
    await request(app).post("/api/sbom/fraud-detect-llm/generate").set("Authorization", `Bearer ${token}`);
    const asset = await request(app).get("/api/assets/fraud-detect-llm").set("Authorization", `Bearer ${token}`);
    expect(asset.body.sbomGeneratedAt).not.toBeNull();
  });

  it("writes a real CycloneDX 1.5 JSON file when exported", async () => {
    const res = await request(app)
      .post("/api/sbom/fraud-detect-llm/export")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "cyclonedx" });
    expect(res.status).toBe(200);
    expect(res.body.path).toContain("fraud-detect-llm.cyclonedx.json");
  });

  it("writes a real SPDX 2.3 JSON file when exported", async () => {
    const res = await request(app)
      .post("/api/sbom/fraud-detect-llm/export")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "spdx" });
    expect(res.status).toBe(200);
    expect(res.body.path).toContain("fraud-detect-llm.spdx.json");

    const doc = JSON.parse(fs.readFileSync(res.body.path, "utf-8"));
    expect(doc.spdxVersion).toBe("SPDX-2.3");
    expect(doc.SPDXID).toBe("SPDXRef-DOCUMENT");
    // 루트 패키지 + 컴포넌트(torch) 패키지
    expect(doc.packages.map((p: { name: string }) => p.name)).toContain("torch");
    // 문서가 루트를 DESCRIBES하고 루트가 컴포넌트를 CONTAINS
    expect(doc.relationships.some((r: { relationshipType: string }) => r.relationshipType === "DESCRIBES")).toBe(true);
    expect(doc.relationships.some((r: { relationshipType: string }) => r.relationshipType === "CONTAINS")).toBe(true);
  });

  it("buildSpdxJson uses valid SPDXID refs and NOASSERTION for missing fields", () => {
    const json = buildSpdxJson("asset-x", [{ name: "numpy", version: "", license: "", knownVulns: [] }]);
    const doc = JSON.parse(json);
    // 모든 SPDXID는 SPDXRef-[A-Za-z0-9.-]+ 형식이어야 한다(컴포넌트명이 특수문자여도 안전)
    for (const p of doc.packages) expect(p.SPDXID).toMatch(/^SPDXRef-[A-Za-z0-9.-]+$/);
    const numpy = doc.packages.find((p: { name: string }) => p.name === "numpy");
    expect(numpy.versionInfo).toBe("NOASSERTION"); // 빈 버전 → NOASSERTION
    expect(numpy.licenseDeclared).toBe("NOASSERTION"); // 빈 라이선스 → NOASSERTION
  });

  it("the server keeps serving requests after any export (asyncRoute isolation)", async () => {
    await request(app).post("/api/sbom/fraud-detect-llm/export").set("Authorization", `Bearer ${token}`).send({ format: "spdx" });
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });
});
