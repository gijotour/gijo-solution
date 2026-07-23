import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetUsersForTests } from "../src/auth/users";
import { resetAuthForTests } from "../src/auth/auth";

async function login(app: ReturnType<typeof createApp>, u = "jyh", p = "changeme") {
  const r = await request(app).post("/api/auth/login").send({ username: u, password: p, force: true });
  return r.body as { accessToken: string; refreshToken: string; user: { id: string } };
}

describe("사용자·세션 관리 (admin)", () => {
  let app: ReturnType<typeof createApp>;
  let admin: Awaited<ReturnType<typeof login>>;
  beforeEach(async () => {
    resetUsersForTests();
    resetAuthForTests();
    app = createApp();
    admin = await login(app);
  });
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${admin.accessToken}`);

  it("접속 세션 목록을 admin이 조회", async () => {
    const res = await auth(request(app).get("/api/users/sessions"));
    expect(res.status).toBe(200);
    expect(res.body.some((s: { userId: string }) => s.userId === admin.user.id)).toBe(true);
  });

  it("역할 변경 — 담당자 계정을 admin으로", async () => {
    const created = await auth(request(app).post("/api/users").send({ username: "officer1", password: "password123", displayName: "김담당", role: "security_officer" }));
    const id = created.body.id;
    const res = await auth(request(app).post(`/api/users/${id}/role`).send({ role: "admin" }));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
  });

  it("마지막 관리자 강등은 거부", async () => {
    const res = await auth(request(app).post(`/api/users/${admin.user.id}/role`).send({ role: "security_officer" }));
    expect(res.status).toBe(400);
  });

  it("세션 강제 종료 후 그 세션 refresh는 거부(session_superseded/idle 아님, 세션 없음)", async () => {
    const officer = await (async () => {
      await auth(request(app).post("/api/users").send({ username: "off2", password: "password123", displayName: "이담당", role: "security_officer" }));
      return login(app, "off2", "password123");
    })();
    // admin이 off2 세션 강제 종료
    const t = await auth(request(app).post(`/api/users/${officer.user.id}/terminate-session`));
    expect(t.body.terminated).toBe(true);
    // off2의 refresh는 이제 무효
    const rf = await request(app).post("/api/auth/refresh").send({ refreshToken: officer.refreshToken });
    expect(rf.status).toBeGreaterThanOrEqual(400);
  });

  it("관리자 비번 초기화 시 대상 세션이 끊긴다", async () => {
    await auth(request(app).post("/api/users").send({ username: "off3", password: "password123", displayName: "박담당", role: "security_officer" }));
    const off3 = await login(app, "off3", "password123");
    await auth(request(app).post(`/api/users/${off3.user.id}/password`).send({ password: "newpassword9" }));
    const rf = await request(app).post("/api/auth/refresh").send({ refreshToken: off3.refreshToken });
    expect(rf.status).toBeGreaterThanOrEqual(400);
  });
});

import { isIdleExpired, idleTimeoutMs } from "../src/auth/auth";
describe("유휴 타임아웃 판정", () => {
  it("방금 활동한 세션은 유휴 아님", () => {
    expect(isIdleExpired(Date.now())).toBe(false);
  });
  it("기본 타임아웃(30분)보다 오래 방치되면 유휴로 만료", () => {
    const old = Date.now() - (idleTimeoutMs() + 60_000);
    expect(isIdleExpired(old)).toBe(idleTimeoutMs() > 0);
  });
});
