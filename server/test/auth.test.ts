import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("auth", () => {
  const app = createApp();

  it("logs in with valid credentials and returns a bearer token", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
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

  it("allows protected routes with a valid token", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    const token = login.body.token;

    const res = await request(app).get("/api/agents").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(8);
  });

  it("rejects a token after logout", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    const token = login.body.token;

    await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    const res = await request(app).get("/api/agents").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
