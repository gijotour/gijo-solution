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
  if (format === "spdx") {
    throw new Error("SPDX 내보내기는 아직 미구현 — CycloneDX만 지원 (spdx-sbom-generator 등 별도 라이브러리 연동 필요)");
  }
  const { components } = await generateSbom(assetId);
  const json = buildCycloneDxJson(assetId, components);

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
