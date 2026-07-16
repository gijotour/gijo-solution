import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { SECURITY_LLM_DEX, synthesisGroups, LLM_GUIDE, getAgentModelRecommendations } from "../src/engine/modeldex";
import { listAgents } from "../src/engine/agents";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("modeldex (보안 특화 LLM 도감)", () => {
  it("catalog holds only security-focused LLMs with arch/size for synthesis compatibility", () => {
    expect(SECURITY_LLM_DEX.length).toBeGreaterThanOrEqual(4);
    const ids = SECURITY_LLM_DEX.map((m) => m.id);
    expect(ids).toContain("segolilylabs/Lily-Cybersecurity-7B-v0.2");
    expect(ids).toContain("fdtn-ai/Foundation-Sec-8B");
    for (const m of SECURITY_LLM_DEX) {
      expect(m.arch).toBeTruthy();
      expect(m.size).toBeTruthy();
      expect(m.focus.length).toBeGreaterThan(0);
    }
  });

  it("groups models by architecture; mistral group has >1 (synthesis-compatible)", () => {
    const groups = synthesisGroups();
    const mistral = groups.find((g) => g.arch === "mistral");
    expect(mistral).toBeDefined();
    expect(mistral!.models.length).toBeGreaterThanOrEqual(2); // Lily + ZySec
  });

  it("GET /api/modeldex returns models + groups", async () => {
    const app = createApp();
    const token = await login(app);
    const res = await request(app).get("/api/modeldex").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.models.length).toBe(SECURITY_LLM_DEX.length);
    expect(Array.isArray(res.body.groups)).toBe(true);
  });

  describe("agent model recommendations (기능 기반)", () => {
    const recs = getAgentModelRecommendations();
    const guideIds = new Set(LLM_GUIDE.flatMap((c) => c.models).map((m) => m.id));

    it("covers every one of the 8 fixed agents", () => {
      const agentIds = listAgents().map((a) => a.id);
      expect(agentIds).toHaveLength(8);
      for (const id of agentIds) {
        expect(recs[id], `${id} 추천 누락`).toBeDefined();
      }
    });

    it("every recommended model id is a downloadable GGUF present in the LLM guide", () => {
      for (const [agentId, r] of Object.entries(recs)) {
        expect(guideIds.has(r.id), `${agentId} → ${r.id} 도감에 없음`).toBe(true);
        expect(r.name).toBeTruthy();
        expect(r.approxGb).toBeTruthy();
        expect(r.reason.length).toBeGreaterThan(10);
      }
    });

    it("model-evolution is recommended the Hermes learning-loop base", () => {
      expect(recs["model-evolution"].id).toBe("NousResearch/Hermes-3-Llama-3.1-8B-GGUF");
    });

    it("GET /api/modeldex/agent-recommendations returns the map", async () => {
      const app = createApp();
      const token = await login(app);
      const res = await request(app).get("/api/modeldex/agent-recommendations").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.pentest.id).toBe("QuantFactory/Lily-Cybersecurity-7B-v0.2-GGUF");
      expect(res.body.orchestrator.reason).toContain("라우팅");
      expect((await request(app).get("/api/modeldex/agent-recommendations")).status).toBe(401);
    });
  });
});
