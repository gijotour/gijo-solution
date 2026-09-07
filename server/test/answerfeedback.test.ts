// 답변 지적 → 회귀셋 흡수 (계획서 중-1의 개발 몫).
// [전중후 계획서 정렬] 중-1의 약속은 "오답·미답 지적은 회귀셋으로 흡수". 이 시험이 지키는 것은
// ① 지적이 버려지지 않는다 ② 자동으로 문항이 되지는 않는다(사람이 편입) ③ 정답을 지어내지 않는다.
//
// ★ 2026-09-07 「고칠 것」 라운드(통합 설계관 S-A V2) — 여기에 넷이 더해졌다:
//   ④ 갈래·근거없음·인용을 **같은 INSERT에** 얼려 넣는다(나중에 다시 판정하지 않는다)
//   ⑤ 클라가 보낸 값을 그대로 믿지 않는다(값 집합·상한은 서버가 자른다)
//   ⑥ 조회는 admin이고, 그 위에 **열람 등급을 한 번 더** 태운다
//   ⑦ 초안은 재료가 있을 때만 만든다 — LLM을 모킹으로 「가짜 성공」시키지 않는다
//
// ★ 2026-09-07 검토관 수리(같은 날 오후) — 넷이 더 붙었다:
//   ⑧ 가린 조각의 내용이 **초안 칸으로** 새지 않는다(가림은 answer·quotes·draft 셋 다)
//   ⑨ 초안 재료는 **관문(가드레일)을 지난다** — 접수 창구는 누구나 쓰는 자유입력 통로다
//   ⑩ 「같은 답 N건」이 빈 답을 묶지 않는다 · days=abc가 「없습니다」로 굳지 않는다
//   ⑪ 고친 지적(resolved)이 **회귀셋에 남는다** — 옛 규칙은 정반대였다
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import request from "supertest";
import { createApp } from "../src/app";
import { resetUsersForTests } from "../src/auth/users";
import { db } from "../src/db";
import { resetAuditForTests, listAudit } from "../src/engine/audit";
import type { Request } from "express";
import {
  recordFeedback, listFeedback, getFeedback, setFeedbackStatus, setFeedbackKind, setFeedbackExpected,
  feedbackSummaryText, feedbackAsGateCases, resetFeedbackForTests, buildFeedbackDraft, deleteFeedback,
  초안재료가림, 초안팀원, 초안프롬프트, FEEDBACK_STATUS_AUDIT, FEEDBACK_STATUSES, 무르기시간_MS,
} from "../src/engine/answerfeedback";
import { 인용상한 } from "../src/engine/fixboard";
import { gateUserInputInner } from "../src/engine/gateway";

/** 초안·가림은 **누가 눌렀나**를 봐야 한다 — 시험이 쓰는 최소 req 꼴. */
const 누구 = (clearance: string | null = null): Request =>
  ({ user: { id: "u-test", username: "tester", displayName: "시험자", role: "admin", clearance } }) as unknown as Request;

beforeEach(() => resetFeedbackForTests());

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body as { accessToken: string; user: { id: string } };
}

describe("답변 지적 수집", () => {
  it("지적을 남기면 그대로 보관된다", () => {
    const f = recordFeedback({
      kind: "wrong", question: "KEV 조치 기한이 며칠이야?", answer: "30일입니다",
      note: "KEV는 2주가 기본인데 30일로 답했다", expected: "2주", actor: "정요한",
    });
    expect(f.id).toBeGreaterThan(0);
    const rows = listFeedback(7);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toContain("2주가 기본");
    expect(rows[0].status).toBe("open");
  });

  it("질문이 없으면 받지 않는다 — 무엇에 대한 지적인지 모르면 쓸 수 없다", () => {
    expect(() => recordFeedback({ kind: "wrong", question: "   ", answer: "x" })).toThrow();
  });

  it("처리해도 지워지지 않는다 — 무엇을 못 고쳤는지가 정보다", () => {
    const f = recordFeedback({ kind: "missing", question: "반출 절차 알려줘", answer: "못 찾음" });
    setFeedbackStatus(f.id, "dismissed", "검토자");
    const rows = listFeedback(7);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("dismissed");
  });
});

