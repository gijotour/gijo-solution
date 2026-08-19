// 역할별 검색 정책 — [2026-08-07 · 「전문 에이전트」 논의에서 채택]
//
// 사용자 제안: RAG를 업무영역별로 여러 개 만들자(전문가마다 제 창고).
// 실측으로 물렸다 — 운영 지식이 「일반」에 2,866조각(전체의 절반) 몰려 있어 물리 분리를 하면
//   ① 그 절반이 **어느 전문가도 안 보는 고아**가 되고
//   ② 분류 오류가 곧 "영영 못 찾음"이 된다(같은 날 7B가 방화벽 메모를 취약점으로 오분류)
//   ③ 경계 문서(방화벽 정책 = 장비운영+사내규정)가 한쪽에서 사라진다
// 대신 **우선순위를 세게, 벽은 세우지 않는다.** 이 시험이 그 계약을 지킨다.
import { describe, it, expect } from "vitest";
import { applyCategoryBoost, categoryForRole, ROLE_BOOST, CATEGORY_BOOST, type FusedChunk } from "../src/engine/hybridsearch";

const 조각 = (documentId: string, category: string, rrf: number): FusedChunk =>
  ({ text: documentId, documentId, distance: 0.5, rrf, category } as unknown as FusedChunk);

describe("역할 → 우선 영역", () => {
  it("★ 전문가마다 먼저 보는 자료가 다르다", () => {
    expect(categoryForRole("scan")).toBe("취약점");
    expect(categoryForRole("ti")).toBe("위협대응");
    expect(categoryForRole("report")).toBe("사내규정");
  });
  it("★★ 「일반」 역할은 치우치지 않는다 — 미분류를 밀어 올리면 진짜 자료가 밀린다", () => {
    expect(categoryForRole("normaltic")).toBeUndefined();
    expect(categoryForRole(undefined)).toBeUndefined();
    expect(categoryForRole("없는역할")).toBeUndefined();
  });
});

describe("부스트 — 세게, 그러나 벽은 아니다", () => {
  it("★ 역할 부스트가 화면 부스트보다 세다(동률이면 전문가 자료가 이긴다)", () => {
    expect(ROLE_BOOST).toBeGreaterThan(CATEGORY_BOOST);
    const 목록 = [조각("남의영역.md", "장비운영", 0.0164), 조각("내영역.md", "취약점", 0.0150)];
    const r = applyCategoryBoost(목록, "취약점", true);
    expect(r[0].documentId, "동률에 가까우면 제 영역이 앞선다").toBe("내영역.md");
  });

  it("★★ 압도적인 다른 영역 정답은 뒤집지 못한다 — 벽이 아니라 우선순위다", () => {
    const 목록 = [조각("확실한정답.md", "사내규정", 0.16), 조각("내영역.md", "취약점", 0.0150)];
    const r = applyCategoryBoost(목록, "취약점", true);
    expect(r[0].documentId, "제 영역이라고 엉뚱한 답을 1위로 올렸다").toBe("확실한정답.md");
  });

  it("★★ 다른 영역·「일반」 자료가 목록에서 사라지지 않는다 — 물리 분리를 안 한 이유", () => {
    const 목록 = [조각("취약점.md", "취약점", 0.01), 조각("일반.md", "일반", 0.009), 조각("규정.md", "사내규정", 0.008)];
    const r = applyCategoryBoost(목록, "취약점", true);
    expect(r).toHaveLength(3);
    expect(r.map((c) => c.documentId)).toContain("일반.md");
    expect(r.map((c) => c.documentId)).toContain("규정.md");
  });

  it("역할이 없으면 예전 그대로 — 회귀 금지", () => {
    const 목록 = [조각("a.md", "취약점", 0.01), 조각("b.md", "일반", 0.009)];
    expect(applyCategoryBoost(목록, undefined)).toEqual(목록);
  });
});

// ③ 장비운영 영역 주인(2026-08-20 사장님 승인) — 주인 없는 영역이 없어야 한다
import { categoriesForRole, ROLE_CATEGORY } from "../src/engine/hybridsearch";
describe("장비운영 주인 — scan이 취약점+장비운영을 먼저 본다", () => {
  it("scan은 두 영역을 갖는다(배열 구조)", () => {
    expect(categoriesForRole("scan")).toEqual(["취약점", "장비운영"]);
  });
  it("장비운영의 주인이 존재한다 — 주인 없는 업무영역 재발 방지", () => {
    const 전영역 = Object.values(ROLE_CATEGORY).flat();
    expect(전영역).toContain("장비운영");
  });
  it("normaltic은 여전히 우선영역 없음(일반은 부스트 금지)", () => {
    expect(categoriesForRole("normaltic")).toEqual([]);
  });
});
