import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetUsageForTests } from "../src/engine/usage";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("usage tracking", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetUsageForTests();
    app = createApp();
    token = await login(app);
  });

  it("starts with no tracked usage", async () => {
    const res = await request(app).get("/api/usage/summary").set("Authorization", `Bearer ${token}`);
    expect(res.body).toEqual([]);
  });

  it("logs CTI calls and accumulates estimated cost", async () => {
    await request(app).get("/api/cti/findings").set("Authorization", `Bearer ${token}`);
    await request(app).get("/api/cti/findings").set("Authorization", `Bearer ${token}`);

    const res = await request(app).get("/api/usage/summary").set("Authorization", `Bearer ${token}`);
    expect(res.body).toEqual([{ service: "cti", callCount: 2, estimatedCost: 0.1 }]);
  });
});
