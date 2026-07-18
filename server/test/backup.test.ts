// DB 백업(운영) — 관리자 전용, 온라인 백업 스냅샷.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";

const TMP = path.join("data", "backups-test");
process.env.GIJO_BACKUP_DIR = TMP; // 라우트가 요청 시점에 읽으므로 여기서 지정하면 적용됨

// 장기 기억(LanceDB)도 같이 백업되는지 검증하기 위한 가짜 소스 — 실제 LanceDB 포맷일 필요 없이
// "디렉터리를 통째로 복사하는지"만 확인하면 된다.
const LANCE_SRC = path.join("data", "lancedb-backup-test-src");
process.env.GIJO_MEMORY_DB_PATH = LANCE_SRC;
fs.mkdirSync(LANCE_SRC, { recursive: true });
fs.writeFileSync(path.join(LANCE_SRC, "documents.lance"), "fake-vector-data");

import { createApp } from "../src/app";

const app = createApp();
let token = "";
beforeAll(async () => {
  token = (await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" })).body.accessToken;
});
afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(LANCE_SRC, { recursive: true, force: true });
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

  // 재해복구 시 지식베이스(RAG)까지 살아있어야 한다 — SQLite만 백업하고 LanceDB를 빠뜨리면
  // 복구 후 "올린 문서"가 전부 사라진다(2026-07-19 발견한 갭).
  it("장기 기억(LanceDB) 디렉터리도 같은 스냅샷으로 함께 백업된다", async () => {
    const r = await request(app).post("/api/admin/backup").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.lanceIncluded).toBe(true);
    expect(r.body.lanceFile).toMatch(/\.lancedb$/);
    expect(r.body.lanceSizeBytes).toBeGreaterThan(0);
    const lancePath = path.join(TMP, r.body.lanceFile);
    expect(fs.existsSync(lancePath)).toBe(true);
    expect(fs.readFileSync(path.join(lancePath, "documents.lance"), "utf-8")).toBe("fake-vector-data");

    const list = await request(app).get("/api/admin/backups").set("Authorization", `Bearer ${token}`);
    const entry = list.body.find((x: { file: string }) => x.file === r.body.file);
    expect(entry.lanceFile).toBe(r.body.lanceFile);
    expect(entry.lanceSizeBytes).toBeGreaterThan(0);
  });
});
