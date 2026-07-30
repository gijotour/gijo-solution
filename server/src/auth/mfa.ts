// auth/mfa.ts — 2차 인증 저장·검증 계층. TOTP 계산 자체는 totp.ts, 여기는 "누가 켰고 어떤
// 비밀을 쓰는가 · 복구 코드가 남았는가 · 정책상 필수인가"를 다룬다.
//
// ■ 비밀키를 암호화해 저장하는 이유
//   TOTP 비밀키는 비밀번호와 달리 해시할 수 없다(그 값으로 숫자를 계산해야 하므로).
//   그런데 이 제품은 **자동 백업**이 DB 파일을 그대로 복사한다 — 평문으로 두면 백업 한 부만
//   새어도 모든 계정의 2차 인증이 조용히 무력화된다(사용자는 알 수도 없다).
//   그래서 cryptopack(AES-256-GCM, data/encryption.key)으로 감싸 저장한다.
//   ⚠ 열 수 없게 되면(키 파일 분실) 그 계정은 코드로 못 들어온다 — 복구 코드 또는 관리자
//     해제가 유일한 길이고, 아래 verifyLoginCode가 그 사유를 "복구불가"로 정확히 알려준다.
//
// ■ 복구 코드는 bcrypt 해시로 저장한다(비밀번호와 같은 취급). 1회용이라 쓴 코드는 usedAt이 찍힌다.

import { db, migrate } from "../db";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { encryptString, decryptString, getEncryptionKey } from "../engine/cryptopack";
import {
  generateSecret, verifyTotp, otpauthUri, formatSecretForDisplay,
  generateRecoveryCodes, normalizeRecoveryCode, RECOVERY_CODE_COUNT,
} from "./totp";

migrate(
  "user-mfa-2026-07-30",
  `CREATE TABLE IF NOT EXISTS user_mfa (
     userId TEXT PRIMARY KEY,
     secretEnc TEXT NOT NULL,      -- cryptopack으로 암호화된 base32 비밀키
     enabledAt INTEGER,            -- NULL이면 등록 진행 중(아직 코드 확인 안 됨) — 로그인을 막지 않는다
     lastCounter INTEGER,          -- 마지막으로 성공한 30초 칸 — 같은 숫자 재사용 차단
     lastUsedAt INTEGER,
     createdAt INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS user_mfa_recovery (
     id TEXT PRIMARY KEY,
     userId TEXT NOT NULL,
     codeHash TEXT NOT NULL,
     createdAt INTEGER NOT NULL,
     usedAt INTEGER
   );
   CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_user ON user_mfa_recovery(userId);`
);

interface MfaRow {
  userId: string;
  secretEnc: string;
  enabledAt: number | null;
  lastCounter: number | null;
  lastUsedAt: number | null;
  createdAt: number;
}

const selRow = db.prepare("SELECT * FROM user_mfa WHERE userId = ?");
const delRow = db.prepare("DELETE FROM user_mfa WHERE userId = ?");
const delRecovery = db.prepare("DELETE FROM user_mfa_recovery WHERE userId = ?");
const insRecovery = db.prepare(
  "INSERT INTO user_mfa_recovery (id, userId, codeHash, createdAt, usedAt) VALUES (?, ?, ?, ?, NULL)"
);
const selRecovery = db.prepare("SELECT id, codeHash FROM user_mfa_recovery WHERE userId = ? AND usedAt IS NULL");
const useRecovery = db.prepare("UPDATE user_mfa_recovery SET usedAt = ? WHERE id = ?");
const countRecovery = db.prepare(
  "SELECT COUNT(*) AS n FROM user_mfa_recovery WHERE userId = ? AND usedAt IS NULL"
);

function row(userId: string): MfaRow | undefined {
  return selRow.get(userId) as MfaRow | undefined;
}

/** 이 계정이 로그인 때 코드를 요구받는 상태인가(등록 완료된 것만). */
export function isMfaEnabled(userId: string): boolean {
  const r = row(userId);
  return Boolean(r && r.enabledAt);
}

export interface MfaStatus {
  enabled: boolean;
  enrolling: boolean; // 등록을 시작했지만 아직 코드로 확인하지 않음
  enabledAt: number | null;
  lastUsedAt: number | null;
  recoveryRemaining: number;
}

