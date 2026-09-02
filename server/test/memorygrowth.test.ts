// memorygrowth.test.ts — 겹 1 「기억 성장」 배선 계약 (증류학습 계획서 §6-1 · 설계관 ★3·9·10, 2026-09-03).
//
// ★ 왜 이 시험이 있나
//   승인 입구가 **네 곳**(후보 결정·일괄 승인·직접 평가·작업내역/시드 편입)이라 한 곳만 후크하면 나머지가
//   샌다. 그리고 등록(app.ts)을 잊으면 청취자 루프가 0회 돌아 **소리 없이** 아무것도 안 된다(memoryhooks와
//   같은 부류). 그래서 ① app.ts의 등록 줄 ② 청취자 수 ③ 네 입구가 전부 신호를 보내는가 ④ 승인→반입,
//   해제/삭제→제거의 사건 자체를 못 박는다. 실제 임베딩 서버는 시험에서 안 부른다 — 사건까지만 본다.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  recordChatLog, listChatLogs, rateChatLog, deleteChatLog, resetLearnloopForTests,
  onChatLogRated, chatLogRatedListenerCount, type ChatLogRatedEvent,
} from "../src/engine/learnloop";
import { 기억성장_배선, approvedQaDocId, approvedQaContent, APPROVED_QA_ORIGIN } from "../src/engine/learnmemory";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("★ 기억 성장 배선 — 등록이 없으면 승인해도 기억이 안 자란다", () => {
  it("app.ts가 기억성장_배선()을 부른다", () => {
    expect(read("src", "app.ts")).toContain("기억성장_배선()");
  });

  it("배선하면 청취자가 실제로 는다", () => {
    const 전 = chatLogRatedListenerCount();
    기억성장_배선();
    expect(chatLogRatedListenerCount()).toBe(전 + 1);
  });

  it("승인 입구 네 곳이 전부 신호를 보낸다 — rateChatLog 하나만 후크하면 작업내역·시드가 샌다", () => {
    const ll = read("src", "engine", "learnloop.ts");
    const lc = read("src", "engine", "learncandidates.ts");
    const rateFn = ll.slice(ll.indexOf("export function rateChatLog"), ll.indexOf("export function deleteChatLog"));
    expect(rateFn).toContain('emitChatLogRated({ kind: "approved"');
    expect(rateFn).toContain('emitChatLogRated({ kind: "unapproved"');
    const delFn = ll.slice(ll.indexOf("export function deleteChatLog"), ll.indexOf("export function deleteChatLog") + 600);
    expect(delFn).toContain('emitChatLogRated({ kind: "unapproved"');
    // 작업내역 승인(ws:)과 시드는 INSERT로 rating=1을 직접 박는다 — 각각 신호를 보내야 한다.
    const wsBlock = lc.slice(lc.indexOf('id.startsWith("ws:")'), lc.indexOf("putDecisionStmt.run(id"));
    expect(wsBlock).toContain('emitChatLogRated({ kind: "approved"');
    const seedBlock = lc.slice(lc.indexOf('"/api/learnloop/seed"'), lc.indexOf('"/api/learnloop/distill/intake"'));
    expect(seedBlock).toContain('emitChatLogRated({ kind: "approved"');
  });
});

describe("승인·해제·삭제 사건", () => {
  beforeEach(() => resetLearnloopForTests());

  it("👍 → approved(로그 포함) · 해제 → unapproved · 승인된 것 삭제 → unapproved", () => {
    const got: ChatLogRatedEvent[] = [];
    onChatLogRated((e) => got.push(e));
    recordChatLog("orchestrator", "방화벽 월간 정기점검 절차를 알려줘", "정기점검은 정책 백업, 룰 검토, 로그 확인 순서로 진행합니다. 결과는 점검 대장에 남깁니다.");
    const id = listChatLogs(1, 0).logs[0].id;
    rateChatLog(id, 1);
    expect(got.at(-1)).toMatchObject({ kind: "approved", log: { id, rating: 1, origin: "chat" } });
    rateChatLog(id, 0);
    expect(got.at(-1)).toEqual({ kind: "unapproved", id });
    rateChatLog(id, -1); // 승인이 아니었던 것의 👎는 신호가 없다
    expect(got.length).toBe(2);
    rateChatLog(id, 1);
    deleteChatLog(id);
    expect(got.at(-1)).toEqual({ kind: "unapproved", id });
  });
});

describe("반입 모양 — scope는 global, 구분은 category, 문서 수 계열에서는 뺀다", () => {
  it("documentId는 승인문답:<id>, 본문에 주제·출처·질문·답이 있다", () => {
    const content = approvedQaContent({
      id: "x1", agentId: "orchestrator", question: "Q?", answer: "A.", rating: 1, usedInDataset: false, createdAt: 0,
      topic: "취약점", origin: "distill", teacher: "t", cites: ["k.md#ab"],
    });
    expect(approvedQaDocId("x1")).toBe("승인문답:x1");
    expect(content).toContain("주제 취약점");
    expect(content).toContain("교사 모델 증류(승인됨)");
    expect(content).toContain("질문: Q?");
    expect(content).toContain("근거 조각: k.md#ab");
  });

  it("learnmemory는 GLOBAL_SCOPE로 넣고 origin=approved-qa를 단다(scope에 한글을 넣으면 검색 밖으로 사라진다)", () => {
    const src = read("src", "engine", "learnmemory.ts");
    expect(src).toMatch(/ingestText\([^;]*m\.GLOBAL_SCOPE[^;]*APPROVED_QA_ORIGIN\)/);
    expect(APPROVED_QA_ORIGIN).toBe("approved-qa");
  });

  it("새로 들어온 문서 대장·중복 후보는 승인 문답을 뺀다", () => {
    expect(read("src", "engine", "docdigest.ts")).toContain("<> 'approved-qa'");
    expect(read("src", "engine", "docdupe.ts")).toContain("<> 'approved-qa'");
  });
});
