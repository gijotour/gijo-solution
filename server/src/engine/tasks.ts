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
}

interface TaskRow {
  id: string;
  priority: TaskItem["priority"];
  text: string;
  agentId: string | null;
  done: number;
  createdAt: number;
}

function fromRow(row: TaskRow): TaskItem {
  return {
    id: row.id,
    priority: row.priority,
    text: row.text,
    agentId: row.agentId ?? undefined,
    done: row.done === 1,
    createdAt: row.createdAt,
  };
}

const insertStmt = db.prepare(
  "INSERT INTO tasks (id, priority, text, agentId, done, createdAt) VALUES (@id, @priority, @text, @agentId, @done, @createdAt)"
);
const completeStmt = db.prepare("UPDATE tasks SET done = 1 WHERE id = ?");
const setDoneStmt = db.prepare("UPDATE tasks SET done = ? WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM tasks WHERE id = ?");
const updatePriorityStmt = db.prepare("UPDATE tasks SET priority = ? WHERE id = ?");
const listStmt = db.prepare("SELECT * FROM tasks ORDER BY createdAt ASC");

export function createTask(args: { text: string; agentId?: string; priority?: TaskItem["priority"] }): TaskItem {
  const item: TaskItem = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    priority: args.priority ?? "P2",
    text: args.text,
    agentId: args.agentId,
    done: false,
    createdAt: Date.now(),
  };
  insertStmt.run({ ...item, agentId: item.agentId ?? null, done: item.done ? 1 : 0 });
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

export function registerTasksRoutes(app: Express): void {
  app.get("/api/tasks", authMiddleware, (_req, res) => res.json(listTasks()));
  app.post("/api/tasks", authMiddleware, (req, res) => res.json(createTask({ text: req.body.text })));
  app.post("/api/tasks/:id/complete", authMiddleware, (req, res) => res.json(completeTask(String(req.params.id))));
  app.post("/api/tasks/:id/toggle", authMiddleware, (req, res) => res.json(setTaskDone(String(req.params.id), !!req.body.done)));
  app.delete("/api/tasks/:id", authMiddleware, (req, res) => res.json(deleteTask(String(req.params.id))));
}
