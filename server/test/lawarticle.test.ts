// 조문 본문 갈래 (계획서 후-3, 2026-08-09)
//
// 왜: getLawArticles는 고쳐져 있는데 **부르는 곳이 0**이었다 — 호출부 없는 기능은 없는 기능이다.
// 담당자가 「개인정보 보호법 제29조 알려줘」라고 물으면 지금까지 **법령 목록**만 돌아왔다.
//
// ⚠ 조문 본문은 지어내면 가장 위험한 영역이다 — 받은 그대로 옮기고 원문 링크를 반드시 붙인다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 조문번호 } from "../src/engine/lawinfo";

const eng = (f: string) => fs.readFileSync(path.join(__dirname, "..", "src", "engine", f), "utf8");

describe("조문 번호 읽기", () => {
  it("★ 「제29조」·「29조」를 읽는다", () => {
    expect(조문번호("개인정보 보호법 제29조 알려줘")).toBe("29");
    expect(조문번호("29조 내용 뭐야")).toBe("29");
    expect(조문번호("제 30 조 보여줘")).toBe("30");
  });

  it("★★ 조문이 아닌 숫자는 읽지 않는다 — 「3년」·「5만 명」에 걸리면 엉뚱한 조문을 판다", () => {
    expect(조문번호("접속기록 3년 보관해야 해?")).toBeNull();
    expect(조문번호("5만 명 이상이면 어떻게 돼?")).toBeNull();
    expect(조문번호("개인정보 보호법 알려줘")).toBeNull();
  });
});

describe("배선 — 호출부가 실제로 있다(이번 결함의 본체)", () => {
  it("★★ 도구 처리기가 조문 번호를 보면 본문 답으로 간다", () => {
    const h = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agenttools", "handlers.ts"), "utf8");
    expect(h).toContain("lawArticleAnswer");
    expect(h).toContain('if (target === "law" && 조) return await lawArticleAnswer');
  });

  it("★★ 강제 분기가 조문 번호를 검색어에서 떼어 인자로 넘긴다", () => {
    // 꼬리 털기가 「조문」을 지우므로, 먼저 뽑지 않으면 「제29조」가 검색어에 남아 0건이 된다.
    const a = eng("agentloop.ts");
    expect(a).toContain("const 조 = target === \"law\" ? /제?\\s*(\\d{1,3})\\s*조/.exec(instruction)?.[1] : undefined;");
    expect(a).toContain('...(조 ? { article: 조 } : {})');
  });

  it("도구 설명에 article 인자가 있다 — 모델도 이 길을 알 수 있어야 한다", () => {
    const r = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf8");
    expect(r).toContain('name: "article"');
  });

  it("★ 본문 조회 열쇠는 LawHit.id다 — mst라는 이름에 헛짚기 쉬운 자리", () => {
    const l = eng("lawinfo.ts");
    expect(l).toContain("const mst = String(법.id ?? \"\").trim();");
  });

  it("★★ 못 찾으면 목록으로 물러나고 링크를 준다 — 빈손으로 끝내지 않는다", () => {
    const l = eng("lawinfo.ts");
    expect(l).toContain("본문을 찾지 못했습니다");
    expect(l).toContain("return lawAnswer(query, \"law\");");
  });
});
