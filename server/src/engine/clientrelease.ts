// engine/clientrelease.ts — 클라이언트(Electron) 설치파일 배포 저장소.
//
// 외부 서비스(GitHub Releases 등) 없는 온프렘 제품이라, 새 버전 설치파일을 이 서버 자체에
// 호스팅한다(클라이언트가 이미 연결돼 있는 그 서버). 관리자가 `npm run publish-release`로
// 빌드된 NSIS 설치파일을 여기 게시하면, 클라이언트는 시작 시·수동으로 최신 버전을 확인하고
// "지금 업데이트"로 다운로드→설치→재시작까지 한 번에 한다(클로드 데스크톱과 같은 UX).
//
// 업로드는 multer 등 새 의존성 없이 express.raw(application/octet-stream)로 받는다 — 게시는
// 관리자가 배포할 때만 하는 드문 작업이라 스트리밍 없이 메모리 버퍼로 받아도 무리 없다.

import type { Express, Request } from "express";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import express from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db, migrate } from "../db";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

migrate(
  "client-releases-2026-07-21",
  `CREATE TABLE IF NOT EXISTS client_releases (
     version TEXT PRIMARY KEY,
     notes TEXT,
     filename TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     size INTEGER NOT NULL,
     publishedAt INTEGER NOT NULL
   )`
);

const RELEASE_DIR = process.env.GIJO_CLIENT_RELEASE_DIR || path.join("data", "client-releases");

export interface ClientRelease {
  version: string;
  notes: string | null;
  filename: string;
  sha256: string;
  size: number;
  publishedAt: number;
}

export function listClientReleases(): ClientRelease[] {
  return db.prepare("SELECT * FROM client_releases ORDER BY publishedAt DESC").all() as ClientRelease[];
}

export function getClientRelease(version: string): ClientRelease | undefined {
  return db.prepare("SELECT * FROM client_releases WHERE version = ?").get(version) as ClientRelease | undefined;
}

// 단순 x.y.z 숫자 비교(semver 전체 스펙 아님 — 이 제품 버전 표기와 일치하면 충분).
function parseVersion(v: string): number[] {
  return v.split(".").map((x) => parseInt(x, 10) || 0);
}
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function latestClientRelease(): ClientRelease | undefined {
  const rows = listClientReleases();
  if (!rows.length) return undefined;
  return rows.reduce((best, r) => (compareVersions(r.version, best.version) > 0 ? r : best));
}

export async function publishClientRelease(version: string, notes: string, buffer: Buffer): Promise<ClientRelease> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("version은 x.y.z 형식이어야 합니다");
  if (!buffer.length) throw new Error("설치 파일 내용이 비어 있습니다");
  await fsp.mkdir(RELEASE_DIR, { recursive: true });
  const filename = `GIJO-AS-Setup-${version}.exe`;
  await fsp.writeFile(path.join(RELEASE_DIR, filename), buffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const row: ClientRelease = { version, notes: notes || null, filename, sha256, size: buffer.length, publishedAt: Date.now() };
  db.prepare(
    `INSERT INTO client_releases (version, notes, filename, sha256, size, publishedAt) VALUES (@version, @notes, @filename, @sha256, @size, @publishedAt)
     ON CONFLICT(version) DO UPDATE SET notes=@notes, filename=@filename, sha256=@sha256, size=@size, publishedAt=@publishedAt`
  ).run(row);
  return row;
}

export function deleteClientRelease(version: string): void {
  const r = getClientRelease(version);
  if (r) {
    const p = path.join(RELEASE_DIR, r.filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare("DELETE FROM client_releases WHERE version = ?").run(version);
}

export function resetClientReleasesForTests(): void {
  db.prepare("DELETE FROM client_releases").run();
}

export function registerClientReleaseRoutes(app: Express): void {
  const actorOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.username ?? "unknown";

  // 클라이언트가 시작 시·수동으로 확인. ?current=2.4.0을 주면 업데이트 필요 여부까지 판정해 준다.
  app.get("/api/client/latest-release", authMiddleware, (req, res) => {
    const latest = latestClientRelease();
    const current = typeof req.query.current === "string" ? req.query.current : undefined;
    const updateAvailable = Boolean(latest && current && compareVersions(latest.version, current) > 0);
    res.json({
      latest: latest ? { version: latest.version, notes: latest.notes, size: latest.size, publishedAt: latest.publishedAt, sha256: latest.sha256 } : null,
      updateAvailable,
    });
  });

  app.get("/api/client/releases", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ releases: listClientReleases() });
  });

  app.get("/api/client/download/:version", authMiddleware, (req, res) => {
    const r = getClientRelease(req.params.version);
    if (!r) {
      res.status(404).json({ error: "해당 버전을 찾을 수 없습니다" });
      return;
    }
    const filePath = path.join(RELEASE_DIR, r.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "설치 파일을 찾을 수 없습니다" });
      return;
    }
    res.download(filePath, r.filename);
  });

  app.post(
    "/api/client/releases",
    authMiddleware,
    adminMiddleware,
    express.raw({ type: "application/octet-stream", limit: "500mb" }),
    asyncRoute(async (req, res) => {
      const version = String(req.query.version ?? "").trim();
      const notes = String(req.query.notes ?? "");
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        res.status(400).json({ error: "설치 파일 본문이 필요합니다(application/octet-stream)" });
        return;
      }
      try {
        const release = await publishClientRelease(version, notes, req.body as Buffer);
        recordAudit({
          kind: "config", actor: actorOf(req), action: "클라이언트 배포판 게시",
          target: release.version, detail: `${release.filename} (${(release.size / 1024 / 1024).toFixed(1)}MB)`, result: "ok",
        });
        res.json({ release });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    })
  );

  app.delete("/api/client/releases/:version", authMiddleware, adminMiddleware, (req, res) => {
    const r = getClientRelease(req.params.version);
    deleteClientRelease(req.params.version);
    if (r) recordAudit({ kind: "config", actor: actorOf(req), action: "클라이언트 배포판 삭제", target: r.version, result: "ok" });
    res.json({ ok: true });
  });
}
