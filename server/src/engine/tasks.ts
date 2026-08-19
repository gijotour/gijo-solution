// engine/tasks.ts — 작업 큐 (서버 측, 전 클라이언트 공유, SQLite 영속화)

import { 라이브모드 } from "./datacleanup";
import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import { db, assertTestDb } from "../db";
import { guessGuideKey, defaultRoutines } from "./workguide";

export interface TaskItem {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  text: string;
  agentId?: string;
  done: boolean;
  createdAt: number;
  dueAt?: number; // SLA 기한(ms). 없으면 기한 없음.
  assignee?: string; // 담당자
  ref?: string; // 연결된 취약점/자산 참조 (예: "vuln:192.168.219.98")
  completedAt?: number; // 완료 처리 시각(ms) — MTTR 산출용. 미완료면 없음.
  // ── 내 업무 화면(2026-07-31) ──
  recur?: "weekly" | "monthly"; // 반복 주기. 완료하면 다음 주기 항목이 새로 생긴다.
  origin?: "me" | "ai" | "routine"; // 어디서 온 일인가 — 화면에서 색·배지로 구분한다.
  guideKey?: string; // 진행 가이드 템플릿(workguide.ts). 없으면 가이드 없는 단순 할 일.
  guideDone?: number[]; // 끝낸 단계 번호. 화면을 닫았다 열어도 진행이 남는다.
}

interface TaskRow {
  id: string;
  priority: TaskItem["priority"];
  text: string;
  agentId: string | null;
  done: number;
  createdAt: number;
  dueAt: number | null;
  assignee: string | null;
  ref: string | null;
  completedAt: number | null;
  recur: string | null;
  origin: string | null;
  guideKey: string | null;
  guideDone: string | null;
}

/** 끝낸 단계 목록 읽기 — 저장이 깨져 있어도 화면이 죽지 않게 조용히 빈 목록으로 떨어진다. */
function parseGuideDone(raw: string | null): number[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : undefined;
  } catch {
    return undefined;
  }
}

function fromRow(row: TaskRow): TaskItem {
  return {
    id: row.id,
    priority: row.priority,
    text: row.text,
    agentId: row.agentId ?? undefined,
    done: row.done === 1,
    createdAt: row.createdAt,
    dueAt: row.dueAt ?? undefined,
    assignee: row.assignee ?? undefined,
    ref: row.ref ?? undefined,
    completedAt: row.completedAt ?? undefined,
    recur: row.recur === "weekly" || row.recur === "monthly" ? row.recur : undefined,
    origin: row.origin === "me" || row.origin === "ai" || row.origin === "routine" ? row.origin : undefined,
    guideKey: row.guideKey ?? undefined,
    guideDone: parseGuideDone(row.guideDone),
  };
}

const insertStmt = db.prepare(
  "INSERT INTO tasks (id, priority, text, agentId, done, createdAt, dueAt, assignee, ref, recur, origin, guideKey, guideDone) VALUES (@id, @priority, @text, @agentId, @done, @createdAt, @dueAt, @assignee, @ref, @recur, @origin, @guideKey, @guideDone)"
);
const completeStmt = db.prepare("UPDATE tasks SET done = 1, completedAt = COALESCE(completedAt, @now) WHERE id = @id");
const setDoneStmt = db.prepare("UPDATE tasks SET done = @done, completedAt = @completedAt WHERE id = @id");
const deleteStmt = db.prepare("DELETE FROM tasks WHERE id = ?");
const updatePriorityStmt = db.prepare("UPDATE tasks SET priority = ? WHERE id = ?");
const listStmt = db.prepare("SELECT * FROM tasks ORDER BY createdAt ASC");

