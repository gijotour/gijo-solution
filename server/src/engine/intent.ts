// engine/intent.ts — 자연어 명령 의도 파악 및 라우팅

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { listAssets } from "./assets";

export interface RoutedIntent {
  agentId: string;
  action: "scan" | "analyze" | "report" | "chat";
  targetAssetId?: string;
}

// 자산 레지스트리(assets.ts)에 등록된 id/name이 지시문에 그대로 언급된 경우만 잡아내는 best-effort 매칭.
// TODO: 로컬 LLM에 few-shot 프롬프트로 의도 분류 + 개체명 인식을 맡기는 것을 권장.
function findMentionedAssetId(text: string): string | undefined {
  return listAssets().find((asset) => text.includes(asset.id) || text.includes(asset.name))?.id;
}

export async function routeIntent(text: string): Promise<RoutedIntent> {
  const targetAssetId = findMentionedAssetId(text);
  if (/스캔|재스캔|scan/i.test(text)) return { agentId: "scan", action: "scan", targetAssetId };
  if (/리포트|보고서|report/i.test(text)) return { agentId: "report", action: "report", targetAssetId };
  if (/우선순위|분석|analy/i.test(text)) return { agentId: "analysis", action: "analyze", targetAssetId };
  return { agentId: "orchestrator", action: "chat" };
}

export function registerIntentRoutes(app: Express): void {
  app.post(
    "/api/intent/route",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await routeIntent(req.body.text));
    })
  );
}
