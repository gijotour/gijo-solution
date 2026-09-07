// 대장↔저장소 상태(docState)를 **화면이 말하는 방식**의 짝 시험 (C-B, 2026-09-07).
// [전중후 계획서 정렬] 전-4 「반입 대장 ↔ 지식 저장소 잣대 한 곳」의 화면 쪽 절반.
//
// ■ 왜 이 파일이 필요한가
//   서버는 이미 `engine/docledger.ts` 한 곳에서 판정하고 꼬리표까지 낸다. 그런데 화면은
//   TS를 import할 수 없는 **순수 HTML/JS**라, 같은 문구를 손으로 한 벌 더 적을 수밖에 없다.
//   「같은 것을 여러 곳에 적으면 어긋난다」가 이 자리에서 재발하는 것을 막는 방법은 하나뿐이다 —
//   **두 벌을 같은 입력으로 돌려 글자를 견주는 시험**을 두는 것(소스 감시 계열, 세 번째 규칙).
//
// ■ 지키는 것
//   ① mydocs.html의 칩 문구 == 서버 `상태꼬리` (글자 그대로, 다섯 상태 × 대장 수 경우의 수 전부)
//   ② 🏢 회사 지식 배지의 ⚠N은 **missing만** 센다 — 서버 「⚠ 조각 없음 N건」과 같은 잣대
//   ③ 「↩ 다시 넣기」는 대화창에 **문장을 담기만** 한다(gijo:prefill) — 화면이 직접 지시하지 않는다
//   ④ 유령 필터가 handover·memory·dashboard·grouppanels **네 곳에 다 있다**(한 곳만 빠져도 숫자가 갈린다)
//   ⑤ 반증 — `docState`가 아예 없는 **옛 응답**으로도 정상 줄은 오늘과 한 글자도 다르지 않다
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 상태꼬리, 조각상태, 조각없음, type DocState } from "../src/engine/docledger";

const 화면 = (f: string) => path.join(__dirname, "../../client/src/renderer/pages/", f);
const mydocs = fs.readFileSync(화면("mydocs.html"), "utf8");
const memory = fs.readFileSync(화면("memory.html"), "utf8");
const handover = fs.readFileSync(화면("handover.html"), "utf8");
const dashboard = fs.readFileSync(화면("dashboard.html"), "utf8");
const grouppanels = fs.readFileSync(화면("grouppanels.js"), "utf8");