export function createTask(args: {
  text: string;
  agentId?: string;
  priority?: TaskItem["priority"];
  dueAt?: number;
  assignee?: string;
  ref?: string;
  recur?: TaskItem["recur"];
  origin?: TaskItem["origin"];
  guideKey?: string;
  /** 같은 일이 이미 있어도 새로 만든다(되풀이 일정처럼 일부러 여러 건이 필요한 경우). */
  중복허용?: boolean;
}): TaskItem {
  // ★ 2026-08-04 실화면에서 발견: 대시보드 「오늘 할 일」에 **같은 줄이 2~4개**씩 있었다.
  //   「기한 지난 유지보수 점검 6건 수행」 ×3 · 「FOCS 메뉴얼 ver1 2 정기점검」 ×4 …
  //   원인은 「＋ 할 일로 담기」를 누를 때마다 무조건 새로 만든 것. 담당자는 자기가
  //   담았는지 기억하지 못해 다시 누르고, 목록은 같은 줄로 불어난다 — 그러면 목록 자체를
  //   안 믿게 된다(파트너 지적 「한꺼번에 너무 많은 정보」와 같은 병이다).
  // ⚠ **끝난 일과는 견주지 않는다.** 지난주에 끝낸 「주간 점검」을 이번 주에 다시 담는 것은
  //   중복이 아니라 정상이다. 아직 안 끝난 같은 일이 있을 때만 그것을 돌려준다.
  const 글 = args.text.trim();
  if (!args.중복허용 && 글) {
    const 이미 = listTasks({ includeAgentRuns: true }).find((t) => !t.done && t.text.trim() === 글);
    if (이미) return 이미;
  }
  // 가이드는 명시하지 않으면 문장·참조로 고른다 — 담당자가 "무슨 유형인지" 고를 필요가 없게.
  // 확신이 없으면 guessGuideKey가 null을 준다(엉뚱한 가이드보다 없는 편이 낫다).
  const guideKey = args.guideKey ?? guessGuideKey(args.text, args.ref) ?? undefined;
  const item: TaskItem = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    priority: args.priority ?? "P2",
    text: args.text,
    agentId: args.agentId,
    done: false,
    createdAt: Date.now(),
    dueAt: args.dueAt,
    assignee: args.assignee?.trim() || undefined,
    ref: args.ref,
    recur: args.recur,
    origin: args.origin,
    guideKey,
    guideDone: undefined,
  };
  insertStmt.run({
    id: item.id,
    priority: item.priority,
    text: item.text,
    agentId: item.agentId ?? null,
    done: item.done ? 1 : 0,
    createdAt: item.createdAt,
    dueAt: item.dueAt ?? null,
    assignee: item.assignee ?? null,
    ref: item.ref ?? null,
    recur: item.recur ?? null,
    origin: item.origin ?? null,
    guideKey: item.guideKey ?? null,
    guideDone: null,
  });
  return item;
}

const setGuideDoneStmt = db.prepare("UPDATE tasks SET guideDone = ? WHERE id = ?");
const getTaskStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");

export function getTask(id: string): TaskItem | null {
  const row = getTaskStmt.get(id) as TaskRow | undefined;
  return row ? fromRow(row) : null;
}

/** 가이드 단계 하나를 끝냈다고 표시한다(되돌리기도 같은 함수로 — 담당자가 잘못 눌렀을 수 있다). */
export function setGuideStepDone(id: string, step: number, done: boolean): TaskItem | null {
  const t = getTask(id);
  if (!t) return null;
  const set = new Set(t.guideDone ?? []);
  if (done) set.add(step); else set.delete(step);
  setGuideDoneStmt.run(JSON.stringify([...set].sort((a, b) => a - b)), id);
  return getTask(id);
}

/**
 * 반복 업무의 다음 차례를 만든다.
 *
 * ⚠ 원본을 되살리지 않고 **새 항목을 만든다.** 같은 줄을 미완료로 되돌리면 "지난주에 했다"는
 *   기록이 사라져 점검 이력이 끊긴다 — 보안 업무에서 그건 그냥 사고다.
 *   기준일은 완료 시각이 아니라 **원래 기한**이다. 늦게 끝냈다고 다음 주기까지 밀리면
 *   매주 조금씩 뒤로 밀려 결국 주기가 무너진다(월요일 점검이 목요일 점검이 된다).
 */
