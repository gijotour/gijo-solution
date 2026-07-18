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

export function registerBackupRoutes(app: Express): void {
  // 백업 생성 — 관리자 전용. SQLite 스냅샷 + LanceDB(장기 기억) 폴더 복사를 같은 타임스탬프로 묶는다.
  app.post("/api/admin/backup", authMiddleware, adminMiddleware, async (_req, res) => {
    try {
      const dir = backupDir();
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = `gijo-as-${stamp}.sqlite`;
      const dest = path.join(dir, file);
      await db.backup(dest);

      const lanceSrc = lanceDbDir();
      const lanceFile = `gijo-as-${stamp}.lancedb`;
      const lanceDest = path.join(dir, lanceFile);
      let lanceSizeBytes = 0;
      let lanceIncluded = false;
      if (fs.existsSync(lanceSrc)) {
        await fs.promises.cp(lanceSrc, lanceDest, { recursive: true });
        lanceSizeBytes = dirSize(lanceDest);
        lanceIncluded = true;
      }

      res.json({
        ok: true,
        file,
        path: dest,
        sizeBytes: fs.statSync(dest).size,
        lanceFile: lanceIncluded ? lanceFile : undefined,
        lanceSizeBytes,
        lanceIncluded,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
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
