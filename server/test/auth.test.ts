import { describe, it, expect } from "vitest";
import * as jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAuthForTests } from "../src/auth/auth";

describe("auth", () => {
  const app = createApp();

  it("logs in with valid credentials and returns an access + refresh token pair", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.displayName).toBe("정요한");
  });

  it("rejects invalid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects protected routes without a token", async () => {
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed/tampered access token", async () => {
    const res = await request(app).get("/api/agents").set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });

  it("rejects an expired access token", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    const expired = jwt.sign({ sub: login.body.user.id }, "gijo-as-dev-secret-change-me", { expiresIn: -1 });
    const res = await request(app).get("/api/agents").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("allows protected routes with a valid access token", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });

    const res = await request(app).get("/api/agents").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(6); // Security Orchestrator·Scan·Analyze·Report·TI + GIJO Agent(id=normaltic, 그라운딩)
  });

  it("exchanges a refresh token for a new token pair and rotates the old refresh token out", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });

    const refreshRes = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).not.toBe(login.body.refreshToken);

    // reusing the now-rotated-out refresh token must fail
    const reuse = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it("rejects an unknown or missing refresh token", async () => {
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken: "not-a-real-refresh-token" });
    expect(res.status).toBe(401);
  });

  it("revokes the refresh token on logout (refresh no longer works after logout)", async () => {
    resetAuthForTests();
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });

    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ refreshToken: login.body.refreshToken });

    const refreshRes = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshRes.status).toBe(401);

    // access tokens are stateless JWTs by design (9.4절) — the still-unexpired access token
    // issued before logout keeps working until it naturally expires; only the refresh token
    // (which controls whether *new* access tokens can be minted) is revoked immediately.
    const stillWorks = await request(app).get("/api/agents").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(stillWorks.status).toBe(200);
  });

  it("blocks a second login for the same account while a session is already active", async () => {
    const first = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_logged_in");

    // 옛 세션은 여전히 살아 있다 — 차단됐을 뿐 대체되지 않았다.
    const refreshRes = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    expect(refreshRes.status).toBe(200);
  });

  it("force login revokes the old session and the old refresh token stops working", async () => {
    const first = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme", force: true });
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);

    const oldRefresh = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    expect(oldRefresh.status).toBe(409);
    expect(oldRefresh.body.error).toBe("session_superseded");

    const newRefresh = await request(app).post("/api/auth/refresh").send({ refreshToken: second.body.refreshToken });
    expect(newRefresh.status).toBe(200);
  });
});
