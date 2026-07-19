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
import { registerAsset, updateAssetMeta, recordFindings, getAsset, Asset, AssetComponent } from "./assets";
import type { StandardFinding } from "./bridge";
import { kevMatches } from "./kev";

export interface VulnScanResult {
  hosts: number;
  findings: number; // 실제 취약점 수 (플러그인 기준 중복 제거 후)
  rows: number; // 원본 행 수 — Nessus는 CVE마다 행을 복제하므로 findings보다 클 수 있다
  assets: Asset[];
  // 비인증(uncredentialed) 스캔으로 점검된 호스트 — 로컬 취약점 탐지·조치검증 신뢰도가 낮다는 경고용.
  uncredentialedHosts: string[];
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
  output?: string; // 플러그인 출력(주로 19506 "Nessus Scan Information"의 인증 여부 판별용)
}

// 호스트 부가 정보 — CSV에는 없고 Nessus HTML 리포트에만 있다. 자산에 이름·OS를 채우는 데 쓴다.
export interface HostMeta {
  dnsName?: string;
  os?: string;
  mac?: string;
  // 이 호스트가 인증(credentialed) 스캔으로 점검됐는지(플러그인 19506 "Credentialed checks : yes/no").
  // 비인증 스캔은 로컬 취약점 탐지·조치검증 신뢰도가 낮다(Tenable §조치 검증 요건).
  credentialed?: boolean;
}

// 플러그인 19506("Nessus Scan Information") 출력의 "Credentialed checks : yes/no"로 인증 스캔 여부 판별.
// 어느 포맷(CSV plugin_output·HTML 본문·XML plugin_output)이든 같은 문구가 나온다.
function detectCredentialed(text: string): boolean | undefined {
  const m = /Credentialed checks\s*:\s*(yes|no)/i.exec(text);
  return m ? m[1].toLowerCase() === "yes" : undefined;
}

