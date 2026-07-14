// engine/intent.ts — 자연어 명령 의도 파악 및 라우팅
// 로컬 LLM에 few-shot 프롬프트로 의도 분류 + 자산 개체명 인식을 맡기고,
// LLM 응답을 파싱할 수 없거나 로컬 LLM이 꺼져 있으면 정규식 기반으로 폴백한다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { listAssets } from "./assets";
import { chat } from "./llm";

export interface RoutedIntent {
  agentId: string;
  action: "scan" | "analyze" | "report" | "chat";
  targetAssetId?: string;
}

const ACTIONS: RoutedIntent["action"][] = ["scan", "analyze", "report", "chat"];

function agentIdForAction(action: RoutedIntent["action"]): string {
  if (action === "analyze") return "analysis";
  if (action === "chat") return "orchestrator";
  return action;
}

// 자산 레지스트리(assets.ts)에 등록된 id/name이 지시문에 그대로 언급된 경우만 잡아내는 best-effort 매칭.
// LLM 라우팅 결과를 파싱할 수 없을 때의 폴백 경로로 사용.
function findMentionedAssetId(text: string): string | undefined {
  return listAssets().find((asset) => text.includes(asset.id) || text.includes(asset.name))?.id;
}

function routeIntentByRegex(text: string): RoutedIntent {
  const targetAssetId = findMentionedAssetId(text);
  if (/스캔|재스캔|scan/i.test(text)) return { agentId: "scan", action: "scan", targetAssetId };
  if (/리포트|보고서|report/i.test(text)) return { agentId: "report", action: "report", targetAssetId };
  if (/우선순위|분석|analy/i.test(text)) return { agentId: "analysis", action: "analyze", targetAssetId };
  return { agentId: "orchestrator", action: "chat" };
}

function parseRoutedIntent(raw: string): RoutedIntent | undefined {
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { action?: unknown; targetAssetId?: unknown };
    if (typeof parsed.action !== "string" || !ACTIONS.includes(parsed.action as RoutedIntent["action"])) {
      return undefined;
    }
    const action = parsed.action as RoutedIntent["action"];
    const targetAssetId =
      typeof parsed.targetAssetId === "string" && listAssets().some((asset) => asset.id === parsed.targetAssetId)
        ? parsed.targetAssetId
        : undefined;
    return { agentId: agentIdForAction(action), action, targetAssetId };
  } catch {
    return undefined;
  }
}

function buildFewShotPrompt(text: string): string {
  const assetList = listAssets().map((asset) => `- id="${asset.id}" name="${asset.name}"`).join("\n") || "(등록된 자산 없음)";
  return [
    "너는 보안 오케스트레이터의 의도 분류기다. 사용자 지시문을 아래 4가지 action 중 하나로 분류하고,",
    "지시문에 등록된 자산이 언급되어 있으면 그 id를 targetAssetId로 뽑아라 (없으면 null).",
    "action 종류: scan(자산 재스캔), analyze(취약점/우선순위 분석), report(보고서 생성), chat(그 외 일반 대화).",
    '출력은 JSON 객체 하나만: {"action":"...","targetAssetId":"..."|null} 형식, 다른 텍스트 없이.',
    "",
    "등록된 자산 목록:",
    assetList,
    "",
    "예시:",
    '지시문: "fraud-detect-llm 스캔해줘" -> {"action":"scan","targetAssetId":"fraud-detect-llm"}',
    '지시문: "이번 주 취약점 우선순위 분석해줘" -> {"action":"analyze","targetAssetId":null}',
    '지시문: "지난달 보고서 만들어줘" -> {"action":"report","targetAssetId":null}',
    '지시문: "오늘 상태 어때?" -> {"action":"chat","targetAssetId":null}',
    "",
    `지시문: "${text}"`,
  ].join("\n");
}

export async function routeIntent(text: string): Promise<RoutedIntent> {
  const reply = await chat({ agentId: "orchestrator", message: buildFewShotPrompt(text) }).catch(() => undefined);
  const parsed = reply ? parseRoutedIntent(reply) : undefined;
  return parsed ?? routeIntentByRegex(text);
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
