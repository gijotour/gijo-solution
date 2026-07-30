// engine/siem.ts — SIEM 아웃바운드 커넥터. GIJO AS가 남기는 보안 이벤트(감사로그·분석 이벤트)를
// 고객사 SIEM(Splunk·QRadar·ArcSight·Elastic 등)으로 전달한다. (계획서 중-7)
//
// 왜: 온프렘 보안 제품이 기업에 들어갈 때 "우리 SIEM으로 로그 보내지나?"는 거의 필수 질문이다.
//
// ■ 확장 배경 — 가장 큰 구멍은 "전송 실패를 알 수 없다"였다 (2026-07-31)
//   예전에는 UDP syslog뿐이었다. UDP는 **받았는지 확인하지 않는다** — SIEM이 하루 종일 죽어
//   있어도 우리 쪽엔 아무 표시가 없다. 감사 이벤트가 통째로 사라져도 아무도 모른다는 뜻이고,
//   그건 "SIEM 연동됨"이라고 말할 수 없는 상태다. 그래서 이번에:
//     · 전송 수단을 **TCP·TLS·Splunk HEC**로 넓혔다(전달 확인이 되는 길)
//     · 실패·유실을 **세어서 드러낸다** — 조용한 실패가 이 제품의 최대 적이다
//     · 보내지 못한 것은 **큐에 담아 재시도**한다(무한히 쌓지 않고 상한을 둔다)
//     · JSON 포맷은 **ECS 필드명**을 쓴다 — 우리 마음대로 지으면 고객사가 매핑을 새로 짜야 한다
//
// ■ 정직성
//   기본 OFF. admin이 켜야 전송한다. 전송 실패가 본 작업(감사·분석)을 막지 않는다.
//   ⚠ UDP는 "보냄"이 곧 "도착"이 아니다 — 상태에 그대로 적는다(deliveryConfirmed=false).

import type { Express } from "express";
import * as dgram from "dgram";
import * as net from "net";
import * as tls from "tls";
import * as os from "os";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { db } from "../db";
import { onAudit } from "./audit";

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const CONFIG_KEY = "siemConfig";

export type SiemFormat = "rfc5424" | "cef" | "json";
/** 전송 수단 — udp만 전달 확인이 안 된다. */
export type SiemTransport = "udp" | "tcp" | "tls" | "hec";

export interface SiemConfig {
  enabled: boolean;
  host: string;
  port: number;
  format: SiemFormat;
  transport: SiemTransport;
  minSeverity: "info" | "high" | "critical"; // 이 수준 이상만 전송(잡음 억제)
  /** Splunk HEC 토큰(transport=hec일 때). 화면에는 끝 4자만 보여준다. */
  hecToken?: string;
  hecPath?: string;
  /** ⚠ 끄면 중간자 공격에 노출된다. 사설 인증서 환경을 위해서만 둔다. */
  tlsRejectUnauthorized?: boolean;
}

const DEFAULT_CONFIG: SiemConfig = {
  enabled: false,
  host: "",
  port: 514,
  format: "rfc5424",
  transport: "udp",
  minSeverity: "info",
  hecPath: "/services/collector/event",
  tlsRejectUnauthorized: true,
};

