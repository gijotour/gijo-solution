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

// AI-BOM 5영역 — 코드 의존성(SBOM)을 넘어 모델·데이터·프롬프트·도구·인프라까지의 구성명세.
// 각 항목은 자유 텍스트(보안담당자가 채워 넣는 관리 항목)다. 값이 비면 "미기재"로 간주.
export interface AiBom {
  model: { foundationModel: string; finetuneHistory: string; architecture: string; weightsHash: string };
  dataset: { sources: string; vectorDbLocation: string };
  prompt: { systemPrompt: string; guardrails: string };
  agentTool: { apis: string; mcpServers: string };
  infrastructure: { compute: string; hostingProvider: string };
}

export function emptyAiBom(): AiBom {
  return {
    model: { foundationModel: "", finetuneHistory: "", architecture: "", weightsHash: "" },
    dataset: { sources: "", vectorDbLocation: "" },
    prompt: { systemPrompt: "", guardrails: "" },
    agentTool: { apis: "", mcpServers: "" },
    infrastructure: { compute: "", hostingProvider: "" },
  };
}

// 저장된 부분 JSON을 빈 기본값 위에 병합해 항상 완전한 5영역 구조를 돌려준다(스키마 진화 대비).
function mergeAiBom(raw: string): AiBom {
  const base = emptyAiBom();
  try {
    const parsed = JSON.parse(raw || "{}") as Partial<AiBom>;
    for (const area of Object.keys(base) as (keyof AiBom)[]) {
      Object.assign(base[area], parsed[area] ?? {});
    }
  } catch {
    /* 손상된 JSON이면 빈 기본값 유지 */
  }
  return base;
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
  service: string | null; // 이 자산이 지원·보호하는 업무 서비스(서비스 영향도 집계용). 미지정이면 null.
  components: AssetComponent[];
  findings: StandardFinding[]; // 가장 최근 스캔 결과만 — 현재 위험 상태
  scanHistory: ScanRun[]; // 스캔 전체 이력, 오래된 순
  aibom: AiBom; // AI-BOM 5영역 메타
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
  service: string | null;
  components: string;
  findings: string;
  aibom: string;
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
  INSERT INTO assets (id, name, path, assetType, owner, service, components, findings, registeredAt, lastScannedAt, sbomGeneratedAt)
  VALUES (@id, @name, @path, @assetType, @owner, @service, @components, @findings, @registeredAt, @lastScannedAt, @sbomGeneratedAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, path = excluded.path, assetType = excluded.assetType, owner = excluded.owner,
    service = excluded.service, components = excluded.components, findings = excluded.findings,
    registeredAt = excluded.registeredAt, lastScannedAt = excluded.lastScannedAt, sbomGeneratedAt = excluded.sbomGeneratedAt
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
const updateAiBomStmt = db.prepare("UPDATE assets SET aibom = ? WHERE id = ?");

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
    service: row.service ?? null,
    components: JSON.parse(row.components) as AssetComponent[],
    findings: JSON.parse(row.findings) as StandardFinding[],
    scanHistory: scanHistoryOf(row.id),
    aibom: mergeAiBom(row.aibom),
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
  service?: string;
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
    service: args.service?.trim() || null,
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

export function updateAiBom(assetId: string, aibom: AiBom): Asset | undefined {
  const existing = getAssetRowStmt.get(assetId) as AssetRow | undefined;
  if (!existing) return undefined;
  // 들어온 부분값을 빈 기본값 위에 병합해 저장(항상 완전한 5영역 유지).
  const merged = mergeAiBom(JSON.stringify(aibom ?? {}));
  updateAiBomStmt.run(JSON.stringify(merged), assetId);
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

// 최초 기동 시(자산이 하나도 없을 때) 예시 AI 자산 몇 개를 등록해 인벤토리·점검 연동을 바로
// 체험할 수 있게 한다 — users.ts의 seedDefaultAdminIfEmpty()와 같은 패턴. id는 고정값이라
// maintenance.ts의 샘플 점검이 이 자산들에 연결될 수 있다. 실제 자산이 등록되면(테이블 비어있지
// 않으면) 절대 끼어들지 않는다.
export const SAMPLE_ASSET_IDS = ["ai-secbot-01", "ai-doccls-02", "ai-anomaly-03"] as const;
function seedSampleAssetsIfEmpty(): void {
  if ((listAssetRowsStmt.all() as AssetRow[]).length > 0) return;
  registerAsset({
    id: "ai-secbot-01",
    name: "사내 보안 상담 챗봇",
    path: "/srv/ai/secbot",
    assetType: "LLM 서비스",
    owner: "보안팀",
    service: "임직원 보안 포털",
    components: [
      { name: "Qwen2.5-7B-Instruct", version: "q4_k_m", license: "Apache-2.0" },
      { name: "bge-m3", version: "1.0", license: "MIT" },
    ],
  });
  registerAsset({
    id: "ai-doccls-02",
    name: "문서 민감도 분류 AI",
    path: "/srv/ai/doc-classifier",
    assetType: "분류 모델",
    owner: "정보보호팀",
    service: "문서관리 시스템",
    components: [{ name: "KoBERT", version: "1.0", license: "Apache-2.0" }],
  });
  registerAsset({
    id: "ai-anomaly-03",
    name: "이상행위 탐지 엔진",
    path: "/srv/ai/anomaly",
    assetType: "이상탐지 모델",
    owner: "SOC",
    service: "SOC 관제 플랫폼",
    components: [{ name: "IsolationForest", version: "scikit-1.4", license: "BSD-3" }],
  });
}
seedSampleAssetsIfEmpty();

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
  app.put("/api/assets/:id/aibom", authMiddleware, (req, res) => {
    const asset = updateAiBom(String(req.params.id), req.body.aibom);
    if (!asset) return res.status(404).json({ error: "asset not found" });
    res.json(asset);
  });
}
