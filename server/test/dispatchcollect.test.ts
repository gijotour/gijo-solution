// 대화창 수집은 출구 한 곳 — [2026-08-07 · 중-4 학습 재료가 말라 가던 실측에서]
//
// 발견: 수집이 chat() 내부(remember:true)에만 걸려 있어, 코드가 만든 즉답·도구 답·에이전트
//   루프 답이 **전부 수집에서 빠졌다**. 즉답 전환(빠른 답)을 늘릴수록 학습 재료가 마르는
//   구조였다 — 실측: 반나절 유입 1건. 파일럿 4주가 지나도 전문가별 재료가 안 쌓일 판.
// 계약: 대화창(디스패치)의 **출구 한 곳**에서 남긴다. 갈래마다 심으면 새 갈래가 또 샌다.
//   빠지는 것은 셋뿐 — qa(측정), noLearn(비학습 계정), 결재판·확인 대기(끝난 대화가 아님).
import { describe, it, expect, vi, beforeEach } from "vitest";

// 실 LLM을 띄우지 않는다 — 라우팅이 chat까지 가면 고정 문구가 답이 된다.
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
  smallTalkReply: vi.fn(() => null),
}));

import { dispatchInstruction } from "../src/engine/dispatcher";
import { db } from "../src/db";

const 로그 = (question: string) =>
  db.prepare("SELECT agentId, topic, answer FROM chat_logs WHERE question = ?").all(question) as
    { agentId: string; topic: string | null; answer: string }[];

beforeEach(() => {
  db.prepare("DELETE FROM chat_logs").run();
});

describe("대화창 수집 — 출구 한 곳", () => {
  it("★ 도구 즉답도 수집된다 — chat()을 안 거친 답이 예전에는 전부 빠졌다", async () => {
    const q = "미조치 취약점 알려줘";
    const r = await dispatchInstruction(q);
    expect(r.output).toBeTruthy();
    const rows = 로그(q);
    expect(rows, "즉답이 chat_logs에 남아야 한다").toHaveLength(1);
    expect(rows[0].answer).toBe(r.output);
    expect(rows[0].topic, "주제 딱지도 함께 붙는다(중-4 전문가 재료)").toBe("취약점");
  });

  it("★★ 같은 질문이 두 번 남지 않는다 — chat() 내부 수집은 꺼 두었다(이중 기록 방지)", async () => {
    // 라우팅이 chat으로 흘러가는 일반 질문 — 출구 1회만 남아야 한다.
    const q = "우리 회사 보안 수준에 대해 설명해줘";
    await dispatchInstruction(q);
    expect(로그(q)).toHaveLength(1);
  });

  it("★★ qa(측정)는 남지 않는다 — 게이트 문항 수백 건이 학습 재료를 오염시킨다", async () => {
    const q = "미조치 취약점 알려줘";
    await dispatchInstruction(q, undefined, undefined, "gate", true);
    expect(로그(q)).toHaveLength(0);
  });

  it("★★ noLearn(비학습 계정)은 남지 않는다 — 배포 계정 검증 흔적 배제", async () => {
    const q = "미조치 취약점 알려줘";
    await dispatchInstruction(q, undefined, undefined, "claude-deploy", undefined, true);
    expect(로그(q)).toHaveLength(0);
  });

  it("★ 확인 대기(학습루프 시작 확인)는 남지 않는다 — 끝난 대화가 아니다", async () => {
    const q = "지금 학습 시작해줘";
    const r = await dispatchInstruction(q);
    // 확인 대기(confirm)나 결재판(approval)이 떴다면 수집은 없어야 한다.
    if (r.confirm || r.approval) expect(로그(q)).toHaveLength(0);
    else expect(로그(q).length).toBeLessThanOrEqual(1); // 환경에 따라 즉답이면 1회 수집이 정상
  });
});
