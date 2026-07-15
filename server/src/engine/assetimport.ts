// engine/assetimport.ts — 외부 AI 자산 탐지 제품의 결과 파일을 가져와 자산으로 등록한다.
//
// 배경(9.5절 자산 인벤토리 자동화 / 다음단계 3.6): Holistic AI·Zenity·Arthur 같은 AI 자산
// 탐지 제품과의 실시간 API 연동은 (1) 온프레미스/데이터 주권 원칙과 충돌하고 (2) 벤더별
// 계약·워크스페이스 연결을 전제한다. 그래서 API 대신 "그 제품들이 뽑아낸 탐지 결과(CSV/JSON
// export)를 사내에서 업로드하면 GIJO AS가 파싱해 자산 인벤토리에 등록·분석"하는 경로를 둔다.
// 파일은 사내에서만 이동하므로 데이터가 외부로 나가지 않는다. CTI의 어댑터 패턴과 같은 정신:
// 제품마다 export 필드명이 달라도 흔한 별칭(alias)으로 흡수한다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { registerAsset, Asset } from "./assets";

export interface ImportedAsset {
  name: string;
  assetType: string;
  owner: string;
  path: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  assets: Asset[];
}

// 제품마다 컬럼/필드명이 다르다 — 흔한 별칭을 소문자로 매핑해 흡수한다.
const FIELD_ALIASES: Record<keyof ImportedAsset, string[]> = {
  name: ["name", "asset_name", "agent_name", "resource_name", "tool", "tool_name", "application", "app", "model", "model_name", "service", "title"],
  assetType: ["type", "asset_type", "category", "risk_type", "classification", "kind", "resource_type"],
  owner: ["owner", "user", "username", "department", "team", "created_by", "account", "identity", "email"],
  path: ["location", "url", "endpoint", "path", "repository", "repo", "source", "host", "domain", "resource", "arn"],
};

function pick(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const v = row[a];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

// 이름 기반 결정적 id — 같은 자산을 다시 임포트하면 새로 쌓지 않고 갱신(upsert)한다.
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "asset";
}

function normalizeRow(raw: Record<string, unknown>): ImportedAsset | null {
  // 키를 소문자화하고 공백/하이픈을 언더스코어로 정규화한다 — "Risk Type"·"asset-name" 같은
  // 헤더를 alias("risk_type"/"asset_name")와 매칭시키기 위해서다.
  const low: Record<string, string> = {};
  for (const k of Object.keys(raw)) low[k.toLowerCase().trim().replace(/[\s-]+/g, "_")] = raw[k] == null ? "" : String(raw[k]);
  const name = pick(low, FIELD_ALIASES.name);
  if (!name) return null; // 이름 없는 행은 자산으로 볼 수 없다
  return {
    name,
    assetType: pick(low, FIELD_ALIASES.assetType) || "discovered-ai",
    owner: pick(low, FIELD_ALIASES.owner) || "-",
    path: pick(low, FIELD_ALIASES.path) || "",
  };
}

// 아주 작은 CSV 파서 — 따옴표로 감싼 필드와 그 안의 콤마/따옴표 이스케이프("")를 처리한다.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record); record = []; field = ""; }
    } else field += c;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record); }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
    return obj;
  });
}

function parseJson(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  // {assets:[...]} / {results:[...]} / {data:[...]} / {agents:[...]} 형태도 흡수
  if (parsed && typeof parsed === "object") {
    for (const key of ["assets", "results", "data", "agents", "items", "findings"]) {
      const v = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  throw new Error("JSON에서 자산 배열을 찾지 못했습니다 (배열 또는 {assets:[...]} 형태여야 합니다)");
}

export function parseDiscoveryReport(content: string, format: "json" | "csv"): ImportedAsset[] {
  const rows = format === "csv" ? parseCsv(content) : parseJson(content);
  return rows.map(normalizeRow).filter((a): a is ImportedAsset => a !== null);
}

export function importDiscoveredAssets(content: string, format: "json" | "csv", sourceLabel: string): ImportResult {
  const parsed = parseDiscoveryReport(content, format);
  const assets: Asset[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const id = `discovered:${slug(sourceLabel)}:${slug(item.name)}`;
    if (seen.has(id)) continue; // 같은 파일 내 중복은 한 번만
    seen.add(id);
    assets.push(
      registerAsset({
        id,
        name: item.name,
        path: item.path,
        assetType: item.assetType,
        owner: item.owner,
      })
    );
  }
  return { imported: assets.length, skipped: parsed.length - assets.length, assets };
}

export function registerAssetImportRoutes(app: Express): void {
  app.post("/api/assets/import", authMiddleware, (req, res) => {
    const { content, format, source } = req.body as { content?: string; format?: string; source?: string };
    if (!content || (format !== "json" && format !== "csv")) {
      res.status(400).json({ error: "content(문자열)와 format('json'|'csv')이 필요합니다" });
      return;
    }
    try {
      res.json(importDiscoveredAssets(content, format, source || "import"));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
