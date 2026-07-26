// 조치 검증 API — 보안 경계가 API 계층에서 실제로 막히는지 확인한다.
// (화면에서 버튼을 숨기는 것으로는 부족하다 — 여기가 뚫리면 우회된다.)
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1])),
  registerLlmRoutes: vi.fn(),
}));

const { createApp } = await import("../src/app");
const { registerAsset, recordFindings } = await import("../src/engine/assets");
const { resetUsersForTests, createUser, updateUserTeam, listUsers } = await import("../src/auth/users");
const { resetAuthForTests } = await import("../src/auth/auth");
const { resetApprovalsForTests } = await import("../src/engine/approvals");
const { createTarget, resetHardeningForTests } = await import("../src/engine/hardeningtargets");
const { db } = await import("../src/db");

type App = ReturnType<typeof createApp>;
async function login(app: App, u: string, p: string) {
  const r = await request(app).post("/api/auth/login").send({ username: u, password: p, force: true });
  return r.body as { accessToken: string };
}

const ASSET = "verify-web-01";
const FINDING = {
  finding_type: "OpenSSH < 9.6 (CVE-2024-6387)", severity: "high" as const,
  evidence: "포트 22", source_tool: "test", key: "k-ssh", state: "active" as const,
};

let app: App;
let adminTok = "";
beforeEach(async () => {
  resetUsersForTests();
  resetAuthForTests();
  resetApprovalsForTests();
  try { resetHardeningForTests(); } catch { db.prepare("DELETE FROM hardening_targets").run(); }
  app = createApp();
  adminTok = (await login(app, "jyh", "changeme")).accessToken;
  registerAsset({ id: ASSET, name: "웹서버-01", path: "/srv/web", assetType: "server", owner: "인프라운영팀" });
  recordFindings(ASSET, [FINDING]);
});

const auth = (r: request.Test, tok: string) => r.set("Authorization", `Bearer ${tok}`);

describe("GET /api/verify/can — 화면이 버튼 상태를 정하는 조회", () => {
  it("admin은 허용으로 나오고, 대상 등록 여부도 함께 알려준다", async () => {
    const res = await auth(request(app).get(`/api/verify/can/${ASSET}`), adminTok);
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.hasTarget).toBe(false); // 아직 대상 미등록
  });

  it("인증 없이는 401", async () => {
    const res = await request(app).get(`/api/verify/can/${ASSET}`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/verify/run — 실행", () => {
  it("권한 없는 담당자는 403 + 행동 가능한 사유", async () => {
    await auth(request(app).post("/api/users"), adminTok)
      .send({ username: "off1", password: "password123", displayName: "이보안", role: "security_officer" });
    const other = listUsers().find((u) => u.username === "off1")!;
    updateUserTeam(other.id, "보안관제팀"); // 자산은 인프라운영팀 소관
    const tok = (await login(app, "off1", "password123")).accessToken;

    const res = await auth(request(app).post("/api/verify/run"), tok).send({ assetId: ASSET });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("인프라운영팀");
    expect(res.body.error).toContain("요청");
  });

  it("거부도 감사에 남는다 — 권한 없는 시도 자체가 봐야 할 신호다", async () => {
    await auth(request(app).post("/api/users"), adminTok)
      .send({ username: "off2", password: "password123", displayName: "박담당", role: "security_officer" });
    const tok = (await login(app, "off2", "password123")).accessToken;
    await auth(request(app).post("/api/verify/run"), tok).send({ assetId: ASSET });

    const row = db.prepare("SELECT * FROM audit_log WHERE action = ? ORDER BY at DESC LIMIT 1").get("조치 검증 거부") as
      | { actor: string; target: string; result: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.actor).toBe("박담당");
    expect(row!.target).toBe(ASSET);
    expect(row!.result).toBe("blocked"); // 권한 차단은 error가 아니라 blocked(감사 어휘)
  });

  it("접속 대상이 없으면 실행을 거절한다 — '이상 없음'처럼 보이면 안 된다", async () => {
    const res = await auth(request(app).post("/api/verify/run"), adminTok).send({ assetId: ASSET });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("점검 대상이 등록돼 있지 않습니다");
  });

  it("assetId가 없으면 400", async () => {
    const res = await auth(request(app).post("/api/verify/run"), adminTok).send({});
    expect(res.status).toBe(400);
  });

  it("대상이 있으면 실행되고 결과·요약·감사가 남는다", async () => {
    // local 대상 — 실제 SSH 없이 호스트 명령으로 돈다(읽기 전용).
    const t = createTarget({ label: "웹서버-01", host: "local", port: 22, authMethod: "local", standard: "kisa" });
    expect(t.id).toBeTruthy();

    const res = await auth(request(app).post("/api/verify/run"), adminTok).send({ assetId: ASSET });
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(1);
    // 로컬에 openssh가 있든 없든, 판정은 PASS/FAIL/NA 중 하나로 결정적으로 나와야 한다.
    expect(["PASS", "FAIL", "NA"]).toContain(res.body.results[0].status);
    expect(res.body.results[0].findingKey).toBeTruthy();

    const row = db.prepare("SELECT * FROM audit_log WHERE action = ? ORDER BY at DESC LIMIT 1").get("조치 검증 실행") as
      | { detail: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.detail).toContain("조치확인");
  });
});
