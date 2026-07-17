import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { THREAT_CATALOG, resetComplianceForTests } from "../src/engine/compliance";
import { resetAssetsForTests } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("compliance (KISA 매뉴얼 위협 × 프레임워크 대응 현황)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetComplianceForTests();
    app = createApp();
    token = await login(app);
  });

  it("catalog covers all D/M/A/S/H threat codes with framework mappings and AI-BOM areas", () => {
    const codes = THREAT_CATALOG.map((t) => t.code);
    expect(codes).toContain("M03");
    expect(codes).toContain("A01");
    expect(codes).toContain("S02");
    expect(codes.length).toBe(21);
    // 각 위협은 최소 하나의 AI-BOM 영역과 연결
    for (const t of THREAT_CATALOG) {
      expect(t.aibomAreas.length).toBeGreaterThan(0);
    }
    const m03 = THREAT_CATALOG.find((t) => t.code === "M03")!;
    expect(m03.aibomAreas).toContain("prompt");
    expect(m03.owasp[0]).toContain("System Prompt Leakage");
  });

  it("AI-BOM 위협 매칭: 채운 영역만 위협 매칭 + 컴플라이언스 상태 반영 (거버넌스 연계)", async () => {
    resetAssetsForTests();
    const auth = `Bearer ${token}`;
    await request(app).post("/api/assets").set("Authorization", auth).send({ id: "ai-x", name: "AI-X", path: "x" });
    // dataset 영역만 채운다.
    await request(app)
      .put("/api/assets/ai-x/aibom")
      .set("Authorization", auth)
      .send({
        aibom: {
          model: { foundationModel: "", finetuneHistory: "", architecture: "", weightsHash: "" },
          dataset: { sources: "공개 크롤링 데이터", vectorDbLocation: "LanceDB" },
          prompt: { systemPrompt: "", guardrails: "" },
          agentTool: { apis: "", mcpServers: "" },
          infrastructure: { compute: "", hostingProvider: "" },
        },
      });

    let res = await request(app).get("/api/assets/ai-x/aibom/threats").set("Authorization", auth);
    expect(res.status).toBe(200);
    const codes = res.body.matches.map((m: { code: string }) => m.code);
    expect(codes).toContain("D01"); // dataset
    expect(codes).toContain("M02"); // 벡터DB(dataset)
    expect(codes).not.toContain("M03"); // prompt 전용 — 비었으므로 매칭 안 됨
    expect(codes).not.toContain("M06"); // prompt 전용
    expect(res.body.matches.every((m: { status: string }) => m.status === "open")).toBe(true);

    // 상태를 covered로 바꾸면 재조회에 반영된다.
    await request(app).put("/api/compliance/M02").set("Authorization", auth).send({ status: "covered", note: "접근통제 적용" });
    res = await request(app).get("/api/assets/ai-x/aibom/threats").set("Authorization", auth);
    const m02 = res.body.matches.find((m: { code: string }) => m.code === "M02");
    expect(m02.status).toBe("covered");
    expect(res.body.summary.covered).toBe(1);
  });

  it("GET /api/compliance returns the catalog with default status 'open'", async () => {
    const res = await request(app).get("/api/compliance").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(21);
    expect(res.body.every((t: { status: string }) => t.status === "open")).toBe(true);
    const m06 = res.body.find((t: { code: string }) => t.code === "M06");
    expect(m06.name).toBe("탈옥");
    expect(m06.categoryLabel).toBe("모델 위협");
  });

  it("PUT updates a threat's compliance status and note, and it persists", async () => {
    const put = await request(app)
      .put("/api/compliance/M03")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "covered", note: "시스템 프롬프트 서버 보관, 응답에 미노출" });
    expect(put.status).toBe(200);
    expect(put.body.status).toBe("covered");

    const list = await request(app).get("/api/compliance").set("Authorization", `Bearer ${token}`);
    const m03 = list.body.find((t: { code: string }) => t.code === "M03");
    expect(m03.status).toBe("covered");
    expect(m03.note).toContain("미노출");
  });

  it("includes KISA 별첨2 evaluation criteria (impact/good/weak) for each threat", async () => {
    const res = await request(app).get("/api/compliance").set("Authorization", `Bearer ${token}`);
    const m03 = res.body.find((t: { code: string }) => t.code === "M03");
    expect(m03.criteria.good).toContain("거절");
    expect(m03.criteria.weak).toContain("프롬프트 주입");
    // 모든 위협이 양호/취약 판정 기준을 갖는다
    for (const t of res.body) {
      expect(t.criteria.good.length).toBeGreaterThan(0);
      expect(t.criteria.weak.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown threat code or invalid status", async () => {
    const badCode = await request(app).put("/api/compliance/ZZ9").set("Authorization", `Bearer ${token}`).send({ status: "covered" });
    expect(badCode.status).toBe(400);
    const badStatus = await request(app).put("/api/compliance/M03").set("Authorization", `Bearer ${token}`).send({ status: "maybe" });
    expect(badStatus.status).toBe(400);
  });

  it("AI 초안: 위협에 대해 유효한 상태 + 근거 note를 200으로 반환", async () => {
    const r = await request(app).post("/api/compliance/M06/draft").set("Authorization", `Bearer ${token}`).send({});
    expect(r.status).toBe(200);
    expect(["covered", "partial", "na", "open"]).toContain(r.body.status);
    expect(typeof r.body.note).toBe("string");
    expect(r.body.note).toContain("🤖 AI 초안"); // 담당자 검토 표식
  });
});
