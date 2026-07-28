// engine/tasks.ts — 작업 큐 (서버 측, 전 클라이언트 공유, SQLite 영속화)

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import { db, assertTestDb } from "../db";

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
  };
}

const insertStmt = db.prepare(
  "INSERT INTO tasks (id, priority, text, agentId, done, createdAt, dueAt, assignee, ref) VALUES (@id, @priority, @text, @agentId, @done, @createdAt, @dueAt, @assignee, @ref)"
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
}): TaskItem {
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
  });
  return item;
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
export function setTaskDone(id: string, done: boolean): TaskItem[] {
  setDoneStmt.run({ id, done: done ? 1 : 0, completedAt: done ? Date.now() : null });
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

export function recordRoutineFeedback(text: string): void {
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
  const fb = (listRoutineFbStmt.all() as { text: string }[]).map((r) => r.text);
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
  if (!out.some((s) => s.cadence === "daily" && !s.source.startsWith("직접"))) {
    out.push(
      { cadence: "daily", text: "방화벽·EDR 이상 알림 확인", source: "기본 가이드" },
      { cadence: "daily", text: "전일 스캔 결과·신규 취약점 확인", source: "기본 가이드" }
    );
  }
  if (!out.some((s) => s.cadence === "weekly")) {
    out.push(
      { cadence: "weekly", text: "전체 자산 재스캔·우선순위 갱신", source: "기본 가이드" },
      { cadence: "weekly", text: "보안제품 정책 백업 상태 점검", source: "기본 가이드" }
    );
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
    res.json(createTask({ text: String(b.text), priority, dueAt: typeof b.dueAt === "number" ? b.dueAt : undefined, assignee: b.assignee, ref: b.ref }));
  });
  // completeTask는 디스패처를 위해 실행 기록까지 돌려준다 — 화면에 줄 땐 거른다.
  app.post("/api/tasks/:id/complete", authMiddleware, (req, res) => {
    completeTask(String(req.params.id));
    res.json(listTasks());
  });
  app.post("/api/tasks/:id/toggle", authMiddleware, (req, res) => res.json(setTaskDone(String(req.params.id), !!req.body.done)));
  app.delete("/api/tasks/:id", authMiddleware, (req, res) => {
    recordAudit({ kind: "write", action: "작업 삭제", target: String(req.params.id), actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
    res.json(deleteTask(String(req.params.id)));
  });
}
