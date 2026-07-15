// engine/cti.ts — 딥웹 · 다크웹 CTI 피드 연동 (6.1.1절)
// LLM이 직접 다크웹을 크롤링하지 않고, 라이선스 CTI 벤더 API만 호출한다.
// 벤더 API 키는 cryptopack.ts(AES-256-GCM)로 암호화된 상태로만 SQLite(db.ts)에 저장한다 —
// cryptopack.ts에 남아있던 "키 관리 정책 결정 후 사용처에 연결" TODO의 첫 실사용처.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import { encryptString, decryptString, getEncryptionKey } from "./cryptopack";

// 클라이언트에는 원본 키를 절대 내려주지 않는다 — 등록 여부만 노출.
export interface CtiFeedPublic {
  id: string;
  name: string;
  hasApiKey: boolean;
  connected: boolean;
  planned?: boolean; // 지원 예정 벤더 — 키 설정 불가, UI에는 로드맵 안내용으로만 노출
}

export interface CtiFinding {
  id: string;
  detectedAt: string;
  type: string;
  target: string;
  source: string;
  severity: "info" | "warning" | "critical";
}

interface CtiFeedRow {
  id: string;
  name: string;
  encryptedApiKey: string | null;
  connected: number;
}

const SEED_FEEDS: { id: string; name: string }[] = [
  { id: "criminalip", name: "Criminal IP" },
  { id: "flashpoint", name: "Flashpoint" },
  { id: "spycloud", name: "SpyCloud" },
  { id: "recordedfuture", name: "Recorded Future" },
];

// 지원 예정 벤더 — DB에 시드하지 않고 코드에만 둔다. 실제 연동을 구현하는 날 SEED_FEEDS로
// 옮기면 그때부터 키 설정이 열린다. threat.html의 가짜 데이터를 지운 것과 같은 원칙:
// "지원할 계획"이라는 사실만 노출하고, 동작하는 척은 하지 않는다.
// C-TAS는 키가 3종(expKey/colKey/orgCode)이라 연동 시 저장 형식 확장도 함께 필요하다.
const PLANNED_FEEDS: { id: string; name: string }[] = [
  { id: "kisa-ctas", name: "KISA C-TAS (공유형)" },
  { id: "levelblue-otx", name: "LevelBlue OTX" },
];

export function isPlannedFeed(feedId: string): boolean {
  return PLANNED_FEEDS.some((f) => f.id === feedId);
}

const seedStmt = db.prepare("INSERT OR IGNORE INTO cti_feeds (id, name, encryptedApiKey, connected) VALUES (?, ?, NULL, 0)");
function seedFeeds(): void {
  for (const feed of SEED_FEEDS) seedStmt.run(feed.id, feed.name);
}
seedFeeds();

const listStmt = db.prepare("SELECT * FROM cti_feeds");
const getStmt = db.prepare("SELECT * FROM cti_feeds WHERE id = ?");
const updateStmt = db.prepare("UPDATE cti_feeds SET encryptedApiKey = ?, connected = ? WHERE id = ?");

function toPublic(row: CtiFeedRow): CtiFeedPublic {
  return { id: row.id, name: row.name, hasApiKey: row.encryptedApiKey !== null, connected: row.connected === 1 };
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetFeedsForTests(): void {
  db.exec("DELETE FROM cti_feeds");
  seedFeeds();
}

export function listFeeds(): CtiFeedPublic[] {
  const real = (listStmt.all() as CtiFeedRow[]).map(toPublic);
  const planned = PLANNED_FEEDS.map((f) => ({
    id: f.id,
    name: f.name,
    hasApiKey: false,
    connected: false,
    planned: true,
  }));
  return [...real, ...planned];
}

export function configureFeed(feedId: string, apiKey: string): CtiFeedPublic {
  const row = getStmt.get(feedId) as CtiFeedRow | undefined;
  if (!row) throw new Error(`unknown CTI feed: ${feedId}`);

  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    updateStmt.run(null, 0, feedId);
  } else {
    updateStmt.run(encryptString(trimmed, getEncryptionKey()), 1, feedId);
  }
  return toPublic(getStmt.get(feedId) as CtiFeedRow);
}

export function disconnectFeed(feedId: string): CtiFeedPublic {
  return configureFeed(feedId, "");
}

// 벤더 API 호출용 — 라우트로는 노출하지 않는다(원본 키가 응답에 실리면 안 되므로).
// listFindings()가 실제로 벤더 API를 호출하도록 구현될 때(아래 TODO) 여기서 복호화한 키를
// Authorization 헤더 등에 사용한다.
export function getDecryptedApiKey(feedId: string): string | undefined {
  const row = getStmt.get(feedId) as CtiFeedRow | undefined;
  if (!row?.encryptedApiKey) return undefined;
  return decryptString(row.encryptedApiKey, getEncryptionKey());
}

export async function listFindings(): Promise<CtiFinding[]> {
  // TODO: 연결된(connected=true) 각 피드의 REST API를 getDecryptedApiKey(feed.id)로 호출해 최근 탐지 내역 취합.
  // API 키 입력 화면(6.1.1절)이 이 함수가 실제로 호출할 대상을 채워주는 역할이며,
  // 벤더별 HTTP 클라이언트 구현은 계약 체결 후 벤더 스펙에 맞춰 추가한다.
  return [];
}

export function registerCtiRoutes(app: Express): void {
  app.get("/api/cti/feeds", authMiddleware, (_req, res) => res.json(listFeeds()));
  app.post("/api/cti/feeds/:id/configure", authMiddleware, (req, res) => {
    if (isPlannedFeed(String(req.params.id))) {
      res.status(400).json({ error: "지원 예정 벤더입니다 — 아직 키를 설정할 수 없습니다" });
      return;
    }
    try {
      res.json(configureFeed(String(req.params.id), String(req.body.apiKey ?? "")));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.post("/api/cti/feeds/:id/disconnect", authMiddleware, (req, res) => {
    try {
      res.json(disconnectFeed(String(req.params.id)));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.get(
    "/api/cti/findings",
    authMiddleware,
    asyncRoute(async (_req, res) => res.json(await listFindings()))
  );
}