export function getSiemConfig(): SiemConfig {
  try {
    const raw = (getStateStmt.get(CONFIG_KEY) as { value: string } | undefined)?.value;
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveSiemConfig(patch: Partial<SiemConfig>): SiemConfig {
  const cur = getSiemConfig();
  const next: SiemConfig = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v;
  }
  // 포트 범위 보정 — 오타로 99999를 넣으면 전송이 조용히 실패한다(기존 시험이 지키던 계약).
  if (!Number.isFinite(next.port)) next.port = DEFAULT_CONFIG.port;
  next.port = Math.min(65535, Math.max(1, Math.round(next.port)));
  setStateStmt.run(CONFIG_KEY, JSON.stringify(next));
  // 설정이 바뀌면 열려 있던 연결을 끊는다 — 옛 주소로 계속 보내면 안 된다.
  closeStream();
  return next;
}

const HOSTNAME = os.hostname();
const SEV_RANK = { info: 0, high: 1, critical: 2 } as const;

export interface SiemEvent {
  category: string; // "audit" | "analysis"
  severity: "info" | "high" | "critical";
  action: string;
  actor?: string;
  target?: string;
  detail?: string;
}

function priFor(sev: SiemEvent["severity"]): number {
  // facility 13(log audit) × 8 + severity — critical=2, high=4(warning), info=6
  return 13 * 8 + (sev === "critical" ? 2 : sev === "high" ? 4 : 6);
}

function formatRfc5424(e: SiemEvent): string {
  const ts = new Date().toISOString();
  const msg =
    `[${e.category}] ${e.action}` +
    (e.target ? ` target=${e.target}` : "") +
    (e.actor ? ` actor=${e.actor}` : "") +
    (e.detail ? ` | ${e.detail}` : "");
  return `<${priFor(e.severity)}>1 ${ts} ${HOSTNAME} GIJO-AS - ${e.category} - ${msg}`;
}
function cefEscape(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function formatCef(e: SiemEvent): string {
  const sev = e.severity === "critical" ? 9 : e.severity === "high" ? 6 : 3;
  const ext = [
    `cat=${e.category}`,
    e.actor ? `suser=${cefEscape(e.actor)}` : "",
    e.target ? `dhost=${cefEscape(e.target)}` : "",
    e.detail ? `msg=${cefEscape(e.detail)}` : "",
  ].filter(Boolean).join(" ");
  return `<${priFor(e.severity)}>CEF:0|GIJO|GIJO AS|1.0|${cefEscape(e.category)}|${cefEscape(e.action)}|${sev}|${ext}`;
}
/**
 * JSON — Elastic Common Schema(ECS) 필드명. Elastic·Splunk 양쪽이 그대로 먹는다.
 * 필드명을 우리 마음대로 지으면 고객사에서 매핑을 새로 짜야 한다.
 */
function formatJson(e: SiemEvent): string {
  return JSON.stringify({
    "@timestamp": new Date().toISOString(),
    "event.kind": "event",
    "event.category": e.category,
    "event.action": e.action,
    "event.severity": SEV_RANK[e.severity],
    "log.level": e.severity,
    "host.name": HOSTNAME,
    "observer.vendor": "GIJO",
    "observer.product": "GIJO AS",
    ...(e.actor ? { "user.name": e.actor } : {}),
    ...(e.target ? { "event.target": e.target } : {}),
    ...(e.detail ? { message: e.detail } : {}),
  });
}

export function formatEvent(e: SiemEvent, cfg: SiemConfig): string {
  if (cfg.format === "cef") return formatCef(e);
  if (cfg.format === "json") return formatJson(e);
  return formatRfc5424(e);
}

// ── 전달 상태 ───────────────────────────────────────────────────────────────
// **이번 확장의 핵심.** 보냈는지 못 보냈는지를 아무도 모르는 것이 가장 큰 문제였다.
export interface SiemStats {
  sent: number;
  failed: number;
  dropped: number; // 큐가 가득 차 버린 수 — 유실이다. 숨기지 않는다.
  queued: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  /** UDP는 "보냄"이 "도착"을 뜻하지 않는다 — 화면이 이 값을 그대로 보여준다. */
  deliveryConfirmed: boolean;
}
const stats = {
  sent: 0, failed: 0, dropped: 0,
  lastSuccessAt: null as number | null,
  lastFailureAt: null as number | null,
  lastError: null as string | null,
};

export function getSiemStats(): SiemStats {
  return { ...stats, queued: queue.length, deliveryConfirmed: getSiemConfig().transport !== "udp" };
}
export function resetSiemStatsForTests(): void {
  stats.sent = 0; stats.failed = 0; stats.dropped = 0;
  stats.lastSuccessAt = null; stats.lastFailureAt = null; stats.lastError = null;
  queue.length = 0;
  closeStream();
}

// ── 전송 큐 ─────────────────────────────────────────────────────────────────
// SIEM이 잠깐 죽어도 이벤트를 버리지 않는다. 다만 **무한히 쌓지 않는다** —
// 메모리가 터지면 제품 전체가 죽고, 그건 SIEM 전달 실패보다 훨씬 나쁘다.
const QUEUE_LIMIT = Number(process.env.GIJO_SIEM_QUEUE_LIMIT ?? 1000);
const queue: string[] = [];
let draining = false;

function enqueue(line: string): void {
  if (queue.length >= QUEUE_LIMIT) {
    queue.shift(); // 오래된 것부터 버린다(최신 사건이 더 중요하다)
    stats.dropped++;
  }
  queue.push(line);
}

// ── 전송 수단별 구현 ────────────────────────────────────────────────────────
let stream: net.Socket | tls.TLSSocket | null = null;
let connecting: Promise<net.Socket | tls.TLSSocket | null> | null = null;

function closeStream(): void {
  try { stream?.destroy(); } catch { /* 무시 */ }
  stream = null;
  connecting = null;
}

/** TCP·TLS는 연결을 재사용한다 — 이벤트마다 새로 붙으면 SIEM 쪽 세션이 폭증한다. */
function ensureStream(cfg: SiemConfig): Promise<net.Socket | tls.TLSSocket | null> {
  if (stream && !stream.destroyed) return Promise.resolve(stream);
  if (connecting) return connecting;
  connecting = new Promise((resolve) => {
    const fail = (err: Error) => {
      stats.lastError = err.message.slice(0, 200);
      closeStream();
      resolve(null);
    };
    try {
      const sock =
        cfg.transport === "tls"
          ? tls.connect({ host: cfg.host, port: cfg.port, rejectUnauthorized: cfg.tlsRejectUnauthorized !== false, timeout: 8000 })
          : net.connect({ host: cfg.host, port: cfg.port, timeout: 8000 });
      const ready = cfg.transport === "tls" ? "secureConnect" : "connect";
      sock.once(ready as "connect", () => {
        sock.setTimeout(0);
        stream = sock;
        connecting = null;
        resolve(sock);
      });
      sock.once("error", fail);
      sock.once("timeout", () => fail(new Error("연결 시간 초과")));
      sock.once("close", () => { if (stream === sock) closeStream(); });
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }
  });
  return connecting;
}

function sendUdp(line: string, cfg: SiemConfig): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    sock.send(Buffer.from(line, "utf8"), cfg.port, cfg.host, (err) => {
      sock.close();
      // ⚠ err가 없어도 **도착했다는 뜻이 아니다** — OS에 넘겼다는 뜻일 뿐이다.
      if (err) stats.lastError = err.message.slice(0, 200);
      resolve(!err);
    });
  });
}