// ── Nessus HTML 리포트 파서 ─────────────────────────────────────────────────
// 구조: 호스트 헤더(font-size:22px) → Host Information 표 → 취약점 블록들.
// 취약점 블록 = 헤더 div(onclick="toggleSection(...)">"<pluginId> - <이름>") + 상세 컨테이너.
// 심각도는 헤더 배경색으로도 구분되지만 색 대신 본문의 "Risk Factor" 텍스트를 쓴다(견고함).
function htmlToText(fragment: string): string {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|div|p|h[1-6]|li|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// "라벨:\n값" 형태에서 값 한 줄을 뽑는다.
function fieldAfter(text: string, label: string): string | undefined {
  const m = text.match(new RegExp(label + "\\s*:?\\s*\\n?\\s*(.+)"));
  const v = m?.[1]?.trim();
  return v && v.length ? v : undefined;
}

const HOST_HEADER_RE = /<div[^>]*style="font-size:\s*22px;[^"]*"[^>]*>([^<]+)<div class="clear">/g;
// 취약점 헤더: 배경색(심각도) + "<pluginId> - <이름>".
// onclick 값은 "toggleSection('idN-container');" 처럼 세미콜론이 붙기도 하므로 속성 끝(")까지 흘려보낸다.
const VULN_HEADER_RE = /<div[^>]*background:\s*(#[0-9A-Fa-f]{6})[^>]*onclick="toggleSection\([^"]*"[^>]*>\s*(\d{3,8})\s*-\s*([^<]+?)\s*<div/g;

// 심각도는 헤더 배경색으로 읽는다. 본문의 "Risk Factor" 텍스트는 플러그인의 정적 위험도라
// 실제 등급과 다르다(실측: Log4j 1.x — Risk Factor "High" 인데 실제 Critical). 색상 분포는
// 같은 스캔의 CSV Risk 분포와 정확히 일치함을 확인해 이 매핑을 채택했다.
const NESSUS_SEVERITY_COLORS: Record<string, string> = {
  "#91243E": "Critical",
  "#DD4B50": "High",
  "#F18C43": "Medium",
  "#F8C851": "Low",
  "#67ACE1": "None",
};

export function parseNessusHtml(html: string): { vulns: ParsedVuln[]; meta: Map<string, HostMeta> } {
  const vulns: ParsedVuln[] = [];
  const meta = new Map<string, HostMeta>();

  // 호스트별로 문서를 자른다(단일 호스트 리포트면 구간 1개).
  const heads = [...html.matchAll(HOST_HEADER_RE)];
  const segments = heads.map((h, i) => ({
    host: h[1].trim(),
    body: html.slice(h.index! + h[0].length, i + 1 < heads.length ? heads[i + 1].index! : html.length),
  }));

  for (const seg of segments) {
    // "Host Information" 표(DNS Name/IP/MAC/OS)는 요약 표 뒤라 문서 앞부분만 봐선 놓친다 —
    // 라벨 위치를 찾아 그 뒤를 읽는다.
    const hi = seg.body.indexOf("Host Information");
    const headText = htmlToText(hi >= 0 ? seg.body.slice(hi, hi + 2500) : seg.body.slice(0, 3000));
    const os = fieldAfter(headText, "OS");
    const dnsName = fieldAfter(headText, "DNS Name");
    const mac = fieldAfter(headText, "MAC Address");
    // 인증 스캔 여부는 플러그인 19506 블록 본문에 있다(구간 전체를 훑는다).
    const credentialed = detectCredentialed(seg.body);
    if (os || dnsName || mac || credentialed !== undefined) meta.set(seg.host, { os, dnsName, mac, credentialed });

    // 취약점 블록: 헤더 사이 구간이 그 취약점의 상세다.
    const vh = [...seg.body.matchAll(VULN_HEADER_RE)];
    for (let i = 0; i < vh.length; i++) {
      const color = vh[i][1].toUpperCase();
      const pluginId = vh[i][2];
      const name = htmlToText(vh[i][3]);
      const block = seg.body.slice(vh[i].index!, i + 1 < vh.length ? vh[i + 1].index! : seg.body.length);
      const text = htmlToText(block);

      // 색상 매핑이 우선(실측 검증됨), 모르는 색이면 본문 텍스트로 폴백.
      const risk = NESSUS_SEVERITY_COLORS[color] ?? fieldAfter(text, "Risk Factor") ?? "";
      const description = (fieldAfter(text, "Synopsis") ?? "").slice(0, 400);
      const epssRaw = fieldAfter(text, "EPSS Score");
      const vprRaw = fieldAfter(text, "VPR Score");
      const epss = epssRaw && Number.isFinite(Number(epssRaw)) ? Number(epssRaw) : undefined;
      const vpr = vprRaw && Number.isFinite(Number(vprRaw)) ? Number(vprRaw) : undefined;
      const cves = [...new Set([...block.matchAll(/CVE-\d{4}-\d{3,7}/g)].map((m) => m[0]))];
      const ports = [...new Set([...block.matchAll(/<h2>([a-z]+)\/(\d+)<\/h2>/g)].map((m) => `${m[1]}/${m[2]}`))];
      const split = (p: string) => ({ protocol: p.split("/")[0], port: p.split("/")[1] });
      const first = ports.length ? split(ports[0]) : { protocol: "", port: "" };
      const base = { host: seg.host, name, risk, description, pluginId, epss, vpr };

      // CSV처럼 CVE 하나당 한 항목을 내보내면 기존 병합 로직(플러그인 기준 합치기 + CVE 수집)이
      // 그대로 동작한다. 포트가 여러 개면 나머지 포트도 항목으로 내보내 병합 때 수집되게 한다.
      if (cves.length) for (const cve of cves) vulns.push({ ...base, cve, ...first });
      else vulns.push({ ...base, cve: "", ...first });
      for (const p of ports.slice(1)) vulns.push({ ...base, cve: "", ...split(p) });
    }
  }
  return { vulns, meta };
}

// ── Nessus 네이티브 .nessus(XML) 파서 ───────────────────────────────────────
// 구조: <ReportHost name="IP"><HostProperties><tag name="host-fqdn">…</tag>
//   <tag name="operating-system">…</tag>…</HostProperties>
//   <ReportItem port="1521" protocol="tcp" severity="0~4" pluginID="…" pluginName="…">
//     <cve>…</cve> <risk_factor>…</risk_factor> <epss_score>…</epss_score> <vpr_score>…</vpr_score>
//     <synopsis>…</synopsis> …</ReportItem></ReportHost>
// 심각도는 severity 속성(0=info,1=low,2=med,3=high,4=critical)을 신뢰한다 — 이게 Nessus의
// 실제 등급이다(HTML의 Risk Factor 텍스트 함정 회피). CSV/HTML과 같은 {vulns, meta} 형태로 반환.
function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x?[0-9a-fA-F]+;/g, " ").replace(/&amp;/g, "&");
}
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? xmlUnescape(m[1]) : "";
}
function elemText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? xmlUnescape(m[1].trim()) : "";
}
const XML_SEVERITY: Record<string, string> = { "0": "None", "1": "Low", "2": "Medium", "3": "High", "4": "Critical" };

