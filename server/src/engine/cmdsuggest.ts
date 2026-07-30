// engine/cmdsuggest.ts — 챗봇이 자연어 요청을 담당자 PC에서 실행할 CLI 명령 한 줄로 제안한다(④).
// 여기서는 "제안"만 한다 — 실제 실행은 클라이언트(담당자 PC 터미널)가 허용목록·위험검사·사람 승인을
// 모두 통과한 뒤에만 한다. 서버는 명령을 만들 뿐 실행하지 않는다(온프렘·최소권한 원칙).

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

function buildPrompt(reqText: string): string {
  return [
    "너는 보안 담당자의 요청을 Windows PowerShell 한 줄 명령으로 바꾸는 도우미다.",
    "규칙:",
    "- 담당자 PC에서 실행할 안전한 점검·조회·설치 명령만 만든다(nmap·Get-*·Test-NetConnection·winget install 등).",
    "- 삭제·포맷·디스크 조작·시스템 종료 같은 파괴적 명령은 절대 만들지 않는다.",
    "- 실행은 사람이 승인 후 하므로, 너는 명령 한 줄과 짧은 설명만 낸다.",
    "- command는 한 줄. explanation은 한국어로 1문장.",
    "",
    `요청: ${reqText}`,
  ].join("\n");
}

export async function suggestCommand(reqText: string): Promise<{ command: string; explanation: string }> {
  const raw = await chat({
    agentId: "orchestrator",
    message: buildPrompt(reqText),
    responseSchema: SUGGEST_SCHEMA,
    maxTokens: 200,
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
      res.json(await suggestCommand(request));
    })
  );
}
