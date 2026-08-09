// 잘못 부른 요청은 **조용히 받아 주지 않는다** (2026-08-09, 계획서 중-3).
//
// ■ 무슨 일이 있었나 — 하루에 네 번
//   본문 키를 추측해서 보냈다가 매번 속았다. 결정적인 건 **틀린 요청이 200을 돌려준 것**이다:
//     POST /api/dispatch  {instruction: "..."}   → 200 + "무엇을 도와드릴까요?" 안내
//   text가 비어 있으니 제품은 "빈 지시"로 보고 안내를 냈는데, 부르는 쪽에는 그게
//   **"제품이 답을 못 한다"**로 보였다. 없는 결함을 보고할 뻔했고, 하나는 문서에 박혀
//   다음 날 수리의 틀린 전제가 됐다.
//
// ■ 그래서 무엇을 지키나
//   빈 지시는 **사람이 보낸 것이 아니라 부르는 쪽이 틀린 것**이다. 400으로 거절하고
//   기대하는 본문 모양을 함께 알려 준다. 그럴듯한 200이 오류를 감추는 것보다 낫다.
//   ⚠ 두 입구(/api/dispatch·/api/dispatch/stream) 모두 — 한 곳만 막으면 다른 길로 샌다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");

describe("빈 지시는 400으로 거절한다", () => {
  it("★ 두 입구 모두에 빈 지시 관문이 있다", () => {
    // 갈래마다 심는 구조는 새 갈래가 생기는 순간 조용히 샌다 — 개수를 못 박는다.
    const 관문 = (src.match(/지시 내용이 비어 있습니다/g) ?? []).length;
    expect(관문, "/api/dispatch 와 /api/dispatch/stream 둘 다").toBe(2);
  });

  it("★★ 400과 함께 **기대하는 본문 모양**을 알려 준다 — 다음 사람이 또 추측하지 않게", () => {
    expect(src).toContain('res.status(400)');
    expect(src, "expected 필드로 키 이름을 알려 준다").toMatch(/expected:\s*\{\s*text:/);
  });

  it("관문이 text를 읽은 **뒤**에 온다 — 앞이면 항상 비어 있다", () => {
    for (const 조각 of src.split('const text = String(req.body?.text ?? "");').slice(1)) {
      expect(조각.slice(0, 800), "text 읽은 직후에 빈 값 검사가 온다").toContain("지시 내용이 비어 있습니다");
    }
  });
});

describe("측정 도구가 쓰는 본문 키는 라우트와 일치한다 (소스 대조)", () => {
  // 추측이 아니라 **라우트에서 읽은 키**로 부르는지 대조한다. 오늘 실수 4건 중 2건이
  // 여기서 갈렸다: /api/dispatch→text, /api/memory/query→question.
  const 라우트키 = (파일: string, 경로: string): string[] => {
    const s = fs.readFileSync(path.join(__dirname, "..", "src", "engine", 파일), "utf8");
    const i = s.indexOf(`"${경로}"`);
    if (i < 0) return [];
    return [...s.slice(i, i + 3000).matchAll(/req\.body\??\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
  };

  it("★ /api/dispatch 는 text 를 읽는다 — instruction 이 아니다", () => {
    const keys = 라우트키("dispatcher.ts", "/api/dispatch");
    expect(keys.length, "라우트를 못 찾았으면 이 시험이 헛돌고 있다").toBeGreaterThan(0);
    expect(keys).toContain("text");
    expect(keys).not.toContain("instruction");
  });

  it("★ /api/memory/query 는 question 을 읽는다 — query 가 아니다", () => {
    const keys = 라우트키("memory.ts", "/api/memory/query");
    expect(keys.length, "라우트를 못 찾았으면 이 시험이 헛돌고 있다").toBeGreaterThan(0);
    expect(keys).toContain("question");
    expect(keys).not.toContain("query");
  });
});
