// engine/audit.ts — 작업 기록(감사 로그). 모든 "무언가를 실행/승인/차단/변경"한 작업을 한 타임라인에
// 남긴다. 흩어진 이벤트(협업·LLM활동·egress·가드레일)와 달리, 이건 "누가 무엇을 했나"의 단일 원천이다.
// CLI 실행(①)·챗봇 명령 승인/차단이 여기에 강제로 기록되며, 끌 수 없다(감사 무결성).

// ⚠ 여기에 express·authMiddleware·asyncRoute를 **다시 import하지 말 것**(2026-08-27 화살 #3).
//   라우트는 auditroutes.ts에 산다 — 이 파일이 auth를 무는 순간 auth⇄users⇄audit 3자 순환이
//   경고 없이 부활한다(59개 모듈이 무는 바닥이라 그 순환은 전 서버를 묶는다).
//   실사고: 함수만 옮기고 이 import들을 안 지워 검토관 3갈래가 전부 「반쪽 수리」로 잡았다 —
//   tsc는 미사용 import를 emit에서 지워(런타임 무사) 시험 4,089개가 원리상 못 잡는 부류였다.
import { randomUUID } from "crypto";
import { db } from "../db";

// privacy — 개인정보 가림(2026-08-09 신설). 차단(block)과 다르다: 요청은 그대로 진행되고
//   민감한 숫자만 가려서 LLM에 전달됐다는 **사실의 기록**이다. 담당자가 "내 입력이 어디까지
//   갔나"를 사후에 확인할 수 있어야 가림이 신뢰를 얻는다.
export type AuditKind = "cli" | "approval" | "write" | "block" | "auth" | "config" | "privacy";
export type AuditResult = "ok" | "blocked" | "error" | "pending";

export interface AuditEntry {
  id: string;
  at: number;
  kind: AuditKind;
  actor: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  result: AuditResult;
}

const insertStmt = db.prepare(
  `INSERT INTO audit_log (id, at, kind, actor, action, target, detail, result)
   VALUES (@id, @at, @kind, @actor, @action, @target, @detail, @result)`
);

// 감사 기록 리스너 — "모든 행위를 작업 세션에도 남긴다"(사용자 요청 2026-07-20) 같은 부가 반영을
// 순환 의존 없이 붙이기 위한 훅. audit는 리프 모듈로 유지하고, 소비자(worksessions)가 등록한다.
export type AuditListener = (e: AuditEntry) => void;
const listeners: AuditListener[] = [];
export function onAudit(l: AuditListener): void {
  listeners.push(l);
}

// 어디서든 부를 수 있는 기록 함수. 실패해도 본 작업을 막지 않게 조용히 삼킨다(감사 기록이
// 기능을 깨뜨리면 안 된다). detail은 길 수 있어 4000자로 자른다.
export function recordAudit(e: {
  kind: AuditKind;
  action: string;
  actor?: string | null;
  target?: string | null;
  detail?: string | null;
  result?: AuditResult;
}): void {
  const entry: AuditEntry = {
    id: randomUUID(),
    at: Date.now(),
    kind: e.kind,
    actor: e.actor ?? null,
    action: e.action,
    target: e.target ?? null,
    detail: e.detail ? e.detail.slice(0, 4000) : null,
    result: e.result ?? "ok",
  };
  try {
    insertStmt.run(entry);
  } catch (err) {
    console.error("[audit] 기록 실패(무시):", err instanceof Error ? err.message : err);
  }
  for (const l of listeners) {
    try { l(entry); } catch { /* 리스너 실패가 감사·본 작업을 막지 않게 */ }
  }
}

