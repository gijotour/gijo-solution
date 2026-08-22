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
import { recordAudit, listAudit } from "./audit";
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

// ── 에디션 갈래 (2026-08-23) ────────────────────────────────────────────────
//
// ★★ 왜 필요한가 — **라이트 사용자에게 프로 설치본을 내려 줄 뻔했다.**
//   `/api/client/latest-release`가 「전 에디션 통틀어 가장 높은 판」을 돌려주고 클라는
//   자기 에디션을 **안 보냈다.** 그래서 라이트(1.3.0)가 업데이트를 물으면
//   프로 5.70.0이 「새 판」으로 나오고, 받으면 **라이트 설치가 프로로 갈아치워진다.**
//   ⚠ 가정이 아니다: `release-lite/`에는 `GIJO AS Lite Setup 5.17.0/5.18.x`가 실재한다 —
//     두 에디션의 판 번호는 **실제로 겹친 적이 있다.**
//
// ■ 옛 줄은 NULL이다 → 전부 `"pro"`로 읽는다(그때는 라이트를 게시한 적이 없다).
// ■ 요청이 에디션을 안 주면 `"pro"`로 본다 — **옛 클라의 동작이 한 톨도 안 바뀐다.**
// ⚠ 남는 한계: PK가 version 하나라 **두 에디션이 같은 판 번호를 쓰면 못 올린다.**
//   지금은 프로 5.70.x · 라이트 1.3.x라 안 겹치고, 겹칠 때는 게시가 분명히 실패한다
//   (조용히 덮어쓰지 않는다). 겹치는 날 (version, edition) 복합 키로 표를 다시 만든다.
migrate(
  "client-releases-edition-2026-08-23",
  `ALTER TABLE client_releases ADD COLUMN edition TEXT`
);

const RELEASE_DIR = process.env.GIJO_CLIENT_RELEASE_DIR || path.join("data", "client-releases");

export interface ClientRelease {
  version: string;
  notes: string | null;
  filename: string;
  sha256: string;
  size: number;
  publishedAt: number;
  /** ★ 어느 에디션의 설치본인가 — `"pro"`(표준·프로 공용) 또는 `"lite"`.
   *  옛 줄은 비어 있다(NULL) → 전부 `"pro"`로 읽는다. 그때는 라이트를 게시한 적이 없다. */
  edition?: string | null;
}

