// test/sourcetitles.test.ts — 근거 **표시 이름**에 내부 ID가 실리지 않는다 (2026-09-06 · 계획서 전-4 4-ⓑ)
//
// ★ 무엇이 있었나(라이브 실측, 배포 12): 응답 `sources` 배열에 우리 내부 키가 그대로 실렸다 —
//     "sources": ["승인문답:dtmtl5b1fzj215l3", …]
//   그 배열이 그대로 ⓐ 화면 근거 배지의 글자가 되고 ⓑ 팀 사무실 협업 피드 문구
//     「📚 근거 — 사내 문서 4건 (승인문답:… · 승인문답:… 외)」가 됐다.
//   담당자에게 이 문자열은 **아무것도 안 가리키고** 우리 저장 구조만 드러낸다.
//   R2(0cc6a133)는 프롬프트 경로(llm.ragBlock)만 막아서 **응답 필드로는 계속 샜다.**
//
// ■ 왜 sources를 제목으로 갈아 끼우지 않았나 — **ID를 쓰는 소비자가 실재한다**
//   · server/src/engine/handover.ts:156  `sources.includes(documentId)` — 인수인계 자동 검증의 판정
//   · client/.../chatparts.js 문서열기신호(id) — 배지를 누르면 그 ID로 원문을 연다
//   → sources(ID)는 그대로 두고 **sourceTitles(사람 제목, 같은 순서)**를 옆에 더했다.
//     화면·피드 문구는 sourceTitles만 쓴다. 이 파일이 그 계약이다.
//
// ⚠ 제목 판정은 **제품 함수(memory.사람이읽는문서제목)** 한 곳이다 — 이 시험은 정규식을 베끼지 않고
//   제품 함수(내부ID꼴)를 불러서 잰다. 2026-09-06에 시험이 사본 정규식을 들고 있어 제품이 새는데도
//   전수 시험이 초록이던 사고를 반복하지 않는다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// 실 LLM을 띄우지 않는다(dispatchcollect.test.ts와 같은 표면 — 안 주면 llm을 import하는 파일이 통째로 죽는다).
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "사내 규정상 로그는 1년 보관합니다. 자세한 절차는 담당 부서와 확인하세요."),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
  smallTalkReply: vi.fn(() => null),
}));

// 근거 검색만 흉내 낸다 — **제목 판정(사람이읽는문서제목)은 진짜 제품 함수**를 쓴다(importOriginal).
const graded = { docIds: [] as string[], 약한근거만: false };
vi.mock("../src/engine/memory", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/engine/memory")>();
  return {
    ...orig,
    queryMemoryGraded: vi.fn(async () => ({
      chunks: graded.docIds.map((id) => `${id} 조각 본문`),
      titles: graded.docIds.map((id) => orig.사람이읽는문서제목(id)),
      scored: graded.docIds.map((id) => ({ text: `${id} 조각 본문 — 로그는 1년 보관`, distance: 0.4, documentId: id })),
      약한근거만: graded.약한근거만,
    })),
  };
});

import { dispatchInstruction, 근거피드문구 } from "../src/engine/dispatcher";
import { 사람이읽는문서제목, 내부ID꼴 } from "../src/engine/memory";
import { approvedQaDocId, APPROVED_QA_DOC_PREFIX } from "../src/engine/learnmemory";
import { incidentCaseDocId } from "../src/engine/incidentcases";
import { collaborationHistory, resetCollaborationForTests } from "../src/engine/collaboration";
import { db } from "../src/db";

/** 라이브에서 실제로 새어 나온 그 값 — 손으로 접두를 적지 않는다(제품 상수로 만든다). */
const 실물ID = approvedQaDocId("dtmtl5b1fzj215l3");
const 질문 = "로그 보관 기간 알려줘";

const 사례심기 = (id: string, title: string): void => {
  db.prepare(
    `INSERT OR REPLACE INTO incident_cases
     (id, createdAt, updatedAt, title, oneLiner, plainExplain, year, industry, region, techniques, cves, products, lesson, sourceUrl, sourceName, origin)
     VALUES (?, 1, 1, ?, '한 줄', '풀이', 2023, '제조', '국내', '[]', '[]', '[]', '교훈', 'https://example.test', '출처', 'user')`,
  ).run(id, title);
};
const 개인문서심기 = (id: string, title: string): void => {
  db.prepare(
    "INSERT OR REPLACE INTO personal_docs (id, userId, title, body, ragOptIn, shared, createdAt, updatedAt) VALUES (?, 'u1', ?, '내용', 1, 0, 1, 1)",
  ).run(id, title);
};
const 정리 = (): void => {
  db.exec("DELETE FROM incident_cases WHERE id LIKE 'ic-st%'; DELETE FROM personal_docs WHERE id LIKE 'st-%'");
};

