// engine/dispatcher.ts — 지시 → 할당 → 실행 → 로그까지 잇는 조율 로직 (서버 측)
// 8단계 문서에서 설명한 파이프라인과 동일하되, collaboration 로그는 이제
// WebSocket으로 모든 접속 클라이언트에 브로드캐스트된다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { routeIntent, RoutedIntent } from "./intent";
import { createTask, completeTask, TaskItem } from "./tasks";
import { setAgentStatus, resetAgentToDefault, getAgentById } from "./agents";
import { emitCollaboration } from "./collaboration";
import { runAdapter } from "./bridge";
import { chat } from "./llm";
import { analyzeFindings } from "./analysis";
import { recordFindings } from "./assets";

export interface DispatchResult {
  task: TaskItem;
  route: RoutedIntent;
  output: string;
}

function priorityForAction(action: RoutedIntent["action"]): TaskItem["priority"] {
  if (action === "scan") return "P1";
  if (action === "analyze") return "P1";
  return "P2";
}

async function executeRoutedAction(route: RoutedIntent, instructionText: string): Promise<string> {
  switch (route.action) {
    case "scan": {
      const assetPath = route.targetAssetId ?? "unknown-asset";
      const findings = await runAdapter("modelscan", assetPath).catch((err) => [
        { finding_type: "scan_error", severity: "low" as const, evidence: String(err), source_tool: "modelscan" },
      ]);
      recordFindings(assetPath, findings);
      const analysis = await analyzeFindings(findings);
      return analysis.summary;
    }
    case "analyze":
    case "report":
    case "chat":
    default:
      return chat({ agentId: route.agentId, message: instructionText });
  }
}

export async function dispatchInstruction(instructionText: string): Promise<DispatchResult> {
  const route = await routeIntent(instructionText);
  const agent = getAgentById(route.agentId);

  const task = createTask({ text: instructionText, agentId: route.agentId, priority: priorityForAction(route.action) });

  setAgentStatus(route.agentId, "working");
  emitCollaboration({ from: "orchestrator", to: route.agentId, message: `작업 할당: "${instructionText}"` });

  let output: string;
  try {
    output = await executeRoutedAction(route, instructionText);
  } catch (err) {
    output = `실행 실패: ${err instanceof Error ? err.message : String(err)}`;
  }

  emitCollaboration({ from: route.agentId, to: "orchestrator", message: `작업 완료: ${output}` });
  resetAgentToDefault(route.agentId);
  const updatedTasks = completeTask(task.id);
  const completedTask = updatedTasks.find((t) => t.id === task.id) ?? task;

  return { task: completedTask, route, output };
}

export function registerDispatcherRoutes(app: Express): void {
  app.post(
    "/api/dispatch",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await dispatchInstruction(req.body.text));
    })
  );
}
