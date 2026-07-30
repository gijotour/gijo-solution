// engine/progress.ts — 명령 처리 진행 상태. (사용자 요청 2026-07-30: "진행사항을 %나 진행 바로")
//
// 정직 원칙(시안 승인 때 확정):
//   ① 단계는 파이프라인이 **실제로 지나는 것**만 기록한다 — understand(지시 확인) →
//      tools(근거·도구) → write(답변 작성) → review(검수). 지어낸 단계·가짜 % 금지.
//   ② %는 셀 수 있는 것에만 붙인다(도구 n번째, 큰 단계 n/m, 일괄 처리 n/m건).
//      LLM 작성처럼 끝을 모르는 단계는 % 없이 보낸다 — 클라가 물결로 그린다.
//   ③ 진행 기록이 본 작업을 느리게 하거나 깨뜨리면 안 된다 — 전부 동기 Map 쓰기,
//      실패는 조용히 삼킨다. 진행 id가 없으면(내부 호출·QA) 전부 무동작이다.
//
// 구조: 클라가 지시마다 progressId(UUID)를 만들어 보내고, 처리 중 0.7초마다 GET으로 조회한다.
// 파이프라인 깊은 곳(agentloop 등)까지 id를 인자로 끌고 다니지 않도록 AsyncLocalStorage를 쓴다
// — dispatch 라우트가 runWithProgress()로 감싸면 그 안의 모든 await 체인에서 reportProgress()가
// 자기 id를 찾는다.
import type { Express, Request } from "express";
import { AsyncLocalStorage } from "async_hooks";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";

export type ProgressStage = "understand" | "tools" | "write" | "review";

export interface ProgressState {
  stage: ProgressStage;
  /** 지금 무엇을 하는지 사람 말로 — 예: "취약점 검색 실행 중". 지시 원문은 넣지 않는다(남의 조회 대비). */
  detail: string;
  /** 셀 수 있을 때만: 도구 몇 번째, 일괄 n/m건. */
  count?: { done: number; total: number; unit: string };
  /** 복합 지시(오케스트레이션)의 큰 단계 n/m. */
  bigStep?: { index: number; total: number; label: string };
  startedAt: number;
  updatedAt: number;
}

interface Entry extends ProgressState {
  /** 조회 권한 — 지시를 보낸 그 계정만 본다(진행 상세도 남의 업무 정보다). */
  actorId: string | null;
}

const store = new AsyncLocalStorage<string>();
const entries = new Map<string, Entry>();

// 오래된 항목 정리 — 처리가 끝나면 라우트가 지우지만, 크래시·중단으로 남는 것을 5분 후 청소.
const TTL_MS = 5 * 60_000;
let sweepTimer: NodeJS.Timeout | null = null;
function ensureSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cut = Date.now() - TTL_MS;
    for (const [id, e] of entries) if (e.updatedAt < cut) entries.delete(id);
  }, 60_000);
  sweepTimer.unref?.();
}

const ID_RE = /^[A-Za-z0-9-]{8,64}$/; // 클라가 만드는 UUID — 형식만 좁혀 받는다

export function isValidProgressId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/** dispatch 라우트가 처리 전체를 이걸로 감싼다. id가 없으면 그냥 실행(무동작). */
export async function runWithProgress<T>(id: string | null, actorId: string | null, fn: () => Promise<T>): Promise<T> {
  if (!id) return fn();
  ensureSweeper();
  entries.set(id, {
    stage: "understand",
    detail: "지시를 읽고 처리 경로를 정하고 있습니다",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    actorId,
  });
  try {
    return await store.run(id, fn);
  } finally {
    // 응답이 나가면 클라는 폴링을 멈춘다 — 즉시 지워 다음 지시와 섞이지 않게 한다.
    entries.delete(id);
  }
}

/** 파이프라인 어디서든 부른다. 진행 문맥이 없으면(내부 호출·QA·테스트) 조용히 무동작. */
export function reportProgress(
  stage: ProgressStage,
  detail: string,
  extra?: { count?: ProgressState["count"]; bigStep?: ProgressState["bigStep"] }
): void {
  try {
    const id = store.getStore();
    if (!id) return;
    const e = entries.get(id);
    if (!e) return;
    e.stage = stage;
    e.detail = detail.slice(0, 200);
    e.updatedAt = Date.now();
    // count/bigStep은 명시로만 갱신·유지 — 단계가 바뀌면 지난 카운트는 지운다(헌 숫자가 남지 않게).
    e.count = extra?.count;
    if (extra?.bigStep) e.bigStep = extra.bigStep; // 큰 단계는 다음 큰 단계까지 유지
    entries.set(id, e);
  } catch {
    /* 진행 기록 실패가 본 작업을 막지 않는다 */
  }
}

/** 큰 단계(오케스트레이션) 시작을 알린다 — 이후 reportProgress들에 그대로 실려 나간다. */
export function reportBigStep(index: number, total: number, label: string): void {
  reportProgress("tools", label, { bigStep: { index, total, label: label.slice(0, 80) } });
}

export function getProgress(id: string, actorId: string | null): ProgressState | null {
  const e = entries.get(id);
  if (!e) return null;
  if (e.actorId !== actorId) return null; // 남의 진행은 없다고 답한다(존재 여부도 안 알린다)
  const { actorId: _drop, ...state } = e;
  return state;
}

// 테스트 전용.
export function resetProgressForTests(): void {
  entries.clear();
}

export function registerProgressRoutes(app: Express): void {
  // 폴링 전용 — 가볍고 자주 불린다. 진행이 없으면 {running:false}만 준다
  // (끝났는지 애초에 없었는지 구분해 주지 않는다 — id 추측으로 존재를 캐지 못하게).
  app.get("/api/dispatch/progress", authMiddleware, (req, res) => {
    const id = req.query.id;
    const user = (req as Request & { user?: GijoUser }).user;
    if (!isValidProgressId(id)) {
      res.status(400).json({ error: "progressId가 필요합니다" });
      return;
    }
    const state = getProgress(id, user?.id ?? null);
    res.json(state ? { running: true, ...state } : { running: false });
  });
}
