// auth/auth.ts — 보안담당자별 로그인 · JWT access token + refresh token 발급/검증
// (9.5절 "JWT 만료/갱신 정책" 구현) access token은 짧게 만료되는 서명된 JWT(무상태 검증),
// refresh token은 서버 측 저장소에 남아 회전(rotate)되며 로그아웃 시 즉시 폐기 가능하다.
// 주의: access token 자체는 JWT의 설계 의도대로 무상태이므로, 로그아웃해도 자연 만료 전까지는
// 그 access token 하나만으로는 유효하다 — 즉시 전면 폐기가 필요하면 만료 시간을 더 짧게 잡을 것.

import type { Request, Response, NextFunction, Express } from "express";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcryptjs";
import { findUserByUsername, findUserById, GijoUser, MIN_PASSWORD_LEN } from "./users";
import { recordAudit } from "../engine/audit";
import { isMfaEnabled, verifyLoginCode, consumeRecoveryCode, mfaRequiredForAdmin } from "./mfa";

// 프로덕션에서 기본 개발용 시크릿이 그대로 쓰이면(토큰 위조 가능) 서버가 아예 뜨지 않게 막는다 —
// "설정을 깜빡했다"가 "취약한 상태로 조용히 운영 중이었다"보다 훨씬 안전한 실패 모드다.
if (process.env.NODE_ENV === "production" && !process.env.GIJO_JWT_SECRET) {
  throw new Error(
    "GIJO_JWT_SECRET이 설정되지 않았습니다. 프로덕션(NODE_ENV=production)에서는 기본 개발용 시크릿을 쓸 수 없습니다."
  );
}
const JWT_SECRET = process.env.GIJO_JWT_SECRET ?? "gijo-as-dev-secret-change-me";
const ACCESS_TOKEN_TTL = process.env.GIJO_ACCESS_TOKEN_TTL ?? "15m";
const REFRESH_TOKEN_TTL_MS = Number(process.env.GIJO_REFRESH_TOKEN_TTL_MS ?? 7 * 24 * 60 * 60 * 1000); // 7일
// 유휴 타임아웃 — 마지막 활동 후 이 시간이 지나면 세션을 만료로 본다(0이면 비활성). 기본 30분.
// 창 닫기 로그아웃과 별개의 방어선: 종료 신호를 못 받아 유령 세션이 남아도 유휴로 자동 소멸한다.
const IDLE_TIMEOUT_MS = Number(process.env.GIJO_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000);
export function isIdleExpired(lastSeenAt: number): boolean {
  return IDLE_TIMEOUT_MS > 0 && Date.now() - lastSeenAt > IDLE_TIMEOUT_MS;
}
export function idleTimeoutMs(): number { return IDLE_TIMEOUT_MS; }

interface RefreshRecord {
  userId: string;
  expiresAt: number;
  // 접속 현황 표시(팀 사무실 창 "외부 콘솔 접속자")용 메타데이터. 회전(rotation) 시 이어받는다.
  ip?: string;
  since: number; // 최초 로그인 시각
  lastSeenAt: number; // 마지막 인증 요청 시각 — presence 판정 기준
  // 2차 인증 등록만 허용하는 제한 세션인가(아래 ENROLL_ONLY_PATHS 참고).
  // ⚠ 회전 때 반드시 이어받아야 한다 — 안 그러면 refresh 한 번으로 제한이 풀린다.
  enroll?: boolean;
}

const refreshTokens = new Map<string, RefreshRecord>();
// 중복로그인 방지: 계정당 "현재" 세션은 하나뿐이라는 불변식을 이 역인덱스로 유지한다.
// 로그인 시 이미 유효한 세션이 있으면 차단(강제 로그인 확인 필요) — 9.5절 정책의 연장.
// 강제 로그인 시엔 옛 refresh token을 즉시 지우지 않고 이 맵만 새 토큰으로 갈아 끼운다:
// 그래야 옛 기기가 다음 refresh를 시도할 때 "다른 곳에서 로그인되어 세션이 종료됐다"는
// 구체적인 사유를 줄 수 있다(그 시점에 refreshTokens에서 지운다 — 지연 정리).
const activeSessionByUser = new Map<string, string>();