/** 이 줄이 어느 에디션 것인가 — **한 곳에서만 판정한다**(옛 NULL 처리를 여러 곳에 흩지 않는다). */
export function 에디션of(r: { edition?: string | null }): string {
  return r.edition === "lite" ? "lite" : "pro";
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

/** 가장 높은 판 — **같은 에디션 안에서만** 고른다(2026-08-23).
 *  ⚠ 에디션을 안 주면 `"pro"`다. 옛 클라(에디션을 안 보낸다)의 동작이 그대로 유지된다. */
export function latestClientRelease(edition?: string): ClientRelease | undefined {
  const 원하는 = edition === "lite" ? "lite" : "pro";
  const rows = listClientReleases().filter((r) => 에디션of(r) === 원하는);
  if (!rows.length) return undefined;
  return rows.reduce((best, r) => (compareVersions(r.version, best.version) > 0 ? r : best));
}

export async function publishClientRelease(
  version: string,
  notes: string,
  buffer: Buffer,
  edition?: string
): Promise<ClientRelease> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("version은 x.y.z 형식이어야 합니다");
  if (!buffer.length) throw new Error("설치 파일 내용이 비어 있습니다");
  const 에디션 = edition === "lite" ? "lite" : "pro";
  // ⚠ **다른 에디션이 이미 그 판 번호를 쓰고 있으면 조용히 덮지 않는다**(2026-08-23).
  //   PK가 version 하나라 덮어쓰면 한쪽 설치본이 통째로 사라진다 — 분명히 실패시킨다.
  const 기존 = getClientRelease(version);
  if (기존 && 에디션of(기존) !== 에디션) {
    throw new Error(
      `판 ${version}은 이미 ${에디션of(기존) === "lite" ? "라이트" : "프로"} 설치본이 쓰고 있습니다 — ` +
      `다른 판 번호로 올리세요(두 에디션이 같은 번호를 쓰려면 표를 (판,에디션) 복합 키로 다시 만들어야 합니다).`
    );
  }
  await fsp.mkdir(RELEASE_DIR, { recursive: true });
  // ⚠ 파일 이름에도 에디션을 넣는다 — 받은 사람이 무엇을 받았는지 이름만 보고 알아야 한다.
  const filename = 에디션 === "lite" ? `GIJO-AS-Lite-Setup-${version}.exe` : `GIJO-AS-Setup-${version}.exe`;
  await fsp.writeFile(path.join(RELEASE_DIR, filename), buffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const row: ClientRelease = { version, notes: notes || null, filename, sha256, size: buffer.length, publishedAt: Date.now(), edition: 에디션 };
  db.prepare(
    `INSERT INTO client_releases (version, notes, filename, sha256, size, publishedAt, edition) VALUES (@version, @notes, @filename, @sha256, @size, @publishedAt, @edition)
     ON CONFLICT(version) DO UPDATE SET notes=@notes, filename=@filename, sha256=@sha256, size=@size, publishedAt=@publishedAt, edition=@edition`
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
  const actorOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.displayName ?? "(알 수 없음)";

  // 클라이언트가 시작 시·수동으로 확인. ?current=2.4.0을 주면 업데이트 필요 여부까지 판정해 준다.
  app.get("/api/client/latest-release", authMiddleware, (req, res) => {
    // ★★ **자기 에디션 안에서만 고른다** (2026-08-23) — 안 그러면 라이트에게 프로 설치본을
    //   내려 주고, 받으면 라이트 설치가 프로로 갈아치워진다(위 마이그레이션 주석 참고).
    //   ⚠ 에디션을 안 보내는 옛 클라는 "pro"로 본다 — 그 동작이 한 톨도 안 바뀐다.
    const 에디션 = req.query.edition === "lite" ? "lite" : "pro";
    const latest = latestClientRelease(에디션);
    const current = typeof req.query.current === "string" ? req.query.current : undefined;
    const updateAvailable = Boolean(latest && current && compareVersions(latest.version, current) > 0);
    res.json({
      latest: latest ? { version: latest.version, notes: latest.notes, size: latest.size, publishedAt: latest.publishedAt, sha256: latest.sha256, edition: 에디션of(latest) } : null,
      updateAvailable,
      edition: 에디션,
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
    // 누가 어떤 버전을 받았는지 남긴다(2026-07-28 사용자 요청).
    // 게시·삭제는 기록이 있었는데 **받는 것만 없어서**, 어느 담당자가 어느 판을 쓰는지
    // 알 길이 없었다. 업데이트 화면이 이 기록을 그대로 보여 준다.
    // kind는 config로 둔다 — 작업 세션 목록에 쌓이지 않는 종류다(세션 도배 방지).
    const who = (req as Request & { user?: GijoUser }).user;
    recordAudit({
      kind: "config",
      actor: actorOf(req),
      action: "클라이언트 업데이트 받음",
      target: r.version,
      detail: who?.displayName ? `이름 ${who.displayName}` : undefined,
      result: "ok",
    });
    res.download(filePath, r.filename);
  });

  // 어떤 계정이 어떤 버전을 받았는지 — 업데이트 화면이 읽어 간다.
  // 관리자만 본다: 다른 담당자가 무엇을 쓰는지는 운영 정보다.
  app.get("/api/client/download-log", authMiddleware, adminMiddleware, (_req, res) => {
    const rows = listAudit({ kind: "config", limit: 1000 })
      .filter((e) => e.action === "클라이언트 업데이트 받음")
      .slice(0, 50)
      .map((e) => ({ at: e.at, actor: e.actor, version: e.target, detail: e.detail }));
    res.json({ downloads: rows });
  });

  app.post(
    "/api/client/releases",
    authMiddleware,
    adminMiddleware,
    express.raw({ type: "application/octet-stream", limit: "500mb" }),
    asyncRoute(async (req, res) => {
      const version = String(req.query.version ?? "").trim();
      const notes = String(req.query.notes ?? "");
      // ★ 에디션(2026-08-23) — 안 주면 "pro"다(옛 게시 스크립트 동작 보존).
      const edition = req.query.edition === "lite" ? "lite" : "pro";
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        res.status(400).json({ error: "설치 파일 본문이 필요합니다(application/octet-stream)" });
        return;
      }
      try {
        const release = await publishClientRelease(version, notes, req.body as Buffer, edition);
        recordAudit({
          kind: "config", actor: actorOf(req),
          action: "클라이언트 배포판 게시(" + (edition === "lite" ? "라이트" : "프로·표준") + ")",
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
