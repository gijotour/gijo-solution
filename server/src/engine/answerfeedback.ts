// engine/answerfeedback.ts — 답변 지적 수집: "이 답 틀렸어"를 회귀셋으로 흡수하는 통로.
// (계획서 중-1 "파일럿 실사용 피드백 루프 — 주간 수집, 오답·미답 지적은 회귀셋으로 흡수"의 개발 몫)
//
// 왜 필요한가: 우리 회귀 방어는 두 겹인데(회귀 하네스 11문항 · 평가 게이트 99문항) 문항은 전부
// **우리가 상상한 질문**이다. 실사용자가 실제로 던지는 말과 실제로 겪는 오답은 여기 없다.
// 2026-07-21 실사고가 그 증거다 — 테스트 758건이 통과하는 동안 KEV 오답·복창·머리말 누출이
// 사용자에게 나갔다. 담당자의 "이거 틀렸어" 한 줄이 문항 하나보다 값지다.
//
// 설계 원칙:
//   1) 지적은 **버리지 않는다** — 고칠 수 없는 지적이어도 남는다(무엇을 못 고쳤는지가 정보다).
//   2) 자동으로 문항이 되지 않는다 — 초안까지만 만들고 편입은 사람이 한다. 사용자의 오해가
//      그대로 기준이 되면 게이트가 엉뚱한 것을 지키게 된다.
//   3) 실사용만 — QA·평가 게이트가 만든 문답은 애초에 세션에 안 남으므로 여기 섞이지 않는다.
import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

migrate(
  "answer-feedback-2026-07-29",
  `CREATE TABLE IF NOT EXISTS answer_feedback (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     kind TEXT NOT NULL,        -- wrong(틀림) | missing(못 찾음) | style(말투·형식)
     question TEXT NOT NULL,
     answer TEXT NOT NULL,
     note TEXT,                 -- 담당자가 적은 "무엇이 틀렸는지"
     expected TEXT,             -- 담당자가 아는 정답(있으면) — 문항 초안의 expect가 된다
     screen TEXT,
     actor TEXT,
     status TEXT NOT NULL       -- open | promoted(문항으로 편입) | dismissed(문항 감으로는 부적합)
   );
   CREATE INDEX IF NOT EXISTS idx_answer_feedback_at ON answer_feedback(at);`
);

export type FeedbackKind = "wrong" | "missing" | "style";
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  wrong: "틀린 답",
  missing: "못 찾음(있는데 못 찾았다)",
  style: "말투·형식",
};

export interface AnswerFeedback {
  id: number;
  at: number;
  kind: FeedbackKind;
  question: string;
  answer: string;
  note: string | null;
  expected: string | null;
  screen: string | null;
  actor: string | null;
  status: "open" | "promoted" | "dismissed";
}

const insertStmt = db.prepare(
  `INSERT INTO answer_feedback (at, kind, question, answer, note, expected, screen, actor, status)
   VALUES (@at, @kind, @question, @answer, @note, @expected, @screen, @actor, 'open')`
);

export function recordFeedback(e: {
  kind: FeedbackKind;
  question: string;
  answer: string;
  note?: string;
  expected?: string;
  screen?: string;
  actor?: string;
}): AnswerFeedback {
  const q = e.question.trim();
  if (!q) throw new Error("어떤 질문에 대한 지적인지가 필요합니다");
  const row = {
    at: Date.now(),
    kind: e.kind,
    question: q.slice(0, 2000),
    answer: (e.answer ?? "").slice(0, 4000),
    note: e.note?.trim() || null,
    expected: e.expected?.trim() || null,
    screen: e.screen ?? null,
    actor: e.actor ?? null,
  };
  const r = insertStmt.run(row);
  recordAudit({
    kind: "config",
    actor: e.actor ?? null,
    action: "답변 지적 접수",
    target: FEEDBACK_KIND_LABEL[e.kind],
    detail: q.slice(0, 120),
    result: "ok",
  });
  return { id: Number(r.lastInsertRowid), status: "open", ...row } as AnswerFeedback;
}

export function listFeedback(days = 7, status?: AnswerFeedback["status"]): AnswerFeedback[] {
  const since = Date.now() - days * 86400000;
  const sql = status
    ? "SELECT * FROM answer_feedback WHERE at >= ? AND status = ? ORDER BY at DESC LIMIT 200"
    : "SELECT * FROM answer_feedback WHERE at >= ? ORDER BY at DESC LIMIT 200";
  return (status ? db.prepare(sql).all(since, status) : db.prepare(sql).all(since)) as AnswerFeedback[];
}

export function setFeedbackStatus(id: number, status: AnswerFeedback["status"], actor?: string): void {
  db.prepare("UPDATE answer_feedback SET status = ? WHERE id = ?").run(status, id);
  recordAudit({
    kind: "config",
    actor: actor ?? null,
    action: "답변 지적 처리",
    target: String(id),
    detail: status === "promoted" ? "회귀 문항으로 편입" : "문항 감으로는 부적합",
    result: "ok",
  });
}

