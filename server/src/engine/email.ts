// engine/email.ts — 내부 리포트 이메일 발송 (6.4.1절)
// SMTP 접속 정보는 설정 화면에서 입력해 SQLite에 저장한다(비밀번호는 cryptopack.ts로 암호화) —
// cti.ts의 벤더 API 키 저장과 동일한 패턴. 고객사마다 SMTP 서버가 다르므로 하드코딩하지 않는다.

import type { Express } from "express";
import nodemailer from "nodemailer";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import { encryptString, decryptString, getEncryptionKey } from "./cryptopack";

const CONFIG_ID = "default";

export interface SmtpConfigInput {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromAddress: string;
}

// 클라이언트에는 비밀번호를 절대 내려주지 않는다 — 설정 여부만 노출.
export interface SmtpConfigPublic {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  hasPassword: boolean;
  fromAddress: string;
}

interface SmtpConfigRow {
  id: string;
  host: string;
  port: number;
  secure: number;
  user: string | null;
  encryptedPassword: string | null;
  fromAddress: string;
}

export interface SendReportEmailArgs {
  to: string[];
  subject: string;
  attachmentPath: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO smtp_config (id, host, port, secure, user, encryptedPassword, fromAddress)
  VALUES (@id, @host, @port, @secure, @user, @encryptedPassword, @fromAddress)
  ON CONFLICT(id) DO UPDATE SET
    host = excluded.host, port = excluded.port, secure = excluded.secure, user = excluded.user,
    encryptedPassword = excluded.encryptedPassword, fromAddress = excluded.fromAddress
`);
const getStmt = db.prepare("SELECT * FROM smtp_config WHERE id = ?");

function toPublic(row: SmtpConfigRow): SmtpConfigPublic {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure === 1,
    user: row.user,
    hasPassword: row.encryptedPassword !== null,
    fromAddress: row.fromAddress,
  };
}

export function getSmtpConfig(): SmtpConfigPublic | undefined {
  const row = getStmt.get(CONFIG_ID) as SmtpConfigRow | undefined;
  return row ? toPublic(row) : undefined;
}

export function saveSmtpConfig(input: SmtpConfigInput): SmtpConfigPublic {
  const existing = getStmt.get(CONFIG_ID) as SmtpConfigRow | undefined;
  // 비밀번호를 비워서 저장하면 기존 값을 유지한다(매번 재입력하지 않아도 되도록) — 명시적으로
  // 지우고 싶으면 password: "" 대신 다른 필드 재저장 없이 그대로 두면 된다.
  const encryptedPassword = input.password
    ? encryptString(input.password, getEncryptionKey())
    : (existing?.encryptedPassword ?? null);

  upsertStmt.run({
    id: CONFIG_ID,
    host: input.host,
    port: input.port,
    secure: input.secure ? 1 : 0,
    user: input.user ?? null,
    encryptedPassword,
    fromAddress: input.fromAddress,
  });
  return toPublic(getStmt.get(CONFIG_ID) as SmtpConfigRow);
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetSmtpConfigForTests(): void {
  db.exec("DELETE FROM smtp_config");
}

function buildTransport() {
  const row = getStmt.get(CONFIG_ID) as SmtpConfigRow | undefined;
  if (!row) {
    throw new Error("SMTP 설정이 없습니다 — 설정 화면에서 사내 SMTP 서버 정보를 먼저 등록하세요.");
  }
  const password = row.encryptedPassword ? decryptString(row.encryptedPassword, getEncryptionKey()) : undefined;
  return {
    transport: nodemailer.createTransport({
      host: row.host,
      port: row.port,
      secure: row.secure === 1,
      auth: row.user ? { user: row.user, pass: password } : undefined,
    }),
    fromAddress: row.fromAddress,
  };
}

export async function sendReportEmail(args: SendReportEmailArgs): Promise<void> {
  const { transport, fromAddress } = buildTransport();
  await transport.sendMail({
    from: fromAddress,
    to: args.to.join(", "),
    subject: args.subject,
    text: `첨부된 리포트를 확인해주세요: ${args.attachmentPath}`,
    attachments: [{ path: args.attachmentPath }],
  });
}

// 첨부 없는 범용 알림 메일(예: 점검 지연 알림). 저장된 SMTP 설정을 그대로 재사용한다.
export interface SendMailArgs {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(args: SendMailArgs): Promise<void> {
  const { transport, fromAddress } = buildTransport();
  await transport.sendMail({
    from: fromAddress,
    to: args.to.join(", "),
    subject: args.subject,
    text: args.text,
    ...(args.html ? { html: args.html } : {}),
  });
}

export function registerEmailRoutes(app: Express): void {
  app.get("/api/email/config", authMiddleware, (_req, res) => {
    res.json(getSmtpConfig() ?? null);
  });
  app.post("/api/email/config", authMiddleware, (req, res) => {
    res.json(saveSmtpConfig(req.body));
  });
  app.post(
    "/api/email/sendReport",
    authMiddleware,
    asyncRoute(async (req, res) => {
      await sendReportEmail(req.body);
      res.json({ ok: true });
    })
  );
}
