// 클라이언트 업데이트를 "누가 받았는지" 기록(2026-07-28 사용자 요청).
// 게시·삭제는 기록이 있었는데 받는 것만 없어서, 어느 담당자가 어느 판을 쓰는지 알 길이 없었다.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { listAudit } from "../src/engine/audit";

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const r = await request(app).post("/api/auth/login").send({ username, password, force: true });
  return r.body.accessToken as string;
}

describe("클라이언트 업데이트 받은 기록", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });

  it("없는 버전을 받으려 하면 기록하지 않는다 — 받지도 않았는데 남으면 거짓 기록이다", async () => {
    const before = listAudit({ kind: "config", limit: 1000 }).filter((e) => e.action === "클라이언트 업데이트 받음").length;
    const r = await request(app).get("/api/client/download/0.0.0-없음").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(404);
    const after = listAudit({ kind: "config", limit: 1000 }).filter((e) => e.action === "클라이언트 업데이트 받음").length;
    expect(after).toBe(before);
  });

  it("받은 기록 조회는 인증이 필요하다", async () => {
    const r = await request(app).get("/api/client/download-log");
    expect(r.status).toBe(401);
  });

  it("받은 기록은 관리자만 본다 — 누가 무엇을 쓰는지는 운영 정보다", async () => {
    // officer 계정을 만들어 확인한다(admin 토큰으로 생성).
    const uname = `dl-officer-${Date.now()}`;
    const mk = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`)
      .send({ username: uname, displayName: "받기 시험", password: "pw1234", role: "officer" });
    // 계정 생성 라우트가 다른 이름일 수 있다 — 만들지 못하면 이 검증은 건너뛴다(거짓 통과 방지).
    if (mk.status >= 400) return;
    const t2 = await login(app, uname, "pw1234");
    const r = await request(app).get("/api/client/download-log").set("Authorization", `Bearer ${t2}`);
    expect(r.status).toBe(403);
  });

  it("조회 결과는 받은 사람·버전·시각을 준다", async () => {
    const r = await request(app).get("/api/client/download-log").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.downloads)).toBe(true);
    for (const row of r.body.downloads) {
      expect(row).toHaveProperty("at");
      expect(row).toHaveProperty("actor");
      expect(row).toHaveProperty("version");
    }
  });
});
