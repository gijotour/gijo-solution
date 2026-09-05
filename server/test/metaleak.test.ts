// metaleak.test.ts — **내부 메타 줄이 고객 답에 나가지 않는다**(2026-09-06 라이브 사고 수리 · 계획서 전-4)
//
// ★ 무엇을 지키나 — 실물 한 줄이 이 시험의 기준이다
//   라이브(2026-09-06 01:5x · 배포 4beef926 · PID 1901880)에서 「사내 임직원 보안서약서 제출률」 답 끝에
//   내부 저장소 경로와 교사 모델 파일명이 그대로 나갔다. 모델이 지어낸 게 아니라 **우리가 실어 준 것**이라,
//   프롬프트로는 못 막는다(7B에 규칙을 더해 행동을 고치려는 시도는 이 저장소에서 반복해 실패했다).
//   세 겹을 못 박는다:
//     ⓐ 앞으로 반입되는 승인 문답 **본문**에 그 두 줄이 안 실린다(learnmemory.approvedQaContent)
//     ⓑ 이미 들어간 3,778문서는 재반입 없이 **읽을 때** 걷는다 — 검색은 memory.**hybridSearch**
//       (4경로가 다 지난다), 검색을 안 지나는 **원본 판독기 3종**(getDocumentChunks·
//       getChunksForDocuments·getDocumentSample)도 같은 걷기를 쓴다
//     ⓒ 그래도 답에 남으면 **출구**에서 뗀다(llm.chat — 인용 가드와 같은 신호로 센다)
//   ⚠ 소스 감시가 함께 있는 이유: ⓑⓒ는 **호출 한 줄**이 사라지면 조용히 다시 새기 시작한다.
//     시험이 함수만 재면 「함수는 초록인데 제품은 샌다」가 된다(이 저장소가 반복해 겪은 부류).
//   ★ 2026-09-06 검토관 [높음] 돌연변이 실측으로 보강한 자리 — 아래 세 곳은 **한 줄을 지웠는데
//     시험 5,564개가 전부 초록**이던 구멍이다: ⓒ의 `reply = 경로가드.text` 대입 · 내부경로_RE의
//     `store:` 갈래 · 원본 판독기 3종. 지금은 각각 시험이 붙어 있다.
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

  it("★ **라벨 없는 store: 조각 참조**도 그 줄을 뗀다 — 승인 문답 2,326건이 이 꼴을 갖고 있다", () => {
    // 2026-09-06 검토관 [중간]: 내부경로_RE의 store: 갈래를 통째로 지워도 이 파일이 초록이었다.
    //   라벨 줄은 메타라벨줄_RE가 먼저 잡아 주므로, **라벨 없이 문장 안에 있는** 참조만이
    //   그 갈래를 실제로 재는 유일한 자리다(gguf 쪽에는 이미 그런 시험이 있었다).
    const 답 = "확인했습니다.\n출처는 store:개인정보_안전성_확보조치_기준_안내서_2024.pdf#2d8025162648 입니다.\n끝.";
    const r = 메타줄걷기(답);
    expect(r.뗀줄수).toBe(1);
    expect(r.경로, "store: 갈래가 잡은 것을 시험이 눈으로 본다").toEqual([
      "store:개인정보_안전성_확보조치_기준_안내서_2024.pdf#2d8025162648",
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
    // ★ 다만 **조용히** 지나가지는 않는다(2026-09-06 검토관 [낮음]) — 못 뗀 것을 표로 남긴다.
    expect(r.통째메타, "0줄로 통과시키면 감독 화면에 아무 신호도 안 뜬다").toBe(true);
  });

  it("평범한 답·정상 걷기에는 통째메타 표가 안 선다(못 뗀 자리에만 선다)", () => {
    expect(메타줄걷기("취약점 202건입니다.").통째메타).toBe(false);
    expect(메타줄걷기(실물답).통째메타, "본문이 남았으면 뗀 것이다").toBe(false);
    expect(메타줄걷기("").통째메타).toBe(false);
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
  it("ⓑ hybridSearch가 돌려줄 때 걷는다 — 검색 **4경로 전부**를 덮는 자리다", () => {
    const src = read("src", "engine", "memory.ts");
    expect(src).toContain('import { 메타걷은조각 } from "./metaleak"');
    // ★ 왜 Graded가 아니라 hybridSearch인가: Graded 한 곳에서만 걷으면 도구 경로
    //   (agenttools handlers)·검색 API·일일 점검(tasks)이 그물 밖으로 샌다.
    expect(src, "hybridSearch 반환에서 안 걷는다 — 4경로 중 셋이 샌다")
      .toMatch(/return 결과\.map\(\(c\) => \(\{ \.\.\.c, text: 메타걷은조각\(c\.text\) \}\)\);/);
    // 순위가 끝난 뒤에 걸어야 검색 점수가 안 바뀐다 — 융합·자르기보다 뒤에 있는가.
    expect(src.indexOf("const fused = applyDocScopeBoost("))
      .toBeLessThan(src.indexOf("return 결과.map((c) => ({ ...c, text: 메타걷은조각(c.text) }));"));
  });

  it("ⓑ 네 경로(queryMemory·Scored·Relevant·Graded)가 모두 hybridSearch를 지난다", () => {
    const src = read("src", "engine", "memory.ts");
    for (const 함수 of ["queryMemoryGraded", "queryMemoryScored", "queryMemoryRelevant", "queryMemory"]) {
      const i = src.indexOf(`export async function ${함수}(`);
      expect(i, `${함수}를 못 찾았다`).toBeGreaterThan(0);
      expect(src.slice(i, i + 600), `${함수}가 hybridSearch를 안 쓴다 — 그 경로만 샌다`)
        .toContain("await hybridSearch(");
    }
  });

  it("ⓒ llm.chat 출구가 인용 가드 **뒤에서** 한 번 더 뗀다 — 계수는 같은 kind=cite 신호", () => {
    const src = read("src", "engine", "llm.ts");
    expect(src).toContain('import { 메타줄걷기 } from "./metaleak"');
    // ★★ **걷은 결과를 답에 되돌리는가** — 여기가 가장 큰 구멍이었다(2026-09-06 검토관 [높음]).
    //   돌연변이 실측: 대입 한 줄(`reply = 경로가드.text;`)만 지웠더니 시험 5,564개가 전부 초록이고
    //   감독 화면에는 「제거」가 그대로 찍혔다 — 「안 고치고 고쳤다고 보고」하는 꼴이다.
    //   그래서 **부르는 줄과 대입 줄이 붙어 있는지**를 잰다(갈래 없이 무조건 대입).
    expect(src, "걷기 결과를 reply에 안 되돌리면 출구 방어가 죽은 채로 초록이 된다")
      .toMatch(/const 경로가드 = 메타줄걷기\(reply\);\s*\n\s*reply = 경로가드\.text;/);
    // 순서 — 가드가 먼저, 경로 걷기가 나중(앞에 두면 우리가 손댄 글을 가드가 자기인용으로 본다).
    expect(src.indexOf("const 인용가드 = guardCitations(")).toBeLessThan(src.indexOf("const 경로가드 = 메타줄걷기("));
    expect(src, "조용히 고치면 몇 달을 모른다 — 감독 화면에 건수가 뜬다")
      .toMatch(/\$\{경로가드\.뗀줄수\}줄 제거/);
    // ⚠ 없던 경로를 있다고 세지 않는다 — 라벨만 뗐으면 「내부 메타」다(검토관 [중간]).
    expect(src, "경로를 실제로 잡았을 때만 「내부 경로」라 적는다")
      .toMatch(/경로가드\.경로\.length > 0 \? "내부 경로" : "내부 메타"/);
    // ⚠ 못 뗀 자리(통째메타)도 감독 화면에 뜬다 — 조용한 통과를 막는다(검토관 [낮음]).
    expect(src).toMatch(/경로가드\.통째메타 \? "내부 메타뿐이라 원문 유지\(못 뗌\)" : ""/);
    expect(src, "경로 문자열 자체는 감독 화면에 안 싣는다").not.toMatch(/detail:.*경로가드\.경로/);
  });

  it("ⓑ 검색을 **안 지나는** 원본 판독기 3종도 같은 걷기를 쓴다 — 네 번째 누출 경로", () => {
    // 2026-09-06 검토관 [높음]: hybridSearch에만 달았더니 조각 미리보기 API(POST
    //   /api/memory/document/chunks)가 원본을 그대로 돌려줬고, 「AI 지식」 화면이 그 글을
    //   **Q&A 데이터셋 변환 입력칸**에 이어 붙였다 — 어댑터가 「근거 조각: store:…」를 외우는 길.
    const src = read("src", "engine", "memory.ts");
    /** 함수 **몸통만** 잘라 본다 — 넉넉히 자르면 옆 함수의 호출이 대신 초록을 만든다(헛통과). */
    const 몸통 = (이름: string) => {
      const i = src.indexOf(`export async function ${이름}(`);
      expect(i, `${이름}를 못 찾았다`).toBeGreaterThan(0);
      const 끝 = src.indexOf("\n}\n", i);
      expect(끝, `${이름}의 끝을 못 찾았다`).toBeGreaterThan(i);
      return src.slice(i, 끝);
    };
    for (const [함수, 자리] of [
      ["getDocumentChunks", "text: 메타걷은조각(r.text)"],
      ["getChunksForDocuments", "text: 메타걷은조각(r.text)"],
      ["getDocumentSample", "메타걷은조각(rows[0].text)"],
    ] as const) {
      expect(몸통(함수), `${함수}가 메타를 안 걷는다 — 그 판독기만 샌다`).toContain(자리);
    }
  });

  it("ⓐ learnmemory가 본문에 꼬리 메타를 더 이상 안 적는다(소스로 못 박는다)", () => {
    const src = read("src", "engine", "learnmemory.ts");
    expect(src).not.toMatch(/lines\.push\([^)]*근거 조각/);
    expect(src).not.toMatch(/lines\.push\([^)]*교사 모델/);
    expect(src, "메타는 원천을 가리키는 함수로 남는다").toContain("export function approvedQaMeta(");
  });
});
