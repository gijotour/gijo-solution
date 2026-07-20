// engine/audit.ts — 작업 기록(감사 로그). 모든 "무언가를 실행/승인/차단/변경"한 작업을 한 타임라인에
// 남긴다. 흩어진 이벤트(협업·LLM활동·egress·가드레일)와 달리, 이건 "누가 무엇을 했나"의 단일 원천이다.
// CLI 실행(①)·챗봇 명령 승인/차단이 여기에 강제로 기록되며, 끌 수 없다(감사 무결성).

import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import type { GijoUser } from "../auth/users";

export type AuditKind = "cli" | "approval" | "write" | "block" | "auth" | "config";
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

export function listAudit(filter?: { kind?: AuditKind; limit?: number }): AuditEntry[] {
  const limit = Math.min(Math.max(filter?.limit ?? 200, 1), 1000);
  if (filter?.kind) {
    return db
      .prepare("SELECT * FROM audit_log WHERE kind = ? ORDER BY at DESC LIMIT ?")
      .all(filter.kind, limit) as AuditEntry[];
  }
  return db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT ?").all(limit) as AuditEntry[];
}

export function auditSummary(): { total: number; byKind: Record<string, number> } {
  const rows = db.prepare("SELECT kind, COUNT(*) AS n FROM audit_log GROUP BY kind").all() as { kind: string; n: number }[];
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { byKind[r.kind] = r.n; total += r.n; }
  return { total, byKind };
}

// 테스트 전용.
export function resetAuditForTests(): void {
  db.exec("DELETE FROM audit_log");
}

export function registerAuditRoutes(app: Express): void {
  app.get(
    "/api/audit",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const kind = req.query.kind as AuditKind | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json({ entries: listAudit({ kind, limit }), summary: auditSummary() });
    })
  );
  // 클라이언트가 남기는 기록 — CLI 실행/차단(담당자 PC 터미널)과 화면 메모.
  // kind는 클라이언트가 정당하게 남길 수 있는 계열(cli·block·config)로 제한한다 — auth·write처럼
  // 서버가 권위 있게 남기는 종류는 여기서 못 만든다(위조 방지). actor는 서버가 토큰에서 채운다.
  const CLIENT_KINDS = new Set(["cli", "block", "config"]);
  app.post("/api/audit", authMiddleware, (req, res) => {
    const user = (req as Request & { user?: GijoUser }).user;
    const { kind, action, target, detail, result } = req.body as {
      kind?: string; action?: string; target?: string; detail?: string; result?: AuditResult;
    };
    if (!action || !action.trim()) {
      res.status(400).json({ error: "action이 필요합니다" });
      return;
    }
    const k = (kind && CLIENT_KINDS.has(kind) ? kind : "config") as AuditKind;
    const r: AuditResult = result === "blocked" || result === "error" ? result : "ok";
    recordAudit({ kind: k, actor: user?.displayName ?? null, action: action.trim(), target, detail, result: r });
    res.json({ ok: true });
  });
}
