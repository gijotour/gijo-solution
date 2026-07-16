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
  { id: "levelblue-otx", name: "LevelBlue OTX" },
];

// 지원 예정 벤더 — DB에 시드하지 않고 코드에만 둔다. 실제 연동을 구현하는 날 SEED_FEEDS로
// 옮기면 그때부터 키 설정이 열린다. threat.html의 가짜 데이터를 지운 것과 같은 원칙:
// "지원할 계획"이라는 사실만 노출하고, 동작하는 척은 하지 않는다.
// C-TAS는 키가 3종(expKey/colKey/orgCode)이라 연동 시 저장 형식 확장도 함께 필요하다.
const PLANNED_FEEDS: { id: string; name: string }[] = [
  { id: "kisa-ctas", name: "KISA C-TAS (공유형)" },
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
  db.exec("DELETE FROM cti_feeds; DELETE FROM cti_findings; DELETE FROM cti_sync");
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

// ── 탐지 내역 수집 (다음단계 가이드 3.1) ─────────────────────────────────────
// 요청마다 벤더 API를 때리지 않는다: 피드별 30분 게이트로 동기화하고 결과를 cti_findings에
// 캐시한다. 벤더 API가 죽어 있으면 캐시를 그대로 반환한다(경량 서킷 브레이커 — 별도 상태
// 머신 없이 "실패해도 응답은 나간다"까지만). 90일 지난 캐시는 TTL로 정리.

const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const FINDINGS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const FINDINGS_LIMIT = 100;

const pruneFindingsStmt = db.prepare("DELETE FROM cti_findings WHERE collectedAt < ?");
const deleteFeedFindingsStmt = db.prepare("DELETE FROM cti_findings WHERE feedId = ?");
const insertFindingStmt = db.prepare(
  "INSERT OR REPLACE INTO cti_findings (id, feedId, detectedAt, type, target, source, severity, collectedAt) VALUES (@id, @feedId, @detectedAt, @type, @target, @source, @severity, @collectedAt)"
);
const listFindingsStmt = db.prepare("SELECT * FROM cti_findings ORDER BY detectedAt DESC LIMIT ?");
const getSyncStmt = db.prepare("SELECT * FROM cti_sync WHERE feedId = ?");
const upsertSyncStmt = db.prepare(
  "INSERT INTO cti_sync (feedId, lastFetchAt, lastError) VALUES (@feedId, @lastFetchAt, @lastError) ON CONFLICT(feedId) DO UPDATE SET lastFetchAt = excluded.lastFetchAt, lastError = excluded.lastError"
);

interface OtxPulse {
  id: string;
  name: string;
  created?: string;
  modified?: string;
  adversary?: string;
}

// OTX Pulse에는 심각도 개념이 없으므로 전부 info로 둔다 — 없는 정보를 지어내지 않는다.
async function fetchOtxFindings(apiKey: string): Promise<CtiFinding[]> {
  const res = await fetch("https://otx.alienvault.com/api/v1/pulses/subscribed?limit=50", {
    headers: { "X-OTX-API-KEY": apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OTX API ${res.status}`);
  const body = (await res.json()) as { results?: OtxPulse[] };
  return (body.results ?? []).map((p) => ({
    id: `otx-${p.id}`,
    detectedAt: (p.modified ?? p.created ?? "").slice(0, 16).replace("T", " "),
    type: p.adversary ? `위협 캠페인 · ${p.adversary}` : "위협 인텔 Pulse",
    target: p.name,
    source: "LevelBlue OTX",
    severity: "info" as const,
  }));
}

// 피드 id → 수집 어댑터. 새 벤더 연동 = 여기에 한 줄 + 어댑터 함수 하나.
const FEED_ADAPTERS: Record<string, (apiKey: string) => Promise<CtiFinding[]>> = {
  "levelblue-otx": fetchOtxFindings,
};

async function syncFeedIfStale(feedId: string, now: number): Promise<void> {
  const adapter = FEED_ADAPTERS[feedId];
  if (!adapter) return; // 어댑터 없는 벤더(상용 계약 대기)는 키가 등록돼 있어도 수집하지 않는다
  const sync = getSyncStmt.get(feedId) as { lastFetchAt: number } | undefined;
  if (sync && now - sync.lastFetchAt < SYNC_INTERVAL_MS) return;
  const apiKey = getDecryptedApiKey(feedId);
  if (!apiKey) return;
  try {
    const findings = await adapter(apiKey);
    const replaceAll = db.transaction((rows: CtiFinding[]) => {
      deleteFeedFindingsStmt.run(feedId);
      for (const f of rows) insertFindingStmt.run({ ...f, feedId, collectedAt: now });
      upsertSyncStmt.run({ feedId, lastFetchAt: now, lastError: null });
    });
    replaceAll(findings);
  } catch (err) {
    // 실패해도 던지지 않는다 — 캐시된 내역이 그대로 응답이 된다. 다음 요청에서 재시도.
    upsertSyncStmt.run({ feedId, lastFetchAt: now, lastError: err instanceof Error ? err.message : String(err) });
  }
}

export async function listFindings(): Promise<CtiFinding[]> {
  const now = Date.now();
  pruneFindingsStmt.run(now - FINDINGS_TTL_MS);
  const connected = (listStmt.all() as CtiFeedRow[]).filter((r) => r.connected === 1);
  await Promise.all(connected.map((r) => syncFeedIfStale(r.id, now)));
  return (listFindingsStmt.all(FINDINGS_LIMIT) as (CtiFinding & { feedId: string; collectedAt: number })[]).map(
    ({ id, detectedAt, type, target, source, severity }) => ({ id, detectedAt, type, target, source, severity })
  );
}

// 최초 기동 시(탐지 내역이 비어 있을 때) 샘플 CTI finding을 시드한다 — 시드된 샘플 AI 자산
// (assets.ts)의 컴포넌트와 매칭되도록 target을 구성해, 벤더 키 없이도 "CTI↔자산 매칭"을 바로
// 시연할 수 있게 한다. source를 "샘플(데모)"로 명확히 표기한다(가짜 벤더 데이터로 오인 방지).
const countFindingsStmt = db.prepare("SELECT COUNT(*) AS n FROM cti_findings");
function seedSampleFindingsIfEmpty(): void {
  if ((countFindingsStmt.get() as { n: number }).n > 0) return;
  const now = Date.now();
  const when = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString().slice(0, 16).replace("T", " ");
  const samples: Omit<CtiFinding, "id">[] = [
    { detectedAt: when(0), type: "위협 캠페인 · 공급망", target: "Qwen2.5 오픈웨이트 모델 가중치 변조 공급망 위협 정황", source: "샘플(데모)", severity: "warning" },
    { detectedAt: when(1), type: "악성 패키지", target: "bge-m3 임베딩 모델 배포 패키지에 악성코드 삽입 사례 보고", source: "샘플(데모)", severity: "critical" },
    { detectedAt: when(2), type: "프롬프트 인젝션", target: "KoBERT 기반 한국어 분류 모델 대상 프롬프트 인젝션 캠페인", source: "샘플(데모)", severity: "warning" },
    { detectedAt: when(3), type: "우회 기법 PoC", target: "IsolationForest 이상탐지 우회(evasion) 기법 PoC 공개", source: "샘플(데모)", severity: "info" },
    { detectedAt: when(4), type: "자격증명 유출", target: "다크웹서 유출 계정 자격증명 판매 게시글 (금융권 포털)", source: "샘플(데모)", severity: "info" },
  ];
  samples.forEach((s, i) => insertFindingStmt.run({ ...s, id: `sample-cti-${i}`, feedId: "sample", collectedAt: now }));
}
seedSampleFindingsIfEmpty();

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
