import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetFeedsForTests } from "../src/engine/cti";

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

  it("returns 404 for an unknown feed id", async () => {
    const res = await request(app)
      .post("/api/cti/feeds/nonexistent/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "x" });
    expect(res.status).toBe(404);
  });
});
