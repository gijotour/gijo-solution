// auth/users.ts — 보안담당자 계정 저장소 (SQLite)
// 다음단계 가이드 1.3절 구현: 계정이 하드코딩 1개뿐이던 것을 최소한의 CRUD로 교체했다.
// 범위를 의도적으로 좁게 유지한다 — RBAC 계층, 조직/팀 구조, SSO, 감사 로그는 없다.
// 구분이 필요하면 admin/security_officer 이분법이 상한선.

import type { Express, Request } from "express";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { db } from "../db";
import { authMiddleware, adminMiddleware, revokeUserSession, listActiveSessions } from "./auth";
import { recordAudit } from "../engine/audit";

export interface GijoUser {
  id: string;
  username: string;
  passwordHash: string; // bcrypt 해시 — auth.ts 로그인 라우트에서 bcrypt.compareSync로 검증
  displayName: string;
  role: "security_officer" | "admin";
  team?: string | null; // 소속 팀 — assets.owner와 매칭해 자산 접근 권한을 판정한다(조치 검증)
  // 볼 수 있는 최고 등급(기밀 C·민감 S·공개 O) — engine/grades.ts. NULL이면 '공개만'으로 읽는다.
  // 기존 계정은 NULL이라 닫혀 있다: 관리자가 설정에서 올려 주기 전까지는 그게 맞다.
  clearance?: string | null;
}

// 클라이언트에는 해시를 절대 내려주지 않는다.
export interface GijoUserPublic {
  id: string;
  username: string;
  displayName: string;
  role: GijoUser["role"];
  team: string | null;
  clearance: string | null;
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: GijoUser["role"];
  team: string | null;
  clearance: string | null;
  createdAt: number;
}

// 소속 팀(2026-07-26 조치 검증) — 담당자가 "자기 팀 자산"에만 검증을 실행하게 하는 근거.
// 기존 계정은 null이라 아무 자산도 안 열린다(admin만 접근) = 안전한 기본값.
// ⚠ assets.owner가 자유 문자열이라 오타 한 글자면 매칭이 조용히 실패한다 —
//   그래서 값은 화면에서 선택 목록으로만 고르게 하고(자유 입력 금지), 서버도 저장 전 다듬는다.
try { db.exec("ALTER TABLE users ADD COLUMN team TEXT"); } catch { /* 이미 있으면 무시 */ }
// ⚠ 2026-09-02(F8-04 승인 시안): 비밀번호를 **마지막으로 바꾼 시각**. 관리자가 만들어 준 임시
//   비밀번호를 그대로 쓰고 있는 계정을 알아보는 근거다(NIST SP 800-63B — 관리자가 정한 임시
//   비밀번호는 교체를 요구해야 한다). 값이 **없으면 「한 번도 안 바꿨다」**로 읽는다.
//   ⚠ 강제로 막지 않는다 — 로그인 뒤 **건너뛸 수 있는 권유**로만 쓴다(막는 문은 범위가 훨씬 커진다).
try { db.exec("ALTER TABLE users ADD COLUMN passwordChangedAt INTEGER"); } catch { /* 이미 있으면 무시 */ }

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
  return { id: row.id, username: row.username, displayName: row.displayName, role: row.role, team: row.team ?? null, clearance: row.clearance ?? null, createdAt: row.createdAt };
}

