import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// 실제 배치 모델 스캔은 models/ 디렉터리를 읽으므로, 테스트용 임시 디렉터리로 고정한다.
const tmpModels = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-agent-models-"));
process.env.GIJO_MODELS_DIR = tmpModels;
function placeModel(id: string) {
  fs.mkdirSync(path.join(tmpModels, id), { recursive: true });
  fs.writeFileSync(path.join(tmpModels, id, `${id}.gguf`), "stub");
}
placeModel("lily-cybersecurity-7b-v0.2");
placeModel("sec-tuned-test-v0");

const { createApp } = await import("../src/app");
const { db } = await import("../src/db");

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body.accessToken as string;
}

describe("agent model assignment (A)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    db.exec("DELETE FROM app_state WHERE key LIKE 'agentModel:%'");
    app = createApp();
    token = await login(app);
  });

  afterAll(() => {
    fs.rmSync(tmpModels, { recursive: true, force: true });
  });

  it("agents list exposes assignedModelId (null by default) and no fake brainModelId", async () => {
    const res = await request(app).get("/api/agents").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const agent of res.body) {
      expect(agent).toHaveProperty("assignedModelId", null);
      expect(agent).not.toHaveProperty("brainModelId");
    }
  });

  it("available models lists placed .gguf dirs, excluding the embedding model", async () => {
    const res = await request(app).get("/api/localengine/models").set("Authorization", `Bearer ${token}`);
    const ids = res.body.map((m: { id: string }) => m.id).sort();
    expect(ids).toContain("lily-cybersecurity-7b-v0.2");
    expect(ids).toContain("sec-tuned-test-v0");
    expect(ids).not.toContain("bge-m3");
  });

  it("admin assigns a model to an agent and it persists in the agents list", async () => {
    const res = await request(app)
      .post("/api/agents/analysis/model")
      .set("Authorization", `Bearer ${token}`)
      .send({ modelId: "sec-tuned-test-v0" });
    expect(res.status).toBe(200);
    expect(res.body.assignedModelId).toBe("sec-tuned-test-v0");

    const list = await request(app).get("/api/agents").set("Authorization", `Bearer ${token}`);
    expect(list.body.find((a: { id: string }) => a.id === "analysis").assignedModelId).toBe("sec-tuned-test-v0");
  });

  it("assigning null clears the assignment (back to global model)", async () => {
    await request(app).post("/api/agents/analysis/model").set("Authorization", `Bearer ${token}`).send({ modelId: "sec-tuned-test-v0" });
    const res = await request(app).post("/api/agents/analysis/model").set("Authorization", `Bearer ${token}`).send({ modelId: null });
    expect(res.body.assignedModelId).toBeNull();
  });

  it("rejects assigning a model that isn't actually placed on disk", async () => {
    const res = await request(app)
      .post("/api/agents/analysis/model")
      .set("Authorization", `Bearer ${token}`)
      .send({ modelId: "ghost-model-9000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("배치되지 않은");
  });

  it("non-admin cannot assign models (403)", async () => {
    // security_officer 계정 생성 후 그 토큰으로 시도
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자", role: "security_officer" });
    const officerToken = await login(app, "officer1", "pw1234");
    const res = await request(app)
      .post("/api/agents/analysis/model")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({ modelId: "sec-tuned-test-v0" });
    expect(res.status).toBe(403);
  });
});
