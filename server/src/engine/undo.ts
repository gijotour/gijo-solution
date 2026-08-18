// engine/undo.ts — #7 결재판 원클릭 undo.
// 쓰기 승인 실행을 통째로 되돌린다. 도구별 특수 로직 대신 범용 방식: 실행 전/후의 상태(검토대장 +
// 자산 목록)를 스냅샷해 차이를 계산하고, 그 차이를 역적용한다. 어떤 쓰기 도구든(단건·일괄) 동작한다.

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { listFindingReviews, updateFindingReview } from "./approvals";
import { listAssets, deleteAsset } from "./assets";
import { recordAudit } from "./audit";

interface ReviewState { status: string; assignee: string; dueDate: string; note: string }
interface Snapshot {
  reviews: Map<string, ReviewState>;
  assetIds: Set<string>;
  /**
   * 스냅샷을 뜬 시각 — **되돌릴 자산을 이 시각 이후 것으로 좁히는 데 쓴다**(2026-08-19).
   *
   * ⚠ 왜 필요한가: `deleteAssets`가 「실행 전후 자산 목록의 차집합」이라, 도구가 도는 동안
   *   **다른 담당자가 만든 자산까지** 삭제 대상에 섞였다. 자산 등록 통로가 여럿이라
   *   (`/api/assets` · `/api/assets/import` · 스캔 인입) 실제로 겹칠 수 있고,
   *   `run_redteam`처럼 수 분 걸리는 쓰기 도구가 있어 창이 짧지도 않다.
   *   자산에 「만든이」가 없어 사람으로는 못 가리므로, 최소한 **시각으로 좁힌다.**
   */
  at: number;
}

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
  return { reviews: snapshotReviews(), assetIds: new Set(listAssets().map((a) => a.id)), at: Date.now() };
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
  // ⚠ **차집합만으로는 남의 자산까지 잡는다**(2026-08-19 검증). 도구가 도는 동안 다른 통로로
  //   (`/api/assets` · import · 스캔 인입) 들어온 자산이 그대로 삭제 대상이 된다.
  //   자산에 「만든이」가 없어 사람으로는 못 가리므로 **등록 시각**으로 한 겹 더 좁힌다:
  //   스냅샷을 뜬 뒤에 만들어진 것만 후보다. 완전히 막지는 못하지만(같은 창에 들어오면 걸린다)
  //   창이 좁아지고, 아래 감사 기록과 화면 확인이 나머지를 받는다.
  const deleteAssets = listAssets()
    .filter((a) => !before.assetIds.has(a.id) && a.registeredAt >= before.at)
    .map((a) => a.id);

  if (restoreReviews.length === 0 && deleteAssets.length === 0) return null; // 되돌릴 것 없음
  const entry: UndoEntry = { id: `undo-${Date.now()}`, at: Date.now(), tool, label, restoreReviews, deleteAssets };
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  return entry.id;
}

// 가장 최근(또는 지정 id) undo를 실행한다.
export function performUndo(id?: string, actor?: string): { ok: boolean; message: string } {
  const idx = id ? undoStack.findIndex((e) => e.id === id) : undoStack.length - 1;
  if (idx < 0) return { ok: false, message: "되돌릴 작업이 없습니다." };
  const entry = undoStack.splice(idx, 1)[0];
  for (const r of entry.restoreReviews) {
    updateFindingReview(r.assetId, r.key, { status: r.prior.status as import("./approvals").ApprovalStatus, assignee: r.prior.assignee, dueDate: r.prior.dueDate, note: r.prior.note }, "undo");
  }
  // ⚠ **지우기 전에 이름을 읽어 둔다.** 지운 뒤에는 못 읽는다(하드 삭제라 행이 사라진다) —
  //   그러면 감사에 내부 id만 남아 「무엇을 지웠나」를 영영 못 읽는다.
  const 지울것 = entry.deleteAssets.map((id) => {
    const a = listAssets().find((x) => x.id === id);
    return { id, name: a ? a.name : id };
  });
  for (const assetId of entry.deleteAssets) deleteAsset(assetId);
  const parts = [
    entry.restoreReviews.length ? `취약점 검토 ${entry.restoreReviews.length}건 원복` : "",
    entry.deleteAssets.length ? `자산 ${entry.deleteAssets.length}건 삭제` : "",
  ].filter(Boolean);
  // ★ 되돌리기를 **감사에 남긴다**(2026-08-19). 이 줄이 없던 것이 실제 구멍이었다:
  //   같은 삭제를 하는 `DELETE /api/assets/:id`는 남기는데(assets.ts) undo 경로만 우회했다.
  //   그래서 감사만 보면 **자산이 아직 살아 있는 것으로 읽혔다** — 등록은 남고 삭제는 안 남으니.
  //   ⚠ 자산 삭제는 scan_runs·finding_approvals까지 하드 삭제라 **되돌릴 수 없다.**
  //     되돌릴 수 없는 일일수록 기록이 유일한 흔적이다.
  try {
    recordAudit({
      kind: "write",
      actor: actor ?? null,
      action: "되돌리기 실행",
      target: 지울것.length ? 지울것.map((x) => `${x.name}(${x.id})`).join(", ").slice(0, 200) : entry.label,
      detail:
        `도구 ${entry.tool} — ${parts.join(", ") || "변경 없음"}` +
        (지울것.length ? " · ⚠ 자산 삭제는 스캔 이력·검토 기록까지 함께 지워지며 되돌릴 수 없습니다" : ""),
      result: "ok",
    });
  } catch { /* 감사 실패가 되돌리기 자체를 막지 않는다 — 그래도 위 try는 남긴다 */ }
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
    const who = (req as Request & { user?: { displayName?: string } }).user?.displayName;
    res.json(performUndo(req.body?.id, who));
  });
  app.get("/api/agent/undo/last", authMiddleware, (_req, res) => res.json({ label: lastUndoLabel() }));
}