/** `function 이름(` 부터 **짝이 맞는 닫는 중괄호**까지 — 그 함수 원문을 통째로 자른다. */
function 함수원문(src: string, 이름: string): string {
  const i = src.indexOf("function " + 이름 + "(");
  expect(i, `${이름}() 를 못 찾았다 — 이름이 바뀌었으면 이 시험도 같이 고칠 것(헛돌면 안 된다)`).toBeGreaterThan(0);
  const 시작 = src.indexOf("{", i);
  let 깊이 = 0;
  for (let j = 시작; j < src.length; j++) {
    if (src[j] === "{") 깊이++;
    else if (src[j] === "}") { 깊이--; if (깊이 === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`${이름}() 의 중괄호 짝이 안 맞는다`);
}

/** 화면 안의 함수를 **그 원문 그대로** 불러온다 — 옮겨 적으면 시험이 시험을 검증하게 된다. */
function 화면함수(src: string, 이름: string): (...a: unknown[]) => unknown {
  return new Function(`${함수원문(src, 이름)}; return ${이름};`)() as (...a: unknown[]) => unknown;
}

describe("① 칩 문구는 서버 상태꼬리와 글자 그대로 같다", () => {
  const 조각꼬리 = 화면함수(mydocs, "조각꼬리") as (s: unknown, n: unknown) => string;
  const 상태들: (DocState | undefined | null)[] = ["ok", "missing", "short", "extra", "unknown", undefined, null];
  const 대장수들: unknown[] = [null, undefined, 0, 1, 21, 101, NaN, "21"];

  it("다섯 상태 × 대장 수 경우의 수 전부에서 서버와 같은 글자를 낸다", () => {
    for (const s of 상태들) {
      for (const n of 대장수들) {
        expect(조각꼬리(s, n), `docState=${String(s)} · 대장조각=${String(n)} 에서 화면과 서버 문구가 다르다`)
          .toBe(상태꼬리(s ?? undefined, n as number | null));
      }
    }
  });

  it("정상(ok)·모름(unknown)에는 아무 말도 안 붙인다 — 칩을 안 그리는 근거가 이 빈 문자열이다", () => {
    expect(조각꼬리("ok", 12)).toBe("");
    expect(조각꼬리("unknown", null)).toBe("");
  });

  it("서버가 문구를 바꾸면 이 시험이 먼저 빨개진다 (세 문구가 화면 원문에 실재)", () => {
    expect(mydocs).toContain("조각 없음");
    expect(mydocs).toContain("조각 일부 사라짐");
    expect(mydocs).toContain("옛 판 조각 남음");
  });
});

describe("② 🏢 회사 지식 배지의 ⚠N은 missing만 센다", () => {
  const 조각없음화면 = 화면함수(mydocs, "조각없음") as (d: unknown) => boolean;

  it("화면 술어가 서버 술어와 같은 답을 낸다 (short·extra는 안 든다)", () => {
    for (const s of ["ok", "missing", "short", "extra", "unknown"] as DocState[]) {
      expect(조각없음화면({ docState: s }), `docState=${s} 에서 화면과 서버 술어가 갈렸다`).toBe(조각없음(s));
    }
    expect(조각없음화면(undefined)).toBe(false); // 옛 응답 — 없는 것을 유령이라 하지 않는다
    expect(조각없음화면({})).toBe(false);
  });

  it("배지를 채우는 자리가 조각없음()으로 세고, 0이면 안 그린다", () => {
    const 자리 = mydocs.slice(mydocs.indexOf('document.getElementById("nKnow")') - 400,
      mydocs.indexOf('document.getElementById("nKnow")') + 400);
    expect(자리, "배지 셈이 조각없음() 술어를 안 쓴다 — 손으로 세면 서버와 갈린다").toContain("조각없음");
    expect(자리, "0건일 때도 ⚠를 그리면 늘 경고가 켜진 화면이 된다").toMatch(/못읽음 \?/);
  });
});

describe("③ 「↩ 다시 넣기」는 대화창에 문장을 담기만 한다", () => {
  it("gijo:prefill로 담는다 — 보내는 gijo:ask도, 화면 직접 dispatch도 아니다", () => {
    const i = mydocs.indexOf('act === "reingest"');
    expect(i, "reingest 처리기가 없다").toBeGreaterThan(0);
    const 몸 = mydocs.slice(i, i + 900);
    expect(몸, "문장을 담는 통로가 gijo:prefill이 아니다").toContain('type: "gijo:prefill"');
    expect(몸, "gijo:ask는 **보낸다** — 지시는 사람이 보낸다").not.toContain("gijo:ask");
    expect(몸, "화면이 직접 지시하면 결재판을 건너뛴다 — **부르는 자리**가 없어야 한다")
      .not.toMatch(/[.]dispatch[(]|runAgent[(]|askConsole[(]|gijoConsole[.]ask/);
    expect(몸, "담을 문장은 「<문서이름> 다시 넣어줘」 하나다").toContain("다시 넣어줘");
  });

  it("성공을 미리 그리지 않는다 — 담았다는 사실까지만 말한다", () => {
    const i = mydocs.indexOf('act === "reingest"');
    const 몸 = mydocs.slice(i, i + 900);
    expect(몸, "「다시 넣었습니다」류는 거짓이다(보내지도 않았다)").not.toMatch(/다시 넣었습니다|복구했습니다|되살렸습니다/);
    expect(몸).toContain("얹었습니다");
  });

  it("단추는 hasSource와 짝이다 — 원본이 없으면 안내만", () => {
    expect(mydocs, "hasSource 없이 ↩를 그리면 눌러도 실패한다").toMatch(/hasSource[^\n]*reingest/);
    expect(mydocs, "원본 없는 문서에는 ＋로 다시 올리는 길을 알려야 한다").toContain("＋로 파일을 다시 올려");
  });
});

describe("④ 유령 필터가 네 화면에 다 있다 — 대화 답과 같은 잣대", () => {
  const 자리 = { "handover.html": handover, "memory.html": memory, "dashboard.html": dashboard, "grouppanels.js": grouppanels };
  for (const [이름, src] of Object.entries(자리)) {
    it(`${이름} 이 docState missing을 가른다`, () => {
      expect(src, `${이름} 이 유령을 안 가른다 — 화면 숫자가 대화 답과 갈린다`).toMatch(/docState === "missing"/);
    });
  }

  it("숫자를 말하는 세 곳은 「(⚠ 조각 없음 N)」을 병기한다 — 빼기만 하면 사라진 이유를 아무도 모른다", () => {
    for (const [이름, src] of [["memory.html", memory], ["dashboard.html", dashboard], ["grouppanels.js", grouppanels]] as const) {
      expect(src, `${이름} 이 뺀 수만 말하고 뺐다는 사실을 안 말한다`).toContain("⚠ 조각 없음 ");
    }
  });

  it("인수인계는 유령에 담기 단추 대신 꼬리표를 준다", () => {
    const i = handover.indexOf('docState === "missing"');
    const 몸 = handover.slice(i - 200, i + 700);
    expect(몸, "유령을 담으면 3단계 검증에서 근거 0건으로 떨어진다").toContain("인계 자료로 못 씁니다");
  });

  it("📚 히트맵은 유령을 초록 「정상」이라 하지 않는다", () => {
    const i = memory.indexOf('dmView === "heat"');
    const 몸 = memory.slice(i, i + 1400);
    expect(몸, "히트맵이 유령을 안 가른다").toMatch(/docState === "missing"/);
    expect(몸, "못 읽는 문서에 「정상」은 거짓이다").toContain("못 읽음");
  });
});

describe("⑤ 반증 — docState가 없는 옛 응답으로도 정상 줄은 오늘과 같다", () => {
  it("조각꼬리()가 빈 문자열이면 칩 코드는 통째로 비켜 간다", () => {
    const 조각꼬리 = 화면함수(mydocs, "조각꼬리") as (s: unknown, n: unknown) => string;
    // 옛 응답: docState·ledgerChunks 두 칸이 아예 없다
    expect(조각꼬리(undefined, undefined)).toBe("");
    // 조각상태()가 낼 수 있는 값 중 꼬리가 있는 것은 셋뿐이다(ok·unknown은 조용하다)
    const 꼬리있음 = (["ok", "missing", "short", "extra", "unknown"] as DocState[]).filter((s) => 상태꼬리(s) !== "");
    expect(꼬리있음).toEqual(["missing", "short", "extra"]);
  });

  it("정상 줄의 이름 칸 원문이 그대로 남아 있다 — 한 글자도 안 바뀌었다", () => {
    expect(mydocs, "정상 줄 이름 칸이 바뀌었다 — 3,900줄이 함께 흔들린다")
      .toContain('\'<span class="trunc" title="\' + esc(d.documentId) + \'">\' + esc(d.documentId) + "</span>"');
  });

  it("칩 갈래의 **방향**이 뒤집히지 않았다 — 꼬리가 없을 때 옛 원문으로 빠져나간다", () => {
    // 조건을 뒤집으면(꼬리가 **있을 때** 옛 원문) 정상 줄에 칩이 붙고 어긋난 줄이 조용해진다.
    // 두 자리(목록 줄·문서창 상세)가 같은 방향이어야 한다.
    const 갈래 = mydocs.split("if (!꼬리) return").length - 1;
    expect(갈래, "꼬리 없음 → 조기 반환 갈래가 두 자리에 다 있어야 한다(목록 줄·문서창 상세)").toBe(2);
    expect(mydocs, "조건이 뒤집혔다 — 정상 줄에 칩이 붙는다").not.toMatch(/if (꼬리) return/);
  });

  it("행 높이·칸 폭 문자열은 손대지 않았다 (30px 계약)", () => {
    expect(mydocs).toContain('style="grid-template-columns:20px 1fr 74px 52px 44px;gap:8px"');
    expect(mydocs, "칩은 줄 **안쪽** 그리드다 — 행 높이를 늘리면 3,900줄이 다 늘어난다")
      .toMatch(/\.dk-name\{display:grid/);
  });

  it("조각상태()가 내는 다섯 값 말고 다른 값을 화면이 지어내지 않는다", () => {
    expect(조각상태(0, 21)).toBe("missing");
    expect(조각상태(99, 101)).toBe("short");
    expect(조각상태(2, 1)).toBe("extra");
    expect(조각상태(12, null)).toBe("unknown");
    expect(조각상태(12, 12)).toBe("ok");
  });
});