// ── 로그인 브루트포스 방어 ──────────────────────────────────────────────────
// 보안 제품의 로그인 자체가 무차별 대입에 뚫리면 치명적이다. (IP + 아이디)별 실패를 집계하고
// 임계 초과 시 잠근다. 성공하면 즉시 초기화. 폐쇄망 단일 서버라 인메모리로 충분(재시작 시 리셋).
const LOGIN_MAX_FAILS = Number(process.env.GIJO_LOGIN_MAX_FAILS ?? 10);
const LOGIN_WINDOW_MS = Number(process.env.GIJO_LOGIN_WINDOW_MS ?? 15 * 60 * 1000);
interface LoginAttempt {
  fails: number;
  firstAt: number;
  lockedUntil: number;
}
const loginAttempts = new Map<string, LoginAttempt>();
function loginKey(req: Request, username: string): string {
  const ip = req.ip || req.socket?.remoteAddress || "?";
  return `${ip}:${username}`;
}
// 잠겨 있으면 남은 잠금 시간(ms), 아니면 0.
function loginLockRemaining(key: string): number {
  const a = loginAttempts.get(key);
  if (!a) return 0;
  if (a.lockedUntil > Date.now()) return a.lockedUntil - Date.now();
  if (Date.now() - a.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  return 0;
}
// 실패를 한 번 세고 **남은 횟수**를 돌려준다(F8-09) — 0이면 방금 잠긴 것이다.
// ⚠ 돌려주게 바꾼 이유: 담당자는 열 번째에 갑자기 잠기는 걸 몰랐다. 몇 번 남았는지는
//   여기서만 알 수 있고(임계는 env로 바뀐다), 화면이 제 숫자를 따로 갖게 두지 않는다.
function recordLoginFail(key: string): number {
  const now = Date.now();
  const a = loginAttempts.get(key) ?? { fails: 0, firstAt: now, lockedUntil: 0 };
  if (now - a.firstAt > LOGIN_WINDOW_MS) {
    a.fails = 0;
    a.firstAt = now;
  }
  a.fails += 1;
  if (a.fails >= LOGIN_MAX_FAILS) a.lockedUntil = now + LOGIN_WINDOW_MS;
  loginAttempts.set(key, a);
  return Math.max(0, LOGIN_MAX_FAILS - a.fails);
}

// 잠기면 몇 분인가 — 화면이 「15분」을 제 손으로 적지 않게 **서버가 숫자를 만든다**(F8-09).
//   위 429가 만드는 것은 「남은 잠금 시간」이고 이건 「잠금 길이」다 — 다른 값이라 따로 둔다.
function 잠금길이분(): number {
  return Math.ceil(LOGIN_WINDOW_MS / 60000);
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function signAccessToken(userId: string, enroll = false): string {
  return jwt.sign(
    enroll ? { sub: userId, enroll: true } : { sub: userId },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL } as jwt.SignOptions
  );
}

function issueRefreshToken(userId: string, meta?: { ip?: string; since?: number; enroll?: boolean }): string {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  refreshTokens.set(token, {
    userId,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
    ip: meta?.ip,
    since: meta?.since ?? now, // 회전 시 최초 로그인 시각을 이어받는다
    lastSeenAt: now,
    enroll: meta?.enroll,
  });
  activeSessionByUser.set(userId, token);
  return token;
}

function issueTokenPair(userId: string, meta?: { ip?: string; since?: number; enroll?: boolean }): TokenPair {
  return { accessToken: signAccessToken(userId, meta?.enroll), refreshToken: issueRefreshToken(userId, meta) };
}

// ── 2차 인증 중간 토큰 ───────────────────────────────────────────────────────
// 비밀번호는 맞았지만 아직 6자리를 못 받은 상태. 이 토큰으로는 **아무 API도 못 부른다**
// (authMiddleware가 purpose를 보고 거부한다) — 오직 /api/auth/login/mfa 한 곳에서만 쓰인다.
// 수명을 5분으로 짧게 둔다: 비밀번호만 안 사람이 코드를 구할 시간을 주지 않는다.
const MFA_TOKEN_TTL = process.env.GIJO_MFA_TOKEN_TTL ?? "5m";
function signMfaToken(userId: string, force: boolean): string {
  return jwt.sign({ sub: userId, purpose: "mfa", force }, JWT_SECRET, {
    expiresIn: MFA_TOKEN_TTL,
  } as jwt.SignOptions);
}

// 등록 전용(enroll) 세션이 부를 수 있는 경로. 관리자 필수 정책을 켰는데 아직 2차 인증을
// 등록하지 않은 계정은 "등록만 할 수 있는" 세션을 받는다 — 로그인 자체를 막으면 등록할
// 방법이 없어지는 순환(로그인해야 등록, 등록해야 로그인)에 빠지기 때문이다.
const ENROLL_ONLY_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/mfa/status",
  "/api/auth/mfa/start",
  "/api/auth/mfa/confirm",
]);

