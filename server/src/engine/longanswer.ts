// engine/longanswer.ts — 오래 걸리는 지시를 리포트로 돌리고, 끝나면 알려주는 장치.
//
// 사용자 요청(2026-07-26): "시큐리티 LLM이 작성하면 될 것 같은데 시간이 걸리면 리포트로
// 작성해드리겠습니다라고 하고, 이런 작업이 끝나면 팝업으로 요청하신 자료 끝나서 리포트에
// 저장했습니다라고 해주면 좋겠다."
//
// 동작: 지시를 평소처럼 처리하되 30초(사용자 결정 2026-07-26, 10초→30초 상향) 안에 안 끝나면
// 그 자리에서 "리포트로 작성해 드리겠다"고 답하고 물러난다. 작업은 뒤에서 계속 돌아 끝나면
// 리포트로 저장하고, 화면에 띄울 알림을 남긴다. 화면이 꺼져 있었어도 다음 접속 때 한 번 받는다
// (그래서 DB에 남긴다). 10초는 보통 답변도 리포트로 새는 일이 잦았다.
//
// 왜 "미리 판단"이 아니라 "시간 넘으면"인가: 지시 문구로 오래 걸릴지 맞히는 건 빗나가기 쉽고,
// 짧은 질문까지 리포트로 밀어내면 오히려 불편하다. 실제 걸린 시간은 틀릴 수가 없다.

import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { db, migrate } from "../db";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";

const REPORT_DIR = process.env.GIJO_REPORT_DIR ?? path.join("data", "reports");

/** 이 시간을 넘기면 리포트로 돌린다. 사용자 결정 30초(환경변수로 조절 가능). */
export const LONG_ANSWER_MS = Number(process.env.GIJO_LONG_ANSWER_MS ?? 30_000);

/**
 * **보고서꼴 지시**는 훨씬 일찍 물러난다(2026-08-07 승인 — 150상황 재측정에서 보고서 3건이
 * 32~42초). 위의 "미리 판단하지 않는다" 원칙의 **좁은 예외**다: "보고서 만들어줘"는 리포트가
 * 곧 요청물이라, 리포트로 저장하고 알리는 것이 답을 깎는 게 아니라 **그대로 주는 것**이다.
 * 그래도 즉시 물러나지는 않는다 — 3초 안에 끝나면(가벼운 데이터) 평소처럼 그 자리에서 답한다.
 * 걸릴지 안 걸릴지는 여전히 실제 시간이 정한다.
 */
export const REPORT_HANDOFF_MS = Number(process.env.GIJO_REPORT_HANDOFF_MS ?? 3_000);

/**
 * 보고서꼴 판별 — **만드는 동사가 붙은 보고서·리포트**만. 좁게 잡는다:
 * 「리포트 스케줄 확인」(조회)·「정기 리포트 언제야」(일정)는 빠른 답이라 건드리지 않는다.
 * ⚠ ops-sim 판정기가 이 판별의 결과(wouldHandoff)를 신호로 받는다 — 여기가 단일 소스다.
 */
export function 보고서꼴(text: string): boolean {
  return /(보고서|리포트)\s*(로|를|좀|도)?\s*(만들|작성|생성|뽑|써|내\s*줘)|(보고|검토|경영진)\s*용[^.\n]{0,10}(요약|정리|만들|작성)/.test(String(text ?? ""));
}

/**
 * 평가 게이트(qa=true)가 기다리는 시간 — 사람이 아니라 **자를 대는 쪽**이다.
 *
 * 리포트 전환은 사람을 기다리게 하지 않으려는 배려다. 게이트에는 그 배려가 해롭다 —
 * 30초를 넘기면 안내 문구만 돌아와 문항이 재려던 것을 아예 못 재고, '측정 못 함'으로
 * 분모에서 빠진다. 그 자리에 결함이 숨어도 점수에 안 나타난다(2026-07-31 실측: 2문항).
 *
 * 무한정 기다리지는 않는다 — 매달린 요청 하나가 게이트를 영영 멈추게 하면 안 된다.
 */
export const QA_LONG_ANSWER_MS = Number(process.env.GIJO_QA_LONG_ANSWER_MS ?? 180_000);

migrate(
  "long-answers-2026-07-26",
  `CREATE TABLE IF NOT EXISTS long_answers (
     id TEXT PRIMARY KEY,
     userId TEXT,                  -- 알림을 받을 사람(없으면 누구에게나 보인다)
     instruction TEXT NOT NULL,
     status TEXT NOT NULL,         -- running | done | failed
     reportBase TEXT,              -- 저장된 리포트 base(이력 화면 링크용)
     error TEXT,
     startedAt INTEGER NOT NULL,
     finishedAt INTEGER,
     notifiedAt INTEGER            -- 화면이 알림을 받아간 시각(NULL이면 아직 안 알림)
   );`
);

