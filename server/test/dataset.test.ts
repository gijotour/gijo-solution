import { spawnSync } from "child_process";
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

  it("extracts Q&A pairs even with prose wrapped around the JSON array", async () => {
    mockChat.mockResolvedValue('다음은 요청하신 JSON입니다:\n[{"question":"q1","answer":"a1"}]\n참고하세요.');
    const res = await request(app).post("/api/dataset/convert").set("Authorization", `Bearer ${token}`).send({ rawText: "문서" });
    expect(res.body).toEqual([{ question: "q1", answer: "a1" }]);
  });

  it("recovers complete pairs from a truncated JSON array (regex fallback)", async () => {
    // 배열이 중간에 잘림 — 앞의 완성된 쌍들은 살려야 한다
    mockChat.mockResolvedValue('[{"question":"q1","answer":"a1"},{"question":"q2","answer":"a2"},{"question":"q3","answer":"불완');
    const res = await request(app).post("/api/dataset/convert").set("Authorization", `Bearer ${token}`).send({ rawText: "문서" });
    expect(res.body).toEqual([
      { question: "q1", answer: "a1" },
      { question: "q2", answer: "a2" },
    ]);
  });

  it("chunks a long document into multiple convert calls and dedupes by question", async () => {
    // 각 청크마다 같은 mock을 쓰되 question이 겹치면 1개로 합쳐진다
    mockChat.mockResolvedValue('[{"question":"공통질문","answer":"a"}]');
    const longText = Array.from({ length: 20 }, (_, i) => `문단 ${i} `.repeat(60)).join("\n\n"); // 2500자↑
    const res = await request(app).post("/api/dataset/convert").set("Authorization", `Bearer ${token}`).send({ rawText: longText });
    expect(mockChat.mock.calls.length).toBeGreaterThan(1); // 여러 청크
    expect(res.body).toEqual([{ question: "공통질문", answer: "a" }]); // 중복 제거
  });

  it("amplify returns an empty array for an empty input without calling the LLM", async () => {
    const res = await request(app)
      .post("/api/dataset/amplify")
      .set("Authorization", `Bearer ${token}`)
      .send({ examples: [] });

    expect(res.body).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("save persists a dataset to data/datasets/<id>.json and list sees it", async () => {
    const id = `vitest-ds-${Date.now().toString(36)}`;
    const save = await request(app)
      .post("/api/dataset/save")
      .set("Authorization", `Bearer ${token}`)
      .send({
        examples: [
          { question: "q1", answer: "a1" },
          { question: "", answer: "무시돼야 함" }, // 빈 question은 걸러진다
          { question: "q2", answer: "a2" },
        ],
        id,
      });
    expect(save.status).toBe(200);
    expect(save.body).toEqual({ id, examples: 2 });

    const list = await request(app).get("/api/dataset/list").set("Authorization", `Bearer ${token}`);
    expect(list.body).toContainEqual({ id, examples: 2 });

    const fs = await import("fs");
    const filePath = `data/datasets/${id}.json`;
    const rows = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(rows).toHaveLength(2);
    fs.unlinkSync(filePath);
  });

  it("save rejects a path-traversal-shaped id", async () => {
    const res = await request(app)
      .post("/api/dataset/save")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "../evil", examples: [{ question: "q", answer: "a" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("데이터셋 ID");
  });

  it("save rejects an empty example set", async () => {
    const res = await request(app)
      .post("/api/dataset/save")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "valid-id", examples: [{ question: "", answer: "" }] });
    expect(res.status).toBe(400);
  });

  it("extract rejects missing filename/content", async () => {
    const res = await request(app).post("/api/dataset/extract").set("Authorization", `Bearer ${token}`).send({ filename: "x.pdf" });
    expect(res.status).toBe(400);
  });
});

describe("dataset document extraction (real python)", () => {
  const python = spawnSync(process.env.GIJO_TEST_PYTHON ?? "python", ["--version"]).status === 0;

  it.runIf(python)("extracts text from a base64 .txt via the python script", async () => {
    const { extractDocumentText } = await import("../src/engine/dataset");
    const b64 = Buffer.from("사고대응 규정: 랜섬웨어 감염 시 즉시 격리한다.", "utf-8").toString("base64");
    const text = await extractDocumentText("policy.txt", b64);
    expect(text).toContain("즉시 격리");
  });

  it.runIf(python)("rejects an unsupported extension", async () => {
    const { extractDocumentText } = await import("../src/engine/dataset");
    await expect(extractDocumentText("x.exe", Buffer.from("bin").toString("base64"))).rejects.toThrow();
  });
});
