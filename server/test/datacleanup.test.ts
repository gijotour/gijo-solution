// 데이터 정리(admin) — 화이트리스트·감사 흐름 검증. 실 삭제는 테스트 DB에서 이뤄진다.
import { describe, expect, it, vi, beforeAll } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { db } from "../src/db";

let app: ReturnType<typeof createApp>;
let token = "";
beforeAll(async () => {
  app = createApp();
  const r = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  token = r.body.accessToken;
});

describe("POST /api/admin/data-cleanup", () => {
  it("targets 없으면 400 + 지원 목록 안내", async () => {
    const r = await request(app).post("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("cti_findings");
  });

  it("화이트리스트 밖 대상은 무시된다(임의 테이블 삭제 불가)", async () => {
    const r = await request(app).post("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`).send({ targets: ["users", "assets"] });
    expect(r.status).toBe(400); // 유효 대상이 하나도 없음
  });

  it("cti_findings·analysis_events를 지우고 건수를 돌려준다 + 감사 기록", async () => {
    db.prepare("INSERT INTO cti_findings (id, feedId, detectedAt, type, target, source, severity, collectedAt) VALUES ('t1','f1','2026-01-01','vuln','test','unit','high',1)").run();
    const r = await request(app).post("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`).send({ targets: ["cti_findings", "analysis_events"] });
    expect(r.status).toBe(200);
    const cti = r.body.results.find((x: { id: string }) => x.id === "cti_findings");
    expect(cti.deleted).toBeGreaterThanOrEqual(1);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action LIKE '%데이터 정리%' ORDER BY rowid DESC LIMIT 1").get() as { detail: string };
    expect(audit.detail).toContain("삭제");
  });

  it("GET은 대상·현재 건수를 보여준다", async () => {
    const r = await request(app).get("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.targets.map((t: { id: string }) => t.id)).toContain("analysis_events");
  });
});
