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

  // ★ 이 시험이 지키는 것은 「숫자가 문서와 같은가」가 아니라 **권장이 기계를 안 터뜨리는가**다.
  //   실사고 직전(2026-08-12 발견): Pro가 채팅 3개였고 recommendTier가 28GB부터 Pro를 권해,
  //   32GB 기계에 **42.1GB 필요한 설정**을 권하고 있었다. 권장 판정 자체가 위험한 조언이었다.
  const 모델GB = 13.2; // 14B @ 32K 실측
  const 임베딩GB = 2.5; // bge-m3 상주
  const 티어VRAM: Record<string, number> = { lite: 12, standard: 24, pro: 32 };

  it("★ 권장 설정이 그 등급의 VRAM 안에 들어간다 — 넘으면 따르는 순간 터진다", () => {
    for (const t of GIJO_TIERS) {
      if (t.id === "lite") continue; // Lite는 작은 모델(7.6B급) 전제라 14B 계수로 재지 않는다
      const 점유 = t.maxLoadedModels * 모델GB + 임베딩GB;
      expect(점유, `${t.label}: ${점유.toFixed(1)}GB 필요한데 ${티어VRAM[t.id]}GB급에 권한다`).toBeLessThan(
        티어VRAM[t.id],
      );
    }
  });

  it("티어 사양 3종 — Lite는 「일부 기능 제약」으로 남긴다(2026-08-12 사용자 지시)", () => {
    expect(GIJO_TIERS.map((t) => t.id)).toEqual(["lite", "standard", "pro"]);
    const lite = GIJO_TIERS[0];
    expect(lite.maxLoadedModels).toBe(1);
    expect(lite.ctxSize).toBe(16384);
    // 이름·설명에 제약이 드러나야 한다 — 안 적으면 담당자가 표준과 같은 것으로 읽는다.
    expect(lite.label + lite.desc, "Lite에 「일부 기능 제약」 표기가 없다").toContain("제약");
    const std = GIJO_TIERS[1];
    expect(std.maxLoadedModels).toBe(1); // 2 → 1 (실측: 2개면 28.9GB로 24GB를 넘는다)
    expect(std.ctxSize).toBe(32768);
    expect(GIJO_TIERS[2].maxLoadedModels).toBe(2); // 3 → 2
  });

  it("recommendTier — 실측 기준 VRAM 경계", () => {
    expect(recommendTier(12288)).toBe("lite"); // 12GB
    expect(recommendTier(16384)).toBe("lite"); // 16GB — 14B 32K가 안 들어간다
    expect(recommendTier(24576)).toBe("standard"); // 24GB (현행 운영)
    expect(recommendTier(32768)).toBe("pro"); // 32GB
    // ⚠ 예전 경계(28000부터 pro)의 회귀 방지 — 32GB 미만에 Pro를 권하면 안 된다.
    expect(recommendTier(28672), "28GB에 Pro를 권하면 채팅 2개가 안 들어간다").toBe("standard");
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