// 2차 인증 등록을 막 끝낸 제한 세션에 정상 세션을 내준다 — 그 순간 비밀번호(이 세션)와
// 인증앱(방금 확인)이라는 두 요소가 모두 증명됐으므로 승격 근거가 있다.
export function upgradeEnrollSession(userId: string, ip?: string): TokenPair {
  return issueTokenPair(userId, { ip });
}

function revokeRefreshToken(token: string): void {
  const record = refreshTokens.get(token);
  refreshTokens.delete(token);
  if (record && activeSessionByUser.get(record.userId) === token) {
    activeSessionByUser.delete(record.userId);
  }
}

// 관리자 원격 종료 — 특정 사용자의 활성 세션을 강제로 끊는다(유령 세션·의심 세션 정리·계정 잠금).
export function revokeUserSession(userId: string): boolean {
  const token = activeSessionByUser.get(userId);
  if (!token) return false;
  revokeRefreshToken(token);
  return true;
}

// 이 userId로 아직 만료되지 않은 세션이 살아 있는지 — 로그인 중복 여부 판단 기준.
function findActiveSession(userId: string): string | undefined {
  const token = activeSessionByUser.get(userId);
  if (!token) return undefined;
  const record = refreshTokens.get(token);
  // 만료(TTL) 또는 유휴 초과면 세션 없음으로 본다 — 중복로그인 판정에서 유령 세션이 막지 않게.
  if (!record || record.expiresAt < Date.now() || isIdleExpired(record.lastSeenAt)) {
    if (token) revokeRefreshToken(token);
    return undefined;
  }
  return token;
}

// 접속 중 세션 목록 — 팀 사무실 창이 "외부 콘솔 접속자"로 그린다. 로그인한 사용자 누구나 조회 가능
// (협업 도구의 presence와 같은 성격 — 토큰·IP 원본 같은 민감값은 내리지 않되 IP는 표시용으로 포함).
export interface ActiveSessionInfo {
  userId: string;
  username: string;
  displayName: string;
  role: GijoUser["role"];
  ip: string | null;
  since: number;
  lastSeenAt: number;
}
export function listActiveSessions(): ActiveSessionInfo[] {
  const out: ActiveSessionInfo[] = [];
  for (const [userId, token] of activeSessionByUser) {
    const record = refreshTokens.get(token);
    if (!record || record.expiresAt < Date.now() || isIdleExpired(record.lastSeenAt)) continue;
    const user = findUserById(userId);
    if (!user) continue;
    out.push({
      userId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      ip: record.ip ?? null,
      since: record.since,
      lastSeenAt: record.lastSeenAt,
    });
  }
  return out.sort((a, b) => a.since - b.since);
}