// ⚠ 같은 밀리초에 여러 건이 쌓이면 `at`만으로는 순서가 정해지지 않는다 — SQLite는 동점을 rowid 오름차순으로
//   내놓아 **가장 새 건이 LIMIT 밖으로 밀린다**(2026-09-10 gb10 사본 시험 실측: 빠른 기계라 한 밀리초에
//   5건 넘게 쌓여 「랜섬웨어 만들어줘」 차단 기록이 상위 5건에 안 들었다 — WSL은 느려서 안 드러났다).
//   rowid는 넣은 순서라 보조 잣대로 두면 순서가 결정적이다(id는 TEXT라 순서 뜻이 없다).
export function listAudit(filter?: { kind?: AuditKind; limit?: number }): AuditEntry[] {
  const limit = Math.min(Math.max(filter?.limit ?? 200, 1), 1000);
  if (filter?.kind) {
    return db
      .prepare("SELECT * FROM audit_log WHERE kind = ? ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(filter.kind, limit) as AuditEntry[];
  }
  return db.prepare("SELECT * FROM audit_log ORDER BY at DESC, rowid DESC LIMIT ?").all(limit) as AuditEntry[];
}

export function auditSummary(): { total: number; byKind: Record<string, number> } {
  const rows = db.prepare("SELECT kind, COUNT(*) AS n FROM audit_log GROUP BY kind").all() as { kind: string; n: number }[];
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { byKind[r.kind] = r.n; total += r.n; }
  return { total, byKind };
}

// ── 보관 기간 정책 ──────────────────────────────────────────────────────────
// **감사 로그를 지우는 것은 그 자체가 위험한 행위다.** 그래서 이 정리는 세 가지를 지킨다:
//   ① 기본값은 **아주 길게**(3년) — 짧게 잡아 조사에 필요한 기록을 잃는 것이 더 나쁘다.
//      국내 실무에서 접속기록 보관은 최소 1년(개인정보처리시스템 기준 2년)이라 그보다 길게 둔다.
//   ② **무엇을 몇 건 지웠는지 감사 로그에 남긴다** — 정리 자체가 추적 가능해야 한다.
//   ③ 기관이 더 길게(또는 무제한) 두고 싶으면 환경변수로 바꾼다. 0이면 정리하지 않는다.
//
// 왜 필요한가: 지금까지 정리가 전혀 없어 무한히 쌓였다(실측 2026-07-30: 하루 QA·점검만으로
// 차단 기록 138건). 디스크가 차면 백업도 못 만들고 DB도 못 쓴다 — 그때는 감사 기록을 지키려다
// 시스템 전체를 잃는다. 오래된 것을 정리하는 편이 안전하다.
const AUDIT_RETENTION_DAYS = Number(process.env.GIJO_AUDIT_RETENTION_DAYS ?? 1095); // 3년
const AUDIT_PRUNE_INTERVAL_MS = Number(process.env.GIJO_AUDIT_PRUNE_INTERVAL_MS ?? 24 * 3600_000);

export function auditRetentionDays(): number {
  return AUDIT_RETENTION_DAYS;
}

/** 보관 기간이 지난 기록을 지운다. 지운 건수를 돌려주고, 지웠다면 그 사실도 감사에 남긴다. */
export function pruneAuditLog(retentionDays = AUDIT_RETENTION_DAYS): number {
  if (!(retentionDays > 0)) return 0; // 0·음수 = 정리 안 함(기관이 무제한을 원할 때)
  const cutoff = Date.now() - retentionDays * 24 * 3600_000;
  const oldest = db.prepare("SELECT MIN(at) AS m FROM audit_log").get() as { m: number | null };
  const n = (db.prepare("DELETE FROM audit_log WHERE at < ?").run(cutoff) as { changes: number }).changes;
  if (n > 0) {
    // ⚠ 정리 자체를 기록한다 — 감사 로그가 조용히 줄어들면 그것이 사고인지 정책인지 알 수 없다.
    recordAudit({
      kind: "config", actor: "system",
      action: `감사 로그 보관 정리 — ${n}건 삭제(보관 ${retentionDays}일)`,
      detail: oldest.m ? `가장 오래된 기록 ${new Date(oldest.m).toISOString().slice(0, 10)} 이전분` : null,
      result: "ok",
    });
  }
  return n;
}

let pruneTimer: NodeJS.Timeout | null = null;
export function startAuditPruneScheduler(): void {
  if (pruneTimer) return;
  console.log(`[audit] 보관 정리 스케줄러 시작 (보관 ${AUDIT_RETENTION_DAYS}일, 주기 ${Math.round(AUDIT_PRUNE_INTERVAL_MS / 3600_000)}시간)`);
  // 기동 직후 한 번 — setInterval만 걸면 24시간 안에 재시작되는 서버에서는 영원히 안 돈다
  // (백업 스케줄러에서 같은 실수를 했다가 엿새 동안 백업이 0건이었다, 2026-07-29).
  setTimeout(() => { try { pruneAuditLog(); } catch { /* 정리 실패가 기동을 막지 않는다 */ } }, 90_000).unref?.();
  pruneTimer = setInterval(() => { try { pruneAuditLog(); } catch { /* 무시 */ } }, AUDIT_PRUNE_INTERVAL_MS);
}
export function stopAuditPruneScheduler(): void {
  if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
}

// 테스트 전용.
export function resetAuditForTests(): void {
  db.exec("DELETE FROM audit_log");
}

// (registerAuditRoutes는 auditroutes.ts로 이사했다 — 2026-08-27 화살 #3. 이 파일은 이제
//  라우트·미들웨어를 모르는 **잎**이다: 59개 모듈이 무는 recordAudit가 바닥에 산다.)
