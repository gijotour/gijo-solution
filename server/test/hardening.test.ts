// 제품 자체 보안 하드닝 — 보안 헤더·로그인 브루트포스 방어·비밀번호 정책·스키마 버전.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAuthForTests } from "../src/auth/auth";
import { resetUsersForTests, validatePassword } from "../src/auth/users";

const app = createApp();
beforeEach(() => {
  resetUsersForTests();
  resetAuthForTests();
});

describe("보안 하드닝", () => {
  it("보안 응답 헤더가 붙고 x-powered-by는 숨겨진다", async () => {
    const r = await request(app).get("/api/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });

  it("헬스에 스키마 버전이 노출된다(업그레이드 추적)", async () => {
    const r = await request(app).get("/api/health");
    expect(r.body.schema.count).toBeGreaterThan(0);
    expect(r.body.schema.latest).toBeTruthy();
  });

  it("로그인 실패가 임계(10) 초과하면 429로 잠긴다", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post("/api/auth/login").send({ username: "jyh", password: "wrong-pass" });
      expect(r.status).toBe(401);
    }
    const locked = await request(app).post("/api/auth/login").send({ username: "jyh", password: "wrong-pass" });
    expect(locked.status).toBe(429);
    // 잠금 중엔 올바른 비번도 막힌다.
    const stillLocked = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(stillLocked.status).toBe(429);
  });

  it("성공 로그인은 실패 카운터를 초기화한다", async () => {
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").send({ username: "jyh", password: "wrong-pass" });
    const ok = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(ok.status).toBe(200);
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").send({ username: "jyh", password: "wrong-pass" });
    const stillOk = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme", force: true });
    expect(stillOk.status).toBe(200); // 초기화됐으므로 아직 잠기지 않음(force: 직전 ok 로그인 세션이 이미 살아있어 중복로그인 방지에 걸리므로)
  });

  it("비밀번호 정책: 8자 미만 거부", () => {
    expect(() => validatePassword("short")).toThrow();
    expect(() => validatePassword("longenough1")).not.toThrow();
  });
});
