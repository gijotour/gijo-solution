import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("assets", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("registers an asset with defaults for optional fields", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "doc-classifier", name: "doc-classifier", path: "models/doc.gguf" });

    expect(res.status).toBe(200);
    expect(res.body.assetType).toBe("기타");
    expect(res.body.owner).toBe("-");
    expect(res.body.findings).toEqual([]);
    expect(res.body.lastScannedAt).toBeNull();
    expect(res.body.sbomGeneratedAt).toBeNull();
  });

  it("lists registered assets", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a2", name: "a2", path: "x" });

    const res = await request(app).get("/api/assets").set("Authorization", `Bearer ${token}`);
    expect(res.body.map((a: { id: string }) => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("returns 404 for an asset that was never registered", async () => {
    const res = await request(app).get("/api/assets/never-registered").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("re-registering the same id resets its findings/scan state", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });
    await request(app).post("/api/dispatch").set("Authorization", `Bearer ${token}`).send({ text: "a1 스캔해줘" });

    const before = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(before.body.findings.length).toBeGreaterThan(0);

    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });
    const after = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(after.body.findings).toEqual([]);
  });
});
