// 📨 조치 요청서 라벨 — **화면 사본이 서버 원천과 글자까지 같은가**(2026-08-31)
//
// 왜 시험으로 못 박나: 화면(mydocs.html)은 브라우저에서 도는 순수 HTML이라 서버 TS를
// import할 수 없어 라벨을 **사본**으로 들고 있다. 1차본이 「회신 옴·미회신」으로 적어 놓고
// 주석에는 「서버 원천과 같은 값」이라 써 두어, 대화창(「회신·무응답」)과 화면이 서로 다른
// 말을 했다 — 검토관 2갈래가 동시에 잡았다. 「같은 것을 여러 곳에 적으면 어긋난다」의 전형.
// 사본을 없앨 수 없으면(브라우저 제약) **어긋남을 기계가 잡게** 한다(「세 번째면 소스 감시」).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIND_KO, STATUS_KO } from "../src/engine/remrequest.js";

const 화면 = readFileSync(
  join(__dirname, "..", "..", "client", "src", "renderer", "pages", "mydocs.html"),
  "utf8",
);

const RAW_PAIR = String.raw`["']?([\w-]+)["']?\s*:\s*"([^"]*)"`;

/** `var 이름 = { a: "가", b: "나" };` 한 줄에서 사전을 읽는다(그 화면이 쓰는 꼴 그대로). */
function 사전읽기(변수: string): Record<string, string> {
  const m = 화면.match(new RegExp("var\\s+" + 변수 + "\\s*=\\s*\\{([^}]*)\\}"));
  expect(m, `mydocs.html에 ${변수} 사전이 없다 — 판이 지워졌으면 이 시험도 함께 지울 것`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const 쌍 of (m as RegExpMatchArray)[1].split(",")) {
    const kv = 쌍.match(new RegExp(RAW_PAIR));
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

describe("📨 조치 요청서 라벨은 서버 원천 하나에서 온다", () => {
  it("상태 라벨(상태글)이 STATUS_KO와 글자까지 같다", () => {
    const 사본 = 사전읽기("상태글");
    for (const [k, v] of Object.entries(STATUS_KO)) {
      expect(사본[k], `상태 ${k}: 화면 「${사본[k]}」 ≠ 서버 「${v}」`).toBe(v);
    }
    expect(Object.keys(사본).sort(), "화면에만 있는 상태가 있다").toEqual(Object.keys(STATUS_KO).sort());
  });

  it("종류 라벨(종류글)이 KIND_KO와 글자까지 같다", () => {
    const 사본 = 사전읽기("종류글");
    for (const [k, v] of Object.entries(KIND_KO)) {
      expect(사본[k], `종류 ${k}: 화면 「${사본[k]}」 ≠ 서버 「${v}」`).toBe(v);
    }
    expect(Object.keys(사본).sort(), "화면에만 있는 종류가 있다").toEqual(Object.keys(KIND_KO).sort());
  });

  it("판은 보기 전용이라 줄이 클릭을 안 받는다(.noclick)", () => {
    // 안 붙이면 클릭이 일반 행 처리기로 흘러 **빈 문서창**이 뜬다(2026-08-22 vendor 탭 전례).
    const i = 화면.indexOf('data-req="');
    expect(i, "req 줄 마크업이 없다").toBeGreaterThan(-1);
    expect(화면.slice(Math.max(0, i - 200), i), "req 줄에 .noclick이 없다").toContain("noclick");
  });
});
