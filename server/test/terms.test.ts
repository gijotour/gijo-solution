import { describe, it, expect } from "vitest";
import { canonicalize, aliasHitsIn, suggestionsFor } from "../src/engine/terms";

// 2026-07-26 실사용 사고: "보안장비 리스트"가 0건 → 챗봇이 "존재하지 않습니다"로 단정.
// 실제로는 보안제품 3건이 등록돼 있었다.
describe("terms — 같은 것을 가리키는 다른 말", () => {
  it("담당자가 쓰는 말을 제품 표준 말로 바꾼다", () => {
    expect(canonicalize("보안장비 리스트")).toBe("보안제품 리스트");
    expect(canonicalize("보안 장비 목록 보여줘")).toContain("보안제품");
    expect(canonicalize("보안솔루션 뭐 있어?")).toContain("보안제품");
    expect(canonicalize("내부문서 찾아줘")).toContain("사내문서");
  });

  it("바꿀 게 없으면 원문 그대로 둔다", () => {
    expect(canonicalize("보안제품 리스트")).toBe("보안제품 리스트");
    expect(canonicalize("CVE-2021-44228 알려줘")).toBe("CVE-2021-44228 알려줘");
  });

  it("어떤 말을 썼는지 짚어 되물음 후보를 만든다", () => {
    const hits = aliasHitsIn("보안장비 리스트");
    expect(hits).toHaveLength(1);
    expect(hits[0].canonical).toBe("보안제품");
    expect(hits[0].hint).toContain("보안제품");
  });

  it("표준 말로 물었는데 0건이어도 후보를 준다", () => {
    expect(suggestionsFor("보안제품 리스트").map((c) => c.canonical)).toContain("보안제품");
  });

  it("관련 없는 말에는 억지 후보를 만들지 않는다", () => {
    expect(suggestionsFor("어제 날씨")).toHaveLength(0);
  });
});