export function mfaStatus(userId: string): MfaStatus {
  const r = row(userId);
  return {
    enabled: Boolean(r?.enabledAt),
    enrolling: Boolean(r && !r.enabledAt),
    enabledAt: r?.enabledAt ?? null,
    lastUsedAt: r?.lastUsedAt ?? null,
    recoveryRemaining: r?.enabledAt ? (countRecovery.get(userId) as { n: number }).n : 0,
  };
}

/**
 * 등록 시작 — 비밀키를 새로 만들어 "확인 대기" 상태로 저장하고, 인증앱에 넣을 값을 돌려준다.
 * 이미 켜져 있으면 시작하지 않는다(먼저 끄게 한다 — 실수로 기존 등록을 날리지 않게).
 */
export function startEnrollment(userId: string, username: string): {
  secret: string;
  secretDisplay: string;
  uri: string;
} | { error: "already_enabled" } {
  if (isMfaEnabled(userId)) return { error: "already_enabled" };
  const secret = generateSecret();
  const now = Date.now();
  db.prepare(
    `INSERT INTO user_mfa (userId, secretEnc, enabledAt, lastCounter, lastUsedAt, createdAt)
     VALUES (?, ?, NULL, NULL, NULL, ?)
     ON CONFLICT(userId) DO UPDATE SET secretEnc = excluded.secretEnc, createdAt = excluded.createdAt,
       enabledAt = NULL, lastCounter = NULL, lastUsedAt = NULL`
  ).run(userId, encryptString(secret, getEncryptionKey()), now);
  return { secret, secretDisplay: formatSecretForDisplay(secret), uri: otpauthUri(secret, username) };
}

function openSecret(r: MfaRow): string | null {
  try {
    return decryptString(r.secretEnc, getEncryptionKey());
  } catch {
    return null; // 암호화 키를 잃었다 — 조용히 통과시키지 않고 호출자가 사유를 알린다
  }
}

/** 등록 확인 — 앱이 만든 코드가 맞으면 2차 인증을 켜고 복구 코드 10개를 **한 번만** 돌려준다. */
export function confirmEnrollment(userId: string, code: string): {
  ok: true; recoveryCodes: string[];
} | { ok: false; reason: "미시작" | "이미켜짐" | "복구불가" | "형식" | "불일치" | "재사용" } {
  const r = row(userId);
  if (!r) return { ok: false, reason: "미시작" };
  if (r.enabledAt) return { ok: false, reason: "이미켜짐" };
  const secret = openSecret(r);
  if (!secret) return { ok: false, reason: "복구불가" };
  const v = verifyTotp(secret, code, { lastCounter: r.lastCounter });
  if (!v.ok) return { ok: false, reason: v.reason ?? "불일치" };
  const now = Date.now();
  db.prepare("UPDATE user_mfa SET enabledAt = ?, lastCounter = ?, lastUsedAt = ? WHERE userId = ?")
    .run(now, v.counter ?? null, now, userId);
  return { ok: true, recoveryCodes: issueRecoveryCodes(userId) };
}

/** 복구 코드를 새로 발급한다(기존 것은 전부 무효). 평문은 이 반환값에서만 볼 수 있다. */
export function issueRecoveryCodes(userId: string): string[] {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const now = Date.now();
  const tx = db.transaction(() => {
    delRecovery.run(userId);
    for (const c of codes) {
      insRecovery.run(crypto.randomUUID(), userId, bcrypt.hashSync(normalizeRecoveryCode(c), 10), now);
    }
  });
  tx();
  return codes;
}

/** 2차 인증 끄기 — 비밀키와 남은 복구 코드를 모두 지운다. */
export function disableMfa(userId: string): boolean {
  const existed = Boolean(row(userId));
  const tx = db.transaction(() => {
    delRow.run(userId);
    delRecovery.run(userId);
  });
  tx();
  return existed;
}

