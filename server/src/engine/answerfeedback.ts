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
//      (예외 하나 — 접수 60초 안에 **본인이** 무르는 것. 잘못 누른 것은 기록이 아니다.)
//   2) 자동으로 문항이 되지 않는다 — 초안까지만 만들고 편입은 사람이 한다. 사용자의 오해가
//      그대로 기준이 되면 게이트가 엉뚱한 것을 지키게 된다.
//   3) 실사용만 — QA·평가 게이트가 만든 문답은 애초에 세션에 안 남으므로 여기 섞이지 않는다.
//
// ■ 2026-09-07 「고칠 것」 라운드(통합 설계관 S-A) — 이 표가 **두 번째 원장**이 된다.
//   지적이 결재판에 뜨고, 갈래(fixkind)로 나뉘고, 담당자가 닫는다(resolved). 갈래 판정과 집계는
//   **fixboard.ts 한 곳**이 한다 — 결재판·감독 화면·대화 도구 셋이 같은 숫자를 봐야 해서다.
import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";
import {
  고칠것갈래, 고칠것갈래검증, 고칠것갈래라벨, 고칠것요약, 고칠것후보,
  근거없음정하기, 기간시작, 기간정리, 인용정제, 인용읽기, 지적상태값들, 회귀문항후보상태,
  type 고칠것갈래값, type 인용조각, type 지적상태값, type 지적종류값,
} from "./fixboard";

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

// ★ 「고칠 것」 다섯 칸(2026-09-07). **소급 UPDATE는 하지 않는다** — 옛 행은 NULL(미분류)로 남고
//   사람이 갈래를 고른다. 저장된 답 글자로 다시 판정하면 배너억제 갈래를 원리상 못 재현하고,
//   사람이 이미 고쳐 놓은 갈래를 덮어쓸 위험까지 생긴다.
//   · fixkind    doc|rule|prod|NULL — 무엇을 해야 닫히는가(fixboard.고칠것갈래)
//   · noev       근거없음 종류 — **접수 순간의 값**을 얼려 둔다. answer_samples는 30일 보존이라
//                거기 JOIN하면 30일 뒤 갈래의 근거가 사라진다.
//   · quotes     그 답이 인용한 조각 **본문**(JSON). 조각 id 포인터는 안 된다 — 재인입이 옛 조각을
//                지우고 다시 넣으면 포인터가 끊긴다(통합 설계관 ⑧).
//   · draft      담당자가 눌렀을 때만 만든 수정 초안. note를 **덮지 않는다**(사람 글은 사람 것).
//   · draftModel 그 초안을 누가 썼나(팀원·모델) — 초안의 출처를 안 적으면 사람 글과 안 갈린다.
migrate(
  "answer-feedback-fixkind-2026-09-07",
  `ALTER TABLE answer_feedback ADD COLUMN fixkind TEXT;
   ALTER TABLE answer_feedback ADD COLUMN noev TEXT;
   ALTER TABLE answer_feedback ADD COLUMN quotes TEXT;
   ALTER TABLE answer_feedback ADD COLUMN draft TEXT;
   ALTER TABLE answer_feedback ADD COLUMN draftModel TEXT;`
);

// ⚠ 종류·상태 값 집합은 **fixboard가 원천**이다(집계가 「0건인 종류도 칸을 그린다」를 지키려면
//   잣대 쪽에 값 집합이 있어야 한다). 여기서는 이름만 다시 내보낸다 — 값을 다시 적으면 늙는다.
export type FeedbackKind = 지적종류값;
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  wrong: "틀린 답",
  missing: "못 찾음(있는데 못 찾았다)",
  style: "말투·형식",
};

/** 상태 넷. resolved = **고쳐서 닫았다**(문서를 올렸거나 답을 고쳤다) — promoted도 dismissed도 아니다. */
export type FeedbackStatus = 지적상태값;
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = 지적상태값들;

/**
 * 감사 기록에 적을 문구 — **삼항이 아니라 표다.**
 * 삼항으로 두면 상태를 하나 더할 때마다 「문항 감으로는 부적합」이 엉뚱한 상태에 거짓으로 찍힌다
 * (resolved를 더하면서 실제로 그렇게 될 뻔했다 — 통합 설계관 V2).
 */
