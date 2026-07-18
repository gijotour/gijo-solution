// engine/analysishub.ts — 통합 보안 분석(관제) 허브.
// 제품 1차 목표: 전문 스캐너 리포트·보안 로그·보안제품 운영 리포트를 한곳에서 정규화해
// "지금 제일 위험한 것"부터 우선순위로 보여주고(SOC형), 소스 간 상관관계를 짚어준다.
// (기존 analysis.ts는 finding을 LLM으로 해석하는 별개 모듈 — 여기서는 세 소스를 통합·정규화한다.)
//
// 세 소스를 공통 AnalysisEvent로 정규화한다:
//   · vuln    — 취약점 스캐너(Nessus 등). 기존 자산 findings를 재사용(중복 구현 안 함).
//   · log     — 보안 로그(방화벽/IDS/서버 auth). 결정적 패턴 탐지(현재: 인증 브루트포스).
//   · product — 보안제품 운영 리포트(백신/EDR/DLP). 결정적 키워드·수치 추출 + 요약 이벤트.
//
// 파서는 "모든 로그를 마법처럼 이해"하지 않는다 — 아래 명시한 패턴만 결정적으로 잡는다.
// 커버 범위는 점진 확장한다(honest scope). 판정이 결정적이라 재현 가능하고 테스트된다.

import type { Express, Request } from "express";
import * as crypto from "crypto";
import { db, migrate } from "../db";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { listAssets } from "./assets";
import { chat } from "./llm";

export type AnalysisSource = "vuln" | "log" | "product";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Priority = "P0" | "P1" | "P2" | "P3";
// 이벤트 생애주기 — 관제를 "처리해 나가는" 워크플로로. done/ignored는 해결(활성 위험 집계에서 제외).
export type EventStatus = "open" | "ack" | "inprogress" | "done" | "ignored";
const RESOLVED: EventStatus[] = ["done", "ignored"];

export interface AnalysisEvent {
  id: string;
  source: AnalysisSource;
  title: string;
  entity: string; // 호스트/IP/PC/사용자 — 소스 간 상관분석 키
  severity: Severity;
  priority: Priority;
  detail: string;
  signals: string[]; // KEV·인터넷노출·반복 등 위험 가중 신호
  aiSummary: string;
  ref: string; // 원 소스 참조(assetId·리포트명 등)
  at: number;
  status?: EventStatus; // 처리 상태(별도 테이블에서 병합 — 조회 시 항상 채워짐, 생성 시 생략)
  statusNote?: string;
}

db.exec(`CREATE TABLE IF NOT EXISTS analysis_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  entity TEXT NOT NULL,
  severity TEXT NOT NULL,
  priority TEXT NOT NULL,
  detail TEXT NOT NULL,
  signals TEXT NOT NULL,
  aiSummary TEXT NOT NULL,
  ref TEXT NOT NULL,
  at INTEGER NOT NULL
)`);

const upsertStmt = db.prepare(`INSERT INTO analysis_events (id, source, title, entity, severity, priority, detail, signals, aiSummary, ref, at)
  VALUES (@id, @source, @title, @entity, @severity, @priority, @detail, @signals, @aiSummary, @ref, @at)
  ON CONFLICT(id) DO UPDATE SET source=excluded.source, title=excluded.title, entity=excluded.entity,
    severity=excluded.severity, priority=excluded.priority, detail=excluded.detail, signals=excluded.signals,
    aiSummary=excluded.aiSummary, ref=excluded.ref, at=excluded.at`);
const listStmt = db.prepare("SELECT * FROM analysis_events ORDER BY at DESC");
const getEventStmt = db.prepare("SELECT * FROM analysis_events WHERE id = ?");
const deleteBySourceStmt = db.prepare("DELETE FROM analysis_events WHERE source = ?");

