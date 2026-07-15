import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { SECURITY_LLM_DEX, synthesisGroups } from "../src/engine/modeldex";

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
});
