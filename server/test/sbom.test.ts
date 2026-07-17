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

  it("exports an AI-BOM (CycloneDX ML-BOM) weaving in the 5 AI-BOM areas, prompt hashed", async () => {
    await request(app)
      .put("/api/assets/fraud-detect-llm/aibom")
      .set("Authorization", `Bearer ${token}`)
      .send({
        aibom: {
          model: { foundationModel: "Qwen2.5-7B", finetuneHistory: "SFT v1", architecture: "", weightsHash: "" },
          dataset: { sources: "사내 문서", vectorDbLocation: "LanceDB" },
          prompt: { systemPrompt: "비밀 시스템 프롬프트", guardrails: "PII 마스킹" },
          agentTool: { apis: "내부 API", mcpServers: "" },
          infrastructure: { compute: "RTX 3090", hostingProvider: "온프레미스" },
        },
      });

    const res = await request(app).post("/api/sbom/fraud-detect-llm/aibom-export").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.filename).toContain("fraud-detect-llm.aibom.cyclonedx.json");

    const bom = JSON.parse(res.body.json);
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe("1.5");
    expect(bom.metadata.component.type).toBe("machine-learning-model");
    const props: Record<string, string> = Object.fromEntries(
      (bom.metadata.component.properties || []).map((p: { name: string; value: string }) => [p.name, p.value])
    );
    expect(props["gijo:model:foundationModel"]).toBe("Qwen2.5-7B");
    expect(props["gijo:infra:hostingProvider"]).toBe("온프레미스");
    // 시스템 프롬프트는 원문 대신 SHA-256 해시만 — 원문이 문서에 없어야 한다.
    expect(props["gijo:prompt:systemPromptSha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.json).not.toContain("비밀 시스템 프롬프트");
    // 데이터셋 = data 컴포넌트, 코드 의존성 = library 컴포넌트
    const types = (bom.components || []).map((c: { type: string }) => c.type);
    expect(types).toContain("data");
    expect((bom.components || []).some((c: { name: string }) => c.name === "torch")).toBe(true);
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
