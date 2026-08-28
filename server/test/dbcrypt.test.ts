// 저장 암호화 상태·복구 열쇠 API — 권한 경계와 정직한 범위 표기를 확인한다.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
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

// ── 평문 사본 탐지 ────────────────────────────────────────────────────────
// 암호화를 켰는데 옆에 평문 사본이 남아 있으면 **암호화가 무의미하다** — 훔치는 쪽은
// 잠긴 DB 대신 .bak을 가져간다. 운영 전환 직후 실측에서 10개가 남아 있었다(2026-07-30).
describe("평문 사본 경고", () => {
  it("상태에 평문 사본 항목이 항상 있다", () => {
    const s = dbCryptStatus();
    expect(s.plaintextCopies).toBeDefined();
    expect(typeof s.plaintextCopies.count).toBe("number");
    expect(Array.isArray(s.plaintextCopies.files)).toBe(true);
  });

  it("암호화가 꺼져 있으면 세지 않는다 — 평문이 당연한 상태다", () => {
    // 테스트 DB(:memory:)는 암호화 꺼짐 → 경고할 이유가 없다(늘 노랑이면 아무도 안 본다).
    expect(dbCryptStatus().encrypted).toBe(false);
    expect(dbCryptStatus().plaintextCopies.count).toBe(0);
  });

  it("자가 진단이 평문 사본을 실제로 조회한다 — 코드에서(주석 아님)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "observability.ts"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toMatch(/dbCryptStatus\(\)\.plaintextCopies/);
    // ⚠ require()로 부르면 ESM에서 조용히 실패해 검사가 안 돈다(오늘 두 번 겪었다).
    expect(code).not.toMatch(/require\(["']\.\/dbcrypt["']\)/);
  });
});
