// engine/backup.ts — DB 백업(운영). better-sqlite3의 온라인 백업 API로 가동 중에도 안전하게
// data/backups/ 에 스냅샷을 만든다. 복원은 위험(서버 정지 후 파일 교체)이라 API로 노출하지 않고
// 배포 가이드에 수동 절차로 안내한다.
//
// 실측(2026-07-19): SQLite(자산·승인·유지보수 등)만 백업하고 있었다 — 장기 기억(RAG)인
// LanceDB(memory.lancedb/)는 별도 벡터 스토어라 빠져 있어서, 재해복구 시 지식베이스가 통째로
// 유실될 수 있었다. 같은 타임스탬프로 묶어 폴더 스냅샷을 함께 만든다.
// 모델 파일(models/, 수십GB)은 재다운로드·재머지가 가능해 상시 백업 대상에서 제외한다 —
// 배포 가이드에 별도 이미지 백업으로 안내한다.

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { db, isDbEncrypted } from "../db";
import { unsealWithMachine, toSqlcipherKey } from "../dbkey";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { sessionArchiveDir } from "./worksessions";

function backupDir(): string {
  return process.env.GIJO_BACKUP_DIR ?? path.join("data", "backups");
}

// 자동 백업 정책 — 운영 신뢰성 마감(2026-07-23). 수동 백업만으로는 담당자가 잊으면 재해복구
// 시점이 없다. 하루 1회 자동 스냅샷 + 최근 N개만 보관(오래된 것 정리로 디스크 폭주 방지).
const AUTO_BACKUP_ENABLED = (process.env.GIJO_AUTO_BACKUP ?? "1") !== "0";
const AUTO_BACKUP_INTERVAL_MS = Number(process.env.GIJO_AUTO_BACKUP_INTERVAL_MS ?? 24 * 3600_000);
const BACKUP_KEEP = Number(process.env.GIJO_BACKUP_KEEP ?? 7); // 최근 7개 보관

// memory.ts의 DB_PATH 해석과 반드시 같은 값이어야 한다(같은 env var, 같은 기본값).
function lanceDbDir(): string {
  return process.env.GIJO_MEMORY_DB_PATH ?? path.join("data", "memory.lancedb");
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

// 실제 백업 수행(라우트·스케줄러 공용). 스냅샷 후 보관정책으로 오래된 것 정리.
export async function performBackup(): Promise<{ file: string; sizeBytes: number; lanceIncluded: boolean; archiveIncluded: boolean; pruned: number }> {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `gijo-as-${stamp}.sqlite`;
  const dest = path.join(dir, file);
  // db.backup() → VACUUM INTO 교체(2026-07-30). 이유: 저장 암호화를 켠 DB에서 backup() API는
  // "incompatible source and target" 오류로 실패한다(실측). VACUUM INTO는 평문·암호화 양쪽에서
  // 동작하고, **암호화 DB의 백업본은 암호화된 채로** 나온다 — 백업이 평문 구멍이 되지 않는다.
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);

  const lanceSrc = lanceDbDir();
  let lanceIncluded = false;
  if (fs.existsSync(lanceSrc)) {
    await fs.promises.cp(lanceSrc, path.join(dir, `gijo-as-${stamp}.lancedb`), { recursive: true });
    lanceIncluded = true;
  }
  // 해자 슬라이스 0(2026-08-06 실측 결함): 세션 전문이 100건 초과분부터 session-archive/*.jsonl로
  // 빠져나가는데 백업이 이 폴더를 안 담았다 — 재해복구 시 축적 기록(해자 자산)이 조용히 소실.
  // LanceDB와 같은 방식으로 같은 타임스탬프 짝 폴더로 담는다.
  const archiveSrc = sessionArchiveDir();
  let archiveIncluded = false;
  if (fs.existsSync(archiveSrc)) {
    await fs.promises.cp(archiveSrc, path.join(dir, `gijo-as-${stamp}.session-archive`), { recursive: true });
    archiveIncluded = true;
  }
  const pruned = pruneOldBackups(dir);
  return { file, sizeBytes: fs.statSync(dest).size, lanceIncluded, archiveIncluded, pruned };
}

