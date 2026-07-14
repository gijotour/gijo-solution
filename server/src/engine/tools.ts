// engine/tools.ts — 에이전트가 실행 가능한 액션(툴) 레지스트리

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { listAdapters, runAdapter } from "./bridge";

export interface ToolDefinition {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const registry: Record<string, ToolDefinition> = {};

export function registerTool(tool: ToolDefinition): void {
  registry[tool.name] = tool;
}

// bridge.ts의 스캔 어댑터(현재 modelscan)를 툴 레지스트리에도 등록해 /api/tools 목록에 보이고
// /api/tools/run으로 실행 가능하게 한다 — createApp()마다 호출되지만 같은 이름으로 덮어쓸 뿐이라
// 여러 번 호출돼도 안전하다.
function registerBridgeAdapterTools(): void {
  for (const adapter of listAdapters()) {
    registerTool({
      name: adapter.id,
      description: `${adapter.name} 스캔 어댑터 실행 (params: { assetPath: string })`,
      run: (args) => runAdapter(adapter.id, String(args.assetPath ?? "")),
    });
  }
}

export function registerToolsRoutes(app: Express): void {
  registerBridgeAdapterTools();

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
}
