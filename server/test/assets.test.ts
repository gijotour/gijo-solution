import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// 스캔 dispatch가 findings 상태를 어떻게 다루는지만 검증한다. 실제 로컬 LLM/모델 로딩에
// 의존하지 않도록 llm을 목킹한다(라우팅·분석 요약용 chat 호출이 실제 모델을 띄우지 않게).
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "요약: 스캔 결과 정리."),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests, setAssetRobustness, registerAsset, recordFindings, getAsset } from "../src/engine/assets";
// 「예시 데이터 판정」 시험 전용 — 자산 밖 나머지 네 시드(점검·조치·제품·CTI)를 직접 비우거나
// 채워 넣어 예시데이터뿐인가()의 다섯 갈래를 하나씩 격리해서 잰다. CTI만 삽입용 공개 API가
// 없어(벤더 동기화 아니면 시드뿐) datacleanup.test.ts:40과 같은 방식으로 db에 직접 넣는다.
import { resetMaintenanceForTests, createMaintenanceItem } from "../src/engine/maintenance";
import { resetTasksForTests, createTask } from "../src/engine/tasks";
import { resetSecurityProductsForTests, createProduct } from "../src/engine/securityproducts";
import { resetFeedsForTests } from "../src/engine/cti";
import { db } from "../src/db";

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

  it("읽을 때 finding에 한글 한 줄(plain)을 붙인다 — 규칙 매칭분만, 저장 아님 (전-7 ③)", () => {
    registerAsset({ id: "vuln-host-x", name: "10.0.0.9", path: "p" });
    recordFindings("vuln-host-x", [
      { finding_type: "Apache Log4j < 2.15.0 Remote Code Execution (CVE-2021-44228)", severity: "critical", evidence: "e", source_tool: "nessus" },
      { finding_type: "scan_error", severity: "info", evidence: "e", source_tool: "nessus" },
    ]);
    const asset = getAsset("vuln-host-x")!;
    const log4j = asset.findings.find((f) => f.finding_type.includes("Log4j"))!;
    const nomatch = asset.findings.find((f) => f.finding_type === "scan_error")!;
    expect(log4j.plain).toContain("원하는 명령을 실행"); // 규칙(실행) — RCE는 배포판·버전 규칙보다 우선
    expect(nomatch.plain).toBeUndefined();               // 어느 규칙에도 안 걸리면 안 붙인다(원문만)
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

  // ⚠ 2026-08-19 D5로 **계약이 뒤집혔다.** 예전엔 재등록이 findings·scan_runs를 초기화했는데,
  //   그 동작이 「같은 이름으로 다시 등록하는 순간 취약점·이력이 담당자 모르게 통째로 사라지는」
  //   자료 유실로 판정됐다(실패스캔 사고와 같은 결과, 다른 경로). 이제 재등록 = 메타 갱신이고
  //   findings·scan_runs는 **보존**된다. 이 시험은 그 새 계약을 지킨다.
  it("re-registering the same id preserves findings/scan history (D5: 재등록은 메타 갱신)", async () => {
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
    // 보존된다 — 지워지면 D5 회귀다.
    expect(after.body.findings.length).toBeGreaterThan(0);
    expect(after.body.scanHistory.length).toBeGreaterThan(0);
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

// ── 목록 응답 크기 — [2026-08-03 실측: 14.69MB 중 93%가 화면이 안 읽는 이력이었다] ──
describe("자산 목록은 스캔 이력을 싣지 않는다", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("★ 목록에는 scanHistory가 없고, 몇 번 점검했는지만 남는다", async () => {
    await request(app).post("/api/assets").set("Authorization", `Bearer ${token}`).send({ id: "list-slim", name: "슬림", path: "p" });
    const list = await request(app).get("/api/assets").set("Authorization", `Bearer ${token}`);
    const row = (list.body as Record<string, unknown>[]).find((a) => a.id === "list-slim")!;
    expect(row, "자산이 목록에 있어야 이 시험이 뜻이 있다").toBeTruthy();
    expect(row.scanHistory, "이력을 목록에 실으면 담당자 PC가 13MB를 받아 버린다").toBeUndefined();
    expect(typeof row.scanCount, "몇 번 점검했는지는 남긴다 — 없애면 이력이 없다로 읽힌다").toBe("number");
  });

  it("⚠ 상세 조회에서는 그대로 준다 — 거기서는 이력이 뜻이 있다", async () => {
    await request(app).post("/api/assets").set("Authorization", `Bearer ${token}`).send({ id: "detail-full", name: "상세", path: "p" });
    const one = await request(app).get("/api/assets/detail-full").set("Authorization", `Bearer ${token}`);
    expect(Array.isArray(one.body.scanHistory), "상세는 이력을 그대로 준다").toBe(true);
  });
});

// 예시 데이터를 「진짜」로 내보내지 않는가 (2026-08-09).
//
// 실측: 새로 설치한 앱에서 고객이 처음 던진 질문의 답이
//   「[P0] 실제 악용(KEV) 1건 — 공격이 실제로 쓰이는 취약점, 이번 주 안에 막아야 합니다」
// 였다. **가짜 P0로 시작하는 첫인상**이다. 데이터 자체는 정직하게 표시돼 있었는데
// (source_tool="샘플" · owner="샘플(예시)") 답이 그 표시를 옮기지 않았다.
//
// ⚠ 2026-09-13 넓힘(계획서 §13.5.2 「예시데이터 머리말 점검 시드」) — 판정이 자산 표
//   하나만 보다가, 첫 기동 시드 여섯 곳(자산 2·점검 6·조치 3·제품 4·CTI 5) 중 **하나라도**
//   원본 그대로 남아 있으면 true인 OR 판정으로 뒤집혔다(datacleanup.ts:76 「seedXIfEmpty
//   6곳」). 옛 첫 시험은 `typeof … toBe("boolean")`이라 무슨 일이 나도 초록이었다 — 이제
//   값을 잰다. 다섯 갈래를 서로 오염 없이 재려고 이 describe만 다른 네 표까지 매번 비운다.
describe("예시 데이터 판정", () => {
  beforeEach(() => {
    // ⚠ 이 describe는 위 describe("assets")의 형제이지 자식이 아니다 — 그쪽 beforeEach(로그인 포함)는
    //   여기 안 걸린다. 다섯 표를 전부 이 자리에서 직접 비워야 갈래가 서로 오염되지 않는다.
    resetAssetsForTests();
    resetMaintenanceForTests();
    resetTasksForTests();
    resetSecurityProductsForTests();
    resetFeedsForTests(); // cti_findings까지 지운다 — cti.ts 모듈 로드시 자동 시드된 5건 제거
  });

  it("다섯 표가 전부 비어 있고 자산도 없으면 false — 「예시뿐」이 아니라 「아무것도 없음」이다", async () => {
    const { 예시데이터뿐인가, listAssets } = await import("../src/engine/assets");
    expect(listAssets().length, "이 시험은 자산도 0이어야 한다").toBe(0);
    expect(예시데이터뿐인가()).toBe(false);
  });

  it("자산 시드만 새로 심으면 예시뿐이라고 본다", async () => {
    const { 예시데이터뿐인가, seedSampleAssetsIfEmpty, seedSampleVulnHostIfEmpty } = await import("../src/engine/assets");
    seedSampleAssetsIfEmpty();
    seedSampleVulnHostIfEmpty();
    expect(예시데이터뿐인가()).toBe(true);
  });

  it("실제 자산 1건만 들어오고 다른 시드가 전혀 없으면 false", async () => {
    const { 예시데이터뿐인가, registerAsset } = await import("../src/engine/assets");
    registerAsset({ id: "real-one-01", name: "진짜 자산", path: "/srv/real", assetType: "LLM 서비스", owner: "보안팀" });
    expect(예시데이터뿐인가()).toBe(false);
  });

  it("★ 자산이 진짜여도 점검 시드 하나(제목+제품명)가 원본 그대로 남아 있으면 계속 true다 — 이 항목의 핵심", async () => {
    const { 예시데이터뿐인가, registerAsset } = await import("../src/engine/assets");
    registerAsset({ id: "real-one-02", name: "진짜 자산 2", path: "/srv/real2", assetType: "LLM 서비스", owner: "보안팀" });
    // maintenance.ts:420 seedSamplesIfEmpty()가 심는 여섯 쌍 중 하나와 글자까지 같다.
    createMaintenanceItem({ title: "프롬프트 가드레일 점검", productName: "보안 상담 챗봇", scheduleDate: "2026-01-01" });
    expect(예시데이터뿐인가(), "자산이 진짜여도 점검 시드가 남으면 예시 고지가 꺼지면 안 된다").toBe(true);
  });

  it("자산이 진짜여도 조치 시드(담당자=샘플담당)가 남아 있으면 계속 true다", async () => {
    const { 예시데이터뿐인가, registerAsset } = await import("../src/engine/assets");
    registerAsset({ id: "real-one-03", name: "진짜 자산 3", path: "/srv/real3", assetType: "LLM 서비스", owner: "보안팀" });
    createTask({ text: "[조치] 시험용", priority: "P2", assignee: "샘플담당" }); // tasks.ts:252 seedSampleRemediationTasksIfEmpty() 공통 담당자
    expect(예시데이터뿐인가()).toBe(true);
  });

  it("자산이 진짜여도 제품 시드(이름 4종 중 하나)가 남아 있으면 계속 true다", async () => {
    const { 예시데이터뿐인가, registerAsset } = await import("../src/engine/assets");
    registerAsset({ id: "real-one-04", name: "진짜 자산 4", path: "/srv/real4", assetType: "LLM 서비스", owner: "보안팀" });
    createProduct({ name: "경계 방화벽 (FW-01)", category: "방화벽" }); // securityproducts.ts:536 seedSampleProductsIfEmpty() 이름 그대로
    expect(예시데이터뿐인가()).toBe(true);
  });

  it("자산이 진짜여도 CTI 시드(출처=샘플(데모))가 남아 있으면 계속 true다", async () => {
    const { 예시데이터뿐인가, registerAsset } = await import("../src/engine/assets");
    registerAsset({ id: "real-one-05", name: "진짜 자산 5", path: "/srv/real5", assetType: "LLM 서비스", owner: "보안팀" });
    // cti.ts는 finding 삽입 공개 API가 없다(벤더 동기화 아니면 시드뿐) — datacleanup.test.ts:40과
    // 같은 방식으로 db에 직접 넣는다. source가 cti.ts:230 seedSampleFindingsIfEmpty()의 표식이다.
    db.prepare(
      "INSERT INTO cti_findings (id, feedId, detectedAt, type, target, source, severity, collectedAt) VALUES (?,?,?,?,?,?,?,?)"
    ).run("test-cti-1", "test", "2026-01-01 00:00", "type", "target", "샘플(데모)", "info", Date.now());
    expect(예시데이터뿐인가()).toBe(true);
  });
});
