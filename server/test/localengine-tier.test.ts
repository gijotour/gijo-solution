import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { GIJO_TIERS, recommendTier, currentTierSettings } from "../src/engine/localengine";
import { db } from "../src/db";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("GIJO 구동 티어 (Lite/Standard/Pro)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    db.prepare("DELETE FROM app_state WHERE key = 'gijoTier'").run();
    app = createApp();
    token = await login(app);
  });

  it("티어 사양 3종 — 가이드라인 문서의 환경변수 3종 값과 일치", () => {
    expect(GIJO_TIERS.map((t) => t.id)).toEqual(["lite", "standard", "pro"]);
    const lite = GIJO_TIERS[0];
    expect(lite.maxLoadedModels).toBe(1);
    expect(lite.ctxSize).toBe(16384);
    const std = GIJO_TIERS[1];
    expect(std.maxLoadedModels).toBe(2);
    expect(std.ctxSize).toBe(32768);
  });

  it("recommendTier — 벤치마크 스크립트와 같은 VRAM 경계", () => {
    expect(recommendTier(12288)).toBe("lite"); // 12GB
    expect(recommendTier(24576)).toBe("standard"); // 24GB (현행 운영)
    expect(recommendTier(32768)).toBe("pro"); // 32GB
  });

  it("저장된 티어가 없으면 환경변수/기본값으로 동작한다", () => {
    const s = currentTierSettings();
    expect(s.tier).toBeNull();
    expect(s.maxLoadedModels).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/localengine/tier — 현재·권장·사양표를 돌려준다", async () => {
    const res = await request(app).get("/api/localengine/tier").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tiers).toHaveLength(3);
    expect(res.body.current).toBeDefined();
    // GPU 유무는 실행 환경에 따라 다르다 — 있으면 권장 판정, 없으면 미지원 안내가 온다.
    if (res.body.gpu) expect(["lite", "standard", "pro"]).toContain(res.body.recommended);
    else expect(res.body.reason).toContain("미지원");
  });

  it("POST /api/localengine/tier — 적용 후 currentTierSettings에 즉시 반영된다", async () => {
    const res = await request(app).post("/api/localengine/tier").set("Authorization", `Bearer ${token}`).send({ tier: "lite" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe("lite");
    const s = currentTierSettings();
    expect(s.tier).toBe("lite");
    expect(s.maxLoadedModels).toBe(1);
    expect(s.ctxSize).toBe(16384);
  });

  it("알 수 없는 티어는 400", async () => {
    const res = await request(app).post("/api/localengine/tier").set("Authorization", `Bearer ${token}`).send({ tier: "ultra" });
    expect(res.status).toBe(400);
  });
});
