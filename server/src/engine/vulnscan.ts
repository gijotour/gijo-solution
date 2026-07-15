// engine/vulnscan.ts — 일반 취약점 스캐너(Tenable Nessus 등) 결과 업로드 → 자산 등록 + 취약점 반영
//
// AI-BOM(assets의 aibom)이 AI 자산 특화라면, 이쪽은 일반 IT 자산(호스트/서비스)의 취약점 관리다.
// Nessus 등이 export한 CSV/JSON을 업로드하면 호스트(IP)별로 그룹핑해 각 호스트를 자산으로 등록하고,
// 발견된 취약점을 그 자산의 findings(StandardFinding)로 기록한다 — modelscan 파이프라인과 같은
// 저장 경로(recordFindings)라 인벤토리·리포트·대시보드에 그대로 흘러든다. 스캔 대상 호스트가
// 곧 자산이므로 "취약점 점검 대상이 SBOM(자산 구성)에 포함"되는 셈이다.
// 실시간 API 구독 대신 export 파일 업로드로 처리한다(데이터 주권 — assetimport.ts와 같은 정신).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { registerAsset, recordFindings, Asset } from "./assets";
import type { StandardFinding } from "./bridge";

export interface VulnScanResult {
  hosts: number;
  findings: number;
  assets: Asset[];
}

// Nessus/일반 취약점 도구 CSV·JSON의 흔한 컬럼명 별칭.
const ALIASES = {
  host: ["host", "ip", "ip_address", "asset", "target", "hostname", "dns_name"],
  name: ["name", "plugin_name", "title", "vulnerability", "finding"],
  risk: ["risk", "risk_factor", "severity", "criticality"],
  cve: ["cve", "cve_id", "cves"],
  description: ["description", "synopsis", "plugin_output", "details"],
};

// Nessus Risk Factor / 일반 severity 문자열 → StandardFinding severity
function toSeverity(risk: string): StandardFinding["severity"] {
  const r = risk.toLowerCase();
  if (r.includes("critical")) return "critical";
  if (r.includes("high")) return "high";
  if (r.includes("medium") || r.includes("moderate")) return "medium";
  return "low"; // low/none/info 등
}

function pick(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const v = row[a];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

// assetimport.ts와 동일한 견고성의 작은 CSV 파서(따옴표/이스케이프 처리).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", inQuotes = false;
  let record: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record); record = []; field = ""; }
    } else field += c;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record); }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => (obj[h] = r[i] ?? ""));
    return obj;
  });
}

function parseJson(text: string): Record<string, string>[] {
  const parsed = JSON.parse(text) as unknown;
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.vulnerabilities ?? (parsed as Record<string, unknown>)?.findings ?? (parsed as Record<string, unknown>)?.results;
  if (!Array.isArray(arr)) throw new Error("JSON에서 취약점 배열을 찾지 못했습니다 (배열 또는 {vulnerabilities:[...]} 형태여야 합니다)");
  return (arr as Record<string, unknown>[]).map((r) => {
    const low: Record<string, string> = {};
    for (const k of Object.keys(r)) low[k.toLowerCase().trim().replace(/[\s-]+/g, "_")] = r[k] == null ? "" : String(r[k]);
    return low;
  });
}

export interface ParsedVuln {
  host: string;
  name: string;
  risk: string;
  cve: string;
  description: string;
}

export function parseVulnReport(content: string, format: "json" | "csv"): ParsedVuln[] {
  const rows = format === "csv" ? parseCsv(content) : parseJson(content);
  return rows
    .map((row) => ({
      host: pick(row, ALIASES.host),
      name: pick(row, ALIASES.name),
      risk: pick(row, ALIASES.risk),
      cve: pick(row, ALIASES.cve),
      description: pick(row, ALIASES.description),
    }))
    .filter((v) => v.host && v.name); // 호스트·항목명 없는 행은 무시
}

export function importVulnScan(content: string, format: "json" | "csv", sourceLabel: string): VulnScanResult {
  const parsed = parseVulnReport(content, format);
  // 호스트별로 그룹핑 — 한 호스트 = 한 자산, 그 호스트의 취약점들 = findings
  const byHost = new Map<string, ParsedVuln[]>();
  for (const v of parsed) {
    if (!byHost.has(v.host)) byHost.set(v.host, []);
    byHost.get(v.host)!.push(v);
  }

  const assets: Asset[] = [];
  for (const [host, vulns] of byHost) {
    const id = `vuln:${host}`;
    registerAsset({
      id,
      name: host,
      path: host,
      assetType: "infra-host",
      owner: sourceLabel,
      components: [],
    });
    const findings: StandardFinding[] = vulns
      // info/none 등급이면서 취약점명이 사실상 정보성인 것도 일단 기록(필터는 UI에서).
      .map((v) => ({
        finding_type: v.cve ? `${v.name} (${v.cve})` : v.name,
        severity: toSeverity(v.risk),
        evidence: v.description || `${host} — ${v.name}`,
        source_tool: sourceLabel,
      }));
    const asset = recordFindings(id, findings);
    if (asset) assets.push(asset);
  }
  return { hosts: byHost.size, findings: parsed.length, assets };
}

export function registerVulnScanRoutes(app: Express): void {
  app.post("/api/vulnscan/import", authMiddleware, (req, res) => {
    const { content, format, source } = req.body as { content?: string; format?: string; source?: string };
    if (!content || (format !== "json" && format !== "csv")) {
      res.status(400).json({ error: "content(문자열)와 format('json'|'csv')이 필요합니다" });
      return;
    }
    try {
      res.json(importVulnScan(content, format, source || "nessus"));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
