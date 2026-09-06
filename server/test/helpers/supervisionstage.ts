// 감독(supervision.html) 화면을 **실제 인라인 스크립트 그대로** 돌리는 가짜 무대.
//
// ■ 왜 helpers/에 두나
//   게시 관문(tools/publish-gate-ui.mjs)의 ⑧′는 실화면에서만 도는 코드라, 판정식을 재려면
//   그 코드를 떼어 와 **화면 스크립트 위에서** 돌려 봐야 한다. 그리고 고정 자료 판정
//   (publishgatecitefixed.test.ts)은 실앱에서 아예 못 도는 부류라 **여기가 유일한 자리**다.
//   그 무대를 시험 파일마다 새로
//   만들면 화면이 바뀔 때 한쪽만 낡는다 — 이 저장소의 「같은 것을 여러 곳에 적으면 어긋난다」.
//   ⚠ 2026-09-07 현재 server/test/publishgatecite.test.ts에는 같은 모양의 무대가 **한 벌 더**
//     있다(먼저 만들어진 쪽). 그 파일을 이번에 손대지 않아 아직 두 벌이다 — 다음에 그 시험을
//     고칠 사람이 여기로 합칠 것. 새 시험은 여기를 쓴다.
// ■ 안 재는 것(정직 표시): **픽셀**. 높이는 흉내다(한 줄 19px 가정) — 실제 레이아웃은 관문이
//   실화면에서 잰다. 여기서 초록이라고 「실화면에서 통과했다」고 말하면 안 된다.
import { expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

export const 감독페이지 = path.join(__dirname, "../../../client/src/renderer/pages/supervision.html");
export const 감독소스 = fs.readFileSync(감독페이지, "utf8");

export function 새요소(): any {
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

export type 감독무대 = {
  doc: any;
  win: any;
  저장: Record<string, string>;
  ls: any;
  sup: () => string;
  /** 화면이 지금까지 몇 번 다시 그려졌나 — 기간 단추가 정말 load()를 다시 돌았는지 볼 때 쓴다. */
  판수: () => number;
};

/**
 * 감독 화면의 인라인 스크립트를 실제로 돌리고, 관문 코드가 볼 수 있는 DOM/window를 세운다.
 * @param 처음자료 화면이 처음 읽을 aiteamSupervision 응답(관문이 이 칸을 갈아끼운다)
 */
export function 감독무대세우기(처음자료: unknown, 씨앗: Record<string, string>, 소스 = 감독소스): 감독무대 {
  const 본문 = 소스.match(/<script>\r?\n([\s\S]*?)<\/script>/);
  expect(본문, "supervision.html에서 인라인 <script>를 못 떼어 왔다 — 이 시험이 헛돈다").not.toBeNull();

  const 칸 = new Map<string, any>();
  for (const id of ["kpis", "grid", "sup", "range", "goRedteam", "safety"]) 칸.set(id, 새요소());

  // ⚠ innerHTML에 **넣을 때마다** 요소를 새로 만든다 — 진짜 브라우저가 그렇게 한다.
  //   「같은 글자면 그대로 둔다」로 만들면 다시 그렸을 때 옛 버튼이 살아남아 클릭 핸들러가
  //   두 겹 걸리고, 한 번 누른 것이 두 번 토글돼 시험이 거짓 빨강을 낸다.
  const supEl = 칸.get("sup");
  let 판 = 0, _html = "";
  Object.defineProperty(supEl, "innerHTML", {
    get() { return _html; },
    set(v: string) { _html = String(v); 판 += 1; },
  });

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

  const 기간단추 = () => {
    const b = 새요소();
    b._attr["data-d"] = "1";
    b.click = () => {
      const 눌림 = (칸.get("range")._on["click"] || []) as ((e?: unknown) => void)[];
      눌림.forEach((f) => f({ target: { closest: () => b } }));
    };
    return b;
  };

  const doc: any = {
    createElement: () => 글자요소(),
    getElementById: (id: string) => 칸.get(id) ?? null,
    querySelector: (sel: string) => {
      if (sel === "#sup .cite-why") { 동기화(); return 버튼; }
      if (sel === "#sup .sup-line") return 줄들()[0] ?? null;
      if (sel === "#range button.on" || sel === "#range button") return 기간단추();
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
  // ⚠ gijo는 **갈아끼울 수 있는 보통 객체**로 둔다 — 고정 자료로 화면을 재려면 이 칸을 바꿔
  //   끼워야 하는데, **실앱에서는 그게 안 된다**(contextBridge가 내준 window.gijo는 얼어 나온다 —
  //   writable:false·configurable:false, client/src/preload.ts:129의 실측 기록).
  //   그래서 고정 자료 판정이 살 수 있는 자리는 여기뿐이고, 관문은 실화면에서 **실제 자료로만**
  //   잰다(publishgatecitefixed.test.ts 머리말에 그 경계를 적어 두었다).
  //   ⚠ 이 무대가 실앱보다 **무르다**는 뜻이기도 하다 — 여기서 초록이라고 「실화면에서 통과했다」고
  //     말하면 안 된다. 그 갈래는 같은 파일의 ⓗ③(얼린 gijo)이 일부러 재현해 둔다.
  const win: Record<string, any> = {
    gijo: {
      listAgents: async () => [{ id: "orchestrator", name: "총괄", abbr: "총", role: "" }],
      aiteamSupervision: async () => 처음자료,
    },
  };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "localStorage", 본문![1])(win, doc, ls);
  return { doc, win, 저장, ls, sup: () => 칸.get("sup").innerHTML as string, 판수: () => 판 };
}

/** 감독 API가 돌려주는 고정 자료 한 벌을 만든다(화면이 읽는 칸만 채운다). */
export function 감독자료(사유들: [string, number][], 뗀답 = 3, day = "2026-09-06") {
  return {
    days: 1, calls: {}, recentErrors: {},
    daily: [{ day, agent: "orchestrator", kind: "cite", calls: 뗀답, errors: 0, latencyMsSum: 0 }],
    citeReasons: 사유들.map(([reason, count]) => ({ day, agent: "orchestrator", reason, count })),
  };
}
