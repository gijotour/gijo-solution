// engine/sbom.ts — SBOM 생성 · 정리 (CycloneDX / SPDX, 6.4절)

import type { Express } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { Models, Enums, Spec, Serialize } from "@cyclonedx/cyclonedx-library";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { getAsset, markSbomGenerated, type AiBom } from "./assets";
import { isFindingRejected } from "./approvals";
import { aibomThreatMatches, type AiBomThreatMatch } from "./compliance";
// 스캔 실패 판정은 한 곳만 쓴다 — 두 벌 두면 하나는 반드시 낡는다.
import { isRealVulnerability } from "./agenttools";

export interface SbomComponent {
  name: string;
  version: string;
  license: string;
  knownVulns: string[];
}

export interface SbomDocument {
  assetId: string;
  format: "cyclonedx" | "spdx";
  components: SbomComponent[];
  generatedAt: string;
}

const EXPORT_DIR = path.join("data", "exports");

// 자산 id에는 콜론이 들어간다(vuln:10.0.0.1, discovered:qa:...). 콜론은 Windows에서 파일명에 못 쓰고,
// 그대로 쓰면 NTFS 대체 데이터 스트림에 조용히 기록되거나(파일이 0바이트로 보임) ENOENT로 터진다.
// 파일명에서만 치환한다 — 문서 안의 id는 원본 그대로 둔다.
function safeFileName(assetId: string): string {
  return assetId.replace(/[:<>"/\\|?*\x00-\x1f]/g, "_");
}

// SPDX 2.3 JSON — 표준 스키마라 별도 라이브러리 없이 직접 구성한다. 루트(자산=ML 모델) 패키지를
// 문서가 DESCRIBES하고, 각 컴포넌트 패키지를 루트가 CONTAINS하는 관계로 표현한다. SPDXID는
// `SPDXRef-[A-Za-z0-9.-]+`만 허용하므로 컴포넌트명 대신 인덱스 id를 쓰고 실제 이름은 name에 담는다.
export function buildSpdxJson(assetId: string, components: SbomComponent[]): string {
  const created = new Date().toISOString();
  const rootId = "SPDXRef-Package-Root";
  const pkgs = [
    {
      SPDXID: rootId,
      name: assetId,
      versionInfo: "NOASSERTION",
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      primaryPackagePurpose: "APPLICATION",
    },
    ...components.map((c, i) => ({
      SPDXID: `SPDXRef-Package-${i}`,
      name: c.name,
      versionInfo: c.version || "NOASSERTION",
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: c.license || "NOASSERTION",
      copyrightText: "NOASSERTION",
      primaryPackagePurpose: "LIBRARY",
    })),
  ];
  const relationships = [
    { spdxElementId: "SPDXRef-DOCUMENT", relatedSpdxElement: rootId, relationshipType: "DESCRIBES" },
    ...components.map((_, i) => ({
      spdxElementId: rootId,
      relatedSpdxElement: `SPDXRef-Package-${i}`,
      relationshipType: "CONTAINS",
    })),
  ];
  const doc = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `gijo-as-sbom-${assetId}`,
    documentNamespace: `https://gijo.ai/spdx/${encodeURIComponent(assetId)}-${Date.now()}`,
    creationInfo: { created, creators: ["Tool: GIJO-AS", "Organization: GIJO Technology"] },
    packages: pkgs,
    relationships,
  };
  return JSON.stringify(doc, null, 2);
}

function buildCycloneDxJson(assetId: string, components: SbomComponent[]): string {
  const bom = new Models.Bom();
  bom.metadata.component = new Models.Component(Enums.ComponentType.MachineLearningModel, assetId);

  for (const c of components) {
    const component = new Models.Component(Enums.ComponentType.Library, c.name, { version: c.version });
    if (c.license) component.licenses.add(new Models.NamedLicense(c.license));
    bom.components.add(component);
  }

  const serializer = new Serialize.JsonSerializer(new Serialize.JSON.Normalize.Factory(Spec.Spec1dot5));
  return serializer.serialize(bom, { space: 2 });
}

const PRODUCT = { vendor: "GIJO Technology", name: "GIJO AS", version: "2.0.0" };

// 증적 문서라 "언제·무엇으로·누가 만들었는지"가 문서 안에 있어야 한다(대외 제출 시 필수).
function fillMetadata(bom: Models.Bom): void {
  bom.metadata.timestamp = new Date();
  bom.metadata.tools.tools.add(new Models.Tool({ vendor: PRODUCT.vendor, name: PRODUCT.name, version: PRODUCT.version }));
  bom.metadata.supplier = new Models.OrganizationalEntity({ name: PRODUCT.vendor });
}

// 가중치 해시는 표준 hashes 필드에 실어야 무결성 검증 도구가 읽는다("sha256:" 접두사는 벗긴다).
// 형식이 SHA-256 hex가 아니면 표준 필드에 넣지 않고 property로 남긴다(잘못된 값으로 문서를 오염시키지 않기 위함).
function putWeightsHash(root: Models.Component, raw: string | undefined): void {
  const v = (raw ?? "").trim();
  if (!v) return;
  const hex = v.replace(/^sha-?256:/i, "").trim();
  if (/^[0-9a-f]{64}$/i.test(hex)) root.hashes.set(Enums.HashAlgorithm["SHA-256"], hex.toLowerCase());
  else root.properties.add(new Models.Property("gijo:model:weightsHash", v));
}

// finding_type/kevCves에서 CVE를 뽑아 취약점 id로 쓴다. 없으면 스캔 key로 대체(추적은 되게).
function vulnId(f: { finding_type: string; key?: string; kevCves?: string[] }): string {
  const m = /CVE-\d{4}-\d{4,}/i.exec(f.finding_type);
  if (m) return m[0].toUpperCase();
  if (f.kevCves && f.kevCves.length) return f.kevCves[0];
  return f.key ?? f.finding_type;
}

const SEVERITY: Record<string, Enums.Vulnerability.Severity> = {
  critical: Enums.Vulnerability.Severity.Critical,
  high: Enums.Vulnerability.Severity.High,
  medium: Enums.Vulnerability.Severity.Medium,
  low: Enums.Vulnerability.Severity.Low,
};

// 스캔 finding → CycloneDX vulnerabilities. 지금까지는 문서에서 통째로 빠져 있었다.
function addFindingVulns(bom: Models.Bom, rootRef: Models.BomRef, assetId: string): void {
  const asset = getAsset(assetId);
  for (const f of asset?.findings ?? []) {
    if (isFindingRejected(assetId, f)) continue; // 오탐 판정은 문서에 싣지 않는다
    // ⚠ 예전엔 scan_error만 손으로 걸러 scan_not_supported를 놓쳤다 — 같은 판정을 두 벌 두면
    //   하나는 반드시 낡는다. 판정은 isRealVulnerability 한 곳만 쓴다.
    if (!isRealVulnerability(f)) continue; // 스캔 실패·미지원은 운영 오류지 취약점이 아니다
    const v = new Models.Vulnerability.Vulnerability({ id: vulnId(f) });
    v.source = new Models.Vulnerability.Source({ name: `GIJO AS 스캔(${f.source_tool ?? "unknown"})` });
    v.description = f.finding_type;
    if (f.evidence) v.detail = f.evidence;
    const sev = SEVERITY[String(f.severity).toLowerCase()];
    if (sev) v.ratings.add(new Models.Vulnerability.Rating({ severity: sev, method: Enums.Vulnerability.RatingMethod.Other }));
    // KEV(실제 악용 확인)는 exploitable, 해소된 건 resolved, 나머지는 분류 중.
    const state = f.kev
      ? Enums.Vulnerability.AnalysisState.Exploitable
      : f.state === "fixed"
        ? Enums.Vulnerability.AnalysisState.Resolved
        : Enums.Vulnerability.AnalysisState.InTriage;
    v.analysis = new Models.Vulnerability.Analysis({ state });
    if (typeof f.epss === "number") v.properties.add(new Models.Property("gijo:vuln:epss", String(f.epss)));
    if (typeof f.vpr === "number") v.properties.add(new Models.Property("gijo:vuln:vpr", String(f.vpr)));
    if (f.kev) v.properties.add(new Models.Property("gijo:vuln:kev", "true"));
    v.affects.add(new Models.Vulnerability.Affect(rootRef));
    bom.vulnerabilities.add(v);
  }
}

// KISA AI 보안 위협(카탈로그) + 조직 대응 상태 → VEX. 상태를 analysis.state로 옮겨 기계가 읽게 한다.
// covered=해소, partial/open=분류 중(둘은 detail로 구분), na=해당 없음.
const THREAT_STATE: Record<string, Enums.Vulnerability.AnalysisState> = {
  covered: Enums.Vulnerability.AnalysisState.Resolved,
  partial: Enums.Vulnerability.AnalysisState.InTriage,
  open: Enums.Vulnerability.AnalysisState.InTriage,
  na: Enums.Vulnerability.AnalysisState.NotAffected,
};

function addThreatVulns(bom: Models.Bom, rootRef: Models.BomRef, threats: AiBomThreatMatch[]): void {
  for (const t of threats) {
    const v = new Models.Vulnerability.Vulnerability({ id: t.code });
    v.source = new Models.Vulnerability.Source({ name: "KISA AI 보안 위협 대응 매뉴얼" });
    v.description = t.name;
    const refs = [t.owasp?.length ? `OWASP: ${t.owasp.join(", ")}` : "", t.nist?.length ? `NIST: ${t.nist.join(", ")}` : ""].filter(Boolean);
    v.detail = [`대응 상태: ${t.status}`, `노출 영역: ${t.matchedAreas.join(", ")}`, ...refs].join(" / ");
    v.analysis = new Models.Vulnerability.Analysis({ state: THREAT_STATE[t.status] ?? Enums.Vulnerability.AnalysisState.InTriage });
    v.properties.add(new Models.Property("gijo:threat:status", t.status));
    v.properties.add(new Models.Property("gijo:threat:areas", t.matchedAreas.join(",")));
    v.affects.add(new Models.Vulnerability.Affect(rootRef));
    bom.vulnerabilities.add(v);
  }
}

// ── modelCard / componentData 병합 ────────────────────────────────────────
// CycloneDX 1.5는 ML-BOM용으로 component.modelCard와 component.data(componentData)를 정의하지만,
// @cyclonedx/cyclonedx-library v10에는 두 모델이 없다(Models.ModelCard/ComponentData 부재 — 실측).
// 그래서 라이브러리로 직렬화한 뒤 JSON에 직접 얹는다. 표준 자리에 실어야 외부 도구가 의미를 읽는다.
type Json = Record<string, unknown>;

// 값이 있는 항목만 담는다 — 빈 배열·빈 객체를 남기면 "명세했는데 비었다"로 잘못 읽힌다.
function arr(...vals: (string | undefined)[]): string[] | undefined {
  const out = vals.map((v) => (v ?? "").trim()).filter(Boolean);
  return out.length ? out : undefined;
}
function compact(o: Json): Json | undefined {
  const e = Object.entries(o).filter(([, v]) => v !== undefined);
  return e.length ? Object.fromEntries(e) : undefined;
}

function buildModelCard(aibom: AiBom, datasetRef: string | undefined): Json | undefined {
  const m = aibom.model;
  const modelParameters = compact({
    architectureFamily: arr(m.foundationModel)?.[0],
    modelArchitecture: arr(m.architecture)?.[0],
    datasets: datasetRef ? [{ ref: datasetRef }] : undefined,
  });
  const considerations = compact({
    useCases: arr(m.intendedUse),
    technicalLimitations: arr(m.limitations),
  });

  // 레드팀 견고성 실측 → quantitativeAnalysis.performanceMetrics (미점검이면 싣지 않는다).
  const r = aibom.robustness;
  const quantitativeAnalysis =
    r && r.score !== null
      ? {
          performanceMetrics: [
            { type: "레드팀 견고성 점수", value: `${r.score} / 100`, ...(r.modelId ? { slice: r.modelId } : {}) },
            { type: "레드팀 뚫린 페이로드", value: `${r.vulnerable} / ${r.total}` },
          ],
        }
      : undefined;

  const properties = [
    ...(arr(m.finetuneHistory) ? [{ name: "gijo:model:finetuneHistory", value: m.finetuneHistory.trim() }] : []),
    ...(arr(m.modelRef) ? [{ name: "gijo:model:modelRef", value: m.modelRef.trim() }] : []),
    ...(r && r.ranAt ? [{ name: "gijo:robustness:ranAt", value: new Date(r.ranAt).toISOString() }] : []),
  ];

  return compact({
    modelParameters,
    quantitativeAnalysis,
    considerations,
    properties: properties.length ? properties : undefined,
  });
}

// 데이터셋 property → 표준 componentData(contents·governance). owner는 자산 담당자를 그대로 쓴다.
function buildComponentData(aibom: AiBom, owner: string): Json[] | undefined {
  const d = aibom.dataset;
  const props = [
    ...(arr(d.sources) ? [{ name: "gijo:dataset:sources", value: d.sources.trim() }] : []),
    ...(arr(d.vectorDbLocation) ? [{ name: "gijo:dataset:vectorDbLocation", value: d.vectorDbLocation.trim() }] : []),
  ];
  if (!props.length) return undefined;
  return [
    compact({
      type: "dataset",
      name: "학습·참조 데이터셋",
      contents: { properties: props },
      governance: arr(owner) ? { owners: [{ contact: { name: owner.trim() } }] } : undefined,
    }) as Json,
  ];
}

// 직렬화된 CycloneDX JSON에 modelCard/componentData를 얹고, 표준 자리로 옮긴 property는 걷어낸다.
const PROMOTED = new Set([
  "gijo:model:foundationModel",
  "gijo:model:architecture",
  "gijo:model:intendedUse",
  "gijo:model:limitations",
  "gijo:model:finetuneHistory",
]);

function weaveMlBom(json: string, aibom: AiBom, owner: string): string {
  const doc = JSON.parse(json) as Json;
  const root = (doc.metadata as Json | undefined)?.component as Json | undefined;
  const components = (doc.components as Json[] | undefined) ?? [];
  const dataComp = components.find((c) => c.type === "data");

  if (dataComp) {
    const cd = buildComponentData(aibom, owner);
    if (cd) {
      dataComp.data = cd;
      delete dataComp.properties; // contents.properties로 옮겼으므로 중복 제거
    }
  }

  if (root) {
    const card = buildModelCard(aibom, dataComp?.["bom-ref"] as string | undefined);
    if (card) root.modelCard = card;
    const props = (root.properties as { name: string }[] | undefined) ?? [];
    const kept = props.filter((p) => !PROMOTED.has(p.name));
    if (kept.length) root.properties = kept;
    else delete root.properties;
  }

  return JSON.stringify(doc, null, 2);
}

// AI-BOM (CycloneDX ML-BOM) — 코드 SBOM에 AI 구성명세(모델·데이터셋·프롬프트·도구·인프라)를 더한 표준 문서.
// 루트를 machine-learning-model 컴포넌트로, AI-BOM 5영역을 properties/data 컴포넌트로 싣는다.
// 민감정보(시스템 프롬프트·가중치)는 원문 대신 해시/입력값만 담아 유출을 막는다.
function buildAiBomCycloneDx(
  assetId: string,
  name: string,
  owner: string,
  aibom: AiBom,
  components: SbomComponent[],
  threats: AiBomThreatMatch[]
): string {
  const bom = new Models.Bom();
  fillMetadata(bom);
  const root = new Models.Component(Enums.ComponentType.MachineLearningModel, name);
  const put = (comp: Models.Component, n: string, v: string | undefined) => {
    if (v && v.trim()) comp.properties.add(new Models.Property(n, v.trim()));
  };
  // 아래 5개는 weaveMlBom이 표준 modelCard로 옮기고 property에서는 걷어낸다(라이브러리에 modelCard 모델이 없어
  // 일단 property로 실은 뒤 후처리하는 구조). weightsHash만 라이브러리 표준 필드가 있어 바로 hashes로 간다.
  put(root, "gijo:model:foundationModel", aibom.model.foundationModel);
  put(root, "gijo:model:finetuneHistory", aibom.model.finetuneHistory);
  put(root, "gijo:model:architecture", aibom.model.architecture);
  putWeightsHash(root, aibom.model.weightsHash);
  put(root, "gijo:model:intendedUse", aibom.model.intendedUse);
  put(root, "gijo:model:limitations", aibom.model.limitations);
  // 시스템 프롬프트는 원문 대신 SHA-256 해시만(무결성 추적 + 유출 방지).
  if (aibom.prompt.systemPrompt && aibom.prompt.systemPrompt.trim())
    root.properties.add(
      new Models.Property("gijo:prompt:systemPromptSha256", crypto.createHash("sha256").update(aibom.prompt.systemPrompt).digest("hex"))
    );
  put(root, "gijo:prompt:guardrails", aibom.prompt.guardrails);
  put(root, "gijo:agentTool:apis", aibom.agentTool.apis);
  put(root, "gijo:agentTool:mcpServers", aibom.agentTool.mcpServers);
  put(root, "gijo:infra:compute", aibom.infrastructure.compute);
  put(root, "gijo:infra:hostingProvider", aibom.infrastructure.hostingProvider);
  bom.metadata.component = root;

  // 노출 위협·스캔 취약점은 property가 아니라 표준 vulnerabilities(VEX)로 싣는다 — 상태까지 기계가 읽는다.
  addThreatVulns(bom, root.bomRef, threats);
  addFindingVulns(bom, root.bomRef, assetId);

  // 데이터셋 → data 컴포넌트(값이 있을 때만).
  if ((aibom.dataset.sources ?? "").trim() || (aibom.dataset.vectorDbLocation ?? "").trim()) {
    const data = new Models.Component(Enums.ComponentType.Data, "학습·참조 데이터셋");
    put(data, "gijo:dataset:sources", aibom.dataset.sources);
    put(data, "gijo:dataset:vectorDbLocation", aibom.dataset.vectorDbLocation);
    bom.components.add(data);
  }

  // 코드 의존성(기존 SBOM 컴포넌트)도 같은 문서에 포함 → SBOM + AI 메타가 한 문서에.
  for (const c of components) {
    const comp = new Models.Component(Enums.ComponentType.Library, c.name, { version: c.version });
    if (c.license) comp.licenses.add(new Models.NamedLicense(c.license));
    bom.components.add(comp);
  }

  const serializer = new Serialize.JsonSerializer(new Serialize.JSON.Normalize.Factory(Spec.Spec1dot5));
  // 라이브러리가 못 만드는 modelCard/componentData는 직렬화 결과에 얹는다.
  return weaveMlBom(serializer.serialize(bom, { space: 2 }), aibom, owner);
}

// AI-BOM 문서를 생성해 파일로 저장하고 내용(json)까지 함께 돌려준다(클라이언트가 바로 다운로드).
export async function exportAiBom(assetId: string): Promise<{ path: string; filename: string; json: string }> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("자산을 찾을 수 없습니다");
  const { components } = await generateSbom(assetId); // 코드 의존성은 기존 SBOM 로직 재사용
  const threats = aibomThreatMatches(assetId).matches; // AI-BOM 기반 노출 위협 + 대응 상태
  const json = buildAiBomCycloneDx(assetId, asset.name, asset.owner, asset.aibom, components, threats);
  await fs.mkdir(EXPORT_DIR, { recursive: true });
  const filename = `${safeFileName(assetId)}.aibom.cyclonedx.json`;
  const filePath = path.join(EXPORT_DIR, filename);
  await fs.writeFile(filePath, json, "utf-8");
  return { path: filePath, filename, json };
}

