// engine/intent.ts — 자연어 명령 의도 파악 및 라우팅
// 로컬 LLM에 few-shot 프롬프트로 의도 분류 + 자산 개체명 인식을 맡기고,
// LLM 응답을 파싱할 수 없거나 로컬 LLM이 꺼져 있으면 정규식 기반으로 폴백한다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { listAssets } from "./assets";
import { chat } from "./llm";
import { fallbackActionForScreen } from "./screencontext";

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

// 지시문에 "무엇을 하라"는 동작 단어가 있는가. 있으면 텍스트가 화면보다 우선한다.
// routeIntentByRegex의 판별과 같은 어휘를 쓴다 — 두 곳이 어긋나면 라우팅이 설명 불가능해진다.
const ACTION_WORDS = /스캔|재스캔|scan|리포트|보고서|report|우선순위|분석|analy/i;
export function hasExplicitAction(text: string): boolean {
  return ACTION_WORDS.test(text ?? "");
}

function routeIntentByRegex(text: string, screen?: string): RoutedIntent {
  const targetAssetId = findMentionedAssetId(text);
  // 지시문의 명시적 동사가 최우선 — 화면은 어디까지나 힌트다.
  if (/스캔|재스캔|scan/i.test(text)) return { agentId: "scan", action: "scan", targetAssetId };
  if (/리포트|보고서|report/i.test(text)) return { agentId: "report", action: "report", targetAssetId };
  if (/우선순위|분석|analy/i.test(text)) return { agentId: "analysis", action: "analyze", targetAssetId };
  // 동사가 없을 때만 화면으로 추정한다. 취약점 화면에서 "정리해줘"는 우선순위 정리로 본다.
  // 예전엔 이런 지시가 전부 일반 대화로 떨어져 아무 일도 일어나지 않았다.
  const fromScreen = fallbackActionForScreen(screen);
  if (fromScreen) return { agentId: agentIdForAction(fromScreen), action: fromScreen, targetAssetId };
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

/**
 * 화면 신호는 프롬프트 힌트가 아니라 **결정적 후처리**로 적용한다.
 *
 * 처음엔 화면 설명을 프롬프트에 넣어 분류기가 참고하게 했는데, 실측(2026-07-19)에서 같은
 * 입력에 매번 다른 답이 나왔다 — "이거 정리해줘"@취약점이 3회 실행에서 report→analyze→report,
 * 설정 화면은 chat→report→analyze. 7B 분류기의 흔들림이라 프롬프트를 다듬는 건 노이즈 쫓기였다.
 * 게다가 힌트의 존재 자체가 "뭔가 실행하라"는 신호로 읽혀, 지시 대상이 아닌 설정 화면에서도
 * 액션을 만들어냈다.
 *
 * 그래서 역할을 나눴다 — 분류기는 지시문만 보고 판단하고(잘하는 일), 그 결과가 "판단 못 함(chat)"일
 * 때만 화면이 결정적으로 개입한다. 명시적 동사가 있으면 분류기 결과가 그대로 이기므로
 * "지시문 우선" 원칙도 지켜진다.
 */
export async function routeIntent(text: string, screen?: string): Promise<RoutedIntent> {
  // trusted: 지시문은 dispatch에서 이미 게이트웨이를 지났고, 여기서는 분류용 프롬프트로 감싸 보낸다.
  const reply = await chat({ agentId: "orchestrator", message: buildFewShotPrompt(text), trusted: true }).catch(() => undefined);
  const parsed = reply ? parseRoutedIntent(reply) : undefined;
  const routed = parsed ?? routeIntentByRegex(text, screen);

  // 지시문에 동작 단어가 없으면 화면이 결정한다 — 분류기 판단보다 우선.
  //
  // 분류기에 맡겨 보니 같은 문장이 실행마다 다른 액션이 됐다(실측: 자산 화면의 "이거 정리해줘"가
  // 3회에 scan·analyze·analyze). 사용자 입장에서 같은 말이 매번 다른 일을 하는 건 제품으로서
  // 곤란하다. 동사가 없는 지시는 애초에 텍스트만으로 알 수 없는 것이므로, 확률적 추측 대신
  // 사용자가 이미 표현한 맥락(보고 있는 화면)을 결정적으로 쓴다.
  const fromScreen = fallbackActionForScreen(screen);
  if (fromScreen && !hasExplicitAction(text)) {
    return { agentId: agentIdForAction(fromScreen), action: fromScreen, targetAssetId: routed.targetAssetId };
  }

  // 동작 단어가 있으면 분류기 판단을 따른다. 단 분류기가 chat으로 흘렸는데(7B 흔들림) 지시문에
  // 명시적 동작 동사가 있으면 결정적 규칙으로 되살린다 — 실측(2026-07-20): "주간 보안 리포트
  // 작성해줘"가 실행마다 report↔chat을 오가 1/3까지 떨어졌다. 분류기가 스스로 못 정한 것이므로
  // 확률적 재추측 대신 지시문의 명시 동사를 결정적으로 따른다("지시문 우선" 원칙과 일치).
  if (routed.action === "chat" && hasExplicitAction(text)) {
    const byRegex = routeIntentByRegex(text, screen);
    if (byRegex.action !== "chat") return byRegex;
  }
  // 그마저 "판단 못 함"이면 화면으로 보정한다.
  if (routed.action === "chat" && fromScreen) {
    return { agentId: agentIdForAction(fromScreen), action: fromScreen, targetAssetId: routed.targetAssetId };
  }
  return routed;
}

export function registerIntentRoutes(app: Express): void {
  app.post(
    "/api/intent/route",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await routeIntent(req.body.text, req.body.screen));
    })
  );
}