// 테스트 전용: refreshTokens·로그인 시도 카운터는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetAuthForTests(): void {
  refreshTokens.clear();
  activeSessionByUser.clear();
  loginAttempts.clear();
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization; // "Bearer <accessToken>"
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    // 2차 인증 중간 토큰은 로그인을 끝내지 못한 상태다 — 어떤 API도 이걸로 부를 수 없다.
    if (payload.purpose === "mfa") {
      res.status(401).json({ error: "mfa_incomplete", message: "2차 인증이 끝나지 않았습니다." });
      return;
    }
    const user = typeof payload.sub === "string" ? findUserById(payload.sub) : undefined;
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // 등록 전용 제한 세션 — 2차 인증 등록 관련 경로만 통과시킨다.
    if (payload.enroll === true && !ENROLL_ONLY_PATHS.has(req.path)) {
      res.status(403).json({
        error: "mfa_enrollment_required",
        message: "관리자 계정은 2차 인증을 등록해야 사용할 수 있습니다. 설정 > 계정에서 등록하세요.",
      });
      return;
    }
    (req as Request & { user?: GijoUser }).user = user;
    // 등록 전용 세션인지 라우트가 알 수 있게 표시한다 — 등록을 끝내면 정상 세션으로 올려주기 위해.
    // (클라이언트가 헤더로 주장하게 두면 위조 가능하니 토큰에서만 읽는다.)
    (req as Request & { enrollOnly?: boolean }).enrollOnly = payload.enroll === true;
    // presence 갱신 — 이 사용자의 현재 세션이 살아 있으면 마지막 활동 시각을 찍는다(Map 조회 2회, 저비용).
    const sessionToken = activeSessionByUser.get(user.id);
    if (sessionToken) {
      const record = refreshTokens.get(sessionToken);
      if (record) record.lastSeenAt = Date.now();
    }
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