describe("회귀 문항 초안", () => {
  it("이미 편입한 지적(promoted)은 다시 나오지 않는다", () => {
    const a = recordFeedback({ kind: "wrong", question: "질문A", answer: "답A", expected: "정답A" });
    recordFeedback({ kind: "wrong", question: "질문B", answer: "답B" });
    setFeedbackStatus(a.id, "promoted");
    const cases = feedbackAsGateCases(30);
    expect(cases.map((c) => c.q)).toEqual(["질문B"]); // 편입 끝난 건 다시 안 나온다
  });

  it("담당자가 정답을 적어 준 경우에만 expect를 만든다 — 없으면 지어내지 않는다", () => {
    recordFeedback({ kind: "wrong", question: "질문C", answer: "답C" });
    const [c] = feedbackAsGateCases(30);
    expect(c.expect).toBeUndefined();
    expect(c._출처).toContain("실사용 지적");
  });

  it("정규식 특수문자가 든 정답도 안전하게 문항이 된다", () => {
    recordFeedback({ kind: "wrong", question: "질문D", answer: "답D", expected: "CVE-2021-44228 (Log4Shell)" });
    const [c] = feedbackAsGateCases(30);
    expect(new RegExp(c.expect![0]).test("CVE-2021-44228 (Log4Shell)")).toBe(true);
  });

  it("말투 지적은 게이트 문항 감이 아니다", () => {
    recordFeedback({ kind: "style", question: "질문E", answer: "답E", note: "너무 딱딱함" });
    expect(feedbackAsGateCases(30)).toHaveLength(0);
    expect(listFeedback(7)).toHaveLength(1); // 그래도 기록은 남는다
  });

  it("★ⓗ 고쳐서 닫은 지적(resolved)은 **회귀셋에 남는다** — 2026-09-07에 뒤집은 규칙", () => {
    // 옛 규칙은 open만 냈다. 그러면 **고친 지적일수록 회귀셋에서 사라져** 계획서 중-1
    // 「오답·미답 지적은 회귀셋으로 흡수」와 정반대가 된다. 정답(expected)은 보통 닫을 때
    // 적히므로, 닫힌 그 순간이 문항으로 가장 쓸모 있는 때다.
    const a = recordFeedback({ kind: "wrong", question: "고친 질문", answer: "30일" });
    setFeedbackExpected(a.id, "사내 기준은 2주");
    setFeedbackStatus(a.id, "resolved");
    const b = recordFeedback({ kind: "wrong", question: "편입 끝난 질문", answer: "답" });
    setFeedbackStatus(b.id, "promoted");
    const c = recordFeedback({ kind: "wrong", question: "부적합 질문", answer: "답" });
    setFeedbackStatus(c.id, "dismissed");
    recordFeedback({ kind: "wrong", question: "열린 질문", answer: "답" });

    const cases = feedbackAsGateCases(30);
    expect(cases.map((x) => x.q).sort()).toEqual(["고친 질문", "열린 질문"]);
    expect(cases.find((x) => x.q === "고친 질문")!.expect).toEqual(["사내 기준은 2주"]);
  });
});

