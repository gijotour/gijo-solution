// auth/users.ts — 보안담당자 계정 저장소 (SQLite)
// 다음단계 가이드 1.3절 구현: 계정이 하드코딩 1개뿐이던 것을 최소한의 CRUD로 교체했다.
// 범위를 의도적으로 좁게 유지한다 — RBAC 계층, 조직/팀 구조, SSO, 감사 로그는 없다.
// 구분이 필요하면 admin/security_officer 이분법이 상한선.

import type { Express, Request } from "express";
import * as bcrypt from "bcryptjs";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "./auth";

export interface GijoUser {
  id: string;
  username: string;
  passwordHash: string; // bcrypt 해시 — auth.ts 로그인 라우트에서 bcrypt.compareSync로 검증
  displayName: string;
  role: "security_officer" | "admin";
}

// 클라이언트에는 해시를 절대 내려주지 않는다.
export interface GijoUserPublic {
  id: string;
  username: string;
  displayName: string;
  role: GijoUser["role"];
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: GijoUser["role"];
  createdAt: number;
}

const insertStmt = db.prepare(
  "INSERT INTO users (id, username, passwordHash, displayName, role, createdAt) VALUES (@id, @username, @passwordHash, @displayName, @role, @createdAt)"
);
const listStmt = db.prepare("SELECT * FROM users ORDER BY createdAt ASC");
const getByUsernameStmt = db.prepare("SELECT * FROM users WHERE username = ?");
const getByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM users WHERE id = ?");
const updatePasswordStmt = db.prepare("UPDATE users SET passwordHash = ? WHERE id = ?");
const countAdminsStmt = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'");

function toPublic(row: UserRow): GijoUserPublic {
  return { id: row.id, username: row.username, displayName: row.displayName, role: row.role, createdAt: row.createdAt };
}

function newId(): string {
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 비밀번호 정책 — 길이 우선(기본 8자, GIJO_MIN_PASSWORD_LEN으로 조정). 보안 제품이라 최소한을 강제한다.
const MIN_PASSWORD_LEN = Number(process.env.GIJO_MIN_PASSWORD_LEN ?? 8);
export function validatePassword(password: string): void {
  if (!password || password.length < MIN_PASSWORD_LEN) {
    throw new Error(`비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다`);
  }
}

export function createUser(args: {
  username: string;
  password: string;
  displayName: string;
  role: GijoUser["role"];
}): GijoUserPublic {
  if (getByUsernameStmt.get(args.username)) {
    throw new Error(`이미 사용 중인 아이디입니다: ${args.username}`);
  }
  validatePassword(args.password);
  const row: UserRow = {
    id: newId(),
    username: args.username,
    passwordHash: bcrypt.hashSync(args.password, 10),
    displayName: args.displayName,
    role: args.role,
    createdAt: Date.now(),
  };
  insertStmt.run(row);
  return toPublic(row);
}

export function deleteUser(id: string): void {
  const row = getByIdStmt.get(id) as UserRow | undefined;
  if (!row) throw new Error("존재하지 않는 계정입니다");
  if (row.role === "admin" && (countAdminsStmt.get() as { n: number }).n <= 1) {
    throw new Error("마지막 관리자 계정은 삭제할 수 없습니다");
  }
  deleteStmt.run(id);
}

export function changePassword(id: string, newPassword: string): void {
  if (!getByIdStmt.get(id)) throw new Error("존재하지 않는 계정입니다");
  updatePasswordStmt.run(bcrypt.hashSync(newPassword, 10), id);
}

export function listUsers(): GijoUserPublic[] {
  return (listStmt.all() as UserRow[]).map(toPublic);
}

export function findUserByUsername(username: string): GijoUser | undefined {
  return getByUsernameStmt.get(username) as UserRow | undefined;
}

export function findUserById(id: string): GijoUser | undefined {
  return getByIdStmt.get(id) as UserRow | undefined;
}

// 최초 기동 시(테이블이 비어 있을 때) 기본 관리자 계정을 하나 시드한다 — 실치 마법사가
// 생기기 전까지의 최소 조치. 운영 환경에서는 로그인 직후 비밀번호부터 바꿀 것.
function seedDefaultAdminIfEmpty(): void {
  const existing = listStmt.all() as UserRow[];
  if (existing.length > 0) return;
  createUser({ username: "jyh", password: "changeme", displayName: "정요한", role: "admin" });
}
seedDefaultAdminIfEmpty();

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetUsersForTests(): void {
  db.exec("DELETE FROM users");
  seedDefaultAdminIfEmpty();
}

export function registerUsersRoutes(app: Express): void {
  app.get("/api/users", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(listUsers());
  });

  app.post("/api/users", authMiddleware, adminMiddleware, (req, res) => {
    try {
      const { username, password, displayName, role } = req.body as {
        username: string;
        password: string;
        displayName: string;
        role: GijoUser["role"];
      };
      res.json(createUser({ username, password, displayName, role }));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/users/:id", authMiddleware, adminMiddleware, (req, res) => {
    const targetId = String(req.params.id);
    const requester = (req as Request & { user?: GijoUser }).user;
    if (requester?.id === targetId) {
      res.status(400).json({ error: "자기 자신의 계정은 삭제할 수 없습니다" });
      return;
    }
    try {
      deleteUser(targetId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 비밀번호 변경은 본인이거나(자기 것) 관리자면(남의 것도) 가능하다.
  app.post("/api/users/:id/password", authMiddleware, (req, res) => {
    const targetId = String(req.params.id);
    const requester = (req as Request & { user?: GijoUser }).user;
    if (requester?.id !== targetId && requester?.role !== "admin") {
      res.status(403).json({ error: "본인 또는 관리자만 비밀번호를 변경할 수 있습니다" });
      return;
    }
    const { password } = req.body as { password: string };
    try {
      validatePassword(password);
      changePassword(targetId, password);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
