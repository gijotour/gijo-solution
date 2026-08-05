// 그림 띠가 **하지 못하는 일을 약속하지 않는지** 확인한다.
//
// ⚠ 실측(2026-08-06): 띠에는 화면이 준 "누르면 목록이 좁혀집니다"가 적히는데, 값이 전부 0이면
//   bars()는 「표시할 값이 없습니다」를 그린다 — **누를 것이 하나도 없는데 누르라고 적혀 있었다.**
//   화면 4곳(조치·승인/규정 준수/위협 인텔/취약점)이 이 문구를 조건 없이 달고 있었다.
//
//   왜 못 잡았나:
//     · 실앱 측정 — 데이터가 있는 상태로 재서 늘 막대가 보였다. 0건 화면을 안 봤다.
//     · 스윕 — 화면이 렌더되는지만 본다. 적힌 말이 사실인지는 안 본다.
//   그래서 **막대가 없을 때의 문구**를 직접 만들어 본다.
//
// ⚠ 고치는 자리를 viz.js 한 곳으로 잡은 이유: 화면마다 조건을 달게 하면 새 화면에서 또 샌다.
//   이 시험도 그래서 **화면이 아니라 공용 모듈**을 겨눈다.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";

// viz.js는 브라우저용 IIFE라 import가 안 된다 — 최소한의 document를 세우고 그대로 실행한다.
// (jsdom·happy-dom이 이 저장소에 없다. 문구 하나 보자고 의존성을 늘리지 않는다.)
//
// ⚠ **가짜 DOM은 그 자체가 함정이다.** 처음엔 textContent를 가로채 안내를 읽으려 했는데,
//   띠()는 안내를 innerHTML 문자열로 넣어서 아무것도 안 잡혔고, querySelector가 null을 주는
//   바람에 6개 전부 엉뚱한 이유로 실패했다 — 제품이 아니라 내 흉내가 틀렸던 것이다.
//   그래서 흉내를 최소로 줄이고, **mount가 돌려준 띠의 HTML 문자열**을 그대로 본다.
//   화면에 실제로 박히는 그 문자열이 판정 대상이다.
let mount: (자리: unknown, spec: unknown) => { innerHTML: string } | null;

beforeAll(() => {
  const src = fs.readFileSync(new URL("../../client/src/renderer/pages/viz.js", import.meta.url), "utf8");

  const 가짜요소 = (): Record<string, unknown> => ({
    className: "", id: "", innerHTML: "", textContent: "",
    style: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, addEventListener() {},
    appendChild(c: unknown) { return c; },
    querySelectorAll: () => [],
    // 줄(d)가 ".gviz-row"를 찾는다 — null을 주면 붙일 자리가 없어 터진다.
    querySelector: () => 가짜요소(),
  });

  const doc = {
    createElement: () => 가짜요소(),
    head: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "document", src)(win, doc);
  mount = (win.gijoViz as { mount: typeof mount }).mount;
  expect(typeof mount, "viz.js에서 mount를 못 얻었다 — 이 시험이 헛돌고 있다").toBe("function");
});

/** 띠를 그려 **화면에 박히는 HTML**을 돌려준다. 안내 문구는 이 안에 들어 있다. */
const 띄우기 = (spec: unknown): string => {
  const 자리 = { innerHTML: "", appendChild() {} };
  const d = mount(자리, spec);
  return d ? String(d.innerHTML) : "";
};

const 막대 = (값들: number[], onPick?: () => void) => ({
  kind: "bars",
  segments: 값들.map((v, i) => ({ key: "k" + i, label: "갈래" + i, value: v })),
  ...(onPick ? { onPick } : {}),
});

describe("띠는 못 하는 일을 약속하지 않는다", () => {
  it("누를 막대가 있으면 약속을 그대로 적는다 — 대조군", () => {
    const 안내 = 띄우기({ hint: "누르면 목록이 좁혀집니다", parts: [막대([3, 1], () => {})] });
    expect(안내).toContain("누르면");
  });

  it("★ 값이 전부 0이면 「누르면」을 지운다 — 누를 것이 없다", () => {
    const 안내 = 띄우기({ hint: "누르면 목록이 좁혀집니다", parts: [막대([0, 0], () => {})] });
    expect(안내, `누를 게 없는데 약속이 남았다: ${안내}`).not.toContain("누르면");
  });

  it("★ 누르는 기능 자체가 없으면(onPick 없음) 약속을 지운다", () => {
    const 안내 = 띄우기({ hint: "누르면 목록이 좁혀집니다", parts: [막대([5, 2])] });
    expect(안내).not.toContain("누르면");
  });

  it("★ 약속만 걷고 **기준 문장은 남긴다** — 무엇을 센 숫자인지가 사라지면 안 된다", () => {
    // SBOM 화면이 이런 꼴이다: 약속 + 기준(자산/부품 수).
    const 안내 = 띄우기({
      hint: "누르면 목록이 좁혀집니다 · 자산 43개 · 부품 844개(직접 읽음 789 · 스캐너 55)",
      parts: [막대([0], () => {})],
    });
    expect(안내).not.toContain("누르면");
    expect(안내, "기준 문장까지 지워졌다").toContain("자산 43개");
    expect(안내).toContain("부품 844개");
    expect(/gviz-hint">·/.test(안내), "앞에 남은 가운뎃점을 걷어야 한다").toBe(false);
  });

  it("약속이 없던 안내는 건드리지 않는다", () => {
    // 감사 기록 화면이 이런 꼴이다 — 약속 없이 기준만 적는다. 한 글자도 바뀌면 안 된다.
    const 원문 = "불러온 최근 35,531건 기준 · 2026-07 ~ 2026-08";
    expect(띄우기({ hint: 원문, parts: [막대([0])] })).toContain(`<span class="gviz-hint">${원문}</span>`);
  });

  it("「누르면 그 갈래로 내려갑니다」처럼 다른 약속도 같이 걷는다", () => {
    const 안내 = 띄우기({ hint: "누르면 그 갈래로 내려갑니다", parts: [막대([0], () => {})] });
    expect(안내).not.toContain("누르면");
  });
});
