// engine/datacleanup.ts — 실사용 전환용 데이터 정리 (admin 전용, 감사 증적)
//
// 파일럿→실사용 전환 시 데모·테스트 데이터를 안전하게 비우는 정식 경로다. 원시 SQL을 손으로
// 돌리는 대신, 지원 대상 테이블만 화이트리스트로 열고 실행자·건수를 감사 로그에 남긴다.
// ⚠ 지식베이스(RAG/LanceDB)·온톨로지·감사로그·사용자·자산은 여기서 다루지 않는다 —
//   자산·사용자는 각자의 삭제 API(캐스케이드 포함)를 쓴다.

import type { Express, Request } from "express";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";

// 지원 대상 화이트리스트 — 키 이름으로만 지울 수 있다(임의 테이블명 주입 불가).
const TARGETS: Record<string, { label: string; tables: string[] }> = {
  cti_findings: { label: "위협 인텔 항목(CTI findings)", tables: ["cti_findings"] },
  analysis_events: { label: "보안 분석 이벤트(분석허브)", tables: ["analysis_events", "analysis_event_status"] },
};

export function cleanupTargets(): { id: string; label: string; rows: number }[] {
  return Object.entries(TARGETS).map(([id, t]) => ({
    id,
    label: t.label,
    rows: t.tables.reduce((n, tb) => {
      try {
        return n + (db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).get() as { n: number }).n;
      } catch {
        return n;
      }
    }, 0),
  }));
}

export function runCleanup(targetIds: string[]): { id: string; deleted: number }[] {
  const out: { id: string; deleted: number }[] = [];
  for (const id of targetIds) {
    const t = TARGETS[id];
    if (!t) continue;
    let deleted = 0;
    for (const tb of t.tables) {
      try {
        deleted += db.prepare(`DELETE FROM ${tb}`).run().changes;
      } catch {
        /* 없는 테이블(구버전)이어도 나머지는 계속 */
      }
    }
    out.push({ id, deleted });
  }
  return out;
}

export function registerDataCleanupRoutes(app: Express): void {
  // 정리 가능한 대상과 현재 건수 — 실행 전 확인용.
  app.get("/api/admin/data-cleanup", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ targets: cleanupTargets() });
  });
  // 실행 — 화이트리스트 대상만, 실행자·건수를 감사 로그에 남긴다.
  app.post(
    "/api/admin/data-cleanup",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body?.targets)
        ? (req.body.targets as unknown[]).filter((x): x is string => typeof x === "string" && x in TARGETS)
        : [];
      if (ids.length === 0) {
        res.status(400).json({ error: `targets가 필요합니다 — 지원: ${Object.keys(TARGETS).join(", ")}` });
        return;
      }
      const results = runCleanup(ids);
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      recordAudit({
        kind: "write",
        actor,
        action: "데이터 정리(실사용 전환)",
        target: ids.join(","),
        detail: results.map((r) => `${TARGETS[r.id].label} ${r.deleted}건 삭제`).join(" · "),
        result: "ok",
      });
      res.json({ results });
    })
  );
}
