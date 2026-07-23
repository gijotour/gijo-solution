// engine/siem.ts — SIEM 아웃바운드 커넥터. GIJO AS가 남기는 보안 이벤트(감사로그·분석 이벤트)를
// 고객사 SIEM(Splunk·QRadar·ArcSight 등)으로 syslog(UDP)로 전달한다.
//
// 왜: 온프렘 보안 제품이 기업에 들어갈 때 "우리 SIEM으로 로그 보내지나?"는 거의 필수 질문이다.
// 지금은 GIJO가 이벤트를 자체 저장만 했다 — 고객 SIEM 파이프라인에 실리도록 전달 경로를 연다.
//
// 정직성: 기본 OFF. admin이 설정에서 SIEM 주소·포맷을 켜야 전송한다. 전송 실패가 본 작업(감사·분석)을
// 막지 않는다(감사와 같은 방어). RFC 5424 syslog와 CEF(ArcSight/Splunk 친화) 두 포맷 지원.

import type { Express } from "express";
import * as dgram from "dgram";
import * as os from "os";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { db } from "../db";
import { onAudit } from "./audit";

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const CONFIG_KEY = "siemConfig";

export type SiemFormat = "rfc5424" | "cef";
export interface SiemConfig {
  enabled: boolean;
  host: string;
  port: number;
  format: SiemFormat;
  minSeverity: "info" | "high" | "critical"; // 이 수준 이상만 전송(잡음 억제)
}
const DEFAULT_CONFIG: SiemConfig = { enabled: false, host: "", port: 514, format: "rfc5424", minSeverity: "info" };

export function getSiemConfig(): SiemConfig {
  try {
    const raw = (getStateStmt.get(CONFIG_KEY) as { value: string } | undefined)?.value;
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
export function saveSiemConfig(patch: Partial<SiemConfig>): SiemConfig {
  const next: SiemConfig = { ...getSiemConfig(), ...patch };
  next.port = Math.max(1, Math.min(65535, Number(next.port) || 514));
  setStateStmt.run(CONFIG_KEY, JSON.stringify(next));
  return next;
}

const HOSTNAME = os.hostname();
const SEV_RANK: Record<string, number> = { info: 0, high: 1, critical: 2 };

// syslog PRI = facility*8 + severity. facility 13(log audit), severity: crit=2·err=3·info=6.
function priFor(severity: string): number {
  const sev = severity === "critical" ? 2 : severity === "high" ? 3 : 6;
  return 13 * 8 + sev;
}

export interface SiemEvent {
  category: string; // "audit" | "analysis"
  severity: "info" | "high" | "critical";
  action: string;
  actor?: string;
  target?: string;
  detail?: string;
}

function formatRfc5424(e: SiemEvent): string {
  const ts = new Date().toISOString();
  // <PRI>1 TIMESTAMP HOST APP PROCID MSGID - MSG
  const msg = `[${e.category}] ${e.action}` + (e.target ? ` target=${e.target}` : "") + (e.actor ? ` actor=${e.actor}` : "") + (e.detail ? ` | ${e.detail}` : "");
  return `<${priFor(e.severity)}>1 ${ts} ${HOSTNAME} GIJO-AS - ${e.category} - ${msg}`;
}
function cefEscape(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function formatCef(e: SiemEvent): string {
  // CEF:0|Vendor|Product|Version|SignatureID|Name|Severity|Extension
  const sev = e.severity === "critical" ? 9 : e.severity === "high" ? 6 : 3;
  const ext = [`cat=${e.category}`, e.actor ? `suser=${cefEscape(e.actor)}` : "", e.target ? `dhost=${cefEscape(e.target)}` : "", e.detail ? `msg=${cefEscape(e.detail)}` : ""].filter(Boolean).join(" ");
  return `<${priFor(e.severity)}>CEF:0|GIJO|GIJO AS|1.0|${cefEscape(e.category)}|${cefEscape(e.action)}|${sev}|${ext}`;
}

// 실제 전송(UDP). 반환은 성공 여부 — 호출부는 실패를 삼킨다.
export function sendToSiem(e: SiemEvent, cfg = getSiemConfig()): Promise<boolean> {
  return new Promise((resolve) => {
    if (!cfg.enabled || !cfg.host) return resolve(false);
    if (SEV_RANK[e.severity] < SEV_RANK[cfg.minSeverity]) return resolve(false);
    const line = cfg.format === "cef" ? formatCef(e) : formatRfc5424(e);
    const sock = dgram.createSocket("udp4");
    const buf = Buffer.from(line, "utf8");
    sock.send(buf, cfg.port, cfg.host, (err) => {
      sock.close();
      resolve(!err);
    });
  });
}

// 감사로그 → SIEM 자동 전달. 인증·차단·설정변경 등 보안상 의미있는 이벤트가 흐른다.
let hooked = false;
export function startSiemForwarding(): void {
  if (hooked) return;
  hooked = true;
  onAudit((entry) => {
    const cfg = getSiemConfig();
    if (!cfg.enabled) return;
    const severity = entry.result === "error" ? "high" : "info";
    void sendToSiem({
      category: "audit",
      severity,
      action: entry.action,
      actor: entry.actor ?? undefined,
      target: entry.target ?? undefined,
      detail: entry.detail ?? undefined,
    }, cfg).catch(() => {});
  });
}

export function registerSiemRoutes(app: Express): void {
  app.get("/api/siem/config", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(getSiemConfig());
  });
  app.post("/api/siem/config", authMiddleware, adminMiddleware, (req, res) => {
    const b = req.body ?? {};
    if (b.enabled && !String(b.host ?? getSiemConfig().host).trim()) {
      res.status(400).json({ error: "SIEM을 켜려면 수집 서버 주소(host)가 필요합니다" });
      return;
    }
    const fmt = b.format === "cef" ? "cef" : b.format === "rfc5424" ? "rfc5424" : undefined;
    res.json(saveSiemConfig({
      enabled: b.enabled === undefined ? undefined : !!b.enabled,
      host: b.host !== undefined ? String(b.host).trim() : undefined,
      port: b.port !== undefined ? Number(b.port) : undefined,
      format: fmt,
      minSeverity: ["info", "high", "critical"].includes(b.minSeverity) ? b.minSeverity : undefined,
    } as Partial<SiemConfig>));
  });
  // 테스트 전송 — 현재 설정으로 샘플 이벤트를 보낸다.
  app.post("/api/siem/test", authMiddleware, adminMiddleware, async (_req, res) => {
    const cfg = getSiemConfig();
    if (!cfg.host) { res.status(400).json({ error: "먼저 SIEM 주소를 저장하세요" }); return; }
    const ok = await sendToSiem({ category: "audit", severity: "info", action: "SIEM 연결 테스트", actor: "GIJO AS", detail: "이 메시지가 SIEM에 보이면 연동 정상" }, { ...cfg, enabled: true, minSeverity: "info" });
    res.json({ sent: ok, format: cfg.format, target: `${cfg.host}:${cfg.port}` });
  });
}
