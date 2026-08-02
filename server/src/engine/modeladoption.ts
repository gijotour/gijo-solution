// engine/modeladoption.ts — 모델 채택 원장: "이 모델을 왜, 어떤 근거로 쓰기로 했나"를 남긴다.
// (계획서 중-4 "게이트 위에서 합성·학습 향상 개시 — 게이트 통과분만 배포"의 기록 층)
//
// 왜 필요한가: 게이트(중-3)를 만들어도 **돌리지 않고 바꿔 버리면** 아무 소용이 없다.
// 이 프로젝트엔 이미 같은 종류의 사고가 있었다 — 근거 없는 major 올림·게시가 사후 검토에서
// 발견돼(2026-07-29) "허락 근거를 커밋에 남긴다"는 규칙이 생겼다. 모델도 똑같다:
// 모델을 바꾸는 건 제품의 행동 전체를 바꾸는 일인데, 지금까지 그 결정에 근거가 남지 않았다.
//
// 이 모듈은 바꾸는 것을 **막지 않는다**(운영 중 급히 되돌려야 할 때가 있다).
// 대신 근거 없는 변경을 **근거 없음으로 기록**한다 — 감추지 않는 것이 강제하는 것보다 오래 간다.
import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

migrate(
  "model-adoptions-2026-07-29",
  `CREATE TABLE IF NOT EXISTS model_adoptions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     agentId TEXT NOT NULL,
     fromModel TEXT,            -- 이전 모델(없으면 전역 기본)
     toModel TEXT,              -- 새 모델(null이면 전역으로 되돌림)
     verdict TEXT NOT NULL,     -- pass(게이트 통과) | hold(보류·되돌림) | none(게이트 없이 바꿈)
     gate TEXT,                 -- 게이트 결과 JSON(축별 통과율·견고성·문항셋 지문·커밋)
     decidedBy TEXT,
     note TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_model_adoptions_at ON model_adoptions(at);`
);

export type AdoptionVerdict = "pass" | "hold" | "none";

export interface ModelAdoption {
  id: number;
  at: number;
  agentId: string;
  fromModel: string | null;
  toModel: string | null;
  verdict: AdoptionVerdict;
  gate: string | null;
  decidedBy: string | null;
  note: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO model_adoptions (at, agentId, fromModel, toModel, verdict, gate, decidedBy, note)
   VALUES (@at, @agentId, @fromModel, @toModel, @verdict, @gate, @decidedBy, @note)`
);

export function recordAdoption(e: {
  agentId: string;
  fromModel?: string | null;
  toModel?: string | null;
  verdict: AdoptionVerdict;
  gate?: unknown;
  decidedBy?: string | null;
  note?: string | null;
}): ModelAdoption {
  const row = {
    at: Date.now(),
    agentId: e.agentId,
    fromModel: e.fromModel ?? null,
    toModel: e.toModel ?? null,
    verdict: e.verdict,
    gate: e.gate ? JSON.stringify(e.gate) : null,
    decidedBy: e.decidedBy ?? null,
    note: e.note ?? null,
  };
  const r = insertStmt.run(row);
  recordAudit({
    kind: "config",
    actor: e.decidedBy ?? null,
    action: e.verdict === "pass" ? "모델 채택(게이트 통과)" : e.verdict === "hold" ? "모델 채택 보류(되돌림)" : "모델 변경(게이트 근거 없음)",
    target: `${e.agentId}: ${row.fromModel ?? "(전역)"} → ${row.toModel ?? "(전역)"}`,
    detail: row.note ?? "",
    result: e.verdict === "hold" ? "blocked" : "ok",
  });
  return { id: Number(r.lastInsertRowid), ...row } as ModelAdoption;
}

export function listAdoptions(limit = 50): ModelAdoption[] {
  return db
    .prepare("SELECT * FROM model_adoptions ORDER BY at DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 500)) as ModelAdoption[];
}

/** 지금 쓰는 모델이 무슨 근거로 채택됐나 — 에이전트별 최근 pass 기록. */
export function currentBasis(agentId: string): ModelAdoption | null {
  return (db
    .prepare("SELECT * FROM model_adoptions WHERE agentId = ? AND verdict = 'pass' ORDER BY at DESC LIMIT 1")
    .get(agentId) as ModelAdoption | undefined) ?? null;
}

/** 챗봇·화면용 한국어 요약. 근거 없는 변경이 있으면 숨기지 않고 먼저 말한다. */
export function adoptionSummaryText(limit = 10): string {
  const rows = listAdoptions(limit);
  if (rows.length === 0) {
    return [
      "모델 채택 기록이 없습니다.",
      "모델을 바꿀 때는 평가 게이트를 먼저 태우고 그 결과를 근거로 남기세요 — `node tools/evalgate/adopt.mjs <에이전트> <모델>`이 그 절차를 대신 해 줍니다.",
    ].join("\n");
  }
  const fmt = (t: number) => new Date(t).toLocaleString("ko-KR");
  const label: Record<AdoptionVerdict, string> = {
    pass: "✓ 채택(게이트 통과)",
    hold: "⛔ 보류(되돌림)",
    none: "⚠ 근거 없이 변경",
  };
  const evidenceless = rows.filter((r) => r.verdict === "none").length;
  const lines = rows.map((r) => {
    const g = r.gate ? (JSON.parse(r.gate) as { axes?: Record<string, { passRate: number }>; robustness?: { score: number | null } }) : null;
    const scores = g?.axes ? Object.entries(g.axes).map(([k, v]) => `${k} ${v.passRate}%`).join(" · ") : "게이트 결과 없음";
    return `  · ${fmt(r.at)} ${label[r.verdict]} — ${r.agentId}: ${r.fromModel ?? "(전역)"} → ${r.toModel ?? "(전역)"}\n      ${scores}${g?.robustness?.score != null ? ` · 견고성 ${g.robustness.score}점` : ""}${r.decidedBy ? ` · ${r.decidedBy}` : ""}`;
  });
  return [
    `모델 채택 이력 ${rows.length}건`,
    evidenceless ? `⚠ 이 중 ${evidenceless}건은 평가 게이트 근거 없이 바뀐 변경입니다 — 다음부터는 게이트를 먼저 태우세요.` : "",
    "",
    ...lines,
  ].filter(Boolean).join("\n");
}

export function resetAdoptionsForTests(): void {
  db.exec("DELETE FROM model_adoptions");
}

export function registerModelAdoptionRoutes(app: Express): void {
  app.get("/api/model-adoptions", authMiddleware, (req, res) => {
    res.json({ entries: listAdoptions(Number(req.query.limit ?? 50)), summary: adoptionSummaryText(10) });
  });
  // 채택 기록은 admin — 모델 변경은 제품 행동 전체를 바꾸는 결정이다.
  app.post("/api/model-adoptions", authMiddleware, adminMiddleware, (req, res) => {
    const b = req.body as { agentId?: string; fromModel?: string | null; toModel?: string | null; verdict?: AdoptionVerdict; gate?: unknown; note?: string };
    if (!b.agentId || !b.verdict || !["pass", "hold", "none"].includes(b.verdict)) {
      res.status(400).json({ error: "agentId와 verdict(pass·hold·none)가 필요합니다" });
      return;
    }
    res.json(recordAdoption({
      agentId: b.agentId,
      fromModel: b.fromModel,
      toModel: b.toModel,
      verdict: b.verdict,
      gate: b.gate,
      note: b.note,
      decidedBy: (req as Request & { user?: GijoUser }).user?.displayName,
    }));
  });
}
