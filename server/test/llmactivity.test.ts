import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { emitLlmActivity, modelBasename, resetLlmActivityForTests } from "../src/engine/llmactivity";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("llm activity stream (llm:event)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetLlmActivityForTests();
    app = createApp();
    token = await login(app);
  });

  it("modelBasename strips path and .gguf extension", () => {
    expect(modelBasename("models\\qwythos-9b\\qwythos-9b.gguf")).toBe("qwythos-9b");
    expect(modelBasename("models/lily/lily-cybersecurity-7b-v0.2.gguf")).toBe("lily-cybersecurity-7b-v0.2");
    expect(modelBasename(undefined)).toBe("로컬 LLM");
    expect(modelBasename("")).toBe("로컬 LLM");
  });

  it("history route requires auth", async () => {
    const res = await request(app).get("/api/llm-activity/history");
    expect(res.status).toBe(401);
  });

  it("emitLlmActivity records events that the history route returns, newest included", async () => {
    emitLlmActivity({ kind: "chat", phase: "start", agent: "분석 에이전트", detail: "추론 요청" });
    emitLlmActivity({
      kind: "chat",
      phase: "done",
      agent: "분석 에이전트",
      model: "lily-cybersecurity-7b-v0.2",
      promptTokens: 4032,
      completionTokens: 672,
      tokensPerSec: 130,
      latencyMs: 6261,
    });

    const res = await request(app).get("/api/llm-activity/history").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const done = res.body[1];
    expect(done).toMatchObject({ kind: "chat", phase: "done", model: "lily-cybersecurity-7b-v0.2", tokensPerSec: 130 });
    expect(typeof done.timestamp).toBe("number");
  });

  it("history is capped and returns only the most recent 60", async () => {
    for (let i = 0; i < 80; i++) emitLlmActivity({ kind: "embed", phase: "done", detail: `임베딩 ${i}` });
    const res = await request(app).get("/api/llm-activity/history").set("Authorization", `Bearer ${token}`);
    expect(res.body).toHaveLength(60);
    // 마지막 이벤트가 포함되어 있어야 한다(오래된 것부터 잘림)
    expect(res.body[res.body.length - 1].detail).toBe("임베딩 79");
  });
});
