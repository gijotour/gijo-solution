import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// LLM 스텁(리포 공통 패턴). 이 파일의 "AI 초안" 테스트는 **모델 출력을 파싱해 상태·근거로
// 나누는 라우트 로직**을 보는 것이지 모델 판단력을 보는 게 아니다. 스텁이 없어 실제
// llama-server를 호출했고, 서버가 떠 있으면 15초 제한을 넘겨 전체 병렬 실행에서 흔들렸다.
// 게다가 실제 호출일 때는 응답이 무엇이든 파서가 기본값 partial로 떨어져 통과해버려,
// 파싱이 깨져도 이 테스트가 잡지 못했다(스텁으로 바꾸며 단언을 조였다).
const DRAFT_REPLY = "상태: covered\n등록 AI 자산 전부에 AI-BOM이 작성돼 있고 스캔 취약점도 0건입니다. 분기별 재점검만 유지하세요.";
const mockChat = vi.fn(async () => DRAFT_REPLY);
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

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

  it("AI 초안: 모델이 낸 상태를 파싱하고 근거를 note로 분리한다", async () => {
    const r = await request(app).post("/api/compliance/M06/draft").set("Authorization", `Bearer ${token}`).send({});
    expect(r.status).toBe(200);
    // 기본값(partial)이 아니라 **모델이 낸 값**을 읽었는지 — 파서가 죽으면 여기서 걸린다.
    expect(r.body.status).toBe("covered");
    expect(r.body.note).toContain("🤖 AI 초안"); // 담당자 검토 표식
    expect(r.body.note).toContain("분기별 재점검"); // 근거 본문 보존
    expect(r.body.note).not.toContain("상태: covered"); // '상태:' 줄은 note에서 제거
  });

  it("AI 초안: 모델이 상태를 안 내면 partial로 떨어진다(안전한 기본값)", async () => {
    mockChat.mockResolvedValueOnce("판단하기 어렵습니다. 자료를 더 주세요.");
    const r = await request(app).post("/api/compliance/M06/draft").set("Authorization", `Bearer ${token}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("partial");
    expect(r.body.note).toContain("판단하기 어렵습니다");
  });
});
