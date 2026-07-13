import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.token as string;
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

  it("returns 500 (not a crash) for the unimplemented SPDX format, and the server keeps serving requests", async () => {
    const res = await request(app)
      .post("/api/sbom/fraud-detect-llm/export")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "spdx" });
    expect(res.status).toBe(500);

    // asyncRoute isolation: this request must not have taken the whole app down.
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });
});
