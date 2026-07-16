// engine/tasks.ts — 작업 큐 (서버 측, 전 클라이언트 공유, SQLite 영속화)

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { db } from "../db";

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
  };
}

const insertStmt = db.prepare(
  "INSERT INTO tasks (id, priority, text, agentId, done, createdAt, dueAt, assignee, ref) VALUES (@id, @priority, @text, @agentId, @done, @createdAt, @dueAt, @assignee, @ref)"
);
const completeStmt = db.prepare("UPDATE tasks SET done = 1 WHERE id = ?");
const setDoneStmt = db.prepare("UPDATE tasks SET done = ? WHERE id = ?");
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

export function completeTask(id: string): TaskItem[] {
  completeStmt.run(id);
  return listTasks();
}

// 완료 ↔ 미완료 토글 (담당자가 체크박스로 진행 상태를 직접 바꾼다).
export function setTaskDone(id: string, done: boolean): TaskItem[] {
  setDoneStmt.run(done ? 1 : 0, id);
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

export function listTasks(): TaskItem[] {
  return (listStmt.all() as TaskRow[]).map(fromRow);
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetTasksForTests(): void {
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

export function registerTasksRoutes(app: Express): void {
  app.get("/api/tasks", authMiddleware, (_req, res) => res.json(listTasks()));
  app.post("/api/tasks", authMiddleware, (req, res) => {
    const b = req.body as { text?: string; priority?: TaskItem["priority"]; dueAt?: number; assignee?: string; ref?: string };
    if (!b.text || !String(b.text).trim()) {
      res.status(400).json({ error: "text가 필요합니다" });
      return;
    }
    const priority = ["P0", "P1", "P2", "P3"].includes(b.priority as string) ? b.priority : undefined;
    res.json(createTask({ text: String(b.text), priority, dueAt: typeof b.dueAt === "number" ? b.dueAt : undefined, assignee: b.assignee, ref: b.ref }));
  });
  app.post("/api/tasks/:id/complete", authMiddleware, (req, res) => res.json(completeTask(String(req.params.id))));
  app.post("/api/tasks/:id/toggle", authMiddleware, (req, res) => res.json(setTaskDone(String(req.params.id), !!req.body.done)));
  app.delete("/api/tasks/:id", authMiddleware, (req, res) => res.json(deleteTask(String(req.params.id))));
}
