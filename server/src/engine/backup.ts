// engine/backup.ts — DB 백업(운영). better-sqlite3의 온라인 백업 API로 가동 중에도 안전하게
// data/backups/ 에 스냅샷을 만든다. 복원은 위험(서버 정지 후 파일 교체)이라 API로 노출하지 않고
// 배포 가이드에 수동 절차로 안내한다.

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";

function backupDir(): string {
  return process.env.GIJO_BACKUP_DIR ?? path.join("data", "backups");
}

export function registerBackupRoutes(app: Express): void {
  // 백업 생성 — 관리자 전용. 타임스탬프 파일로 스냅샷.
  app.post("/api/admin/backup", authMiddleware, adminMiddleware, async (_req, res) => {
    try {
      const dir = backupDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = `gijo-as-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
      const dest = path.join(dir, file);
      await db.backup(dest);
      res.json({ ok: true, file, path: dest, sizeBytes: fs.statSync(dest).size });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // 백업 목록 — 최신순.
  app.get("/api/admin/backups", authMiddleware, adminMiddleware, (_req, res) => {
    const dir = backupDir();
    if (!fs.existsSync(dir)) return res.json([]);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sqlite"))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { file: f, sizeBytes: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
    res.json(files);
  });
}
