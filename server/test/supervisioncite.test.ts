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
async function 그리기(sup: unknown, days = 1, 씨앗: Record<string, string> = {}): Promise<그린것> {
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
  // 씨앗 = 그 PC에 **이미 저장돼 있던** 펼침 기억. 위험 신호(못 뗌·통째교체)가 그 기억을
  //   이기는지 재려면 필요하다 — 기본은 빈 값이라 기존 시험은 그대로다.
  const 저장: Record<string, string> = { ...씨앗 };
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

/* ═══ 위험 신호는 접어서 가리지 않는다 — 「통째교체」도 저절로 펼친다 ═══════════════════
 * 2026-09-06 사장님 승인(N5). 「못 뗌」과 **같은 규칙**이다: 통째교체는 답이 통째로
 * 「자료 없음」 안내로 바뀐 **센 사건**이라, 접어 두면 사람이 그 일이 있었다는 것을 못 본다
 * (fold.js 계약 — 위험 신호는 접어서 가리지 않는다).
 * ⚠ 배지 N에 **안 넣는** 규약은 그대로다 — 「펼치는 조건」과 「세는 것」은 별개의 규약이라
 *   한쪽을 고치며 다른 쪽을 같이 옮기면 조용히 숫자가 거짓이 된다. 그래서 ⓔ②가 둘을 함께 잰다.
 * ⚠ 반증(실측): supervision.html 펼침 조건에서 `사유.통째 > 0`을 빼면 ⓔ②·ⓔ③·ⓔ④가 빨개진다.
 */
describe("✂ 감독 줄 — 「통째교체」도 저절로 펼친다 (전-4 · 2026-09-06 사장님 승인)", () => {
  it("ⓔ① 대조군 — 보통 사유만 있으면 접힌 채로 시작한다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 2)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 2)],
    });
    expect(r.버튼, "토글을 못 찾았다 — 이 시험이 헛돈다").not.toBeNull();
    expect(r.버튼!.getAttribute("aria-expanded"), "위험 신호가 없는데 저절로 펴졌다").toBe("false");
    expect(r.상자!.style.display).toBe("none");
    expect(r.sup, "접힘 화살표가 아니다").toContain("▸");
  });

  it("ⓔ② 「통째교체」가 섞이면 저절로 펴진다 — 세는 규약은 그대로다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 1), 사유행("2026-09-06", "통째교체", 1)],
    });
    expect(r.sup, "접힌 채로 그렸다 — 답이 통째로 바뀐 사실이 토글 뒤에 숨는다")
      .not.toContain('<div class="cite-reasons" style="display:none">');
    expect(r.버튼!.getAttribute("aria-expanded"), "통째교체가 있는데 접혀 있다").toBe("true");
    expect(r.상자!.style.display, "상자가 숨어 있다").toBe("");
    expect(r.sup, "화살표가 접힘 모양 그대로다").toContain("▾");
    // 펼침 조건을 고치며 **세는 규약까지** 옮기지 않았는가 — 통째교체는 배지 N에 여전히 안 든다.
    expect(r.sup, "통째교체가 배지 건수로 새어 들어갔다").toContain("사유 1건");
    expect(r.sup).toContain("통째교체 1");
  });

  it("ⓔ③ 「통째교체」만 있어도 마찬가지다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "통째교체", 1)],
    });
    expect(r.버튼, "토글을 못 찾았다").not.toBeNull();
    expect(r.버튼!.getAttribute("aria-expanded"), "통째교체만 있으면 접어 버린다").toBe("true");
    expect(r.상자!.style.display).toBe("");
  });

  it("ⓔ④ 저장된 「접힘」이 위험 신호를 못 이긴다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 1), 사유행("2026-09-06", "통째교체", 1)],
    }, 1, { "gijo:cite-reasons-open": "0" });
    expect(r.버튼!.getAttribute("aria-expanded"), "지난번에 접어 뒀다고 이번 위험 신호를 가린다").toBe("true");
  });

  it("ⓔ⑤ 「못 뗌」 자동 펼침은 그대로다 — 새 조건이 옛 계약을 안 지웠다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "못 뗌", 1)],
    }, 1, { "gijo:cite-reasons-open": "0" });
    expect(r.버튼!.getAttribute("aria-expanded"), "못 뗌 자동 펼침이 사라졌다").toBe("true");
    expect(r.상자!.style.display).toBe("");
  });
});

/* ═══ 한 줄이 **스스로를 부정하지 않는다** — 2026-09-06 검토관 contract ════════════════
 * 적발: 「못 뗌」과 「통째교체」가 한 기간에 같이 있으면 앞 문장은 「답 2개는 근거가 없어 통째로
 *   안내로 바꿨습니다」인데 펼친 꼬리는 「— 답이 통째로 내부 메타라 원문을 그대로 뒀습니다」라,
 *   **바꿨다와 안 바꿨다가 같은 줄에** 떴다. 도달 가능: 못 뗌은 metaleak 보류, 통째교체는
 *   citeguard ⑥ — 서로 다른 가드라 7·30일 창에서 함께 뜬다.
 * 뿌리는 둘이다 — ① 앞 문장이 **한쪽 갈래만 골라 단정**한다 ② 꼬리가 **주어 없이** 적혀 기간
 *   전체를 말하는 문장으로 읽힌다. 그래서 앞 문장에 조합 갈래를 두고, 꼬리는 **라벨을 이름으로
 *   불러** 설명한다(「「못 뗌」은 …인 경우입니다」).
 * ⚠ N5가 만든 결함은 아니다(못 뗌만으로도 이미 자동 펼침이었다). 다만 N5가 「위험 신호는
 *   펼쳐 보인다」를 계약으로 못 박았으므로 이 조합은 앞으로 **항상 눈앞에 선다** — 그래서 고친다.
 */