export function parseNessusXml(xml: string): { vulns: ParsedVuln[]; meta: Map<string, HostMeta> } {
  const vulns: ParsedVuln[] = [];
  const meta = new Map<string, HostMeta>();
  const hostRe = /<ReportHost\b([^>]*)>([\s\S]*?)<\/ReportHost>/g;
  let hm: RegExpExecArray | null;
  while ((hm = hostRe.exec(xml)) !== null) {
    const host = attr(`<ReportHost ${hm[1]}>`, "name");
    if (!host) continue;
    const body = hm[2];
    const propTag = (name: string) => {
      const m = body.match(new RegExp(`<tag[^>]*name\\s*=\\s*"${name}"[^>]*>([\\s\\S]*?)</tag>`, "i"));
      return m ? xmlUnescape(m[1].trim()) : undefined;
    };
    const os = propTag("operating-system");
    const dnsName = propTag("host-fqdn") ?? propTag("host-rdns");
    const mac = propTag("mac-address");
    // 인증 스캔 여부: 플러그인 19506 출력에 "Credentialed checks : yes/no". Nessus는 이를 호스트
    // 속성(Credentialed_Scan)으로도 남긴다 — 둘 다 확인한다.
    const credentialed = propTag("Credentialed_Scan") !== undefined ? propTag("Credentialed_Scan") === "true" : detectCredentialed(body);
    if (os || dnsName || mac || credentialed !== undefined) meta.set(host, { os, dnsName, mac, credentialed });

    const itemRe = /<ReportItem\b([^>]*)>([\s\S]*?)<\/ReportItem>/g;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(body)) !== null) {
      const open = `<ReportItem ${im[1]}>`;
      const block = im[2];
      const pluginId = attr(open, "pluginID");
      const name = attr(open, "pluginName");
      if (!name) continue;
      const risk = XML_SEVERITY[attr(open, "severity")] ?? elemText(block, "risk_factor") ?? "";
      const epssRaw = elemText(block, "epss_score");
      const vprRaw = elemText(block, "vpr_score");
      const epss = epssRaw && Number.isFinite(Number(epssRaw)) ? Number(epssRaw) : undefined;
      const vpr = vprRaw && Number.isFinite(Number(vprRaw)) ? Number(vprRaw) : undefined;
      const cves = [...new Set([...block.matchAll(/<cve>\s*(CVE-\d{4}-\d{3,7})\s*<\/cve>/gi)].map((m) => m[1].toUpperCase()))];
      const description = (elemText(block, "synopsis") || elemText(block, "description")).slice(0, 400);
      const port = attr(open, "port");
      const protocol = attr(open, "protocol");
      const base = { host, name, risk, description, pluginId, epss, vpr, port, protocol };
      // CVE 하나당 한 항목(기존 병합 로직이 플러그인 기준으로 다시 합친다). CVE 없으면 1건.
      if (cves.length) for (const cve of cves) vulns.push({ ...base, cve });
      else vulns.push({ ...base, cve: "" });
    }
  }
  return { vulns, meta };
}

export type VulnFormat = "json" | "csv" | "html" | "nessus";

