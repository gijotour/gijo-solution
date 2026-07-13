// engine/email.ts — 내부 리포트 이메일 발송 (6.4.1절)
// 사내 SMTP 서버 접속 정보는 환경변수로 주입한다 (고객사마다 다르므로 하드코딩하지 않음).

import type { Express } from "express";
import nodemailer from "nodemailer";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

export interface SendReportEmailArgs {
  to: string[];
  subject: string;
  attachmentPath: string;
}

function buildTransport() {
  return nodemailer.createTransport({
    host: process.env.GIJO_SMTP_HOST,
    port: Number(process.env.GIJO_SMTP_PORT ?? 587),
    secure: process.env.GIJO_SMTP_SECURE === "true",
    auth: process.env.GIJO_SMTP_USER
      ? { user: process.env.GIJO_SMTP_USER, pass: process.env.GIJO_SMTP_PASS }
      : undefined,
  });
}

export async function sendReportEmail(args: SendReportEmailArgs): Promise<void> {
  if (!process.env.GIJO_SMTP_HOST) {
    throw new Error("GIJO_SMTP_HOST가 설정되지 않았습니다 — 사내 SMTP 서버 정보를 환경변수로 지정하세요.");
  }
  const transport = buildTransport();
  await transport.sendMail({
    from: process.env.GIJO_SMTP_FROM ?? "gijo-as@localhost",
    to: args.to.join(", "),
    subject: args.subject,
    text: `첨부된 리포트를 확인해주세요: ${args.attachmentPath}`,
    attachments: [{ path: args.attachmentPath }],
  });
}

export function registerEmailRoutes(app: Express): void {
  app.post(
    "/api/email/sendReport",
    authMiddleware,
    asyncRoute(async (req, res) => {
      await sendReportEmail(req.body);
      res.json({ ok: true });
    })
  );
}
