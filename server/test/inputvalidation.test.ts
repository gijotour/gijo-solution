// 입력창 전수검증(2026-07-23)에서 발견된 서버 검증 공백 회귀 테스트 —
// 빈값이 500으로 터지거나(자산·SMTP·온톨로지) 200으로 무의미 결과를 내던(지식검색) 것을 400+안내로.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("입력 검증 — 빈값은 400과 한국어 안내로 거부", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  it("자산 등록 빈 이름 → 400", async () => {
    const res = await auth(request(app).post("/api/assets").send({ name: "" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("이름");
  });

  it("SMTP 빈 호스트 → 400", async () => {
    const res = await auth(request(app).post("/api/email/config").send({ host: "", fromAddress: "" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("필수");
  });

  it("온톨로지 빈 트리플 → 400 (500 아님)", async () => {
    const res = await auth(request(app).post("/api/ontology/triple").send({ subject: "", predicate: "", object: "" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("입력");
  });

  it("지식 검색 빈 질문 → 400 (무관 결과 반환 금지)", async () => {
    const res = await auth(request(app).post("/api/memory/query").send({ question: "  " }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("질문");
  });
});
