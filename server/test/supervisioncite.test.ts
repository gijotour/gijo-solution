// 감독 화면 ✂ 줄이 **실제로 그려지고 실제로 눌리는가** — 2026-09-06 검토관 [중간] 3건의 짝 시험
// (계획서 **전-4 정직한 구현** · 승인 시안 mockups/cite-reasons).
//
// ■ 왜 이 파일이 따로 필요한가 (검토관 promise 갈래 실측)
//   citereasons.test.ts는 순수 함수와 소스 문자열만 본다. 그래서 supervision.html의
//   **렌더 대목에서 사유줄을 빼도**(계산만 하고 안 그림) 344개가 전부 초록이었고,
//   **클릭 등록을 `if (false)`로 막아도** 323개가 전부 초록이었다 — 그동안 screenguide는
//   「「사유 N건 ▸」을 누르면 왜 뗐는지가 건수로 펼쳐집니다」라고 **약속**하고 있었다.
//   하루 전 metaleak.test가 닫은 「대입 한 줄만 지웠는데 5,564개 초록」 구멍을 옆 파일에서
//   그대로 다시 연 것이라, 여기서 **화면이 만든 HTML**과 **클릭의 결과**를 값으로 잰다.
//
// ■ 어떻게 — vizpromise.test.ts와 같은 방식이다(jsdom·happy-dom은 이 저장소에 없다).
//   인라인 <script>를 통째로 떼어 **최소한의 가짜 DOM 위에서 실제로 돌리고**, #sup에 박힌
//   HTML 문자열을 판정한다. ⚠ 가짜 DOM은 그 자체가 함정이라(같은 파일의 경고), 아래 첫
//   시험이 **떼어 와서 돌았는지**부터 확인한다 — 안 돌면 나머지가 거짓 통과한다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 페이지 = path.join(__dirname, "../../client/src/renderer/pages/supervision.html");
const supSrc = fs.readFileSync(페이지, "utf8");

type 요소 = {
  innerHTML: string; style: Record<string, string>; textContent: string;
  _attr: Record<string, string>; _on: Record<string, ((e?: unknown) => void)[]>;
  getAttribute(k: string): string | null; setAttribute(k: string, v: string): void;
  addEventListener(t: string, f: (e?: unknown) => void): void;
  classList: { add(): void; remove(): void; contains(): boolean };
  querySelector(sel: string): 요소 | null; querySelectorAll(): 요소[]; closest(): null;
  parentNode?: { querySelector(sel: string): 요소 | null };
};

function 새요소(): 요소 {
  const el: 요소 = {
    innerHTML: "", style: {}, textContent: "", _attr: {}, _on: {},
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attr, k) ? el._attr[k] : null; },
    setAttribute(k, v) { el._attr[k] = v; },
    addEventListener(t, f) { (el._on[t] = el._on[t] || []).push(f); },
    classList: { add() { }, remove() { }, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
  return el;
}

