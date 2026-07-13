// engine/assets.ts — 자산 인벤토리 레지스트리 (서버 측, 전 클라이언트 공유)
// 8단계 문서 TODO("targetAssetId → 실제 자산 파일 경로 조회는 별도의 자산 레지스트리 서비스가
// 구현되면 연동")의 구현체. SBOM/리포트/디스패처가 공통으로 참조하는 자산·컴포넌트·finding 저장소.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import type { StandardFinding } from "./bridge";

export interface AssetComponent {
  name: string;
  version: string;
  license: string;
}

export interface Asset {
  id: string;
  name: string;
  path: string;
  assetType: string;
  owner: string;
  components: AssetComponent[];
  findings: StandardFinding[];
  registeredAt: number;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

// TODO: sqlite/LanceDB 등으로 영속화. 현재는 인메모리 — agents.ts/tasks.ts와 동일한 잠정 저장 방식.
const assets = new Map<string, Asset>();

export function registerAsset(args: {
  id: string;
  name: string;
  path: string;
  assetType?: string;
  owner?: string;
  components?: AssetComponent[];
}): Asset {
  const asset: Asset = {
    id: args.id,
    name: args.name,
    path: args.path,
    assetType: args.assetType ?? "기타",
    owner: args.owner ?? "-",
    components: args.components ?? [],
    findings: [],
    registeredAt: Date.now(),
    lastScannedAt: null,
    sbomGeneratedAt: null,
  };
  assets.set(asset.id, asset);
  return asset;
}

export function recordFindings(assetId: string, findings: StandardFinding[]): Asset | undefined {
  const asset = assets.get(assetId);
  if (!asset) return undefined;
  asset.findings.push(...findings);
  asset.lastScannedAt = Date.now();
  return asset;
}

export function markSbomGenerated(assetId: string): Asset | undefined {
  const asset = assets.get(assetId);
  if (!asset) return undefined;
  asset.sbomGeneratedAt = Date.now();
  return asset;
}

// 테스트 전용: assets는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetAssetsForTests(): void {
  assets.clear();
}

export function getAsset(assetId: string): Asset | undefined {
  return assets.get(assetId);
}

export function listAssets(): Asset[] {
  return [...assets.values()];
}

export function registerAssetsRoutes(app: Express): void {
  app.get("/api/assets", authMiddleware, (_req, res) => res.json(listAssets()));
  app.get("/api/assets/:id", authMiddleware, (req, res) => {
    const asset = getAsset(String(req.params.id));
    if (!asset) return res.status(404).json({ error: "asset not found" });
    res.json(asset);
  });
  app.post("/api/assets", authMiddleware, (req, res) => {
    res.json(registerAsset(req.body));
  });
}