describe("주간 요약", () => {
  it("지적이 없으면 없다고 말하고, 알려 달라고 안내한다", () => {
    expect(feedbackSummaryText(7)).toContain("지적이 없습니다");
  });

  it("있으면 종류별 건수와 미처리 목록을 낸다(상세를 켰을 때)", () => {
    recordFeedback({ kind: "wrong", question: "KEV 기한?", answer: "30일", note: "2주가 맞다" });
    recordFeedback({ kind: "missing", question: "반출 절차", answer: "못 찾음" });
    const t = feedbackSummaryText(7, true);
    expect(t).toContain("2건");
    expect(t).toContain("틀린 답");
    expect(t).toContain("2주가 맞다");
    expect(t).toContain("자동 편입은 하지 않습니다"); // 사람이 검토한다는 약속
  });

  it("★ 기본은 건수만이다 — 남이 낸 질문·사유가 대화 도구로 새지 않는다", () => {
    // 실측(검토관 2026-09-07 wiring): 결재판은 admin으로 닫았는데, 같은 원장의 글을 그대로
    // 내보내는 대화 도구(answer_feedback_status)는 담당자도 부를 수 있었다 — 자물쇠가 두 벌.
    recordFeedback({ kind: "wrong", question: "A은행 위약금 조항 3억", answer: "답", note: "계약서 12조가 맞다" });
    const t = feedbackSummaryText(7); // ← registry.ts가 부르는 꼴 그대로(인자 하나)
    expect(t).toContain("1건");            // 신호(건수)는 준다
    expect(t).toContain("고칠 것 갈래");
    expect(t).not.toContain("A은행 위약금"); // 남의 질문은 안 준다
    expect(t).not.toContain("계약서 12조");   // 남이 적은 사유도 안 준다
    expect(t).toContain("결재판(관리자)에서");  // 어디서 보는지는 말해 준다
  });

  it("★ 갈래별 줄이 붙고, 숫자는 200에서 안 멈춘다(집계는 fixboard 한 곳)", () => {
    for (let i = 0; i < 201; i++) recordFeedback({ kind: "wrong", question: `질문${i}`, answer: "답" });
    const t = feedbackSummaryText(7);
    expect(t).toContain("201건");
    expect(t).toContain("고칠 것 갈래");
    expect(t).toContain("미분류 201건");
  });
});

describe("ⓓ 접수 — 갈래·근거없음·인용을 같은 INSERT에 얼린다", () => {
  it("근거없음이 실려 오면 그 자리에서 fixkind=doc이 박힌다", () => {
    const f = recordFeedback({ kind: "wrong", question: "백업 보관 기간?", answer: "답", noev: "자료요청" });
    expect(f.fixkind).toBe("doc");
    expect(f.noev).toBe("자료요청");
    // 다시 읽어도 같다 — 읽을 때 재판정하지 않는다.
    expect(getFeedback(f.id)!.fixkind).toBe("doc");
  });

  it("근거없음이 없으면 미분류로 남는다(prod로 굳지 않는다)", () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답" });
    expect(f.fixkind).toBeNull();
    expect(f.noev).toBeNull();
    expect(getFeedback(f.id)!.fixkind).toBeNull();
  });

  it("인용이 같은 행에 본문 그대로 실린다 — 조각 id 포인터가 아니다", () => {
    const f = recordFeedback({
      kind: "wrong", question: "질문", answer: "답",
      quotes: [{ documentId: "규정.pdf", text: "보관 기간은 3년", title: "사내 규정" }],
    });
    expect(getFeedback(f.id)!.quotes).toEqual([{ documentId: "규정.pdf", text: "보관 기간은 3년", title: "사내 규정" }]);
  });
});

describe("ⓕⓖ 서버가 검증한다 — 클라 값을 그대로 믿지 않는다", () => {
  it("위조 noev는 버린다(값 집합 밖)", () => {
    for (const 위조 of ["제품결함", "prod", "", 1, {}, ["자료없음"]]) {
      const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답", noev: 위조 });
      expect(f.noev, String(위조)).toBeNull();
      expect(f.fixkind, String(위조)).toBeNull();
    }
  });

  it("인용 상한을 넘겨도 잘려서 들어간다 — 원문 전체가 표에 실리지 않는다", () => {
    const 큰 = "나".repeat(4000);
    const f = recordFeedback({
      kind: "wrong", question: "질문", answer: "답",
      quotes: [1, 2, 3, 4, 5].map((i) => ({ documentId: `d${i}`, text: 큰 })),
    });
    const q = getFeedback(f.id)!.quotes!;
    expect(q.length).toBeLessThanOrEqual(인용상한.조각);
    expect(q.reduce((s, x) => s + x.text.length, 0)).toBeLessThanOrEqual(인용상한.총글자);
    // 표에 실린 글자 총량이 원문(12,000자)의 한 줌뿐이다.
    expect(q.reduce((s, x) => s + x.text.length, 0)).toBeLessThan(큰.length);
  });
});

