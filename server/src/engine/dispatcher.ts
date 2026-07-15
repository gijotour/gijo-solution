// engine/dispatcher.ts — 지시 → 할당 → 실행 → 로그까지 잇는 조율 로직 (서버 측)
// 8단계 문서에서 설명한 파이프라인과 동일하되, collaboration 로그는 이제
// WebSocket으로 모든 접속 클라이언트에 브로드캐스트된다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { routeIntent, RoutedIntent } from "./intent";
import { createTask, completeTask, updateTaskPriority, TaskItem } from "./tasks";
import { setAgentStatus, resetAgentToDefault, getAgentById } from "./agents";
import { emitCollaboration } from "./collaboration";
import { runAdapter, StandardFinding } from "./bridge";
import { chat } from "./llm";
import { analyzeFindings } from "./analysis";
import { recordFindings, getAsset } from "./assets";

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

// 실시간 CVSS/EPSS/KEV 스코어링은 CTI 벤더 API 연동(cti.ts의 TODO) 전까지는 데이터 소스가 없어 보류.
// 지금 확보 가능한 신호는 스캔 어댑터가 돌려주는 finding.severity뿐이므로, 스캔이 끝나면
// 발견된 findings 중 가장 심각한 등급을 근거로 액션 기반 초기 우선순위를 덮어쓴다.
function priorityForFindings(findings: StandardFinding[]): TaskItem["priority"] {
  if (findings.some((f) => f.severity === "critical")) return "P0";
  if (findings.some((f) => f.severity === "high")) return "P1";
  if (findings.some((f) => f.severity === "medium")) return "P2";
  return "P3";
}

interface ActionResult {
  output: string;
  findings?: StandardFinding[];
}

async function executeRoutedAction(route: RoutedIntent, instructionText: string): Promise<ActionResult> {
  switch (route.action) {
    case "scan": {
      const assetId = route.targetAssetId ?? "unknown-asset";
      const scanPath = getAsset(assetId)?.path ?? assetId;
      const findings = await runAdapter("modelscan", scanPath).catch((err) => [
        { finding_type: "scan_error", severity: "low" as const, evidence: String(err), source_tool: "modelscan" },
      ]);
      recordFindings(assetId, findings);
      const analysis = await analyzeFindings(findings);
      return { output: analysis.summary, findings };
    }
    case "analyze":
    case "report":
    case "chat":
    default: {
      const { ensureAgentModel } = await import("./localengine.js");
      await ensureAgentModel(route.agentId);
      return { output: await chat({ agentId: route.agentId, message: instructionText, remember: true }) };
    }
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
    const result = await executeRoutedAction(route, instructionText);
    output = result.output;
    if (result.findings) {
      updateTaskPriority(task.id, priorityForFindings(result.findings));
    }
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
