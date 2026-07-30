// engine/docrequest.ts — 문서함 "요청 만들기": 담당자가 제품에 바라는 점·이상한 점을
// **개발자가 바로 처리할 수 있는 문서**로 만들어 준다. (계획서 중-1 확장)
//
// ■ 사용자가 정한 전제(2026-07-30)
//   "전달은 담당자가 파일 다운해서 직접 전달" → **메일 발송을 만들지 않는다.**
//   서버는 문서를 조립하고 원장에 남기기만 하고, 파일 저장은 클라이언트가 한다.
//   밖으로 내보낼지는 전적으로 담당자 몫이다 — 우리가 고객 데이터를 자동으로 받아 가지 않는다.
//
// ■ 이 기능의 값어치는 "자동으로 붙는 기술 정보"다
//   업계 사례(Marker.io·Usersnap)가 한결같이 강조하는 것이 "기술 정보를 자동으로 붙여
//   개발자와의 왕복을 줄인다"는 점이다. 담당자에게 "어느 버전 쓰세요?"를 되묻지 않는 것이
//   이 기능이 존재하는 이유다.
//
// ■ 자격증명은 가린다 — 파일은 밖으로 나가는 산출물이다
//   본문은 secretscan(비밀번호·API 키)으로 가린다. ⚠ **그림 속은 가릴 수 없다** —
//   코드로 해결 못 하므로 정직하게 경고를 문서와 화면에 함께 싣는다.
import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db, migrate } from "../db";
import { recordAudit } from "./audit";
import { maskSecrets } from "./secretscan";
import { systemHealthText } from "./observability";
import { listLogs } from "./logs";
import type { GijoUser } from "../auth/users";

migrate(
  "doc-request-2026-07-31",
  `CREATE TABLE IF NOT EXISTS doc_requests (
     id TEXT PRIMARY KEY,
     at INTEGER NOT NULL,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     actor TEXT,
     screen TEXT,
     clientVersion TEXT,
     imageCount INTEGER NOT NULL DEFAULT 0,
     maskedCount INTEGER NOT NULL DEFAULT 0,
     fileName TEXT NOT NULL
   )`
);

export type RequestKind = "bug" | "feature" | "ui" | "etc";
const KIND_LABEL: Record<RequestKind, string> = {
  bug: "버그",
  feature: "기능 요청",
  ui: "화면·사용성",
  etc: "기타",
};

export interface BuildRequestInput {
  kind: RequestKind;
  title: string;
  tried: string; // 무엇을 하려 했나
  happened: string; // 무슨 일이 일어났나
  images: string[]; // data:image/...;base64,... (클라이언트가 Ctrl+V로 만든 것)
  screen?: string; // 직전에 보던 화면
  clientVersion?: string;
  platform?: string; // OS · Electron
}