export function parseVulnReport(content: string, format: VulnFormat): ParsedVuln[] {
  if (format === "html") return parseNessusHtml(content).vulns;
  if (format === "nessus") return parseNessusXml(content).vulns;
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
      output: pick(row, ["plugin_output", "output"]),
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

// 스캔 간 취약점 상태(new/active/fixed/resurfaced). 이전 스냅샷과 key로 대조한다(Tenable과 동일 개념).
// - 이번에 처음 보이면 new, 이전에도 있었으면 active
// - 이전에 fixed였는데 다시 나타나면 resurfaced
// - 이전엔 있었는데 이번에 없으면 fixed. fixed는 재발할 때까지 목록에 유지한다(고쳐진 이력 보존).
// credentialed: 이번(재)스캔이 인증 스캔인지. Fixed 판정의 신뢰도(fixedVerified)를 좌우한다 —
// 비인증 스캔에서 사라진 것은 정말 고쳐진 게 아니라 스캐너 가시성이 준 것일 수 있다(Tenable §조치 검증).
function applyStateTracking(prev: StandardFinding[], current: StandardFinding[], credentialed?: boolean): StandardFinding[] {
  // 상태 추적 도입 이전에 저장된 스냅샷은 key/state가 없다 — 새 key와 매칭되지 않아 전부 유령
  // fixed가 되어버린다. 그런 옛 스냅샷 위에 처음 임포트할 땐 기준선으로 삼는다(전부 new, fixed 없음).
  const legacyPrev = prev.length > 0 && !prev.some((p) => p.key !== undefined || p.state !== undefined);
  if (legacyPrev) {
    for (const f of current) f.state = "new";
    return current;
  }

  const keyOf = (f: StandardFinding) => f.key ?? f.finding_type;
  const prevActive = new Set(prev.filter((p) => p.state !== "fixed").map(keyOf));
  const prevFixed = new Set(prev.filter((p) => p.state === "fixed").map(keyOf));

  for (const f of current) {
    const k = keyOf(f);
    f.state = prevFixed.has(k) ? "resurfaced" : prevActive.has(k) ? "active" : "new";
  }
  const curKeys = new Set(current.map(keyOf));
  // 이번 스캔에 없는 이전 항목은 fixed로 유지(방금 고쳐진 것 + 이전부터 고쳐져 계속 없는 것).
  // 목록 크기는 그 호스트에서 관측된 고유 취약점 수로 유한하다.
  // 검증 신뢰도: 인증 재스캔에서 안 보이면 검증됨(이전에 미검증이던 것도 승격). 비인증이면 방금 고쳐진
  // 것은 미검증(false)으로 두되, 이미 검증된 이력은 강등하지 않는다.
  const carriedFixed = prev
    .filter((p) => !curKeys.has(keyOf(p)))
    .map((p) => ({
      ...p,
      state: "fixed" as const,
      fixedVerified: credentialed === true ? true : p.state === "fixed" ? p.fixedVerified : credentialed,
    }));
  return [...current, ...carriedFixed];
}

export function importVulnScan(content: string, format: VulnFormat, sourceLabel: string): VulnScanResult {
  // HTML·.nessus 리포트에는 CSV에 없는 호스트 정보(DNS 이름·OS)가 있다 — 자산 이름·구성요소로 채운다.
  const withMeta = format === "html" ? parseNessusHtml(content) : format === "nessus" ? parseNessusXml(content) : null;
  const parsed = withMeta ? withMeta.vulns : parseVulnReport(content, format);
  const metaOf = (host: string): HostMeta => withMeta?.meta.get(host) ?? {};
  // 호스트별로 그룹핑 — 한 호스트 = 한 자산, 그 호스트의 취약점들 = findings
  const byHost = new Map<string, ParsedVuln[]>();
  for (const v of parsed) {
    if (!byHost.has(v.host)) byHost.set(v.host, []);
    byHost.get(v.host)!.push(v);
  }

  const assets: Asset[] = [];
  const uncredentialedHosts: string[] = [];
  let totalFindings = 0;
  for (const [host, vulns] of byHost) {
    const id = `vuln:${host}`;
    // 상태 추적: registerAsset이 findings를 초기화하므로 그 전에 이전 스냅샷을 확보한다.
    const existing = getAsset(id);
    const prevFindings = existing?.findings ?? [];
    const meta = metaOf(host);
    // 인증 스캔 여부: HTML/XML은 meta에, CSV/JSON은 플러그인 출력에서 찾는다(19506 "Nessus Scan Information").
    const credentialed = meta.credentialed ?? vulns.map((v) => detectCredentialed(v.output ?? "")).find((c) => c !== undefined);
    if (credentialed === false) uncredentialedHosts.push(host);
    // OS/커널은 이 호스트의 구성요소(SBOM)로 넣는다 — "취약점 점검 대상이 자산 구성에 포함"되는 설계.
    // 예: "Linux Kernel 4.18.0-... on Red Hat Enterprise Linux release 8.10 (Ootpa)"
    const components: AssetComponent[] = [];
    if (meta.os) {
      const m = meta.os.match(/^(.*?)\s+on\s+(.*)$/i);
      if (m) {
        components.push({ name: m[2].trim(), version: "-", license: "-" }); // 배포판
        components.push({ name: m[1].trim().replace(/\s+\S+$/, "").trim() || "Kernel", version: (m[1].match(/\S+$/) ?? ["-"])[0], license: "-" });
      } else {
        components.push({ name: meta.os, version: "-", license: "-" });
      }
    }
    const name = meta.dnsName ? `${meta.dnsName} (${host})` : host;
    // 재스캔이면 registerAsset(스캔 이력 삭제)이 아니라 메타만 갱신해 과거 스캔 스냅샷을 보존한다 —
    // 취약점 번다운/측정(재스캔 간 위험 감소 추적)은 이 이력이 있어야 성립한다.
    // owner(담당부서)에 sourceLabel(출처 파일명)을 넣지 않는다 — 의미가 다른 필드다.
    // 실측(2026-07-19): 담당부서에 "nessus-scan-sample.csv" 같은 값이 6건 저장돼 있었다.
    // 사고 발생 시 연락할 대상을 알 수 없게 되고, 화면상으로는 "담당부서 채워짐"으로 보여
    // 결손이 감춰진다. 출처는 finding의 source_tool에 이미 기록된다(아래).
    //
    // 재스캔 시에는 기존 owner를 보존한다. 예전에는 sourceLabel로 덮어써서, 담당자가 손으로
    // 지정해둔 담당부서가 재스캔 한 번에 날아갔다.
    if (existing) updateAssetMeta(id, name, existing.owner ?? "", components);
    else registerAsset({ id, name, path: host, assetType: "infra-host", owner: "", components });

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
      const kevCves = kevMatches(list); // 이 취약점의 CVE 중 실제 악용 확인(CISA KEV)된 것
      return {
        finding_type: findingLabel(rep.name, list),
        severity: toSeverity(rep.risk),
        evidence: kevCves.length ? `${evidence}\n⚠ CISA KEV(실제 악용 확인): ${kevCves.join(", ")}` : evidence,
        source_tool: sourceLabel,
        key: rep.pluginId || rep.name, // 스캔 간 동일 취약점을 잇는 안정적 식별자
        ...(epss !== undefined ? { epss } : {}),
        ...(vpr !== undefined ? { vpr } : {}),
        ...(kevCves.length ? { kev: true, kevCves } : {}),
      };
    });
    // 이전 스냅샷과 대조해 new/active/resurfaced 태깅 + 이번에 고쳐진 것(fixed) 추가.
    // 인증 여부를 넘겨 Fixed 검증 신뢰도(fixedVerified)를 함께 판정한다.
    const findingsWithState = applyStateTracking(prevFindings, findings, credentialed);
    // findings(fixed 제외)만 "현재 취약점" 카운트로 센다.
    totalFindings += findingsWithState.filter((f) => f.state !== "fixed").length;
    const asset = recordFindings(id, findingsWithState);
    if (asset) assets.push(asset);
  }
  return { hosts: byHost.size, findings: totalFindings, rows: parsed.length, assets, uncredentialedHosts };
}

export function registerVulnScanRoutes(app: Express): void {
  app.post("/api/vulnscan/import", authMiddleware, (req, res) => {
    const { content, format, source } = req.body as { content?: string; format?: string; source?: string };
    if (!content || (format !== "json" && format !== "csv" && format !== "html" && format !== "nessus")) {
      res.status(400).json({ error: "content(문자열)와 format('json'|'csv'|'html'|'nessus')이 필요합니다" });
      return;
    }
    try {
      res.json(importVulnScan(content, format, source || "nessus"));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
