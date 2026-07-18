import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";
import { buildSpdxJson } from "../src/engine/sbom";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("sbom", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({
        id: "fraud-detect-llm",
        name: "fraud-detect-llm",
        path: "models/fraud.gguf",
        components: [{ name: "torch", version: "2.6.0", license: "BSD-3-Clause" }],
      });
  });

  it("generates a CycloneDX SBOM from the asset's real components", async () => {
    const res = await request(app).post("/api/sbom/fraud-detect-llm/generate").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.format).toBe("cyclonedx");
    expect(res.body.components).toEqual([{ name: "torch", version: "2.6.0", license: "BSD-3-Clause", knownVulns: [] }]);
  });

  it("marks the asset as sbomGenerated after a successful generate", async () => {
    await request(app).post("/api/sbom/fraud-detect-llm/generate").set("Authorization", `Bearer ${token}`);
    const asset = await request(app).get("/api/assets/fraud-detect-llm").set("Authorization", `Bearer ${token}`);
    expect(asset.body.sbomGeneratedAt).not.toBeNull();
  });

  it("writes a real CycloneDX 1.5 JSON file when exported", async () => {
    const res = await request(app)
      .post("/api/sbom/fraud-detect-llm/export")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "cyclonedx" });
    expect(res.status).toBe(200);
    expect(res.body.path).toContain("fraud-detect-llm.cyclonedx.json");
  });

  it("writes a real SPDX 2.3 JSON file when exported", async () => {
    const res = await request(app)
      .post("/api/sbom/fraud-detect-llm/export")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "spdx" });
    expect(res.status).toBe(200);
    expect(res.body.path).toContain("fraud-detect-llm.spdx.json");

    const doc = JSON.parse(fs.readFileSync(res.body.path, "utf-8"));
    expect(doc.spdxVersion).toBe("SPDX-2.3");
    expect(doc.SPDXID).toBe("SPDXRef-DOCUMENT");
    // 루트 패키지 + 컴포넌트(torch) 패키지
    expect(doc.packages.map((p: { name: string }) => p.name)).toContain("torch");
    // 문서가 루트를 DESCRIBES하고 루트가 컴포넌트를 CONTAINS
    expect(doc.relationships.some((r: { relationshipType: string }) => r.relationshipType === "DESCRIBES")).toBe(true);
    expect(doc.relationships.some((r: { relationshipType: string }) => r.relationshipType === "CONTAINS")).toBe(true);
  });

  it("exports an AI-BOM (CycloneDX ML-BOM) weaving in the 5 AI-BOM areas, prompt hashed", async () => {
    await request(app)
      .put("/api/assets/fraud-detect-llm/aibom")
      .set("Authorization", `Bearer ${token}`)
      .send({
        aibom: {
          model: { foundationModel: "Qwen2.5-7B", finetuneHistory: "SFT v1", architecture: "", weightsHash: "", intendedUse: "사내 보안 상담 전용", limitations: "법률 자문 불가" },
          dataset: { sources: "사내 문서", vectorDbLocation: "LanceDB" },
          prompt: { systemPrompt: "비밀 시스템 프롬프트", guardrails: "PII 마스킹" },
          agentTool: { apis: "내부 API", mcpServers: "" },
          infrastructure: { compute: "RTX 3090", hostingProvider: "온프레미스" },
        },
      });

    const res = await request(app).post("/api/sbom/fraud-detect-llm/aibom-export").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.filename).toContain("fraud-detect-llm.aibom.cyclonedx.json");

    const bom = JSON.parse(res.body.json);
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe("1.5");
    expect(bom.metadata.component.type).toBe("machine-learning-model");
    const props: Record<string, string> = Object.fromEntries(
      (bom.metadata.component.properties || []).map((p: { name: string; value: string }) => [p.name, p.value])
    );
    expect(props["gijo:infra:hostingProvider"]).toBe("온프레미스");
    // 모델 정보는 property가 아니라 표준 modelCard에 있어야 한다(외부 도구가 읽는 자리).
    const card = bom.metadata.component.modelCard;
    expect(card.modelParameters.architectureFamily).toBe("Qwen2.5-7B");
    expect(card.considerations.useCases).toEqual(["사내 보안 상담 전용"]);
    expect(card.considerations.technicalLimitations).toEqual(["법률 자문 불가"]);
    expect(props["gijo:model:foundationModel"]).toBeUndefined(); // 승격됐으므로 property에는 없다
    // 시스템 프롬프트는 원문 대신 SHA-256 해시만 — 원문이 문서에 없어야 한다.
    expect(props["gijo:prompt:systemPromptSha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.json).not.toContain("비밀 시스템 프롬프트");
    // 데이터셋 = data 컴포넌트, 코드 의존성 = library 컴포넌트
    const types = (bom.components || []).map((c: { type: string }) => c.type);
    expect(types).toContain("data");
    expect((bom.components || []).some((c: { name: string }) => c.name === "torch")).toBe(true);
  });

  // 증적 문서라 "언제·무엇으로 만들었는지"가 문서 안에 있어야 한다.
  it("AI-BOM metadata에 timestamp·tools·supplier가 들어간다", async () => {
    const res = await request(app).post("/api/sbom/fraud-detect-llm/aibom-export").set("Authorization", `Bearer ${token}`);
    const bom = JSON.parse(res.body.json);
    expect(bom.metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(bom.metadata.tools[0]).toMatchObject({ vendor: "GIJO Technology", name: "GIJO AS" });
    expect(bom.metadata.supplier.name).toBe("GIJO Technology");
  });

  // 가중치 해시는 property가 아니라 표준 hashes 필드에 있어야 무결성 검증 도구가 읽는다.
  it("weightsHash를 표준 hashes(SHA-256)로 싣고, 형식이 아니면 property로 남긴다", async () => {
    const hex = "a".repeat(64);
    const put = (weightsHash: string) =>
      request(app)
        .put("/api/assets/fraud-detect-llm/aibom")
        .set("Authorization", `Bearer ${token}`)
        .send({ aibom: { model: { foundationModel: "Qwen2.5-7B", finetuneHistory: "", architecture: "", weightsHash, intendedUse: "", limitations: "" } } });
    const exp = async () =>
      JSON.parse((await request(app).post("/api/sbom/fraud-detect-llm/aibom-export").set("Authorization", `Bearer ${token}`)).body.json);

    await put(`sha256:${hex}`); // 접두사는 벗기고 표준 필드로
    let bom = await exp();
    expect(bom.metadata.component.hashes).toEqual([{ alg: "SHA-256", content: hex }]);
    const names = (bom.metadata.component.properties || []).map((p: { name: string }) => p.name);
    expect(names).not.toContain("gijo:model:weightsHash");

    await put("아직-계산-안-함"); // SHA-256이 아니면 표준 필드를 오염시키지 않는다
    bom = await exp();
    expect(bom.metadata.component.hashes).toBeUndefined();
    const props: Record<string, string> = Object.fromEntries(
      (bom.metadata.component.properties || []).map((p: { name: string; value: string }) => [p.name, p.value])
    );
    expect(props["gijo:model:weightsHash"]).toBe("아직-계산-안-함");
  });

  // 노출 위협은 property 문자열이 아니라 표준 vulnerabilities(VEX)로 — 대응 상태를 기계가 읽는다.
  it("KISA 위협을 vulnerabilities로 싣고 대응 상태를 analysis.state로 옮긴다", async () => {
    await request(app)
      .put("/api/assets/fraud-detect-llm/aibom")
      .set("Authorization", `Bearer ${token}`)
      .send({
        aibom: {
          model: { foundationModel: "Qwen2.5-7B", finetuneHistory: "", architecture: "", weightsHash: "", intendedUse: "", limitations: "" },
          agentTool: { apis: "내부 API", mcpServers: "" },
        },
      });
    const res = await request(app).post("/api/sbom/fraud-detect-llm/aibom-export").set("Authorization", `Bearer ${token}`);
    const bom = JSON.parse(res.body.json);

    const threats = (bom.vulnerabilities || []).filter((v: { source?: { name: string } }) => v.source?.name?.includes("KISA"));
    expect(threats.length).toBeGreaterThan(0);
    expect(threats[0].analysis.state).toBeTruthy();
    expect(threats[0].affects[0].ref).toBe(bom.metadata.component["bom-ref"]); // 루트 자산에 걸린다
    // 옛 방식(property로 나가던 gijo:threat:<code>)은 더 이상 쓰지 않는다.
    const names = (bom.metadata.component.properties || []).map((p: { name: string }) => p.name);
    expect(names.some((n: string) => n.startsWith("gijo:threat:"))).toBe(false);
  });

  // 데이터셋은 property가 아니라 표준 componentData(contents·governance)에 실려야 한다.
  it("데이터셋을 componentData로 싣고 modelCard가 그 bom-ref를 참조한다", async () => {
    await request(app)
      .put("/api/assets/fraud-detect-llm/aibom")
      .set("Authorization", `Bearer ${token}`)
      .send({ aibom: { dataset: { sources: "사내 문서", vectorDbLocation: "LanceDB" } } });
    const res = await request(app).post("/api/sbom/fraud-detect-llm/aibom-export").set("Authorization", `Bearer ${token}`);
    const bom = JSON.parse(res.body.json);

    const dataComp = (bom.components || []).find((c: { type: string }) => c.type === "data");
    expect(dataComp.data[0].type).toBe("dataset");
    const names = dataComp.data[0].contents.properties.map((p: { name: string }) => p.name);
    expect(names).toContain("gijo:dataset:sources");
    expect(dataComp.properties).toBeUndefined(); // contents로 옮겼으니 중복이 없어야 한다
    // modelCard가 데이터셋을 bom-ref로 가리킨다.
    expect(bom.metadata.component.modelCard.modelParameters.datasets[0].ref).toBe(dataComp["bom-ref"]);
  });

  // 레드팀 실측 결과는 modelCard.quantitativeAnalysis에 — 제품 차별점이 표준 문서에 나가야 한다.
  it("레드팀 견고성 점수를 quantitativeAnalysis로 싣고, 미점검이면 싣지 않는다", async () => {
    const exp = async () =>
      JSON.parse((await request(app).post("/api/sbom/fraud-detect-llm/aibom-export").set("Authorization", `Bearer ${token}`)).body.json);

    expect((await exp()).metadata.component.modelCard?.quantitativeAnalysis).toBeUndefined(); // 미점검

    await request(app)
      .put("/api/assets/fraud-detect-llm/aibom")
      .set("Authorization", `Bearer ${token}`)
      .send({ aibom: { robustness: { score: 21, vulnerable: 11, total: 14, ranAt: 1700000000000, modelId: "orchestrator" } } });

    const metrics = (await exp()).metadata.component.modelCard.quantitativeAnalysis.performanceMetrics;
    expect(metrics).toContainEqual({ type: "레드팀 견고성 점수", value: "21 / 100", slice: "orchestrator" });
    expect(metrics).toContainEqual({ type: "레드팀 뚫린 페이로드", value: "11 / 14" });
  });

  // 자산 id의 콜론(vuln:10.0.0.1)은 Windows 파일명에 못 쓴다 — 그대로 쓰면 NTFS 대체 스트림에 조용히 기록된다.
  it("콜론이 든 자산 id도 정상 파일명으로 내보낸다", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "vuln:10.0.0.1", name: "스캔 자산", path: "/tmp", assetType: "host", owner: "보안팀" });
    const res = await request(app).post(`/api/sbom/${encodeURIComponent("vuln:10.0.0.1")}/aibom-export`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("vuln_10.0.0.1.aibom.cyclonedx.json");
    expect(fs.existsSync(res.body.path)).toBe(true);
    expect(fs.statSync(res.body.path).size).toBeGreaterThan(0);
  });

  it("weights-hash: 파일을 스트리밍 SHA-256으로 계산해 AI-BOM에 기록, 없는 파일은 정직한 400", async () => {
    const tmp = path.join(os.tmpdir(), `gijo-weights-${Date.now()}.bin`);
    fs.writeFileSync(tmp, "fake-weights-content");
    const expected = "sha256:" + crypto.createHash("sha256").update("fake-weights-content").digest("hex");

    const res = await request(app)
      .post("/api/assets/fraud-detect-llm/aibom/weights-hash")
      .set("Authorization", `Bearer ${token}`)
      .send({ filePath: tmp });
    expect(res.status).toBe(200);
    expect(res.body.weightsHash).toBe(expected);
    expect(res.body.sizeBytes).toBeGreaterThan(0);

    // AI-BOM에 영속 반영됐는지
    const asset = await request(app).get("/api/assets/fraud-detect-llm").set("Authorization", `Bearer ${token}`);
    expect(asset.body.aibom.model.weightsHash).toBe(expected);
    fs.rmSync(tmp, { force: true });

    // 없는 파일 → 400 + 명확한 에러(추측·자동보정 없음)
    const bad = await request(app)
      .post("/api/assets/fraud-detect-llm/aibom/weights-hash")
      .set("Authorization", `Bearer ${token}`)
      .send({ filePath: path.join(os.tmpdir(), "no-such-weights-file.gguf") });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("파일을 찾을 수 없습니다");
  });

  it("buildSpdxJson uses valid SPDXID refs and NOASSERTION for missing fields", () => {
    const json = buildSpdxJson("asset-x", [{ name: "numpy", version: "", license: "", knownVulns: [] }]);
    const doc = JSON.parse(json);
    // 모든 SPDXID는 SPDXRef-[A-Za-z0-9.-]+ 형식이어야 한다(컴포넌트명이 특수문자여도 안전)
    for (const p of doc.packages) expect(p.SPDXID).toMatch(/^SPDXRef-[A-Za-z0-9.-]+$/);
    const numpy = doc.packages.find((p: { name: string }) => p.name === "numpy");
    expect(numpy.versionInfo).toBe("NOASSERTION"); // 빈 버전 → NOASSERTION
    expect(numpy.licenseDeclared).toBe("NOASSERTION"); // 빈 라이선스 → NOASSERTION
  });

  it("the server keeps serving requests after any export (asyncRoute isolation)", async () => {
    await request(app).post("/api/sbom/fraud-detect-llm/export").set("Authorization", `Bearer ${token}`).send({ format: "spdx" });
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });
});