beforeEach(() => {
  정리();
  graded.docIds = [];
  graded.약한근거만 = false;
  resetCollaborationForTests();
});
afterEach(() => 정리());

describe("★★ 근거 표시 이름 — 내부 ID를 담당자에게 내보내지 않는다", () => {
  it("① 실물 재현 — 「승인문답:dtmtl5b1fzj215l3」이 근거여도 **표시 문자열엔 0건**이다", async () => {
    graded.docIds = [실물ID, approvedQaDocId("dtmtl40khqg8uehk")];
    const r = await dispatchInstruction(질문);

    // 소비자 계약: ID는 sources에 **그대로** 남는다(handover가 includes로 판정하는 값이다).
    expect(r.sources, "근거 재검색이 안 돌았다 — 이 시험이 재는 자리에 도달 못 했다").toBeTruthy();
    expect(r.sources).toContain(실물ID);

    // 표시 계약: 같은 순서·같은 길이의 제목 칸이 있고, 내부 ID는 **제목 생략**(빈 문자열)이다.
    expect(r.sourceTitles, "표시용 제목 칸이 없다 — 화면이 ID를 그대로 찍게 된다").toBeTruthy();
    expect(r.sourceTitles).toHaveLength(r.sources!.length);
    for (const t of r.sourceTitles!) {
      expect(t, `내부 ID가 표시 제목으로 나갔다: ${t}`).toBe("");
    }
    // 전수 잣대 — 제품 판정기로 본다(정규식 사본 금지).
    for (const t of r.sourceTitles!) expect(내부ID꼴(t)).toBe(false);
    expect(r.sourceTitles!.join(" "), "표시 문자열에 접두가 남았다").not.toContain(APPROVED_QA_DOC_PREFIX);
  });

  it("② 사례·개인·일반 문서가 **사람이 읽는 제목**으로 나간다 (같은 자리 순서 유지)", async () => {
    사례심기("ic-st0000000001", "OO기업 랜섬웨어 감염");
    개인문서심기("st-1111", "내 점검 메모.md");
    graded.docIds = [incidentCaseDocId("ic-st0000000001"), "personal:st-1111", "로그관리_지침.pdf", 실물ID];

    const r = await dispatchInstruction(질문);
    expect(r.sources).toEqual(graded.docIds);
    // 제품 함수와 **글자 단위로** 같아야 한다 — 제목을 여기서 손으로 적으면 판정이 두 곳이 된다.
    expect(r.sourceTitles).toEqual(graded.docIds.map((id) => 사람이읽는문서제목(id)));
    expect(r.sourceTitles).toEqual(["[사례] OO기업 랜섬웨어 감염", "내 점검 메모.md", "로그관리_지침.pdf", ""]);
  });

  it("③ 근거 원문(quotes)도 같은 계약 — documentId는 그대로, 제목 칸이 따로 붙는다", async () => {
    사례심기("ic-st0000000002", "협력사 계정 탈취");
    graded.docIds = [incidentCaseDocId("ic-st0000000002"), 실물ID];

    const r = await dispatchInstruction(질문);
    expect(r.quotes?.length, "원문 대목이 없다").toBeGreaterThan(0);
    for (const q of r.quotes ?? []) {
      expect(q.documentId, "원문 대목이 문서 ID를 잃었다 — 눌러도 원문을 못 연다").toBeTruthy();
      expect(q.title, "원문 대목에 표시용 제목 칸이 없다").toBeTypeOf("string");
      expect(내부ID꼴(String(q.title)), `원문 대목 머리에 내부 ID가 나갔다: ${q.title}`).toBe(false);
    }
    expect(r.quotes?.[0].title).toBe("[사례] 협력사 계정 탈취");
    expect(r.quotes?.find((q) => q.documentId === 실물ID)?.title).toBe("");
  });

  it("④ 협업 피드 문구가 제목만 싣는다 — 제목이 없으면 **건수만** 말한다", async () => {
    graded.docIds = [실물ID, approvedQaDocId("dtmtl40khqg8uehk"), "store:abc123#0f40a"];
    await dispatchInstruction(질문);

    const 피드 = collaborationHistory(200).filter((e) => e.message.includes("📚 근거"));
    expect(피드.length, "협업 피드에 근거 한 줄이 안 나갔다").toBeGreaterThan(0);
    for (const e of 피드) {
      expect(e.message, `협업 피드에 내부 ID가 흘렀다: ${e.message}`).not.toContain(APPROVED_QA_DOC_PREFIX);
      expect(e.message).not.toContain("store:");
      expect(e.message).toBe("📚 근거 — 사내 문서 3건");
    }
  });

  it("④ 문장 조립은 근거피드문구 한 곳 — 이름이 있을 때만 괄호를 연다", () => {
    expect(근거피드문구(4, ["", "", "", ""])).toBe("📚 근거 — 사내 문서 4건");
    expect(근거피드문구(4, undefined)).toBe("📚 근거 — 사내 문서 4건");
    expect(근거피드문구(2, ["가.pdf", "나.pdf"])).toBe("📚 근거 — 사내 문서 2건 (가.pdf · 나.pdf)");
    expect(근거피드문구(3, ["가.pdf", "나.pdf", "다.pdf"])).toBe("📚 근거 — 사내 문서 3건 (가.pdf · 나.pdf 외)");
    // 이름을 댈 수 있는 것이 하나뿐이면 나머지는 「외」로 밝힌다(4건인데 1건만 이름).
    expect(근거피드문구(4, ["가.pdf", "", "", ""])).toBe("📚 근거 — 사내 문서 4건 (가.pdf 외)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 화면 쪽 계약 — 서버가 제목을 실어 보내도 **화면이 안 쓰면** 담당자 눈에는 그대로 ID가 보인다.
describe("★ 화면이 제목으로 그리고 ID로 연다 (소스 감시)", () => {
  const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  const parts = 읽기("../../client/src/renderer/pages/chatparts.js");

  it("배지 부품이 sourceTitles를 받아 그린다", () => {
    expect(parts, "부품이 sourceTitles를 안 받는다").toMatch(/function quotes\([^)]*sourceTitles/);
    // 이름은 제목에서, 여는 것은 ID에서 — 두 갈래가 코드에 실제로 있어야 한다.
    expect(parts, "제목 자리를 안 읽는다").toContain("sourceTitles[i]");
    expect(parts, "제목이 없을 때 건수로 말하는 자리가 없다").toContain("사내 문서 ");
    expect(parts, "문서 열기는 여전히 ID로 해야 한다").toMatch(/문서열기신호\(s\.id\)/);
    // 원문 대목 머리도 제목을 쓴다(같은 누출이 그 자리에도 있었다).
    expect(parts, "원문 대목 머리가 제목을 안 쓴다").toContain("q.title");
  });

  it("두 대화 입구가 **둘 다** sourceTitles를 넘긴다 — 한쪽만 고치면 분리창에서 ID가 보인다", () => {
    const con = 읽기("../../client/src/renderer/pages/console.js");
    const wid = 읽기("../../client/src/renderer/pages/chatwidget.js");
    expect(con, "지휘소가 sourceTitles를 안 넘긴다").toMatch(/P\.quotes\(replyEl[\s\S]{0,200}?sourceTitles/);
    expect(wid, "분리창이 sourceTitles를 안 넘긴다").toMatch(/P\.quotes\(typing[\s\S]{0,200}?sourceTitles/);
  });

  it("서버가 두 출구 **모두**에서 제목을 붙인다 — qa(게이트) 경로만 빠지면 측정이 딴 답을 본다", () => {
    const disp = 읽기("../src/engine/dispatcher.ts");
    expect(disp, "응답 타입에 sourceTitles가 없다").toMatch(/sourceTitles\?:\s*string\[\]/);
    const 붙인곳 = disp.match(/근거제목붙이기\(\{/g) ?? [];
    expect(붙인곳.length, "제목을 붙이는 출구가 둘이 아니다(qa 경로 또는 사람 경로가 빠졌다)").toBe(2);
    // 판정은 memory 한 곳 — dispatcher가 접두·정규식을 따로 들면 두 잣대가 어긋난다.
    expect(disp, "제목 판정을 memory에서 안 가져온다").toContain("m.사람이읽는문서제목");
    expect(disp, "dispatcher가 접두 문자열 사본을 들었다").not.toContain('"승인문답:"');
  });
});
