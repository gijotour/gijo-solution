import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { registerTool } from "../src/engine/tools";

const mockRunAdapter = vi.fn();
vi.mock("../src/engine/bridge", () => ({
  runAdapter: (...args: unknown[]) => mockRunAdapter(...args),
  listAdapters: () => [{ id: "modelscan", name: "ModelScan" }],
  registerBridgeRoutes: vi.fn(),
}));

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("tools registry", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    mockRunAdapter.mockReset();
    app = createApp();
    token = await login(app);
    registerTool({
      name: "echo",
      description: "입력을 그대로 반환하는 테스트용 툴",
      run: async (args) => ({ echoed: args }),
    });
  });

  it("lists registered tools without exposing their run function", async () => {
    const res = await request(app).get("/api/tools").set("Authorization", `Bearer ${token}`);
    const echoTool = res.body.find((t: { name: string }) => t.name === "echo");
    expect(echoTool).toEqual({ name: "echo", description: "입력을 그대로 반환하는 테스트용 툴" });
  });

  it("runs a registered tool with the given params", async () => {
    const res = await request(app)
      .post("/api/tools/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "echo", params: { foo: "bar" } });
    expect(res.body).toEqual({ echoed: { foo: "bar" } });
  });

  it("returns 404 for an unregistered tool", async () => {
    const res = await request(app)
      .post("/api/tools/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "nonexistent", params: {} });
    expect(res.status).toBe(404);
  });

  it("registers bridge.ts scan adapters as tools automatically", async () => {
    const res = await request(app).get("/api/tools").set("Authorization", `Bearer ${token}`);
    const modelscanTool = res.body.find((t: { name: string }) => t.name === "modelscan");
    expect(modelscanTool).toBeTruthy();
    expect(modelscanTool.description).toContain("ModelScan");
  });

  it("running a bridge adapter tool calls through to runAdapter with the given assetPath", async () => {
    mockRunAdapter.mockResolvedValue([{ finding_type: "x", severity: "low", evidence: "e", source_tool: "modelscan" }]);

    const res = await request(app)
      .post("/api/tools/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "modelscan", params: { assetPath: "models/fraud.gguf" } });

    expect(res.status).toBe(200);
    expect(mockRunAdapter).toHaveBeenCalledWith("modelscan", "models/fraud.gguf");
    expect(res.body).toEqual([{ finding_type: "x", severity: "low", evidence: "e", source_tool: "modelscan" }]);
  });
});
