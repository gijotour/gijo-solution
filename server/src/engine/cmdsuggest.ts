// engine/cmdsuggest.ts — 챗봇이 자연어 요청을 담당자 PC에서 실행할 CLI 명령 한 줄로 제안한다(④).
// 여기서는 "제안"만 한다 — 실제 실행은 클라이언트(담당자 PC 터미널)가 허용목록·위험검사·사람 승인을
// 모두 통과한 뒤에만 한다. 서버는 명령을 만들 뿐 실행하지 않는다(온프렘·최소권한 원칙).
//
// 소비자(2026-08-19 정리): 대화창 도구 suggest_command(registry.ts)가 suggestCommand()를 쓴다 —
// 터미널 화면의 자연어 칸을 미니 챗봇 정리로 뗀 뒤 대화창으로 이은 것. HTTP 라우트
// (/api/terminal/suggest)와 preload.suggestCommand는 화면 호출부가 0곳이나, 외부 자동화·
// 구버전 호환으로 남긴다(gateUserInput 관문 포함이라 무해).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { chat } from "./llm";
import { gateUserInput } from "./gateway";

const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["command", "explanation"],
} as const;

function buildPrompt(reqText: string, 근거: string[]): string {
  const 근거절 = 근거.length
    ? ["", "=== 사내 매뉴얼 근거(이 안에 명령·절차가 있으면 그대로 쓴다) ===", ...근거.map((c, i) => `[${i + 1}] ${c.slice(0, 600)}`),
       "=== 근거 끝 ===",
       "★ 위 매뉴얼에 요청에 맞는 명령·절차가 있으면 **지어내지 말고 그대로** 옮긴다(설정 파일 경로·옵션 포함).",
       "★ 매뉴얼이 명령이 아니라 절차(예: '관리자 권한으로 Setup.bat 실행')를 말하면 command는 비우고 explanation에 그 절차를 적는다 — 억지로 PowerShell로 바꾸지 않는다."]
    : ["", "★ 사내 매뉴얼에 관련 근거가 없다 — 일반적 점검 명령만 만들되, 확실치 않으면 command를 비우고 explanation에 '이 요청은 사내 매뉴얼에 근거가 없어 일반 명령만 제안합니다'라고 밝힌다."];
  return [
    "너는 보안 담당자의 요청을 Windows PowerShell 한 줄 명령으로 바꾸는 도우미다.",
    "규칙:",
    "- 담당자 PC에서 실행할 안전한 점검·조회·설치 명령만 만든다(nmap·Get-*·Test-NetConnection·winget install 등).",
    "- 삭제·포맷·디스크 조작·시스템 종료 같은 파괴적 명령은 절대 만들지 않는다.",
    "- 실행은 사람이 승인 후 하므로, 너는 명령 한 줄과 짧은 설명만 낸다.",
    "- command는 한 줄. explanation은 한국어로 1문장.",
    ...근거절,
    "",
    `요청: ${reqText}`,
  ].join("\n");
}

export async function suggestCommand(reqText: string): Promise<{ command: string; explanation: string }> {
  // ⚠ 매뉴얼 근거를 먼저 읽는다(2026-08-21 실측 — 이 함수가 매뉴얼을 안 읽고 LLM으로 명령을
  //   지어냈다. SolidStep 매뉴얼이 있는데도 Get-WindowsFeature를 창작). 근거가 있으면 원문
  //   명령을 그대로, 없으면 정직하게 밝힌다. 조회 실패해도 종전대로 동작(근거 0으로).
  let 근거: string[] = [];
  try {
    const { queryMemoryRelevant } = await import("./memory.js");
    근거 = await queryMemoryRelevant(reqText, 4, "orchestrator");
  } catch { /* RAG를 못 읽어도 명령 제안은 한다 */ }
  const raw = await chat({
    agentId: "orchestrator",
    message: buildPrompt(reqText, 근거),
    responseSchema: SUGGEST_SCHEMA,
    maxTokens: 240,
    // trusted — 라우트가 gateUserInput으로 이미 검사한 입력의 재진입이다 — 두 번 검사하면 이중 집계되고, 차단 모드에서는 우리 프롬프트가 걸린다.
    trusted: true,
  });
  try {
    const p = JSON.parse(raw) as { command?: string; explanation?: string };
    return { command: String(p.command ?? "").trim(), explanation: String(p.explanation ?? "").trim() };
  } catch {
    return { command: "", explanation: "명령을 만들지 못했습니다 — 더 구체적으로 요청하거나 직접 입력하세요." };
  }
}

export function registerCmdSuggestRoutes(app: Express): void {
  app.post(
    "/api/terminal/suggest",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const request = String(req.body?.request ?? "").trim();
      if (!request) {
        res.status(400).json({ error: "request가 필요합니다" });
        return;
      }
      // 사용자 입력 단일 관문 — 인젝션·내부정보 유출 시도를 걸러낸다(다른 LLM 입구와 동일 정책).
      const gate = gateUserInput(request, "chat");
      if (!gate.allowed) {
        res.json({ command: "", explanation: gate.message ?? "요청이 차단되었습니다." });
        return;
      }
      res.json(await suggestCommand(gate.text)); // 개인정보 가림 반영본으로
    })
  );
}