// 보관정책 — 최신 BACKUP_KEEP개만 남기고 SQLite+짝 LanceDB 폴더를 함께 삭제한다.
function pruneOldBackups(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  const snaps = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite"))
    .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  let pruned = 0;
  for (const { f } of snaps.slice(BACKUP_KEEP)) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
      const lance = path.join(dir, f.replace(/\.sqlite$/, ".lancedb"));
      if (fs.existsSync(lance)) fs.rmSync(lance, { recursive: true, force: true });
      const arch = path.join(dir, f.replace(/\.sqlite$/, ".session-archive"));
      if (fs.existsSync(arch)) fs.rmSync(arch, { recursive: true, force: true });
      pruned++;
    } catch (e) {
      console.warn(`[backup] 오래된 백업 삭제 실패(${f}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return pruned;
}

// ── 복원 가능성 검증 ────────────────────────────────────────────────────────
// **"백업이 있다"와 "그 백업으로 복구된다"는 다른 말이다.** 여기까지 이 제품은 파일이 있는지와
// 만든 시각만 봤다(backupOverdue·자가진단). 그래서 스냅샷이 0바이트여도, 중간에 잘려도,
// 스키마가 뒤처져 지금 코드로 열 수 없어도 전부 "백업 정상"으로 통과했다.
// 재해가 났을 때 처음 알게 되는 종류의 결함이라, 평소에 확인해 둔다.
//
// 검증은 **읽기 전용으로 열어서만** 한다 — 스냅샷을 고치거나 마이그레이션을 걸지 않는다.
// 복원 자체는 서버를 세우고 파일을 바꿔야 해서 자동화하지 않는다(오조작이 곧 데이터 파괴다).
// 대신 검증 결과에 정확한 복원 절차를 함께 실어 보낸다 — 가이드를 못 찾아도 화면에서 보이게.

/** 복원에 필수인 표 — 이게 비어 있으면 복원해도 제품이 제 기능을 못 한다. */
const ESSENTIAL_TABLES = ["users", "schema_migrations", "assets", "audit_log"];

export interface BackupVerifyResult {
  ok: boolean;
  file: string | null;
  createdAt: number | null;
  sizeBytes: number;
  integrity: string | null; // SQLite integrity_check 결과("ok"면 정상)
  tables: Record<string, number | null>; // 표별 행 수(못 읽으면 null)
  schemaLatest: string | null; // 스냅샷의 마이그레이션 최신 id
  schemaMatchesNow: boolean | null; // 지금 코드의 스키마와 같은가
  lanceIncluded: boolean;
  lanceSizeBytes: number;
  problems: string[]; // 복구를 **막는** 것만 넣는다(비어 있으면 이 백업으로 복구할 수 있다)
  // 알아두면 좋지만 복구를 막지는 않는 것. problems에 섞으면 정상 상황에서도 경고가 떠
  // 자가 진단이 늘 노랑이 되고, 그러면 아무도 안 본다.
  notes: string[];
  restoreSteps: string[]; // 복원 절차 — 위험한 작업이라 자동 실행하지 않고 안내만 한다
}

const RESTORE_STEPS = [
  "① 서버를 정지한다 (WSL: systemctl stop gijo-as, 또는 프로세스 종료)",
  "② 지금 data/gijo-as.sqlite 와 data/memory.lancedb 를 **다른 이름으로 옮겨 둔다** — 지우지 말 것(복원이 잘못되면 되돌아갈 자리다)",
  "③ 스냅샷 gijo-as-<시각>.sqlite 를 data/gijo-as.sqlite 로 복사한다",
  "④ 짝 폴더 gijo-as-<같은 시각>.lancedb 를 data/memory.lancedb 로 복사한다 (빠뜨리면 지식베이스가 빈 상태로 뜬다)",
  "⑤ 서버를 다시 켜고 자가 진단(설정 > 시스템 자가 진단)에서 지식베이스·DB 항목이 정상인지 확인한다",
  "※ 모델 파일(models/)은 백업 대상이 아니다 — 다시 받거나 별도 이미지 백업에서 되살린다",
];

/** 최신(또는 지정한) 스냅샷이 실제로 열리고 내용이 들어 있는지 확인한다. 원본은 건드리지 않는다. */
export function verifyBackupSnapshot(fileName?: string): BackupVerifyResult {
  const dir = backupDir();
  const empty: BackupVerifyResult = {
    ok: false, file: null, createdAt: null, sizeBytes: 0, integrity: null, tables: {},
    schemaLatest: null, schemaMatchesNow: null, lanceIncluded: false, lanceSizeBytes: 0,
    problems: [], notes: [], restoreSteps: RESTORE_STEPS,
  };
  let target = fileName ?? null;
  try {
    if (!target) {
      const snaps = fs.readdirSync(dir)
        .filter((f) => f.endsWith(".sqlite"))
        .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
      target = snaps[0]?.f ?? null;
    }
  } catch {
    return { ...empty, problems: ["백업 폴더가 없습니다 — 아직 한 번도 백업하지 않았습니다."] };
  }
  if (!target) return { ...empty, problems: ["백업 스냅샷이 없습니다 — 아직 한 번도 백업하지 않았습니다."] };

  const full = path.join(dir, target);
  const problems: string[] = [];
  const notes: string[] = [];
  let sizeBytes = 0;
  let createdAt: number | null = null;
  try {
    const st = fs.statSync(full);
    sizeBytes = st.size;
    createdAt = st.mtimeMs;
  } catch {
    return { ...empty, file: target, problems: [`스냅샷 파일을 읽을 수 없습니다: ${target}`] };
  }
  if (sizeBytes === 0) problems.push("스냅샷이 0바이트입니다 — 백업이 만들어지다 실패했습니다.");

  // ⚠ **임시 사본**을 열어 검사한다. readonly로 열어도 WAL 모드 DB는 곁에 -shm/-wal 파일을
  //   만든다 — 실측으로 확인했다(2026-07-30: 검증 한 번에 백업 폴더에 두 파일이 생겼다).
  //   백업 폴더는 재해복구의 마지막 자리다. 거기에 무엇도 쓰지 않는 것이 원칙이라,
  //   사본을 만들어 검사하고 사본만 지운다.
  let integrity: string | null = null;
  const tables: Record<string, number | null> = {};
  let schemaLatest: string | null = null;
  let snap: import("better-sqlite3-multiple-ciphers").Database | null = null;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-verify-"));
  const workFile = path.join(workDir, "snapshot.sqlite");
  try {
    fs.copyFileSync(full, workFile);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3-multiple-ciphers") as typeof import("better-sqlite3-multiple-ciphers");
    snap = new Database(workFile, { readonly: true, fileMustExist: true });
    // 저장 암호화가 켜져 있으면 백업본도 암호화돼 있다 — 같은 열쇠로 열어 검사한다.
    // (열쇠 봉인이 안 풀리면 아래 integrity_check가 "file is not a database"로 실패해
    //  problems에 그대로 드러난다 — 조용히 통과시키지 않는다.)
    if (isDbEncrypted()) {
      const dek = unsealWithMachine(process.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite"));
      if (dek) {
        snap.pragma("cipher='sqlcipher'");
        snap.pragma(`key="x'${toSqlcipherKey(dek)}'"`);
        dek.fill(0);
      }
    }
    integrity = (snap.pragma("integrity_check", { simple: true }) as string) ?? null;
    if (integrity !== "ok") problems.push(`스냅샷이 손상됐습니다(integrity_check: ${integrity}) — 이 백업으로는 복구할 수 없습니다.`);
    for (const t of ESSENTIAL_TABLES) {
      try {
        tables[t] = (snap.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      } catch {
        tables[t] = null;
        problems.push(`필수 표 '${t}'가 스냅샷에 없습니다 — 복원해도 제품이 제 기능을 못 합니다.`);
      }
    }
    if (tables.users === 0) problems.push("계정이 0건입니다 — 복원하면 아무도 로그인할 수 없습니다.");
    try {
      const row = snap.prepare("SELECT id FROM schema_migrations ORDER BY appliedAt DESC, id DESC LIMIT 1").get() as { id: string } | undefined;
      schemaLatest = row?.id ?? null;
    } catch { /* 위에서 이미 문제로 잡혔다 */ }
  } catch (e) {
    problems.push(`스냅샷을 열 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    try { snap?.close(); } catch { /* 무시 */ }
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* 무시 */ }
  }

  // 스키마가 지금 코드보다 뒤처지면, 복원은 되지만 그 뒤 마이그레이션이 필요하다는 뜻이다.
  let nowLatest: string | null = null;
  try {
    nowLatest = (db.prepare("SELECT id FROM schema_migrations ORDER BY appliedAt DESC, id DESC LIMIT 1").get() as { id: string } | undefined)?.id ?? null;
  } catch { /* 무시 */ }
  const schemaMatchesNow = schemaLatest && nowLatest ? schemaLatest === nowLatest : null;
  if (schemaMatchesNow === false) {
    notes.push(
      `스냅샷의 DB 구조가 지금 코드보다 뒤처집니다(스냅샷 ${schemaLatest} / 지금 ${nowLatest}). ` +
      "복원은 되지만 서버가 뜰 때 남은 갱신이 자동으로 적용됩니다 — 복원 후 자가 진단을 확인하세요."
    );
  }

  // 짝 LanceDB(지식베이스) — 빠지면 복원해도 지식베이스가 빈 상태로 뜬다.
  const lanceDir = path.join(dir, target.replace(/\.sqlite$/, ".lancedb"));
  const lanceIncluded = fs.existsSync(lanceDir);
  const lanceSizeBytes = lanceIncluded ? dirSize(lanceDir) : 0;
  if (!lanceIncluded) problems.push("짝 지식베이스(.lancedb) 폴더가 없습니다 — 복원하면 지식 검색이 빈 상태가 됩니다.");
  else if (lanceSizeBytes === 0) problems.push("짝 지식베이스 폴더가 비어 있습니다 — 복원하면 지식 검색이 빈 상태가 됩니다.");

  return {
    ok: problems.length === 0,
    file: target, createdAt, sizeBytes, integrity, tables, schemaLatest, schemaMatchesNow,
    lanceIncluded, lanceSizeBytes, problems, notes, restoreSteps: RESTORE_STEPS,
  };
}

