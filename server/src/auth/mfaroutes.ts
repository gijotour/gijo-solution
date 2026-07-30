// auth/mfaroutes.ts — 2차 인증 등록·해제·관리자 정책 API.
// 로그인 2단계 자체는 auth.ts(/api/auth/login/mfa)에 있다 — 인증 전 경로라서.
//
// 설계 원칙
//  · **끄기·복구코드 재발급은 비밀번호를 다시 받는다** — 자리를 비운 화면에서 남이 몰래
//    2차 인증을 꺼 버리면 방어선이 그 자리에서 사라진다.
//  · 관리자 해제는 감사 로그에 남긴다 — "누가 누구의 2차 인증을 풀었나"는 사후 추적의 핵심.
//  · 상태 응답에 **서버 시각**을 함께 내린다. 이 방식은 시계로 숫자를 만들기 때문에 시각이
//    어긋나면 아무도 못 들어온다 — 화면이 바로 비교할 수 있어야 원인을 짚는다.

import type { Express, Request, Response } from "express";
import * as bcrypt from "bcryptjs";
import { authMiddleware, adminMiddleware, upgradeEnrollSession } from "./auth";
import { findUserById, GijoUser } from "./users";
import { recordAudit } from "../engine/audit";
import {
  mfaStatus, startEnrollment, confirmEnrollment, disableMfa, issueRecoveryCodes,
  isMfaEnabled, mfaRequiredForAdmin, setMfaRequiredForAdmin, accountsBlockedByPolicy,
  mfaStatusForAllUsers,
} from "./mfa";
import { TOTP_STEP_SEC } from "./totp";

function actor(req: Request): GijoUser | undefined {
  return (req as Request & { user?: GijoUser }).user;
}

// QR 그리기는 **편의 기능**이다 — 키를 직접 넣어도 등록은 된다. 그래서 모듈 최상단에서
// import하지 않는다: 그렇게 하면 qrcode 하나가 빠져도(설치본 패키징 사고 등) 서버 전체가
// 기동에 실패한다. 보안 제품이 부가 기능 때문에 통째로 멈추는 것이 가장 나쁜 실패 모드다.
async function renderQrSvg(uri: string): Promise<string | null> {
  try {
    const QRCode = await import("qrcode");
    return await QRCode.toString(uri, { type: "svg", margin: 1, width: 176 });
  } catch {
    return null; // 화면은 "키를 직접 넣으세요"로 안내한다
  }
}

// 비밀번호 재확인 — 맞으면 true. 틀린 사유는 호출자가 401로 알린다.
function passwordOk(user: GijoUser, password: unknown): boolean {
  return typeof password === "string" && password.length > 0 && bcrypt.compareSync(password, user.passwordHash);
}