describe("✂ 감독 줄 — 한 줄이 스스로를 부정하지 않는다 (전-4 · 검토관 2026-09-06)", () => {
  it("ⓕ① 「못 뗌」+「통째교체」 — 바꿨다와 안 바꿨다가 한 줄에 같이 서지 않는다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 2)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "못 뗌", 1), 사유행("2026-09-06", "통째교체", 1)],
    });
    expect(r.sup, "앞 문장이 답 2개 **전부**를 「바꿨다」고 단정한다(하나는 그대로 뒀다)")
      .not.toContain("개는 근거가 없어 통째로 안내로 바꿨습니다");
    expect(r.sup, "두 갈래가 함께 있다는 사실을 앞 문장이 말하지 않는다")
      .toContain("통째로 안내로 바꾸거나 원문을 그대로 뒀습니다");
    expect(r.sup, "꼬리가 주어 없이 적혀 기간 전체를 부정한다")
      .not.toContain("— 답이 통째로 내부 메타라 원문을 그대로 뒀습니다");
    expect(r.sup, "꼬리가 어느 라벨의 설명인지 밝히지 않는다")
      .toContain("「못 뗌」은 답이 통째로 내부 메타라 원문을 그대로 둔 경우입니다");
    // 두 사유는 그대로 보여야 한다 — 문장을 고치면서 값을 숨기면 그게 더 나쁜 거짓말이다.
    expect(r.sup).toContain("통째교체 1");
    expect(r.sup).toContain("못 뗌 1");
    expect(r.버튼!.getAttribute("aria-expanded"), "위험 신호 둘인데 접혀 있다").toBe("true");
  });

  it("ⓕ② 인용을 실제로 뗀 기간 + 「못 뗌」 — 꼬리가 앞 문장을 뒤집지 않는다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 2)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "겹침없음", 2), 사유행("2026-09-06", "못 뗌", 1)],
    });
    expect(r.sup, "실제로 뗀 기간의 앞 문장은 그대로여야 한다").toContain("답 2개에서 근거 없는 인용을 뗐습니다");
    expect(r.sup, "「뗐습니다」 옆에 「그대로 뒀습니다」가 주어 없이 선다")
      .not.toContain("— 답이 통째로 내부 메타라 원문을 그대로 뒀습니다");
    expect(r.sup).toContain("「못 뗌」은 답이 통째로 내부 메타라 원문을 그대로 둔 경우입니다");
    expect(r.sup, "세는 규약은 그대로 — 못 뗌은 배지 N에 안 든다").toContain("사유 2건");
  });

  it("ⓕ③ 「통째교체」만 — 「사유 0건」과 「통째교체 1」이 서로를 부정하지 않는다", async () => {
    const r = await 그리기({
      days: 1, calls: {}, daily: [cite("2026-09-06", 1)], recentErrors: {},
      citeReasons: [사유행("2026-09-06", "통째교체", 1)],
    });
    expect(r.sup, "배지는 0건인데 바로 아래 목록엔 통째교체 1이 떠 한 줄이 서로를 부정한다")
      .not.toContain("사유 0건");
    expect(r.sup, "배지가 무엇이 있었는지 말하지 않는다").toContain("통째교체 1건");
    expect(r.sup, "목록의 값은 그대로여야 한다").toContain(">통째교체 1</b>");
    expect(r.버튼!.getAttribute("aria-expanded"), "통째교체만 있으면 접어 버린다").toBe("true");
  });

  it("ⓕ④ 안내(screenguide)와 화면이 **같은 것**을 약속한다 — 한쪽만 지우면 여기서 빨개진다", () => {
    const sg = fs.readFileSync(path.join(__dirname, "../src/engine/screenguide.ts"), "utf8");
    const 시작 = sg.indexOf('"인용 제거(✂)":');
    expect(시작, "screenguide에서 「인용 제거(✂)」 안내를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    // 이 안내는 **한 줄짜리 긴 문자열**이라 줄 끝까지 떼면 그 항목 전부다(정규식 역슬래시를 피한다).
    const 안내 = sg.slice(시작, sg.indexOf(String.fromCharCode(10), 시작));
    const 펼침줄 = supSrc.match(/var 펼침 = ([^;]*);/);
    expect(펼침줄, "supervision.html에서 펼침 조건을 못 찾았다 — 이 시험이 헛돈다").not.toBeNull();
    // 안내가 「저절로 펼쳐집니다」라고 적었으면 화면에 그 조건이 **실제로** 있어야 한다.
    //   ⚠ 안내는 서버 배포로, 동작은 클라 게시로 나간다 — 짝을 맞춰 내보내는 것은 사람 몫이지만,
    //     **소스에서 어긋나는 것**은 여기서 막는다(약속-코드 불일치는 QA가 원리상 못 잡는다).
    if (/저절로 펼쳐집니다/.test(안내)) {
      expect(펼침줄![1], "안내는 통째교체가 저절로 펴진다는데 화면엔 그 조건이 없다").toContain("사유.통째 > 0");
    }
    if (/그래서 이 줄은 저절로 펼쳐집니다/.test(안내)) {
      expect(펼침줄![1], "안내는 못 뗌이 저절로 펴진다는데 화면엔 그 조건이 없다").toContain("사유.못뗌 > 0");
    }
  });
});