describe("ⓘ 감사 문구는 삼항이 아니라 표다", () => {
  beforeEach(() => resetAuditForTests());

  it("상태 넷이 저마다 다른 문구를 남긴다 — resolved에 「부적합」이 찍히면 실패", () => {
    const 본 = new Set<string>();
    for (const s of FEEDBACK_STATUSES) {
      const f = recordFeedback({ kind: "wrong", question: `질문-${s}`, answer: "답" });
      setFeedbackStatus(f.id, s, "검토자");
      const 최근 = listAudit({ kind: "config", limit: 50 }).find((a) => a.action === "답변 지적 처리" && a.target === String(f.id));
      expect(최근?.detail, s).toBe(FEEDBACK_STATUS_AUDIT[s]);
      본.add(최근!.detail!);
    }
    expect(본.size).toBe(FEEDBACK_STATUSES.length); // 넷이 서로 다르다
    expect(FEEDBACK_STATUS_AUDIT.resolved).not.toContain("부적합");
  });

  it("갈래를 바꾸면 「무엇에서 무엇으로」가 남는다", () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답", noev: "자료없음" });
    setFeedbackKind(f.id, "rule", "검토자");
    const a = listAudit({ kind: "config", limit: 50 }).find((x) => x.action === "답변 지적 갈래 변경");
    expect(a?.detail).toBe("자료 부족 → 사내 규정");
    expect(getFeedback(f.id)!.fixkind).toBe("rule");
  });
});

describe("승인 최종문 — 새 칸을 만들지 않고 expected에 넣는다(소비자가 이미 있다)", () => {
  it("최종문을 적으면 게이트 문항의 expect가 된다", () => {
    const f = recordFeedback({ kind: "wrong", question: "질문F", answer: "답F" });
    setFeedbackExpected(f.id, "  사내 기준은 2주입니다  ", "검토자");
    expect(getFeedback(f.id)!.expected).toBe("사내 기준은 2주입니다");
    const [c] = feedbackAsGateCases(30);
    expect(c.expect).toEqual(["사내 기준은 2주입니다"]);
  });
});

describe("무르기 — 접수 60초 안·본인만", () => {
  it("본인이 곧바로 무르면 행이 사라진다", () => {
    const f = recordFeedback({ kind: "wrong", question: "오타 지적", answer: "답", actor: "정요한" });
    expect(deleteFeedback(f.id, "정요한")).toEqual({ ok: true });
    expect(listFeedback(7)).toHaveLength(0);
  });

  it("남이 무를 수 없고, 1분이 지나면 못 무른다 — 지적은 버리지 않는다", () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답", actor: "정요한" });
    expect(deleteFeedback(f.id, "다른사람")).toMatchObject({ ok: false });
    expect(deleteFeedback(f.id, undefined)).toMatchObject({ ok: false });
    // 접수 시각을 1분 하고도 1초 전으로 밀어 둔다
    db.prepare("UPDATE answer_feedback SET at = ? WHERE id = ?").run(Date.now() - 무르기시간_MS - 1000, f.id);
    expect(deleteFeedback(f.id, "정요한")).toMatchObject({ ok: false });
    expect(listFeedback(7)).toHaveLength(1);
  });
});

