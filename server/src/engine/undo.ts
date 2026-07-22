// engine/undo.ts — #7 결재판 원클릭 undo.
// 쓰기 승인 실행을 통째로 되돌린다. 도구별 특수 로직 대신 범용 방식: 실행 전/후의 상태(검토대장 +
// 자산 목록)를 스냅샷해 차이를 계산하고, 그 차이를 역적용한다. 어떤 쓰기 도구든(단건·일괄) 동작한다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { listFindingReviews, updateFindingReview } from "./approvals";
import { listAssets, deleteAsset } from "./assets";

interface ReviewState { status: string; assignee: string; dueDate: string; note: string }
interface Snapshot { reviews: Map<string, ReviewState>; assetIds: Set<string> }

interface UndoEntry {
  id: string;
  at: number;
  tool: string;
  label: string;
  // 되돌리기 위한 역연산
  restoreReviews: { assetId: string; key: string; prior: ReviewState }[]; // 변경된 검토 행 → 이전 값으로 복원
  deleteAssets: string[]; // 새로 생긴 자산 → 삭제
}

const undoStack: UndoEntry[] = [];
const MAX_UNDO = 20;

function reviewKey(assetId: string, key: string): string {
  return `${assetId}::${key}`;
}

function snapshotReviews(): Map<string, ReviewState> {
  const m = new Map<string, ReviewState>();
  for (const r of listFindingReviews()) {
    m.set(reviewKey(r.assetId, r.findingKey), {
      status: r.status,
      assignee: r.assignee ?? "",
      dueDate: r.dueDate ?? "",
      note: r.note ?? "",
    });
  }
  return m;
}

const DEFAULT_STATE: ReviewState = { status: "pending", assignee: "", dueDate: "", note: "" };
function sameState(a: ReviewState, b: ReviewState): boolean {
  return a.status === b.status && a.assignee === b.assignee && a.dueDate === b.dueDate && a.note === b.note;
}

// 승인 실행 직전에 호출 — 현재 상태를 담아둔다.
export function undoSnapshot(): Snapshot {
  return { reviews: snapshotReviews(), assetIds: new Set(listAssets().map((a) => a.id)) };
}

// 승인 실행 직후에 호출 — 차이를 계산해 undo 항목을 쌓고 id를 돌려준다. 변화가 없으면 null.
export function undoCommit(tool: string, label: string, before: Snapshot): string | null {
  const after = snapshotReviews();
  const restoreReviews: UndoEntry["restoreReviews"] = [];
  // 변경·신규된 검토 행: 이전 값(없었으면 기본값)으로 복원 대상에 담는다.
  for (const [k, cur] of after) {
    const prior = before.reviews.get(k) ?? DEFAULT_STATE;
    if (!sameState(prior, cur)) {
      const [assetId, key] = k.split("::");
      restoreReviews.push({ assetId, key, prior });
    }
  }
  const deleteAssets = listAssets().map((a) => a.id).filter((id) => !before.assetIds.has(id));

  if (restoreReviews.length === 0 && deleteAssets.length === 0) return null; // 되돌릴 것 없음
  const entry: UndoEntry = { id: `undo-${Date.now()}`, at: Date.now(), tool, label, restoreReviews, deleteAssets };
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  return entry.id;
}

// 가장 최근(또는 지정 id) undo를 실행한다.
export function performUndo(id?: string): { ok: boolean; message: string } {
  const idx = id ? undoStack.findIndex((e) => e.id === id) : undoStack.length - 1;
  if (idx < 0) return { ok: false, message: "되돌릴 작업이 없습니다." };
  const entry = undoStack.splice(idx, 1)[0];
  for (const r of entry.restoreReviews) {
    updateFindingReview(r.assetId, r.key, { status: r.prior.status as import("./approvals").ApprovalStatus, assignee: r.prior.assignee, dueDate: r.prior.dueDate, note: r.prior.note }, "undo");
  }
  for (const assetId of entry.deleteAssets) deleteAsset(assetId);
  const parts = [
    entry.restoreReviews.length ? `취약점 검토 ${entry.restoreReviews.length}건 원복` : "",
    entry.deleteAssets.length ? `자산 ${entry.deleteAssets.length}건 삭제` : "",
  ].filter(Boolean);
  return { ok: true, message: `"${entry.label}" 되돌림 — ${parts.join(", ")}.` };
}

export function lastUndoLabel(): string | null {
  return undoStack.length ? undoStack[undoStack.length - 1].label : null;
}

export function resetUndoForTests(): void {
  undoStack.length = 0;
}

export function registerUndoRoutes(app: Express): void {
  app.post("/api/agent/undo", authMiddleware, (req, res) => {
    res.json(performUndo(req.body?.id));
  });
  app.get("/api/agent/undo/last", authMiddleware, (_req, res) => res.json({ label: lastUndoLabel() }));
}