export function registerMfaRoutes(app: Express): void {
  // 내 2차 인증 상태 + 서버 시각(시계 어긋남 진단용)
  app.get("/api/auth/mfa/status", authMiddleware, (req, res) => {
    const u = actor(req);
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    res.json({
      ...mfaStatus(u.id),
      serverTime: Date.now(),
      stepSeconds: TOTP_STEP_SEC,
      requiredForAdmin: mfaRequiredForAdmin(),
    });
  });

  // 등록 시작 — 비밀키·QR·직접 입력용 키를 만든다. QR은 이 서버에서 그려 내려보낸다(외부 요청 없음).
  app.post("/api/auth/mfa/start", authMiddleware, async (req, res) => {
    const u = actor(req);
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    const started = startEnrollment(u.id, u.username);
    if ("error" in started) {
      res.status(409).json({ error: "already_enabled", message: "이미 켜져 있습니다. 다시 등록하려면 먼저 끄세요." });
      return;
    }
    // QR을 못 그려도 아래 키를 직접 넣어 등록할 수 있다 — 등록을 막지 않는다.
    res.json({ secretDisplay: started.secretDisplay, uri: started.uri, qrSvg: await renderQrSvg(started.uri) });
  });

  // 등록 확인 — 앱의 6자리가 맞으면 켜고 복구 코드 10개를 **이때 한 번만** 보여준다.
  app.post("/api/auth/mfa/confirm", authMiddleware, (req, res) => {
    const u = actor(req);
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    const { code } = req.body as { code?: string };
    const r = confirmEnrollment(u.id, String(code ?? ""));
    if (!r.ok) {
      const message =
        r.reason === "미시작" ? "등록을 먼저 시작하세요."
        : r.reason === "이미켜짐" ? "이미 켜져 있습니다."
        : r.reason === "복구불가" ? "서버 암호화 키를 열 수 없습니다. 관리자에게 문의하세요."
        : r.reason === "형식" ? "6자리 숫자를 넣으세요."
        : r.reason === "재사용" ? "이미 쓴 숫자입니다. 다음 숫자가 나오면 넣으세요."
        : "숫자가 맞지 않습니다. 휴대폰과 서버의 시각이 어긋났는지 확인하세요.";
      res.status(400).json({ error: "confirm_failed", reason: r.reason, message });
      return;
    }
    recordAudit({ kind: "auth", actor: u.displayName, action: "2차 인증 등록", target: u.username, result: "ok" });
    // 등록 전용 제한 세션이었다면 여기서 정상 세션으로 올려 준다 — 비밀번호(이 세션)와
    // 인증앱(방금 확인)이 모두 증명된 순간이라 승격 근거가 있다. 다시 로그인하게 하지 않는다.
    // 판단 근거는 **토큰**에서만 온다(authMiddleware가 찍는다) — 헤더로 주장하게 두면 위조된다.
    const wasEnrollOnly = (req as Request & { enrollOnly?: boolean }).enrollOnly === true;
    res.json({
      ok: true,
      recoveryCodes: r.recoveryCodes,
      ...(wasEnrollOnly ? upgradeEnrollSession(u.id, req.ip ?? undefined) : {}),
    });
  });

  // 끄기 — 비밀번호 재확인 필수.
  app.post("/api/auth/mfa/disable", authMiddleware, (req, res) => {
    const u = actor(req);
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!passwordOk(u, (req.body as { password?: unknown }).password)) {
      res.status(401).json({ error: "password_required", message: "비밀번호가 맞지 않습니다." });
      return;
    }
    // 관리자 필수 정책이 켜져 있으면 스스로 끌 수 없다 — 정책을 우회하는 구멍이 된다.
    if (u.role === "admin" && mfaRequiredForAdmin()) {
      res.status(403).json({
        error: "policy_forbids",
        message: "관리자 계정 2차 인증 필수 정책이 켜져 있어 끌 수 없습니다. 정책을 먼저 끄세요.",
      });
      return;
    }
    const existed = disableMfa(u.id);
    recordAudit({ kind: "auth", actor: u.displayName, action: "2차 인증 끄기", target: u.username, result: existed ? "ok" : "error" });
    res.json({ ok: true });
  });

  // 복구 코드 재발급 — 비밀번호 재확인 필수. 기존 코드는 전부 무효가 된다.
  app.post("/api/auth/mfa/recovery", authMiddleware, (req, res) => {
    const u = actor(req);
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!passwordOk(u, (req.body as { password?: unknown }).password)) {
      res.status(401).json({ error: "password_required", message: "비밀번호가 맞지 않습니다." });
      return;
    }
    if (!isMfaEnabled(u.id)) {
      res.status(409).json({ error: "not_enabled", message: "2차 인증이 켜져 있지 않습니다." });
      return;
    }
    const codes = issueRecoveryCodes(u.id);
    recordAudit({ kind: "auth", actor: u.displayName, action: "복구 코드 재발급", target: u.username, result: "ok" });
    res.json({ ok: true, recoveryCodes: codes });
  });

  // ── 관리자 ────────────────────────────────────────────────────────────────
  // 계정별 2차 인증 상태 — 기기를 잃은 담당자를 찾는다.
  app.get("/api/users/mfa", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(mfaStatusForAllUsers());
  });

  // 관리자 해제 — 담당자가 휴대폰을 잃고 복구 코드도 없을 때의 마지막 길.
  app.post("/api/users/:id/mfa/reset", authMiddleware, adminMiddleware, (req, res) => {
    const me = actor(req);
    const target = findUserById(req.params.id);
    if (!target) { res.status(404).json({ error: "not_found", message: "그 계정이 없습니다." }); return; }
    if (!isMfaEnabled(target.id)) {
      res.status(409).json({ error: "not_enabled", message: "그 계정은 2차 인증이 켜져 있지 않습니다." });
      return;
    }
    disableMfa(target.id);
    recordAudit({
      kind: "auth", actor: me?.displayName ?? "?",
      action: "2차 인증 관리자 해제", target: target.username,
      detail: "담당자가 다시 등록할 때까지 그 계정은 비밀번호만으로 로그인한다", result: "ok",
    });
    res.json({ ok: true });
  });

  // 정책 조회 — 켜면 막히는 계정을 **함께** 내린다. 화면이 켜기 전에 그대로 보여준다.
  app.get("/api/auth/mfa/policy", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ requireForAdmin: mfaRequiredForAdmin(), blocked: accountsBlockedByPolicy() });
  });

  // 정책 변경. ⚠ 켜면 사람이 없는 자동화(게시·QA·평가 게이트)도 6자리를 넣을 수 없어 막힌다.
  app.post("/api/auth/mfa/policy", authMiddleware, adminMiddleware, (req: Request, res: Response) => {
    const me = actor(req);
    const on = (req.body as { on?: unknown }).on === true;
    const blocked = on ? accountsBlockedByPolicy() : [];
    setMfaRequiredForAdmin(on);
    recordAudit({
      kind: "config", actor: me?.displayName ?? "?",
      action: on ? "관리자 2차 인증 필수 켜기" : "관리자 2차 인증 필수 끄기",
      detail: on && blocked.length ? `등록 안 된 admin ${blocked.length}개는 등록 전까지 다른 기능을 쓸 수 없다: ${blocked.map((b) => b.username).join(", ")}` : null,
      result: "ok",
    });
    res.json({ ok: true, requireForAdmin: on, blocked });
  });
}