describe("ⓔⓙ 라우트 — 없는 id는 404, 값 밖은 400, 조회는 admin", () => {
  let app: ReturnType<typeof createApp>;
  let admin: { accessToken: string };

  beforeEach(async () => {
    resetUsersForTests();
    resetFeedbackForTests();
    app = createApp();
    admin = await login(app);
  });
  const auth = () => ({ Authorization: `Bearer ${admin.accessToken}` });

  it("ⓔ 없는 id에 fixkind를 걸면 404(200이면 화면이 처리된 줄 안다)", async () => {
    const r = await request(app).post("/api/answer-feedback/99999/fixkind").set(auth()).send({ fixkind: "doc" });
    expect(r.status).toBe(404);
  });

  it("ⓔ 허용 값 밖 갈래는 400", async () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답" });
    for (const v of ["fixed", "제품", 3, "unclassified"]) {
      const r = await request(app).post(`/api/answer-feedback/${f.id}/fixkind`).set(auth()).send({ fixkind: v });
      expect(r.status, String(v)).toBe(400);
    }
    const ok = await request(app).post(`/api/answer-feedback/${f.id}/fixkind`).set(auth()).send({ fixkind: "prod" });
    expect(ok.status).toBe(200);
    expect(getFeedback(f.id)!.fixkind).toBe("prod");
    // null은 미분류로 되돌리기 — 허용한다.
    const back = await request(app).post(`/api/answer-feedback/${f.id}/fixkind`).set(auth()).send({ fixkind: null });
    expect(back.status).toBe(200);
    expect(getFeedback(f.id)!.fixkind).toBeNull();
  });

  it("status에 resolved가 들어가고, 승인과 최종문을 한 몸으로 보낼 수 있다", async () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답" });
    const r = await request(app).post(`/api/answer-feedback/${f.id}/status`).set(auth())
      .send({ status: "resolved", expected: "사내 기준은 2주" });
    expect(r.status).toBe(200);
    const row = getFeedback(f.id)!;
    expect(row.status).toBe("resolved");
    expect(row.expected).toBe("사내 기준은 2주");
    const bad = await request(app).post(`/api/answer-feedback/${f.id}/status`).set(auth()).send({ status: "fixed" });
    expect(bad.status).toBe(400);
  });

  it("ⓙ 조회는 admin — 담당자 계정에는 403(답 본문·인용이 등급 게이트 밖으로 안 샌다)", async () => {
    await request(app).post("/api/users").set(auth())
      .send({ username: "officer1", password: "pw123456", displayName: "담당자1", role: "security_officer" });
    const officer = await login(app, "officer1", "pw123456");
    const o = () => ({ Authorization: `Bearer ${officer.accessToken}` });

    recordFeedback({ kind: "wrong", question: "질문", answer: "사내 문서 원문이 실린 답", quotes: [{ documentId: "기밀.pdf", text: "기밀 조각" }] });

    for (const p of ["/api/answer-feedback", "/api/answer-feedback/gate-cases"]) {
      const r = await request(app).get(p).set(o());
      expect(r.status, p).toBe(403);
      expect(JSON.stringify(r.body), p).not.toContain("기밀 조각");
    }
    // 접수는 여전히 누구나 — 지적하는 길을 막으면 원장이 빈다.
    const post = await request(app).post("/api/answer-feedback").set(o()).send({ kind: "wrong", question: "새 지적", answer: "답" });
    expect(post.status).toBe(200);
    // admin은 본다 + 갈래 필터가 돈다
    const list = await request(app).get("/api/answer-feedback?days=7").set(auth());
    expect(list.status).toBe(200);
    expect(list.body.fixboard.total).toBe(2);
    expect(list.body.entries[0].sameAnswer).toBeGreaterThanOrEqual(1);
    const 필터 = await request(app).get("/api/answer-feedback?days=7&fixkind=unclassified").set(auth());
    expect(필터.body.entries).toHaveLength(2);
  });

  it("무르기 라우트 — 본인만(403) · 없는 id(404)", async () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답", actor: "남" });
    expect((await request(app).delete(`/api/answer-feedback/${f.id}`).set(auth())).status).toBe(403);
    expect((await request(app).delete("/api/answer-feedback/99999").set(auth())).status).toBe(404);
  });
});

