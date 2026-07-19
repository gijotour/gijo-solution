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
import * as crypto from "crypto";
import * as fs from "fs";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { runAdapter } from "./bridge";
import type { StandardFinding } from "./bridge";
import { db, assertTestDb } from "../db";
import { emitCollaboration } from "./collaboration";
import { setAgentStatus, resetAgentToDefault } from "./agents";
import { computeAssetCoverage } from "./assetcoverage";

export interface AssetComponent {
  name: string;
  version: string;
  license: string;
}

// AI-BOM 5영역 — 코드 의존성(SBOM)을 넘어 모델·데이터·프롬프트·도구·인프라까지의 구성명세.
// 각 항목은 자유 텍스트(보안담당자가 채워 넣는 관리 항목)다. 값이 비면 "미기재"로 간주.
// 자산의 AI 견고성(레드팀) 결과 — 이 자산이 서빙하는 모델이 프롬프트 인젝션에 얼마나 견고한지.
// score=null이면 아직 미점검. modelRef가 있으면 그 로컬 모델을 점검 대상으로 삼는다.
export interface AiBomRobustness {
  score: number | null; // 견고성 점수 0~100
  vulnerable: number;
  total: number;
  ranAt: number;
  modelId: string; // 실제 점검한 로컬 모델 id
}

export interface AiBom {
  // intendedUse/limitations는 모델 카드(Model Card) 항목 — 용도 범위·한계를 명세해 오사용을 막는다.
  // modelRef: 이 자산이 실제로 서빙하는 로컬 모델(models/<id>) — 레드팀 점검 대상 연결용. 없으면 미연결.
  model: { foundationModel: string; finetuneHistory: string; architecture: string; weightsHash: string; intendedUse: string; limitations: string; modelRef: string };
  dataset: { sources: string; vectorDbLocation: string };
  prompt: { systemPrompt: string; guardrails: string };
  agentTool: { apis: string; mcpServers: string };
  infrastructure: { compute: string; hostingProvider: string };
  robustness: AiBomRobustness; // AI 견고성(레드팀) 점검 결과
}

