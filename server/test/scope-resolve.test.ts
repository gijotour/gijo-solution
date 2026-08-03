// 복합 지시의 **대상 범위**를 지시문에서 제대로 읽는가.
//
// 실측(2026-08-03 평가 게이트): "sample-web01 스캔하고 결과 리포트까지 만들어줘"가
//   대상을 못 찾아 **전체 자산(57개)**으로 번졌다 — 실제 id가 `vuln:sample-web01`이라
//   `text.includes(a.id)`가 글자 그대로는 안 걸렸기 때문이다.
//   그래서 **43초면 될 일이 190초**가 됐고, 게이트는 이 문항을
//   **5판 연속 「측정 못 함」**으로 버렸다(30초 넘어 리포트로 전환).
//   못 재는 문항이 하나 있으면 그 자리에 진짜 회귀가 숨어도 안 보인다.
//
// ⚠ 담당자가 화면에서 보는 글자는 **이름**이다. 내부 키(`vuln:`)를 그대로 칠 이유가 없다.
import { describe, it, expect, beforeEach } from "vitest";
import { planInstruction } from "../src/engine/dispatcher";
import { registerAsset, resetAssetsForTests } from "../src/engine/assets";

beforeEach(() => {
  resetAssetsForTests();
  registerAsset({ id: "vuln:sample-web01", name: "샘플-웹서버 (10.0.0.100)", path: "-" });
  registerAsset({ id: "fds-fraud-llm", name: "이상거래 탐지 AI(FDS)", path: "-" });
});

const 범위 = (t: string) => (planInstruction(t)[0] as { scope?: { type: string; assetId?: string } })?.scope;

describe("★ 지목한 자산 하나만 본다 — 전체로 번지지 않는다", () => {
  it("내부 표식을 뗀 이름으로 지목해도 찾는다", () => {
    const s = 범위("sample-web01 스캔하고 결과 리포트까지 만들어줘");
    expect(s?.type, "대상을 못 찾아 전체 자산으로 번진다 — 43초 일이 190초가 된다").toBe("asset");
    expect(s?.assetId).toBe("vuln:sample-web01");
  });

  it("본래 id로 지목해도 찾는다(회귀)", () => {
    expect(범위("vuln:sample-web01 스캔해줘")?.assetId).toBe("vuln:sample-web01");
  });

  it("이름으로 지목해도 찾는다", () => {
    expect(범위("이상거래 탐지 AI(FDS) 스캔해줘")?.assetId).toBe("fds-fraud-llm");
  });
});

describe("★ 안 지목했으면 전체가 맞다 — 함부로 좁히지 않는다", () => {
  it("대상 없는 지시는 전체 자산", () => {
    expect(범위("전체 스캔하고 리포트 만들어줘")?.type).toBe("all-assets");
  });

  it("CTI 영향 자산은 그쪽으로", () => {
    expect(범위("CTI 영향 자산 스캔해줘")?.type).toBe("cti-affected");
  });

  it("이 시험이 헛돌고 있지 않다", () => {
    // 표식 벗기기가 죽으면 첫 시험이 실패해야 한다 — 긍정 대조를 한 번 더 둔다.
    expect(범위("sample-web01 스캔해줘")?.type, "벗기기가 죽었다").toBe("asset");
  });
});
