import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// 라우트 스택만 검증하므로 임베딩/LLM은 목킹(실제 모델 불필요).
vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { db } from "../src/db";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("ontology REST 라우트 — 인증 → seed → list → expand 전체 스택", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    db.exec("DELETE FROM ontology_triples");
    app = createApp();
    token = await login(app);
  });

  it("인증 없이는 401", async () => {
    await request(app).get("/api/ontology/triples").expect(401);
  });

  it("트리플 추가 → 목록 → 삭제가 HTTP로 왕복한다", async () => {
    const add = await request(app)
      .post("/api/ontology/triple")
      .set(auth())
      .send({ subject: "관리자API", predicate: "접근권한", object: "보안운영팀", source: "접근제어지침 3.2" })
      .expect(200);
    expect(add.body.id).toBeTruthy();

    const list = await request(app).get("/api/ontology/triples").set(auth()).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].object).toBe("보안운영팀");

    await request(app).delete(`/api/ontology/triple/${add.body.id}`).set(auth()).expect(200);
    const after = await request(app).get("/api/ontology/triples").set(auth()).expect(200);
    expect(after.body).toHaveLength(0);
  });

  it("seed 라우트가 KISA 카탈로그를 적재하고 stats/expand가 이를 반영한다", async () => {
    const seed = await request(app).post("/api/ontology/seed").set(auth()).expect(200);
    expect(seed.body.inserted).toBeGreaterThan(20);

    const stats = await request(app).get("/api/ontology/stats").set(auth()).expect(200);
    expect(stats.body.count).toBe(seed.body.inserted);

    // '탈옥'을 언급하면 그래프 확장으로 관련 트리플(위협코드/OWASP 등)이 나와야 한다.
    const expand = await request(app)
      .post("/api/ontology/expand")
      .set(auth())
      .send({ text: "탈옥 위협 대응 방법" })
      .expect(200);
    const subjects = new Set(expand.body.map((t: { subject: string }) => t.subject));
    expect(subjects.has("탈옥")).toBe(true);
  });
});