export function emptyAiBom(): AiBom {
  return {
    model: { foundationModel: "", finetuneHistory: "", architecture: "", weightsHash: "", intendedUse: "", limitations: "", modelRef: "" },
    dataset: { sources: "", vectorDbLocation: "" },
    prompt: { systemPrompt: "", guardrails: "" },
    agentTool: { apis: "", mcpServers: "" },
    infrastructure: { compute: "", hostingProvider: "" },
    robustness: { score: null, vulnerable: 0, total: 0, ranAt: 0, modelId: "" },
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
const updateAssetMetaStmt = db.prepare("UPDATE assets SET name = ?, owner = ?, components = ? WHERE id = ?");

// 이름·소유자·구성요소만 갱신한다(스캔 이력·findings·registeredAt는 보존). 재스캔 임포트가
// registerAsset처럼 이력을 지우지 않고 호스트 메타만 최신화하는 용도(취약점 번다운/측정에 필요).
export function updateAssetMeta(id: string, name: string, owner: string, components: AssetComponent[]): void {
  updateAssetMetaStmt.run(name, owner, JSON.stringify(components), id);
}

// 담당부서·서비스만 고친다 — 자산 화면 커버리지 탭에서 결손을 메우는 경로.
// 주지 않은 필드는 건드리지 않는다(빈 문자열로 지우려면 명시적으로 ""를 준다).
export function updateAssetOwnership(id: string, patch: { owner?: string; service?: string | null }): Asset | undefined {
  const current = getAsset(id);
  if (!current) return undefined;
  const owner = patch.owner === undefined ? current.owner : patch.owner.trim();
  const rawService = patch.service === undefined ? current.service : patch.service;
  const service = rawService === null || String(rawService).trim() === "" ? null : String(rawService).trim();
  db.prepare("UPDATE assets SET owner=?, service=? WHERE id=?").run(owner, service, id);
  const updated = getAsset(id);
  if (updated) broadcastAssetUpdated(updated);
  return updated;
}

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

// 레드팀 점검 결과를 자산 AI-BOM에 기록한다. 점검한 modelId를 modelRef로도 고정(다음 재점검 대상).
export function setAssetRobustness(assetId: string, r: AiBomRobustness): Asset | undefined {
  const asset = getAsset(assetId);
  if (!asset) return undefined;
  const model = { ...asset.aibom.model, modelRef: r.modelId || asset.aibom.model.modelRef };
  return updateAiBom(assetId, { ...asset.aibom, model, robustness: r });
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
  assertTestDb("resetAssetsForTests");
  db.exec("DELETE FROM scan_runs; DELETE FROM assets;");
}

const deleteAssetStmt = db.prepare("DELETE FROM assets WHERE id = ?");
const deleteFindingApprovalsStmt = db.prepare("DELETE FROM finding_approvals WHERE assetId = ?");

// 자산 1건 삭제 — 스캔 이력·finding 승인 기록까지 함께 정리(FK 순서상 자식 먼저). 존재하지 않으면 false.
export function deleteAsset(id: string): boolean {
  if (!getAssetRowStmt.get(id)) return false;
  deleteScanRunsStmt.run(id);
  deleteFindingApprovalsStmt.run(id);
  deleteAssetStmt.run(id);
  return true;
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
export function seedSampleAssetsIfEmpty(): void {
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

// 취약점 관리 화면(취약 자산관리·인벤토리·KPI·리포트)이 첫 실행에 비어 보이지 않게 예시 인프라
// 호스트 1대 + 취약점 몇 건을 시드한다 — Nessus 리포트를 아직 안 올린 상태의 온보딩/데모용.
// 실제 호스트가 하나라도 등록되면(infra-host 존재) 절대 끼어들지 않는다. 값은 실제와 유사하되
// owner를 "샘플(예시)"로 표시해 진짜 스캔 결과와 구분한다.
export const SAMPLE_VULN_HOST_ID = "vuln:sample-web01";
export function seedSampleVulnHostIfEmpty(): void {
  const hasHost = (listAssetRowsStmt.all() as AssetRow[]).some((r) => r.assetType === "infra-host");
  if (hasHost) return;
  registerAsset({
    id: SAMPLE_VULN_HOST_ID,
    name: "샘플-웹서버 (10.0.0.100)",
    path: "10.0.0.100",
    assetType: "infra-host",
    owner: "샘플(예시)",
    service: "임직원 보안 포털", // 샘플 AI 자산과 같은 서비스에 연결(서비스 영향도 데모 일관성)
    components: [
      { name: "Ubuntu 22.04 LTS", version: "-", license: "-" },
      { name: "Linux Kernel", version: "5.15.0-91", license: "-" },
    ],
  });
  recordFindings(SAMPLE_VULN_HOST_ID, [
    { finding_type: "Apache Log4j < 2.15.0 RCE (CVE-2021-44228)", severity: "critical", evidence: "경로: /opt/app/lib/log4j-core-2.11.0.jar (설치 2.11.0 → 2.12.2 필요)\n⚠ CISA KEV(실제 악용 확인): CVE-2021-44228", source_tool: "샘플", key: "sample-log4j", state: "active", epss: 0.9436, vpr: 10, kev: true, kevCves: ["CVE-2021-44228"] },
    { finding_type: "OpenSSH < 9.6 사용자 열거 (CVE-2024-6387)", severity: "high", evidence: "포트: tcp/22", source_tool: "샘플", key: "sample-ssh", state: "new", epss: 0.42, vpr: 8.1 },
    { finding_type: "Oracle DB CPU 미적용 (CVE-2022-21432 외 16건)", severity: "medium", evidence: "포트: tcp/1521\nCVE(17): CVE-2022-21432 …", source_tool: "샘플", key: "sample-oracle", state: "active", epss: 0.9439, vpr: 8.9 },
    { finding_type: "SSL 인증서 만료 임박", severity: "low", evidence: "만료 30일 이내 — 갱신 완료로 이번 스캔에서 해소됨", source_tool: "샘플", key: "sample-ssl", state: "fixed" },
  ]);
}
seedSampleVulnHostIfEmpty();

export function registerAssetsRoutes(app: Express): void {
  app.get("/api/assets", authMiddleware, (_req, res) => res.json(listAssets()));
  // :id 라우트보다 먼저 — 뒤에 두면 "coverage"가 자산 id로 잡힌다.
  app.get("/api/assets/coverage", authMiddleware, (_req, res) => res.json(computeAssetCoverage(listAssets())));
  app.get("/api/assets/:id", authMiddleware, (req, res) => {
    const asset = getAsset(String(req.params.id));
    if (!asset) return res.status(404).json({ error: "asset not found" });
    res.json(asset);
  });
  app.post("/api/assets", authMiddleware, (req, res) => {
    res.json(registerAsset(req.body));
  });
  // 경량 단건 재스캔 — 대시보드 자산 팝오버용. dispatch(의도분류·LLM 요약·부연) 없이 스캔
  // 어댑터만 돌려 자산에 반영한다. 무거운 파이프라인은 지시("○○ 스캔해줘")로, 이건 버튼 즉답 경로.
  app.post("/api/assets/:id/scan", authMiddleware, asyncRoute(async (req, res) => {
    const asset = getAsset(String(req.params.id));
    if (!asset) {
      res.status(404).json({ error: "asset not found" });
      return;
    }
    setAgentStatus("scan", "working");
    emitCollaboration({ from: "orchestrator", to: "scan", message: `단건 재스캔: ${asset.id}` });
    const findings = await runAdapter("modelscan", asset.path || asset.id).catch((err) => [
      { finding_type: "scan_error", severity: "low" as const, evidence: String(err), source_tool: "modelscan" },
    ]);
    recordFindings(asset.id, findings);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `재스캔 완료: ${asset.id} — finding ${findings.length}건` });
    resetAgentToDefault("scan");
    res.json({ assetId: asset.id, findings: findings.length });
  }));
  // 담당부서·서비스 정정 — 커버리지 결손을 메우는 경로.
  app.patch("/api/assets/:id", authMiddleware, (req, res) => {
    const { owner, service } = req.body ?? {};
    if (owner === undefined && service === undefined) {
      return res.status(400).json({ error: "owner 또는 service 중 하나는 있어야 합니다" });
    }
    const updated = updateAssetOwnership(String(req.params.id), { owner, service });
    if (!updated) return res.status(404).json({ error: "asset not found" });
    res.json(updated);
  });
  app.put("/api/assets/:id/aibom", authMiddleware, (req, res) => {
    const asset = updateAiBom(String(req.params.id), req.body.aibom);
    if (!asset) return res.status(404).json({ error: "asset not found" });
    res.json(asset);
  });
  // 가중치 파일 SHA-256 자동 계산 — AI-BOM 무결성·출처 추적(모델 카드). 스트리밍 해시라 수 GB GGUF도 안전.
  // body.filePath(선택, 기본=자산 path). 파일이 없거나 디렉터리면 정직하게 400으로 알린다(추측·자동보정 없음).
  app.post("/api/assets/:id/aibom/weights-hash", authMiddleware, (req, res) => {
    const asset = getAsset(String(req.params.id));
    if (!asset) return res.status(404).json({ error: "자산을 찾을 수 없습니다" });
    const filePath = String((req.body?.filePath ?? "").trim() || asset.path);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return res.status(400).json({ error: `파일을 찾을 수 없습니다: ${filePath} — 가중치 파일 경로를 직접 지정하세요` });
    }
    if (!stat.isFile()) return res.status(400).json({ error: `파일이 아닙니다(디렉터리 등): ${filePath}` });
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("error", (err) => res.status(500).json({ error: `읽기 실패: ${err.message}` }));
    stream.on("end", () => {
      const weightsHash = `sha256:${hash.digest("hex")}`;
      updateAiBom(asset.id, { ...asset.aibom, model: { ...asset.aibom.model, weightsHash } });
      res.json({ assetId: asset.id, filePath, sizeBytes: stat.size, weightsHash });
    });
  });
  app.delete("/api/assets/:id", authMiddleware, (req, res) => {
    const ok = deleteAsset(String(req.params.id));
    if (!ok) return res.status(404).json({ error: "asset not found" });
    res.json({ ok: true });
  });
}
