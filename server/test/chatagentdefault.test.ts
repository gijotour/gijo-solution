// /api/llm/chat에 팀원(agentId)이 없으면 **대화가 한 건도 안 쌓인다** — 그런데 응답은 200이었다.
//
// ■ 실사고(2026-09-10 고객 QA ⓑ 인스턴스 첫 검증): 채팅은 답이 오고 근거 [1]도 붙는데
//   chat_logs가 0건이었다. 뿌리는 두 가지가 겹친 것 —
//     ① 라우트가 req.body를 그대로 펼치기만 해서 agentId가 undefined로 흘렀다.
//     ② chat_logs.agentId는 NOT NULL이라 insert가 던졌고, 그 실패는 수집 쪽 catch가 삼켰다.
//   고객 QA의 존재 이유가 그 수집이라, 200만 보고 「정상」이라 읽으면 검증 자체가 헛돈다.
//
// ■ 왜 400이 아니라 **기본값**인가: 대화창 정문(dispatcher)이 이미 같은 자리에서
//   `?? "orchestrator"`로 폴백한다. 두 입구가 서로 다른 규칙을 가지면, 어느 쪽으로 들어왔느냐로
//   제품이 달라진다. 덤으로 agentId가 없으면 원격 목표 판정의 「이 PC 고정」 갈래를 비켜
//   질문이 전역 원격 두뇌로 샐 수 있다 — 기본값이 그 구멍도 함께 막는다.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { db } from "../src/db";
import { recordChatLog, listChatLogs } from "../src/engine/learnloop";

const engineDir = path.join(__dirname, "..", "src", "engine");
const llmSrc = fs.readFileSync(path.join(engineDir, "llm.ts"), "utf8");
const 라우트 = llmSrc.slice(llmSrc.indexOf('"/api/llm/chat"'), llmSrc.indexOf('"/api/llm/chat"') + 1600);

describe("라우트 계약 — 팀원 이름을 서버가 채운다", () => {
  it("★ req.body를 펼친 **뒤**에 agentId를 넣는다 — 앞에 넣으면 요청이 undefined로 덮어쓴다", () => {
    expect(라우트, "펼침 뒤에 와야 요청이 비워 보낸 값을 서버가 이긴다").toMatch(/\{\s*\.\.\.req\.body,\s*agentId\b/);
  });

  it("기본값은 대화창 정문과 **같은 값**이다 — 두 입구가 다른 규칙을 갖지 않게", () => {
    expect(라우트).toContain('"orchestrator"');
    const dispatcher = fs.readFileSync(path.join(engineDir, "dispatcher.ts"), "utf8");
    expect(dispatcher, "정문이 다른 값으로 폴백하면 들어온 문으로 제품이 달라진다").toContain('?? "orchestrator"');
  });

  it("빈 문자열·문자열 아닌 값도 기본값으로 떨어진다(공백만 보내는 탐침이 실제로 있었다)", () => {
    expect(라우트).toMatch(/typeof req\.body\?\.agentId === "string"/);
    expect(라우트).toMatch(/req\.body\.agentId\.trim\(\)/);
  });

  it("반증 — 요청이 주장하는 trusted를 덮어쓰는 계약은 그대로다(같은 객체에 끼워 넣었다)", () => {
    expect(라우트).toMatch(/\{\s*\.\.\.req\.body[^}]*trusted:\s*false[^}]*\}/);
  });
});

describe("수집이 조용히 죽지 않는다", () => {
  it("★ chat_logs.agentId는 NOT NULL 그대로다 — 스키마를 무르게 해서 「고치는」 길을 막는다", () => {
    const cols = db.prepare("PRAGMA table_info(chat_logs)").all() as Array<{ name: string; notnull: number }>;
    const agent = cols.find((c) => c.name === "agentId");
    expect(agent, "표가 통째로 없으면 이 시험은 아무것도 안 재는 것이다").toBeTruthy();
    expect(agent!.notnull, "누구의 대화인지 모르는 기록은 학습 재료가 못 된다").toBe(1);
  });

  it("팀원 이름이 없으면 실제로 한 건도 안 쌓인다 — 이것이 그날 고객 인스턴스의 모습이다", () => {
    const 전 = listChatLogs(1, 0).kpis.total;
    recordChatLog(null as unknown as string, "팀원 없이 들어온 질문", "답");
    expect(listChatLogs(1, 0).kpis.total, "여기가 늘어나면 NOT NULL이 풀린 것이다").toBe(전);
  });

  it("이름이 있으면 쌓인다 — 위 시험이 「원래 안 쌓이는 것」을 재는 게 아님을 못박는다", () => {
    const 전 = listChatLogs(1, 0).kpis.total;
    recordChatLog("orchestrator", "팀원 이름을 달고 들어온 질문", "답");
    expect(listChatLogs(1, 0).kpis.total).toBe(전 + 1);
  });

  it("★ 수집 실패를 **문구 0줄로** 삼키지 않는다 — 「대화 수집」이 들어가야 고객 QA 검사가 잡는다", () => {
    const i = llmSrc.indexOf("for (const 수집 of chatLogListeners)");
    expect(i).toBeGreaterThan(-1);
    const 구간 = llmSrc.slice(i, i + 600);
    expect(구간, "빈 catch면 채팅 200 뒤에 아무 흔적도 안 남는다").toMatch(/catch\s*\([^)]+\)\s*\{[^}]*console\.warn/);
    expect(구간).toContain("대화 수집");
    const verify = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "qa-instance", "verify.sh"), "utf8");
    expect(verify, "검사기가 안 보는 문구면 로그를 남겨도 아무도 안 본다").toContain("대화 수집 실패");
  });
});
