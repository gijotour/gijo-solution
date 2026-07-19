// auth/auth.ts — 보안담당자별 로그인 · JWT access token + refresh token 발급/검증
// (9.5절 "JWT 만료/갱신 정책" 구현) access token은 짧게 만료되는 서명된 JWT(무상태 검증),
// refresh token은 서버 측 저장소에 남아 회전(rotate)되며 로그아웃 시 즉시 폐기 가능하다.
// 주의: access token 자체는 JWT의 설계 의도대로 무상태이므로, 로그아웃해도 자연 만료 전까지는
// 그 access token 하나만으로는 유효하다 — 즉시 전면 폐기가 필요하면 만료 시간을 더 짧게 잡을 것.

import type { Request, Response, NextFunction, Express } from "express";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcryptjs";
import { findUserByUsername, findUserById, GijoUser } from "./users";

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

interface RefreshRecord {
  userId: string;
  expiresAt: number;
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
function recordLoginFail(key: string): void {
  const now = Date.now();
  const a = loginAttempts.get(key) ?? { fails: 0, firstAt: now, lockedUntil: 0 };
  if (now - a.firstAt > LOGIN_WINDOW_MS) {
    a.fails = 0;
    a.firstAt = now;
  }
  a.fails += 1;
  if (a.fails >= LOGIN_MAX_FAILS) a.lockedUntil = now + LOGIN_WINDOW_MS;
  loginAttempts.set(key, a);
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL } as jwt.SignOptions);
}

function issueRefreshToken(userId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  refreshTokens.set(token, { userId, expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS });
  activeSessionByUser.set(userId, token);
  return token;
}

function issueTokenPair(userId: string): TokenPair {
  return { accessToken: signAccessToken(userId), refreshToken: issueRefreshToken(userId) };
}

function revokeRefreshToken(token: string): void {
  const record = refreshTokens.get(token);
  refreshTokens.delete(token);
  if (record && activeSessionByUser.get(record.userId) === token) {
    activeSessionByUser.delete(record.userId);
  }
}

// 이 userId로 아직 만료되지 않은 세션이 살아 있는지 — 로그인 중복 여부 판단 기준.
function findActiveSession(userId: string): string | undefined {
  const token = activeSessionByUser.get(userId);
  if (!token) return undefined;
  const record = refreshTokens.get(token);
  if (!record || record.expiresAt < Date.now()) {
    activeSessionByUser.delete(userId);
    return undefined;
  }
  return token;
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
    const user = typeof payload.sub === "string" ? findUserById(payload.sub) : undefined;
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as Request & { user?: GijoUser }).user = user;
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
      recordLoginFail(key);
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    // 중복로그인 방지: 이미 다른 곳에서 로그인 중이면 강제 확인 없이는 새 세션을 내주지 않는다.
    if (findActiveSession(user.id) && !force) {
      res.status(409).json({ error: "already_logged_in", message: "이미 다른 곳에서 로그인 중입니다. 강제 로그인하시겠습니까?" });
      return;
    }
    loginAttempts.delete(key); // 성공 시 카운터 초기화
    const tokens = issueTokenPair(user.id);
    res.json({ ...tokens, user: { id: user.id, displayName: user.displayName, role: user.role } });
  });

  app.post("/api/auth/refresh", (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    const record = refreshToken ? refreshTokens.get(refreshToken) : undefined;
    if (!refreshToken || !record) {
      res.status(401).json({ error: "invalid refresh token" });
      return;
    }
    if (record.expiresAt < Date.now()) {
      refreshTokens.delete(refreshToken);
      res.status(401).json({ error: "refresh token expired" });
      return;
    }
    // 다른 곳에서 강제 로그인해 이 세션이 대체됐는지 — activeSessionByUser가 갈아 끼워져 있다.
    if (activeSessionByUser.get(record.userId) !== refreshToken) {
      refreshTokens.delete(refreshToken);
      res.status(409).json({ error: "session_superseded", message: "다른 곳에서 로그인되어 이 세션은 종료되었습니다." });
      return;
    }
    // 회전(rotation): 재사용 방지를 위해 사용된 refresh token은 즉시 폐기하고 새 쌍을 발급한다.
    refreshTokens.delete(refreshToken);
    res.json(issueTokenPair(record.userId));
  });

  app.post("/api/auth/logout", authMiddleware, (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) revokeRefreshToken(refreshToken);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", authMiddleware, (req, res) => {
    res.json((req as Request & { user?: GijoUser }).user);
  });
}