export const FEEDBACK_STATUS_AUDIT: Record<FeedbackStatus, string> = {
  open: "미처리로 되돌림",
  promoted: "회귀 문항으로 편입",
  // ⚠ dismissed는 두 원장을 한꺼번에 닫는 유일한 값이다 — 문구도 그렇게 적는다(fixboard.고칠것열림).
  dismissed: "문항 감으로는 부적합(고칠 것도 없음으로 닫음)",
  resolved: "고쳐서 닫음(처리 완료)",
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
  status: FeedbackStatus;
  /** 무엇을 해야 닫히는가 — NULL은 **미분류**(모르는 것을 아는 척하지 않는다). */
  fixkind: 고칠것갈래값 | null;
  /** 접수 순간 그 답에 실려 있던 근거없음 종류(있었으면). */
  noev: string | null;
  /** 그 답이 인용한 조각 본문 — 초안 재료·근거 상자. 없으면 null. */
  quotes: 인용조각[] | null;
  /** 담당자가 눌렀을 때 만든 수정 초안(사람 글인 note와 별개). */
  draft: string | null;
  draftModel: string | null;
  /** 같은 답에 들어온 지적 수 — 목록에서만 채운다(묶지 않고 세기만 한다). */
  sameAnswer?: number;
  /** 열람 등급 때문에 본문·인용을 가렸는가 — 화면이 「가렸음」을 말할 수 있게. */
  redacted?: boolean;
}

