import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { matchCtiToAssets, assetSignals } from "../src/engine/ctimatch";
import type { Asset } from "../src/engine/assets";
import type { CtiFinding } from "../src/engine/cti";
import { emptyAiBom } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

function asset(over: Partial<Asset>): Asset {
  return {
    id: "a1", name: "asset", path: "p", assetType: "LLM 서비스", owner: "-",
    components: [], findings: [], scanHistory: [], aibom: emptyAiBom(),
    registeredAt: 0, lastScannedAt: null, sbomGeneratedAt: null, ...over,
  };
}
function finding(over: Partial<CtiFinding>): CtiFinding {
  return { id: "f1", detectedAt: "2026-07-16 00:00", type: "위협 인텔 Pulse", target: "", source: "OTX", severity: "info", ...over };
}

describe("ctimatch (CTI ↔ 자산 자동 매칭)", () => {
  it("matches a finding to an asset when a component name appears in the threat target", () => {
    const assets = [asset({ id: "chatbot", name: "보안 챗봇", components: [{ name: "torch", version: "2.6", license: "BSD" }] })];
    const findings = [finding({ target: "Supply-chain attack abusing torch pickle deserialization", severity: "critical" })];
    const { matches, summary } = matchCtiToAssets(findings, assets);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedAssets[0].assetId).toBe("chatbot");
    expect(matches[0].matchedAssets[0].matchedOn).toContain("torch");
    expect(summary).toMatchObject({ totalFindings: 1, matchedFindings: 1, affectedAssets: 1, criticalMatches: 1 });
  });

  it("matches on a shared CVE identifier from asset findings", () => {
    const assets = [asset({ id: "svc", name: "추론 서버", findings: [{ finding_type: "vuln", severity: "high", evidence: "CVE-2024-12345 in vllm", source_tool: "nessus" }] })];
    const findings = [finding({ target: "Active exploitation of CVE-2024-12345", severity: "warning" })];
    const { matches } = matchCtiToAssets(findings, assets);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedAssets[0].matchedOn).toContain("cve-2024-12345");
  });

  it("does not over-match on generic words (model, security, attack, llm)", () => {
    const assets = [asset({ id: "x", name: "AI 모델 서비스", assetType: "LLM 서비스" })];
    const findings = [finding({ target: "New malware campaign targets AI model security", type: "위협 캠페인" })];
    // 'model','security','ai','llm','attack' 등은 불용어라 근거가 되지 않는다 → 매칭 없음
    expect(matchCtiToAssets(findings, assets).matches).toHaveLength(0);
  });

  it("counts multiple affected assets and only reports findings with a match", () => {
    const assets = [
      asset({ id: "a", name: "챗봇", components: [{ name: "transformers", version: "4", license: "Apache" }] }),
      asset({ id: "b", name: "분류기", components: [{ name: "transformers", version: "4", license: "Apache" }] }),
      asset({ id: "c", name: "무관자산", components: [{ name: "numpy", version: "1", license: "BSD" }] }),
    ];
    const findings = [
      finding({ id: "hit", target: "transformers RCE PoC released" }),
      finding({ id: "miss", target: "Phishing kit targeting banking portals" }),
    ];
    const { matches, summary } = matchCtiToAssets(findings, assets);
    expect(matches).toHaveLength(1);
    expect(matches[0].finding.id).toBe("hit");
    expect(matches[0].matchedAssets.map((m) => m.assetId).sort()).toEqual(["a", "b"]);
    expect(summary.affectedAssets).toBe(2);
  });

  it("assetSignals drops stopwords/numbers but keeps specific identifiers (hyphen-split)", () => {
    const sig = assetSignals(asset({ name: "security model", components: [{ name: "pytorch-lightning", version: "2", license: "Apache" }] }));
    expect(sig.has("security")).toBe(false); // 불용어
    expect(sig.has("model")).toBe(false); // 불용어
    // 하이픈으로 쪼갠 조각이 신호가 된다 → CTI가 "PyTorch"만 언급해도 잡힌다
    expect(sig.has("pytorch")).toBe(true);
    expect(sig.has("lightning")).toBe(true);
  });

  it("GET /api/cti/asset-matches returns the shape and requires auth", async () => {
    const app = createApp();
    const token = await login(app);
    const res = await request(app).get("/api/cti/asset-matches").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.matches)).toBe(true);
    expect(res.body.summary).toHaveProperty("affectedAssets");
    expect((await request(app).get("/api/cti/asset-matches")).status).toBe(401);
  });
});
