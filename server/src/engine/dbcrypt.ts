// engine/dbcrypt.ts — 저장 암호화(at-rest) 상태·복구 열쇠 관리 API. (계획서 후-1)
//
// 정직 규칙: 이 암호화가 무엇을 막고 무엇을 못 막는지 상태 응답에 그대로 싣는다.
//   막는 것  — DB 파일·백업본 유출, 폐기 디스크에서의 복원
//   못 막는 것 — 서버가 살아 있는 동안의 침해(그 기계에서 봉인을 풀 수 있어야 무인 재시작이 된다),
//               그리고 **지식베이스(LanceDB)의 문서 원문** — SQLite가 아니라 이 암호화 대상이 아니다.
// "암호화했으니 안전합니다"라고 뭉뚱그리면 조달 심사에서 거짓이 된다.
import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { isDbEncrypted } from "../db";
import { hasKeyFile, fingerprintStrength, unsealWithMachine, rotateRecoveryKey, readKeyFile } from "../dbkey";
import { recordAudit } from "./audit";

function dbPath(): string {
  return process.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite");
}

export interface DbCryptStatus {
  encrypted: boolean;
  keyFilePresent: boolean;
  keyCreatedAt: number | null;
  machineBinding: { sources: number; strong: boolean };
  covers: string[]; // 막는 것
  notCovered: string[]; // 못 막는 것 — 과장 방지의 핵심
  howToEnable: string | null; // 꺼져 있을 때만
  /** 옆에 남아 있는 평문 DB 사본 — 이게 있으면 암호화가 무력화된다. */
  plaintextCopies: { count: number; files: string[]; totalMb: number };
}

/**
 * 평문 DB 사본을 찾는다 — **암호화를 켠 의미를 지우는 가장 흔한 함정**이다.
 * 실측(2026-07-30, 운영 전환 직후): 암호화를 켰는데 옆에 평문 사본이 10개 남아 있었다
 * (과거 수동 작업의 .bak 5개 + 전환 전 자동 백업 4개 + 전환 직전 백업 1개).
 * DB를 훔치려는 사람은 잠긴 파일 대신 옆의 .bak을 가져가면 그만이다.
 * 그래서 **제품이 스스로 세어 알린다** — 담당자가 알아서 눈치채길 기대하지 않는다.
 */
function findPlaintextCopies(): { count: number; files: string[]; totalMb: number } {
  const dbFile = dbPath();
  const dataDir = path.dirname(path.resolve(dbFile));
  const backupDir = process.env.GIJO_BACKUP_DIR ?? path.join(path.dirname(dbFile), "backups");
  const files: string[] = [];
  let bytes = 0;

  const 평문인가 = (p: string): boolean => {
    let fd: number | null = null;
    try {
      fd = fs.openSync(p, "r");
      const buf = Buffer.alloc(15);
      fs.readSync(fd, buf, 0, 15, 0);
      return buf.toString("latin1") === "SQLite format 3";
    } catch {
      return false;
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch { /* 무시 */ }
    }
  };

  for (const dir of [dataDir, path.resolve(backupDir)]) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const full = path.join(dir, name);
      // 지금 쓰는 DB 본체와 그 저널은 제외 — 본체는 암호화돼 있고 저널은 곧 합쳐진다.
      if (full === path.resolve(dbFile) || /-wal$|-shm$/.test(name)) continue;
      if (!/\.sqlite(\.|$)|\.bak$|\.db$/.test(name)) continue;
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        if (평문인가(full)) {
          files.push(path.relative(dataDir, full) || name);
          bytes += st.size;
        }
      } catch {
        /* 읽을 수 없으면 판단하지 않는다(정직 규칙) */
      }
    }
  }
  return { count: files.length, files: files.slice(0, 20), totalMb: Math.round((bytes / 1048576) * 10) / 10 };
}

export function dbCryptStatus(): DbCryptStatus {
  const encrypted = isDbEncrypted();
  const kf = readKeyFile(dbPath());
  const plaintextCopies = encrypted ? findPlaintextCopies() : { count: 0, files: [], totalMb: 0 };
  return {
    encrypted,
    keyFilePresent: hasKeyFile(dbPath()),
    keyCreatedAt: kf?.createdAt ?? null,
    plaintextCopies,
    machineBinding: fingerprintStrength(),
    covers: [
      "DB 파일·자동 백업본이 밖으로 나갔을 때 (열쇠 없이는 열리지 않음)",
      "서버 디스크를 폐기·반출했을 때",
    ],
    notCovered: [
      "서버가 살아 있는 동안의 침해 — 이 기계에서 관리자 권한을 얻으면 열 수 있습니다",
      "지식베이스(문서 원문·LanceDB)는 이 암호화 대상이 아닙니다",
    ],
    howToEnable: encrypted
      ? null
      : "서버를 멈추고  node scripts/encrypt-db.mjs  실행 → 복구 열쇠를 종이에 보관 → 서버 재시작",
  };
}

export function registerDbCryptRoutes(app: Express): void {
  app.get(
    "/api/dbcrypt/status",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json(dbCryptStatus());
    })
  );

  // 복구 열쇠 재발급 — 종이를 잃어버렸거나 유출이 의심될 때. 옛 열쇠는 즉시 무효가 된다.
  // DEK(실제 DB 열쇠)는 그대로라 재암호화는 없다. 응답에 딱 한 번 실려 나가고 저장되지 않는다.
  app.post(
    "/api/dbcrypt/rotate-recovery",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      if (!isDbEncrypted()) {
        res.status(400).json({ error: "저장 암호화가 켜져 있지 않습니다" });
        return;
      }
      const dek = unsealWithMachine(dbPath());
      if (!dek) {
        res.status(500).json({ error: "열쇠 봉인을 풀지 못했습니다 — 서버 로그를 확인하세요" });
        return;
      }
      const recoveryKey = rotateRecoveryKey(dbPath(), dek);
      dek.fill(0);
      const user = (req as unknown as { user?: { displayName?: string } }).user;
      recordAudit({
        kind: "config",
        actor: user?.displayName ?? null,
        action: "DB 복구 열쇠 재발급 — 이전 복구 열쇠는 즉시 무효",
        result: "ok",
      });
      res.json({
        recoveryKey,
        notice: "이 열쇠는 지금 한 번만 표시됩니다. 종이에 적어 금고에 보관하세요. 이전 열쇠는 이제 쓸 수 없습니다.",
      });
    })
  );
}
