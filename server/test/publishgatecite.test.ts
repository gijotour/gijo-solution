// 게시 관문 ⑧′(감독 ✂ 사유 토글)의 **판정식 자체**를 잰다 — 2026-09-06 검토관 gate 3건의 짝 시험
// (계획서 **전-4 정직한 구현**).
//
// ■ 왜 이 파일이 필요한가
//   ⑧′는 실화면(설치본 + CDP)에서만 도는 코드라, 지금까지 「맞게 짰다」는 **주장**이었다. 실제로
//   두 구멍이 있었다:
//     ① 관문이 재는 동안 스스로 localStorage("gijo:cite-reasons-open")를 "1"로 남기는데, 그 값을
//        그대로 두고 재면 **화면의 자동 펼침 조건을 통째로 지워도 초록**이었다 — 헛초록을 막으려고
//        붙인 조항이 제 실행으로 무력화된다.
//     ② 위험 사유(못 뗌·통째교체)가 있는 화면을 한 번 재고 나면 사람이 접어 둔 기억이 "1"로 굳어,
//        위험 사유가 사라진 뒤에도 그 줄이 계속 펴진 채 열렸다(fold.js:223 「담당자가 접어 둔 기억은
//        건드리지 않는다」와 정면으로 어긋난다).
//   운영 데이터에 못 뗌·통째교체가 0건이라 **실화면에서는 이 조항이 아직 한 번도 판정을 안 한다.**
//   그래서 판정식을 여기서 돌린다 — 관문 파일의 코드를 **글자 그대로 떼어** 가짜 DOM 위에서.
//
// ■ 이 시험이 재는 것 / 안 재는 것 (정직 표시)
//   재는 것: ⑧′의 클릭 순서·저장 원상복구·성립식의 논리(위험신호·원래펼침·저장전/후).
//   안 재는 것: **픽셀**. 높이는 흉내다(한 줄 19px 가정) — 실제 레이아웃은 관문이 실화면에서 잰다.
//   그래서 이 시험이 초록이어도 「실화면에서 통과했다」고 말하면 안 된다. 둘은 다른 것을 잰다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 페이지 = path.join(__dirname, "../../client/src/renderer/pages/supervision.html");
const 관문 = path.join(__dirname, "../../tools/publish-gate-ui.mjs");
const supSrc = fs.readFileSync(페이지, "utf8");
const 관문src = fs.readFileSync(관문, "utf8");

/* ── ⑧′ 코드를 관문 파일에서 **떼어 온다** ─────────────────────────────────────────
   ⚠ 베껴 오지 않는다. 베끼면 관문을 고쳐도 여기는 옛 코드를 계속 초록으로 재서, 「시험이 있다」가
     오히려 거짓 안심이 된다(이 저장소의 「같은 것을 여러 곳에 적으면 어긋난다」). */
const 섹션시작 = 관문src.indexOf("// ── ⑧′");
const 섹션끝 = 관문src.indexOf("// ── ⑨", 섹션시작 + 1);
const 섹션 = 섹션시작 >= 0 && 섹션끝 > 섹션시작 ? 관문src.slice(섹션시작, 섹션끝) : "";
const 시작표 = "await fr.evaluate(async () => {";
const a = 섹션.indexOf(시작표);
const b = 섹션.indexOf("\n  }).catch(() => null) : null;", a);
const 관문본문 = a >= 0 && b > a ? 섹션.slice(a + 시작표.length, b) : "";
const c = 섹션.indexOf("const 성립 = ", b);
const d = 섹션.indexOf("\n  ok(", c);
const 성립식 = c >= 0 && d > c ? 섹션.slice(c, d) : "";

/* ── 가짜 DOM ────────────────────────────────────────────────────────────────────
   supervisioncite.test.ts와 같은 방식이되, 관문이 쓰는 것까지 흉내 낸다:
   click() · querySelectorAll("#sup .sup-line") · getBoundingClientRect() · #range 단추.
   ⚠ 높이는 **흉내**다 — 위 머리말의 정직 표시 그대로. */
