// 작업 기록(감사 로그) — 기록·조회·필터·요약 + 승인 실행/로그인 훅.
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { recordAudit, listAudit, auditSummary, resetAuditForTests } from "../src/engine/audit";
import { resetAssetsForTests, registerAsset, getAsset } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>, password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password });
  return res.body.accessToken as string;
}

describe("작업 기록(감사 로그)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app); // 로그인 자체가 auth 기록 1건을 남긴다(동기)
  });

  it("recordAudit로 남기고 최신순으로 조회한다", () => {
    resetAuditForTests();
    recordAudit({ kind: "cli", actor: "jyh", action: "nmap 실행", target: "10.0.0.5", result: "ok" });
    recordAudit({ kind: "block", actor: "jyh", action: "위험 명령 차단", target: "rm -rf", result: "blocked" });
    const all = listAudit();
    expect(all.length).toBe(2);
    expect(all[0].action).toBe("위험 명령 차단"); // 최신이 먼저
    expect(all[0].result).toBe("blocked");
  });

  it("kind로 필터링한다", () => {
    resetAuditForTests();
    recordAudit({ kind: "cli", action: "a" });
    recordAudit({ kind: "write", action: "b" });
    recordAudit({ kind: "cli", action: "c" });
    expect(listAudit({ kind: "cli" }).length).toBe(2);
    expect(listAudit({ kind: "write" }).length).toBe(1);
  });

  it("요약이 종류별 건수를 센다", () => {
    resetAuditForTests();
    recordAudit({ kind: "auth", action: "로그인" });
    recordAudit({ kind: "write", action: "x" });
    recordAudit({ kind: "write", action: "y" });
    const s = auditSummary();
    expect(s.total).toBe(3);
    expect(s.byKind.write).toBe(2);
    expect(s.byKind.auth).toBe(1);
  });

  it("detail은 4000자로 잘라 저장한다", () => {
    resetAuditForTests();
    recordAudit({ kind: "cli", action: "long", detail: "x".repeat(5000) });
    expect(listAudit()[0].detail!.length).toBe(4000);
  });

  it("GET /api/audit — entries + summary 반환, kind 필터", async () => {
    recordAudit({ kind: "cli", action: "명령1" });
    recordAudit({ kind: "auth", action: "로그인" });
    const res = await request(app).get("/api/audit").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBeGreaterThanOrEqual(2);
    const cli = await request(app).get("/api/audit?kind=cli").set("Authorization", `Bearer ${token}`);
    expect(cli.body.entries.every((e: { kind: string }) => e.kind === "cli")).toBe(true);
  });

  it("인증 없이는 조회할 수 없다", async () => {
    const res = await request(app).get("/api/audit");
    expect(res.status).toBe(401);
  });

  it("로그인 성공이 auth 기록으로 남는다", async () => {
    await login(app); // 이 테스트 안에서 새로 로그인 → auth 기록이 생겨야 한다
    const auth = listAudit({ kind: "auth" });
    expect(auth.length).toBeGreaterThanOrEqual(1);
    expect(auth[0].action).toContain("로그인");
    expect(auth[0].actor).toBe("정요한");
  });

  it("승인 실행(POST /api/agent/approve)이 write 기록으로 남는다", async () => {
    const res = await request(app)
      .post("/api/agent/approve")
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "register_asset", args: { name: "감사테스트봇", path: "m.gguf" }, instruction: "감사테스트봇 등록" });
    expect(res.status).toBe(200);
    const writes = listAudit({ kind: "write" });
    expect(writes.some((e) => e.action.includes("register_asset"))).toBe(true);
    expect(getAsset("감사테스트봇-01")).toBeDefined();
  });
});