function newId(): string {
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 비밀번호 정책 — 길이 우선(기본 8자, GIJO_MIN_PASSWORD_LEN으로 조정). 보안 제품이라 최소한을 강제한다.
// ⚠ 비밀번호 최소 길이의 **단일 출처는 auth/passwordpolicy.ts**다(2026-09-02 F8-03·F6-08 수리).
//   예전엔 화면(settings.html)이 「4자 이상」이라 하고 서버가 8자를 요구해, 담당자가 안내대로
//   6자를 넣으면 서버가 거절했다 — 한 제품이 두 규칙을 말했다.
//   이제 화면은 /api/auth/me의 minPasswordLen으로, 챗봇 안내(engine/howto.ts)는 정책 파일을 직접 읽는다.
//   ⚠ 숫자를 이 파일(users.ts)에 두면 안 된다 — 여기는 db·auth·audit을 끌고 와서,
//     순수 표인 howto.ts가 import하는 순간 DB가 열린다(tools/learn-candidate-review.mjs가
//     server/dist/engine/howto.js를 서버 밖에서 부른다 — 그때 저장소 루트에 data/ DB가 생긴다).
//   ⚠ 아직 손으로 적힌 자리가 남아 있다(로그인 전이라 /api/auth/me를 못 부르는 곳):
//     client/src/main.ts:319 · setup.html:112·173. 정책을 바꾸면 여기도 함께 본다.
import { MIN_PASSWORD_LEN } from "./passwordpolicy";
export { MIN_PASSWORD_LEN };
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
    team: null, // 소속 팀은 생성 후 관리자가 지정한다(기본 null = 어떤 자산도 안 열림)
    // 열람 등급도 생성 후 관리자가 올린다(기본 null = 코드가 '공개만'으로 읽는다).
    // 새 계정이 만들자마자 기밀 자료를 보게 되면 그게 사고다 — 닫힌 채로 시작한다.
    clearance: null,
    createdAt: Date.now(),
  };
  // INSERT 문에 team·clearance 컬럼은 없다(둘 다 ALTER로 추가돼 기본 null).
  insertStmt.run({ ...row, team: undefined, clearance: undefined } as unknown as UserRow);
  return toPublic(row);
}

// ⚠ 지운 행을 **돌려준다**(2026-08-19 D1). users는 하드 삭제 + 소프트삭제·보관본·FK 전무라
//   지운 뒤에는 내부 id를 아이디·이름으로 되돌릴 길이 없다 — 감사에 신원을 적으려면
//   지우기 전에 읽은 이 행이 유일한 원천이다.
export function deleteUser(id: string): UserRow {
  const row = getByIdStmt.get(id) as UserRow | undefined;
  if (!row) throw new Error("존재하지 않는 계정입니다");
  if (row.role === "admin" && (countAdminsStmt.get() as { n: number }).n <= 1) {
    throw new Error("마지막 관리자 계정은 삭제할 수 없습니다");
  }
  deleteStmt.run(id);
  return row;
}

export function changePassword(id: string, newPassword: string): void {
  if (!getByIdStmt.get(id)) throw new Error("존재하지 않는 계정입니다");
  updatePasswordStmt.run(bcrypt.hashSync(newPassword, 10), id);
}

const updateTeamStmt = db.prepare("UPDATE users SET team = ? WHERE id = ?");
/** 소속 팀 지정(빈 값이면 해제). 앞뒤 공백은 다듬는다 — assets.owner 매칭이 공백 하나로 깨지지 않게. */
export function updateUserTeam(id: string, team: string | null): GijoUserPublic {
  const row = getByIdStmt.get(id) as UserRow | undefined;
  if (!row) throw new Error("존재하지 않는 계정입니다");
  const t = (team ?? "").trim();
  updateTeamStmt.run(t || null, id);
  return toPublic(getByIdStmt.get(id) as UserRow);
}