export async function generateSbom(assetId: string): Promise<SbomDocument> {
  const asset = getAsset(assetId);
  // ⚠ 없는 자산에 "생성됨" 기록을 남기지 않는다(2026-08-02 전수 점검에서 발견).
  //   예전엔 asset이 없어도 markSbomGenerated가 먼저 불려, 목록에 없는 자산이 생성된 것처럼 남았다.
  if (!asset) throw new Error(`자산을 찾을 수 없습니다: ${assetId}`);
  // 승인 워크플로우: 오탐(rejected)으로 처리된 finding은 SBOM 취약점 반영에서 제외한다
  // (미검토 pending은 아직 반영 — "확인 안 됨"을 "안전"으로 오해시키지 않기 위함).
  const activeFindings = (asset?.findings ?? []).filter((f) => !isFindingRejected(assetId, f) && isRealVulnerability(f));
  const components: SbomComponent[] = (asset?.components ?? []).map((c) => ({
    name: c.name,
    version: c.version,
    license: c.license,
    knownVulns: activeFindings.filter((f) => f.evidence.includes(c.name)).map((f) => f.finding_type),
  }));
  markSbomGenerated(assetId);
  return { assetId, format: "cyclonedx", components, generatedAt: new Date().toISOString() };
}

export async function exportSbom(assetId: string, format: "cyclonedx" | "spdx"): Promise<string> {
  const { components } = await generateSbom(assetId);
  const json = format === "spdx" ? buildSpdxJson(assetId, components) : buildCycloneDxJson(assetId, components);

  await fs.mkdir(EXPORT_DIR, { recursive: true });
  const filePath = path.join(EXPORT_DIR, `${safeFileName(assetId)}.${format}.json`);
  await fs.writeFile(filePath, json, "utf-8");
  return filePath;
}

export function registerSbomRoutes(app: Express): void {
  app.post(
    "/api/sbom/:assetId/generate",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await generateSbom(String(req.params.assetId)));
    })
  );
  app.post(
    "/api/sbom/:assetId/export",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json({ path: await exportSbom(String(req.params.assetId), req.body.format) });
    })
  );
  // AI-BOM(CycloneDX ML-BOM) 내보내기 — 파일 저장 + 내용(json) 반환(클라이언트가 바로 다운로드).
  app.post(
    "/api/sbom/:assetId/aibom-export",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await exportAiBom(String(req.params.assetId)));
    })
  );
}
