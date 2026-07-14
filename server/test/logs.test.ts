import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { recordLog, resetLogsForTests } from "../src/engine/logs";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("logs", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetLogsForTests();
    app = createApp();
    token = await login(app);
  });

  it("returns recorded log entries, most recent last", async () => {
    recordLog("log", "서버 기동");
    recordLog("error", "스캔 실패:", { assetId: "a1" });

    const res = await request(app).get("/api/logs").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ level: "log", message: "서버 기동" });
    expect(res.body[1]).toMatchObject({ level: "error", message: '스캔 실패: {"assetId":"a1"}' });
    expect(res.body[0].timestamp).toBeTypeOf("number");
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/logs");
    expect(res.status).toBe(401);
  });
});
