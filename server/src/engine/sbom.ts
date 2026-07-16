// engine/sbom.ts — SBOM 생성 · 정리 (CycloneDX / SPDX, 6.4절)

import type { Express } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { Models, Enums, Spec, Serialize } from "@cyclonedx/cyclonedx-library";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { getAsset, markSbomGenerated } from "./assets";

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

export async function generateSbom(assetId: string): Promise<SbomDocument> {
  const asset = getAsset(assetId);
  const components: SbomComponent[] = (asset?.components ?? []).map((c) => ({
    name: c.name,
    version: c.version,
    license: c.license,
    knownVulns: (asset?.findings ?? [])
      .filter((f) => f.evidence.includes(c.name))
      .map((f) => f.finding_type),
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
}
