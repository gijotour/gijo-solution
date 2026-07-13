// auth/auth.ts — 보안담당자별 로그인 · 세션 토큰 발급/검증
// TODO: 프로덕션에서는 JWT(만료·서명) 또는 세션 스토어(redis 등)로 교체.
// 지금은 스캐폴딩 단계라 랜덤 토큰 + 인메모리 세션 맵으로 구현.

import type { Request, Response, NextFunction, Express } from "express";
import * as crypto from "crypto";
import { findUserByUsername, findUserById, GijoUser } from "./users";

interface Session {
  token: string;
  userId: string;
  createdAt: number;
}

const sessions = new Map<string, Session>();

function issueToken(userId: string): string {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { token, userId, createdAt: Date.now() });
  return token;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization; // "Bearer <token>"
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const session = token ? sessions.get(token) : undefined;
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  (req as Request & { user?: GijoUser }).user = findUserById(session.userId);
  next();
}

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = findUserByUsername(username);
    // TODO: bcrypt.compare(password, user.passwordHash)로 교체
    if (!user || user.passwordHash !== password) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    const token = issueToken(user.id);
    res.json({ token, user: { id: user.id, displayName: user.displayName, role: user.role } });
  });

  app.post("/api/auth/logout", authMiddleware, (req, res) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (token) sessions.delete(token);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", authMiddleware, (req, res) => {
    res.json((req as any).user);
  });
}