// 이벤트 상태는 별도 테이블(event id로 키)에 둔다 — vuln 이벤트는 rebuildVulnEvents가 delete+reinsert
// 하지만 id가 안정적(vuln:asset:key)이라 상태가 재빌드에도 살아남는다.
migrate(
  "analysis_event_status",
  "CREATE TABLE IF NOT EXISTS analysis_event_status (eventId TEXT PRIMARY KEY, status TEXT NOT NULL, note TEXT, at INTEGER NOT NULL, by TEXT)"
);
const getStatusStmt = db.prepare("SELECT status, note FROM analysis_event_status WHERE eventId = ?");
const setStatusStmt = db.prepare(
  `INSERT INTO analysis_event_status (eventId, status, note, at, by) VALUES (@eventId, @status, @note, @at, @by)
   ON CONFLICT(eventId) DO UPDATE SET status=excluded.status, note=excluded.note, at=excluded.at, by=excluded.by`
);
function getStatus(eventId: string): { status: EventStatus; note: string } {
  const r = getStatusStmt.get(eventId) as { status: EventStatus; note: string } | undefined;
  return { status: r?.status ?? "open", note: r?.note ?? "" };
}
export function setEventStatus(eventId: string, status: EventStatus, note = "", by = ""): void {
  setStatusStmt.run({ eventId, status, note, at: Date.now(), by });
}

interface EventRow extends Omit<AnalysisEvent, "signals" | "status" | "statusNote"> {
  signals: string;
}
function rowToEvent(r: EventRow): AnalysisEvent {
  const st = getStatus(r.id);
  return { ...r, signals: JSON.parse(r.signals || "[]"), status: st.status, statusNote: st.note };
}
function saveEvent(e: AnalysisEvent): void {
  // status/statusNote는 별도 테이블 소관이라 여기 컬럼에 넣지 않는다(명시 컬럼만 바인딩).
  upsertStmt.run({
    id: e.id,
    source: e.source,
    title: e.title,
    entity: e.entity,
    severity: e.severity,
    priority: e.priority,
    detail: e.detail,
    signals: JSON.stringify(e.signals),
    aiSummary: e.aiSummary,
    ref: e.ref,
    at: e.at,
  });
}

// ── 우선순위 산정 ─────────────────────────────────────────────────────────
// severity를 바탕으로, 실제 위협 신호(KEV·인터넷 노출·반복·활성 악용)가 있으면 끌어올린다.
// "CVSS는 높지만 안 털리는 것"보다 "지금 실제로 악용되는 것"을 앞세운다(Tenable VPR 사상).
const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const ESCALATING = ["KEV", "인터넷 노출", "브루트포스", "반복", "활성 악용", "C2 의심", "유출"];

export function computePriority(severity: Severity, signals: string[]): Priority {
  let score = SEV_RANK[severity];
  const hits = signals.filter((s) => ESCALATING.some((k) => s.includes(k))).length;
  if (hits >= 1) score += 1;
  if (hits >= 2) score += 1;
  // critical→P1·high→P1·medium→P2 기본, 실제 위협 신호(KEV·브루트포스 등)가 붙으면 P0로.
  if (score >= 5) return "P0";
  if (score >= 3) return "P1";
  if (score >= 2) return "P2";
  return "P3";
}

// ── 소스 ①: 취약점 스캐너 — 기존 자산 findings 재사용 ─────────────────────
// 자산의 열린 취약점을 AnalysisEvent로 투영한다. entity=호스트, signals=KEV/EPSS/재발.
// id는 자산+취약점 key로 안정화해 재빌드해도 중복되지 않는다.
export function rebuildVulnEvents(): number {
  deleteBySourceStmt.run("vuln");
  let n = 0;
  for (const a of listAssets()) {
    for (const f of a.findings) {
      if (f.state === "fixed") continue; // 고쳐진 건 관제 대상 아님
      const signals: string[] = [];
      if (f.kev) signals.push("KEV");
      if (typeof f.epss === "number" && f.epss >= 0.5) signals.push(`EPSS ${f.epss.toFixed(2)}`);
      if (f.state === "resurfaced") signals.push("재발");
      const sev = (f.severity as Severity) ?? "medium";
      const key = f.key || crypto.createHash("md5").update(a.id + f.finding_type).digest("hex").slice(0, 10);
      saveEvent({
        id: `vuln:${a.id}:${key}`,
        source: "vuln",
        title: f.finding_type,
        entity: a.name || a.id,
        severity: sev,
        priority: computePriority(sev, signals),
        detail: f.evidence || "",
        signals,
        aiSummary: "",
        ref: a.id,
        at: a.lastScannedAt || a.registeredAt || Date.now(),
      });
      n++;
    }
  }
  return n;
}