let backupTimer: NodeJS.Timeout | null = null;
let firstBackupTimer: NodeJS.Timeout | null = null;
/** 마지막 스냅샷이 주기보다 오래됐는가(없으면 true). 기동 직후 백업 여부를 이걸로 정한다. */
export function backupOverdue(): boolean {
  const dir = backupDir();
  try {
    const times = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sqlite"))
      .map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
    if (times.length === 0) return true;
    return Date.now() - Math.max(...times) >= AUTO_BACKUP_INTERVAL_MS;
  } catch {
    return true; // 폴더가 없으면 한 번도 안 한 것이다
  }
}

export function startBackupScheduler(): void {
  if (!AUTO_BACKUP_ENABLED || backupTimer) return;
  const tick = () => {
    performBackup()
      .then((r) => console.log(`[backup] 자동 백업 완료: ${r.file} (${Math.round(r.sizeBytes / 1024)}KB, LanceDB ${r.lanceIncluded ? "포함" : "없음"}, 정리 ${r.pruned}개)`))
      .catch((e) => console.warn(`[backup] 자동 백업 실패: ${e instanceof Error ? e.message : String(e)}`));
  };
  console.log(`[backup] 자동 백업 스케줄러 시작 (주기 ${Math.round(AUTO_BACKUP_INTERVAL_MS / 3600_000)}시간, 최근 ${BACKUP_KEEP}개 보관)`);

  // ⚠ [2026-07-29 자가 진단이 잡은 실사고] setInterval만 걸면 **첫 백업이 기동 24시간 뒤**다.
  // 운영 서버는 배포·모델 재시작으로 그보다 자주 재시작된다 — 그래서 이 기능이 만들어진
  // 2026-07-23 이후 엿새 동안 운영에 백업이 **단 한 개도 없었다**(폴더조차 없었다).
  // 기동 직후에도 한 번 확인해 밀렸으면 즉시 뜬다. 재시작이 잦아도 백업 폭풍이 나지 않는 이유는
  // "마지막 스냅샷이 주기보다 오래됐을 때만" 돌기 때문이다.
  const firstDelay = Number(process.env.GIJO_BACKUP_FIRST_DELAY_MS ?? 60_000); // 기동 부하가 지난 뒤
  firstBackupTimer = setTimeout(() => {
    if (backupOverdue()) {
      console.log("[backup] 마지막 백업이 주기를 넘겨 기동 직후 1회 실행합니다");
      tick();
    }
  }, firstDelay);
  if (firstBackupTimer.unref) firstBackupTimer.unref();

  backupTimer = setInterval(tick, AUTO_BACKUP_INTERVAL_MS);
  if (backupTimer.unref) backupTimer.unref();
}
export function stopBackupScheduler(): void {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  // 기동 60초 안에 종료·재배포가 겹치면 종료 중에 백업이 뜰 수 있다 — 함께 정리한다.
  if (firstBackupTimer) { clearTimeout(firstBackupTimer); firstBackupTimer = null; }
}

