// engine/cti.ts — 딥웹 · 다크웹 CTI 피드 연동 (6.1.1절)
// LLM이 직접 다크웹을 크롤링하지 않고, 라이선스 CTI 벤더 API만 호출한다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

export interface CtiFeedConfig {
  id: string;
  name: string;
  apiKey: string;
  connected: boolean;
}

// 클라이언트에는 원본 키를 절대 내려주지 않는다 — 등록 여부만 노출.
export interface CtiFeedPublic {
  id: string;
  name: string;
  hasApiKey: boolean;
  connected: boolean;
}

export interface CtiFinding {
  id: string;
  detectedAt: string;
  type: string;
  target: string;
  source: string;
  severity: "info" | "warning" | "critical";
}

// TODO: sqlite 등으로 영속화하고, 원본 키는 평문 대신 OS 자격 증명 저장소/봉투 암호화로 보관할 것.
const feeds: CtiFeedConfig[] = [
  { id: "criminalip", name: "Criminal IP", apiKey: "", connected: false },
  { id: "flashpoint", name: "Flashpoint", apiKey: "", connected: false },
  { id: "spycloud", name: "SpyCloud", apiKey: "", connected: false },
  { id: "recordedfuture", name: "Recorded Future", apiKey: "", connected: false },
];

// 테스트 전용: feeds는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetFeedsForTests(): void {
  for (const feed of feeds) {
    feed.apiKey = "";
    feed.connected = false;
  }
}

function toPublic(feed: CtiFeedConfig): CtiFeedPublic {
  return { id: feed.id, name: feed.name, hasApiKey: feed.apiKey.length > 0, connected: feed.connected };
}

export function listFeeds(): CtiFeedPublic[] {
  return feeds.map(toPublic);
}

export function configureFeed(feedId: string, apiKey: string): CtiFeedPublic {
  const feed = feeds.find((f) => f.id === feedId);
  if (!feed) throw new Error(`unknown CTI feed: ${feedId}`);
  feed.apiKey = apiKey.trim();
  feed.connected = feed.apiKey.length > 0;
  return toPublic(feed);
}

export function disconnectFeed(feedId: string): CtiFeedPublic {
  return configureFeed(feedId, "");
}

export async function listFindings(): Promise<CtiFinding[]> {
  // TODO: 연결된(connected=true) 각 피드의 REST API를 feed.apiKey로 호출해 최근 탐지 내역 취합.
  // API 키 입력 화면(6.1.1절)이 이 함수가 실제로 호출할 대상을 채워주는 역할이며,
  // 벤더별 HTTP 클라이언트 구현은 계약 체결 후 벤더 스펙에 맞춰 추가한다.
  return [];
}

export function registerCtiRoutes(app: Express): void {
  app.get("/api/cti/feeds", authMiddleware, (_req, res) => res.json(listFeeds()));
  app.post("/api/cti/feeds/:id/configure", authMiddleware, (req, res) => {
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
