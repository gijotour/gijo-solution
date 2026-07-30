// 저장 암호화 상태·복구 열쇠 API — 권한 경계와 정직한 범위 표기를 확인한다.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { dbCryptStatus } from "../src/engine/dbcrypt";

async function login(app: ReturnType<typeof createApp>, password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password });
  return res.body.accessToken as string;
}

describe("저장 암호화 API", () => {
  it("상태에 '막는 것'과 '못 막는 것'이 함께 실린다 — 과장 방지가 계약이다", () => {
    const s = dbCryptStatus();
    expect(s.covers.length).toBeGreaterThan(0);
    expect(s.notCovered.length).toBeGreaterThan(0);
    // 특히 지식베이스 미적용은 반드시 명시 — 이것을 빼면 "다 암호화됐다"는 거짓이 된다.
    expect(s.notCovered.join(" ")).toContain("지식베이스");
    expect(s.notCovered.join(" ")).toContain("살아 있는 동안");
  });

  it("테스트 DB(:memory:)는 암호화가 꺼져 있고, 켜는 방법이 안내된다", () => {
    const s = dbCryptStatus();
    expect(s.encrypted).toBe(false);
    expect(s.howToEnable).toContain("encrypt-db.mjs");
  });

  it("상태 조회는 로그인 필요, 재발급은 관리자 전용", async () => {
    const app = createApp();
    await request(app).get("/api/dbcrypt/status").expect(401);

    const token = await login(app);
    const r = await request(app).get("/api/dbcrypt/status").set("Authorization", `Bearer ${token}`).expect(200);
    expect(r.body.encrypted).toBe(false);

    // 암호화가 꺼진 상태의 재발급은 400 — 잘못된 상태에서 조용히 성공하면 안 된다.
    await request(app)
      .post("/api/dbcrypt/rotate-recovery")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });
});
