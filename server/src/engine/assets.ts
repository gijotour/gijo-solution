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
import { 한줄풀이찾기 } from "./findingplain";
import { db, assertTestDb } from "../db";
import { emitCollaboration } from "./collaboration";
import { recordAudit } from "./audit";
import { setAgentStatus, resetAgentToDefault } from "./agents";
// 스캔 결과가 들어오면 자산 기본 담당자에게 자동 배정한다(미배정 적체 재발 방지).
// approvals를 거쳐 다시 assets로 돌아오는 순환 참조가 있으나, 호출이 모듈 로드가 아닌
// 런타임이라 안전하다.
import { autoAssignFindings, setDefaultAssignee } from "./autoassign";
import { computeAssetCoverage } from "./assetcoverage";

export interface AssetComponent {
  name: string;
  version: string;
  license: string;
  /**
   * 이 부품을 **어디서 알았나**. 없으면 예전 데이터(출처 미상)다.
   *
   * ★ 왜 적나(2026-08-04 파트너 지적): SBOM에 부품이 있어도 그것이 **스캐너가 추정한
   *   제품 이름**인지 **장비에서 실제로 읽은 패키지**인지에 따라 값이 다르다.
   *   섞어 두면 "부품 1,500개"라는 숫자가 실제보다 정확해 보인다.
   *   - `scanner` — 취약점 스캐너가 준 OS·제품(CPE 수준, 버전·라이선스가 없을 수 있다)
   *   - `package` — 장비에서 패키지 목록을 직접 읽은 것(rpm·dpkg·Windows 설치 목록)
   *   - `manual`  — 사람이 적어 넣은 것
   */
  from?: "scanner" | "package" | "manual";
  /**
   * 제조사(Publisher). 윈도우 설치 목록이 주는 세 번째 칸이다.
   *
   * ★ 왜 칸을 나눴나(2026-08-06 실장비 실증): 이 칸이 없어서 윈도우 수집이 제조사를
   *   **license 칸에** 넣고 있었다 — 실측 189개 전부 「Kakao Corp.」「Bandisoft.com」 같은
   *   회사 이름이 라이선스로 저장됐고, 요약문은 "라이선스를 아는 것은 189개"라고 **거짓**을
   *   말했다. 라이선스 칸은 법무가 보는 자리다 — 회사 이름은 라이선스가 아니다.
   *   윈도우 설치 목록에는 라이선스가 아예 없으므로 license는 "-"(미상)로 정직하게 두고,
   *   제조사는 여기에 따로 담는다.
   */
  publisher?: string;
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

// AI/모델 자산인가 — AI-BOM·견고성 점검이 의미 있는 자산만 True.
// AI-BOM은 방화벽·DB·스캐너로 들여온 IP 호스트 같은 IT 자산엔 해당이 없다. 이걸 "AI-BOM 미완성"으로
// 세면 거버넌스 현황이 거짓 결손으로 가득 찬다(실측 2026-07-19: 방화벽까지 AI-BOM 미완성 집계).
// "AI처럼 보이면 True"의 긍정 판별을 쓴다(IT 유형을 일일이 나열해 배제하는 것보다 안전).
const AI_ASSET_TYPES = new Set(["LLM 서비스", "분류 모델", "이상탐지 모델"]);
export function isAiAsset(a: Asset): boolean {
  if (AI_ASSET_TYPES.has(a.assetType)) return true;
  // AI-BOM 핵심 항목(파운데이션 모델·서빙 모델 참조)이 채워져 있으면 AI 자산으로 본다.
  const m = a.aibom?.model;
  return Boolean(m && (m.modelRef.trim() || m.foundationModel.trim()));
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

// sample = 데모용 시드 데이터, scanner = 취약점 스캔 반입, registered = 직접 등록·저장소 스캔
export type AssetOrigin = "sample" | "scanner" | "registered";

export interface Asset {
  origin: AssetOrigin;
  id: string;
  name: string;
  // 담당자가 보기 쉽게 붙인 표시 이름(별칭). null이면 name을 그대로 쓴다.
  // 원래 name·id·호스트는 보존해 재점검·이력 추적에 영향이 없다(2026-07-25 사용자 요청).
  displayName: string | null;
  path: string;
  assetType: string;
  owner: string;
  service: string | null; // 이 자산이 지원·보호하는 업무 서비스(서비스 영향도 집계용). 미지정이면 null.
  components: AssetComponent[];
  findings: StandardFinding[]; // 가장 최근 스캔 결과만 — 현재 위험 상태
  scanHistory: ScanRun[]; // 스캔 전체 이력, 오래된 순
  aibom: AiBom; // AI-BOM 5영역 메타
  category: string | null; // ④ 담당자 지정 그룹(카테고리). null이면 '미분류'.
  hostname: string | null; // ⑥ 호스트명(미지정이면 name에서 유도)
  ip: string | null;       // ⑥ IP 주소(미지정이면 name에서 유도)
  // 새 취약점이 자동 배정될 담당자(2026-07-26). null이면 자동 배정 안 함 = 미배정으로 남는다.
  defaultAssignee: string | null;
  registeredAt: number;
  updatedAt: number | null; // ④ 최종 수정 시각(등록·스캔·메타변경 시 갱신)
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

interface AssetRow {
  id: string;
  name: string;
  displayName: string | null;
  path: string;
  assetType: string;
  owner: string;
  service: string | null;
  components: string;
  findings: string;
  aibom: string;
  category: string | null;
  hostname: string | null;
  ip: string | null;
  defaultAssignee: string | null; // autoassign.ts가 ALTER로 추가한 컬럼
  registeredAt: number;
  updatedAt: number | null;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

// 호스트명·IP를 자산명에서 유도한다(전용 필드가 비었을 때의 폴백) — 기존 임포터를 바꾸지 않고도
// ⑥ 독립 컬럼을 채운다. 예: "oracle.local (192.168.219.98)" → host=oracle.local, ip=192.168.219.98.
// 이름이 IP 그 자체면(예: "10.10.20.15") host=null, ip=그 값.
export function deriveHostIp(name: string): { hostname: string | null; ip: string | null } {
  const ipMatch = name.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  const ip = ipMatch ? ipMatch[1] : null;
  let hostname: string | null = name.replace(/\(?\s*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s*\)?/g, "").replace(/[()]/g, "").trim();
  if (!hostname) hostname = null;
  return { hostname, ip };
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
const touchAssetStmt = db.prepare("UPDATE assets SET updatedAt = ? WHERE id = ?");
const setCategoryStmt = db.prepare("UPDATE assets SET category = ?, updatedAt = ? WHERE id = ?");

// 자산 레코드가 수정됐음을 기록(④ 최종수정일). 조용히 실패해도 본 기능엔 영향 없게.
function touchAsset(id: string): void {
  try { touchAssetStmt.run(Date.now(), id); } catch { /* 컬럼 미적용 등은 무시 */ }
}

// ④ 카테고리(그룹) 지정/해제 — 빈 값이면 null(미분류)로 저장. 최종수정일 갱신 + 실시간 브로드캐스트.
export function setAssetCategory(id: string, category: string | null): Asset | undefined {
  if (!getAssetRowStmt.get(id)) return undefined;
  const value = category && category.trim() ? category.trim() : null;
  setCategoryStmt.run(value, Date.now(), id);
  const updated = getAsset(id);
  if (updated) broadcastAssetUpdated(updated);
  return updated;
}

// 이름·소유자·구성요소만 갱신한다(스캔 이력·findings·registeredAt는 보존). 재스캔 임포트가
// registerAsset처럼 이력을 지우지 않고 호스트 메타만 최신화하는 용도(취약점 번다운/측정에 필요).
// 표시 이름(별칭)만 바꾼다. 원래 name·id·호스트는 건드리지 않아 재점검 상태추적·이력이 그대로다.
// null·빈 문자열을 주면 별칭을 지워 원래 이름으로 되돌린다.
const setDisplayNameStmt = db.prepare("UPDATE assets SET displayName = ? WHERE id = ?");
export function updateAssetDisplayName(id: string, displayName: string | null): Asset | undefined {
  if (!getAssetRowStmt.get(id)) return undefined;
  const trimmed = (displayName ?? "").trim();
  setDisplayNameStmt.run(trimmed.length ? trimmed.slice(0, 120) : null, id);
  touchAsset(id);
  return getAsset(id);
}

export function updateAssetMeta(id: string, name: string, owner: string, components: AssetComponent[]): void {
  updateAssetMetaStmt.run(name, owner, JSON.stringify(components), id);
  touchAsset(id); // ④ 최종수정일 갱신
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
  touchAsset(id); // ④ 최종수정일 갱신
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

// 자산이 어디서 왔는가. 시드 샘플은 id로 정확히 식별한다 —
// 이름이나 담당부서 문자열로 추측하면 사용자가 "샘플"이라고 적은 실 자산까지 숨긴다.
export function assetOriginOf(id: string): AssetOrigin {
  if ((SAMPLE_ASSET_IDS as readonly string[]).includes(id) || id === SAMPLE_VULN_HOST_ID) return "sample";
  if (id.startsWith("vuln:")) return "scanner"; // importVulnScan이 붙이는 접두사
  return "registered";
}

// 저장된 finding에 **화면용 한 줄 풀이**를 읽을 때 붙인다 — 저장하지 않는다(규칙이 늘면 재스캔
// 없이 다음 읽기부터 반영, 계획서 전-7 ③). 못 찾으면 안 붙인다(원문만 보인다). 정규식표는 서버
// findingplain 한 곳뿐 — 클라가 복제하지 않게 한다("그 값을 누가 넣는가" 원칙).
function 풀이붙이기(f: StandardFinding): StandardFinding {
  const 말 = 한줄풀이찾기(f.finding_type)?.말;
  return 말 ? { ...f, plain: 말 } : f;
}

function fromRow(row: AssetRow): Asset {
  const derived = deriveHostIp(row.name);
  return {
    origin: assetOriginOf(row.id),
    id: row.id,
    name: row.name,
    displayName: row.displayName ?? null,
    path: row.path,
    assetType: row.assetType,
    owner: row.owner,
    service: row.service ?? null,
    components: JSON.parse(row.components) as AssetComponent[],
    findings: (JSON.parse(row.findings) as StandardFinding[]).map(풀이붙이기),
    scanHistory: scanHistoryOf(row.id),
    aibom: mergeAiBom(row.aibom),
    category: row.category ?? null,
    hostname: row.hostname ?? derived.hostname,
    ip: row.ip ?? derived.ip,
    defaultAssignee: row.defaultAssignee ?? null, // 새 취약점 자동 배정 대상(자산 목록에서 지정)
    registeredAt: row.registeredAt,
    updatedAt: row.updatedAt ?? null,
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
  // ⚠ **이미 있는 id는 「재등록」이 아니라 메타 갱신이다**(2026-08-19 D5).
  //   예전엔 여기서 scan_runs를 지우고 findings를 []로 덮어써서, 같은 이름으로 다시 등록하는
  //   순간 그 자산의 취약점·스캔 이력·SBOM이 **담당자 모르게 통째로 사라졌다** —
  //   「실패 스캔이 취약점 지운다」(2026-08-02)와 같은 결과를 다른 경로로 내던 자리다.
  //   scan_runs는 findingsrestore가 되살릴 **유일한 원본**이라 절대 손대지 않는다.
  const 기존 = getAssetRowStmt.get(args.id) as { assetType: string; owner: string; service: string | null } | undefined;
  if (기존) {
    db.prepare("UPDATE assets SET name=?, path=?, assetType=?, owner=?, service=? WHERE id=?").run(
      args.name, args.path,
      args.assetType ?? 기존.assetType,
      args.owner ?? 기존.owner,
      args.service?.trim() || 기존.service,
      args.id
    );
    touchAsset(args.id);
    const updated = getAsset(args.id)!;
    broadcastAssetUpdated(updated);
    return updated;
  }
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
  touchAsset(args.id); // ④ 등록 시점을 최종수정일로도 기록
  const asset = getAsset(args.id)!;
  broadcastAssetUpdated(asset);
  return asset;
}

/**
 * 스캔 결과를 자산에 기록한다.
 *
 * ⚠ **실패한 스캔은 알던 취약점을 지우지 않는다** (2026-08-02 실측 데이터 소실).
 *   증상: 데모 취약점 14건을 반입해 화면에서 확인까지 했는데, 잠시 뒤 0건이 되어 있었다.
 *   원인: 이 함수가 findings를 **통째로 교체**한다. 전체 자산 스캔이 돌면 IP 호스트에는
 *   modelscan이 맞지 않아 실패하고, 그 `scan_error` 한 줄이 실제 취약점을 덮어썼다.
 *   운영 데이터가 609건 전부 스캔 오류였던 이유도 이것이다 — 취약점이 없던 게 아니라
 *   **지워진** 것이다.
 *
 *   스캔이 실패했다는 사실은 "그 취약점이 사라졌다"를 뜻하지 않는다. 모르는 것을 안다고
 *   기록하는 셈이라, 담당자가 그 화면을 보고 "다 조치됐네"라고 판단하면 그게 사고다.
 *   그래서 **들어온 결과가 전부 스캔 실패**이고 **알던 것에 진짜 취약점이 있으면**,
 *   알던 것을 지키고 실패 기록을 함께 남긴다(감추지도 않는다).
 *
 * ⚠ 정상 재스캔이 0건을 돌려주는 경우(다 고쳤다)는 막지 않는다 — 그때는 들어온 목록이
 *   비어 있지 스캔 실패가 아니다. 조건을 "전부 스캔 실패"로 좁게 잡은 이유다.
 */
function 실패로덮어쓰지않기(assetId: string, 들어온: StandardFinding[], 이전JSON: string): StandardFinding[] {
  const 스캔실패 = (f: StandardFinding) => f.finding_type === "scan_error" || f.finding_type === "scan_not_supported";
  if (들어온.length === 0 || !들어온.every(스캔실패)) return 들어온;
  let 이전: StandardFinding[] = [];
  try { 이전 = JSON.parse(이전JSON) as StandardFinding[]; } catch { return 들어온; }
  const 진짜 = 이전.filter((f) => !스캔실패(f));
  if (진짜.length === 0) return 들어온;   // 지킬 것이 없으면 그대로
  // 알던 취약점 + 이번 실패 기록. 실패를 감추면 "왜 결과가 안 바뀌지?"가 된다.
  return [...진짜, ...들어온];
}

export function recordFindings(assetId: string, findings: StandardFinding[]): Asset | undefined {
  const existing = getAssetRowStmt.get(assetId) as AssetRow | undefined;
  if (!existing) return undefined;

  findings = 실패로덮어쓰지않기(assetId, findings, existing.findings);
  const scannedAt = Date.now();
  insertScanRunStmt.run({
    id: `${assetId}-${scanHistoryOf(assetId).length + 1}`,
    assetId,
    scannedAt,
    findings: JSON.stringify(findings),
  });
  updateFindingsStmt.run(JSON.stringify(findings), scannedAt, assetId);
  touchAsset(assetId); // ④ 스캔 결과 반영도 최종수정으로 본다

  // 자산에 기본 담당자가 지정돼 있으면 새 취약점을 바로 배정한다(미배정 적체 재발 방지).
  // 이미 배정된 건은 건드리지 않으며, 실패해도 스캔 결과 저장에는 영향을 주지 않는다.
  // (autoassign → approvals → assets 순환 참조가 있지만 호출이 런타임이라 안전하다.
  //  ⚠ 여기서 require()를 쓰면 ESM에서 조용히 실패한다 — 실제로 그렇게 한 번 놓쳤다.)
  try {
    autoAssignFindings(assetId, findings);
  } catch { /* 자동 배정 실패가 스캔을 막지는 않는다 */ }

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
  if (row) return fromRow(row);
  // ⚠ **이름으로도 찾는다.** 담당자에게 보여 주는 글자는 내부 id가 아니라 이름이라
  //   (2026-08-03 말투 규범 — `vuln:sample-web01` 같은 내부 키는 사람이 읽는 글자가 아니다),
  //   화면에서 본 이름 그대로 물었을 때 못 찾으면 이어서 파고들 길이 끊긴다.
  //   내부 표식(`vuln:` 등)을 뗀 꼴도 받아 준다 — 사람이 그렇게 옮겨 적는다.
  const 찾을말 = String(assetId ?? "").trim().toLowerCase();
  if (!찾을말) return undefined;
  const 벗김 = (s: string) => s.toLowerCase().replace(/^(vuln|asset|finding|task):/, "");
  const 후보 = listAssets();
  const 정확 =
    후보.find((a) => a.name?.toLowerCase() === 찾을말) ??
    후보.find((a) => 벗김(a.id) === 벗김(찾을말));
  if (정확) return 정확;

  // ⚠ **딱 하나일 때만** 이어 준다. 이름에 덧붙은 것이 있어 정확히 안 맞는 경우가 많다 —
  //   실측(2026-08-03): 목록에 "샘플-웹서버"로 보이던 자산의 실제 이름이
  //   "샘플-웹서버 (10.0.0.100)"이라 그대로 물었더니 못 찾았다.
  //   여럿이 걸리면 **고르지 않는다** — 엉뚱한 자산을 집어 오는 것이 못 찾는 것보다 나쁘다.
  const 부분 = 후보.filter((a) => (a.name ?? "").toLowerCase().includes(찾을말));
  return 부분.length === 1 ? 부분[0] : undefined;
}

/**
 * 자산 id를 **사람이 읽는 이름**으로. 이름이 없거나 id와 같으면 id를 쓰되,
 * 앞의 내부 표식(`vuln:` 등)만 떼어 읽기라도 낫게 한다.
 *
 * ⚠ 한 곳에만 둔다 — 화면에 나가는 글자를 두 벌로 만들면 반드시 어긋난다
 *   (2026-08-03 예고 판정에서 이미 겪었다: llm과 report가 각자 목록을 들고 있어 누출이 났다).
 * ⚠ 지어내지 않는다: 이름을 모르면 모르는 대로 둔다.
 */
export function 자산표시이름(id: string): string {
  const s = String(id ?? "");
  try {
    const a = listAssets().find((x) => x.id === s);
    if (a?.name && a.name !== s) return a.name;
  } catch { /* 등록부를 못 읽으면 아래로 */ }
  return s.replace(/^(vuln|asset|finding|task):/, "");
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
    name: "샘플-보안 상담 챗봇",
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
    name: "샘플-문서 민감도 분류 AI",
    path: "/srv/ai/doc-classifier",
    assetType: "분류 모델",
    owner: "정보보호팀",
    service: "문서관리 시스템",
    components: [{ name: "KoBERT", version: "1.0", license: "Apache-2.0" }],
  });
  registerAsset({
    id: "ai-anomaly-03",
    name: "샘플-이상행위 탐지 엔진",
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

/**
 * 지금 보이는 것이 **예시 데이터뿐인가** — 실제 자산이 하나도 등록되지 않은 상태인가.
 *
 * 왜 필요한가(2026-08-09 실측): 새로 설치한 앱에서 고객이 처음 던진 질문의 답이
 *   「[P0] 실제 악용(KEV) 1건 — 공격이 실제로 쓰이는 취약점, 이번 주 안에 막아야 합니다」
 * 였다. **가짜 P0로 시작하는 첫인상**이다. 데이터 자체는 정직하게 표시돼 있는데
 * (source_tool="샘플", owner="샘플(예시)") 답이 그 표시를 옮기지 않았다.
 *
 * ⚠ 자산이 하나도 없으면 false다 — 「예시뿐」이 아니라 「아무것도 없음」이고, 그때는
 *   경고할 것도 없다. 실제 자산이 하나라도 들어오면 그 순간 false가 되어 문구가 사라진다.
 */
export function 예시데이터뿐인가(): boolean {
  const rows = listAssetRowsStmt.all() as AssetRow[];
  if (!rows.length) return false;
  const 표본 = new Set<string>([...SAMPLE_ASSET_IDS, SAMPLE_VULN_HOST_ID]);
  return rows.every((r) => 표본.has(r.id));
}
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

/**
 * 목록에서 스캔 이력을 뺀다 — **화면이 읽지도 않는 13.65MB였다.**
 *
 * ★ 실측(2026-08-03): 잃었던 취약점 4,833건을 되살리자 `/api/assets` 응답이 **14.69MB**가 됐고,
 *   그중 **93%가 scanHistory**였다. 클라이언트 코드 전체를 뒤져도 scanHistory를 읽는 곳은
 *   한 군데도 없다(서버 안에서만 쓴다 — 되살리기·KPI 추이).
 *   담당자 PC는 그 13MB를 받아 JSON으로 풀고 버린다.
 *
 * ⚠ **상세 조회(/api/assets/:id)에서는 빼지 않는다.** 거기서는 이력이 뜻이 있고,
 *   assets.test.ts가 그 계약을 지킨다. 목록에는 **몇 번 점검했는지**만 남긴다 —
 *   숫자를 통째로 없애면 "이력이 없다"로 읽힌다.
 */
function 목록용(a: Asset): Omit<Asset, "scanHistory"> & { scanCount: number } {
  const { scanHistory, ...나머지 } = a;
  return { ...나머지, scanCount: scanHistory.length };
}

// fkey — 취약점마다 안정 기계 키(검토대장의 findingKey와 같은 sha1 16자)를 동봉한다.
//   화면이 「고른 항목」을 대화창에 넘길 때 이 키를 실어야, 배정·판정이 글자 대조가 아니라
//   키로 정확히 그 건을 잡는다(2026-08-19 QA 실사고: 같은 IP 두 자산에서 엉뚱한 자산으로
//   배정이 갔고, 표시명과 원문이 달라 실행이 400으로 죽었다).
// ⚠ **목록·상세 두 라우트가 같은 이 함수를 탄다** — 검토관(2026-08-19 심각1)이 잡았다:
//   처음엔 상세에만 붙여서, 목록(hostCache)으로 그리는 취약점 화면이 키를 영영 못 받아
//   수리가 무효였다. 생산자를 나누면 이 사고가 재발한다.
// ⚠ 지연 import — approvals.ts가 이 파일을 import하고 있어(정적이면 순환) 여기서 푼다.
async function fkey붙임<T extends { id: string; findings: Asset["findings"] }>(a: T): Promise<T> {
  const { findingKey } = await import("./approvals.js");
  return { ...a, findings: a.findings.map((f) => ({ ...f, fkey: findingKey(a.id, f) })) };
}

export function registerAssetsRoutes(app: Express): void {
  app.get("/api/assets", authMiddleware, asyncRoute(async (_req, res) =>
    res.json(await Promise.all(listAssets().map(목록용).map(fkey붙임)))));
  // :id 라우트보다 먼저 — 뒤에 두면 "coverage"가 자산 id로 잡힌다.
  app.get("/api/assets/coverage", authMiddleware, (_req, res) => res.json(computeAssetCoverage(listAssets())));
  app.get("/api/assets/:id", authMiddleware, asyncRoute(async (req, res) => {
    const asset = getAsset(String(req.params.id));
    if (!asset) return res.status(404).json({ error: "asset not found" });
    res.json(await fkey붙임(asset));
  }));
  // 자산 기본 담당자 — 새 취약점이 이 사람에게 자동 배정된다(미배정 적체 재발 방지).
  app.post("/api/assets/:id/default-assignee", authMiddleware, (req, res) => {
    const id = String(req.params.id);
    if (!getAsset(id)) return res.status(404).json({ error: "asset not found" });
    const v = setDefaultAssignee(id, (req.body as { assignee?: string })?.assignee ?? null);
    res.json({ assetId: id, defaultAssignee: v });
  });
  app.post("/api/assets", authMiddleware, (req, res) => {
    // 입력 검증(2026-07-23 입력창 전수검증에서 발견): 빈 이름이 500으로 터지던 것을 400+안내로.
    if (!String(req.body?.name ?? "").trim()) {
      res.status(400).json({ error: "자산 이름(name)을 입력하세요" });
      return;
    }
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
    // 작업 기록(감사) → onAudit 훅으로 작업 세션에도 자동 반영("모든 행위" 요청).
    recordAudit({
      kind: "write",
      actor: (req as import("express").Request & { user?: { displayName?: string } }).user?.displayName ?? null,
      action: "자산 재스캔",
      target: asset.name,
      detail: `finding ${findings.length}건`,
      result: "ok",
    });
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
  // ④ 카테고리(그룹) 지정/해제 — 빈 값이면 미분류로. 자산 목록 좌측 카테고리 트리에서 사용.
  app.patch("/api/assets/:id/category", authMiddleware, (req, res) => {
    const raw = req.body?.category;
    if (raw !== null && raw !== undefined && typeof raw !== "string") {
      return res.status(400).json({ error: "category는 문자열이거나 null이어야 합니다" });
    }
    const updated = setAssetCategory(String(req.params.id), raw ?? null);
    if (!updated) return res.status(404).json({ error: "asset not found" });
    res.json(updated);
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
  // 표시 이름(별칭) 변경 — 보기 쉬운 이름으로 관리한다. 원래 name·id는 보존(추적성).
  // displayName을 비우거나 null로 주면 원래 이름으로 되돌린다. 변경은 감사 로그에 남는다.
  app.post("/api/assets/:id/display-name", authMiddleware, (req, res) => {
    const id = String(req.params.id);
    const before = getAsset(id);
    if (!before) return res.status(404).json({ error: "asset not found" });
    const raw = req.body?.displayName;
    const next = typeof raw === "string" ? raw : null;
    const updated = updateAssetDisplayName(id, next);
    const actor = (req as import("express").Request & { user?: { displayName?: string } }).user?.displayName ?? null;
    recordAudit({
      kind: "write",
      actor,
      action: updated?.displayName ? "자산 표시 이름 변경" : "자산 표시 이름 원복",
      target: id,
      detail: `${before.displayName ?? before.name} → ${updated?.displayName ?? updated?.name ?? "-"}`,
      result: "ok",
    });
    res.json(updated);
  });
  app.delete("/api/assets/:id", authMiddleware, (req, res) => {
    const id = String(req.params.id);
    // ⚠ 지우기 **전에** 무엇이었는지 붙잡는다 — 지운 뒤엔 이름도 finding 수도 알 수 없다.
    //   2026-08-02 발견: 이름 변경은 기록을 남기는데 **삭제는 아무것도 안 남기고 있었다.**
    //   훨씬 큰 일인데 흔적이 없으면 "누가 왜 지웠지"를 영영 못 찾는다.
    const before = getAsset(id);
    const ok = deleteAsset(id);
    if (!ok) return res.status(404).json({ error: "asset not found" });
    const actor = (req as import("express").Request & { user?: { displayName?: string } }).user?.displayName ?? null;
    recordAudit({
      kind: "write",
      actor,
      action: "자산 삭제",
      target: id,
      detail: before
        ? `${before.displayName ?? before.name} · 유형=${before.assetType} · finding ${before.findings.length}건 함께 삭제`
        : "삭제 전 정보 없음",
      result: "ok",
    });
    res.json({ ok: true });
  });
}
