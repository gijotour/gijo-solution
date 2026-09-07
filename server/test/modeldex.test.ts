import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { LLM_GUIDE, getAgentModelRecommendations } from "../src/engine/modeldex";
import { listAgents } from "../src/engine/agents";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

// ⚠ 2026-09-07 — 「보안 특화 LLM 도감」(SECURITY_LLM_DEX·합성 호환 그룹·GET /api/modeldex)
//   시험 셋을 여기서 뺐다. 그 도감을 그리던 화면이 LLM 합성 하나뿐이었고 그 화면을 내렸다.
//   시험만 남기면 **아무도 안 쓰는 창구를 시험이 지켜 주는** 꼴이 된다(초록이 거짓 안심을 준다).
//   잔재 감시는 mergeremoved.test가 맡는다.
describe("modeldex (추천 가이드)", () => {
  describe("agent model recommendations (기능 기반)", () => {
    const recs = getAgentModelRecommendations();
    const guideIds = new Set(LLM_GUIDE.flatMap((c) => c.models).map((m) => m.id));

    it("covers every one of the 8 agents (Security Orchestrator·Scan·Analyze·Report·TI + GIJO Agent + Curator Agent + BOM Agent)", () => {
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

    it("Report Agent는 한국어 품질 좋은 Qwen2.5를 추천받는다", () => {
      expect(recs["report"].id).toBe("bartowski/Qwen2.5-7B-Instruct-GGUF");
    });

    it("GET /api/modeldex/agent-recommendations returns the map", async () => {
      const app = createApp();
      const token = await login(app);
      const res = await request(app).get("/api/modeldex/agent-recommendations").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.scan.id).toBe("mradermacher/Foundation-Sec-8B-GGUF");
      expect(res.body.orchestrator.reason).toContain("라우팅");
      expect((await request(app).get("/api/modeldex/agent-recommendations")).status).toBe(401);
    });
  });
});
