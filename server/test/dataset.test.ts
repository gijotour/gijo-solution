import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("dataset", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    mockChat.mockReset();
    app = createApp();
    token = await login(app);
  });

  it("parses a well-formed JSON array response from the LLM into Q&A pairs", async () => {
    mockChat.mockResolvedValue(
      JSON.stringify([{ question: "랜섬웨어 감염 시 조치는?", answer: "즉시 네트워크에서 격리한다." }])
    );

    const res = await request(app)
      .post("/api/dataset/convert")
      .set("Authorization", `Bearer ${token}`)
      .send({ rawText: "사고대응 정책 문서 원문" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ question: "랜섬웨어 감염 시 조치는?", answer: "즉시 네트워크에서 격리한다." }]);
  });

  it("strips markdown code fences before parsing", async () => {
    mockChat.mockResolvedValue('```json\n[{"question":"q","answer":"a"}]\n```');

    const res = await request(app)
      .post("/api/dataset/convert")
      .set("Authorization", `Bearer ${token}`)
      .send({ rawText: "문서" });

    expect(res.body).toEqual([{ question: "q", answer: "a" }]);
  });

  it("falls back to an empty array (not a crash) when the LLM doesn't return valid JSON", async () => {
    mockChat.mockResolvedValue("죄송하지만 형식을 지킬 수 없습니다.");

    const res = await request(app)
      .post("/api/dataset/convert")
      .set("Authorization", `Bearer ${token}`)
      .send({ rawText: "문서" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("amplify returns an empty array for an empty input without calling the LLM", async () => {
    const res = await request(app)
      .post("/api/dataset/amplify")
      .set("Authorization", `Bearer ${token}`)
      .send({ examples: [] });

    expect(res.body).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });
});