/** 로그인 2단계 — 인증앱 코드 검증. 성공하면 쓴 칸을 기록해 같은 숫자를 다시 못 쓰게 한다. */
export function verifyLoginCode(userId: string, code: string): {
  ok: boolean;
  reason?: "미등록" | "복구불가" | "형식" | "불일치" | "재사용";
} {
  const r = row(userId);
  if (!r || !r.enabledAt) return { ok: false, reason: "미등록" };
  const secret = openSecret(r);
  if (!secret) return { ok: false, reason: "복구불가" };
  const v = verifyTotp(secret, code, { lastCounter: r.lastCounter });
  if (!v.ok) return { ok: false, reason: v.reason ?? "불일치" };
  db.prepare("UPDATE user_mfa SET lastCounter = ?, lastUsedAt = ? WHERE userId = ?")
    .run(v.counter ?? null, Date.now(), userId);
  return { ok: true };
}

/** 복구 코드 사용 — 맞으면 그 코드를 즉시 소진 처리한다(1회용). */
export function consumeRecoveryCode(userId: string, code: string): { ok: boolean; remaining: number } {
  const normalized = normalizeRecoveryCode(code);
  const remainingOf = () => (countRecovery.get(userId) as { n: number }).n;
  if (!normalized || !isMfaEnabled(userId)) return { ok: false, remaining: remainingOf() };
  for (const c of selRecovery.all(userId) as { id: string; codeHash: string }[]) {
    if (bcrypt.compareSync(normalized, c.codeHash)) {
      useRecovery.run(Date.now(), c.id);
      return { ok: true, remaining: remainingOf() };
    }
  }
  return { ok: false, remaining: remainingOf() };
}

// ── 정책: 관리자 계정 2차 인증 필수 ─────────────────────────────────────────
// ⚠ 기본값은 **꺼짐**이다. 켜면 2차 인증을 등록하지 않은 admin 계정이 다음 로그인부터 막히고,
//   **사람이 없는 자동화(게시·QA 전수조사·평가 게이트)도 같이 막힌다** — 스크립트는 6자리를
//   넣을 수 없다. 그래서 라우트가 "켜면 막히는 계정"을 먼저 보여주고 확인을 받는다.
const POLICY_KEY = "mfa:requireForAdmin";

export function mfaRequiredForAdmin(): boolean {
  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(POLICY_KEY) as
    | { value: string }
    | undefined;
  return row?.value === "1";
}

export function setMfaRequiredForAdmin(on: boolean): void {
  db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(POLICY_KEY, on ? "1" : "0");
}

/** 정책을 켜면 로그인이 막히는 계정 목록 — 켜기 전에 그대로 보여준다. */
export function accountsBlockedByPolicy(): { id: string; username: string; displayName: string }[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.displayName FROM users u
        LEFT JOIN user_mfa m ON m.userId = u.id AND m.enabledAt IS NOT NULL
       WHERE u.role = 'admin' AND m.userId IS NULL
       ORDER BY u.username`
    )
    .all() as { id: string; username: string; displayName: string }[];
}

/** 계정별 2차 인증 상태(관리자 화면) — 기기를 잃은 담당자를 찾아 해제하는 데 쓴다. */
export function mfaStatusForAllUsers(): {
  id: string; username: string; displayName: string; role: string;
  enabled: boolean; enabledAt: number | null; recoveryRemaining: number;
}[] {
  return (
    db
      .prepare(
        `SELECT u.id, u.username, u.displayName, u.role, m.enabledAt AS enabledAt,
                (SELECT COUNT(*) FROM user_mfa_recovery r WHERE r.userId = u.id AND r.usedAt IS NULL) AS recoveryRemaining
           FROM users u LEFT JOIN user_mfa m ON m.userId = u.id AND m.enabledAt IS NOT NULL
          ORDER BY u.username`
      )
      .all() as { id: string; username: string; displayName: string; role: string; enabledAt: number | null; recoveryRemaining: number }[]
  ).map((r) => ({ ...r, enabled: r.enabledAt != null, recoveryRemaining: r.enabledAt != null ? r.recoveryRemaining : 0 }));
}

// 테스트 전용 — 표를 비운다.
export function resetMfaForTests(): void {
  db.exec("DELETE FROM user_mfa; DELETE FROM user_mfa_recovery;");
  db.prepare("DELETE FROM app_state WHERE key = ?").run(POLICY_KEY);
}
