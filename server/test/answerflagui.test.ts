// 「이 답 이상해요」 — 대화창 꼬리·통로·결재판 두 번째 원장의 **짝 시험**(C-A, 2026-09-07).
// [전중후 계획서 정렬] 중-1 「파일럿 실사용 피드백 루프」 — 지적을 받는 입구와 처리하는 자리.
//
// ■ 이 파일이 지키는 것
//   ① 「이 답 이상해요」를 **그리는 곳이 chatparts.js 한 곳**이다(사본이 생기면 빨개진다).
//   ② 호출부는 **셋뿐**이다 — console.js 새 답·이어보기, chatwidget.js. 업로드 영수증·화면
//      카드(uploadResultMsg·screenCard)에는 **없어야** 한다(LLM 답이 아니라 answer가 빈 행이 쌓인다).
//   ③ preload가 목록·상태·갈래·최종문·초안·무르기 **여섯을 노출**한다 — 한 줄이 빠지면
//      결재판의 두 번째 원장이 통째로 죽는데 화면은 **조용히 빈 목록**을 그린다.
//   ④ console.ts의 `근거없음` 유니언이 서버 `근거없음종류`와 **값까지 같다**(숫자무근거 누락 재발 감시).
//   ⑤ 결재판의 두 원장이 **안 섞인다** — allFix를 allReviews에 합치면 r.finding.severity에서
//      즉시 TypeError고, VEX·심각도·SLA가 딴 원장 값으로 오염된다.
//   ⑥ 무르기(취소)는 **60초 뒤에 조작으로 남지 않는다** — 서버가 그 뒤로 403이라, 버튼만 남으면
//      「됐다고 했는데 안 된다」가 된다. 가짜 DOM에서 실제로 돌려 잰다.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 화면 = (f: string) => path.join(__dirname, "../../client/src/renderer/pages/", f);
const chatparts = fs.readFileSync(화면("chatparts.js"), "utf8");
const console_ = fs.readFileSync(화면("console.js"), "utf8");
const widget = fs.readFileSync(화면("chatwidget.js"), "utf8");
const approvals = fs.readFileSync(화면("approvals.html"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "../../client/src/preload.ts"), "utf8");
const consoleApi = fs.readFileSync(path.join(__dirname, "../../client/src/api/console.ts"), "utf8");
const noevidence = fs.readFileSync(path.join(__dirname, "../src/engine/noevidence.ts"), "utf8");

/** `function 이름(` 부터 **다음 함수 머리 앞**까지 — 그 함수의 몸만 자른다. */
function 함수몸(src: string, 머리: string): string {
  const i = src.indexOf(머리);
  expect(i, `${머리} 를 못 찾았다 — 이 시험이 헛돈다(이름이 바뀌었으면 여기도 고칠 것)`).toBeGreaterThan(0);
  const 뒤 = src.slice(i + 머리.length);
  const j = 뒤.search(/\n {2}(?:async )?function /);
  return 뒤.slice(0, j < 0 ? 뒤.length : j);
}

describe("① 「이 답 이상해요」를 그리는 곳은 chatparts.js 한 곳", () => {
  it("부품이 chatparts.js에 있고 내보내진다", () => {
    expect(chatparts, "P.flag 정의가 없다").toMatch(/function flag\(el, ctx, ops\)/);
    expect(chatparts, "window.gijoChatParts 내보내기에 flag가 없다 — 부르는 쪽이 못 찾는다")
      .toMatch(/window\.gijoChatParts = \{[^}]*flag: flag/);
    expect(chatparts, "꼬리 글자가 부품에 없다").toContain("▶ 이 답 이상해요");
  });

  it("★ 사본이 없다 — 카드를 직접 그리던 옛 코드(openFlagCard)가 되살아나지 않는다", () => {
    const 코드 = console_.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(코드, "openFlagCard 정의가 남아 있다 — 그리는 곳이 둘이 됐다").not.toContain("function openFlagCard");
    expect(코드, "옛 카드의 부품(#fbKinds)이 남아 있다").not.toContain("fbKinds");
    for (const [이름, src] of [["console.js", console_], ["chatwidget.js", widget]] as const) {
      expect(src, `${이름}에 꼬리 글자 사본이 생겼다 — 부품 한 곳 원칙이 깨진다`).not.toContain("▶ 이 답 이상해요");
    }
  });

  it("attachFlag는 지우지 않고 부품을 부르는 껍데기로 남는다(옆 함수를 잘라 먹은 전례)", () => {
    expect(console_, "attachFlag가 사라졌다 — 호출부 둘이 죽는다").toContain("function attachFlag(");
    expect(함수몸(console_, "function attachFlag("), "껍데기가 부품을 안 부른다").toContain("P.flag(");
  });
});

