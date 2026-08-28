// 챗봇 CLI 명령 제안(④) — LLM 대역으로 제안 흐름과 게이트웨이 차단을 검증.
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const chatSpy = vi.fn(async () => JSON.stringify({ command: "nmap -sV 10.0.0.5", explanation: "열린 포트를 확인합니다" }));
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: (...a: unknown[]) => chatSpy(...(a as [])),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("cmdsuggest — 챗봇 CLI 명령 제안", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    chatSpy.mockClear();
    app = createApp();
    token = await login(app);
  });

  it("요청을 명령+설명으로 제안한다(실행하지 않음)", async () => {
    const res = await request(app)
      .post("/api/terminal/suggest")
      .set("Authorization", `Bearer ${token}`)
      .send({ request: "10.0.0.5 열린 포트 스캔해줘" });
    expect(res.status).toBe(200);
    expect(res.body.command).toBe("nmap -sV 10.0.0.5");
    expect(res.body.explanation).toContain("포트");
    // json_schema 강제 디코딩 경로로 호출됐는지
    expect(chatSpy).toHaveBeenCalledWith(expect.objectContaining({ responseSchema: expect.any(Object) }));
  });

  it("request가 없으면 400", async () => {
    const res = await request(app).post("/api/terminal/suggest").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it("인증 없이는 호출할 수 없다", async () => {
    const res = await request(app).post("/api/terminal/suggest").send({ request: "x" });
    expect(res.status).toBe(401);
  });

  it("LLM이 JSON이 아닌 걸 주면 빈 명령 + 안내를 돌려준다(크래시 없음)", async () => {
    chatSpy.mockResolvedValueOnce("죄송합니다 못 만들어요");
    const res = await request(app)
      .post("/api/terminal/suggest")
      .set("Authorization", `Bearer ${token}`)
      .send({ request: "이상한 요청" });
    expect(res.status).toBe(200);
    expect(res.body.command).toBe("");
    expect(res.body.explanation).toContain("직접 입력");
  });
});
