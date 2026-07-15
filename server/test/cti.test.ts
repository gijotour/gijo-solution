import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetFeedsForTests, configureFeed, getDecryptedApiKey } from "../src/engine/cti";
import { db } from "../src/db";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("cti feed key management", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetFeedsForTests();
    app = createApp();
    token = await login(app);
  });

  it("never returns the raw api key, only whether one is set", async () => {
    const res = await request(app).get("/api/cti/feeds").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const feed of res.body) {
      expect(feed).not.toHaveProperty("apiKey");
      expect(feed.hasApiKey).toBe(false);
      expect(feed.connected).toBe(false);
    }
  });

  it("configuring a feed marks it connected without leaking the key back", async () => {
    const res = await request(app)
      .post("/api/cti/feeds/criminalip/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "sk-super-secret" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("apiKey");
    expect(res.body.hasApiKey).toBe(true);
    expect(res.body.connected).toBe(true);
  });

  it("disconnecting clears the key and connected state", async () => {
    await request(app)
      .post("/api/cti/feeds/criminalip/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "sk-super-secret" });

    const res = await request(app).post("/api/cti/feeds/criminalip/disconnect").set("Authorization", `Bearer ${token}`);
    expect(res.body.hasApiKey).toBe(false);
    expect(res.body.connected).toBe(false);
  });

  it("lists planned feeds (KISA C-TAS, LevelBlue OTX) flagged as planned, never connected", async () => {
    const res = await request(app).get("/api/cti/feeds").set("Authorization", `Bearer ${token}`);
    const planned = res.body.filter((f: { planned?: boolean }) => f.planned);
    expect(planned.map((f: { id: string }) => f.id).sort()).toEqual(["kisa-ctas", "levelblue-otx"]);
    for (const feed of planned) {
      expect(feed.hasApiKey).toBe(false);
      expect(feed.connected).toBe(false);
    }
    // 실동작 피드에는 planned 플래그가 붙지 않는다
    const real = res.body.filter((f: { planned?: boolean }) => !f.planned);
    expect(real.length).toBeGreaterThan(0);
  });

  it("rejects configuring a planned feed with 400", async () => {
    const res = await request(app)
      .post("/api/cti/feeds/kisa-ctas/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "should-not-be-accepted" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("지원 예정");
  });

  it("returns 404 for an unknown feed id", async () => {
    const res = await request(app)
      .post("/api/cti/feeds/nonexistent/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "x" });
    expect(res.status).toBe(404);
  });

  it("the api key is stored encrypted at rest, not in plaintext, but decrypts back to the original", () => {
    configureFeed("criminalip", "sk-super-secret");

    const row = db.prepare("SELECT encryptedApiKey FROM cti_feeds WHERE id = ?").get("criminalip") as {
      encryptedApiKey: string;
    };
    expect(row.encryptedApiKey).not.toContain("sk-super-secret");

    expect(getDecryptedApiKey("criminalip")).toBe("sk-super-secret");
  });

  it("configured feeds survive a fresh module state (regression: used to be a plain in-memory array)", async () => {
    await request(app)
      .post("/api/cti/feeds/flashpoint/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "fp-key-123" });

    // a second createApp() call proves the state lives in db.ts, not in a per-app-instance variable
    const secondApp = createApp();
    const secondToken = await login(secondApp);
    const res = await request(secondApp).get("/api/cti/feeds").set("Authorization", `Bearer ${secondToken}`);
    const flashpoint = res.body.find((f: { id: string }) => f.id === "flashpoint");
    expect(flashpoint.hasApiKey).toBe(true);
  });
});
