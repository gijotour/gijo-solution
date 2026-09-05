// metaleak.test.ts — **내부 메타 줄이 고객 답에 나가지 않는다**(2026-09-06 라이브 사고 수리 · 계획서 전-4)
//
// ★ 무엇을 지키나 — 실물 한 줄이 이 시험의 기준이다
//   라이브(2026-09-06 01:5x · 배포 4beef926 · PID 1901880)에서 「사내 임직원 보안서약서 제출률」 답 끝에
//   내부 저장소 경로와 교사 모델 파일명이 그대로 나갔다. 모델이 지어낸 게 아니라 **우리가 실어 준 것**이라,
//   프롬프트로는 못 막는다(7B에 규칙을 더해 행동을 고치려는 시도는 이 저장소에서 반복해 실패했다).
//   세 겹을 못 박는다:
//     ⓐ 앞으로 반입되는 승인 문답 **본문**에 그 두 줄이 안 실린다(learnmemory.approvedQaContent)
//     ⓑ 이미 들어간 3,778문서는 재반입 없이 **실을 때** 걷는다(memory.queryMemoryGraded 한 곳)
//     ⓒ 그래도 답에 남으면 **출구**에서 뗀다(llm.chat — 인용 가드와 같은 신호로 센다)
//   ⚠ 소스 감시가 함께 있는 이유: ⓑⓒ는 **호출 한 줄**이 사라지면 조용히 다시 새기 시작한다.
//     시험이 함수만 재면 「함수는 초록인데 제품은 샌다」가 된다(이 저장소가 반복해 겪은 부류).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { 메타줄걷기, 메타걷은조각, 메타줄있나 } from "../src/engine/metaleak";
import { approvedQaContent, approvedQaMeta } from "../src/engine/learnmemory";
import { recordChatLog, listChatLogs, resetLearnloopForTests } from "../src/engine/learnloop";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

/** 라이브에서 실제로 나간 꼬리 — **한 글자도 안 바꿨다**(줄바꿈·라벨 포함). */
const 실물꼬리 = [
  "근거 조각: store:개인정보_안전성_확보조치_기준_안내서_2024.pdf#2d8025162648",
  "교사 모델: models/qwen38-flash-next/Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf",
].join("\n");

const 실물답 = [
  "사내 임직원 보안서약서 제출률은 사내 자료에 기록이 없습니다.",
  "제출 현황을 관리하시려면 인사팀 대장을 지식에 넣어 주세요.",
  "",
  실물꼬리,
].join("\n");

describe("ⓑⓒ 메타 줄 걷기 — 실물 꼬리 전/후", () => {
  it("★ 실물 꼬리 두 줄이 사라지고 본문은 한 글자도 안 줄어든다", () => {
    expect(메타줄있나(실물답), "걷기 전에는 메타가 있다고 말해야 한다").toBe(true);
    const r = 메타줄걷기(실물답);
    expect(r.뗀줄수, "라벨 두 줄을 줄 단위로 센다").toBe(2);
    expect(r.text).not.toContain("store:");
    expect(r.text).not.toContain(".gguf");
    expect(r.text).not.toContain("근거 조각");
    expect(r.text).not.toContain("교사 모델");
    // 본문은 그대로 — 「내부 경로를 막는다」가 「답을 갉아먹는다」가 되면 안 된다.
    expect(r.text).toContain("사내 임직원 보안서약서 제출률은 사내 자료에 기록이 없습니다.");
    expect(r.text).toContain("인사팀 대장을 지식에 넣어 주세요.");
    expect(메타줄있나(r.text), "걷은 뒤에는 남아 있지 않다").toBe(false);
  });

  it("경로가 라벨 없이 문장 안에 있어도 그 줄을 뗀다 — 라벨만 지우면 빈 약속이 남는다", () => {
    const 답 = "확인했습니다.\n참고로 models/qwen38-flash-next/Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf 를 썼습니다.\n끝.";
    const r = 메타줄걷기(답);
    expect(r.뗀줄수).toBe(1);
    expect(r.경로, "무엇을 잡았는지 시험이 볼 수 있어야 한다").toEqual([
      "models/qwen38-flash-next/Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf",
    ]);
    expect(r.text).toBe("확인했습니다.\n끝.");
  });

  it("★ 자리표시 문구(models/<id>/<id>.gguf)는 **안 지운다** — 제품 설명을 갉아먹지 않는다", () => {
    const 설명 = "모델 파일은 models/<id>/<id>.gguf 자리에 둡니다.";
    expect(메타줄있나(설명)).toBe(false);
    expect(메타줄걷기(설명).text).toBe(설명);
  });

  it("걷고 나면 글자가 하나도 안 남는 조각은 **원문을 그대로** 둔다(빈 [n]을 만들지 않는다)", () => {
    const r = 메타줄걷기(실물꼬리);
    expect(r.뗀줄수, "빈 결과를 내느니 아무것도 안 한다").toBe(0);
    expect(r.text).toBe(실물꼬리);
  });

  it("메타가 없는 평범한 답은 손대지 않는다(같은 문자열을 그대로 돌려준다)", () => {
    const 답 = "취약점 202건 중 조치 완료는 182건입니다.\n남은 20건은 담당자 배정이 필요합니다.";
    expect(메타줄걷기(답).뗀줄수).toBe(0);
    expect(메타걷은조각(답)).toBe(답);
  });
});

