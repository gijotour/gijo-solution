// engine/guardrail.ts — 런타임 가드레일. LLM에 들어가는 입력을 실시간으로 검사해 프롬프트 인젝션
// 시도를 탐지·기록(또는 차단)한다. 레드팀(redteam.ts)이 사후 실측이라면 이건 실시간 방어다.
// 경쟁 분석 최우선 갭 ② — Lakera·Prompt Security가 클라우드로 하는 것을 온프렘 로컬로.
//
// 탐지 로직은 redteam.ts의 detectInjectionAttempt(룰 기반)를 재사용. 모드:
//   off   — 검사 안 함
//   flag  — 탐지 시 기록·경고만(진행 허용) — 기본. 오탐이 정상 사용을 막지 않게.
//   block — 탐지 시 차단(거절)

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { detectInjectionAttempt, AttackCategory } from "./redteam";

export type GuardMode = "off" | "flag" | "block";
let mode: GuardMode = "flag";

export interface GuardEvent {
  at: number;
  source: string; // 어디서 들어온 입력인지(dispatch/chat 등)
  excerpt: string;
  categories: AttackCategory[];
  blocked: boolean;
}

const eventLog: GuardEvent[] = [];
const LOG_LIMIT = 200;

export interface GuardResult {
  allowed: boolean; // block 모드에서 탐지되면 false
  flagged: boolean;
  categories: AttackCategory[];
}

// 입력을 검사한다. 탐지되면 로그에 남기고, block 모드면 allowed=false.
export function guardInput(text: string, source: string): GuardResult {
  if (mode === "off") return { allowed: true, flagged: false, categories: [] };
  const d = detectInjectionAttempt(text ?? "");
  if (!d.flagged) return { allowed: true, flagged: false, categories: [] };
  const blocked = mode === "block";
  eventLog.push({ at: Date.now(), source, excerpt: (text ?? "").replace(/\s+/g, " ").slice(0, 160), categories: d.categories, blocked });
  if (eventLog.length > LOG_LIMIT) eventLog.shift();
  return { allowed: !blocked, flagged: true, categories: d.categories };
}

export function guardrailLog(limit = 50): GuardEvent[] {
  return eventLog.slice(-limit).reverse();
}
export function guardrailStatus(): { mode: GuardMode; flaggedCount: number; blockedCount: number } {
  return { mode, flaggedCount: eventLog.length, blockedCount: eventLog.filter((e) => e.blocked).length };
}
export function setGuardrailMode(m: GuardMode): void {
  if (["off", "flag", "block"].includes(m)) mode = m;
}
export function resetGuardrailForTests(): void {
  eventLog.length = 0;
  mode = "flag";
}

export function registerGuardrailRoutes(app: Express): void {
  app.get("/api/guardrail/status", authMiddleware, (_req, res) => res.json(guardrailStatus()));
  app.get("/api/guardrail/log", authMiddleware, (req, res) => res.json(guardrailLog(Number(req.query.limit) || 50)));
  app.post("/api/guardrail/mode", authMiddleware, (req, res) => {
    setGuardrailMode(String(req.body?.mode) as GuardMode);
    res.json(guardrailStatus());
  });
}