describe("ⓚ 초안 — 재료가 없으면 만들지 않는다(모킹으로 가짜 성공시키지 않는다)", () => {
  it("인용 0개면 draft가 null이고 「초안 없음」이라 말한다 — LLM을 부르지 않는다", async () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답", note: "사람이 적은 사유" });
    const r = await buildFeedbackDraft(f.id, 누구());
    expect(r.draft).toBeNull();
    expect(r.reason).toContain("초안 없음");
    const row = getFeedback(f.id)!;
    expect(row.draft).toBeNull();
    expect(row.draftModel).toBeNull();
    expect(row.note).toBe("사람이 적은 사유"); // draft는 note를 덮지 않는다
  });

  it("없는 지적에도 지어내지 않는다", async () => {
    const r = await buildFeedbackDraft(99999, 누구());
    expect(r.draft).toBeNull();
    expect(r.reason).toContain("찾지 못했");
  });

  it("팀원 배정은 등록부 id 그대로 — doc·rule=사서(curator) · prod=우선(analysis)", () => {
    expect(초안팀원("doc", "wrong")).toBe("curator");
    expect(초안팀원("rule", "wrong")).toBe("curator");
    expect(초안팀원("prod", "wrong")).toBe("analysis");
    expect(초안팀원(null, "style")).toBe("analysis"); // 후보(style→prod)를 따른다
    expect(초안팀원(null, "missing")).toBe("curator");
  });

  it("프롬프트에 **그 답이 인용한 조각만** 들어간다(재검색 금지가 글로 박혀 있다)", () => {
    const f = recordFeedback({
      kind: "wrong", question: "보관 기간?", answer: "5년입니다", note: "3년이 맞다",
      quotes: [{ documentId: "규정.pdf", text: "보관 기간은 3년", title: "사내 규정" }],
    });
    const p = 초안프롬프트(getFeedback(f.id)!);
    expect(p).toContain("보관 기간은 3년");
    expect(p).toContain("새로 찾아보지도 마세요");
    expect(p).toContain("자료에 없어 확인하지 못했습니다");
  });

  // ★ LLM이 실제로 도는 경로는 **소스 감시**로 못 박는다 — vi.mock으로 "초안이 나왔다"를
  //   지어내면 그 시험은 제품이 아니라 목을 검증한다(모킹이 결함을 가린 전례).
  it("★ 소스 감시 — llm은 동적으로 부르고, 출력은 falseclaim 출구를 지나며, RAG를 켜지 않는다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "answerfeedback.ts"), "utf8");
    expect(src).toContain('await import("./llm.js")');
    expect(src).toContain("거짓완료차단(");
    // 정적 import를 더하면 llm을 목으로 흉내 낸 시험 76개가 이 파일 때문에 표면을 맞춰야 한다.
    expect(src).not.toMatch(/^import\s*\{[^}]*chat[^}]*\}\s*from\s*"\.\/llm"/m);
    // remember를 켜면 「재검색 금지」가 깨진다(RAG가 다시 돈다).
    expect(src).not.toMatch(/remember:\s*true/);
    expect(src).toContain("noLearn: true");
  });
});

