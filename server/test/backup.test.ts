// DB 백업(운영) — 관리자 전용, 온라인 백업 스냅샷.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";

const TMP = path.join("data", "backups-test");
process.env.GIJO_BACKUP_DIR = TMP; // 라우트가 요청 시점에 읽으므로 여기서 지정하면 적용됨

import { createApp } from "../src/app";

const app = createApp();
let token = "";
beforeAll(async () => {
  token = (await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" })).body.accessToken;
});
afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("DB 백업", () => {
  it("인증 없이는 401", async () => {
    expect((await request(app).post("/api/admin/backup")).status).toBe(401);
    expect((await request(app).get("/api/admin/backups")).status).toBe(401);
  });

  it("관리자가 백업을 만들고 목록에 나타난다", async () => {
    const r = await request(app).post("/api/admin/backup").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.sizeBytes).toBeGreaterThan(0);
    expect(fs.existsSync(r.body.path)).toBe(true);
    const list = await request(app).get("/api/admin/backups").set("Authorization", `Bearer ${token}`);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body[0].file).toMatch(/\.sqlite$/);
  });
});
