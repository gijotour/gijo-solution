// engine/tools.ts — 에이전트가 실행 가능한 액션(툴) 레지스트리

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

export interface ToolDefinition {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const registry: Record<string, ToolDefinition> = {};

export function registerTool(tool: ToolDefinition): void {
  registry[tool.name] = tool;
}

export function registerToolsRoutes(app: Express): void {
  app.get("/api/tools", authMiddleware, (_req, res) => {
    res.json(Object.values(registry).map(({ name, description }) => ({ name, description })));
  });
  app.post(
    "/api/tools/run",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const tool = registry[req.body.name];
      if (!tool) return res.status(404).json({ error: `unknown tool: ${req.body.name}` });
      res.json(await tool.run(req.body.params));
    })
  );
  // TODO: bridge.ts의 어댑터들을 여기서 registerTool()로 등록
}
