import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// 이 테스트는 dispatch가 협업 이벤트 2개를 내는지(오케스트레이션)만 검증한다. 실제 로컬 LLM/
// 모델 로딩에 의존하지 않도록 llm을 목킹한다(다른 dispatch 테스트와 동일한 격리).
vi.mock("../src/engine/llm", () => ({
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
    expect(res.body).toHaveLength(2);
    expect(res.body[0].from).toBe("orchestrator");
    expect(res.body[1].to).toBe("orchestrator");
  });
});