export interface LongAnswer {
  id: string;
  userId: string | null;
  instruction: string;
  status: "running" | "done" | "failed";
  reportBase: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

interface Row {
  id: string; userId: string | null; instruction: string; status: string;
  reportBase: string | null; error: string | null; startedAt: number; finishedAt: number | null;
}
const toLongAnswer = (r: Row): LongAnswer => ({
  id: r.id, userId: r.userId, instruction: r.instruction,
  status: r.status as LongAnswer["status"], reportBase: r.reportBase,
  error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt,
});

export function startLongAnswer(instruction: string, userId: string | null): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO long_answers (id, userId, instruction, status, startedAt) VALUES (?, ?, ?, 'running', ?)`
  ).run(id, userId, instruction, Date.now());
  return id;
}

/** 다 된 답을 리포트로 저장하고 알림 대기 상태로 만든다. */
export async function finishLongAnswer(id: string, answer: string, actor: string | null): Promise<string> {
  const row = db.prepare(`SELECT * FROM long_answers WHERE id = ?`).get(id) as Row | undefined;
  const instruction = row?.instruction ?? "";
  const ts = Date.now();
  const base = `answer-${ts}`;
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const took = row ? Math.round((ts - row.startedAt) / 1000) : 0;
  const md = [
    `# 요청하신 자료`,
    ``,
    `- 요청: **${instruction}**`,
    `- 요청자: ${actor ?? "-"}`,
    `- 작성 시각: ${new Date(ts).toLocaleString("ko-KR")}`,
    `- 걸린 시간: ${took}초`,
    ``,
    `---`,
    ``,
    answer,
    ``,
    `---`,
    `시간이 걸리는 요청이라 AI가 뒤에서 작성해 리포트로 남긴 것입니다.`,
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, `${base}.md`), md, "utf-8");
  await fs.writeFile(
    path.join(REPORT_DIR, `${base}.json`),
    JSON.stringify(
      {
        base,
        type: "answer",
        createdAt: ts,
        assetIds: [],
        assetNames: [],
        summary: instruction.slice(0, 120),
        md: `${base}.md`,
        createdBy: actor ?? undefined,
      },
      null,
      2
    ),
    "utf-8"
  );

  db.prepare(`UPDATE long_answers SET status='done', reportBase=?, finishedAt=? WHERE id=?`).run(base, ts, id);
  recordAudit({
    kind: "write",
    action: "long_answer_saved",
    target: base,
    detail: `오래 걸린 요청을 리포트로 저장 — ${instruction.slice(0, 80)}`,
    actor,
  });
  return base;
}

export function failLongAnswer(id: string, message: string): void {
  db.prepare(`UPDATE long_answers SET status='failed', error=?, finishedAt=? WHERE id=?`)
    .run(message.slice(0, 500), Date.now(), id);
}

/** 아직 화면에 못 알린 완료 건. 화면이 가져가면 알림 표시를 남긴다. */
export function pendingNotices(userId: string | null): LongAnswer[] {
  const rows = db
    .prepare(
      `SELECT * FROM long_answers
        WHERE notifiedAt IS NULL AND status IN ('done','failed')
          AND (userId IS NULL OR ? IS NULL OR userId = ?)
        ORDER BY finishedAt ASC LIMIT 5`
    )
    .all(userId, userId) as Row[];
  return rows.map(toLongAnswer);
}

export function markNotified(id: string): void {
  db.prepare(`UPDATE long_answers SET notifiedAt=? WHERE id=?`).run(Date.now(), id);
}

/** 서버가 죽었다 살아나면 'running'인 채로 남은 것들이 영원히 대기한다 — 실패로 정리한다. */
export function reapStaleRunning(): number {
  const r = db
    .prepare(`UPDATE long_answers SET status='failed', error='서버가 재시작되어 중단되었습니다', finishedAt=? WHERE status='running'`)
    .run(Date.now());
  return r.changes;
}

export function registerLongAnswerRoutes(app: Express): void {
  // 화면이 주기적으로 물어본다 — 다 된 게 있으면 팝업으로 알린다.
  app.get(
    "/api/long-answers/pending",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const user = (req as Request & { user?: GijoUser }).user;
      res.json({ notices: pendingNotices(user?.id ?? null) });
    })
  );
  // 팝업을 띄웠으면 화면이 알려준다 — 같은 알림을 두 번 띄우지 않게.
  app.post(
    "/api/long-answers/:id/ack",
    authMiddleware,
    asyncRoute(async (req, res) => {
      markNotified(String(req.params.id));
      res.json({ ok: true });
    })
  );
}