export interface BuiltRequest {
  fileName: string;
  markdown: string;
  maskedCount: number;
  maskedKinds: string[];
  imageCount: number;
  sizeBytes: number;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 서버 코드 시점 — 개발자가 "그건 지난 버전 버그"를 즉시 판별하는 데 쓴다. */
function serverRev(): string {
  try {
    // 배포는 소스 동기화 방식이라 .git이 없을 수 있다 — 없으면 없다고 적는다(정직 규칙).
    const { execFileSync } = require("child_process") as typeof import("child_process");
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    return "(확인 불가)";
  }
}

/** 최근 오류 몇 줄 — 조용한 고장을 드러낸다. 담당자가 못 보는 것을 개발자는 봐야 한다. */
function recentErrors(n = 5): string[] {
  try {
    return listLogs()
      .filter((l) => l.level === "error" || l.level === "warn")
      .slice(-n)
      .map((l) => `${new Date(l.timestamp).toLocaleString("ko-KR")} [${l.level}] ${String(l.message).slice(0, 160)}`);
  } catch {
    return [];
  }
}

export function buildRequestDocument(input: BuildRequestInput, actor: string | null): BuiltRequest {
  const kind = (KIND_LABEL[input.kind] ? input.kind : "etc") as RequestKind;
  const title = (input.title || "").trim() || "(제목 없음)";

  // 자격증명 마스킹 — 사람이 쓴 부분에만 적용한다(이미지는 손대지 못한다).
  const tried = maskSecrets(input.tried || "");
  const happened = maskSecrets(input.happened || "");
  const titleMasked = maskSecrets(title);
  const maskedHits = [...titleMasked.hits, ...tried.hits, ...happened.hits];
  const maskedKinds = [...new Set(maskedHits.map((h) => h.kind))];

  const images = (input.images || []).filter((s) => typeof s === "string" && s.startsWith("data:image/"));
  const 시각 = new Date();

  const 자동정보 = [
    `| 항목 | 값 |`,
    `|---|---|`,
    `| 유형 | ${KIND_LABEL[kind]} |`,
    `| 직전 화면 | ${input.screen || "(알 수 없음)"} |`,
    `| 클라 버전 | ${input.clientVersion || "(알 수 없음)"} |`,
    `| 서버 커밋 | ${serverRev()} |`,
    `| 발생 시각 | ${시각.toLocaleString("ko-KR")} |`,
    `| 보낸 사람 | ${actor || "(알 수 없음)"} |`,
    `| 환경 | ${input.platform || "(알 수 없음)"} |`,
  ].join("\n");

  const 오류 = recentErrors();
  const 진단 = (() => {
    try {
      return systemHealthText().split("\n").slice(0, 8).join("\n");
    } catch {
      return "(자가 진단을 수집하지 못했습니다)";
    }
  })();

  const md = [
    `# [${KIND_LABEL[kind]}] ${titleMasked.text}`,
    ``,
    자동정보,
    ``,
    `## 무엇을 하려 했나`,
    ``,
    tried.text || "(적지 않음)",
    ``,
    `## 무슨 일이 일어났나`,
    ``,
    happened.text || "(적지 않음)",
    ``,
    ...(images.length
      ? images.flatMap((src, i) => [``, `![캡처${i + 1}](${src})`, ``])
      : [`(첨부한 화면 캡처 없음)`, ``]),
    `## 자동 수집 정보`,
    ``,
    `**최근 오류·경고**`,
    ``,
    ...(오류.length ? 오류.map((l) => `- ${l}`) : ["- (없음)"]),
    ``,
    `**자가 진단**`,
    ``,
    "```",
    진단,
    "```",
    ``,
    `---`,
    ``,
    ...(maskedHits.length
      ? [
          `> ⚠ 이 문서에서 자격증명 ${maskedHits.length}곳을 가렸습니다(${maskedKinds.join("·")}).`,
          `> 원래 값은 담기지 않았습니다.`,
          ``,
        ]
      : []),
    ...(images.length
      ? [
          `> ⚠ **화면 캡처 속 내용은 자동으로 가릴 수 없습니다.** 자산명·IP·담당자 이름이 찍혔는지`,
          `> 보내시기 전에 직접 확인해 주세요.`,
          ``,
        ]
      : []),
    `*GIJO AS 문서함에서 만들었습니다. 이 파일을 개발팀에 전달해 주세요.*`,
  ].join("\n");

  const fileName = `GIJO요청_${KIND_LABEL[kind]}_${stamp(시각)}.md`;
  return {
    fileName,
    markdown: md,
    maskedCount: maskedHits.length,
    maskedKinds,
    imageCount: images.length,
    sizeBytes: Buffer.byteLength(md, "utf8"),
  };
}

const insertStmt = db.prepare(
  `INSERT INTO doc_requests (id, at, kind, title, actor, screen, clientVersion, imageCount, maskedCount, fileName)
   VALUES (@id, @at, @kind, @title, @actor, @screen, @clientVersion, @imageCount, @maskedCount, @fileName)`
);

export interface DocRequestRow {
  id: string;
  at: number;
  kind: string;
  title: string;
  actor: string | null;
  screen: string | null;
  clientVersion: string | null;
  imageCount: number;
  maskedCount: number;
  fileName: string;
}

/** 원장에는 **본문·이미지를 담지 않는다** — "무엇을 언제 요청했나"만 남기면 충분하고,
 *  본문을 DB에 쌓으면 자격증명·스크린샷이 또 하나의 사본으로 남는다. */
export function listDocRequests(limit = 100): DocRequestRow[] {
  return db.prepare("SELECT * FROM doc_requests ORDER BY at DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 500)) as DocRequestRow[];
}

export function resetDocRequestsForTests(): void {
  db.exec("DELETE FROM doc_requests");
}

export function registerDocRequestRoutes(app: Express): void {
  app.post(
    "/api/docbox/request",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const user = (req as Request & { user?: GijoUser }).user;
      const body = req.body as Partial<BuildRequestInput>;
      if (!body?.title || !String(body.title).trim()) {
        res.status(400).json({ error: "제목이 필요합니다" });
        return;
      }
      const built = buildRequestDocument(
        {
          kind: (body.kind ?? "etc") as RequestKind,
          title: String(body.title),
          tried: String(body.tried ?? ""),
          happened: String(body.happened ?? ""),
          images: Array.isArray(body.images) ? body.images.slice(0, 10) : [],
          screen: body.screen ? String(body.screen) : undefined,
          clientVersion: body.clientVersion ? String(body.clientVersion) : undefined,
          platform: body.platform ? String(body.platform) : undefined,
        },
        user?.displayName ?? null
      );

      // 원장 — "지난달에 뭘 요청했지"를 볼 수 있게(사용자 결정 2026-07-30 ⑥).
      try {
        insertStmt.run({
          id: `req-${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          at: Date.now(),
          kind: body.kind ?? "etc",
          title: String(body.title).slice(0, 200),
          actor: user?.displayName ?? null,
          screen: body.screen ? String(body.screen) : null,
          clientVersion: body.clientVersion ? String(body.clientVersion) : null,
          imageCount: built.imageCount,
          maskedCount: built.maskedCount,
          fileName: built.fileName,
        });
      } catch {
        /* 원장 실패가 문서 생성을 막지 않는다 */
      }
      recordAudit({
        kind: "write",
        actor: user?.displayName ?? null,
        action: `제품 요청 문서 생성 — ${KIND_LABEL[(body.kind ?? "etc") as RequestKind]}`,
        target: built.fileName,
        detail: `첨부 ${built.imageCount}장 · 가림 ${built.maskedCount}곳`,
        result: "ok",
      });
      res.json(built);
    })
  );

  app.get(
    "/api/docbox/requests",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json({ requests: listDocRequests() });
    })
  );
}