/** 주간 요약 — 계획서 중-1의 "주간 수집". 챗봇·보고에 그대로 쓴다. */
export function feedbackSummaryText(days = 7): string {
  const rows = listFeedback(days);
  if (rows.length === 0) {
    return [
      `최근 ${days}일 동안 접수된 답변 지적이 없습니다.`,
      "답이 틀렸거나 못 찾았을 때 알려주시면 그 질문이 회귀 검사 문항 후보가 됩니다 — 같은 실수가 다시 나가지 않게 하는 가장 빠른 길입니다.",
    ].join("\n");
  }
  const open = rows.filter((r) => r.status === "open");
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  return [
    `최근 ${days}일 답변 지적 ${rows.length}건 (미처리 ${open.length}건)`,
    `종류별: ${Object.entries(byKind).map(([k, n]) => `${FEEDBACK_KIND_LABEL[k as FeedbackKind]} ${n}`).join(" · ")}`,
    "",
    ...open.slice(0, 8).map((r) => `  · [${FEEDBACK_KIND_LABEL[r.kind]}] "${r.question.slice(0, 50)}" — ${r.note ?? "사유 미기재"}`),
    "",
    "이 지적들은 회귀 검사 문항 후보로 모아 둡니다(자동 편입은 하지 않습니다 — 사람이 검토합니다).",
  ].join("\n");
}

/**
 * 평가 게이트 문항 초안 — 지적을 그대로 문항 꼴로 옮긴다.
 * expect는 담당자가 적어 준 정답에서만 만든다(없으면 비운다) — 우리가 지어내면 지적의 뜻이 바뀐다.
 * 편입은 사람이 tools/evalgate/cases/*.json에 옮기며 결정한다.
 */
export function feedbackAsGateCases(days = 30): {
  id: string;
  q: string;
  expect?: string[];
  screen?: string;
  _출처: string;
}[] {
  return listFeedback(days, "open")
    .filter((r) => r.kind !== "style") // 말투 지적은 게이트 문항 감이 아니다(품질은 다른 축에서 본다)
    .map((r) => ({
      id: `feedback-${r.id}`,
      q: r.question,
      ...(r.expected ? { expect: [r.expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")] } : {}),
      ...(r.screen ? { screen: r.screen } : {}),
      _출처: `실사용 지적 ${new Date(r.at).toISOString().slice(0, 10)} — ${FEEDBACK_KIND_LABEL[r.kind]}${r.note ? `: ${r.note}` : ""}`,
    }));
}

export function resetFeedbackForTests(): void {
  db.exec("DELETE FROM answer_feedback");
}

export function registerAnswerFeedbackRoutes(app: Express): void {
  app.post(
    "/api/answer-feedback",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const b = req.body as { kind?: FeedbackKind; question?: string; answer?: string; note?: string; expected?: string; screen?: string };
      if (!b.kind || !["wrong", "missing", "style"].includes(b.kind)) {
        res.status(400).json({ error: "kind는 wrong·missing·style 중 하나여야 합니다" });
        return;
      }
      try {
        res.json(recordFeedback({
          kind: b.kind,
          question: String(b.question ?? ""),
          answer: String(b.answer ?? ""),
          note: b.note,
          expected: b.expected,
          screen: b.screen,
          actor: (req as Request & { user?: GijoUser }).user?.displayName,
        }));
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    })
  );

  app.get("/api/answer-feedback", authMiddleware, (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 365);
    res.json({ days, entries: listFeedback(days), summary: feedbackSummaryText(days) });
  });

  // 상태 변경은 admin — 지적을 회귀 문항으로 편입할지 접을지는 품질 판단이다(등록·조회는 누구나).
  app.post("/api/answer-feedback/:id/status", authMiddleware, adminMiddleware, (req, res) => {
    const status = String((req.body as { status?: string })?.status ?? "");
    if (!["open", "promoted", "dismissed"].includes(status)) {
      res.status(400).json({ error: "status는 open·promoted·dismissed 중 하나여야 합니다" });
      return;
    }
    const id = Number(req.params.id);
    // 없는 id에 200을 돌려주면 화면이 처리된 줄 안다 — 없으면 없다고 말한다.
    const exists = db.prepare("SELECT 1 FROM answer_feedback WHERE id = ?").get(id);
    if (!exists) {
      res.status(404).json({ error: "해당 지적을 찾지 못했습니다" });
      return;
    }
    setFeedbackStatus(id, status as AnswerFeedback["status"], (req as Request & { user?: GijoUser }).user?.displayName);
    res.json({ ok: true });
  });

  // 게이트 문항 초안 내보내기 — 개발 쪽에서 tools/evalgate/cases에 옮길 때 쓴다.
  app.get("/api/answer-feedback/gate-cases", authMiddleware, (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    res.json({ cases: feedbackAsGateCases(days) });
  });
}