async function sendStream(line: string, cfg: SiemConfig): Promise<boolean> {
  const sock = await ensureStream(cfg);
  if (!sock) return false;
  return new Promise((resolve) => {
    sock.write(line + "\n", (err) => {
      if (err) {
        stats.lastError = err.message.slice(0, 200);
        closeStream();
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/** Splunk HEC — HTTP(S) + 토큰. 200이 오면 실제로 받았다는 뜻이다(가장 확실한 길). */
async function sendHec(line: string, cfg: SiemConfig): Promise<boolean> {
  const scheme = cfg.port === 80 || cfg.port === 8000 ? "http" : "https";
  const url = `${scheme}://${cfg.host}:${cfg.port}${cfg.hecPath || "/services/collector/event"}`;
  const body = JSON.stringify({
    time: Math.floor(Date.now() / 1000),
    host: HOSTNAME,
    source: "gijo-as",
    sourcetype: cfg.format === "json" ? "_json" : "syslog",
    event: cfg.format === "json" ? JSON.parse(line) : line,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Splunk ${cfg.hecToken ?? ""}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      stats.lastError = `HEC ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`;
      return false;
    }
    return true;
  } catch (e) {
    stats.lastError = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    return false;
  }
}

async function deliver(line: string, cfg: SiemConfig): Promise<boolean> {
  if (cfg.transport === "udp") return sendUdp(line, cfg);
  if (cfg.transport === "hec") return sendHec(line, cfg);
  return sendStream(line, cfg);
}

/** 큐를 비운다. 실패하면 그 줄을 앞에 그대로 두고 멈춘다 — 순서를 지키고 무한 재시도를 피한다. */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const cfg = getSiemConfig();
    if (!cfg.enabled || !cfg.host) return;
    let budget = 200; // 한 번에 너무 오래 붙들지 않는다
    while (queue.length && budget-- > 0) {
      const ok = await deliver(queue[0], cfg);
      if (!ok) {
        stats.failed++;
        stats.lastFailureAt = Date.now();
        return; // 큐 맨 앞에 남는다 — 다음 기회에 다시 시도
      }
      queue.shift();
      stats.sent++;
      stats.lastSuccessAt = Date.now();
    }
  } finally {
    draining = false;
  }
}

/** 이벤트 1건 전송(큐 경유). 반환은 "큐에 담겼는가"다 — 실제 전달 여부는 stats로 본다. */
export function sendToSiem(e: SiemEvent, cfg = getSiemConfig()): Promise<boolean> {
  if (!cfg.enabled || !cfg.host) return Promise.resolve(false);
  if (SEV_RANK[e.severity] < SEV_RANK[cfg.minSeverity]) return Promise.resolve(false);
  enqueue(formatEvent(e, cfg));
  void drain();
  return Promise.resolve(true);
}

/** 설정 화면의 "연결 시험" — 큐를 거치지 않고 즉시 보내 결과를 그대로 알려준다. */
export async function testSiem(cfg = getSiemConfig()): Promise<{ ok: boolean; error?: string; confirmed: boolean; target: string }> {
  const target = `${cfg.host}:${cfg.port} (${cfg.transport})`;
  if (!cfg.host) return { ok: false, error: "SIEM 주소가 비어 있습니다", confirmed: false, target };
  const ok = await deliver(
    formatEvent(
      { category: "audit", severity: "info", action: "GIJO AS 연결 시험", actor: "GIJO AS", detail: "이 메시지가 SIEM에 보이면 연동 정상" },
      cfg
    ),
    cfg
  );
  return ok ? { ok: true, confirmed: cfg.transport !== "udp", target } : { ok: false, error: stats.lastError ?? "전송 실패", confirmed: cfg.transport !== "udp", target };
}

// 감사로그 → SIEM 자동 전달. 인증·차단·설정변경 등 보안상 의미있는 이벤트가 흐른다.
let hooked = false;
let retryTimer: NodeJS.Timeout | null = null;
export function startSiemForwarding(): void {
  if (hooked) return;
  hooked = true;
  onAudit((entry) => {
    const cfg = getSiemConfig();
    if (!cfg.enabled) return;
    // 차단(blocked)도 보안상 의미 있는 사건이다 — info로 묻히면 SIEM 룰이 못 잡는다.
    const severity = entry.result === "error" || entry.result === "blocked" ? "high" : "info";
    void sendToSiem(
      {
        category: "audit",
        severity,
        action: entry.action,
        actor: entry.actor ?? undefined,
        target: entry.target ?? undefined,
        detail: entry.detail ?? undefined,
      },
      cfg
    );
  });
  // 밀린 큐를 주기적으로 다시 민다 — SIEM이 되살아났는데 아무도 안 밀면 영영 안 나간다.
  if (!retryTimer) {
    retryTimer = setInterval(() => { void drain(); }, 30_000);
    retryTimer.unref?.();
  }
}
export function stopSiemForwarding(): void {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  closeStream();
}

export function registerSiemRoutes(app: Express): void {
  app.get("/api/siem/config", authMiddleware, adminMiddleware, (_req, res) => {
    const cfg = getSiemConfig();
    // 토큰은 끝 4자만 — 화면에 다시 꺼내 보여주지 않는다(HuggingFace 토큰과 같은 규칙).
    res.json({
      ...cfg,
      hecToken: cfg.hecToken ? `••••${cfg.hecToken.slice(-4)}` : "",
      hecTokenSet: Boolean(cfg.hecToken),
      stats: getSiemStats(),
    });
  });

  app.post("/api/siem/config", authMiddleware, adminMiddleware, (req, res) => {
    const b = (req.body ?? {}) as Partial<SiemConfig>;
    if (b.enabled && !String(b.host ?? getSiemConfig().host).trim()) {
      res.status(400).json({ error: "SIEM을 켜려면 수집 서버 주소(host)가 필요합니다" });
      return;
    }
    if (b.transport === "hec" && !(b.hecToken || getSiemConfig().hecToken)) {
      res.status(400).json({ error: "Splunk HEC를 쓰려면 토큰이 필요합니다" });
      return;
    }
    const patch: Partial<SiemConfig> = {};
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (typeof b.host === "string") patch.host = b.host.trim();
    if (b.port !== undefined && Number.isFinite(Number(b.port))) patch.port = Number(b.port);
    if (b.format && ["rfc5424", "cef", "json"].includes(b.format)) patch.format = b.format;
    if (b.transport && ["udp", "tcp", "tls", "hec"].includes(b.transport)) patch.transport = b.transport;
    if (b.minSeverity && ["info", "high", "critical"].includes(b.minSeverity)) patch.minSeverity = b.minSeverity;
    if (typeof b.hecPath === "string") patch.hecPath = b.hecPath.trim() || DEFAULT_CONFIG.hecPath;
    if (typeof b.tlsRejectUnauthorized === "boolean") patch.tlsRejectUnauthorized = b.tlsRejectUnauthorized;
    // ⚠ 토큰은 **새 값이 올 때만** 바꾼다 — 화면이 마스킹된 값(••••)을 되돌려보내 지워버리는 사고를 막는다.
    if (typeof b.hecToken === "string" && b.hecToken && !b.hecToken.startsWith("••••")) patch.hecToken = b.hecToken;
    const saved = saveSiemConfig(patch);
    res.json({ ...saved, hecToken: "", hecTokenSet: Boolean(saved.hecToken) });
  });

  // 연결 시험 — 현재 설정으로 샘플 이벤트를 즉시 보낸다.
  app.post("/api/siem/test", authMiddleware, adminMiddleware, async (_req, res) => {
    const cfg = getSiemConfig();
    if (!cfg.host) {
      res.status(400).json({ error: "먼저 SIEM 주소를 저장하세요" });
      return;
    }
    res.json(await testSiem({ ...cfg, enabled: true, minSeverity: "info" }));
  });

  app.get("/api/siem/stats", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(getSiemStats());
  });
}