describe("ⓐ 승인 문답 본문 — 앞으로 반입되는 문서부터 메타가 안 실린다", () => {
  const 로그 = {
    id: "x1", agentId: "orchestrator", question: "Q?", answer: "A.", rating: 1 as const,
    usedInDataset: false, createdAt: 0, topic: "취약점", origin: "distill" as const,
    teacher: "models/qwen38-flash-next/Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf",
    cites: ["store:개인정보_안전성_확보조치_기준_안내서_2024.pdf#2d8025162648"], promptHash: null,
  };

  it("★ 본문에 「근거 조각」·「교사 모델」 줄이 없다 — 질문·답·주제는 그대로", () => {
    const content = approvedQaContent(로그);
    expect(content).toContain("주제 취약점");
    expect(content).toContain("질문: Q?");
    expect(content).toContain("답변:");
    expect(content).not.toContain("근거 조각");
    expect(content).not.toContain("교사 모델:");
    expect(content).not.toContain("store:");
    expect(content).not.toContain(".gguf");
    expect(메타줄있나(content), "반입 본문 자체가 이미 깨끗하다").toBe(false);
  });

  it("메타를 **버린 게 아니다** — 원천(chat_logs)에서 그대로 되짚는다", () => {
    resetLearnloopForTests();
    recordChatLog("orchestrator", "보안서약서 제출률 알려줘", "사내 자료에 기록이 없습니다. 인사팀 대장을 넣어 주세요.");
    const id = listChatLogs(1, 0).logs[0].id;
    const meta = approvedQaMeta(id);
    expect(meta, "로그가 있으면 메타 칸이 나온다(비어 있어도 null이 아니다)").not.toBeNull();
    expect(Array.isArray(meta!.cites)).toBe(true);
    expect(approvedQaMeta("없는-로그-id"), "없는 로그는 null").toBeNull();
  });
});

describe("★ 배선 감시 — 호출 한 줄이 사라지면 조용히 다시 샌다", () => {
  it("ⓑ memory.queryMemoryGraded가 조각을 돌려줄 때 걷는다(chunks·scored 같은 제거본)", () => {
    const src = read("src", "engine", "memory.ts");
    expect(src).toContain('import { 메타걷은조각 } from "./metaleak"');
    expect(src, "조각을 만드는 자리에서 한 번에 걷어야 titles와 자리가 안 밀린다")
      .toMatch(/const 실을것 = 쓸것\.map\(\(c\) => \(\{ \.\.\.c, text: 메타걷은조각\(c\.text\) \}\)\);/);
    expect(src).toMatch(/chunks: 실을것\.map/);
    expect(src, "인용 가드의 대조 원천도 같은 제거본이라야 한다").toMatch(/scored: 실을것\.map/);
  });

  it("ⓒ llm.chat 출구가 인용 가드 **뒤에서** 한 번 더 뗀다 — 계수는 같은 kind=cite 신호", () => {
    const src = read("src", "engine", "llm.ts");
    expect(src).toContain('import { 메타줄걷기 } from "./metaleak"');
    expect(src).toMatch(/const 경로가드 = 메타줄걷기\(reply\);/);
    // 순서 — 가드가 먼저, 경로 걷기가 나중(앞에 두면 우리가 손댄 글을 가드가 자기인용으로 본다).
    expect(src.indexOf("const 인용가드 = guardCitations(")).toBeLessThan(src.indexOf("const 경로가드 = 메타줄걷기("));
    expect(src, "조용히 고치면 몇 달을 모른다 — 감독 화면에 건수가 뜬다")
      .toMatch(/내부 경로 \$\{경로가드\.뗀줄수\}줄 제거/);
    expect(src, "경로 문자열 자체는 감독 화면에 안 싣는다").not.toMatch(/detail:.*경로가드\.경로/);
  });

  it("ⓐ learnmemory가 본문에 꼬리 메타를 더 이상 안 적는다(소스로 못 박는다)", () => {
    const src = read("src", "engine", "learnmemory.ts");
    expect(src).not.toMatch(/lines\.push\([^)]*근거 조각/);
    expect(src).not.toMatch(/lines\.push\([^)]*교사 모델/);
    expect(src, "메타는 원천을 가리키는 함수로 남는다").toContain("export function approvedQaMeta(");
  });
});
