import { describe, it, expect } from "vitest";
import request from "supertest";
import * as fs from "fs";
import { createApp } from "../src/app";
import { planMerge, buildMergeConfig, mergedModelId } from "../src/engine/merge";
import { SECURITY_LLM_DEX } from "../src/engine/modeldex";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

// 도감에서 같은 arch·size 쌍(합성 가능) 하나를 찾는다 — Lily + ZySec (둘 다 mistral 7B).
const lily = SECURITY_LLM_DEX.find((m) => m.id === "segolilylabs/Lily-Cybersecurity-7B-v0.2")!;
const zysec = SECURITY_LLM_DEX.find((m) => m.id === "ZySec-AI/SecurityLLM")!;
const foundation = SECURITY_LLM_DEX.find((m) => m.id === "fdtn-ai/Foundation-Sec-8B")!; // llama 8B — arch/size 다름

describe("merge (보안 LLM 합성 설정 생성)", () => {
  it("buildMergeConfig produces a valid SLERP mergekit YAML referencing both models", () => {
    const yaml = buildMergeConfig(lily, zysec);
    expect(yaml).toContain("merge_method: slerp");
    expect(yaml).toContain(`model: ${lily.id}`);
    expect(yaml).toContain(`model: ${zysec.id}`);
    expect(yaml).toContain(`base_model: ${lily.id}`);
    expect(yaml).toContain("t:");
  });

  it("mergedModelId is a safe serving id (lowercase, hyphen only)", () => {
    expect(mergedModelId(lily, zysec)).toMatch(/^[a-z0-9-]+$/);
  });

  it("planMerge writes a config file + run commands for a compatible pair", () => {
    const plan = planMerge(lily.id, zysec.id);
    expect(plan.ok).toBe(true);
    expect(plan.outputModelId).toMatch(/^merged-/);
    expect(plan.config).toContain("slerp");
    expect(fs.existsSync(plan.configPath!)).toBe(true);
    expect(plan.commands!.some((c) => c.startsWith("mergekit-yaml"))).toBe(true);
    fs.rmSync(plan.configPath!, { force: true });
  });

  it("planMerge rejects incompatible pairs (different arch/size) and identical models", () => {
    expect(planMerge(lily.id, foundation.id).ok).toBe(false); // mistral 7B vs llama 8B
    expect(planMerge(lily.id, lily.id).ok).toBe(false); // 같은 모델
    expect(planMerge("no/such", zysec.id).ok).toBe(false); // 존재하지 않음
  });

  it("POST /api/merge/plan returns 400 for incompatible, 200 with config for compatible", async () => {
    const app = createApp();
    const token = await login(app);
    const bad = await request(app).post("/api/merge/plan").set("Authorization", `Bearer ${token}`).send({ modelA: lily.id, modelB: foundation.id });
    expect(bad.status).toBe(400);
    const good = await request(app).post("/api/merge/plan").set("Authorization", `Bearer ${token}`).send({ modelA: lily.id, modelB: zysec.id });
    expect(good.status).toBe(200);
    expect(good.body.config).toContain("slerp");
    fs.rmSync(good.body.configPath, { force: true });
  });

  it("GET /api/merge/preflight returns a check list and requires auth", async () => {
    const app = createApp();
    const token = await login(app);
    const res = await request(app).get("/api/merge/preflight").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const keys = res.body.checks.map((c: { key: string }) => c.key);
    expect(keys).toContain("mergekit");
    expect(keys).toContain("llama-convert");
    expect(typeof res.body.ready).toBe("boolean");
    expect((await request(app).get("/api/merge/preflight")).status).toBe(401);
  });
});
