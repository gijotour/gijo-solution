import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { GIJO_TIERS, recommendTier, tierFits, currentTierSettings } from "../src/engine/localengine";
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
  // ⚠ Lite는 **10GB**다(사장님 결정 2026-08-12 — 앞선 「8GB」를 대체).
  //   8GB로 내리려다 이 검사에 걸렸다: 채팅 6.5 + 임베딩 2.5 = 9.00GB인데 8GB에서 쓸 수 있는 건
  //   7.60GB뿐이라 **「8GB급」이라 적어 놓고 8GB엔 안 들어가는 등급**이 될 뻔했다.
  //   이 표가 그걸 잡는 자리다 — 이름표와 실제가 어긋나면 여기서 빨개진다.
  const 티어VRAM: Record<string, number> = { lite: 10, standard: 24, pro: 48 }; // Pro는 48GB급(사용자 결정 2026-08-12)

  it("★ 등급 이름표(24GB급 등)가 그 플랫폼에서 실제로 들어가는 크기다", () => {
    // ⚠ CUDA만 보면 안 된다 — Metal은 같은 모델이 21% 무겁다(2026-08-12 Mac 실측:
    //   14B@32K 16.0GB · bge 1.55GB). CUDA 상수만 쓰다 32GB Mac에 33.5GB짜리 Pro를 권했다.
    for (const t of GIJO_TIERS) {
      if (t.planned) continue; // 예정 등급은 사양이 확정 전이라 이름표가 없다
      expect(tierFits(t, 티어VRAM[t.id] * 1024, "cuda"), `${t.label}: CUDA ${티어VRAM[t.id]}GB에 안 들어간다`).toBe(true);
    }
  });

  it("★ 32GB에는 Pro를 권하지 않는다 — Metal은 33.6GB라 못 들어가고, CUDA도 48GB급 약속 미만이다", () => {
    expect(tierFits(GIJO_TIERS[2], 32 * 1024, "metal"), "Metal 32GB에 Pro가 들어간다고 봤다").toBe(false);
    expect(recommendTier(32 * 1024, "metal")).toBe("standard");
    expect(recommendTier(32 * 1024, "cuda"), "CUDA 32GB는 계산상 들어가도 48GB급 약속 미만이다").toBe("standard");
    expect(recommendTier(48 * 1024, "cuda"), "48GB CUDA는 Pro").toBe("pro");
    expect(recommendTier(48 * 1024, "metal"), "48GB Metal도 Pro(33.6GB)").toBe("pro");
  });

  describe("★ 예정 등급(Max·관제용) — 보이되 고를 수 없다", () => {
    // ⚠ 「지금 없는 것을 있는 척하지 않는다」가 이 제품의 규칙이다. 목록에서 아예 빼면
    //   계획이 있다는 것도 안 보여 문의가 반복되고, 고르게 두면 없는 구성으로 풀이 뜬다. 보이고, 막는다.
    const max = () => GIJO_TIERS.find((t) => t.id === "max")!;

    it("표에는 있고 planned로 표시된다", () => {
      expect(max(), "Max 등급이 표에 없다").toBeTruthy();
      expect(max().planned).toBe(true);
      expect(max().label + max().desc, "예정이라는 말이 없다").toContain("예정");
    });

    it("사양을 숫자로 단언하지 않는다 — 확정 전이다", () => {
      expect(max().vramLabel, "확정되지 않은 VRAM을 숫자로 못 박았다").not.toMatch(/^\d+GB급$/);
    });

    it("권장 판정에 절대 안 나온다 — 아무리 큰 기계여도", () => {
      for (const mb of [32768, 49152, 98304, 131072]) {
        expect(recommendTier(mb, "cuda"), `${mb}MB에 Max를 권했다`).not.toBe("max");
        expect(recommendTier(mb, "metal")).not.toBe("max");
      }
    });

    it("적용하려 하면 400 — 준비 중이라고 답한다", async () => {
      const res = await request(app).post("/api/localengine/tier").set("Authorization", `Bearer ${token}`).send({ tier: "max" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("준비 중");
    });
  });

  it("티어 사양 4종 — Lite는 「일부 기능 제약」으로 남긴다(2026-08-12 사용자 지시)", () => {
    expect(GIJO_TIERS.map((t) => t.id)).toEqual(["lite", "standard", "pro", "max"]);
    const lite = GIJO_TIERS[0];
    expect(lite.maxLoadedModels).toBe(1);
    expect(lite.ctxSize).toBe(8192);
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
    expect(recommendTier(49152)).toBe("pro"); // 48GB — Pro는 48GB급
    // ⚠ 회귀 방지: 예전엔 28GB부터 Pro였다(채팅 3개 = 42.1GB 필요). 지금은 48GB 미만이면 Standard다.
    expect(recommendTier(28672)).toBe("standard");
    expect(recommendTier(32768), "32GB에 Pro를 권하면 Metal에서 축출·스왑이 반복된다").toBe("standard");
  });

  it("저장된 티어가 없으면 환경변수/기본값으로 동작한다", () => {
    const s = currentTierSettings();
    expect(s.tier).toBeNull();
    expect(s.maxLoadedModels).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/localengine/tier — 현재·권장·사양표를 돌려준다", async () => {
    const res = await request(app).get("/api/localengine/tier").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tiers).toHaveLength(4); // Max(예정) 포함
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
    expect(s.ctxSize).toBe(8192);
  });

  it("알 수 없는 티어는 400", async () => {
    const res = await request(app).post("/api/localengine/tier").set("Authorization", `Bearer ${token}`).send({ tier: "ultra" });
    expect(res.status).toBe(400);
  });
});
