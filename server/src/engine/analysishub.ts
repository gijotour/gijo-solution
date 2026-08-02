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
// 스캔 실패 판정은 한 곳만 쓴다 — 호출부마다 제 규칙을 두면 화면마다 숫자가 달라진다.
import { isRealVulnerability } from "./agenttools";
import { chat } from "./llm";
import { PLAIN_LANGUAGE_RULE } from "./promptstyle";

export type AnalysisSource = "vuln" | "log" | "product" | "hardening";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Priority = "P0" | "P1" | "P2" | "P3";
// 이벤트 생애주기 — 관제를 "처리해 나가는" 워크플로로. done/ignored는 해결(활성 위험 집계에서 제외).
export type EventStatus = "open" | "ack" | "inprogress" | "done" | "ignored";
const RESOLVED: EventStatus[] = ["done", "ignored"];

export interface AnalysisEvent {
  id: string;
  source: AnalysisSource;
  title: string;
  entity: string; // 호스트/IP/PC/사용자 — 소스 간 상관분석 키(이 이벤트의 주인공)
  /** 이 이벤트가 **함께 가리키는 우리 쪽 개체**(공격 대상 호스트 등) — 두 번째 상관 키.
   *  ⚠ 로그 이벤트의 entity는 공격자 IP다. 이 값이 없으면 로그는 취약점·운영리포트와
   *  구조적으로 절대 안 묶인다(2026-08-01 실측 결함). db.ts의 analysis-peers 주석 참고. */
  peers?: string[];
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

// 분석 이벤트의 **두 번째 상관 키** — 이 이벤트가 함께 가리키는 우리 쪽 개체(공격 대상 호스트).
//
// ⚠ 실측으로 드러난 설계 결함(2026-08-01): 보안로그 이벤트 3종(브루트포스·방화벽·웹)이
//   전부 entity에 **공격자 출발지 IP**를 넣고 있었다. 상관은 "같은 entity가 2개 이상 소스에
//   나타나면 묶는다"인데, 남의 IP가 우리 자산 이름과 같을 리 없다 — 즉 **로그는 취약점·
//   운영리포트·하드닝 어느 것과도 구조적으로 절대 안 묶였다.** 상관분석 주석이 예로 든
//   "백신 재발(product) + 비정상 아웃바운드(log)가 같은 PC"조차 성립할 수 없었다.
//   제품 1차 목표가 '3소스 통합 분석'이므로 이건 핵심 주장에 직접 걸린다.
//
//   entity를 대상으로 바꾸지 않고 **키를 하나 더 둔다** — 로그 이벤트의 주인공은 여전히
//   공격자이고(화면 묶음·제목이 그렇게 읽힌다), 대상은 상관을 위해 함께 지니는 값이다.
// ⚠ 이 migrate는 **표를 만드는 이 파일 안**에 있어야 한다. db.ts에 두면 표가 생기기 전에
//   ALTER가 돌아 "no such table"로 죽는다(2026-08-01에 실제로 그렇게 한 번 깨뜨렸다).
migrate("analysis-peers-2026-08-01", "ALTER TABLE analysis_events ADD COLUMN peers TEXT");

const upsertStmt = db.prepare(`INSERT INTO analysis_events (id, source, title, entity, severity, priority, detail, signals, peers, aiSummary, ref, at)
  VALUES (@id, @source, @title, @entity, @severity, @priority, @detail, @signals, @peers, @aiSummary, @ref, @at)
  ON CONFLICT(id) DO UPDATE SET source=excluded.source, title=excluded.title, entity=excluded.entity,
    severity=excluded.severity, priority=excluded.priority, detail=excluded.detail, signals=excluded.signals,
    peers=excluded.peers, aiSummary=excluded.aiSummary, ref=excluded.ref, at=excluded.at`);
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

// ── 이벤트 생애주기(2026-07-23): 보관·자동정리 ──────────────────────────────
// 이벤트가 무한정 쌓이면 조회가 느려지고 "지금 위험한 것"이 옛 완료건에 묻힌다. 해결(완료/무시)된
// 이벤트를 처리 후 N일 지나면 정리한다. 미해결(open/ack/inprogress)은 절대 지우지 않는다(놓침 방지).
// 취약점(vuln)은 rebuildVulnEvents가 자산 findings에서 재생성하므로 정리 대상에서 제외한다.
const EVENT_RETENTION_DAYS = Number(process.env.GIJO_EVENT_RETENTION_DAYS ?? 90);
const deleteEventStmt = db.prepare("DELETE FROM analysis_events WHERE id = ?");
const deleteStatusStmt = db.prepare("DELETE FROM analysis_event_status WHERE eventId = ?");

export function pruneResolvedEvents(retentionDays = EVENT_RETENTION_DAYS): number {
  const cutoff = Date.now() - retentionDays * 86400_000;
  // 해결 상태 + 상태변경 시각이 cutoff보다 오래된 것. status 테이블의 at을 처리시각으로 본다.
  const rows = db
    .prepare(
      `SELECT s.eventId AS id FROM analysis_event_status s
       JOIN analysis_events e ON e.id = s.eventId
       WHERE s.status IN ('done','ignored') AND s.at < ? AND e.source != 'vuln'`
    )
    .all(cutoff) as { id: string }[];
  const tx = db.transaction((ids: { id: string }[]) => {
    for (const { id } of ids) {
      deleteEventStmt.run(id);
      deleteStatusStmt.run(id);
    }
  });
  tx(rows);
  if (rows.length) console.log(`[analysis-hub] 생애주기 정리: 해결 후 ${retentionDays}일 지난 이벤트 ${rows.length}건 삭제`);
  return rows.length;
}

let lifecycleTimer: NodeJS.Timeout | null = null;
export function startEventLifecycleScheduler(): void {
  if (lifecycleTimer) return;
  const tick = () => { try { pruneResolvedEvents(); } catch (e) { console.warn(`[analysis-hub] 생애주기 정리 실패: ${e instanceof Error ? e.message : String(e)}`); } };
  lifecycleTimer = setInterval(tick, 24 * 3600_000);
  if (lifecycleTimer.unref) lifecycleTimer.unref();
  console.log(`[analysis-hub] 이벤트 생애주기 스케줄러 시작 (해결 후 ${EVENT_RETENTION_DAYS}일 보관)`);
}
export function stopEventLifecycleScheduler(): void {
  if (lifecycleTimer) { clearInterval(lifecycleTimer); lifecycleTimer = null; }
}

interface EventRow extends Omit<AnalysisEvent, "signals" | "status" | "statusNote"> {
  signals: string;
}
function rowToEvent(r: EventRow): AnalysisEvent {
  const st = getStatus(r.id);
  return { ...r, signals: JSON.parse(r.signals || "[]"), peers: JSON.parse((r as { peers?: string }).peers || "[]"), status: st.status, statusNote: st.note };
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
    peers: JSON.stringify(e.peers ?? []),
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
      // ⚠ 스캔 실패는 **위협 이벤트가 아니다**. 넣으면 상관분석·우선순위가 통째로 오염되고
      //   관제 화면이 잡음으로 덮인다(실측 2026-08-02: 609건 중 608건이 스캔 실패였다).
      //   스캔이 안 된 자산은 커버리지(무엇을 모르는가)에서 따로 챙긴다.
      if (!isRealVulnerability(f)) continue;
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
function detectBruteForce(source: string, lines: string[], threshold: number, 대상: string[] = []): { events: AnalysisEvent[]; matched: number } {
  const fails = new Map<string, number>();
  const accepts = new Set<string>();
  // ★ 대상 호스트는 **그 공격자가 나온 줄에서만** 모은다(2026-08-01 검토 지적).
  //   파일 전체의 top-1 호스트를 모든 이벤트에 붙이면, 여러 장비를 한 파일로 모아 올렸을 때
  //   web01을 노린 공격이 fw01에 귀속된다 — 담당자가 **엉뚱한 장비를 조사**하게 된다.
  //   "틀린 자산에 묶는 것이 못 묶는 것보다 나쁘다"는 우리 계약을 정면으로 어기는 자리였다.
  const 줄대상 = new Map<string, Set<string>>();
  let matched = 0;
  for (const line of lines) {
    const h = syslogHostOf(line);
    for (const re of FAIL_RES) {
      const m = line.match(re);
      if (m) {
        fails.set(m[1], (fails.get(m[1]) ?? 0) + 1);
        if (h) { const set = 줄대상.get(m[1]) ?? new Set<string>(); set.add(h); 줄대상.set(m[1], set); }
        matched++; break;
      }
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
      `${source}에서 ${ip}의 인증 실패 ${count}회${succeeded ? " 후 성공 로그 존재(계정 탈취 가능성)" : ""}. 임계치 ${threshold} 초과.`,
      줄에서찾은것(줄대상.get(ip), 대상)));
  }
  return { events, matched };
}

// 탐지기 ②: 방화벽 차단 — iptables/UFW(SRC=/DPT=)·Cisco(dst .../port) 차단 로그를 소스 IP별로 집계.
// 서로 다른 목적지 포트가 많으면 포트스캔, 차단 건수만 많으면 차단 폭주로 본다.
const DENY_RE = /\b(DENY|DROP|BLOCK|Deny|denied|REJECT|blocked)\b/i;
function extractDeny(line: string): { src: string; dpt?: string; dst?: string } | null {
  if (!DENY_RE.test(line)) return null;
  const src = (line.match(/SRC=(\d+\.\d+\.\d+\.\d+)/i) || line.match(/src\S*?\s?(\d+\.\d+\.\d+\.\d+)/i) || line.match(/(\d+\.\d+\.\d+\.\d+)/))?.[1];
  const dpt = (line.match(/DPT=(\d+)/i) || line.match(/dst \S*?\/(\d{1,5})/i) || line.match(/dpt\D{0,3}(\d{2,5})/i))?.[1];
  // ★ **목적지(우리 자산)**도 뽑는다(2026-08-01). 국내 보안장비는 대개 CEF/LEEF나 key=value로
  //   보내는데(`CEF:0|AhnLab|TrusGuard|…|src=203.0.113.9 dst=10.0.0.5 dpt=445 act=deny`),
  //   그 줄에는 syslog 호스트 이름이 없다 — 즉 syslogHosts()로는 우리 쪽을 못 찾는다.
  //   dst가 상관을 잇는 유일한 끈이 된다. src와 같으면(둘 다 첫 IP를 주운 경우) 버린다.
  const dstRaw = (line.match(/\bDST=(\d+\.\d+\.\d+\.\d+)/i) || line.match(/\bdst\s*=\s*(\d+\.\d+\.\d+\.\d+)/i) ||
    line.match(/\bdst\s+(\d+\.\d+\.\d+\.\d+)/i))?.[1];
  const dst = dstRaw && dstRaw !== src ? dstRaw : undefined;
  return src ? { src, dpt, dst } : null;
}
function detectFirewall(source: string, lines: string[], 대상: string[] = [], portScanPorts = 15, floodThreshold = 30): { events: AnalysisEvent[]; matched: number } {
  const perSrc = new Map<string, { denies: number; ports: Set<string>; dsts: Set<string> }>();
  let matched = 0;
  for (const line of lines) {
    const d = extractDeny(line);
    if (!d) continue;
    matched++;
    const rec = perSrc.get(d.src) ?? { denies: 0, ports: new Set<string>(), dsts: new Set<string>() };
    rec.denies++;
    if (d.dpt) rec.ports.add(d.dpt);
    if (d.dst) rec.dsts.add(d.dst);            // 이 공격이 노린 대상
    const h = syslogHostOf(line);
    if (h) rec.dsts.add(h);                    // 이 줄을 보낸 우리 장비(줄 단위 — 파일 top-1 아님)
    perSrc.set(d.src, rec);
  }
  const events: AnalysisEvent[] = [];
  for (const [ip, rec] of perSrc) {
    if (rec.ports.size >= portScanPorts) {
      events.push(mkLog(source, `log:${source}:scan:${ip}`, `포트 스캔 의심 — ${ip}`, ip, "high", ["포트스캔"],
        `${source}에서 ${ip}가 서로 다른 목적지 포트 ${rec.ports.size}개를 차단당함(차단 ${rec.denies}건) — 스캐닝 정황.`,
        줄에서찾은것(rec.dsts, 대상)));
    } else if (rec.denies >= floodThreshold) {
      events.push(mkLog(source, `log:${source}:flood:${ip}`, `방화벽 차단 폭주 — ${ip}`, ip, "medium", ["반복"],
        `${source}에서 ${ip}가 ${rec.denies}회 차단됨 — 반복 접근 시도.`,
        줄에서찾은것(rec.dsts, 대상)));
    }
  }
  return { events, matched };
}

// 탐지기 ③: 웹 공격 시그니처 — 접근 로그에서 SQLi/XSS/경로순회/명령주입 흔적을 소스 IP별로 집계.
const WEB_PATTERNS = [/union\s+select/i, /<script/i, /\.\.\/\.\.\//, /\/etc\/passwd/i, /\bor\b\s+['"]?1['"]?\s*=\s*['"]?1/i, /%27/i, /%3Cscript/i, /base64_decode/i, /\/bin\/(?:ba)?sh/i, /cmd\.exe/i, /\bexec\s*\(/i];
function detectWebAttack(source: string, lines: string[], 대상: string[] = []): { events: AnalysisEvent[]; matched: number } {
  const perIp = new Map<string, number>();
  const 줄대상 = new Map<string, Set<string>>();
  let matched = 0;
  for (const line of lines) {
    if (!WEB_PATTERNS.some((re) => re.test(line))) continue;
    matched++;
    const ip = (line.match(/^\s*(\d+\.\d+\.\d+\.\d+)/) || line.match(/(\d+\.\d+\.\d+\.\d+)/))?.[1] ?? "unknown";
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const h = syslogHostOf(line);            // 이 줄을 보낸 우리 장비(줄 단위)
    if (h) { const set = 줄대상.get(ip) ?? new Set<string>(); set.add(h); 줄대상.set(ip, set); }
  }
  const events: AnalysisEvent[] = [];
  for (const [ip, hits] of perIp) {
    const severity: Severity = hits >= 5 ? "high" : "medium";
    events.push(mkLog(source, `log:${source}:web:${ip}`, `웹 공격 시그니처 — ${ip}`, ip, severity, ["웹공격"],
      `${source}에서 ${ip}의 요청에 웹 공격 흔적(SQLi/XSS/경로순회/명령주입 등) ${hits}건 탐지.`,
      줄에서찾은것(줄대상.get(ip), 대상)));
  }
  return { events, matched };
}

function mkLog(source: string, id: string, title: string, entity: string, severity: Severity, signals: string[], detail: string, peers: string[] = []): AnalysisEvent {
  // 공격자 자신은 대상이 아니다 — 로그 줄에서 첫 IP를 주워 온 경우를 여기서 걸러 낸다.
  // 공격자 자신은 대상이 아니다 — 로그 줄에서 첫 IP를 주워 온 경우를 여기서 걸러 낸다.
  // 그리고 **우리 자산인 것만** 남긴다(바깥 주소가 "우리 쪽"으로 앉는 것을 막는다).
  const 대상만 = [...new Set(peers)].filter((p) => p && p !== entity && 우리자산인가(p));
  return { id, source: "log", title, entity, peers: 대상만, severity, priority: computePriority(severity, signals), detail, signals, aiSummary: "", ref: source, at: Date.now() };
}

/**
 * syslog 줄에서 **우리 쪽 호스트 이름**을 뽑는다 — `Aug  1 10:00:01 fw01 sshd[…]` 의 fw01.
 *
 * ⚠ 이게 로그를 우리 자산과 잇는 유일한 끈이다. 로그 이벤트의 entity는 공격자 IP라서,
 *   이 값이 없으면 취약점·운영리포트·하드닝 어느 것과도 상관되지 않는다(2026-08-01 결함).
 *   못 뽑으면 **지어내지 않고 빈 값**을 준다 — 틀린 자산에 묶는 것이 못 묶는 것보다 나쁘다.
 */
/**
 * 이 이름이 **우리 자산**인가 — 등록부(assets)와 대조한다.
 *
 * ⚠ dst를 무조건 "우리 자산"으로 믿으면 안 된다(2026-08-01 검토 지적). 내부→외부 차단
 *   로그(방화벽에서 매우 흔하다)에서는 SRC가 우리 PC이고 **DST가 바깥 주소**다. 그대로
 *   실으면 남의 IP가 "우리 쪽 개체" 자리에 앉아, 상관 묶음 이름이 외부 IP가 된다.
 * ⚠ 등록부가 비어 있으면(첫날) **막지 않는다** — 아직 자산을 안 넣은 것뿐인데 상관을
 *   통째로 꺼 버리면 제품이 고장 난 것처럼 보인다. 자산이 있을 때만 대조한다.
 */
function 우리자산인가(이름: string): boolean {
  const 목록 = listAssets();
  if (목록.length === 0) return true; // 등록 전에는 판단하지 않는다
  const 납작 = (x: string) => String(x ?? "").replace(/\s/g, "").toLowerCase();
  const k = 납작(이름);
  return 목록.some((a) => 납작(a.name) === k || 납작(a.id) === k ||
    납작(a.name).includes(k) || k.includes(납작(a.id)));
}

/**
 * 줄에서 찾은 대상이 있으면 **그것만** 쓰고, 없을 때만 파일 전체 보조값을 쓴다.
 *
 * ⚠ 둘을 합치면 안 된다(2026-08-01 검토 후 실측). 여러 장비를 한 파일로 올렸을 때
 *   web01을 노린 공격에 파일 top-1인 fw01이 **덧붙어** 결국 엉뚱한 장비까지 묶였다.
 *   줄에서 알아냈으면 그게 정답이다 — 보조값은 모를 때의 마지막 수단이다.
 */
function 줄에서찾은것(줄것: Set<string> | undefined, 보조: string[]): string[] {
  const a = [...(줄것 ?? [])];
  return a.length ? a : [...보조];
}

/**
 * 로그 **한 줄**에서 우리 쪽 호스트 이름을 뽑는다 — `Aug  1 10:00:01 fw01 sshd[…]` 의 fw01.
 *
 * ⚠ 줄 단위여야 한다(2026-08-01 검토 지적). 파일 전체의 top-1 호스트를 모든 이벤트에
 *   붙이면 여러 장비를 한 파일로 모아 올렸을 때 **엉뚱한 장비에 귀속**된다.
 * ⚠ 4번째 토큰이면 무엇이든 받지는 않는다 — 호스트 필드가 없는 줄에서는 `sshd[1234]:`나
 *   `%ASA-4-106023:`가 "우리 자산"으로 둔갑한다. 호스트 이름 문법(영숫자·점·하이픈·밑줄)만 받고,
 *   콜론·대괄호가 붙은 것은 프로그램 이름이므로 버린다. 못 뽑으면 **지어내지 않는다.**
 */
function syslogHostOf(line: string): string | null {
  const m = line.match(/^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+([^\s:\[]+)\s+\S/);
  const h = m?.[1];
  if (!h) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(h) ? h : null;
}

function syslogHosts(lines: string[]): string[] {
  const 셈 = new Map<string, number>();
  for (const line of lines) {
    const h = syslogHostOf(line);
    if (h) 셈.set(h, (셈.get(h) ?? 0) + 1);
  }
  // ⚠ 이 값은 **줄에서 호스트를 못 뽑은 이벤트의 보조**로만 쓴다(줄 단위가 우선).
  //   여기서 여러 개를 돌려주면 한 파일에 섞인 장비를 전부 묶어 오탐을 만든다.
  return [...셈.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1).map(([h]) => h);
}

// 여러 결정적 탐지기를 돌려 보안 로그를 이벤트로 정규화한다.
export function parseSecurityLog(source: string, content: string, threshold = 10): LogParseResult {
  const lines = content.split(/\r?\n/);
  // 우리 쪽 호스트를 먼저 뽑아 **모든 로그 이벤트에 실어 준다** — 상관의 유일한 끈이다.
  // 이게 없으면 로그 이벤트의 키가 공격자 IP뿐이라 어느 소스와도 안 묶인다(2026-08-01 결함).
  const 대상 = syslogHosts(lines);
  const brute = detectBruteForce(source, lines, threshold, 대상);
  const fw = detectFirewall(source, lines, 대상);
  const web = detectWebAttack(source, lines, 대상);
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

// ── 소스 ④: 보안장비 하드닝 점검 — 취약 항목을 이벤트로 투영 ─────────────────
// 등록된 원격 장비의 하드닝(CCE/CIS) 점검에서 취약(FAIL)·확인필요(WARN) 항목을 AnalysisEvent로
// 올린다. entity=장비명이라 같은 장비의 취약점·로그와 상관분석에 묶이고, 기존 조치 흐름(▶조치)을 탄다.
// id가 안정적(hardening:target:item)이라 재점검해도 상태(처리중/완료)가 살아남는다(고쳐지면 사라짐).
const deleteHardeningByTargetStmt = db.prepare("DELETE FROM analysis_events WHERE source = 'hardening' AND ref = ?");
export function projectHardeningEvents(
  targetId: string,
  targetLabel: string,
  standard: string,
  items: { id: string; title: string; status: string; evidence: string; remediation: string }[]
): number {
  deleteHardeningByTargetStmt.run(targetId); // 이번 점검에서 양호로 바뀐 항목은 자연히 사라진다
  let n = 0;
  for (const it of items) {
    if (it.status !== "FAIL" && it.status !== "WARN") continue;
    const severity: Severity = it.status === "FAIL" ? "medium" : "low";
    const signals = ["보안설정 취약"];
    saveEvent({
      id: `hardening:${targetId}:${it.id}`,
      source: "hardening",
      title: `보안설정 취약: ${it.title}`,
      entity: targetLabel,
      severity,
      priority: computePriority(severity, signals),
      detail: `[${standard.toUpperCase()} ${it.id}] ${it.evidence} → 조치: ${it.remediation}`,
      signals,
      aiSummary: "",
      ref: targetId,
      at: Date.now(),
    });
    n++;
  }
  return n;
}

// ── 상관분석 ───────────────────────────────────────────────────────────────
// 같은 개체(호스트/IP/PC)가 2개 이상 서로 다른 소스에 나타나면 교차 위험으로 묶는다.
// ⚠ 키는 entity **와 peers 둘 다**다 — 로그의 entity는 공격자 IP라 그것만 보면 안 묶인다.
// 예: 백신 재발(product) + 비정상 아웃바운드(log)가 같은 PC → 감염+C2 연계 가능성.
export interface Correlation {
  entity: string;
  sources: AnalysisSource[];
  eventIds: string[];
  note: string;
}
function sourceLabel(s: AnalysisSource): string {
  return s === "vuln" ? "취약점" : s === "log" ? "보안로그" : s === "hardening" ? "하드닝점검" : "운영리포트";
}
export function computeCorrelations(events: AnalysisEvent[]): Correlation[] {
  // ★ entity **와 peers 둘 다**를 키로 본다(2026-08-01 결함 수정).
  //   로그 이벤트의 entity는 공격자 출발지 IP다 — 남의 IP가 우리 자산 이름과 같을 리 없어서,
  //   entity만 보면 **로그는 어느 소스와도 구조적으로 절대 안 묶였다.** peers에 공격 대상
  //   호스트를 실어 두고 여기서 함께 본다. 묶음 이름은 **우리 쪽 개체**로 적는다 —
  //   담당자가 찾는 것은 "누가 때렸나"가 아니라 "우리 어느 장비가 걸렸나"이기 때문이다.
  //   ⚠ 이름의 **대소문자**는 먼저 들어온 이벤트가 이겼다(2026-08-02 검토 지적). 같은 장비가
  //   로그에선 web-01, 스캐너에선 WEB-01로 오면 담당자가 아는 표기와 다르게 뜬다.
  //   등록부에 있는 이름이면 그 표기를 쓴다 — 담당자가 자산 목록에서 보던 그대로여야 찾는다.
  const 등록표기 = (이름: string): string => {
    const 납작 = (x: string) => String(x ?? "").replace(/\s/g, "").toLowerCase();
    const k = 납작(이름);
    const a = listAssets().find((x) => 납작(x.name) === k || 납작(x.id) === k);
    return a ? a.name : 이름;
  };
  const byKey = new Map<string, { evs: AnalysisEvent[]; 이름: string }>();
  const 담기 = (key: string, e: AnalysisEvent, 이름: string) => {
    const k = key.toLowerCase();
    const cur = byKey.get(k) ?? { evs: [], 이름: 등록표기(이름) };
    if (!cur.evs.includes(e)) cur.evs.push(e);
    byKey.set(k, cur);
  };
  for (const e of events) {
    if (e.entity) 담기(e.entity, e, e.entity);
    for (const p of e.peers ?? []) if (p) 담기(p, e, p);
  }
  const out: Correlation[] = [];
  const 본것 = new Set<string>();
  for (const { evs, 이름 } of byKey.values()) {
    const sources = [...new Set(evs.map((e) => e.source))];
    if (sources.length < 2) continue;
    // 같은 이벤트 묶음이 entity·peers 양쪽에서 두 번 잡히지 않게 한다.
    const 지문 = evs.map((e) => e.id).sort().join("|");
    if (본것.has(지문)) continue;
    본것.add(지문);
    out.push({
      entity: 이름,
      sources,
      eventIds: evs.map((e) => e.id),
      note: `${이름}이(가) ${sources.map(sourceLabel).join(" + ")}에 동시 출현 — 교차 위험 가능성. 함께 조사 권고.`,
    });
  }
  return out;
}

// ── 공격 경로·도달성(2026-07-23 ③) ───────────────────────────────────────────
// 경쟁 제품이 "고립된 심각도가 아니라 도달 가능성·공격 경로"로 이동 중이다. GIJO는 이미 확보한
// 3소스 상관(entity 공유)에 거점→인접 자산 이동을 얹어, 관측된 신호로만 정직하게 경로를 구성한다.
// 침투테스트가 아니라 "관측된 사실의 연결"이라는 점을 화면·요약에서 밝힌다.
export interface AttackPathStep { kind: "entry" | "foothold" | "lateral"; entity: string; label: string; source: AnalysisSource; severity: Severity }
export interface AttackPath {
  id: string;
  entity: string; // 거점(취약 자산)
  reachability: "확인됨" | "높음" | "보통"; // 실제 공격 신호+KEV+외부노출로 등급
  reachScore: number; // 0~100
  steps: AttackPathStep[];
  note: string;
}

// IP의 /24 대역 — 인접(측면 이동) 후보 판단용. IP가 아니면 null.
function subnet24(entity: string): string | null {
  const m = (entity ?? "").match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return m ? m[1] : null;
}
const hasSignal = (e: AnalysisEvent, re: RegExp) => e.signals.some((s) => re.test(s)) || re.test(e.detail) || re.test(e.title);

export function computeAttackPaths(events: AnalysisEvent[]): AttackPath[] {
  const active = events.filter((e) => !RESOLVED.includes(e.status ?? "open"));
  // ★ **peers도 함께 담는다**(2026-08-01 검토 지적). 상관분석은 고쳤는데 형제 함수인
  //   여기는 entity만 보고 있었다 — 로그 이벤트의 entity는 공격자 IP라 취약 자산 버킷에
  //   **절대** 안 들어갔고, 그래서 아래 `attacked`가 구조적으로 항상 false였다.
  //   결과: 도달성 「확인됨」이 영원히 안 나오고 경로에서 ①진입(로그) 단계가 늘 빠졌다.
  //   실제 공격 로그가 있는데도 "관측된 공격 신호 없음"처럼 읽힌다 — 차별점 기능이 반쪽이었다.
  //   ⚠ 한 곳을 고치면 **같은 키를 쓰는 형제 함수**를 함께 봐야 한다.
  const byEntity = new Map<string, AnalysisEvent[]>();
  const 담기 = (key: string, e: AnalysisEvent) => {
    if (!key) return;
    const arr = byEntity.get(key) ?? [];
    if (!arr.includes(e)) arr.push(e);
    byEntity.set(key, arr);
  };
  for (const e of active) {
    담기(e.entity, e);
    for (const p of e.peers ?? []) 담기(p, e);
  }
  const paths: AttackPath[] = [];
  for (const [entity, evs] of byEntity) {
    const vulns = evs.filter((e) => e.source === "vuln");
    if (vulns.length === 0) continue; // 취약점 없는 거점은 경로의 표적이 아님
    const logs = evs.filter((e) => e.source === "log");
    const worst = vulns.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
    const kev = vulns.some((v) => hasSignal(v, /kev|실제.?악용/i));
    const external = evs.some((e) => hasSignal(e, /인터넷|외부|external|public/i));
    const attacked = logs.some((l) => hasSignal(l, /브루트포스|포트\s*스캔|웹\s*공격|스캔|scan|brute/i));

    // 도달성 점수: 실제 공격 신호(40) + KEV(30) + 외부노출(20) + 치명(10 cap)
    let reachScore = (attacked ? 40 : 0) + (kev ? 30 : 0) + (external ? 20 : 0) + (worst.severity === "critical" ? 10 : 0);
    reachScore = Math.min(100, reachScore);
    const reachability = attacked ? "확인됨" : reachScore >= 40 ? "높음" : "보통";

    const steps: AttackPathStep[] = [];
    // ① 진입: 공격 신호를 낸 로그(있으면).
    for (const l of logs.slice(0, 1)) steps.push({ kind: "entry", entity, label: l.title, source: "log", severity: l.severity });
    // ② 거점: 취약 자산 자체.
    steps.push({ kind: "foothold", entity, label: `${worst.title}${kev ? " (KEV)" : ""}`, source: "vuln", severity: worst.severity });
    // ③ 측면 이동: 같은 /24의 다른 취약 자산.
    const net = subnet24(entity);
    if (net) {
      for (const [other, oevs] of byEntity) {
        if (other === entity) continue;
        if (subnet24(other) !== net) continue;
        const ov = oevs.find((e) => e.source === "vuln");
        if (!ov) continue;
        steps.push({ kind: "lateral", entity: other, label: `인접 자산 ${other} — ${ov.title}`, source: "vuln", severity: ov.severity });
        if (steps.filter((s) => s.kind === "lateral").length >= 3) break;
      }
    }
    const laterals = steps.filter((s) => s.kind === "lateral").length;
    paths.push({
      id: `path:${entity}`,
      entity,
      reachability,
      reachScore,
      steps,
      note: `${entity}: ${attacked ? "실제 공격 신호 관측 + " : ""}${kev ? "KEV 취약점 + " : ""}${external ? "외부 노출 + " : ""}치명도 ${worst.severity}` +
        `${laterals ? ` → 같은 대역 인접 자산 ${laterals}개로 측면 이동 가능` : ""}. (관측 신호 기반 추정, 침투테스트 아님)`,
    });
  }
  // 도달성 높은 순.
  paths.sort((a, b) => b.reachScore - a.reachScore);
  return paths;
}

/** 화면·대화창에 한 번에 보여 주는 경로 수. 넘으면 **잘랐다고 밝힌다.** */
const 보여줄경로 = 6;

export function formatAttackPaths(): string {
  const paths = computeAttackPaths(listAnalysisEvents());
  if (paths.length === 0) return "🧭 공격 경로 분석 — 관측된 신호로 구성 가능한 공격 경로가 없습니다 ✓";
  // ⚠ 머리말은 총 건수를 말하고 아래는 상위 몇 건만 보여 준다. **잘랐다는 말을 빼면**
  //   담당자는 57개를 다 봤다고 생각한다(2026-08-03 실측: 57건이라 쓰고 6건만 보여 줬다).
  const 자름 = paths.length > 보여줄경로;
  const L: string[] = [
    `🧭 공격 경로 분석 — 도달성 순 ${paths.length}건 (관측 신호 기반 추정)` +
      (자름 ? ` · 아래는 위험한 순 ${보여줄경로}건입니다` : ""),
  ];
  for (const p of paths.slice(0, 보여줄경로)) {
    L.push(`\n[도달성 ${p.reachability}·${p.reachScore}점] ${p.entity}`);
    L.push("  " + p.steps.map((s) => `${s.kind === "entry" ? "진입" : s.kind === "foothold" ? "거점" : "인접"}:${s.label}`).join(" → "));
  }
  // ▸ 다음 걸음 — 경로를 보여 주고 끝내면 담당자에게 '그래서 뭘 하지'가 남는다.
  //   경로는 **거점을 끊으면 통째로 무너진다** — 그 지점을 짚어 준다.
  L.push(
    "",
    '▸ 이어서 — 경로는 거점을 막으면 끊어집니다. "' +
      (paths[0]?.entity ?? "가장 위험한 자산") +
      ' 취약점 담당자 배정해줘"라고 말하면 바로 시작합니다.'
  );
  return L.join("\n");
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
  const bySource: Record<AnalysisSource, number> = { vuln: 0, log: 0, product: 0, hardening: 0 };
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
  const srcKo = e.source === "vuln" ? "취약점 스캐너" : e.source === "log" ? "보안 로그" : e.source === "hardening" ? "보안장비 하드닝 점검" : "보안제품 운영 리포트";
  return [
    "당신은 1인 보안담당자를 돕는 보안 분석가입니다. 아래 보안 이벤트를 한국어로 간결히 분석하세요.",
    PLAIN_LANGUAGE_RULE,
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
  const summary = (await chat({ agentId: "analysis", message: buildAnalysisPrompt(e, corr), trusted: true })).trim();
  saveEvent({ ...e, aiSummary: summary });
  return summary;
}

export function resetAnalysisHubForTests(): void {
  db.exec("DELETE FROM analysis_events");
  db.exec("DELETE FROM analysis_event_status");
}

// ── 소스 ⑤: 인바운드 SMTP — 다른 보안장비가 보낸 알림 메일을 이벤트로 투영 ─────────
// 메일 본문을 기존 로그 탐지기(브루트포스·방화벽·웹공격)에 그대로 통과시킨다 — 많은 장비가
// 알림 메일 본문에 로그 원문을 그대로 넣기 때문에 재사용이 잘 맞는다. 알려진 패턴이 하나도
// 안 걸리면(장비마다 포맷이 달라 흔함) 정보 손실 없이 "메일 수신" 일반 이벤트를 하나 만든다.
export function ingestMailAlert(from: string, subject: string, text: string): number {
  const source = `메일:${from}`;
  const r = parseSecurityLog(source, text || "");
  r.events.forEach(saveEvent);
  if (r.events.length === 0) {
    saveEvent({
      id: `mail:${from}:${crypto.createHash("md5").update(`${subject}:${text}`).digest("hex").slice(0, 10)}`,
      source: "log",
      title: subject || "(제목 없음)",
      entity: from || "발신자 불명",
      severity: "info",
      priority: computePriority("info", ["메일수신"]),
      detail: (text || "").slice(0, 500),
      signals: ["메일수신"],
      aiSummary: "",
      ref: source,
      at: Date.now(),
    });
    return 1;
  }
  return r.events.length;
}

// 드롭존 자동 판별: 파일명·내용으로 보안 로그 vs 운영 리포트를 가른다(결정적 규칙).
// 취약점 스캔(.nessus/스캔 CSV)은 취약점 업로드가 담당하고 rebuildVulnEvents로 자동 반영되므로 여기서 제외.
/**
 * 파일 하나를 분석 이벤트로 인입한다 — **드롭존 라우트와 대화창 첨부가 같은 길을 쓰게** 한다.
 *
 * ★ 2026-08-01 실측으로 드러난 구멍: 이 파이프라인은 멀쩡한데 **담당자가 넣을 길이 없었다.**
 *   드롭존을 없애면서(파일 인입을 한 곳으로 모으는 정리) 화면 호출처가 전부 사라졌고,
 *   preload의 analysisIngest는 부르는 곳이 0이 됐다. 제품 1차 목표가 3소스 통합 분석인데
 *   그중 **보안로그·운영리포트 두 소스가 인입 불가** 상태였다.
 *   ⚠ 길을 둘로 만들지 않는다 — 라우트도 대화창 첨부도 이 함수를 부른다(두 길은 반드시 어긋난다).
 */
export function ingestAnalysisFile(filename: string, content: string): { kind: "log" | "report"; created: number; events: AnalysisEvent[] } {
  const kind = detectIngestKind(filename, content);
  const label = filename || (kind === "log" ? "로그" : "보안제품");
  const r = kind === "log" ? parseSecurityLog(label, content) : parseProductReport(label, content);
  r.events.forEach(saveEvent);
  return { kind, created: r.events.length, events: r.events };
}

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
  // 공격 경로·도달성(③) — 관측 신호로 구성한 진입→거점→인접 이동 경로.
  app.get("/api/analysis-hub/attack-paths", authMiddleware, (_req, res) => {
    res.json({ paths: computeAttackPaths(listAnalysisEvents()) });
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
      const r = ingestAnalysisFile(filename, content);
      res.json({ routedTo: r.kind, created: r.created, events: r.events });
    })
  );
}