function 새요소(): any {
  const el: any = {
    innerHTML: "", style: {} as Record<string, string>, textContent: "",
    _attr: {} as Record<string, string>, _on: {} as Record<string, ((e?: unknown) => void)[]>,
    getAttribute(k: string) { return Object.prototype.hasOwnProperty.call(el._attr, k) ? el._attr[k] : null; },
    setAttribute(k: string, v: string) { el._attr[k] = v; },
    addEventListener(t: string, f: (e?: unknown) => void) { (el._on[t] = el._on[t] || []).push(f); },
    click() { (el._on["click"] || []).forEach((f: (e?: unknown) => void) => f()); },
    classList: { add() { }, remove() { }, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
  return el;
}
function 글자요소(): { innerHTML: string; textContent: string } {
  const o = { innerHTML: "" } as { innerHTML: string; textContent: string };
  Object.defineProperty(o, "textContent", {
    set(v: string) { o.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    get() { return o.innerHTML; },
  });
  return o;
}
const 글자만 = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

type 무대 = { doc: any; 저장: Record<string, string>; ls: any; sup: () => string };

/** supervision.html의 인라인 스크립트를 **실제로 돌리고**, 관문이 볼 수 있는 DOM을 세운다. */
function 무대세우기(sup: unknown, 씨앗: Record<string, string>, 소스 = supSrc): 무대 {
  const 본문 = 소스.match(/<script>\r?\n([\s\S]*?)<\/script>/);
  expect(본문, "supervision.html에서 인라인 <script>를 못 떼어 왔다 — 이 시험이 헛돈다").not.toBeNull();

  const 칸 = new Map<string, any>();
  for (const id of ["kpis", "grid", "sup", "range", "goRedteam", "safety"]) 칸.set(id, 새요소());

  // ⚠ innerHTML에 **넣을 때마다** 요소를 새로 만든다 — 진짜 브라우저가 그렇게 하기 때문이다.
  //   「같은 글자면 그대로 둔다」로 만들면 다시 그렸을 때 옛 버튼이 살아남아 제품이 클릭 핸들러를
  //   두 번 걸고, 한 번 누른 것이 **두 번 토글**돼 시험이 거짓 빨강을 낸다(실측으로 밟았다).
  const supEl = 칸.get("sup");
  let 판 = 0, _html = "";
  Object.defineProperty(supEl, "innerHTML", {
    get() { return _html; },
    set(v: string) { _html = String(v); 판 += 1; },
  });

  // 화면이 #sup에 박은 HTML에서 토글을 다시 찾는다 — 같은 판이면 **같은 객체**를 준다
  //   (제품이 건 클릭 핸들러가 살아 있어야 관문의 click()이 뜻을 가진다).
  let 현재판 = -1;
  let 버튼: any = null, 상자: any = null;
  const 동기화 = () => {
    const html = 칸.get("sup").innerHTML as string;
    if (판 === 현재판) return;
    현재판 = 판;
    const m = html.match(/<button class="cite-why" aria-expanded="(true|false)">([^<]*)<\/button>/);
    if (!m) { 버튼 = null; 상자 = null; return; }
    버튼 = 새요소(); 버튼._attr["aria-expanded"] = m[1]; 버튼.textContent = m[2];
    const 숨김 = /<div class="cite-reasons" style="display:none">/.test(html);
    상자 = /<div class="cite-reasons"/.test(html) ? 새요소() : null;
    if (상자) {
      상자.style.display = 숨김 ? "none" : "";
      const 안 = html.slice(html.indexOf('<div class="cite-reasons"'));
      상자.textContent = 글자만(안);
    }
    버튼.parentNode = { querySelector: (s: string) => (s === ".cite-reasons" ? 상자 : null) };
  };

  /** #sup HTML을 sup-line 조각으로 가른다(중첩 div는 글자만 볼 것이라 상관없다). */
  const 줄들 = (): any[] => {
    동기화();
    const html = 칸.get("sup").innerHTML as string;
    const 조각 = html.split('<div class="sup-line">').slice(1);
    return 조각.map((덩이) => {
      const 사유줄 = /class="cite-why"/.test(덩이);
      const el = 새요소();
      el.textContent = 글자만(덩이);
      el.querySelector = (sel: string) => {
        if (!사유줄) return null;
        if (sel === ".cite-why") return 버튼;
        if (sel === ".cite-reasons") return 상자;
        return null;
      };
      // 한 줄 19px · 펼치면 한 줄이 더 는다(흉내 — 실제 픽셀은 관문이 실화면에서 잰다).
      el.getBoundingClientRect = () => ({ height: 19 + (사유줄 && 상자 && 상자.style.display !== "none" ? 19 : 0) });
      return el;
    });
  };

  const 기간단추 = (온: boolean) => {
    const b = 새요소();
    b._attr["data-d"] = "1";
    b.click = () => {
      const 눌림 = (칸.get("range")._on["click"] || []) as ((e?: unknown) => void)[];
      눌림.forEach((f) => f({ target: { closest: () => b } }));
    };
    return 온 ? b : b;
  };

  const doc: any = {
    createElement: () => 글자요소(),
    getElementById: (id: string) => 칸.get(id) ?? null,
    querySelector: (sel: string) => {
      if (sel === "#sup .cite-why") { 동기화(); return 버튼; }
      if (sel === "#sup .sup-line") return 줄들()[0] ?? null;
      if (sel === "#range button.on" || sel === "#range button") return 기간단추(true);
      return null;
    },
    querySelectorAll: (sel: string) => (sel === "#sup .sup-line" ? 줄들() : []),
  };

  const 저장: Record<string, string> = { ...씨앗 };
  const ls = {
    getItem: (k: string) => (k in 저장 ? 저장[k] : null),
    setItem: (k: string, v: string) => { 저장[k] = v; },
    removeItem: (k: string) => { delete 저장[k]; },
  };
  const win: Record<string, unknown> = {
    gijo: {
      listAgents: async () => [{ id: "orchestrator", name: "총괄", abbr: "총", role: "" }],
      aiteamSupervision: async () => sup,
    },
  };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "localStorage", 본문![1])(win, doc, ls);
  return { doc, 저장, ls, sup: () => 칸.get("sup").innerHTML as string };
}

/** 관문 ⑧′의 evaluate 본문을 **그 파일에서 떼어 온 그대로** 돌린다. */
async function 관문돌리기(무대: 무대): Promise<any> {
  // 관문의 기다림(setTimeout 300·400·700ms)을 0으로 줄인다 — 재는 것은 순서이지 시계가 아니다.
  const 빠른대기 = (fn: () => void) => setTimeout(fn, 0);
  // eslint-disable-next-line no-new-func
  const f = new Function("document", "localStorage", "setTimeout",
    "return (async () => {" + 관문본문 + "})();");
  return await f(무대.doc, 무대.ls, 빠른대기);
}
function 성립판정(r: unknown): boolean {
  // eslint-disable-next-line no-new-func
  return new Function("r", 성립식 + "\n  return 성립;")(r) as boolean;
}

const cite = (day: string, calls: number) =>
  ({ day, agent: "orchestrator", kind: "cite", calls, errors: 0, latencyMsSum: 0 });
const 사유행 = (day: string, reason: string, count: number) =>
  ({ day, agent: "orchestrator", reason, count });
const 화면 = (사유들: [string, number][]) => ({
  days: 1, calls: {}, recentErrors: {}, daily: [cite("2026-09-06", 2)],
  citeReasons: 사유들.map(([r, n]) => 사유행("2026-09-06", r, n)),
});
/** 자동 펼침을 통째로 지운 **퇴행 화면** — 관문이 이걸 초록으로 통과시키면 헛초록이다. */
const 퇴행소스 = () => {
  const 지운 = supSrc.replace("사유.못뗌 > 0 || 사유.통째 > 0 || ", "");
  expect(지운, "퇴행을 만들 자리를 못 찾았다 — 이 시험이 헛돈다").not.toBe(supSrc);
  return 지운;
};

describe("게시 관문 ⑧′ — 판정식이 헛초록을 안 낸다 (전-4 · 검토관 2026-09-06)", () => {
  it("헛돎 방지 — 관문 파일에서 ⑧′의 코드와 성립식을 실제로 떼어 왔다", () => {
    expect(섹션, "publish-gate-ui.mjs에서 ⑧′ 구간을 못 찾았다").not.toBe("");
    expect(관문본문, "⑧′의 evaluate 본문을 못 떼어 왔다").toContain("cite-why");
    expect(관문본문, "위험 신호 판정이 관문에 없다").toContain("위험신호");
    expect(성립식, "성립식을 못 떼어 왔다").toContain("r.위험신호");
  });

  it("ⓖ① 정상 — 위험 사유가 저절로 펴져 있으면 통과한다", async () => {
    const 무대 = 무대세우기(화면([["겹침없음", 1], ["통째교체", 1]]), {});
    const r = await 관문돌리기(무대);
    expect(r.위험신호, "관문이 위험 사유를 못 봤다").toBe(true);
    expect(r.원래펼침, "화면이 저절로 안 펴졌다").toBe(true);
    expect(성립판정(r), "정상 화면인데 관문이 빨갛다: " + JSON.stringify(r)).toBe(true);
  });

  it("ⓖ② 퇴행 — 자동 펼침을 지우면 관문이 **빨개진다**(저장 기억 없음)", async () => {
    const 무대 = 무대세우기(화면([["겹침없음", 1], ["통째교체", 1]]), {}, 퇴행소스());
    const r = await 관문돌리기(무대);
    expect(r.위험신호).toBe(true);
    expect(r.원래펼침, "지웠는데도 펴져 있다").toBe(false);
    expect(성립판정(r), "위험 사유를 접어 놓고도 관문이 초록이다").toBe(false);
  });

  it("★ ⓖ③ 퇴행 + 지난 관문이 남긴 저장 \"1\" — 그래도 빨개진다(헛초록의 뿌리)", async () => {
    // 이것이 검토관 gate 적발의 핵심이다: 관문 자신이 남긴 "1"이 자동 펼침 행세를 했다.
    const 무대 = 무대세우기(화면([["겹침없음", 1], ["통째교체", 1]]), { "gijo:cite-reasons-open": "1" }, 퇴행소스());
    const r = await 관문돌리기(무대);
    expect(r.중립화, "저장 「1」을 중립화하지 않았다 — 이 시험이 뜻을 잃는다").toBe(true);
    expect(r.원래펼침, "지난번 기억으로 펴진 것을 「저절로 펴졌다」고 읽었다").toBe(false);
    expect(성립판정(r), "관문이 제 실행으로 무력화됐다 — 자동 펼침을 지워도 초록이다").toBe(false);
  });

  it("ⓖ③′ 저장 \"1\"이어도 **진짜** 자동 펼침이면 통과한다 — 중립화가 헛빨강을 만들지 않는다", async () => {
    const 무대 = 무대세우기(화면([["겹침없음", 1], ["통째교체", 1]]), { "gijo:cite-reasons-open": "1" });
    const r = await 관문돌리기(무대);
    expect(r.중립화).toBe(true);
    expect(r.원래펼침, "다시 그렸더니 자동 펼침이 사라졌다").toBe(true);
    expect(성립판정(r), "멀쩡한 화면을 빨갛게 만든다: " + JSON.stringify(r)).toBe(true);
  });

  it("★ ⓖ④ 위험 사유를 재고 나서 **사람의 펼침 기억을 안 바꾼다**(\"0\" → \"0\")", async () => {
    const 무대 = 무대세우기(화면([["겹침없음", 1], ["못 뗌", 1]]), { "gijo:cite-reasons-open": "0" });
    const r = await 관문돌리기(무대);
    expect(r.위험신호).toBe(true);
    expect(무대.저장["gijo:cite-reasons-open"], "관문이 접어 둔 기억을 「1」로 굳혔다").toBe("0");
    expect(r.저장후, "성립식이 볼 값이 어긋난다").toBe(r.저장전);
    expect(성립판정(r)).toBe(true);
  });

  it("ⓖ⑤ 저장이 아예 없던 PC도 그대로 둔다 — 관문이 없던 키를 만들지 않는다", async () => {
    const 무대 = 무대세우기(화면([["겹침없음", 1], ["통째교체", 1]]), {});
    const r = await 관문돌리기(무대);
    expect("gijo:cite-reasons-open" in 무대.저장, "없던 키를 관문이 남겼다").toBe(false);
    expect(r.저장전).toBeNull();
    expect(r.저장후).toBeNull();
  });

  it("ⓖ⑥ 대조군 — 보통 사유만 있는 화면은 종전대로 눌러서 재고 기억도 되돌린다", async () => {
    const 무대 = 무대세우기(화면([["겹침없음", 2]]), { "gijo:cite-reasons-open": "0" });
    const r = await 관문돌리기(무대);
    expect(r.위험신호, "보통 사유를 위험 신호로 읽었다").toBe(false);
    expect(r.원래펼침, "위험 신호가 없는데 펴져 있다").toBe(false);
    expect(r.접힘보임).toBe(false);
    expect(r.펼침보임, "눌러도 안 펴졌다").toBe(true);
    expect(r.ls, "펼침을 기억 안 했다").toBe("1");
    expect(무대.저장["gijo:cite-reasons-open"], "접어 둔 기억이 바뀌었다").toBe("0");
    expect(성립판정(r), JSON.stringify(r)).toBe(true);
  });

  it("ⓖ⑦ 배지가 「통째교체 N건」이어도 관문이 배지를 못 읽었다고 하지 않는다", async () => {
    // 화면이 「사유 0건」 대신 「통째교체 1건」이라 적는 갈래(검토관 contract) — 관문의 배지 정규식이
    //   그 글자를 모르면 멀쩡한 화면을 빨갛게 만든다. 화면과 관문을 같이 고쳤는지 여기서 잰다.
    const 무대 = 무대세우기(화면([["통째교체", 1]]), {});
    const r = await 관문돌리기(무대);
    expect(r.배지, "화면이 「사유 0건」이라 적어 목록의 「통째교체 1」과 서로를 부정한다").toContain("통째교체 1건");
    expect(성립판정(r), "관문 배지 정규식이 새 갈래를 모른다: " + JSON.stringify(r)).toBe(true);
    // 배지가 건수를 안 세는 기간에는 꼬리가 「뗀 건수입니다」라고 말하지 않는다(또 딴말이 된다).
    expect(무대.sup(), "배지는 「통째교체 1건」인데 꼬리는 그것을 「뗀 건수」라 부른다").not.toContain("뗀 「건수」입니다");
  });
});