describe("② 호출부는 셋뿐 — 답이 아닌 줄에는 안 붙는다", () => {
  it("console.js는 정의 1 + 호출 2(새 답·이어보기)뿐이다", () => {
    const 코드 = console_.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect((코드.match(/\battachFlag\(/g) || []).length,
      "attachFlag 등장이 3(정의1+호출2)이 아니다 — 새 자리에 붙였거나 호출이 빠졌다").toBe(3);
  });

  it("★ 이어보기 복원(restore)에도 배선돼 있다 — 어제 답을 오늘 짚을 수 있다", () => {
    expect(함수몸(console_, "async function restore()"), "복원된 답에는 지적을 못 남긴다").toContain("attachFlag(");
  });

  it("★ 업로드 영수증·화면 카드에는 **없다**(LLM 답이 아니다 — answer가 빈 행이 쌓인다)", () => {
    expect(함수몸(console_, "function uploadResultMsg(r)"), "업로드 영수증에 지적 꼬리가 붙었다").not.toContain("attachFlag(");
    expect(함수몸(console_, "function screenCard(page, label)"), "화면 카드에 지적 꼬리가 붙었다").not.toContain("attachFlag(");
  });

  it("chatwidget(분리창·화면 위젯)도 같은 부품을 부른다 — 자리마다 다르면 담당자는 기능이 없어진 줄 안다", () => {
    expect(widget, "위젯에 P.flag 배선이 없다").toMatch(/P\.flag\(/);
    expect(widget, "위젯이 자기 카드를 따로 그린다").not.toContain("function openFlagCard");
  });
});

describe("③ 통로 — preload가 여섯을 노출한다(빠지면 화면이 조용히 빈 목록을 그린다)", () => {
  const 노출 = new Set([...preload.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]));

  it("여섯 이름이 실제로 노출돼 있다", () => {
    for (const n of ["listAnswerFeedback", "setAnswerFeedbackStatus", "setAnswerFeedbackKind",
      "setAnswerFeedbackExpected", "buildAnswerFeedbackDraft", "removeAnswerFeedback"]) {
      expect(노출.has(n), `preload에 ${n}가 없다 — 부르면 TypeError로 죽는다`).toBe(true);
    }
    expect(노출.has("sendAnswerFeedback"), "보내기가 사라졌다").toBe(true);
  });

  it("접수 타입에 noev·quotes가 있다 — 없으면 갈래가 늘 미분류로 눌린다", () => {
    const 줄 = preload.split("\n").find((l) => l.includes("sendAnswerFeedback:")) ?? "";
    expect(줄, "sendAnswerFeedback 타입에 noev가 없다").toContain("noev");
    expect(줄, "sendAnswerFeedback 타입에 quotes가 없다").toContain("quotes");
  });

  it("결재판이 부르는 window.gijo.*가 전부 노출 목록 안이다", () => {
    const 없는것 = [...approvals.matchAll(/window\.gijo\.([A-Za-z_][A-Za-z0-9_]*)/g)]
      .map((m) => m[1]).filter((n) => !노출.has(n));
    expect([...new Set(없는것)], "결재판이 없는 함수를 부른다").toEqual([]);
  });
});

describe("④ 근거없음 유니언 — 클라와 서버가 **값까지** 같다", () => {
  it("서버 5종을 실제로 읽어 온다 — 못 읽으면 이 시험이 거짓 통과다", () => {
    const m = noevidence.match(/export type 근거없음종류 = ([^;]+);/);
    expect(m, "서버 타입을 못 읽었다").not.toBeNull();
    expect((m![1].match(/"/g) || []).length / 2).toBeGreaterThanOrEqual(5);
  });

  it("★ console.ts 유니언 == 서버 근거없음종류(숫자무근거 포함)", () => {
    const 서버 = (noevidence.match(/export type 근거없음종류 = ([^;]+);/)![1].match(/"([^"]+)"/g) || []).sort();
    const 클라줄 = consoleApi.split("\n").find((l) => /근거없음\?:/.test(l)) ?? "";
    const 클라 = (클라줄.match(/"([^"]+)"/g) || []).sort();
    expect(클라, "클라 유니언이 서버와 다르다 — 빠진 갈래는 타입상 존재하지 않아 조용히 샌다").toEqual(서버);
  });
});

describe("⑤ 결재판 — 두 원장이 안 섞인다", () => {
  it("두 번째 원장이 별도 배열이다", () => {
    expect(approvals, "allFix 배열이 없다 — 지적을 어디에 담나").toMatch(/let allFix = \[\]/);
  });

  it("★ concat·push로 합치지 않는다(합치면 r.finding.severity에서 즉시 TypeError)", () => {
    const 코드 = approvals.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
    expect(코드).not.toMatch(/allReviews\s*=\s*allReviews\.concat/);
    expect(코드).not.toMatch(/allReviews\.push\(\s*\.\.\.\s*allFix/);
    expect(코드).not.toMatch(/allFix\.concat\(\s*allReviews/);
    expect(코드).not.toMatch(/allReviews\.concat\(\s*allFix/);
  });

  it("★ 취약점 쪽 잣대는 allFix를 **한 줄도** 안 본다(matchFilter·심각도·VEX·?status=)", () => {
    for (const 머리 of ["function matchFilter(r) {", "function 그림띠() {", "function 필터띠() {"]) {
      expect(함수몸(approvals, 머리), `${머리} 가 두 번째 원장을 본다`).not.toContain("allFix");
    }
    // 반대 방향도 본다 — 지적 목록이 취약점 배열을 읽으면 숫자가 서로를 오염시킨다.
    expect(함수몸(approvals, "function renderFixList()"), "지적 목록이 취약점 배열을 읽는다").not.toContain("allReviews");
  });

  it("세그먼트는 0건이어도 그린다 — 「사라지는 조작」은 못 찾는다", () => {
    expect(approvals, "세그먼트 2칸이 없다").toContain('id="rvSeg"');
    expect(approvals, "답 지적 세그먼트가 없다").toContain("💬 답 지적");
    const 코드 = approvals.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
    expect(코드, "세그먼트를 조건부로 숨긴다 — 0건이면 아예 안 보인다").not.toMatch(/rvSeg[^\n]*style\.display\s*=\s*["']none/);
  });

  it("갈래 라벨은 서버 fixboard.고칠것갈래라벨과 **글자가 같다**", () => {
    const 서버 = fs.readFileSync(path.join(__dirname, "../src/engine/fixboard.ts"), "utf8");
    for (const [k, ko] of [["doc", "자료 부족"], ["rule", "사내 규정"], ["prod", "제품"], ["unclassified", "미분류"]] as const) {
      expect(서버, `서버 라벨(${k})을 못 읽었다`).toContain(`${k}: "${ko}"`);
      expect(approvals, `결재판 라벨(${k})이 서버와 다르다`).toContain(`"${ko}"`);
    }
  });

  it("?fix= 딥링크가 ?status=와 **같은 꼴**이다(화면에 실제로 있는 값만 받는다)", () => {
    expect(approvals, "?fix= 처리가 없다").toContain('get("fix")');
  });
});

/* ═══ ⑥ 무르기 60초 — 가짜 DOM에서 **실제로 돌려** 잰다 ═════════════════════════════
 *
 * ⚠ jsdom·happy-dom이 이 저장소에 없다(dimestimates-scope.test와 같은 판단). 제품이 실제로
 *   부르는 것만 흉내 낸다: createElement·appendChild·addEventListener·hidden·querySelector.
 * ⚠ 가짜 DOM은 그 자체가 함정이라, 첫 시험이 **정말 그려졌는지**부터 확인한다.
 */
class 가짜요소 {
  nodeType = 1;
  tagName: string;
  className = "";
  textContent = "";
  title = "";
  type = "";
  value = "";
  placeholder = "";
  disabled = false;
  hidden = false;
  childNodes: 가짜요소[] = [];
  parentNode: 가짜요소 | null = null;
  _on: Record<string, ((e?: unknown) => void)[]> = {};
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get classList() {
    const self = this;
    return {
      contains: (c: string) => String(self.className).split(/\s+/).includes(c),
      add: (c: string) => { if (!String(self.className).split(/\s+/).includes(c)) self.className = (self.className + " " + c).trim(); },
      remove: (c: string) => { self.className = String(self.className).split(/\s+/).filter((x) => x !== c).join(" "); },
    };
  }
  appendChild(n: 가짜요소) { n.parentNode = this; this.childNodes.push(n); return n; }
  removeChild(n: 가짜요소) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  addEventListener(t: string, f: (e?: unknown) => void) { (this._on[t] = this._on[t] || []).push(f); }
  focus() { /* 흉내 */ }
  setAttribute() { /* 흉내 */ }
  /** 붙일자리()가 `.cb`를 찾는다 — 클래스 선택자만 흉내 낸다(그 이상은 안 흉내 낸다). */
  querySelector(sel: string): 가짜요소 | null { return sel.startsWith(".") ? this.찾기(sel.slice(1)) : null; }
  누르기() { (this._on["click"] || []).forEach((f) => f()); }
  찾기(cls: string): 가짜요소 | null {
    for (const c of this.childNodes) {
      if (c.classList.contains(cls)) return c;
      const r = c.찾기(cls); if (r) return r;
    }
    return null;
  }
  글자(): string { return [this.textContent, ...this.childNodes.map((c) => c.글자())].join(" "); }
}

const 문서 = {
  createElement: (t: string) => new 가짜요소(t),
  getElementById: () => ({ id: "gijoChatPartsCss" }),
};

/** 제품 부품을 그대로 불러온다 — 시험이 사본을 만들지 않는다. */
function 부품(): { flag: (el: unknown, ctx: unknown, ops: unknown) => unknown } {
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "document", chatparts)(win, 문서);
  return win.gijoChatParts as { flag: (el: unknown, ctx: unknown, ops: unknown) => unknown };
}

describe("⑥ 대화창 꼬리 — 접수·무르기 60초", () => {
  const 자리 = () => { const row = new 가짜요소("div"); row.className = "cs-row"; const cb = new 가짜요소("div"); cb.className = "cb"; row.appendChild(cb); return row; };

  it("헛돎 방지 — 부품이 실제로 돌아 꼬리를 그렸다", () => {
    const el = 자리();
    부품().flag(el, { question: "백업 보관 기간은?", answer: "3년입니다" }, { send: async () => ({ id: 1 }) });
    const btn = el.찾기("wf-flag");
    expect(btn, "꼬리 단추를 안 그렸다 — 이 시험이 헛돈다").not.toBeNull();
    expect(btn!.textContent).toBe("▶ 이 답 이상해요");
    expect(el.찾기("wf-line")!.hidden, "접힘 상태인데 펼침 줄이 열려 있다").toBe(true);
  });

  it("무엇에 대한 지적인지 모르면(question 없음) 아무것도 안 그린다", () => {
    const el = 자리();
    부품().flag(el, { question: "", answer: "…" }, { send: async () => ({ id: 1 }) });
    expect(el.찾기("wf-flag"), "질문 없이 꼬리를 그렸다 — 문항이 될 수 없는 지적이 쌓인다").toBeNull();
  });

  it("보낸 값에 kind·noev·quotes가 그대로 실린다(서버가 갈래를 정하는 재료)", async () => {
    const el = 자리();
    const 보냄: Record<string, unknown>[] = [];
    부품().flag(el, {
      question: "백업 보관 기간은?", answer: "3년입니다", noev: "자료없음",
      quotes: [{ documentId: "d1", text: "보관 기간은 …" }], screen: "approvals.html",
    }, { send: async (b: Record<string, unknown>) => { 보냄.push(b); return { id: 7 }; } });
    el.찾기("wf-flag")!.누르기();
    el.찾기("wf-memo")!.value = "숫자가 화면과 다릅니다";
    el.찾기("wf-go")!.누르기();
    await new Promise((r) => setTimeout(r, 0));
    expect(보냄.length, "보내기를 안 불렀다").toBe(1);
    expect(보냄[0]).toMatchObject({
      kind: "wrong", question: "백업 보관 기간은?", answer: "3년입니다",
      note: "숫자가 화면과 다릅니다", noev: "자료없음", screen: "approvals.html",
    });
    expect(보냄[0].quotes, "인용 조각이 안 실렸다 — 초안 재료가 통째로 없어진다").toHaveLength(1);
  });

  it("★ 올린 뒤 「결재판에 올림 · 결재판 열기 · 취소」가 뜬다(출구가 보인다)", async () => {
    const el = 자리();
    부품().flag(el, { question: "q", answer: "a" }, { send: async () => ({ id: 7 }), remove: async () => ({ ok: true }), openBoard: () => { /* 열기 */ } });
    el.찾기("wf-flag")!.누르기();
    el.찾기("wf-go")!.누르기();
    await new Promise((r) => setTimeout(r, 0));
    const done = el.찾기("wf-done")!;
    expect(done.hidden, "올림 줄이 안 떴다").toBe(false);
    expect(done.글자()).toContain("결재판에 올림");
    expect(done.글자(), "출구(결재판 열기)가 없다").toContain("결재판 열기");
    expect(done.글자(), "무르기가 없다").toContain("취소");
    expect(done.글자(), "약속 문구가 없다").toContain("회귀 검사 문항 후보");
    expect(done.글자(), "「똑똑해집니다」류 과한 약속을 적지 않는다").not.toContain("똑똑해집니다");
  });

  it("★ 취소는 60초까지만 — 지나면 조작이 아니라 **이유가 적힌 글자**로 바뀐다", async () => {
    vi.useFakeTimers();
    try {
      const el = 자리();
      let 지운것: number | null = null;
      부품().flag(el, { question: "q", answer: "a" },
        { send: async () => ({ id: 9 }), remove: async (id: number) => { 지운것 = id; return { ok: true }; } });
      el.찾기("wf-flag")!.누르기();
      el.찾기("wf-go")!.누르기();
      await vi.advanceTimersByTimeAsync(0);
      expect(el.찾기("wf-undo"), "무르기 단추가 없다").not.toBeNull();
      await vi.advanceTimersByTimeAsync(59000);
      expect(el.찾기("wf-undo"), "59초에 벌써 사라졌다 — 서버는 아직 받아 준다").not.toBeNull();
      await vi.advanceTimersByTimeAsync(2000);
      expect(el.찾기("wf-undo"), "61초인데 아직 누를 수 있다 — 누르면 403이 온다").toBeNull();
      expect(el.찾기("wf-done")!.글자(), "왜 못 무르는지 화면이 말하지 않는다(조용히 사라졌다)").toContain("1분");
      expect(지운것, "누르지도 않았는데 지웠다").toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("취소를 누르면 그 id를 무르고 다시 지적할 수 있다", async () => {
    const el = 자리();
    let 지운것: number | null = null;
    부품().flag(el, { question: "q", answer: "a" },
      { send: async () => ({ id: 12 }), remove: async (id: number) => { 지운것 = id; return { ok: true }; } });
    el.찾기("wf-flag")!.누르기();
    el.찾기("wf-go")!.누르기();
    await new Promise((r) => setTimeout(r, 0));
    el.찾기("wf-undo")!.누르기();
    await new Promise((r) => setTimeout(r, 0));
    expect(지운것, "무르기가 서버로 안 갔다").toBe(12);
    expect(el.찾기("wf-flag")!.hidden, "무른 뒤에는 다시 지적할 수 있어야 한다").toBe(false);
  });

  it("보내기가 실패하면 「접수됨」이라 말하지 않는다(가짜 성공 금지)", async () => {
    const el = 자리();
    부품().flag(el, { question: "q", answer: "a" }, { send: async () => { throw new Error("서버 오류 500"); } });
    el.찾기("wf-flag")!.누르기();
    el.찾기("wf-go")!.누르기();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.찾기("wf-done")!.hidden, "실패했는데 올림 줄을 띄웠다").toBe(true);
    expect(el.찾기("wf-line")!.글자()).toContain("보내지 못했습니다");
  });
});
