// engine/assets.ts — 자산 인벤토리 레지스트리 (서버 측, 전 클라이언트 공유)
// 8단계 문서 TODO("targetAssetId → 실제 자산 파일 경로 조회는 별도의 자산 레지스트리 서비스가
// 구현되면 연동")의 구현체. SBOM/리포트/디스패처가 공통으로 참조하는 자산·컴포넌트·finding 저장소.
//
// 9.5절 "자산 인벤토리 고도화" 구현: 예전에는 스캔할 때마다 findings를 asset.findings에
// 무한히 append했다 — 재스캔으로 취약점이 해결돼도 예전 finding이 영구히 남아 위험도가
// 절대 내려가지 않는 버그였다. 이제 스캔 1회 = scanHistory에 남는 ScanRun 1개이고,
// asset.findings는 항상 "가장 최근 스캔 결과"만 반영해 현재 위험 상태를 정확히 나타낸다.
// 과거 이력이 필요하면 scanHistory를 그대로 조회하면 된다.
// 등록/스캔/SBOM 생성 시마다 WebSocket으로 브로드캐스트해 인벤토리 화면이 수동 새로고침 없이
// 실시간으로 갱신되게 한다(collaboration.ts/finetune.ts와 동일한 브로드캐스트 패턴).

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { authMiddleware } from "../auth/auth";
import type { StandardFinding } from "./bridge";

export interface AssetComponent {
  name: string;
  version: string;
  license: string;
}

export interface ScanRun {
  id: string;
  scannedAt: number;
  findings: StandardFinding[];
}

export interface Asset {
  id: string;
  name: string;
  path: string;
  assetType: string;
  owner: string;
  components: AssetComponent[];
  findings: StandardFinding[]; // 가장 최근 스캔 결과만 — 현재 위험 상태
  scanHistory: ScanRun[]; // 스캔 전체 이력, 오래된 순
  registeredAt: number;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

// TODO: sqlite/LanceDB 등으로 영속화. 현재는 인메모리 — agents.ts/tasks.ts와 동일한 잠정 저장 방식.
const assets = new Map<string, Asset>();

let wss: WebSocketServer | null = null;
export function attachAssetsSocket(server: WebSocketServer): void {
  wss = server;
}

function broadcastAssetUpdated(asset: Asset): void {
  wss?.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ channel: "asset:updated", payload: asset }));
    }
  });
}

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
    scanHistory: [],
    registeredAt: Date.now(),
    lastScannedAt: null,
    sbomGeneratedAt: null,
  };
  assets.set(asset.id, asset);
  broadcastAssetUpdated(asset);
  return asset;
}

export function recordFindings(assetId: string, findings: StandardFinding[]): Asset | undefined {
  const asset = assets.get(assetId);
  if (!asset) return undefined;
  const run: ScanRun = { id: `${assetId}-${asset.scanHistory.length + 1}`, scannedAt: Date.now(), findings };
  asset.scanHistory.push(run);
  asset.findings = findings;
  asset.lastScannedAt = run.scannedAt;
  broadcastAssetUpdated(asset);
  return asset;
}

export function markSbomGenerated(assetId: string): Asset | undefined {
  const asset = assets.get(assetId);
  if (!asset) return undefined;
  asset.sbomGeneratedAt = Date.now();
  broadcastAssetUpdated(asset);
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