/** esc()가 쓰는 자리 — textContent를 넣으면 innerHTML이 이스케이프된 글자가 된다. */
function 글자요소(): { innerHTML: string; textContent: string } {
  const o = { innerHTML: "" } as { innerHTML: string; textContent: string };
  Object.defineProperty(o, "textContent", {
    set(v: string) { o.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    get() { return o.innerHTML; },
  });
  return o;
}

type 그린것 = {
  sup: string;                       // #sup에 박힌 HTML — **판정 대상**
  버튼: 요소 | null;                 // 사유 토글(있으면)
  상자: 요소 | null;                 // 펼침 상자(있으면)
  저장: Record<string, string>;      // localStorage 흉내
};

/** 화면을 **실제로 돌려** #sup HTML과 토글 부품을 돌려준다. */
async function 그리기(sup: unknown, days = 1): Promise<그린것> {
  const 본문 = supSrc.match(/<script>\r?\n([\s\S]*?)<\/script>/);
  expect(본문, "supervision.html에서 인라인 <script>를 못 떼어 왔다 — 이 시험이 헛돈다").not.toBeNull();

  const 칸 = new Map<string, 요소>();
  for (const id of ["kpis", "grid", "sup", "range", "goRedteam", "safety"]) 칸.set(id, 새요소());

  let 버튼: 요소 | null = null;
  let 상자: 요소 | null = null;
  const doc = {
    createElement: () => 글자요소(),
    getElementById: (id: string) => 칸.get(id) ?? null,
    querySelectorAll: () => [] as 요소[],
    // 화면은 #sup에 박은 HTML에서 버튼을 다시 **찾아** 클릭을 건다. 진짜 DOM은 그 HTML을
    // 파싱해 주므로, 여기서는 「HTML에 있으면 찾힌다」만 흉내 낸다(그 이상은 안 흉내 낸다).
    querySelector: (sel: string): 요소 | null => {
      if (sel !== "#sup .cite-why") return null;
      const html = 칸.get("sup")!.innerHTML;
      const b = html.match(/<button class="cite-why" aria-expanded="(true|false)">([^<]*)<\/button>/);
      if (!b) return null;
      const 새버튼 = 새요소();
      새버튼._attr["aria-expanded"] = b[1];
      새버튼.textContent = b[2];
      const 숨김 = /<div class="cite-reasons" style="display:none">/.test(html);
      const 새상자 = /<div class="cite-reasons"/.test(html) ? 새요소() : null;
      if (새상자) 새상자.style.display = 숨김 ? "none" : "";
      새버튼.parentNode = { querySelector: (s: string) => (s === ".cite-reasons" ? 새상자 : null) };
      버튼 = 새버튼; 상자 = 새상자;
      return 새버튼;
    },
  };
  const 저장: Record<string, string> = {};
  const ls = { getItem: (k: string) => (k in 저장 ? 저장[k] : null), setItem: (k: string, v: string) => { 저장[k] = v; } };
  const win: Record<string, unknown> = {
    gijo: {
      listAgents: async () => [{ id: "orchestrator", name: "총괄", abbr: "총", role: "" }],
      aiteamSupervision: async () => sup,
    },
  };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "localStorage", 본문![1])(win, doc, ls);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  // days 전환은 #range 클릭으로만 되므로, 1이 아니면 그 버튼을 실제로 누른다.
  if (days !== 1) {
    const 눌림 = 칸.get("range")!._on["click"] || [];
    const 가짜버튼 = 새요소(); 가짜버튼._attr["data-d"] = String(days);
    눌림.forEach((f) => f({ target: { closest: () => 가짜버튼 } }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  return { sup: 칸.get("sup")!.innerHTML, 버튼, 상자, 저장 };
}

const cite = (day: string, calls: number, agent = "orchestrator") =>
  ({ day, agent, kind: "cite", calls, errors: 0, latencyMsSum: 0 });
const 사유행 = (day: string, reason: string, count: number, agent = "orchestrator") => ({ day, agent, reason, count });

describe("✂ 감독 줄 — 그려지고 눌린다 (전-4 · 검토관 2026-09-06)", () => {
  it("헛돎 방지 — 화면이 실제로 돌아 ✂ 줄을 그렸다", async () => {
    const r = await 그리기({ days: 1, calls: {}, daily: [cite("2026-09-06", 2)], recentErrors: {}, citeReasons: [사유행("2026-09-06", "겹침없음", 3)] });
    expect(r.sup, "#sup이 비었다 — 화면이 안 돌았다(가짜 DOM이 틀렸거나 스크립트를 못 떼었다)").not.toBe("");
    expect(r.sup, "✂ 줄 자체가 없다").toContain("✂ 인용 제거");
  });

  // ── ⓐ 계산 결과가 **실제로 화면에 들어간다**(렌더 배선) ──────────────────────────
  it("ⓐ 사유가 있으면 토글과 사유 목록이 #sup HTML에 **박힌다**", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 2)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 3), 사유행("2026-09-06", "범위밖", 1)],
    });
    expect(r.sup, "사유줄을 계산만 하고 안 그렸다").toContain('class="cite-why"');
    expect(r.sup, "펼침 상자가 없다").toContain('class="cite-reasons"');
    expect(r.sup, "배지 숫자가 틀리다").toContain("사유 4건");
    expect(r.sup).toContain("겹침없음 3");
    expect(r.sup).toContain("범위밖 1");
  });

  it("ⓐ 버튼을 **누르면 펴진다** — 등록이 빠지면 여기서 잡힌다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 2)],
    });
    expect(r.버튼, "#sup에서 토글 버튼을 못 찾았다").not.toBeNull();
    const 눌림 = r.버튼!._on["click"] || [];
    expect(눌림.length, "클릭을 안 걸었다 — 버튼은 보이는데 눌러도 안 펴진다").toBeGreaterThan(0);
    expect(r.버튼!.getAttribute("aria-expanded"), "처음엔 접혀 있어야 한다").toBe("false");
    expect(r.상자!.style.display).toBe("none");
    눌림.forEach((f) => f());
    expect(r.버튼!.getAttribute("aria-expanded"), "눌러도 안 펴졌다").toBe("true");
    expect(r.상자!.style.display, "상자가 그대로 숨어 있다").toBe("");
    expect(r.버튼!.textContent, "화살표가 안 바뀌었다").toContain("▾");
    expect(r.저장["gijo:cite-reasons-open"], "펼침을 기억 안 했다").toBe("1");
  });

  // ── ⓑ 문장이 **거짓말을 안 한다**(검토관 count 갈래) ────────────────────────────
  it("ⓑ 「못 뗌」만 있는 기간에 「뗐습니다」라고 하지 않는다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "못 뗌", 1)],
    });
    expect(r.sup, "아무것도 안 뗀 답을 뗐다고 말한다").not.toContain("근거 없는 인용을 뗐습니다");
    expect(r.sup, "원문을 그대로 뒀다는 사실이 안 보인다").toContain("원문을 그대로 뒀습니다");
    expect(r.sup, "「사유 0건」과 「못 뗌 1」이 한 줄에서 서로를 부정한다").not.toContain("사유 0건");
    expect(r.sup).toContain("못 뗌 1건");
  });

  it("ⓑ 경로 가드만 운 답을 「근거 없는 인용」이라 말하지 않는다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "내부 경로", 1)],
    });
    expect(r.sup, "인용을 한 건도 안 뗐는데 뗐다고 말한다").not.toContain("근거 없는 인용을 뗐습니다");
    expect(r.sup).toContain("내부 메타 줄을 뗐습니다");
    expect(r.sup, "사유는 그대로 보여야 한다").toContain("내부 경로 1");
  });

  it("ⓑ 인용을 실제로 뗀 기간은 종전 문장 그대로다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 2)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 2), 사유행("2026-09-06", "내부 경로", 1)],
    });
    expect(r.sup).toContain("답 2개에서 근거 없는 인용을 뗐습니다");
  });

  // ── ⓒ 사유가 **일부 기간만** 있는 창에서 침묵하지 않는다 ────────────────────────
  it("ⓒ 섞인 기간 — 사유가 빈 날이 있으면 그 사실을 말한다", async () => {
    const r = await 그리기({
      days: 7, calls: {},
      daily: [cite("2026-09-04", 3), cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 1)],
    }, 7);
    // 접힌 상태(기본값)에서 **보이는 자리**로 잰다 — 펼침 상자 안에만 있으면 사람은 못 본다.
    const 보이는곳 = r.sup.split('<div class="cite-reasons"')[0];
    expect(보이는곳, "「답 4개 · 사유 1건」을 아무 설명 없이 세운다(시안 ⑩)").toContain("사유 기록 전");
    expect(보이는곳).toContain("1일");
    expect(r.sup, "펼치면 더 자세히 말한다").toContain("사유를 안 남기던 때");
  });

  it("ⓒ 사유가 통째로 없는 옛 기간은 종전 안내 그대로다", async () => {
    const r = await 그리기({ days: 1, calls: {}, daily: [cite("2026-09-05", 2)], recentErrors: {}, citeReasons: [] });
    expect(r.sup).toContain("사유 기록은 2026-09-06부터 쌓입니다");
    expect(r.sup, "없는 토글을 그리면 눌러도 빈 상자가 나온다").not.toContain('class="cite-why"');
  });

  it("ⓒ 0건이면 지금과 완전히 같다 — 줄은 서되 토글은 없다", async () => {
    const r = await 그리기({ days: 1, calls: {}, daily: [], recentErrors: {}, citeReasons: [] });
    expect(r.sup).toContain("0개 — 이 기간에 뗀 인용이 없습니다");
    expect(r.sup).not.toContain('class="cite-why"');
  });

  // ── ⓓ 낡은 주석이 화면 옆에서 딴말을 하지 않는다 ────────────────────────────────
  it("ⓓ 「건수는 팀 활동 기록에만 있다」는 옛 주석이 남아 있지 않다", () => {
    expect(supSrc, "이 화면이 바로 그 건수를 그리는데 주석은 아직 딴 데 있다고 말한다")
      .not.toContain("detail)에만 있다");
  });
});