/** DB 행 그대로의 꼴(quotes가 아직 JSON 문자열). 밖으로는 안 내보낸다. */
interface FeedbackRow extends Omit<AnswerFeedback, "quotes"> {
  quotes: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO answer_feedback (at, kind, question, answer, note, expected, screen, actor, status, fixkind, noev, quotes)
   VALUES (@at, @kind, @question, @answer, @note, @expected, @screen, @actor, 'open', @fixkind, @noev, @quotes)`
);

export function recordFeedback(e: {
  kind: FeedbackKind;
  question: string;
  answer: string;
  note?: string;
  expected?: string;
  screen?: string;
  actor?: string;
  /** 그 답에 실려 나갔던 근거없음 종류(dispatcher 출구 값). 값 집합 밖이면 서버가 버린다. */
  noev?: unknown;
  /** 그 답이 인용한 조각. 상한(3조각·600자·총 2,000자)은 서버가 자른다. */
  quotes?: unknown;
}): AnswerFeedback {
  const q = e.question.trim();
  if (!q) throw new Error("어떤 질문에 대한 지적인지가 필요합니다");
  // ⚠ 클라가 보낸 값을 그대로 믿지 않는다 — 값 집합·상한 판정은 fixboard 한 곳이 한다.
  //   ★ 근거없음은 **답 글자와 대조**한다: 답에 배너가 있으면 그 값이 이긴다(클라 주장보다
  //     서버가 본 사실이 앞선다). 배너가 없는 답에서만 클라 값을 받는다 — 배너억제 갈래는
  //     저장된 글자에 흔적이 없어 원리상 대조할 수 없다(fixboard.근거없음정하기 주석).
  const answer = (e.answer ?? "").slice(0, 4000);
  const noev = 근거없음정하기(e.noev, answer);
  const quotes = 인용정제(e.quotes);
  const row = {
    at: Date.now(),
    kind: e.kind,
    question: q.slice(0, 2000),
    answer,
    note: e.note?.trim() || null,
    expected: e.expected?.trim() || null,
    screen: e.screen ?? null,
    actor: e.actor ?? null,
    // ★ **같은 INSERT에** 얼려 넣는다. 나중에 읽을 때 다시 판정하면 그때의 사실이 아니게 된다.
    fixkind: 고칠것갈래({ kind: e.kind, noev }),
    noev,
    quotes: quotes ? JSON.stringify(quotes) : null,
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
  return { id: Number(r.lastInsertRowid), status: "open", ...row, quotes, draft: null, draftModel: null } as AnswerFeedback;
}

/** DB 행 → 밖으로 내보내는 꼴. quotes JSON을 여기 **한 곳에서만** 되읽는다. */
function 행풀기(r: FeedbackRow): AnswerFeedback {
  return { ...r, fixkind: 고칠것갈래검증(r.fixkind), quotes: 인용읽기(r.quotes) };
}

/**
 * 목록 — 화면이 보는 최근 200건. **세는 데는 쓰지 않는다**(LIMIT이 있어 201건째부터 숫자가 굳는다.
 * 「200 포화, 실제 1578」이 이 저장소에서 실제로 난 사고다). 집계는 fixboard.고칠것요약이 한다.
 */
export function listFeedback(
  days = 7,
  status?: FeedbackStatus | readonly FeedbackStatus[],
  fixkind?: 고칠것갈래값 | "unclassified",
): AnswerFeedback[] {
  const since = 기간시작(days); // ⚠ 굴림 24시간이 아니다 — 감독 화면 daily와 같은 달력을 쓴다
  const 조건: string[] = ["at >= ?"];
  const 인자: unknown[] = [since];
  const 상태들 = typeof status === "string" ? [status] : status;
  if (상태들?.length) {
    조건.push(`status IN (${상태들.map(() => "?").join(",")})`);
    인자.push(...상태들);
  }
  if (fixkind === "unclassified") 조건.push("fixkind IS NULL");
  else if (fixkind) { 조건.push("fixkind = ?"); 인자.push(fixkind); }
  const rows = db
    .prepare(`SELECT * FROM answer_feedback WHERE ${조건.join(" AND ")} ORDER BY at DESC LIMIT 200`)
    .all(...인자) as FeedbackRow[];
  return rows.map(행풀기);
}

export function getFeedback(id: number): AnswerFeedback | null {
  const r = db.prepare("SELECT * FROM answer_feedback WHERE id = ?").get(id) as FeedbackRow | undefined;
  return r ? 행풀기(r) : null;
}

/**
 * 같은 답에 몇 건이 들어왔나 — **묶지 않고 세기만 한다**(묶으면 누가 지적했는지가 사라진다).
 * 답 글자로 GROUP BY 한다: 새 칸을 만들지 않고, 이 창에 든 전부를 센다(LIMIT 없음).
 */
export function sameAnswerCounts(days = 7): Map<string, number> {
  const since = 기간시작(days);
  // ⚠ 답이 빈 지적은 **묶지 않는다.** 접수 라우트가 answer를 안 받아도 200이라, 빈 답들이
  //   빈 문자열 하나로 묶여 서로 무관한 지적에 「같은 답 3건」이라는 거짓 숫자가 붙었다
  //   (2026-09-07 검토관 wiring 실측: 질문 셋이 전부 sameAnswer=3).
  const rows = db.prepare("SELECT answer, COUNT(*) AS n FROM answer_feedback WHERE at >= ? AND TRIM(answer) <> '' GROUP BY answer")
    .all(since) as { answer: string; n: number }[];
  return new Map(rows.map((r) => [r.answer, r.n]));
}

export function setFeedbackStatus(id: number, status: FeedbackStatus, actor?: string): void {
  db.prepare("UPDATE answer_feedback SET status = ? WHERE id = ?").run(status, id);
  recordAudit({
    kind: "config",
    actor: actor ?? null,
    action: "답변 지적 처리",
    target: String(id),
    detail: FEEDBACK_STATUS_AUDIT[status],
    result: "ok",
  });
}

/** 담당자가 갈래를 고친다(또는 미분류로 되돌린다). 누가 무엇에서 무엇으로 바꿨는지 남긴다. */
export function setFeedbackKind(id: number, fixkind: 고칠것갈래값 | null, actor?: string): void {
  const 전 = getFeedback(id);
  db.prepare("UPDATE answer_feedback SET fixkind = ? WHERE id = ?").run(fixkind, id);
  recordAudit({
    kind: "config",
    actor: actor ?? null,
    action: "답변 지적 갈래 변경",
    target: String(id),
    detail: `${고칠것갈래라벨[전?.fixkind ?? "unclassified"]} → ${고칠것갈래라벨[fixkind ?? "unclassified"]}`,
    result: "ok",
  });
}

/**
 * 담당자가 승인한 **고친 최종문** — 새 칸을 만들지 않고 기존 expected에 넣는다.
 * 이 칸에는 **이미 소비자가 있다**: feedbackAsGateCases가 게이트 문항의 expect로 읽는다.
 */
export function setFeedbackExpected(id: number, expected: string | null, actor?: string): void {
  const v = expected?.trim() ? expected.trim().slice(0, 4000) : null;
  db.prepare("UPDATE answer_feedback SET expected = ? WHERE id = ?").run(v, id);
  recordAudit({
    kind: "config",
    actor: actor ?? null,
    action: "답변 지적 최종문 기록",
    target: String(id),
    detail: v ? v.slice(0, 120) : "(비움)",
    result: "ok",
  });
}

export function setFeedbackDraft(id: number, draft: string, draftModel: string): void {
  // ⚠ note는 **손대지 않는다** — 사람이 적은 사유를 기계 초안이 덮으면 지적의 뜻이 바뀐다.
  db.prepare("UPDATE answer_feedback SET draft = ?, draftModel = ? WHERE id = ?").run(draft, draftModel, id);
}

/** 무를 수 있는 시간 — 접수 60초. 「지적은 안 버린다」와 「잘못 누른 것은 기록이 아니다」의 절충. */
export const 무르기시간_MS = 60000;

/**
 * 접수 직후 무르기 — **본인만·60초 안에만** 행을 지운다. 그 뒤로는 dismissed로만 닫는다.
 * 지운 사실 자체는 감사에 남는다(무엇을 지웠는지는 남기지 않는다 — 지운 것을 되살릴 통로가 아니다).
 */
export function deleteFeedback(id: number, actor: string | undefined): { ok: true } | { ok: false; reason: string } {
  const row = getFeedback(id);
  if (!row) return { ok: false, reason: "해당 지적을 찾지 못했습니다" };
  if (!actor || row.actor !== actor) return { ok: false, reason: "본인이 접수한 지적만 무를 수 있습니다" };
  if (Date.now() - row.at > 무르기시간_MS) {
    return { ok: false, reason: "접수 1분이 지나 무를 수 없습니다 — 결재판에서 「부적합」으로 닫아 주세요" };
  }
  db.prepare("DELETE FROM answer_feedback WHERE id = ?").run(id);
  recordAudit({ kind: "config", actor, action: "답변 지적 무름(접수 취소)", target: String(id), detail: "접수 1분 안 본인 취소", result: "ok" });
  return { ok: true };
}

/**
 * 주간 요약 — 계획서 중-1의 "주간 수집". 챗봇·보고에 그대로 쓴다.
 *
 * ⚠ 상세(남이 낸 질문·담당자 사유 8줄)는 **기본이 꺼짐**이다(2026-09-07 검토관 wiring).
 *   같은 라운드가 결재판을 admin으로 닫았는데, 이 글을 그대로 내보내는 대화 도구
 *   (answer_feedback_status)는 누구나 부를 수 있어 **한 원장에 자물쇠가 두 벌**이었다.
 *   도구 쪽에 역할을 거는 것이 정석이나 그 파일(registry.ts)은 이 라운드의 소유가 아니라,
 *   **기본값을 안전한 쪽으로** 돌린다 — 건수·갈래는 신호라 누구에게나 나간다.
 *   (registry.ts에 requiredRole:"admin"을 다는 일은 인계 목록에 적었다.)
 */
export function feedbackSummaryText(days = 7, 상세 = false): string {
  // ★ 숫자는 전부 fixboard.고칠것요약에서 온다 — listFeedback으로 세면 201건째부터 굳는다.
  //   목록(아래 미처리 8줄)만 listFeedback에서 가져온다(그건 세는 게 아니라 보여 주는 것).
  const s = 고칠것요약(days);
  if (s.total === 0) {
    return [
      `최근 ${days}일 동안 접수된 답변 지적이 없습니다.`,
      "답이 틀렸거나 못 찾았을 때 알려주시면 그 질문이 회귀 검사 문항 후보가 됩니다 — 같은 실수가 다시 나가지 않게 하는 가장 빠른 길입니다.",
    ].join("\n");
  }
  const open = 상세 ? listFeedback(days, "open") : [];
  const 갈래줄 = s.kinds
    .filter((k) => k.total > 0)
    .map((k) => `${고칠것갈래라벨[k.fixkind]} ${k.total}건(열림 ${k.open})`)
    .join(" · ");
  return [
    // ⚠ 「미처리」가 아니라 「아직 고칠 것」이다 — 이 숫자는 open+promoted를 센다(회귀 문항으로
    //   옮겨 적은 것은 처리했지만 **고친 것은 아니다**). 이름과 잣대를 맞춰 둔다.
    `최근 ${days}일 답변 지적 ${s.total}건 (아직 고칠 것 ${s.open}건)`,
    `종류별: ${Object.entries(s.byKind).map(([k, n]) => `${FEEDBACK_KIND_LABEL[k as FeedbackKind] ?? k} ${n}`).join(" · ")}`,
    `고칠 것 갈래: ${갈래줄}`,
    "",
    ...(상세
      ? open.slice(0, 8).map((r) => `  · [${FEEDBACK_KIND_LABEL[r.kind]}] "${r.question.slice(0, 50)}" — ${r.note ?? "사유 미기재"}`)
      : ["질문·사유 원문은 결재판(관리자)에서 봅니다 — 여기서는 건수만 알려 드립니다."]),
    "",
    "이 지적들은 회귀 검사 문항 후보로 모아 둡니다(자동 편입은 하지 않습니다 — 사람이 검토합니다).",
  ].join("\n");
}

/**
 * 평가 게이트 문항 초안 — 지적을 그대로 문항 꼴로 옮긴다.
 * expect는 담당자가 적어 준 정답에서만 만든다(없으면 비운다) — 우리가 지어내면 지적의 뜻이 바뀐다.
 * 편입은 사람이 tools/evalgate/cases/*.json에 옮기며 결정한다.
 * ⚠ 상태는 fixboard.회귀문항후보상태 하나가 정한다 — open(아직 고칠 것) + resolved(고쳤으니
 *   지켜야 할 것). 2026-09-07에 뒤집었다: open만 내던 때는 **고친 지적일수록 회귀셋에서
 *   사라졌고**, 그건 「지적은 회귀셋으로 흡수」(계획서 중-1)와 정반대였다. 정답(expected)은
 *   보통 닫을 때 적히므로, 그때가 문항으로서 가장 쓸모 있는 순간이다.
 *   promoted는 안 낸다(이미 옮겨 적었다) · dismissed도 안 낸다(문항 감이 아니라고 했다).
 */
export function feedbackAsGateCases(days = 30): {
  id: string;
  q: string;
  expect?: string[];
  screen?: string;
  _출처: string;
}[] {
  return listFeedback(days, 회귀문항후보상태)
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

// ── 초안 ────────────────────────────────────────────────────────────────

/** 초안을 맡는 팀원 — 자료·규정은 사서(curator), 제품은 우선(analysis). 등록부 id 그대로다. */
export function 초안팀원(fixkind: 고칠것갈래값 | null, kind: FeedbackKind): string {
  return (fixkind ?? 고칠것후보(kind)) === "prod" ? "analysis" : "curator";
}

/** 초안 프롬프트 — **재검색 금지**. 그 답이 인용했던 조각만 근거로 쓴다. */
export function 초안프롬프트(r: AnswerFeedback): string {
  const 조각 = (r.quotes ?? []).map((q, i) => `(${i + 1}) ${q.title || q.documentId}\n${q.text}`).join("\n\n");
  return [
    "담당자가 아래 답을 「이상하다」고 지적했습니다. 고친 답의 **초안**을 쓰세요.",
    "",
    "규칙:",
    "· 아래 [인용 조각] 밖의 사실을 쓰지 마세요. 새로 찾아보지도 마세요.",
    "· 조각으로 확인할 수 없는 것은 「자료에 없어 확인하지 못했습니다」라고 그대로 적으세요.",
    "· 5줄 이내. 인사말·머리말 없이 답만.",
    "· 무엇을 등록·수정·처리했다고 쓰지 마세요 — 이건 초안일 뿐 아무것도 바꾸지 않습니다.",
    "",
    `[지적 종류] ${FEEDBACK_KIND_LABEL[r.kind]}`,
    `[질문] ${r.question}`,
    `[나간 답] ${r.answer.slice(0, 1500)}`,
    r.note ? `[담당자 사유] ${r.note}` : "",
    r.expected ? `[담당자가 아는 정답] ${r.expected}` : "",
    "",
    "[인용 조각]",
    조각,
  ].filter(Boolean).join("\n");
}

/** 관문 한 번의 결과 중 **우리가 쓰는 세 칸**만 본다 — gateway를 정적으로 물지 않기 위해서다. */
type 관문판정 = (text: string, source: "content") => { allowed: boolean; text: string; message?: string };

/**
 * 초안 재료를 **관문(가드레일)에 태운다** — 개인정보를 가리고, 해로운 글이면 만들지 않는다.
 *
 * ⚠ 왜 필요한가(2026-09-07 검토관 wiring): 초안은 chat({trusted:true})로 부른다. 그런데 그
 *   프롬프트의 재료(note·expected·인용)는 **접수 창구**(POST /api/answer-feedback ·
 *   authMiddleware만 · 누구나)로 들어온 자유입력이라 게이트를 한 번도 안 지난 글이다.
 *   llm.ts가 「사용자 입력을 처음 받는 경로에서는 trusted를 켜지 말라」고 못 박은 계약을
 *   정면으로 어기고 있었다 — 실측: 사유에 적은 주민등록번호가 프롬프트에 원문 그대로 실렸다.
 * ⚠ 접수 때가 아니라 **여기서** 태운다: 원장에는 담당자가 쓴 말이 그대로 남아야 하고
 *   (expected는 회귀 문항의 정답이 된다 — 가리면 문항이 망가진다), 위험은 「LLM에 닿는 순간」에
 *   생긴다. 그래서 저장은 원문, LLM에 넘기는 사본만 가린 것이다.
 * ⚠ **source는 "content"다**(2026-09-10 검토관 적발 wiring·수리). 여기 오는 글은 담당자가 지금
 *   시키는 지시가 아니라 **제품 자신의 답·인용 조각**이다. "chat"으로 태우면 가해 판정이 걸려,
 *   피싱·랜섬웨어 사고를 다룬 답 한 칸만 있어도 초안이 통째로 죽고 담당자에게 「정보통신망법
 *   위반이며 도와드릴 수 없습니다」가 뜬다(실측: 우리 지식 코퍼스 1,018조각 중 62조각이 막혔다 —
 *   「자기차단 함정」의 재발). 개인정보 가림과 인젝션 검사는 content에서도 **그대로** 지난다.
 * ⚠ gateUserInput이 아니라 **Inner**를 쓴다: ① 이건 사람이 처음 말을 넣는 자리가 아니라
 *   저장된 글을 LLM에 넘기기 직전의 검사라 guard 실동작 신호를 부풀리면 안 되고(dispatcher의
 *   설명 도구가 같은 이유로 Inner를 쓴다 — gateway.ts 머리글) ② 관문 입구 등록부
 *   (gatewaypii 「정확히 이 5곳」)는 **사용자 입구**의 목록이어야 한다. 이 경로가 관문을
 *   빠져나가지 않는지는 이 파일의 짝 시험(answerfeedback.test ⓠ)이 소스로 지킨다.
 */
export function 초안재료가림(
  r: AnswerFeedback,
  태우기: 관문판정,
): { 재료: AnswerFeedback } | { 막힘: string } {
  let 막힘: string | null = null;
  const 태워서 = <T extends string | null>(t: T): T => {
    if (!t) return t;
    const g = 태우기(t, "content");
    if (!g.allowed && !막힘) 막힘 = g.message || "입구 검사에 걸리는 글이 들어 있습니다";
    return g.text as T;
  };
  const 재료: AnswerFeedback = {
    ...r,
    question: 태워서(r.question),
    answer: 태워서(r.answer),
    note: 태워서(r.note),
    expected: 태워서(r.expected),
    quotes: (r.quotes ?? []).map((q) => ({ ...q, text: 태워서(q.text) })),
  };
  return 막힘 ? { 막힘 } : { 재료 };
}

/**
 * 수정 초안 만들기 — **담당자가 누를 때만** 돈다(동기).
 *
 * ⚠ 인용 조각이 0개면 **만들지 않는다.** 재료 없이 쓰면 지어내는 것이고, 그건 이 표가 잡으려는
 *   바로 그 해악이다. 「초안 없음」이라 말하고 아무것도 저장하지 않는다.
 * ⚠ 출력은 falseclaim 출구(거짓완료차단)를 지난다 — 초안이 「수정했습니다」라 말하면 안 된다.
 * ⚠ **누른 사람의 눈으로 열람 등급을 본다**(2026-09-07 검토관 honesty [높음]). 이 검사가 없으면
 *   못 볼 등급의 문서를 인용한 지적에서 초안을 눌러 **그 문서 내용을 초안 칸으로 받아낼 수**
 *   있었다 — 목록은 가리면서 초안은 만들어 주는 반쪽 게이트였다. req를 **필수 인자**로 둔 것이
 *   그 방지책이다(빠뜨리면 컴파일이 안 된다).
 * ⚠ llm.ts는 **동적으로** 부른다(0줄 편집). 정적 import를 더하면 이 파일을 import하는 시험이
 *   전부 llm 목의 표면을 따라가야 한다(2026-09-05 noevidence 이관 때 66건이 그렇게 빨개졌다).
 */
export async function buildFeedbackDraft(id: number, req: Request): Promise<{ draft: string | null; reason?: string; draftModel?: string }> {
  const r = getFeedback(id);
  if (!r) return { draft: null, reason: "해당 지적을 찾지 못했습니다" };
  if (!r.quotes?.length) return { draft: null, reason: "초안 없음 — 이 답이 인용한 사내 자료가 없어 근거로 쓸 재료가 없습니다" };
  const { 열람불가공용 } = await import("./memory.js");
  if (r.quotes.some((q) => 열람불가공용(q.documentId, req))) {
    return { draft: null, reason: "초안 없음 — 이 답이 인용한 사내 자료 중 열람 등급이 달라 보실 수 없는 것이 있습니다" };
  }
  const { gateUserInputInner } = await import("./gateway.js");
  const 태운 = 초안재료가림(r, gateUserInputInner);
  if ("막힘" in 태운) return { draft: null, reason: `초안 없음 — ${태운.막힘}` };
  const agentId = 초안팀원(r.fixkind, r.kind);
  const { chat } = await import("./llm.js");
  const { getAgentModel } = await import("./agents.js");
  const { 거짓완료차단 } = await import("./falseclaim.js");
  const raw = await chat({
    agentId,
    // ★ 원문(r)이 아니라 **관문을 지난 사본**을 넘긴다 — 원문을 넘기면 위 가림이 장식이 된다.
    message: 초안프롬프트(태운.재료),
    // remember:false(기본) — RAG·대화 이력을 켜지 않는다. **재검색 금지**가 이 한 줄이다.
    // ★ 재료는 바로 위에서 **관문을 지났다**(초안재료가림) — 여기부터가 우리가 조립한 내부
    //   프롬프트라 trusted가 옳다(자기차단 함정 방지). 관문을 빼면 이 줄이 계약 위반이 된다.
    trusted: true,
    noLearn: true, // 초안 문답이 학습 후보함에 쌓이면 실사용 분포가 오염된다
    maxTokens: 700,
  });
  const draft = 거짓완료차단(r.question, String(raw ?? ""), false).답;
  const draftModel = `${agentId} · ${getAgentModel(agentId) ?? "기본 모델"}`;
  setFeedbackDraft(id, draft, draftModel);
  return { draft, draftModel };
}

// ── 등급 ────────────────────────────────────────────────────────────────

/**
 * 목록·상세를 내보내기 전에 **열람 등급을 한 번 더 태운다**(통합 설계관 ⑪).
 *
 * ⚠ admin으로 창구를 닫아도 끝이 아니다 — **개인 문서·기밀 등급은 admin 위가 아니다.**
 *   quotes에 사내 문서 원문이 실리므로, 그대로 내보내면 결재판이 새 「직접-열람 창구」가 된다.
 * ⚠ 잣대는 memory.열람불가공용 **하나**다(여기서 등급을 다시 계산하지 않는다).
 * ⚠ 못 볼 조각이 하나라도 있으면 **답 본문도, 초안도 가린다** — 답은 그 조각을 근거로 쓴 글이고
 *   초안은 그 조각만 근거로 쓰라고 시켜 만든 글이라(초안프롬프트 「조각 밖 사실 금지」),
 *   조각만 떼면 같은 내용이 두 칸에 그대로 남는다. 모르면 감춘다(fail-closed).
 *   ⚠ 초안을 빠뜨렸던 것이 2026-09-07 검토관 honesty [높음] 적발이다 — 가린 조각의 문장이
 *     draft 칸으로 그대로 나갔다("대외비 임금표에 따르면 3년입니다").
 */
async function 등급가림(rows: AnswerFeedback[], req: Request): Promise<AnswerFeedback[]> {
  if (!rows.length) return rows;
  const { 열람불가공용 } = await import("./memory.js");
  return rows.map((r) => {
    const 볼수있는 = (r.quotes ?? []).filter((q) => !열람불가공용(q.documentId, req));
    if (볼수있는.length === (r.quotes ?? []).length) return r;
    return {
      ...r,
      answer: "(열람 등급이 달라 이 답의 본문과 근거 조각을 가렸습니다)",
      quotes: 볼수있는,
      draft: null,       // 초안은 그 조각들을 다시 쓴 글이다 — 함께 가린다
      draftModel: null,  // 초안이 없는데 작성자만 남으면 화면이 「초안 있음」으로 읽는다
      redacted: true,
    };
  });
}

export function registerAnswerFeedbackRoutes(app: Express): void {
  app.post(
    "/api/answer-feedback",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const b = req.body as {
        kind?: FeedbackKind; question?: string; answer?: string; note?: string; expected?: string;
        screen?: string; noev?: unknown; quotes?: unknown;
      };
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
          noev: b.noev,
          quotes: b.quotes,
          actor: (req as Request & { user?: GijoUser }).user?.displayName,
        }));
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    })
  );

  // ★ 조회는 **admin**이다(2026-09-07). 응답에 답 4,000자·질문 2,000자에 더해 **사내 문서 원문
  //   조각**까지 실린다 — authMiddleware만으로는 등급 게이트 밖의 직접-열람 창구가 된다.
  app.get("/api/answer-feedback", authMiddleware, adminMiddleware, asyncRoute(async (req, res) => {
    // ⚠ 기간 정리는 fixboard.기간정리 하나가 한다 — 손으로 Math.min/max를 쓰면 NaN이 새고,
    //   그러면 200과 함께 「지적이 없습니다」라고 **거짓 단언**을 한다(2026-09-07 검토관 실측).
    const days = 기간정리(req.query.days, 7);
    const status = FEEDBACK_STATUSES.includes(String(req.query.status ?? "") as FeedbackStatus)
      ? (String(req.query.status) as FeedbackStatus) : undefined;
    const q참 = String(req.query.fixkind ?? "");
    const fixkind = q참 === "unclassified" ? "unclassified" : (고칠것갈래검증(q참) ?? undefined);
    const 셈 = sameAnswerCounts(days);
    const entries = await 등급가림(
      listFeedback(days, status, fixkind).map((r) => ({ ...r, sameAnswer: 셈.get(r.answer) ?? 1 })),
      req as Request
    );
    // 상세(질문·사유 8줄)는 이 창구에서만 켠다 — admin이 지나온 문이다.
    res.json({ days, entries, summary: feedbackSummaryText(days, true), fixboard: 고칠것요약(days) });
  }));

  // 상태 변경은 admin — 지적을 회귀 문항으로 편입할지 접을지는 품질 판단이다.
  // expected(고친 최종문)를 같은 몸에 실어 보낼 수 있다 — 승인과 최종문은 한 동작이다.
  app.post("/api/answer-feedback/:id/status", authMiddleware, adminMiddleware, (req, res) => {
    const body = (req.body ?? {}) as { status?: string; expected?: string };
    const status = String(body.status ?? "");
    if (!FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
      res.status(400).json({ error: `status는 ${FEEDBACK_STATUSES.join("·")} 중 하나여야 합니다` });
      return;
    }
    const id = Number(req.params.id);
    // 없는 id에 200을 돌려주면 화면이 처리된 줄 안다 — 없으면 없다고 말한다.
    const exists = db.prepare("SELECT 1 FROM answer_feedback WHERE id = ?").get(id);
    if (!exists) {
      res.status(404).json({ error: "해당 지적을 찾지 못했습니다" });
      return;
    }
    const actor = (req as Request & { user?: GijoUser }).user?.displayName;
    if (typeof body.expected === "string") setFeedbackExpected(id, body.expected, actor);
    setFeedbackStatus(id, status as FeedbackStatus, actor);
    res.json({ ok: true });
  });

  // 갈래 바꾸기 — 담당자가 doc·rule·prod 중에서 고른다(null이면 미분류로 되돌린다).
  app.post("/api/answer-feedback/:id/fixkind", authMiddleware, adminMiddleware, (req, res) => {
    const raw = (req.body as { fixkind?: unknown })?.fixkind ?? null;
    const fixkind = raw === null ? null : 고칠것갈래검증(raw);
    if (raw !== null && !fixkind) {
      res.status(400).json({ error: "fixkind는 doc·rule·prod 또는 null이어야 합니다" });
      return;
    }
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM answer_feedback WHERE id = ?").get(id)) {
      res.status(404).json({ error: "해당 지적을 찾지 못했습니다" });
      return;
    }
    setFeedbackKind(id, fixkind, (req as Request & { user?: GijoUser }).user?.displayName);
    res.json({ ok: true, fixkind });
  });

  // 고친 최종문만 따로 적는 자리(승인과 나눠 하고 싶을 때). 저장 칸은 status 라우트와 같다.
  app.post("/api/answer-feedback/:id/expected", authMiddleware, adminMiddleware, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM answer_feedback WHERE id = ?").get(id)) {
      res.status(404).json({ error: "해당 지적을 찾지 못했습니다" });
      return;
    }
    const v = (req.body as { expected?: unknown })?.expected;
    setFeedbackExpected(id, typeof v === "string" ? v : null, (req as Request & { user?: GijoUser }).user?.displayName);
    res.json({ ok: true });
  });

  // 수정 초안 — 담당자가 누를 때만 돈다. 재료(인용)가 없으면 만들지 않는다.
  app.post("/api/answer-feedback/:id/draft", authMiddleware, adminMiddleware, asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM answer_feedback WHERE id = ?").get(id)) {
      res.status(404).json({ error: "해당 지적을 찾지 못했습니다" });
      return;
    }
    res.json(await buildFeedbackDraft(id, req as Request));
  }));

  // 무르기 — 접수 60초 안·본인만. 그 뒤로는 결재판에서 dismissed로 닫는다.
  app.delete("/api/answer-feedback/:id", authMiddleware, (req, res) => {
    const r = deleteFeedback(Number(req.params.id), (req as Request & { user?: GijoUser }).user?.displayName);
    if (r.ok) { res.json({ ok: true }); return; }
    res.status(r.reason.includes("찾지 못했") ? 404 : 403).json({ error: r.reason });
  });

  // 게이트 문항 초안 내보내기 — 개발 쪽에서 tools/evalgate/cases에 옮길 때 쓴다.
  // ⚠ admin이다 — 질문·담당자 사유·정답이 그대로 실린다(위 목록과 같은 등급의 글).
  app.get("/api/answer-feedback/gate-cases", authMiddleware, adminMiddleware, (req, res) => {
    res.json({ cases: feedbackAsGateCases(기간정리(req.query.days, 30)) });
  });
}
