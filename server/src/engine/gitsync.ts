// engine/gitsync.ts — 장기 기억(RAG 문서) 온프레미스 Git 동기화 (공개 GitHub 대신, 6.2절 참고)
// 고객사 내부 Git 서버 주소는 요청마다 파라미터로 받는다 — 이 서버는 기본 remote를 하드코딩하지 않는다.

import type { Express } from "express";
import simpleGit from "simple-git";
import * as fs from "fs/promises";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

export interface GitSyncConfig {
  remoteUrl: string; // 고객사 내부 Git 서버 주소
  branch: string;
}

const SYNC_DIR = path.join("data", "memory-sync");

export async function syncToInternalGit(config: GitSyncConfig): Promise<void> {
  await fs.mkdir(SYNC_DIR, { recursive: true });
  const repo = simpleGit(SYNC_DIR);

  const isRepo = await repo.checkIsRepo();
  if (!isRepo) await repo.init();

  const remotes = await repo.getRemotes();
  if (remotes.find((r) => r.name === "origin")) {
    await repo.remote(["set-url", "origin", config.remoteUrl]);
  } else {
    await repo.addRemote("origin", config.remoteUrl);
  }

  await repo.add(".");
  await repo.commit(`sync: ${new Date().toISOString()}`).catch(() => {
    // 변경사항이 없으면 commit이 실패하는데, 동기화 흐름에서는 정상 상황이라 무시한다.
  });
  await repo.push("origin", config.branch, ["--set-upstream"]);
}

export function registerGitSyncRoutes(app: Express): void {
  app.post(
    "/api/gitsync/sync",
    authMiddleware,
    asyncRoute(async (req, res) => {
      await syncToInternalGit(req.body);
      res.json({ ok: true });
    })
  );
}
