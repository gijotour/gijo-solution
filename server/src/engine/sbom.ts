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

// AI-BOM (CycloneDX ML-BOM) — 코드 SBOM에 AI 구성명세(모델·데이터셋·프롬프트·도구·인프라)를 더한 표준 문서.
// 루트를 machine-learning-model 컴포넌트로, AI-BOM 5영역을 properties/data 컴포넌트로 싣는다.
// 민감정보(시스템 프롬프트·가중치)는 원문 대신 해시/입력값만 담아 유출을 막는다.
function buildAiBomCycloneDx(name: string, aibom: AiBom, components: SbomComponent[], threats: AiBomThreatMatch[]): string {
  const bom = new Models.Bom();
  const root = new Models.Component(Enums.ComponentType.MachineLearningModel, name);
  const put = (comp: Models.Component, n: string, v: string | undefined) => {
    if (v && v.trim()) comp.properties.add(new Models.Property(n, v.trim()));
  };
  put(root, "gijo:model:foundationModel", aibom.model.foundationModel);
  put(root, "gijo:model:finetuneHistory", aibom.model.finetuneHistory);
  put(root, "gijo:model:architecture", aibom.model.architecture);
  put(root, "gijo:model:weightsHash", aibom.model.weightsHash);
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
  // AI-BOM 기반 노출 KISA 위협 + 조직 대응 상태(거버넌스 연계). 예: gijo:threat:M02 = "벡터 DB·임베딩 유출 [open] (dataset)".
  for (const t of threats) {
    root.properties.add(new Models.Property(`gijo:threat:${t.code}`, `${t.name} [${t.status}] (${t.matchedAreas.join(",")})`));
  }
  bom.metadata.component = root;

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
  return serializer.serialize(bom, { space: 2 });
}

// AI-BOM 문서를 생성해 파일로 저장하고 내용(json)까지 함께 돌려준다(클라이언트가 바로 다운로드).
export async function exportAiBom(assetId: string): Promise<{ path: string; filename: string; json: string }> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("자산을 찾을 수 없습니다");
  const { components } = await generateSbom(assetId); // 코드 의존성은 기존 SBOM 로직 재사용
  const threats = aibomThreatMatches(assetId).matches; // AI-BOM 기반 노출 위협 + 대응 상태
  const json = buildAiBomCycloneDx(asset.name, asset.aibom, components, threats);
  await fs.mkdir(EXPORT_DIR, { recursive: true });
  const filename = `${assetId}.aibom.cyclonedx.json`;
  const filePath = path.join(EXPORT_DIR, filename);
  await fs.writeFile(filePath, json, "utf-8");
  return { path: filePath, filename, json };
}

export async function generateSbom(assetId: string): Promise<SbomDocument> {
  const asset = getAsset(assetId);
  // 승인 워크플로우: 오탐(rejected)으로 처리된 finding은 SBOM 취약점 반영에서 제외한다
  // (미검토 pending은 아직 반영 — "확인 안 됨"을 "안전"으로 오해시키지 않기 위함).
  const activeFindings = (asset?.findings ?? []).filter((f) => !isFindingRejected(assetId, f));
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
  const filePath = path.join(EXPORT_DIR, `${assetId}.${format}.json`);
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