export function nextRecurrence(t: TaskItem, now = Date.now()): TaskItem | null {
  if (!t.recur) return null;
  const base = t.dueAt ?? now;
  const d = new Date(base);
  if (t.recur === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  // 한참 방치돼 다음 기한도 이미 지났으면 오늘 이후로 당겨 온다(밀린 것을 몇 개씩 만들지 않는다).
  while (d.getTime() < now) {
    if (t.recur === "weekly") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  }
  return createTask({
    text: t.text,
    priority: t.priority,
    dueAt: d.getTime(),
    assignee: t.assignee,
    ref: t.ref,
    recur: t.recur,
    origin: t.origin,
    guideKey: t.guideKey,
    // ⚠ 되풀이 일정은 **일부러 다음 회차를 만드는 것**이다 — 중복 막이에 걸리면
    //   이번 주 것을 끝내도 다음 주 것이 안 생긴다(기능이 조용히 죽는다).
    중복허용: true,
  });
}

// ⚠ 돌려주는 목록에 실행 기록까지 포함한다. 디스패처가 방금 만든 자기 기록을 이 목록에서
//   되찾아 응답에 싣기 때문이다(dispatcher.ts) — 걸러 버리면 못 찾아서 "완료 안 됨"으로
//   응답한다. 화면에 뿌릴 때 거르는 일은 라우트가 한다.
export function completeTask(id: string): TaskItem[] {
  completeStmt.run({ id, now: Date.now() });
  return listTasks({ includeAgentRuns: true });
}

// 완료 ↔ 미완료 토글 (담당자가 체크박스로 진행 상태를 직접 바꾼다).
// 완료로 바꾸면 완료시각을 남기고(MTTR용), 미완료로 되돌리면 비운다.
//
// 반복 업무를 완료하면 **다음 차례를 새로 만든다**(nextRecurrence 주석 참고).
// ⚠ 되돌릴 때는 다음 차례를 지우지 않는다 — 이미 만들어진 다음 주기 항목을 손대면
//   담당자가 거기에 적어 둔 진행이 날아간다. 잘못 만든 항목은 직접 지우면 된다.
export function setTaskDone(id: string, done: boolean): TaskItem[] {
  const before = done ? getTask(id) : null;
  setDoneStmt.run({ id, done: done ? 1 : 0, completedAt: done ? Date.now() : null });
  if (done && before?.recur && !before.done) nextRecurrence(before);
  return listTasks();
}

export function deleteTask(id: string): TaskItem[] {
  deleteStmt.run(id);
  return listTasks();
}

export function updateTaskPriority(id: string, priority: TaskItem["priority"]): TaskItem[] {
  updatePriorityStmt.run(priority, id);
  return listTasks();
}

// ⚠ 이 표에는 성격이 다른 둘이 섞여 있다(2026-07-28 실측으로 드러남).
//   ① 담당자의 할 일 — 화면에서 적었거나 조치로 등록된 것. agentId가 비어 있다.
//   ② 지시 실행 기록 — dispatchInstruction이 지시 한 건마다 만들고 곧바로 완료 처리하는 것.
//      어느 에이전트가 처리했는지 남기려는 것이라 agentId가 반드시 있다.
// 화면의 "오늘 할 일"에 ②까지 나오는 바람에, 운영 DB에 1,688건이 쌓여 정작 할 일이 그 밑에
// 파묻혔다 — "대한민국 수도가 어디야?", "고마워 수고했어" 같은 챗봇 질문이 할 일로 보였다.
// 그래서 **기본은 ①만** 준다. ②가 필요한 자리(디스패처 자신)는 명시적으로 켠다.
// 표를 나누지 않은 이유: agentId가 이미 정확한 구분자라 옮길 게 없고, 마이그레이션으로 남의
// 기록을 건드릴 위험도 없다.
export function listTasks(opts?: { includeAgentRuns?: boolean }): TaskItem[] {
  const all = (listStmt.all() as TaskRow[]).map(fromRow);
  return opts?.includeAgentRuns ? all : all.filter((t) => !t.agentId);
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetTasksForTests(): void {
  assertTestDb("resetTasksForTests");
  db.exec("DELETE FROM tasks");
}

// 첫 실행에 "오늘 확인할 항목"·KPI SLA가 비어 보이지 않게 예시 조치 항목 3건을 시드한다
// (assets.ts의 샘플 취약점 호스트와 연결). 취약점 연결 조치가 하나라도 있으면 끼어들지 않는다.
export function seedSampleRemediationTasksIfEmpty(): void {
  // 실사용 전환 뒤에는 샘플을 되살리지 않는다(2026-08-19 사장님 「진짜 빈 상태」 —
  // 리셋 후 재기동 때 시드가 데모를 복원하던 함정을 datacleanup의 라이브 모드가 막는다).
  if (라이브모드()) return;
  if (listTasks().some((t) => (t.ref ?? "").startsWith("vuln:"))) return;
  const day = 86400000;
  createTask({ text: "[조치] Apache Log4j RCE — 샘플-웹서버", priority: "P0", dueAt: Date.now() + 5 * day, assignee: "샘플담당", ref: "vuln:sample-web01" });
  createTask({ text: "[조치] OpenSSH 업데이트 — 샘플-웹서버", priority: "P1", dueAt: Date.now() - 2 * day, assignee: "샘플담당", ref: "vuln:sample-web01" }); // 기한 초과
  createTask({ text: "[조치] Oracle CPU 적용 — 샘플-웹서버", priority: "P2", dueAt: Date.now() + 2 * day, assignee: "샘플담당", ref: "vuln:sample-web01" }); // 임박
}
seedSampleRemediationTasksIfEmpty();

// ── "오늘 확인할 항목" 추천 가이드 ───────────────────────────────────────
// + 버튼에서 매일/매주 일과를 추천한다. 근거는 ① 팀장이 직접 추가해온 일과(routine_feedback —
// 다음 추천에 반영되는 학습 신호이자 datasets/routine-feedback.json 파인튜닝 축적) ② 사내
// 지식(RAG) 근거 LLM 제안 ③ LLM 미기동 시 기본 가이드(규칙 기반, 정직한 폴백).
const insertRoutineFbStmt = db.prepare("INSERT INTO routine_feedback (text, addedAt) VALUES (?, ?)");
const listRoutineFbStmt = db.prepare("SELECT text FROM routine_feedback ORDER BY addedAt DESC LIMIT 8");

/**
 * 일과로 배울 만한 문장인가 — **질문은 업무가 아니다.**
 *
 * ⚠ 실사고(2026-07-31, '내 업무' 화면에서 눈으로 발견): 할일 칸에 챗봇처럼 물어본 문장들이
 *   그대로 학습돼 "자주 하는 업무" 추천에 떴다 — `+ 머할까?`, `+ 오늘뭐부터볼까`,
 *   `+ 내가 제일 먼저 처리해야될 일이 어떤게 있을까?`. 누르면 그런 이름의 업무가 생긴다.
 *   담당자는 그걸 보고 "이 제품 뭐지"라고 생각한다.
 *
 * 읽을 때도 같은 잣대로 거른다 — 이미 쌓인 것을 지우는 마이그레이션 없이 화면에서 사라진다.
 * (지우지 않는 이유: 남의 입력 기록을 조용히 삭제하는 것보다 안 쓰는 편이 안전하다.)
 */
export function isRoutineWorthy(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 4 || t.length > 60) return false;
  if (/[?？]\s*$/.test(t)) return false; // 물음표로 끝나면 질문이다
  // 물음 어미·의문사 — 업무 문장에는 나올 이유가 없다.
  if (/(뭐|무엇|머할|할까|뭘까|어떤게|어떤 게|어디|언제|누가|왜|알려줘|보여줘|해줘|일까)/.test(t)) return false;
  return true;
}

export function recordRoutineFeedback(text: string): void {
  if (!isRoutineWorthy(text)) return; // 질문은 일과로 배우지 않는다
  insertRoutineFbStmt.run(text, Date.now());
  // 파인튜닝 데이터셋에도 축적 — 실패해도 할일 추가는 성공 처리(부가 경로).
  import("./dataset.js")
    .then((d) => d.appendRoutineExample(text))
    .catch((err) => console.warn(`[tasks] 루틴 데이터셋 축적 실패: ${err instanceof Error ? err.message : String(err)}`));
}

export interface RoutineSuggestion {
  cadence: "daily" | "weekly";
  text: string;
  source: string;
}

export async function routineSuggestions(): Promise<RoutineSuggestion[]> {
  // ⚠ 읽을 때도 거른다 — 예전에 질문이 그대로 쌓였다(isRoutineWorthy 주석 참고).
  //   이미 들어간 것을 지우는 대신 안 쓰는 쪽을 골랐다: 남의 입력 기록을 조용히 삭제하지 않는다.
  const fb = (listRoutineFbStmt.all() as { text: string }[]).map((r) => r.text).filter(isRoutineWorthy);
  const out: RoutineSuggestion[] = [];
  try {
    const { queryMemory } = await import("./memory.js");
    const chunks = await queryMemory("보안 운영 일일 주간 점검 루틴 확인 항목", 4).catch(() => [] as string[]);
    const { chat } = await import("./llm.js");
    const reply = await chat({
      agentId: "analysis",
      message: [
        "보안 운영 담당자의 '오늘 확인할 항목' 추천 목록을 만들어라.",
        '출력은 JSON 배열만: [{"cadence":"daily"|"weekly","text":"..."}] 형식으로 4~6개, 다른 텍스트 없이.',
        "daily는 매일 하는 일, weekly는 주말/매주 하는 일. 각 text는 30자 이내 한국어 실무 문장.",
        fb.length ? `팀장이 직접 추가해온 일과(우선 반영): ${fb.slice(0, 5).join(" / ")}` : "",
        chunks.length ? `사내 자료 발췌:\n${chunks.join("\n").slice(0, 1200)}` : "",
      ].filter(Boolean).join("\n"),
      // trusted — 이 message는 사용자 입력이 아니라 우리가 조립한 내부 프롬프트다(gateway.ts 규칙).
      trusted: true,
    });
    const m = reply.match(/\[[\s\S]*\]/);
    const rows = m ? (JSON.parse(m[0]) as { cadence?: string; text?: string }[]) : [];
    for (const r of rows) {
      if (r && typeof r.text === "string" && r.text.trim()) {
        out.push({
          cadence: r.cadence === "weekly" ? "weekly" : "daily",
          text: r.text.trim().slice(0, 60),
          source: chunks.length ? "AI 추천 · 사내 지식 근거" : "AI 추천",
        });
      }
    }
  } catch {
    /* LLM 미기동/파싱 실패 — 아래 기본 가이드로 */
  }
  // 직접 추가 이력은 항상 상단에 재제안(학습 반영을 눈에 보이게).
  for (const t of fb.slice(0, 3).reverse()) out.unshift({ cadence: "daily", text: t.slice(0, 60), source: "직접 추가 이력 · 학습 반영" });
  // ⚠ 기본 추천은 **가이드가 붙는 문장만** 쓴다(workguide.defaultRoutines).
  //   예전엔 "방화벽·EDR 이상 알림 확인" 같은 문장이라 눌러 담으면 "정해진 순서가 없습니다"가
  //   떴다 — 추천해 놓고 안내를 못 하는 것이라 이 화면의 약속이 거기서 깨진다(2026-07-31).
  const defaults = defaultRoutines();
  if (!out.some((s) => s.cadence === "daily" && !s.source.startsWith("직접"))) {
    for (const d of defaults.filter((x) => x.cadence === "daily")) out.push({ ...d, source: "기본 가이드" });
  }
  if (!out.some((s) => s.cadence === "weekly")) {
    for (const d of defaults.filter((x) => x.cadence === "weekly")) out.push({ ...d, source: "기본 가이드" });
  }
  // 중복 텍스트 제거 후 상한.
  const seen = new Set<string>();
  return out.filter((s) => !seen.has(s.text) && seen.add(s.text)).slice(0, 10);
}

export function registerTasksRoutes(app: Express): void {
  app.get("/api/tasks", authMiddleware, (_req, res) => res.json(listTasks()));
  app.get("/api/tasks/routine-suggestions", authMiddleware, asyncRoute(async (_req, res) => {
    res.json(await routineSuggestions());
  }));
  app.post("/api/tasks", authMiddleware, (req, res) => {
    const b = req.body as { text?: string; priority?: TaskItem["priority"]; dueAt?: number; assignee?: string; ref?: string; routineFeedback?: boolean };
    if (!b.text || !String(b.text).trim()) {
      res.status(400).json({ error: "text가 필요합니다" });
      return;
    }
    // 대시보드에서 직접 입력한 일과는 학습 신호로 기록 — 다음 추천 가이드에 반영된다.
    if (b.routineFeedback) recordRoutineFeedback(String(b.text).trim());
    const priority = ["P0", "P1", "P2", "P3"].includes(b.priority as string) ? b.priority : undefined;
    // ★ 이미 있던 일을 돌려받았는지 알려 준다(2026-08-04). 화면이 그냥 "담았습니다"라고 하면
    //   담당자는 아무 일도 안 일어난 줄 알고 또 누른다 — 같은 줄이 4개까지 불어난 원인이다.
    const 전 = listTasks({ includeAgentRuns: true }).length;
    const 일 = createTask({ text: String(b.text), priority, dueAt: typeof b.dueAt === "number" ? b.dueAt : undefined, assignee: b.assignee, ref: b.ref });
    const 이미있었다 = listTasks({ includeAgentRuns: true }).length === 전;
    // 담기도 작업 내역에 남긴다(재설계 시나리오 실측 2026-08-09 — 삭제만 남고 담기·완료가
    // 안 남아 "오늘 뭘 했나"를 작업 내역이 답하지 못했다). onAudit 훅이 작업 세션에도 반영한다.
    if (!이미있었다) {
      recordAudit({ kind: "write", action: "할 일 담기", target: 일.text.slice(0, 80), actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
    }
    res.json({ ...일, 이미있었다 });
  });
  // completeTask는 디스패처를 위해 실행 기록까지 돌려준다 — 화면에 줄 땐 거른다.
  app.post("/api/tasks/:id/complete", authMiddleware, (req, res) => {
    const t = getTask(String(req.params.id));
    completeTask(String(req.params.id));
    recordAudit({ kind: "write", action: "할 일 완료", target: (t?.text ?? String(req.params.id)).slice(0, 80), actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
    res.json(listTasks());
  });
  app.post("/api/tasks/:id/toggle", authMiddleware, (req, res) => {
    const t = getTask(String(req.params.id));
    const done = !!req.body.done;
    const out = setTaskDone(String(req.params.id), done);
    recordAudit({ kind: "write", action: done ? "할 일 완료" : "할 일 다시 열기", target: (t?.text ?? String(req.params.id)).slice(0, 80), actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
    res.json(out);
  });
  app.delete("/api/tasks/:id", authMiddleware, (req, res) => {
    recordAudit({ kind: "write", action: "작업 삭제", target: String(req.params.id), actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
    res.json(deleteTask(String(req.params.id)));
  });
}