// ── 소스 ②: 보안 로그 — 결정적 패턴 탐지 ───────────────────────────────────
// 현재 커버: 인증 브루트포스(SSH/일반 auth). "Failed password ... from <IP>",
// "authentication failure ... rhost=<IP>", "Invalid user ... from <IP>" 를 소스 IP별로 집계해
// 임계치(기본 10회) 이상이면 이벤트를 만든다. 성공(Accepted) 로그가 있으면 "활성 악용"을 신호로 단다.
const FAIL_RES = [
  /Failed password .*? from\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
  /authentication failure;.*rhost=(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
  /Invalid user .*? from\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
];
const ACCEPT_RE = /Accepted (?:password|publickey) .*? from\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i;

export interface LogParseResult {
  events: AnalysisEvent[];
  matchedLines: number;
  totalLines: number;
}

// 탐지기 ①: 인증 브루트포스 — 소스 IP별 인증 실패 집계, 성공 로그 있으면 활성악용.
function detectBruteForce(source: string, lines: string[], threshold: number): { events: AnalysisEvent[]; matched: number } {
  const fails = new Map<string, number>();
  const accepts = new Set<string>();
  let matched = 0;
  for (const line of lines) {
    for (const re of FAIL_RES) {
      const m = line.match(re);
      if (m) { fails.set(m[1], (fails.get(m[1]) ?? 0) + 1); matched++; break; }
    }
    const acc = line.match(ACCEPT_RE);
    if (acc) accepts.add(acc[1]);
  }
  const events: AnalysisEvent[] = [];
  for (const [ip, count] of fails) {
    if (count < threshold) continue;
    const succeeded = accepts.has(ip);
    const signals = ["브루트포스"];
    if (succeeded) signals.push("활성 악용");
    const severity: Severity = succeeded ? "critical" : "high";
    events.push(mkLog(source, `log:${source}:brute:${ip}`, `인증 브루트포스 의심 — ${ip}`, ip, severity, signals,
      `${source}에서 ${ip}의 인증 실패 ${count}회${succeeded ? " 후 성공 로그 존재(계정 탈취 가능성)" : ""}. 임계치 ${threshold} 초과.`));
  }
  return { events, matched };
}

// 탐지기 ②: 방화벽 차단 — iptables/UFW(SRC=/DPT=)·Cisco(dst .../port) 차단 로그를 소스 IP별로 집계.
// 서로 다른 목적지 포트가 많으면 포트스캔, 차단 건수만 많으면 차단 폭주로 본다.
const DENY_RE = /\b(DENY|DROP|BLOCK|Deny|denied|REJECT|blocked)\b/i;
function extractDeny(line: string): { src: string; dpt?: string } | null {
  if (!DENY_RE.test(line)) return null;
  const src = (line.match(/SRC=(\d+\.\d+\.\d+\.\d+)/i) || line.match(/src\S*?\s?(\d+\.\d+\.\d+\.\d+)/i) || line.match(/(\d+\.\d+\.\d+\.\d+)/))?.[1];
  const dpt = (line.match(/DPT=(\d+)/i) || line.match(/dst \S*?\/(\d{1,5})/i) || line.match(/dpt\D{0,3}(\d{2,5})/i))?.[1];
  return src ? { src, dpt } : null;
}
function detectFirewall(source: string, lines: string[], portScanPorts = 15, floodThreshold = 30): { events: AnalysisEvent[]; matched: number } {
  const perSrc = new Map<string, { denies: number; ports: Set<string> }>();
  let matched = 0;
  for (const line of lines) {
    const d = extractDeny(line);
    if (!d) continue;
    matched++;
    const rec = perSrc.get(d.src) ?? { denies: 0, ports: new Set<string>() };
    rec.denies++;
    if (d.dpt) rec.ports.add(d.dpt);
    perSrc.set(d.src, rec);
  }
  const events: AnalysisEvent[] = [];
  for (const [ip, rec] of perSrc) {
    if (rec.ports.size >= portScanPorts) {
      events.push(mkLog(source, `log:${source}:scan:${ip}`, `포트 스캔 의심 — ${ip}`, ip, "high", ["포트스캔"],
        `${source}에서 ${ip}가 서로 다른 목적지 포트 ${rec.ports.size}개를 차단당함(차단 ${rec.denies}건) — 스캐닝 정황.`));
    } else if (rec.denies >= floodThreshold) {
      events.push(mkLog(source, `log:${source}:flood:${ip}`, `방화벽 차단 폭주 — ${ip}`, ip, "medium", ["반복"],
        `${source}에서 ${ip}가 ${rec.denies}회 차단됨 — 반복 접근 시도.`));
    }
  }
  return { events, matched };
}

// 탐지기 ③: 웹 공격 시그니처 — 접근 로그에서 SQLi/XSS/경로순회/명령주입 흔적을 소스 IP별로 집계.
const WEB_PATTERNS = [/union\s+select/i, /<script/i, /\.\.\/\.\.\//, /\/etc\/passwd/i, /\bor\b\s+['"]?1['"]?\s*=\s*['"]?1/i, /%27/i, /%3Cscript/i, /base64_decode/i, /\/bin\/(?:ba)?sh/i, /cmd\.exe/i, /\bexec\s*\(/i];
function detectWebAttack(source: string, lines: string[]): { events: AnalysisEvent[]; matched: number } {
  const perIp = new Map<string, number>();
  let matched = 0;
  for (const line of lines) {
    if (!WEB_PATTERNS.some((re) => re.test(line))) continue;
    matched++;
    const ip = (line.match(/^\s*(\d+\.\d+\.\d+\.\d+)/) || line.match(/(\d+\.\d+\.\d+\.\d+)/))?.[1] ?? "unknown";
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  }
  const events: AnalysisEvent[] = [];
  for (const [ip, hits] of perIp) {
    const severity: Severity = hits >= 5 ? "high" : "medium";
    events.push(mkLog(source, `log:${source}:web:${ip}`, `웹 공격 시그니처 — ${ip}`, ip, severity, ["웹공격"],
      `${source}에서 ${ip}의 요청에 웹 공격 흔적(SQLi/XSS/경로순회/명령주입 등) ${hits}건 탐지.`));
  }
  return { events, matched };
}

function mkLog(source: string, id: string, title: string, entity: string, severity: Severity, signals: string[], detail: string): AnalysisEvent {
  return { id, source: "log", title, entity, severity, priority: computePriority(severity, signals), detail, signals, aiSummary: "", ref: source, at: Date.now() };
}

// 여러 결정적 탐지기를 돌려 보안 로그를 이벤트로 정규화한다.
export function parseSecurityLog(source: string, content: string, threshold = 10): LogParseResult {
  const lines = content.split(/\r?\n/);
  const brute = detectBruteForce(source, lines, threshold);
  const fw = detectFirewall(source, lines);
  const web = detectWebAttack(source, lines);
  return {
    events: [...brute.events, ...fw.events, ...web.events],
    matchedLines: brute.matched + fw.matched + web.matched,
    totalLines: lines.length,
  };
}

// ── 소스 ③: 보안제품 운영 리포트 — 결정적 키워드·수치 추출 ─────────────────
// 백신/EDR/DLP 운영 리포트(CSV·텍스트)에서 조치 키워드(유출/차단/격리/탐지)별 라인 수를 뽑아
// 요약 이벤트를 만든다. 동일 대상(호스트/PC/IP)이 2회 이상 나오면 "반복" 신호로 개별 이벤트 추가.
const ACTION_KEYWORDS: { key: string; labels: string[]; severity: Severity; signal?: string }[] = [
  { key: "유출", labels: ["유출", "정보유출", "dlp", "exfil", "leak"], severity: "high", signal: "유출" },
  { key: "차단", labels: ["차단", "block", "denied"], severity: "medium" },
  { key: "격리", labels: ["격리", "quarantine", "quarantined"], severity: "medium" },
  { key: "탐지", labels: ["탐지", "detected", "detection", "malware", "threat"], severity: "medium" },
];

export interface ReportParseResult {
  events: AnalysisEvent[];
  counts: Record<string, number>;
}

export function parseProductReport(productName: string, content: string): ReportParseResult {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const counts: Record<string, number> = {};
  for (const { key, labels } of ACTION_KEYWORDS) {
    let c = 0;
    for (const line of lines) {
      const ll = line.toLowerCase();
      if (labels.some((lb) => ll.includes(lb))) c++;
    }
    if (c > 0) counts[key] = c;
  }
  const events: AnalysisEvent[] = [];
  if (Object.keys(counts).length) {
    // 가장 위험한 액션의 severity로 요약 이벤트 승격.
    const worst = ACTION_KEYWORDS.filter((a) => counts[a.key]).sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
    const signals = worst?.signal ? [worst.signal] : [];
    const severity = worst?.severity ?? "info";
    const summaryParts = Object.entries(counts).map(([k, v]) => `${k} ${v}건`);
    events.push({
      id: `product:${productName}:summary:${crypto.createHash("md5").update(content).digest("hex").slice(0, 8)}`,
      source: "product",
      title: `${productName} 운영 리포트`,
      entity: productName,
      severity,
      priority: computePriority(severity, signals),
      detail: `${productName}: ${summaryParts.join(" · ")}.`,
      signals,
      aiSummary: "",
      ref: productName,
      at: Date.now(),
    });
  }
  // 반복 대상(호스트명/PC/IP) 탐지 — 같은 식별자가 여러 라인에 나오면 잔존 위험으로 개별 이벤트.
  const hostTally = new Map<string, number>();
  const HOST_RE = /\b(PC-\w+|DESKTOP-\w+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
  for (const line of lines) {
    const seen = new Set<string>();
    for (const m of line.matchAll(HOST_RE)) seen.add(m[1]);
    for (const h of seen) hostTally.set(h, (hostTally.get(h) ?? 0) + 1);
  }
  for (const [host, times] of hostTally) {
    if (times < 2) continue;
    const signals = ["반복"];
    events.push({
      id: `product:${productName}:host:${host}`,
      source: "product",
      title: `반복 탐지 — ${host}`,
      entity: host,
      severity: "high",
      priority: computePriority("high", signals),
      detail: `${productName} 리포트에서 ${host}이(가) ${times}회 등장 — 잔존/재발 의심.`,
      signals,
      aiSummary: "",
      ref: productName,
      at: Date.now(),
    });
  }
  return { events, counts };
}

// ── 상관분석 ───────────────────────────────────────────────────────────────
// 같은 entity(호스트/IP/PC)가 2개 이상 서로 다른 소스에 나타나면 교차 위험으로 묶는다.
// 예: 백신 재발(product) + 비정상 아웃바운드(log)가 같은 PC → 감염+C2 연계 가능성.
export interface Correlation {
  entity: string;
  sources: AnalysisSource[];
  eventIds: string[];
  note: string;
}
function sourceLabel(s: AnalysisSource): string {
  return s === "vuln" ? "취약점" : s === "log" ? "보안로그" : "운영리포트";
}
export function computeCorrelations(events: AnalysisEvent[]): Correlation[] {
  const byEntity = new Map<string, AnalysisEvent[]>();
  for (const e of events) {
    if (!e.entity) continue;
    const k = e.entity.toLowerCase();
    const arr = byEntity.get(k) ?? [];
    arr.push(e);
    byEntity.set(k, arr);
  }
  const out: Correlation[] = [];
  for (const evs of byEntity.values()) {
    const sources = [...new Set(evs.map((e) => e.source))];
    if (sources.length < 2) continue;
    out.push({
      entity: evs[0].entity,
      sources,
      eventIds: evs.map((e) => e.id),
      note: `${evs[0].entity}이(가) ${sources.map(sourceLabel).join(" + ")}에 동시 출현 — 교차 위험 가능성. 함께 조사 권고.`,
    });
  }
  return out;
}

// ── 조회 ───────────────────────────────────────────────────────────────────
const PRI_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const isResolved = (e: AnalysisEvent): boolean => RESOLVED.includes(e.status ?? "open");
export function listAnalysisEvents(): AnalysisEvent[] {
  const events = (listStmt.all() as EventRow[]).map(rowToEvent);
  // 해결(완료/무시)된 건 아래로, 나머지는 위험도순.
  return events.sort((a, b) => {
    const ar = isResolved(a) ? 1 : 0;
    const br = isResolved(b) ? 1 : 0;
    if (ar !== br) return ar - br;
    return PRI_RANK[a.priority] - PRI_RANK[b.priority] || SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.at - a.at;
  });
}
export function analysisSummary(events: AnalysisEvent[]): {
  total: number;
  bySource: Record<AnalysisSource, number>;
  byPriority: Record<Priority, number>;
  overall: "높음" | "보통" | "낮음";
} {
  const bySource: Record<AnalysisSource, number> = { vuln: 0, log: 0, product: 0 };
  const byPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  // 종합위험·우선순위는 미해결(active) 이벤트만 집계 — 완료/무시한 건 위험에서 빠진다(워크플로).
  const active = events.filter((e) => !RESOLVED.includes(e.status ?? "open"));
  for (const e of active) {
    bySource[e.source]++;
    byPriority[e.priority]++;
  }
  const overall = byPriority.P0 > 0 ? "높음" : byPriority.P1 > 0 ? "보통" : "낮음";
  return { total: active.length, bySource, byPriority, overall };
}

export function getAnalysisEvent(id: string): AnalysisEvent | undefined {
  const r = getEventStmt.get(id) as EventRow | undefined;
  return r ? rowToEvent(r) : undefined;
}

// ── LLM 이벤트 분석 ─────────────────────────────────────────────────────────
// 결정적 파서가 "무엇을" 잡았다면, LLM은 담당자에게 "무슨 일·왜 위험·뭘 해야" 를 붙인다.
// 이벤트 상세 + 상관관계를 근거로 주입(그라운딩) — 추측을 사실처럼 쓰지 않게 지시.
export function buildAnalysisPrompt(e: AnalysisEvent, correlation?: Correlation): string {
  const srcKo = e.source === "vuln" ? "취약점 스캐너" : e.source === "log" ? "보안 로그" : "보안제품 운영 리포트";
  return [
    "당신은 1인 보안담당자를 돕는 보안 분석가입니다. 아래 보안 이벤트를 한국어로 간결히 분석하세요.",
    "형식: ① 무슨 일인지(1문장) ② 왜 위험한지(1문장) ③ 지금 할 조치(1~2가지, 구체적으로).",
    "제공된 근거만 사용하고, 추측을 사실처럼 쓰지 마세요. 근거가 부족하면 '확인 필요'로 표시하세요.",
    "",
    `[소스] ${srcKo}`,
    `[제목] ${e.title}`,
    `[대상] ${e.entity}`,
    `[심각도/우선순위] ${e.severity} / ${e.priority}`,
    `[신호] ${e.signals.join(", ") || "없음"}`,
    `[상세] ${e.detail}`,
    correlation ? `[상관관계] ${correlation.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function analyzeEvent(id: string): Promise<string> {
  const e = getAnalysisEvent(id);
  if (!e) throw new Error("이벤트를 찾을 수 없습니다.");
  const corr = computeCorrelations(listAnalysisEvents()).find((c) => c.eventIds.includes(id));
  const summary = (await chat({ agentId: "analysis", message: buildAnalysisPrompt(e, corr) })).trim();
  saveEvent({ ...e, aiSummary: summary });
  return summary;
}

export function resetAnalysisHubForTests(): void {
  db.exec("DELETE FROM analysis_events");
  db.exec("DELETE FROM analysis_event_status");
}

// 드롭존 자동 판별: 파일명·내용으로 보안 로그 vs 운영 리포트를 가른다(결정적 규칙).
// 취약점 스캔(.nessus/스캔 CSV)은 취약점 업로드가 담당하고 rebuildVulnEvents로 자동 반영되므로 여기서 제외.
export function detectIngestKind(filename: string, content: string): "log" | "report" {
  const f = (filename || "").toLowerCase();
  if (/\.(log|syslog)$/.test(f)) return "log";
  // 대표적 보안/시스템 로그 시그니처.
  if (/sshd\[|Failed password|authentication failure|Invalid user|kernel:|iptables|UFW |denied by/i.test(content)) return "log";
  return "report"; // CSV·운영 리포트
}

// ── 라우트 ─────────────────────────────────────────────────────────────────
export function registerAnalysisHubRoutes(app: Express): void {
  // 통합 위험 리스트 + 요약 + 상관분석 — 관제 화면의 단일 진입.
  app.get("/api/analysis-hub/events", authMiddleware, (_req, res) => {
    const events = listAnalysisEvents();
    res.json({ events, summary: analysisSummary(events), correlations: computeCorrelations(events) });
  });
  // 취약점 소스 재빌드(자산 findings → 이벤트).
  app.post("/api/analysis-hub/rebuild-vuln", authMiddleware, (_req, res) => {
    res.json({ inserted: rebuildVulnEvents() });
  });
  // 이벤트 상태 변경 — 관제 워크플로(확인/처리중/완료/무시). 완료·무시는 활성 위험에서 빠진다.
  app.post("/api/analysis-hub/events/:id/status", authMiddleware, (req, res) => {
    const id = String(req.params.id);
    const status = String(req.body?.status || "") as EventStatus;
    if (!["open", "ack", "inprogress", "done", "ignored"].includes(status)) {
      return res.status(400).json({ error: "잘못된 상태입니다(open/ack/inprogress/done/ignored)" });
    }
    const user = (req as Request & { user?: { displayName?: string } }).user;
    setEventStatus(id, status, String(req.body?.note || ""), user?.displayName || "");
    res.json({ ok: true, id, status });
  });
  // 보안 로그 인입 — 결정적 패턴 탐지.
  app.post(
    "/api/analysis-hub/ingest-log",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const name = String(req.body?.source || req.body?.filename || "로그");
      const content = String(req.body?.content ?? "");
      if (!content.trim()) return res.status(400).json({ error: "로그 내용이 비었습니다." });
      const r = parseSecurityLog(name, content);
      r.events.forEach(saveEvent);
      res.json({ created: r.events.length, matchedLines: r.matchedLines, totalLines: r.totalLines, events: r.events });
    })
  );
  // 보안제품 운영 리포트 인입 — 키워드·수치 추출 + 요약.
  app.post(
    "/api/analysis-hub/ingest-report",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const name = String(req.body?.productName || req.body?.filename || "보안제품");
      const content = String(req.body?.content ?? "");
      if (!content.trim()) return res.status(400).json({ error: "리포트 내용이 비었습니다." });
      const r = parseProductReport(name, content);
      r.events.forEach(saveEvent);
      res.json({ created: r.events.length, counts: r.counts, events: r.events });
    })
  );
  // 이벤트 LLM 분석 — 무슨 일·왜 위험·권고 조치(상세+상관 그라운딩). 결과를 이벤트 aiSummary에 저장.
  app.post(
    "/api/analysis-hub/analyze",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const id = String(req.body?.eventId || "");
      if (!id) return res.status(400).json({ error: "eventId가 필요합니다." });
      try {
        res.json({ aiSummary: await analyzeEvent(id) });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    })
  );
  // 드롭존 통합 인입 — 파일 하나를 자동 판별해 로그/리포트 파이프라인으로 라우팅.
  app.post(
    "/api/analysis-hub/ingest",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const filename = String(req.body?.filename || "");
      const content = String(req.body?.content ?? "");
      if (!content.trim()) return res.status(400).json({ error: "내용이 비었습니다." });
      const kind = detectIngestKind(filename, content);
      const label = filename || (kind === "log" ? "로그" : "보안제품");
      const r = kind === "log" ? parseSecurityLog(label, content) : parseProductReport(label, content);
      r.events.forEach(saveEvent);
      res.json({ routedTo: kind, created: r.events.length, events: r.events });
    })
  );
}