// ── ⑧⑨⑩ⓠ 2026-09-07 검토관 수리 짝 시험 ────────────────────────────────
describe("⑧ 등급 가림 — 초안 칸으로도 새지 않는다", () => {
  let app: ReturnType<typeof createApp>;
  let admin: { accessToken: string };
  const auth = () => ({ Authorization: `Bearer ${admin.accessToken}` });

  beforeEach(async () => {
    resetUsersForTests();
    resetFeedbackForTests();
    db.exec("DELETE FROM memory_documents");
    app = createApp();
    admin = await login(app);
  });

  it("★ 못 볼 조각을 인용한 지적은 답·인용·**초안**이 함께 가려진다", async () => {
    // 실측(검토관 honesty [높음]): answer·quotes만 가리고 draft를 그대로 내보내, 가린 조각의
    // 문장이 초안 칸으로 통째로 나갔다("대외비 임금표에 따르면 3년입니다").
    db.prepare("INSERT INTO memory_documents (documentId, ingestedAt, grade) VALUES (?,?,?)")
      .run("기밀.pdf", new Date().toISOString(), "C");
    const f = recordFeedback({
      kind: "wrong", question: "근속 몇 년?", answer: "3년입니다",
      quotes: [{ documentId: "기밀.pdf", text: "대외비 임금표: 근속 3년" }],
    });
    db.prepare("UPDATE answer_feedback SET draft=?, draftModel=? WHERE id=?")
      .run("초안입니다: 대외비 임금표에 따르면 3년입니다", "curator · m", f.id);

    const r = await request(app).get("/api/answer-feedback?days=7").set(auth());
    const e = r.body.entries[0];
    expect(e.redacted).toBe(true);
    expect(e.quotes).toEqual([]);
    expect(e.draft).toBeNull();
    expect(e.draftModel).toBeNull();
    // 응답 **전체**에 그 문서의 글자가 한 번도 안 나온다(칸을 하나 빠뜨리면 여기서 걸린다).
    expect(JSON.stringify(r.body)).not.toContain("대외비 임금표");
  });

  it("★ 초안 만들기 자체가 막힌다 — 못 볼 문서를 눌러서 받아낼 수 없다", async () => {
    // buildFeedbackDraft에는 열람 판정이 아예 없어서, 목록에서 가려진 문서라도 초안 버튼으로
    // 내용을 받아낼 수 있었다(같은 적발의 뒷문). req를 **필수 인자**로 만들어 막았다.
    db.prepare("INSERT INTO memory_documents (documentId, ingestedAt, grade) VALUES (?,?,?)")
      .run("기밀2.pdf", new Date().toISOString(), "C");
    const f = recordFeedback({
      kind: "wrong", question: "질문", answer: "답",
      quotes: [{ documentId: "기밀2.pdf", text: "대외비 조각" }],
    });
    const r = await buildFeedbackDraft(f.id, 누구(null));
    expect(r.draft).toBeNull();
    expect(r.reason).toContain("열람 등급이 달라");
    expect(getFeedback(f.id)!.draft).toBeNull(); // 저장도 안 한다
  });

  it("볼 수 있는 문서면 가리지 않는다 — 가림이 「전부 감추기」로 번지지 않는다", async () => {
    db.prepare("INSERT INTO memory_documents (documentId, ingestedAt, grade) VALUES (?,?,?)")
      .run("공개.pdf", new Date().toISOString(), "O");
    recordFeedback({
      kind: "wrong", question: "질문", answer: "공개 답",
      quotes: [{ documentId: "공개.pdf", text: "공개 조각" }],
    });
    const r = await request(app).get("/api/answer-feedback?days=7").set(auth());
    expect(r.body.entries[0].redacted).toBeUndefined();
    expect(r.body.entries[0].answer).toBe("공개 답");
    expect(r.body.entries[0].quotes).toHaveLength(1);
  });
});

