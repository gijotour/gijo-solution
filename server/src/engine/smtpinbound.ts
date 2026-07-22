// engine/smtpinbound.ts — 인바운드 SMTP(알림 집수). 다른 보안장비·시스템이 SMTP로 보내는
// 알림 메일을 받아 통합 분석 허브(analysishub) 이벤트로 자동 인입한다.
//
// 설계 근거(외부 조사, 2026-07-22): `smtp-server`(nodemailer 계열)는 완전한 MTA(Postfix 등)가
// 아니라 "커스텀 SMTP 리스너를 앱에 붙이는" 용도의 표준 라이브러리 — 이 제품처럼 "수신 전용
// 알림 집수"에 정확히 맞는 선택이다(전달/릴레이 없음, 그래서 오픈릴레이 위험이 구조적으로 없음).
// 보안 관행(조사 근거): TLS/STARTTLS는 유효 인증서가 있을 때만 노출, 발신 IP 허용목록으로
// 남용 방지(레이트리밋 격), 인증은 폐쇄망 내부용이라 기본 생략 가능하되 옵션으로 열어둔다.
//
// 파싱은 mailparser로 표준 MIME을 해석해 제목·발신자·본문만 뽑는다. 본문은 analysishub의
// 기존 로그 탐지기(parseSecurityLog)에 그대로 태워 재사용한다 — 많은 장비가 알림 메일 본문에
// 로그 원문을 그대로 넣기 때문에 잘 맞는다.

import type { Express } from "express";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db, migrate } from "../db";
import { ingestMailAlert } from "./analysishub";

migrate(
  "smtp_inbound_config",
  `CREATE TABLE IF NOT EXISTS smtp_inbound_config (
    id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, port INTEGER NOT NULL DEFAULT 2525,
    allowedIps TEXT NOT NULL DEFAULT '', bannerName TEXT NOT NULL DEFAULT 'GIJO AS'
  )`
);