export function registerBackupRoutes(app: Express): void {
  // 백업 생성 — 관리자 전용. SQLite 스냅샷 + LanceDB(장기 기억) 폴더 복사를 같은 타임스탬프로 묶는다.
  app.post("/api/admin/backup", authMiddleware, adminMiddleware, async (_req, res) => {
    try {
      const r = await performBackup();
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // 복원 가능성 검증 — "백업이 있다"와 "그 백업으로 복구된다"는 다른 말이다.
  // 스냅샷을 읽기 전용으로 열어 무결성·필수 표·스키마·짝 지식베이스를 확인하고, 복원 절차를 함께 준다.
  // 복원 자체는 자동화하지 않는다(오조작이 곧 데이터 파괴다) — 절차 안내까지가 여기 몫이다.
  app.get("/api/admin/backup/verify", authMiddleware, adminMiddleware, (req, res) => {
    const file = typeof req.query.file === "string" ? req.query.file : undefined;
    // 경로 조작 방지 — 백업 폴더 안의 파일만 검증한다.
    if (file && (file.includes("/") || file.includes("\\") || file.includes(".."))) {
      res.status(400).json({ error: "bad_file", message: "백업 폴더 안의 파일 이름만 지정할 수 있습니다." });
      return;
    }
    try {
      res.json(verifyBackupSnapshot(file));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // 백업 정책 조회 — 화면에 "자동 백업 켜짐·주기·보관 개수"를 보여주기 위함.
  app.get("/api/admin/backup/policy", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ autoEnabled: AUTO_BACKUP_ENABLED, intervalHours: Math.round(AUTO_BACKUP_INTERVAL_MS / 3600_000), keep: BACKUP_KEEP });
  });

  // 백업 목록 — 최신순. 같은 타임스탬프의 lancedb 폴더가 있으면 함께 표시(짝 여부 확인용).
  app.get("/api/admin/backups", authMiddleware, adminMiddleware, (_req, res) => {
    const dir = backupDir();
    if (!fs.existsSync(dir)) return res.json([]);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sqlite"))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        const stamp = f.replace(/^gijo-as-/, "").replace(/\.sqlite$/, "");
        const lanceFile = `gijo-as-${stamp}.lancedb`;
        const lanceExists = fs.existsSync(path.join(dir, lanceFile));
        return {
          file: f,
          sizeBytes: st.size,
          at: st.mtimeMs,
          lanceFile: lanceExists ? lanceFile : undefined,
          lanceSizeBytes: lanceExists ? dirSize(path.join(dir, lanceFile)) : 0,
        };
      })
      .sort((a, b) => b.at - a.at);
    res.json(files);
  });
}
