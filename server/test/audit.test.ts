// 작업 기록(감사 로그) — 기록·조회·필터·요약 + 승인 실행/로그인 훅.
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { recordAudit, listAudit, auditSummary, resetAuditForTests, pruneAuditLog, startAuditPruneScheduler, stopAuditPruneScheduler } from "../src/engine/audit";
import { db } from "../src/db";
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

// ── 보관 기간 정책 ─────────────────────────────────────────────────────────
// 감사 로그를 지우는 코드는 **잘못 돌면 증거를 없앤다**. 그래서 경계를 못으로 박는다:
// ① 보관 기간이 안 지난 것은 절대 안 지운다 ② 0이면 아무것도 안 지운다
// ③ 지웠으면 그 사실이 감사에 남는다(조용히 줄어들면 사고인지 정책인지 알 수 없다).
describe("감사 로그 보관 기간 정리", () => {
  beforeEach(() => resetAuditForTests());

  // at을 직접 박아야 "오래된 기록"을 만들 수 있다 — recordAudit은 항상 지금 시각을 쓴다.
  function 과거기록(일전: number, action: string) {
    recordAudit({ kind: "block", action, result: "blocked" });
    const row = listAudit({ limit: 1 })[0];
    db.prepare("UPDATE audit_log SET at = ? WHERE id = ?").run(Date.now() - 일전 * 86400_000, row.id);
  }

  it("보관 기간이 지난 것만 지운다 — 기간 내 기록은 남는다", () => {
    과거기록(400, "아주 오래된 차단");
    과거기록(10, "최근 차단");
    const n = pruneAuditLog(365);
    expect(n).toBe(1);
    const 남은것 = listAudit({ kind: "block" }).map((e) => e.action);
    expect(남은것).toContain("최근 차단");
    expect(남은것).not.toContain("아주 오래된 차단");
  });

  it("경계에서 하루라도 덜 지난 기록은 안 지운다", () => {
    과거기록(364, "경계 직전");
    expect(pruneAuditLog(365)).toBe(0);
    expect(listAudit({ kind: "block" })).toHaveLength(1);
  });

  it("보관 0이면 아무것도 지우지 않는다 — 무제한 보관을 원하는 기관용", () => {
    과거기록(5000, "13년 된 기록");
    expect(pruneAuditLog(0)).toBe(0);
    expect(pruneAuditLog(-1)).toBe(0);
    expect(listAudit({ kind: "block" })).toHaveLength(1);
  });

  it("지웠으면 그 사실을 감사에 남긴다 — 몇 건인지까지", () => {
    과거기록(400, "오래된 것 1");
    과거기록(400, "오래된 것 2");
    pruneAuditLog(365);
    const 정리기록 = listAudit({ kind: "config" }).filter((e) => e.action.includes("보관 정리"));
    expect(정리기록).toHaveLength(1);
    expect(정리기록[0].action).toContain("2건");
    expect(정리기록[0].actor).toBe("system");
  });

  it("지울 게 없으면 기록도 남기지 않는다 — 매일 도는 정리가 로그를 채우면 본말전도", () => {
    과거기록(10, "최근 것");
    pruneAuditLog(365);
    expect(listAudit({ kind: "config" }).filter((e) => e.action.includes("보관 정리"))).toHaveLength(0);
  });

  it("스케줄러는 두 번 걸어도 타이머가 하나다", () => {
    startAuditPruneScheduler();
    startAuditPruneScheduler();
    stopAuditPruneScheduler(); // 하나만 걸렸다면 이 한 번으로 완전히 멈춘다
    stopAuditPruneScheduler(); // 두 번 멈춰도 터지지 않는다
  });
});
