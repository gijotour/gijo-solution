// engine/assets.ts — 자산 인벤토리 레지스트리 (서버 측, 전 클라이언트 공유, SQLite 영속화)
// 8단계 문서 TODO("targetAssetId → 실제 자산 파일 경로 조회는 별도의 자산 레지스트리 서비스가
// 구현되면 연동")의 구현체. SBOM/리포트/디스패처가 공통으로 참조하는 자산·컴포넌트·finding 저장소.
//
// 9.5절 "자산 인벤토리 고도화" 구현: 예전에는 스캔할 때마다 findings를 asset.findings에
// 무한히 append했다 — 재스캔으로 취약점이 해결돼도 예전 finding이 영구히 남아 위험도가
// 절대 내려가지 않는 버그였다. 이제 스캔 1회 = scan_runs 테이블에 남는 행 1개이고,
// asset.findings는 항상 "가장 최근 스캔 결과"만 반영해 현재 위험 상태를 정확히 나타낸다.
// 과거 이력이 필요하면 scanHistory를 그대로 조회하면 된다.
// 등록/스캔/SBOM 생성 시마다 WebSocket으로 브로드캐스트해 인벤토리 화면이 수동 새로고침 없이
// 실시간으로 갱신되게 한다(collaboration.ts/finetune.ts와 동일한 브로드캐스트 패턴).
// db.ts 도입(9.5절 "DB 영속화")으로 이 모든 상태가 서버 재시작 후에도 살아남는다.

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { authMiddleware } from "../auth/auth";
import type { StandardFinding } from "./bridge";
import { db } from "../db";

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

interface AssetRow {
  id: string;
  name: string;
  path: string;
  assetType: string;
  owner: string;
  components: string;
  findings: string;
  registeredAt: number;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

interface ScanRunRow {
  id: string;
  assetId: string;
  scannedAt: number;
  findings: string;
}

const upsertAssetStmt = db.prepare(`
  INSERT INTO assets (id, name, path, assetType, owner, components, findings, registeredAt, lastScannedAt, sbomGeneratedAt)
  VALUES (@id, @name, @path, @assetType, @owner, @components, @findings, @registeredAt, @lastScannedAt, @sbomGeneratedAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, path = excluded.path, assetType = excluded.assetType, owner = excluded.owner,
    components = excluded.components, findings = excluded.findings, registeredAt = excluded.registeredAt,
    lastScannedAt = excluded.lastScannedAt, sbomGeneratedAt = excluded.sbomGeneratedAt
`);
const getAssetRowStmt = db.prepare("SELECT * FROM assets WHERE id = ?");
const listAssetRowsStmt = db.prepare("SELECT * FROM assets");
const deleteScanRunsStmt = db.prepare("DELETE FROM scan_runs WHERE assetId = ?");
const insertScanRunStmt = db.prepare(
  "INSERT INTO scan_runs (id, assetId, scannedAt, findings) VALUES (@id, @assetId, @scannedAt, @findings)"
);
const listScanRunsStmt = db.prepare("SELECT * FROM scan_runs WHERE assetId = ? ORDER BY scannedAt ASC");
const updateFindingsStmt = db.prepare("UPDATE assets SET findings = ?, lastScannedAt = ? WHERE id = ?");
const updateSbomStmt = db.prepare("UPDATE assets SET sbomGeneratedAt = ? WHERE id = ?");

function scanHistoryOf(assetId: string): ScanRun[] {
  return (listScanRunsStmt.all(assetId) as ScanRunRow[]).map((row) => ({
    id: row.id,
    scannedAt: row.scannedAt,
    findings: JSON.parse(row.findings) as StandardFinding[],
  }));
}

function fromRow(row: AssetRow): Asset {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    assetType: row.assetType,
    owner: row.owner,
    components: JSON.parse(row.components) as AssetComponent[],
    findings: JSON.parse(row.findings) as StandardFinding[],
    scanHistory: scanHistoryOf(row.id),
    registeredAt: row.registeredAt,
    lastScannedAt: row.lastScannedAt,
    sbomGeneratedAt: row.sbomGeneratedAt,
  };
}

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
  // 재등록은 스캔 이력/현재 findings를 초기화한다 (기존 동작 유지).
  deleteScanRunsStmt.run(args.id);
  upsertAssetStmt.run({
    id: args.id,
    name: args.name,
    path: args.path,
    assetType: args.assetType ?? "기타",
    owner: args.owner ?? "-",
    components: JSON.stringify(args.components ?? []),
    findings: JSON.stringify([]),
    registeredAt: Date.now(),
    lastScannedAt: null,
    sbomGeneratedAt: null,
  });
  const asset = getAsset(args.id)!;
  broadcastAssetUpdated(asset);
  return asset;
}

export function recordFindings(assetId: string, findings: StandardFinding[]): Asset | undefined {
  const existing = getAssetRowStmt.get(assetId) as AssetRow | undefined;
  if (!existing) return undefined;

  const scannedAt = Date.now();
  insertScanRunStmt.run({
    id: `${assetId}-${scanHistoryOf(assetId).length + 1}`,
    assetId,
    scannedAt,
    findings: JSON.stringify(findings),
  });
  updateFindingsStmt.run(JSON.stringify(findings), scannedAt, assetId);

  const asset = getAsset(assetId)!;
  broadcastAssetUpdated(asset);
  return asset;
}

export function markSbomGenerated(assetId: string): Asset | undefined {
  const existing = getAssetRowStmt.get(assetId) as AssetRow | undefined;
  if (!existing) return undefined;

  updateSbomStmt.run(Date.now(), assetId);
  const asset = getAsset(assetId)!;
  broadcastAssetUpdated(asset);
  return asset;
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetAssetsForTests(): void {
  db.exec("DELETE FROM scan_runs; DELETE FROM assets;");
}

export function getAsset(assetId: string): Asset | undefined {
  const row = getAssetRowStmt.get(assetId) as AssetRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listAssets(): Asset[] {
  return (listAssetRowsStmt.all() as AssetRow[]).map(fromRow);
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