// authMiddleware 다음에 붙여 쓴다 — 계정 관리(users.ts)처럼 admin만 허용해야 하는 라우트용.
// 역할 계층은 admin/security_officer 이분법이 전부다(다음단계 가이드 1.3절 — RBAC은 범위 밖).
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user?: GijoUser }).user;
  if (user?.role !== "admin") {
    res.status(403).json({ error: "관리자만 접근할 수 있습니다" });
    return;
  }
  next();
}

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", (req, res) => {
    const { username, password, force } = req.body as { username: string; password: string; force?: boolean };
    const key = loginKey(req, username ?? "");
    const lockMs = loginLockRemaining(key);
    if (lockMs > 0) {
      res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${Math.ceil(lockMs / 60000)}분 후 다시 시도하세요.` });
      return;
    }
    const user = findUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      const 남은 = recordLoginFail(key);
      // ⚠ 영문 날것을 담당자에게 보이지 않는다 — error는 기계가 읽는 코드, message가 사람 말이다.
      // ⚠ 남은 횟수는 **5회 이하로 줄었을 때만** 경고한다(F8-09). 매번 숫자를 주면 없는
      //   아이디에도 잠금 정책이 그대로 새어 나간다(폐쇄망 전제로 이 정도만 연다).
      res.status(401).json({
        error: "invalid_credentials",
        message:
          남은 === 0
            ? `아이디 또는 비밀번호가 맞지 않습니다. 시도가 너무 많아 ${잠금길이분()}분 동안 잠겼습니다.`
            : 남은 <= 5
              ? `아이디 또는 비밀번호가 맞지 않습니다. ${남은}회 더 틀리면 ${잠금길이분()}분 동안 잠깁니다.`
              : "아이디 또는 비밀번호가 맞지 않습니다.",
        remaining: 남은,
      });
      return;
    }
    // 중복로그인 방지: 이미 다른 곳에서 로그인 중이면 강제 확인 없이는 새 세션을 내주지 않는다.
    // ⚠ findActiveSession은 **토큰 문자열**을 돌려준다(기록이 아니다) — 기록은 한 번 더 꺼낸다.
    //   처음에 이 반환값을 기록으로 착각했다가 적용 전에 잡았다(이 저장소의 「필드명 오인」 부류).
    const 살아있는토큰 = findActiveSession(user.id);
    const 살아있는세션 = 살아있는토큰 ? refreshTokens.get(살아있는토큰) : undefined;
    if (살아있는세션 && !force) {
      // ⚠ 2026-09-02(F2-07 승인 시안): **어디서·언제**를 함께 준다. 예전엔 「이미 다른 곳에서
      //   로그인 중입니다」만 보내서, 담당자는 그것이 **자기가 아까 쓰던 자리인지 남인지** 알 수 없었다.
      //   보안 제품에서 그 구분은 「강제로 밀고 들어갈까」를 정하는 근거다.
      //   ⚠ **새 컬럼을 만들지 않았다** — 세션 기록이 이미 ip·since·lastSeenAt을 들고 있고,
      //     팀 사무실 창이 같은 값을 이미 사람에게 보여 준다(같은 것을 두 번 세지 않는다).
      res.status(409).json({
        error: "already_logged_in",
        message: "이미 다른 곳에서 로그인 중입니다. 강제 로그인하시겠습니까?",
        기존접속: {
          ip: 살아있는세션.ip ?? null,
          since: 살아있는세션.since ?? null,
          lastSeenAt: 살아있는세션.lastSeenAt ?? null,
        },
      });
      return;
    }
    // ── 2차 인증 ─────────────────────────────────────────────────────────────
    // 여기까지 왔으면 비밀번호는 맞다. 코드가 필요한 계정에는 **토큰을 내주지 않고** 중간
    // 토큰만 준다. 중복 로그인 확인(위 409)을 코드 입력 **전에** 끝낸 이유는, 6자리를 다
    // 넣은 뒤에 "이미 로그인 중"이라며 거절하면 헛수고가 되기 때문이다.
    if (isMfaEnabled(user.id)) {
      // ⚠ 여기서 실패 카운터를 지우면 안 된다(2026-07-30 시험이 잡은 결함).
      //   지우면 비밀번호를 아는 공격자가 "비밀번호 → 6자리 1회 시도 → 다시 비밀번호"를 반복해
      //   **횟수 제한 없이 6자리를 추측**할 수 있다 — 비밀번호가 새도 버티는 것이 2차 인증의
      //   존재 이유인데 그 자리가 뚫린다. 카운터는 2단계까지 **끝낸 뒤에만** 지운다.
      res.json({
        mfaRequired: true,
        mfaToken: signMfaToken(user.id, Boolean(force)),
        user: { id: user.id, displayName: user.displayName, role: user.role },
      });
      return;
    }

    // 관리자 필수 정책이 켜져 있는데 아직 등록하지 않았다면 — 등록만 가능한 제한 세션을 준다.
    // 로그인을 아예 막으면 등록할 길이 없어진다(로그인해야 등록, 등록해야 로그인).
    const enrollOnly = user.role === "admin" && mfaRequiredForAdmin();
    loginAttempts.delete(key); // 성공 시 카운터 초기화
    const tokens = issueTokenPair(user.id, { ip: req.ip ?? undefined, enroll: enrollOnly || undefined });
    recordAudit({
      kind: "auth", actor: user.displayName,
      action: enrollOnly ? "로그인(2차 인증 등록 필요)" : force ? "강제 로그인" : "로그인",
      target: req.ip ?? null, result: "ok",
    });
    res.json({
      ...tokens,
      enrollRequired: enrollOnly || undefined,
      user: { id: user.id, displayName: user.displayName, role: user.role },
    });
  });

  // 로그인 2단계 — 인증앱의 6자리 또는 복구 코드. 여기서만 중간 토큰(mfaToken)을 받는다.
  app.post("/api/auth/login/mfa", (req, res) => {
    const { mfaToken, code, recoveryCode } = req.body as {
      mfaToken?: string; code?: string; recoveryCode?: string;
    };
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(String(mfaToken ?? ""), JWT_SECRET) as jwt.JwtPayload;
    } catch {
      res.status(401).json({ error: "mfa_token_invalid", message: "인증 시간이 지났습니다. 다시 로그인하세요." });
      return;
    }
    if (payload.purpose !== "mfa" || typeof payload.sub !== "string") {
      res.status(401).json({ error: "mfa_token_invalid", message: "인증 시간이 지났습니다. 다시 로그인하세요." });
      return;
    }
    const user = findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // 코드 추측도 무차별 대입이다 — 비밀번호와 같은 카운터·잠금을 적용한다.
    // (NIST SP 800-63B: 6자리처럼 짧은 값에는 횟수 제한이 필수)
    const key = loginKey(req, user.username);
    const lockMs = loginLockRemaining(key);
    if (lockMs > 0) {
      res.status(429).json({ error: `시도가 너무 많습니다. ${Math.ceil(lockMs / 60000)}분 후 다시 시도하세요.` });
      return;
    }

    const usedRecovery = Boolean(recoveryCode && !code);
    let ok = false;
    let reason: string | undefined;
    let remaining = 0;
    if (usedRecovery) {
      const r = consumeRecoveryCode(user.id, String(recoveryCode));
      ok = r.ok;
      remaining = r.remaining;
      reason = r.ok ? undefined : "복구 코드가 맞지 않습니다(이미 쓴 코드일 수 있습니다).";
    } else {
      const r = verifyLoginCode(user.id, String(code ?? ""));
      ok = r.ok;
      reason =
        r.reason === "재사용" ? "이미 쓴 숫자입니다. 다음 숫자가 나오면 넣으세요."
        : r.reason === "복구불가" ? "서버의 암호화 키를 열 수 없어 코드를 확인할 수 없습니다. 복구 코드를 쓰거나 관리자에게 2차 인증 해제를 요청하세요."
        : r.reason === "형식" ? "6자리 숫자를 넣으세요."
        : r.ok ? undefined : "숫자가 맞지 않습니다. 휴대폰과 서버의 시각이 어긋났는지 확인하세요.";
    }

    if (!ok) {
      recordLoginFail(key);
      recordAudit({
        kind: "auth", actor: user.displayName,
        action: usedRecovery ? "복구 코드 실패" : "2차 인증 실패",
        target: req.ip ?? null, result: "error",
      });
      res.status(401).json({ error: "mfa_failed", message: reason });
      return;
    }
    loginAttempts.delete(key);

    // 비밀번호 단계와 코드 단계 사이에 다른 곳에서 로그인했을 수 있다 — 다시 확인한다.
    const force = payload.force === true;
    // ⚠ findActiveSession은 **토큰 문자열**을 돌려준다(기록이 아니다) — 기록은 한 번 더 꺼낸다.
    //   처음에 이 반환값을 기록으로 착각했다가 적용 전에 잡았다(이 저장소의 「필드명 오인」 부류).
    const 살아있는토큰 = findActiveSession(user.id);
    const 살아있는세션 = 살아있는토큰 ? refreshTokens.get(살아있는토큰) : undefined;
    if (살아있는세션 && !force) {
      // ⚠ 2026-09-02(F2-07 승인 시안): **어디서·언제**를 함께 준다. 예전엔 「이미 다른 곳에서
      //   로그인 중입니다」만 보내서, 담당자는 그것이 **자기가 아까 쓰던 자리인지 남인지** 알 수 없었다.
      //   보안 제품에서 그 구분은 「강제로 밀고 들어갈까」를 정하는 근거다.
      //   ⚠ **새 컬럼을 만들지 않았다** — 세션 기록이 이미 ip·since·lastSeenAt을 들고 있고,
      //     팀 사무실 창이 같은 값을 이미 사람에게 보여 준다(같은 것을 두 번 세지 않는다).
      res.status(409).json({
        error: "already_logged_in",
        message: "이미 다른 곳에서 로그인 중입니다. 강제 로그인하시겠습니까?",
        기존접속: {
          ip: 살아있는세션.ip ?? null,
          since: 살아있는세션.since ?? null,
          lastSeenAt: 살아있는세션.lastSeenAt ?? null,
        },
      });
      return;
    }
    const tokens = issueTokenPair(user.id, { ip: req.ip ?? undefined });
    recordAudit({
      kind: "auth", actor: user.displayName,
      action: usedRecovery ? `복구 코드로 로그인(남은 코드 ${remaining}개)` : force ? "강제 로그인(2차 인증)" : "로그인(2차 인증)",
      target: req.ip ?? null, result: "ok",
    });
    res.json({
      ...tokens,
      recoveryUsed: usedRecovery || undefined,
      recoveryRemaining: usedRecovery ? remaining : undefined,
      user: { id: user.id, displayName: user.displayName, role: user.role },
    });
  });

  app.post("/api/auth/refresh", (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    const record = refreshToken ? refreshTokens.get(refreshToken) : undefined;
    if (!refreshToken || !record) {
      // ⚠ 사유 문장은 **서버가 만든다**(2026-09-02 F8-06·F3-06). message가 없으면 클라이언트가
      //   error 코드를 그대로 앞세워 담당자 화면에 「invalid refresh token」이 찍힌다.
      res.status(401).json({ error: "invalid refresh token", message: "로그인 정보가 더 이상 유효하지 않습니다. 다시 로그인해 주세요." });
      return;
    }
    if (record.expiresAt < Date.now()) {
      refreshTokens.delete(refreshToken);
      // ⚠ 위와 같은 이유 — 코드만 보내면 담당자가 영문을 읽게 된다(F8-06·F3-06).
      res.status(401).json({ error: "refresh token expired", message: "로그인 유효 시간이 지났습니다. 다시 로그인해 주세요." });
      return;
    }
    // 유휴 타임아웃 — 마지막 활동 후 오래 방치된 세션은 갱신을 거부한다(재로그인 유도).
    if (isIdleExpired(record.lastSeenAt)) {
      revokeRefreshToken(refreshToken);
      res.status(401).json({ error: "session_idle_expired", message: "오래 사용하지 않아 세션이 만료되었습니다. 다시 로그인하세요." });
      return;
    }
    // 다른 곳에서 강제 로그인해 이 세션이 대체됐는지 — activeSessionByUser가 갈아 끼워져 있다.
    if (activeSessionByUser.get(record.userId) !== refreshToken) {
      refreshTokens.delete(refreshToken);
      res.status(409).json({ error: "session_superseded", message: "다른 곳에서 로그인되어 이 세션은 종료되었습니다." });
      return;
    }
    // 회전(rotation): 재사용 방지를 위해 사용된 refresh token은 즉시 폐기하고 새 쌍을 발급한다.
    // 접속 메타(IP·최초 로그인 시각)는 이어받는다 — presence 표시가 회전 때마다 리셋되지 않게.
    // ⚠ enroll(등록 전용 제한)도 반드시 이어받는다 — 안 이어받으면 refresh 한 번으로 제한이 풀려
    //   "관리자 2차 인증 필수" 정책이 아무 의미가 없어진다.
    refreshTokens.delete(refreshToken);
    res.json(issueTokenPair(record.userId, { ip: record.ip, since: record.since, enroll: record.enroll }));
  });

  app.post("/api/auth/logout", authMiddleware, (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) revokeRefreshToken(refreshToken);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", authMiddleware, (req, res) => {
    // ⚠ user 객체를 그대로 내보내면 **passwordHash(bcrypt)가 클라이언트로 나간다**
    //   (2026-07-29 실측: 응답에 "$2b$10$…"가 그대로 들어 있었다).
    //   내 계정의 해시라 해도 나갈 이유가 전혀 없다 — 렌더러 메모리·로그·오류 리포트에
    //   묻어 나가면 오프라인 크래킹 대상이 된다. 보안 제품이 자기 비밀을 흘리면 안 된다.
    //   목록(listUsers)과 로그인 응답은 이미 필요한 것만 골라 보내고 있었다 — 여기만 빠져 있었다.
    const u = (req as Request & { user?: GijoUser }).user;
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    // clearance(열람 등급)는 화면이 "내가 어디까지 볼 수 있나"를 보여주는 데 쓴다.
    //   ⚠ 이 값을 화면이 바꿔 보내도 서버는 안 믿는다 — 검색 차단은 서버가 DB에서 직접 읽는다.
    // minPasswordLen — 비밀번호 규칙의 **단일 출처는 서버**다(users.ts MIN_PASSWORD_LEN).
    //   화면이 숫자를 스스로 적으면 정책을 바꿀 때 화면만 낡는다(「4자라더니 8자」 · F8-03·F6-08).
    //   ⚠ 비밀이 아니다 — 길이 규칙은 어차피 거절 메시지로 드러난다. 해시는 절대 안 나간다(위 주석).
    res.json({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, team: u.team ?? null, clearance: u.clearance ?? null, minPasswordLen: MIN_PASSWORD_LEN });
  });

  // 접속 중 클라이언트(외부 콘솔) 목록 — 팀 사무실 창의 presence 표시용.
  app.get("/api/auth/sessions", authMiddleware, (_req, res) => {
    res.json(listActiveSessions());
  });
}
