// 자산 허브 집계 — OWASP LLM 도출 규칙·노출점수·요약을 검증(실 셸/LLM 의존 없음).
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests, registerAsset, updateAiBom, recordFindings, markSbomGenerated, getAsset } from "../src/engine/assets";
import { buildHub, buildHubRow, deriveOwaspRisks } from "../src/engine/assethub";
import { emptyAiBom } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("assethub — OWASP LLM 도출 규칙", () => {
  beforeEach(() => resetAssetsForTests());

  it("AI-BOM이 빈 LLM 자산은 LLM01~04가 미대응(open)으로 도출된다", () => {
    registerAsset({ id: "llm-a", name: "LLM A", path: "models/a.gguf", assetType: "LLM 서비스" });
    const a = getAsset("llm-a")!;
    const owasp = deriveOwaspRisks(a);
    const by = Object.fromEntries(owasp.map((o) => [o.code, o.status]));
    expect(by["LLM01"]).toBe("open"); // 견고성·가드레일 없음
    expect(by["LLM02"]).toBe("open"); // 가드레일 없음
    expect(by["LLM03"]).toBe("open"); // SBOM 미생성
    expect(by["LLM04"]).toBe("open"); // 데이터 출처 없음
    // 도구·벡터DB·시스템 프롬프트 없음 → 해당없음(na)로 노이즈 안 만듦
    expect(by["LLM05"]).toBe("na");
    expect(by["LLM06"]).toBe("na");
    expect(by["LLM08"]).toBe("na");
  });

  it("AI-BOM을 채우면 해당 위험이 covered로 바뀐다", () => {
    registerAsset({ id: "llm-b", name: "LLM B", path: "models/b.gguf", assetType: "LLM 서비스" });
    const bom = emptyAiBom();
    bom.prompt.guardrails = "출력 DLP + 입력 검증";
    bom.dataset.sources = "사내 승인 코퍼스 v3(출처 서명)";
    bom.robustness = { score: 82, vulnerable: 1, total: 14, ranAt: Date.now(), modelId: "m1" };
    updateAiBom("llm-b", bom);
    markSbomGenerated("llm-b");
    const owasp = deriveOwaspRisks(getAsset("llm-b")!);
    const by = Object.fromEntries(owasp.map((o) => [o.code, o.status]));
    expect(by["LLM01"]).toBe("covered"); // 견고성82 + 가드레일
    expect(by["LLM02"]).toBe("covered"); // 가드레일
    expect(by["LLM03"]).toBe("covered"); // SBOM 생성
    expect(by["LLM04"]).toBe("covered"); // 데이터 출처
  });

  it("도구·에이전트 연동이 있으면 LLM06 과도한 권한이 open으로 뜬다", () => {
    registerAsset({ id: "llm-c", name: "LLM C", path: "models/c.gguf", assetType: "LLM 서비스" });
    const bom = emptyAiBom();
    bom.agentTool.apis = "결제 API, 메일 발송 API";
    bom.dataset.vectorDbLocation = "lancedb://kb";
    updateAiBom("llm-c", bom);
    const by = Object.fromEntries(deriveOwaspRisks(getAsset("llm-c")!).map((o) => [o.code, o.status]));
    expect(by["LLM06"]).toBe("open"); // 도구 연동 → 권한 검토
    expect(by["LLM08"]).toBe("open"); // 벡터DB 사용 → 접근통제 검토
    expect(by["LLM05"]).toBe("open"); // 도구 연동 + 가드레일 없음
  });
});

describe("assethub — 노출점수·요약", () => {
  beforeEach(() => resetAssetsForTests());

  it("Critical·KEV 취약점이 노출점수를 크게 올린다", () => {
    registerAsset({ id: "srv", name: "web", path: "10.0.0.5", assetType: "웹서버" });
    recordFindings("srv", [
      { finding_type: "RCE", severity: "critical", evidence: "x", source_tool: "nessus", kev: true, state: "active" },
    ]);
    const row = buildHubRow(getAsset("srv")!);
    expect(row.isAi).toBe(false);
    expect(row.vuln.critical).toBe(1);
    expect(row.vuln.kev).toBe(1);
    expect(row.exposureScore).toBeGreaterThanOrEqual(40);
    expect(["critical", "high"]).toContain(row.riskBand);
  });

  it("해소된(fixed) 취약점은 현재 노출로 세지 않는다", () => {
    registerAsset({ id: "srv2", name: "web2", path: "10.0.0.6", assetType: "웹서버" });
    recordFindings("srv2", [{ finding_type: "old", severity: "high", evidence: "", source_tool: "x", state: "fixed" }]);
    const row = buildHubRow(getAsset("srv2")!);
    expect(row.vuln.open).toBe(0);
  });

  it("요약: AI/IT 분리 집계 + OWASP 미대응 코드별 카운트 + AI자산 우선 정렬", () => {
    registerAsset({ id: "ai1", name: "AI1", path: "models/x.gguf", assetType: "LLM 서비스" });
    registerAsset({ id: "it1", name: "IT1", path: "10.0.0.9", assetType: "DB" });
    const hub = buildHub();
    expect(hub.summary.aiAssets).toBe(1);
    expect(hub.summary.itAssets).toBe(1);
    expect(hub.rows[0].isAi).toBe(true); // AI 자산이 먼저
    expect(hub.summary.owaspOpenByCode.find((o) => o.code === "LLM01")?.count).toBe(1);
    expect(hub.summary.sbomMissing).toBe(1);
  });
});

describe("assethub — 라우트", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("GET /api/assethub — 인증 필요, 요약+행 반환", async () => {
    expect((await request(app).get("/api/assethub")).status).toBe(401);
    registerAsset({ id: "ai9", name: "AI9", path: "models/z.gguf", assetType: "LLM 서비스" });
    const res = await request(app).get("/api/assethub").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.aiAssets).toBe(1);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it("GET /api/assethub/:id — 자산 상세(OWASP+취약점)", async () => {
    registerAsset({ id: "ai8", name: "AI8", path: "models/y.gguf", assetType: "LLM 서비스" });
    const res = await request(app).get("/api/assethub/ai8").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.row.isAi).toBe(true);
    expect(res.body.owasp.length).toBeGreaterThan(0);
    expect((await request(app).get("/api/assethub/none").set("Authorization", `Bearer ${token}`)).status).toBe(404);
  });
});