const updateRoleStmt = db.prepare("UPDATE users SET role = ? WHERE id = ?");
// 역할 변경(admin ↔ security_officer). 마지막 관리자를 담당자로 강등하는 건 막는다(잠금 방지).
export function updateUserRole(id: string, role: GijoUser["role"]): GijoUserPublic {
  const row = getByIdStmt.get(id) as UserRow | undefined;
  if (!row) throw new Error("존재하지 않는 계정입니다");
  if (role !== "admin" && role !== "security_officer") throw new Error("역할은 admin·security_officer 중 하나여야 합니다");
  if (row.role === "admin" && role !== "admin" && (countAdminsStmt.get() as { n: number }).n <= 1) {
    throw new Error("마지막 관리자 계정은 역할을 바꿀 수 없습니다");
  }
  updateRoleStmt.run(role, id);
  return toPublic(getByIdStmt.get(id) as UserRow);
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

// 최초 기동 시(테이블이 비어 있을 때) 관리자 계정을 하나 시드한다.
// ⚠ 고객 self-install 보안: 운영(NODE_ENV=production)이나 GIJO_INITIAL_ADMIN_PASSWORD 지정 시엔
// 알려진 기본 비번("changeme")을 절대 쓰지 않는다 — env 비번을 쓰거나, 없으면 강력 랜덤을 생성해
// 콘솔에 1회만 출력한다(설치자가 확인 후 로그인·즉시 변경). 개발/테스트는 기존 jyh/changeme 유지.
export interface InitialAdmin {
  username: string;
  password: string;
  displayName: string;
  generated: boolean; // 랜덤 생성 여부(출력 필요)
}
export function computeInitialAdmin(env: NodeJS.ProcessEnv = process.env): InitialAdmin {
  const isProd = env.NODE_ENV === "production";
  const envPw = env.GIJO_INITIAL_ADMIN_PASSWORD;
  const username = env.GIJO_INITIAL_ADMIN_USERNAME || (isProd || envPw ? "admin" : "jyh");
  if (isProd || envPw) {
    return { username, password: envPw || crypto.randomBytes(12).toString("base64url"), displayName: "관리자", generated: !envPw };
  }
  return { username: "jyh", password: "changeme", displayName: "정요한", generated: false };
}

// 개발 기본 계정(jyh/changeme)이 아직 그대로인지 — 보안 경고·프리플라이트용.
export function usingDefaultCredential(): boolean {
  const row = getByUsernameStmt.get("jyh") as UserRow | undefined;
  return Boolean(row && bcrypt.compareSync("changeme", row.passwordHash));
}

function seedDefaultAdminIfEmpty(): void {
  const existing = listStmt.all() as UserRow[];
  if (existing.length > 0) return;
  const a = computeInitialAdmin();
  createUser({ username: a.username, password: a.password, displayName: a.displayName, role: "admin" });
  // ⚠ 시드는 HTTP를 안 타서 전역 감사(activityaudit) 밖이다 — 이 계정 생성만은 여기서 남겨야
  //   감사가 「관리자 계정이 언제 어떻게 생겼나」에 답할 수 있다(2026-08-19 D1).
  recordAudit({ kind: "config", actor: "system", action: "초기 관리자 계정 생성", target: a.username, result: "ok" });
  if (a.generated) {
    console.log("════════════════════════════════════════════════");
    console.log(`[setup] 초기 관리자 계정 생성 — 아이디: ${a.username}`);
    console.log(`[setup] 초기 비밀번호: ${a.password}`);
    console.log("[setup] ⚠ 로그인 후 즉시 변경하세요. 이 비밀번호는 다시 표시되지 않습니다.");
    console.log("════════════════════════════════════════════════");
  }
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

  // 조치 담당자 배정용 — 관리자 전용 /api/users와 달리 인증만 되면 누구나 조회 가능(최소 정보만).
  // 승인 화면(approvals.html)의 담당자 자동완성이 이 목록을 쓴다. 계정 생성·삭제 권한은 없다.
  app.get("/api/users/assignable", authMiddleware, (_req, res) => {
    res.json(listUsers().map((u) => ({ id: u.id, displayName: u.displayName, role: u.role, team: u.team })));
  });

  // 소속 팀 지정(관리자 전용) — 자산 접근 권한의 근거라 admin만 바꿀 수 있다.
  app.post("/api/users/:id/team", authMiddleware, adminMiddleware, (req, res) => {
    try {
      const updated = updateUserTeam(String(req.params.id), (req.body as { team?: string })?.team ?? null);
      recordAudit({
        kind: "write",
        actor: (req as Request & { user?: { displayName?: string } }).user?.displayName ?? null,
        action: "소속 팀 변경",
        target: updated.displayName,
        detail: `팀: ${updated.team ?? "(없음)"}`,
      });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/users", authMiddleware, adminMiddleware, (req, res) => {
    try {
      const { username, password, displayName, role } = req.body as {
        username: string;
        password: string;
        displayName: string;
        role: GijoUser["role"];
      };
      const created = createUser({ username, password, displayName, role });
      // ⚠ 전역 감사(activityaudit)는 target="-"라 **어느 계정을 만들었는지가 어디에도 없었다**
      //   (2026-08-19 D1 실측: 만든 계정 아이디가 감사 전체에 0건). 신원은 여기서만 적을 수 있다.
      //   actor는 반드시 displayName — username을 쓰면 auditactor 소스 감시가 실패한다.
      const requester = (req as Request & { user?: GijoUser }).user;
      recordAudit({ kind: "write", actor: requester?.displayName ?? null, action: "계정 생성",
        target: `${created.username}(${created.id})`, detail: `역할 ${created.role} · 이름 ${created.displayName}`, result: "ok" });
      res.json(created);
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
      const removed = deleteUser(targetId);
      // ⚠ 비밀번호 해시를 감사로 흘리지 않는다 — 행을 통째로 싣지 말고 필드를 골라 적는다.
      recordAudit({ kind: "write", actor: requester?.displayName ?? null, action: "계정 삭제",
        target: `${removed.username}(${targetId})`, detail: `역할 ${removed.role} · 이름 ${removed.displayName}`, result: "ok" });
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
      // 관리자가 남의 비번을 초기화하면 그 사용자의 세션을 끊는다(초기화 후 재로그인 강제).
      if (requester?.id !== targetId) {
        revokeUserSession(targetId);
        recordAudit({ kind: "config", actor: requester?.displayName ?? null, action: "비밀번호 초기화(관리자)", target: targetId });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 역할 변경 — 관리자 전용. 마지막 관리자 강등은 updateUserRole이 막는다.
  app.post("/api/users/:id/role", authMiddleware, adminMiddleware, (req, res) => {
    const targetId = String(req.params.id);
    const requester = (req as Request & { user?: GijoUser }).user;
    try {
      const updated = updateUserRole(targetId, (req.body as { role: GijoUser["role"] }).role);
      recordAudit({ kind: "config", actor: requester?.displayName ?? null, action: `역할 변경 → ${updated.role}`, target: targetId });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 계정별 열람 등급(기밀 C·민감 S·공개 O) — N2SF. engine/grades.ts 참고.
  //
  // ⚠ **관리자만** 바꿀 수 있다. 자기 등급을 스스로 올릴 수 있으면 통제가 아니다.
  // ⚠ 바꾼 사실은 반드시 감사에 남긴다 — "누가 언제 누구를 어디까지 열어 줬나"는
  //   나중에 반드시 묻는 질문이다(보안 사고 조사의 첫 질문이 대개 이것이다).
  app.post("/api/users/:id/clearance", authMiddleware, adminMiddleware, (req, res) => {
    const targetId = String(req.params.id);
    const requester = (req as Request & { user?: GijoUser }).user;
    const 값 = String((req.body as { clearance?: string })?.clearance ?? "").toUpperCase();
    if (!["O", "S", "C"].includes(값)) {
      res.status(400).json({ error: "열람 등급은 O(공개)·S(민감)·C(기밀) 중 하나여야 합니다." });
      return;
    }
    const row = getByIdStmt.get(targetId) as UserRow | undefined;
    if (!row) { res.status(404).json({ error: "그런 계정이 없습니다." }); return; }
    db.prepare("UPDATE users SET clearance = ? WHERE id = ?").run(값, targetId);
    recordAudit({
      kind: "config",
      actor: requester?.displayName ?? null,
      action: `열람 등급 변경 → ${값}`,
      target: `${row.username}(${targetId})`,
      detail: `이전 ${row.clearance ?? "미지정(공개만)"} → ${값}`,
    });
    res.json({ ...toPublic({ ...row, clearance: 값 }) });
  });

  // 관리자용 접속 세션 목록 — 누가·어디서(IP)·언제부터 접속 중인지. (팀 사무실 presence와 같은 데이터)
  app.get("/api/users/sessions", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(listActiveSessions());
  });

  // 세션 강제 종료 — 관리자가 특정 사용자의 접속을 원격으로 끊는다(유령·의심 세션 정리).
  app.post("/api/users/:id/terminate-session", authMiddleware, adminMiddleware, (req, res) => {
    const targetId = String(req.params.id);
    const requester = (req as Request & { user?: GijoUser }).user;
    const ended = revokeUserSession(targetId);
    if (ended) recordAudit({ kind: "auth", actor: requester?.displayName ?? null, action: "세션 강제 종료(관리자)", target: targetId });
    res.json({ terminated: ended });
  });
}
