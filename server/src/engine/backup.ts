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
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";

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
export async function performBackup(): Promise<{ file: string; sizeBytes: number; lanceIncluded: boolean; pruned: number }> {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `gijo-as-${stamp}.sqlite`;
  const dest = path.join(dir, file);
  await db.backup(dest);

  const lanceSrc = lanceDbDir();
  let lanceIncluded = false;
  if (fs.existsSync(lanceSrc)) {
    await fs.promises.cp(lanceSrc, path.join(dir, `gijo-as-${stamp}.lancedb`), { recursive: true });
    lanceIncluded = true;
  }
  const pruned = pruneOldBackups(dir);
  return { file, sizeBytes: fs.statSync(dest).size, lanceIncluded, pruned };
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
      pruned++;
    } catch (e) {
      console.warn(`[backup] 오래된 백업 삭제 실패(${f}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return pruned;
}

let backupTimer: NodeJS.Timeout | null = null;
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
  const first = setTimeout(() => {
    if (backupOverdue()) {
      console.log("[backup] 마지막 백업이 주기를 넘겨 기동 직후 1회 실행합니다");
      tick();
    }
  }, firstDelay);
  if (first.unref) first.unref();

  backupTimer = setInterval(tick, AUTO_BACKUP_INTERVAL_MS);
  if (backupTimer.unref) backupTimer.unref();
}
export function stopBackupScheduler(): void {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
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