describe("⑨ 초안 재료는 관문을 지난다 — 접수 창구는 누구나 쓰는 자유입력 통로다", () => {
  it("★ 개인정보가 프롬프트에 원문으로 실리지 않는다(주민등록번호·카드번호)", () => {
    // 실측(검토관 wiring): chat({trusted:true})인데 재료(note·인용)는 게이트를 한 번도 안 지난
    // 사용자 자유입력이었다 — llm.ts가 「처음 받는 경로에서 trusted 금지」라고 못 박은 계약 위반.
    const f = recordFeedback({
      kind: "wrong", question: "질문", answer: "답",
      note: "담당자 주민등록번호 901010-1234567 건",
      quotes: [{ documentId: "d1", text: "결제 카드 4539-1488-0343-6467 확인" }],
    });
    const 태운 = 초안재료가림(getFeedback(f.id)!, gateUserInputInner);
    expect("재료" in 태운).toBe(true);
    const p = 초안프롬프트((태운 as { 재료: ReturnType<typeof getFeedback> & object }).재료);
    expect(p).not.toContain("901010-1234567");
    expect(p).toContain("<주민등록번호 가림>");
    expect(p).not.toContain("4539-1488-0343-6467");
    // 원장에는 담당자가 쓴 말이 그대로 남는다(가리는 것은 LLM에 넘기는 사본뿐).
    expect(getFeedback(f.id)!.note).toContain("901010-1234567");
  });

  it("해로운 글이 섞이면 초안을 만들지 않는다 — 「막혔다」고 말한다", () => {
    const 막는관문 = (t: string) => ({ allowed: false, text: t, message: "차단 · 시험용" });
    const f = recordFeedback({
      kind: "wrong", question: "질문", answer: "답", note: "무엇이든",
      quotes: [{ documentId: "d1", text: "조각" }],
    });
    const r = 초안재료가림(getFeedback(f.id)!, 막는관문);
    expect("막힘" in r).toBe(true);
    expect((r as { 막힘: string }).막힘).toContain("차단");
  });

  it("★ 소스 감시 ⓠ — 관문·열람 판정을 실제로 부르고, 원문이 아니라 **가린 사본**을 넘긴다", () => {
    // 함수를 만들어도 안 부르는 호출부가 계속 샌다(이 저장소 반복 유형). 글자로 못 박는다.
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "answerfeedback.ts"), "utf8");
    expect(src).toContain('await import("./gateway.js")');
    expect(src).toContain("초안재료가림(r, gateUserInputInner)");
    expect(src).toContain('await import("./memory.js")');
    expect(src).toContain("열람불가공용(q.documentId, req)");
    // chat에 넘기는 것은 태운 사본이다 — r을 그대로 넘기면 위 가림이 장식이 된다.
    const i = src.indexOf("const raw = await chat({");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 400)).toContain("초안프롬프트(태운.재료)");
    expect(src.slice(i, i + 400)).not.toContain("초안프롬프트(r)");
    // ⚠ gateUserInput(래퍼)이 아니라 Inner를 쓴다 — 관문 「입구」 등록부(gatewaypii 5곳)는
    //   사람이 처음 말을 넣는 자리의 목록이어야 하고, 여기는 저장된 글의 재검사다.
    expect(src).not.toContain("gateUserInput(");
  });
});

describe("⑩ 거짓 숫자·거짓 0 — 결재판이 지어내지 않는다", () => {
  let app: ReturnType<typeof createApp>;
  let admin: { accessToken: string };
  const auth = () => ({ Authorization: `Bearer ${admin.accessToken}` });

  beforeEach(async () => {
    resetUsersForTests();
    resetFeedbackForTests();
    app = createApp();
    admin = await login(app);
  });

  it("★ 답이 빈 지적들이 「같은 답 3건」으로 묶이지 않는다", async () => {
    for (const q of ["백업 보관 기간?", "KEV 조치 기한?", "반출 절차?"]) {
      const r = await request(app).post("/api/answer-feedback").set(auth()).send({ kind: "wrong", question: q });
      expect(r.status).toBe(200);
    }
    const r = await request(app).get("/api/answer-feedback?days=7").set(auth());
    expect(r.body.entries.map((e: { sameAnswer: number }) => e.sameAnswer)).toEqual([1, 1, 1]);
    // 진짜로 같은 답이면 여전히 묶는다(기능을 죽인 것이 아니다).
    recordFeedback({ kind: "wrong", question: "질문X", answer: "같은 답" });
    recordFeedback({ kind: "missing", question: "질문Y", answer: "같은 답" });
    const r2 = await request(app).get("/api/answer-feedback?days=7").set(auth());
    const 같은 = r2.body.entries.filter((e: { answer: string }) => e.answer === "같은 답");
    expect(같은.map((e: { sameAnswer: number }) => e.sameAnswer)).toEqual([2, 2]);
  });

  it("★ days=abc가 「지적이 없습니다」로 굳지 않는다(NaN이 0건으로 새던 자리)", async () => {
    recordFeedback({ kind: "wrong", question: "질문", answer: "답" });
    const r = await request(app).get("/api/answer-feedback?days=abc").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(7);              // 기본값으로 돌아온다
    expect(r.body.entries).toHaveLength(1);
    expect(r.body.fixboard.total).toBe(1);
    expect(r.body.summary).not.toContain("지적이 없습니다");
    expect(r.body.summary).not.toContain("NaN");
    // 게이트 문항 창구도 같은 잣대다.
    const g = await request(app).get("/api/answer-feedback/gate-cases?days=abc").set(auth());
    expect(g.body.cases).toHaveLength(1);
  });
});
