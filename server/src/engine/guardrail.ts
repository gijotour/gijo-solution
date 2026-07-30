// engine/guardrail.ts — 런타임 가드레일. LLM에 들어가는 입력을 실시간으로 검사해 프롬프트 인젝션
// 시도를 탐지·기록(또는 차단)한다. 레드팀(redteam.ts)이 사후 실측이라면 이건 실시간 방어다.
// 경쟁 분석 최우선 갭 ② — Lakera·Prompt Security가 클라우드로 하는 것을 온프렘 로컬로.
//
// 탐지 로직은 redteam.ts의 detectInjectionAttempt(룰 기반)를 재사용. 모드:
//   off   — 검사 안 함
//   flag  — 탐지 시 기록·경고만(진행 허용)
//   block — 탐지 시 차단(거절) — **기본값**
//
// ■ 기본값을 flag → block으로 바꾼 근거(2026-07-30 실측)
//   예전 기본값은 flag였고 이유는 "오탐이 정상 사용을 막지 않게"였다. 그 근거를 실제로 재 봤다:
//     · 정상 업무 오탐 **0/96** — 평가 게이트가 제품 검증에 쓰는 실제 업무 질문 전부
//       (내가 고른 예시가 아니라는 점이 중요하다)
//     · 공격 탐지 **11/14**, 그중 critical·high는 **7/7 전부 탐지**
//   즉 "막으면 업무가 멈춘다"는 전제가 사실이 아니었다. 탐지해 놓고 통과시키는 것은
//   보안 제품이 할 일이 아니다 — 기록만 남기는 방어는 방어가 아니다.
//   놓치는 3건(전부 medium)은 모델 자체 저항·카나리 시스템 프롬프트·결재판이 뒤에서 받는다.
//
// ■ 모드는 DB에 저장한다 — 메모리에만 두면 재시작마다 조용히 기본값으로 풀린다.
//   운영 서버는 코드 갱신·hang 복구로 자주 재시작하므로, 담당자가 켜 둔 방어가 그때마다
//   사라졌다(2026-07-30 발견). 보안 설정이 말없이 되돌아가는 것이 가장 나쁜 종류의 버그다.

import type { Express } from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { detectInjectionAttempt, AttackCategory } from "./redteam";
import { db } from "../db";
import { recordAudit } from "./audit";

export type GuardMode = "off" | "flag" | "block";
const DEFAULT_MODE: GuardMode = "block";
const MODE_KEY = "guardrail:mode";

function readPersistedMode(): GuardMode {
  try {
    const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(MODE_KEY) as { value: string } | undefined;
    if (row && ["off", "flag", "block"].includes(row.value)) return row.value as GuardMode;
  } catch {
    /* 아직 표가 없을 수 있다(초기 부팅) — 기본값으로 간다 */
  }
  return DEFAULT_MODE;
}
let mode: GuardMode = readPersistedMode();

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
  const excerpt = (text ?? "").replace(/\s+/g, " ").slice(0, 160);
  eventLog.push({ at: Date.now(), source, excerpt, categories: d.categories, blocked });
  if (eventLog.length > LOG_LIMIT) eventLog.shift();
  // 차단한 공격은 **감사 로그에도** 남긴다. 위 eventLog는 메모리 200개 링버퍼라 재시작하면
  // 사라진다 — "언제 무엇을 막았나"를 나중에 못 보면 사고 조사가 불가능하다.
  // (flag로 통과시킨 것은 여기 남기지 않는다 — 탐지만 한 것으로 감사 로그를 채우면
  //  정작 차단 기록이 묻힌다. 그건 가드레일 로그 화면에서 본다.)
  if (blocked) {
    recordAudit({
      kind: "block", actor: "guardrail",
      action: `프롬프트 인젝션 차단(${d.categories.join(", ")})`,
      target: source, detail: excerpt, result: "blocked",
    });
  }
  return { allowed: !blocked, flagged: true, categories: d.categories };
}

export function guardrailLog(limit = 50): GuardEvent[] {
  return eventLog.slice(-limit).reverse();
}
export function guardrailStatus(): { mode: GuardMode; flaggedCount: number; blockedCount: number } {
  return { mode, flaggedCount: eventLog.length, blockedCount: eventLog.filter((e) => e.blocked).length };
}
export function setGuardrailMode(m: GuardMode): void {
  if (!["off", "flag", "block"].includes(m)) return;
  mode = m;
  try {
    db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(MODE_KEY, m);
  } catch {
    /* 저장에 실패해도 이 실행 동안은 적용된다 — 다음 재시작에 기본값으로 돌아갈 뿐 */
  }
}
export function resetGuardrailForTests(): void {
  eventLog.length = 0;
  mode = DEFAULT_MODE;
  try { db.prepare("DELETE FROM app_state WHERE key = ?").run(MODE_KEY); } catch { /* 무시 */ }
}

export function registerGuardrailRoutes(app: Express): void {
  app.get("/api/guardrail/status", authMiddleware, (_req, res) => res.json(guardrailStatus()));
  app.get("/api/guardrail/log", authMiddleware, (req, res) => res.json(guardrailLog(Number(req.query.limit) || 50)));
  // ⚠ 모드 변경은 **관리자만**이고 **감사 로그에 남는다**. 예전에는 로그인한 누구나 가드레일을
  //   off로 끌 수 있었고 기록도 남지 않았다 — 방어를 끈 사람을 알 수 없다는 뜻이었다.
  app.post("/api/guardrail/mode", authMiddleware, adminMiddleware, (req, res) => {
    const next = String(req.body?.mode) as GuardMode;
    if (!["off", "flag", "block"].includes(next)) {
      res.status(400).json({ error: "bad_mode", message: "모드는 off·flag·block 중 하나여야 합니다." });
      return;
    }
    const before = mode;
    setGuardrailMode(next);
    if (before !== next) {
      const user = (req as unknown as { user?: { displayName?: string } }).user;
      recordAudit({
        kind: "config", actor: user?.displayName ?? "?",
        action: `가드레일 모드 변경 ${before} → ${next}`,
        detail: next === "off" ? "⚠ 프롬프트 인젝션 검사가 완전히 꺼졌다" : next === "flag" ? "탐지해도 차단하지 않는다(기록만)" : null,
        result: "ok",
      });
    }
    res.json(guardrailStatus());
  });
}
