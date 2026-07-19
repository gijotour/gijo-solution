import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetFeedsForTests, configureFeed, getDecryptedApiKey } from "../src/engine/cti";
import { db } from "../src/db";

async function login(app: ReturnType<typeof createApp>, force = false) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "jyh", password: "changeme", ...(force ? { force: true } : {}) });
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

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("lists planned feeds (KISA C-TAS) flagged as planned, never connected", async () => {
    const res = await request(app).get("/api/cti/feeds").set("Authorization", `Bearer ${token}`);
    const planned = res.body.filter((f: { planned?: boolean }) => f.planned);
    expect(planned.map((f: { id: string }) => f.id)).toEqual(["kisa-ctas"]);
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

  it("otx findings flow: fetches subscribed pulses, maps them, caches them (no refetch within the sync window)", async () => {
    const otxResponse = {
      results: [
        {
          id: "abc123",
          name: "Ransomware campaign targeting K8s clusters",
          created: "2026-07-13T10:36:53.340000",
          modified: "2026-07-15T12:16:30.051000",
          adversary: "codemado",
        },
        { id: "def456", name: "Generic phishing kit IOCs", created: "2026-07-14T01:00:00.000000" },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => otxResponse });
    vi.stubGlobal("fetch", fetchMock);

    await request(app)
      .post("/api/cti/feeds/levelblue-otx/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "otx-test-key" });

    const res = await request(app).get("/api/cti/findings").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // modified 우선, 최신순 정렬
    expect(res.body[0]).toMatchObject({
      id: "otx-abc123",
      detectedAt: "2026-07-15 12:16",
      type: "위협 캠페인 · codemado",
      target: "Ransomware campaign targeting K8s clusters",
      source: "LevelBlue OTX",
      severity: "info",
    });
    expect(res.body[1]).toMatchObject({ id: "otx-def456", type: "위협 인텔 Pulse", detectedAt: "2026-07-14 01:00" });
    // 키가 요청 헤더로만 나가고 응답에는 없다
    expect(fetchMock.mock.calls[0][1].headers["X-OTX-API-KEY"]).toBe("otx-test-key");
    expect(JSON.stringify(res.body)).not.toContain("otx-test-key");

    // 30분 게이트: 두 번째 조회는 캐시에서 — fetch가 다시 불리지 않는다
    const res2 = await request(app).get("/api/cti/findings").set("Authorization", `Bearer ${token}`);
    expect(res2.body).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves cached findings when the vendor API is down (light circuit breaker)", async () => {
    const good = {
      results: [{ id: "p1", name: "Cached pulse", modified: "2026-07-15T00:00:00" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => good });
    vi.stubGlobal("fetch", fetchMock);

    await request(app)
      .post("/api/cti/feeds/levelblue-otx/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "otx-test-key" });
    await request(app).get("/api/cti/findings").set("Authorization", `Bearer ${token}`);

    // 동기화 시각을 과거로 밀어 강제 재동기화 유도 + 이번엔 API 장애
    db.prepare("UPDATE cti_sync SET lastFetchAt = 0 WHERE feedId = 'levelblue-otx'").run();
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await request(app).get("/api/cti/findings").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].target).toBe("Cached pulse");
    // 실패가 기록된다
    const sync = db.prepare("SELECT lastError FROM cti_sync WHERE feedId = 'levelblue-otx'").get() as {
      lastError: string;
    };
    expect(sync.lastError).toContain("ECONNREFUSED");
  });

  it("configured feeds survive a fresh module state (regression: used to be a plain in-memory array)", async () => {
    await request(app)
      .post("/api/cti/feeds/flashpoint/configure")
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "fp-key-123" });

    // a second createApp() call proves the state lives in db.ts, not in a per-app-instance variable
    const secondApp = createApp();
    const secondToken = await login(secondApp, true); // 같은 계정으로 두 번째 로그인 — 중복로그인 방지를 강제로 우회
    const res = await request(secondApp).get("/api/cti/feeds").set("Authorization", `Bearer ${secondToken}`);
    const flashpoint = res.body.find((f: { id: string }) => f.id === "flashpoint");
    expect(flashpoint.hasApiKey).toBe(true);
  });
});