const CONFIG_ID = "default";
export interface SmtpInboundConfig {
  enabled: boolean;
  port: number;
  allowedIps: string[]; // 비어 있으면 전체 허용(폐쇄망 내부용 기본값) — 지정하면 그 IP만.
  bannerName: string;
}
interface ConfigRow {
  id: string;
  enabled: number;
  port: number;
  allowedIps: string;
  bannerName: string;
}
const getStmt = db.prepare("SELECT * FROM smtp_inbound_config WHERE id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO smtp_inbound_config (id, enabled, port, allowedIps, bannerName)
  VALUES (@id, @enabled, @port, @allowedIps, @bannerName)
  ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, port=excluded.port,
    allowedIps=excluded.allowedIps, bannerName=excluded.bannerName
`);

function rowToConfig(r: ConfigRow): SmtpInboundConfig {
  return {
    enabled: r.enabled === 1,
    port: r.port,
    allowedIps: r.allowedIps ? r.allowedIps.split(",").map((s) => s.trim()).filter(Boolean) : [],
    bannerName: r.bannerName,
  };
}
export function getSmtpInboundConfig(): SmtpInboundConfig {
  const row = getStmt.get(CONFIG_ID) as ConfigRow | undefined;
  return row ? rowToConfig(row) : { enabled: false, port: 2525, allowedIps: [], bannerName: "GIJO AS" };
}
function saveSmtpInboundConfig(patch: Partial<SmtpInboundConfig>): SmtpInboundConfig {
  const cur = getSmtpInboundConfig();
  // patch에 값이 undefined인 키가 있어도 spread는 그 키를 덮어쓴다(명시적 undefined 할당) — 부분
  // 갱신 의도와 달리 기존 값을 지워버려 실측(2026-07-22)으로 NOT NULL 제약 위반이 재현됐다.
  // undefined 키는 골라내고 실제 지정된 값만 반영한다.
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next: SmtpInboundConfig = { ...cur, ...defined };
  upsertStmt.run({
    id: CONFIG_ID,
    enabled: next.enabled ? 1 : 0,
    port: next.port,
    allowedIps: next.allowedIps.join(","),
    bannerName: next.bannerName,
  });
  return next;
}

// ── 서버 수명주기 ────────────────────────────────────────────────────────────
let server: SMTPServer | null = null;
let lastError: string | null = null;
let lastReceivedAt: number | null = null;
let receivedCount = 0;

function ipAllowed(remoteAddress: string, allowedIps: string[]): boolean {
  if (allowedIps.length === 0) return true; // 미지정 = 폐쇄망 내부 전체 허용(기본값)
  const norm = remoteAddress.replace(/^::ffff:/, "");
  return allowedIps.includes(norm) || allowedIps.includes(remoteAddress);
}

export function stopSmtpInbound(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    s.close(() => resolve());
  });
}

export async function startSmtpInbound(): Promise<{ ok: boolean; error?: string }> {
  await stopSmtpInbound();
  const cfg = getSmtpInboundConfig();
  if (!cfg.enabled) return { ok: false, error: "비활성 상태입니다" };

  const s = new SMTPServer({
    banner: cfg.bannerName,
    authOptional: true, // 폐쇄망 내부 알림 집수용 — 인증 없이도 받는다(허용 IP로 남용 방지)
    disabledCommands: ["AUTH"], // 인증 자체를 요구하지 않음(내부망 신뢰 경계)
    onConnect(session, cb) {
      const ip = session.remoteAddress || "";
      if (!ipAllowed(ip, cfg.allowedIps)) {
        return cb(new Error("허용되지 않은 발신 IP입니다"));
      }
      cb();
    },
    onData(stream, session, cb) {
      simpleParser(stream)
        .then((mail) => {
          const from = mail.from?.text || session.remoteAddress || "발신자 불명";
          const subject = mail.subject || "";
          const text = mail.text || "";
          ingestMailAlert(from, subject, text);
          receivedCount++;
          lastReceivedAt = Date.now();
          cb();
        })
        .catch((err) => cb(err instanceof Error ? err : new Error(String(err))));
    },
  });
  s.on("error", (err) => {
    lastError = err.message;
    console.error(`[smtp-inbound] 서버 오류: ${err.message}`);
  });

  return new Promise((resolve) => {
    s.listen(cfg.port, () => {
      server = s;
      lastError = null;
      console.log(`[smtp-inbound] 인바운드 SMTP 수신 시작 — port ${cfg.port}${cfg.allowedIps.length ? `, 허용 IP ${cfg.allowedIps.length}개` : "(전체 허용)"}`);
      resolve({ ok: true });
    });
    s.once("error", (err) => resolve({ ok: false, error: err.message }));
  });
}

// 부팅 시 1회 — 설정이 활성화돼 있으면 자동 기동(index.ts에서 호출).
export async function bootSmtpInboundIfEnabled(): Promise<void> {
  const cfg = getSmtpInboundConfig();
  if (cfg.enabled) {
    const r = await startSmtpInbound();
    if (!r.ok) console.error(`[smtp-inbound] 부팅 자동 시작 실패: ${r.error}`);
  }
}

export function registerSmtpInboundRoutes(app: Express): void {
  app.get("/api/smtp-inbound/config", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(getSmtpInboundConfig());
  });
  app.post(
    "/api/smtp-inbound/config",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const b = req.body as Partial<SmtpInboundConfig> & { allowedIpsText?: string };
      const allowedIps =
        typeof b.allowedIpsText === "string"
          ? b.allowedIpsText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
          : b.allowedIps;
      const cfg = saveSmtpInboundConfig({
        enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
        port: typeof b.port === "number" ? b.port : undefined,
        allowedIps,
        bannerName: typeof b.bannerName === "string" ? b.bannerName : undefined,
      });
      // 활성화 상태가 바뀌면 즉시 반영 — 서버 재시작 없이 켜고 끌 수 있어야 실사용 가능하다.
      if (cfg.enabled) {
        const r = await startSmtpInbound();
        if (!r.ok) return res.status(400).json({ error: r.error, config: cfg });
      } else {
        await stopSmtpInbound();
      }
      res.json(cfg);
    })
  );
  app.get("/api/smtp-inbound/status", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ running: server !== null, lastError, lastReceivedAt, receivedCount });
  });
}

export function resetSmtpInboundForTests(): void {
  db.exec("DELETE FROM smtp_inbound_config");
  lastError = null;
  lastReceivedAt = null;
  receivedCount = 0;
}
