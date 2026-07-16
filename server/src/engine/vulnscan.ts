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
  findings: number; // 실제 취약점 수 (플러그인 기준 중복 제거 후)
  rows: number; // 원본 행 수 — Nessus는 CVE마다 행을 복제하므로 findings보다 클 수 있다
  assets: Asset[];
}

// Nessus/일반 취약점 도구 CSV·JSON의 흔한 컬럼명 별칭.
const ALIASES = {
  host: ["host", "ip", "ip_address", "asset", "target", "hostname", "dns_name"],
  name: ["name", "plugin_name", "title", "vulnerability", "finding"],
  risk: ["risk", "risk_factor", "severity", "criticality"],
  cve: ["cve", "cve_id", "cves"],
  description: ["description", "synopsis", "plugin_output", "details"],
  // 취약점 1건의 식별자. Nessus CSV는 CVE마다 행을 복제하므로(플러그인 1개에 CVE 17개면 17행),
  // 이 값으로 합쳐야 건수가 실제와 맞는다.
  pluginId: ["plugin_id", "pluginid", "check_id", "rule_id", "test_id"],
  // 실제 위협 지표 — CVSS 기반 Risk만 보면 "Medium인데 악용확률 94%"인 건이 후순위로 밀린다.
  epss: ["epss_score", "epss"],
  vpr: ["vpr_score", "vpr"],
  // 어느 포트에서 잡혔는지 — 조치할 때 필요한 맥락(예: Oracle 리스너 tcp/1521).
  port: ["port"],
  protocol: ["protocol", "proto"],
};

// 숫자 컬럼 파싱 — 값이 없거나 숫자가 아니면 undefined(0과 구분해야 정렬이 왜곡되지 않는다).
function pickNum(row: Record<string, string>, aliases: string[]): number | undefined {
  const raw = pick(row, aliases);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

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
  pluginId: string;
  epss?: number;
  vpr?: number;
  port: string;
  protocol: string;
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
      pluginId: pick(row, ALIASES.pluginId),
      epss: pickNum(row, ALIASES.epss),
      vpr: pickNum(row, ALIASES.vpr),
      port: pick(row, ALIASES.port),
      protocol: pick(row, ALIASES.protocol),
    }))
    .filter((v) => v.host && v.name); // 호스트·항목명 없는 행은 무시
}

// 취약점 1건의 표시명: 이름 + CVE. CVE가 여러 개면 대표 1개 + 나머지 개수로 줄인다.
// 항목명에 이미 그 CVE가 들어 있으면(Nessus 플러그인 이름에 흔함) 덧붙이지 않는다.
function findingLabel(name: string, cves: string[]): string {
  if (cves.length === 0) return name;
  if (cves.length === 1) return name.includes(cves[0]) ? name : `${name} (${cves[0]})`;
  return `${name} (${cves[0]} 외 ${cves.length - 1}건)`;
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
  let totalFindings = 0;
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

    // Nessus CSV는 플러그인(취약점) 1건을 CVE 개수만큼 행으로 복제해 내보낸다 — 그대로 세면
    // 건수가 몇 배로 부풀려진다(실측: 1,171행 = 실제 282건). 플러그인 id(없으면 항목명)로 합치고
    // CVE는 한 건에 모아 붙인다. EPSS/VPR도 플러그인 단위 점수라 CVE별로 나누는 게 의미가 없다.
    // 같은 플러그인이 여러 포트에서 잡히면 스캐너는 포트마다 한 줄씩 낸다(예: 포트 스캐너 계열).
    // 조치 대상은 어차피 하나이므로 한 건으로 합치고, 포트는 맥락으로 남긴다.
    const byVuln = new Map<string, { rep: ParsedVuln; cves: Set<string>; ports: Set<string>; epss?: number; vpr?: number }>();
    for (const v of vulns) {
      const key = v.pluginId || v.name;
      if (!byVuln.has(key)) byVuln.set(key, { rep: v, cves: new Set<string>(), ports: new Set<string>() });
      const g = byVuln.get(key)!;
      if (v.cve) g.cves.add(v.cve);
      // 포트 0은 "호스트 전체"를 뜻하는 Nessus 관례라 표기하지 않는다.
      if (v.port && v.port !== "0") g.ports.add(v.protocol ? `${v.protocol}/${v.port}` : v.port);
      // EPSS/VPR은 플러그인 단위 점수라 복제 행마다 같은 값이지만, 다를 경우 가장 위험한 값을 남긴다.
      if (v.epss !== undefined) g.epss = Math.max(g.epss ?? 0, v.epss);
      if (v.vpr !== undefined) g.vpr = Math.max(g.vpr ?? 0, v.vpr);
    }

    const findings: StandardFinding[] = [...byVuln.values()].map(({ rep, cves, ports, epss, vpr }) => {
      const list = [...cves].sort();
      const portList = [...ports].sort();
      // 요약에는 대표 CVE만 쓰되, 전체 목록·포트는 evidence에 남겨 추적성을 잃지 않는다.
      const evidence = [
        rep.description || `${host} — ${rep.name}`,
        portList.length ? `포트: ${portList.join(", ")}` : "",
        list.length > 1 ? `CVE(${list.length}): ${list.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        finding_type: findingLabel(rep.name, list),
        severity: toSeverity(rep.risk),
        evidence,
        source_tool: sourceLabel,
        ...(epss !== undefined ? { epss } : {}),
        ...(vpr !== undefined ? { vpr } : {}),
      };
    });
    totalFindings += findings.length;
    const asset = recordFindings(id, findings);
    if (asset) assets.push(asset);
  }
  return { hosts: byHost.size, findings: totalFindings, rows: parsed.length, assets };
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
