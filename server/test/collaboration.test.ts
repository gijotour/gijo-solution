import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// 이 테스트는 dispatch가 협업 이벤트 2개를 내는지(오케스트레이션)만 검증한다. 실제 로컬 LLM/
// 모델 로딩에 의존하지 않도록 llm을 목킹한다(다른 dispatch 테스트와 동일한 격리).
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "상태 양호합니다."),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { emitCollaboration, resetCollaborationForTests } from "../src/engine/collaboration";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("collaboration", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetCollaborationForTests();
    app = createApp();
    token = await login(app);
  });

  it("records emitted events in history, most recent last", async () => {
    emitCollaboration({ from: "scan", to: "analysis", message: "findings 전달" });
    emitCollaboration({ from: "analysis", to: "report", message: "요약 요청" });

    const res = await request(app).get("/api/collaboration/history").set("Authorization", `Bearer ${token}`);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].message).toBe("findings 전달");
    expect(res.body[1].message).toBe("요약 요청");
    expect(res.body[0].timestamp).toBeTypeOf("number");
  });

  it("a real dispatch produces both a start and complete collaboration event", async () => {
    await request(app).post("/api/dispatch").set("Authorization", `Bearer ${token}`).send({ text: "상태 확인" });

    const res = await request(app).get("/api/collaboration/history").set("Authorization", `Bearer ${token}`);
    // 2026-07-20부터 무세션 지시도 세션이 자동 생성되므로 "세션" 태그 이벤트 2건이 앞뒤로 추가된다:
    // [세션→orchestrator 지시, orchestrator→에이전트 시작, 에이전트→orchestrator 완료, orchestrator→세션 응답]
    expect(res.body).toHaveLength(4);
    expect(res.body[0].from).toBe("세션");
    expect(res.body[1].from).toBe("orchestrator");
    expect(res.body[2].to).toBe("orchestrator");
    expect(res.body[3].to).toBe("세션");
  });

  it("caps the in-memory log so it can't grow unbounded", async () => {
    // 상한(500)을 크게 넘겨 넣어도 history는 최근 100개만, 내부 버퍼는 상한 이하로 유지된다.
    for (let i = 0; i < 700; i++) emitCollaboration({ from: "a", to: "b", message: `m${i}` });
    const res = await request(app).get("/api/collaboration/history").set("Authorization", `Bearer ${token}`);
    expect(res.body).toHaveLength(100); // 라우트는 최근 100개
    // 가장 최근 이벤트가 마지막 — 오래된 것들은 상한 초과로 잘려나갔다
    expect(res.body[99].message).toBe("m699");
    expect(res.body[0].message).toBe("m600");
  });
});
