// engine/tasks.ts — 작업 큐 (서버 측, 전 클라이언트 공유)

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";

export interface TaskItem {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  text: string;
  agentId?: string;
  done: boolean;
  createdAt: number;
}

let tasks: TaskItem[] = [];

export function createTask(args: { text: string; agentId?: string; priority?: TaskItem["priority"] }): TaskItem {
  const item: TaskItem = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    priority: args.priority ?? "P2",
    text: args.text,
    agentId: args.agentId,
    done: false,
    createdAt: Date.now(),
  };
  tasks.push(item);
  return item;
}

export function completeTask(id: string): TaskItem[] {
  tasks = tasks.map((t) => (t.id === id ? { ...t, done: true } : t));
  return tasks;
}

export function listTasks(): TaskItem[] {
  return tasks;
}

export function registerTasksRoutes(app: Express): void {
  app.get("/api/tasks", authMiddleware, (_req, res) => res.json(listTasks()));
  app.post("/api/tasks", authMiddleware, (req, res) => res.json(createTask({ text: req.body.text })));
  app.post("/api/tasks/:id/complete", authMiddleware, (req, res) => res.json(completeTask(String(req.params.id))));
}
