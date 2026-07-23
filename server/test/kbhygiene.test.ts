import { describe, it, expect, vi } from "vitest";
import { normalizeBaseName } from "../src/engine/kbhygiene";

describe("지식베이스 위생 — 이름 정규화(버전·중복 표지 제거)", () => {
  it("버전·날짜·사본·(n) 표지를 걷어 같은 계열로 묶는다", () => {
    const base = normalizeBaseName("MF2_차단로그_필드해설.txt");
    expect(normalizeBaseName("MF2_차단로그_필드해설_v2.txt")).toBe(base);
    expect(normalizeBaseName("MF2_차단로그_필드해설 (1).txt")).toBe(base);
    expect(normalizeBaseName("MF2_차단로그_필드해설_최종.txt")).toBe(base);
    expect(normalizeBaseName("MF2_차단로그_필드해설_20260723.txt")).toBe(base);
  });
  it("다른 문서는 다른 기준 이름", () => {
    expect(normalizeBaseName("방화벽_정책.txt")).not.toBe(normalizeBaseName("EDR_로그.txt"));
  });
});

// scanKbHygiene은 memory(LanceDB) 의존이 커서 여기선 순수 로직만 검증.
// 실제 탐지(중복/버전충돌/신선도)는 실환경 HTTP로 확인한다(운영 43문서에 MF2 v1/v2 실존).
