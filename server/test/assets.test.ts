import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// 스캔 dispatch가 findings 상태를 어떻게 다루는지만 검증한다. 실제 로컬 LLM/모델 로딩에
// 의존하지 않도록 llm을 목킹한다(라우팅·분석 요약용 chat 호출이 실제 모델을 띄우지 않게).
vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "요약: 스캔 결과 정리."),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests, setAssetRobustness } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("assets", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("deletes an asset (and 404s for an unknown id)", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "to-delete", name: "삭제 대상", path: "p" });
    expect((await request(app).get("/api/assets").set("Authorization", `Bearer ${token}`)).body.some((a: { id: string }) => a.id === "to-delete")).toBe(true);

    const del = await request(app).delete("/api/assets/to-delete").set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect((await request(app).get("/api/assets").set("Authorization", `Bearer ${token}`)).body.some((a: { id: string }) => a.id === "to-delete")).toBe(false);

    expect((await request(app).delete("/api/assets/nope").set("Authorization", `Bearer ${token}`)).status).toBe(404);
    expect((await request(app).delete("/api/assets/to-delete")).status).toBe(401); // 인증 필요
  });

  it("registers an asset with defaults for optional fields", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "doc-classifier", name: "doc-classifier", path: "models/doc.gguf" });

    expect(res.status).toBe(200);
    expect(res.body.assetType).toBe("기타");
    expect(res.body.owner).toBe("-");
    expect(res.body.findings).toEqual([]);
    expect(res.body.scanHistory).toEqual([]);
    expect(res.body.lastScannedAt).toBeNull();
    expect(res.body.sbomGeneratedAt).toBeNull();
  });

  it("lists registered assets", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a2", name: "a2", path: "x" });

    const res = await request(app).get("/api/assets").set("Authorization", `Bearer ${token}`);
    expect(res.body.map((a: { id: string }) => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("returns 404 for an asset that was never registered", async () => {
    const res = await request(app).get("/api/assets/never-registered").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("re-registering the same id resets its findings/scan state", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });
    await request(app).post("/api/dispatch").set("Authorization", `Bearer ${token}`).send({ text: "a1 스캔해줘" });

    const before = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(before.body.findings.length).toBeGreaterThan(0);

    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });
    const after = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(after.body.findings).toEqual([]);
  });

  it("findings reflect only the latest scan, while scanHistory keeps every past run (regression: used to append findings forever)", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });

    await request(app).post("/api/dispatch").set("Authorization", `Bearer ${token}`).send({ text: "a1 스캔해줘" });
    const afterFirstScan = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(afterFirstScan.body.scanHistory).toHaveLength(1);
    const findingsAfterOneScan = afterFirstScan.body.findings.length;

    await request(app).post("/api/dispatch").set("Authorization", `Bearer ${token}`).send({ text: "a1 스캔해줘" });
    const afterSecondScan = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(afterSecondScan.body.scanHistory).toHaveLength(2);
    // findings must stay at "one scan's worth", not double up across the two runs
    expect(afterSecondScan.body.findings.length).toBe(findingsAfterOneScan);
  });

  it("new assets carry an empty AI-BOM (5영역 + 견고성)", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "a1", name: "a1", path: "x" });
    expect(Object.keys(res.body.aibom).sort()).toEqual(["agentTool", "dataset", "infrastructure", "model", "prompt", "robustness"]);
    expect(res.body.aibom.model.foundationModel).toBe("");
    expect(res.body.aibom.model.modelRef).toBe(""); // 로컬 모델 미연결
    expect(res.body.aibom.robustness.score).toBeNull(); // 미점검
  });

  it("setAssetRobustness가 레드팀 점수를 AI-BOM에 기록하고 modelRef를 고정한다", async () => {
    await request(app).post("/api/assets").set("Authorization", `Bearer ${token}`).send({ id: "a1", name: "챗봇", path: "x" });
    setAssetRobustness("a1", { score: 43, vulnerable: 8, total: 14, ranAt: 1234, modelId: "lily-cybersecurity-7b-v0.2" });
    const get = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(get.body.aibom.robustness.score).toBe(43);
    expect(get.body.aibom.robustness.vulnerable).toBe(8);
    expect(get.body.aibom.model.modelRef).toBe("lily-cybersecurity-7b-v0.2"); // 다음 재점검 대상으로 고정
  });

  it("PUT /api/assets/:id/aibom persists and merges partial AI-BOM data", async () => {
    await request(app).post("/api/assets").set("Authorization", `Bearer ${token}`).send({ id: "a1", name: "a1", path: "x" });

    const put = await request(app)
      .put("/api/assets/a1/aibom")
      .set("Authorization", `Bearer ${token}`)
      .send({ aibom: { model: { foundationModel: "Lily-7B", weightsHash: "sha256:abc" }, prompt: { guardrails: "탈옥 차단 규칙" } } });
    expect(put.status).toBe(200);
    expect(put.body.aibom.model.foundationModel).toBe("Lily-7B");
    expect(put.body.aibom.model.weightsHash).toBe("sha256:abc");
    expect(put.body.aibom.prompt.guardrails).toBe("탈옥 차단 규칙");
    // 지정 안 한 영역은 빈 문자열로 유지(완전한 5영역 보장)
    expect(put.body.aibom.dataset.sources).toBe("");
    expect(put.body.aibom.infrastructure.hostingProvider).toBe("");

    // 영속 확인: 다시 조회해도 남아 있다
    const get = await request(app).get("/api/assets/a1").set("Authorization", `Bearer ${token}`);
    expect(get.body.aibom.model.foundationModel).toBe("Lily-7B");
  });

  it("returns 404 when setting AI-BOM on a nonexistent asset", async () => {
    const res = await request(app).put("/api/assets/ghost/aibom").set("Authorization", `Bearer ${token}`).send({ aibom: {} });
    expect(res.status).toBe(404);
  });

  // ④⑥ 자산 화면 고도화 —
  it("호스트명·IP를 자산명에서 유도하고, 새 자산은 category=null·updatedAt이 채워진다", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "h1", name: "oracle.local (192.168.219.98)", path: "x", assetType: "infra-host" });
    expect(res.status).toBe(200);
    expect(res.body.hostname).toBe("oracle.local");
    expect(res.body.ip).toBe("192.168.219.98");
    expect(res.body.category).toBeNull();
    expect(typeof res.body.updatedAt).toBe("number"); // 등록 시점이 최종수정으로 기록됨
  });

  it("PATCH /category 로 카테고리를 지정/해제하고 updatedAt이 갱신된다", async () => {
    await request(app).post("/api/assets").set("Authorization", `Bearer ${token}`).send({ id: "c1", name: "c1", path: "x" });
    const before = (await request(app).get("/api/assets/c1").set("Authorization", `Bearer ${token}`)).body.updatedAt;

    const set = await request(app).patch("/api/assets/c1/category").set("Authorization", `Bearer ${token}`).send({ category: "인프라" });
    expect(set.status).toBe(200);
    expect(set.body.category).toBe("인프라");
    expect(set.body.updatedAt).toBeGreaterThanOrEqual(before);

    // 빈 값이면 미분류(null)로 해제
    const clear = await request(app).patch("/api/assets/c1/category").set("Authorization", `Bearer ${token}`).send({ category: "  " });
    expect(clear.body.category).toBeNull();

    // 없는 자산 → 404, 인증 없으면 401
    expect((await request(app).patch("/api/assets/ghost/category").set("Authorization", `Bearer ${token}`).send({ category: "x" })).status).toBe(404);
    expect((await request(app).patch("/api/assets/c1/category").send({ category: "x" })).status).toBe(401);
  });
});
