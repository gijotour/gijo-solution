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
  // ⚠ Infinity·"1e999"가 이 목록에 **있어야** 한다(2026-09-07 검토관 [낮음]): 서버 상태꼬리()에는
  //   `Number.isFinite` 관문이 있는데 화면 조각꼬리()에는 없어, 두 함수가 갈리는 **유일한 갈래**가
  //   여기였다. 그 갈래를 안 넣고 「경우의 수 전부」라고 적으면 시험이 거짓말을 한다.
  const 대장수들: unknown[] = [null, undefined, 0, 1, 21, 101, NaN, "21", Infinity, -Infinity, "1e999", "abc"];

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
    // ⚠ 앵커는 **고르는 자리**(showExisting)로 잡는다 — `docState === "missing"` 첫 자리로 잡으면
    //   나중에 생긴 유령새로고침()이 먼저 걸려, 엉뚱한 데를 보고 초록/빨강을 낸다(2026-09-07).
    const i = handover.indexOf("async function showExisting");
    expect(i, "showExisting이 없다 — 고르는 자리 이름이 바뀌었다").toBeGreaterThan(0);
    const 몸 = handover.slice(i, i + 1600);
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
    // ⚠ 괄호는 **이스케이프**한다(2026-09-07 검토관 [낮음]): `/if (꼬리) return/`은 캡처 그룹이라
    //   실제로 찾는 글자가 `if 꼬리 return`이 되어, 뒤집힌 원문에도 안 걸리는 **죽은 관문**이었다.
    expect(mydocs, "조건이 뒤집혔다 — 정상 줄에 칩이 붙는다").not.toMatch(/if\s*\(꼬리\)\s*return/);
  });

  it("행 높이·칸 폭 문자열은 손대지 않았다 (30px 계약)", () => {
    expect(mydocs).toContain('style="grid-template-columns:20px 1fr 74px 52px 44px;gap:8px"');
    expect(mydocs, "칩은 줄 **안쪽** 상자다 — 밖으로 꺼내면 행 높이가 3,900줄에서 다 늘어난다")
      .toMatch(/\.dk-name\{display:flex/);
    // ★ 좁은 폭 계약(2026-09-07 검토관 [낮음]) — 칩이 nowrap인데 줄일 수 없으면, 판이 좁아질 때
    //   이름 칸을 넘어 **등급·조각·날짜 칸 위로 겹친다**(narrow-probe 판정 ①넘침·④겹침).
    //   이름이 먼저 줄고 칩은 마지막에 말줄임되도록 둘 다 줄어들 수 있어야 한다.
    //   ⚠ 규칙이 걸리는 자리는 **목록 줄 안(.dk-name)** 이다 — 문서창 상세의 칩은 글 속
    //     inline-block이라 overflow를 걸면 기준선이 바뀌어 옆 글자와 어긋난다(거기는 안 좁다).
    const 칩규칙 = mydocs.slice(mydocs.indexOf(".dk-name{"), mydocs.indexOf(".dk-name{") + 900);
    expect(칩규칙, "칩이 줄어들 수 없으면 좁은 판에서 옆 칸을 덮는다").toMatch(/\.dk-name \.dk-chip\{[^}]*text-overflow:ellipsis/);
    expect(칩규칙, "칩이 flex-shrink를 막으면 말줄임 규칙이 헛돈다").toMatch(/\.dk-name \.dk-chip\{[^}]*flex:0 1 auto/);
    expect(칩규칙, "이름 칸이 안 줄어들면 칩만 줄어든다 — 순서가 뒤집힌다").toMatch(/\.dk-name \.trunc\{[^}]*flex:1 1 auto/);
  });

  it("조각상태()가 내는 다섯 값 말고 다른 값을 화면이 지어내지 않는다", () => {
    expect(조각상태(0, 21)).toBe("missing");
    expect(조각상태(99, 101)).toBe("short");
    expect(조각상태(2, 1)).toBe("extra");
    expect(조각상태(12, null)).toBe("unknown");
    expect(조각상태(12, 12)).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 모집단 표 — 「⚠ 조각 없음 N」이 화면마다 **무엇을 세는지**를 값으로 못박는다
//
//   왜 (2026-09-07 검토관 [중]): ④는 파일마다 `docState === "missing"` 글자가 있는지만 봤다.
//   유령 판정이 같아도 **바탕이 되는 문서 목록**이 다르면 같은 낱말이 화면마다 다른 수를 낸다 —
//   실제로 grouppanels는 personal:만 빼고, dashboard는 아무것도 안 빼서 mydocs의 ⚠1이
//   저기서는 ⚠3·⚠4였다. 그래서 네 화면의 **술어를 원문 그대로 불러** 같은 표본으로 돌린다.
//
//   ★ 세 화면은 같은 술어, dashboard 한 곳만 다르다 — 그리고 그 다름은 **의도**다:
//     🏢 회사 지식·📚 지식 창고는 「남과 나누는 문서」의 자리라 개인 문서(personal:)를 빼지만,
//     대시보드의 「내 지식창고」는 내 개인 문서까지가 내 것이라 넣는다. 승인 문답·침해사고
//     사례는 **어디서도 문서로 세지 않는다**(사람이 못 읽는 id이고 관리 자리가 따로 있다 —
//     서버 runKnowledgeStatus도 승인 문답을 문서에서 뺀다).
// ─────────────────────────────────────────────────────────────────────────────
describe("⑥ 「⚠ 조각 없음 N」의 모집단 — 네 화면을 같은 표본으로 돌려 견준다", () => {
  const 표본 = [
    { documentId: "취약점관리_지침.md", origin: "upload", docState: "ok" },
    { documentId: "2025_위협전망.pdf", origin: "upload", docState: "missing" },      // 회사 유령
    { documentId: "personal:11111111", origin: "upload", docState: "missing" },      // 개인 유령
    { documentId: "personal:22222222", origin: "upload", docState: "ok" },
    { documentId: "승인문답:dtmtl5b1", origin: "approved-qa", docState: "missing" },
    { documentId: "incident-case:ic-1", origin: "incident-case", docState: "missing" },
    { documentId: "보안제품_리포트.pdf", origin: "upload", docState: "short" },
  ];
  const 회사 = [
    화면함수(mydocs, "회사지식인가") as (d: unknown) => boolean,
    화면함수(memory, "회사지식인가") as (d: unknown) => boolean,
    화면함수(grouppanels, "회사지식인가") as (d: unknown) => boolean,
  ];
  const 이름 = ["mydocs.html", "memory.html", "grouppanels.js"];
  const 지식창고인가 = 화면함수(dashboard, "지식창고문서인가") as (d: unknown) => boolean;

  it("🏢 회사 지식 쪽 세 화면은 **한 글자도 안 다른 답**을 낸다", () => {
    for (const d of 표본) {
      const 답 = 회사.map((f) => f(d));
      expect(new Set(답).size, `${d.documentId} 에서 ${이름.join("·")} 의 모집단이 갈렸다`).toBe(1);
    }
  });

  it("세 화면의 목록 3줄 · ⚠1 — 개인·승인문답·사례는 애초에 안 센다", () => {
    for (let i = 0; i < 회사.length; i++) {
      const 남은 = 표본.filter((d) => 회사[i](d));
      expect(남은.map((d) => d.documentId), `${이름[i]} 의 목록 모집단이 바뀌었다`)
        .toEqual(["취약점관리_지침.md", "2025_위협전망.pdf", "보안제품_리포트.pdf"]);
      expect(남은.filter((d) => 조각없음(d.docState as DocState)).length, `${이름[i]} 의 ⚠N`).toBe(1);
    }
  });

  it("대시보드 「내 지식창고」는 목록 5줄 · ⚠2 — 개인 문서를 **일부러** 넣는다", () => {
    const 남은 = 표본.filter((d) => 지식창고인가(d));
    expect(남은.map((d) => d.documentId)).toEqual([
      "취약점관리_지침.md", "2025_위협전망.pdf", "personal:11111111", "personal:22222222", "보안제품_리포트.pdf",
    ]);
    expect(남은.filter((d) => 조각없음(d.docState as DocState)).length).toBe(2);
  });

  it("대시보드가 회사 쪽과 갈리는 자리는 **개인 문서뿐**이다 — 다른 데서 갈리면 실수다", () => {
    for (const d of 표본) {
      const 개인 = String(d.documentId).indexOf("personal:") === 0;
      expect(지식창고인가(d), `${d.documentId} — 개인 문서 말고 다른 이유로 갈렸다`)
        .toBe(개인 ? true : 회사[0](d));
    }
  });

  it("승인 문답·침해사고 사례는 **네 화면 어디에서도** 문서로 안 센다 (서버와 같은 규칙)", () => {
    for (const id of ["승인문답:dtmtl5b1", "incident-case:ic-1"]) {
      const d = 표본.find((x) => x.documentId === id)!;
      for (let i = 0; i < 회사.length; i++) expect(회사[i](d), `${이름[i]} 이 ${id} 를 문서로 센다`).toBe(false);
      expect(지식창고인가(d), `dashboard.html 이 ${id} 를 문서로 센다`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ 인수인계 — 유령 차단이 **고르는 순간**에만 걸리면 막은 게 아니다
//   왜 (2026-09-07 검토관 [중]): 담긴 목록은 localStorage에 남고, 유령의 실제 방아쇠
//   (조각 소실)는 담은 **뒤에** 일어난다. 3단계 검증이 그 배열을 그대로 넘기면
//   「담을 때는 멀쩡했던 문서」가 근거 0건으로 떨어져 통과율만 깎인다.
// ─────────────────────────────────────────────────────────────────────────────
describe("⑦ 인수인계 — 담긴 뒤에 유령이 된 문서도 잡는다", () => {
  it("검증 직전에 문서 상태를 **다시 묻는다**(담을 때 한 번이 아니다)", () => {
    expect(handover, "상태를 다시 읽는 자리가 없다 — 담긴 뒤 사라진 조각을 못 본다")
      .toContain("function 유령새로고침");
    const i = handover.indexOf("async function runVerify");
    expect(i, "runVerify가 없다 — 검증 경로 이름이 바뀌었으면 이 시험도 같이 고칠 것").toBeGreaterThan(0);
    const 몸 = handover.slice(i, i + 1200);
    expect(몸, "검증이 상태를 다시 안 읽고 담긴 옛 배열을 그대로 넘긴다").toContain("유령새로고침");
    expect(몸, "뺐으면 **뺐다고 말한다** — 조용히 빼면 통과율만 달라진다").toContain("검증에서 뺐습니다");
  });

  it("담긴 칩에도 표시가 있다 — 사람이 왜 빠졌는지 알 수 있어야 한다", () => {
    const i = handover.indexOf("function renderDocs");
    const 몸 = handover.slice(i, i + 900);
    expect(몸, "담긴 칩이 성한 문서와 글자가 같으면 담당자는 영영 모른다").toContain("유령집합");
    expect(몸).toContain("조각 없음");
  });

  it("유령을 **지우지는 않는다** — 사라지는 조작 금지", () => {
    // 담긴 목록(docs)을 건드려도 되는 자리는 **사람이 ✕를 누른 자리 하나뿐**이다.
    // 검증 경로가 docs를 줄이면 담당자는 자기가 담은 문서가 왜 없는지 영영 모른다.
    const i = handover.indexOf("async function runVerify");
    const 몸 = handover.slice(i, i + 1400);
    expect(몸, "검증이 담긴 목록 자체를 줄인다 — 화면에서 문서가 조용히 사라진다")
      .not.toMatch(/docs = /);
    expect(몸, "검증에 넘기는 배열(ids)에서만 뺀다").toMatch(/ids = ids\.filter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ 📚 지식 창고(memory.html) — 「AI가 쓸 수 있는 수」와 「목록에 보이는 줄 수」는 **다른 질문**이다
//   왜 (2026-09-07 검토관 [중]): 머리줄 요약은 유령을 빼고, 바로 아래 세그먼트 「전체 N」과
//   그룹 머리 「N개」는 유령을 넣는다 — 5줄 간격으로 두 수가 서 있다. 둘 다 맞지만,
//   **일부러 다르다는 사실**이 코드에도 화면에도 없으면 다음 사람이 한쪽을 「고쳐」 버린다.
//   여기서는 두 수가 **더해서 맞아떨어지는지**를 지킨다(요약 표시 + ⚠N == 세그 전체).
// ─────────────────────────────────────────────────────────────────────────────
describe("⑧ 지식 창고의 두 수는 갈린 게 아니라 더해서 맞는다", () => {
  it("요약(유령 뺀 수) + ⚠N == 세그먼트 「전체」(목록 줄 수)", () => {
    // 두 자리의 **원문 표현식**을 그대로 꺼내 같은 배열로 돌린다(옮겨 적으면 시험이 시험을 검증한다).
    const 요약자리 = memory.slice(memory.indexOf('getElementById("dmSummary")') - 300, memory.indexOf('getElementById("dmSummary")') + 300);
    const 세그자리 = memory.slice(memory.indexOf("function renderDmSeg"), memory.indexOf("function renderDmSeg") + 900);
    expect(요약자리, "요약이 dmDocs가 아닌 딴 원천을 센다").toMatch(/dmDocs\.length - 못읽음머리/);
    expect(세그자리, "세그먼트가 목록 줄 수(dmDocs 전수)를 안 센다").toMatch(/전체 <b>\$\{dmDocs\.length\}<\/b>/);
    expect(요약자리, "뺀 수만 말하고 뺐다는 사실을 안 말한다").toContain("⚠ 조각 없음 ");
  });

  it("세그먼트 「전체」에 **무엇을 센 수인지**가 붙어 있다 — 두 수가 나란히 서는 자리다", () => {
    const 세그자리 = memory.slice(memory.indexOf("function renderDmSeg"), memory.indexOf("function renderDmSeg") + 900);
    expect(세그자리, "「전체」가 목록 줄 수라는 말이 없으면 위 요약과 딴말로 읽힌다").toContain("title=");
  });
});
