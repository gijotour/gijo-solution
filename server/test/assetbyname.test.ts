// 자산을 **이름으로도** 찾는가.
//
// 왜 필요한가: 2026-08-03부터 담당자에게 보여 주는 글자를 내부 id에서 **이름**으로 바꿨다
//   (말투 규범 — `vuln:sample-web01`은 사람이 읽는 글자가 아니다).
//   그런데 조회가 id로만 되면, 화면에서 본 이름으로 물었을 때 "찾을 수 없습니다"가 된다 —
//   **보여 주는 글자와 찾을 수 있는 글자가 달라지는** 것이고, 그게 제일 나쁜 종류의 불일치다.
import { describe, it, expect, beforeEach } from "vitest";
import { getAsset, registerAsset, resetAssetsForTests } from "../src/engine/assets";

beforeEach(() => resetAssetsForTests());

describe("자산 조회 — 보여 준 글자로 찾을 수 있다", () => {
  it("이름으로 찾는다", () => {
    registerAsset({ id: "vuln:sample-web01", name: "샘플-웹서버", path: "-" });
    expect(getAsset("샘플-웹서버")?.id, "이름으로 못 찾는다").toBe("vuln:sample-web01");
  });

  it("내부 표식을 뗀 id로도 찾는다 — 사람이 그렇게 옮겨 적는다", () => {
    registerAsset({ id: "vuln:sample-web01", name: "샘플-웹서버", path: "-" });
    expect(getAsset("sample-web01")?.id).toBe("vuln:sample-web01");
  });

  it("본래 id는 당연히 그대로 찾는다(회귀)", () => {
    registerAsset({ id: "fds-fraud-llm", name: "이상거래 탐지 AI(FDS)", path: "-" });
    expect(getAsset("fds-fraud-llm")?.name).toBe("이상거래 탐지 AI(FDS)");
  });

  it("없는 것은 없다고 한다 — 아무거나 집어 오지 않는다", () => {
    registerAsset({ id: "a-01", name: "가나다", path: "-" });
    expect(getAsset("존재하지않는것xyz")).toBeUndefined();
    expect(getAsset("")).toBeUndefined();
  });
});

describe("이름이 정확히 안 맞을 때", () => {
  it("딱 하나만 걸리면 이어 준다", () => {
    // 실측(2026-08-03): 목록에는 "샘플-웹서버"로 보이는데 실제 이름은 "샘플-웹서버 (10.0.0.100)"이었다.
    registerAsset({ id: "vuln:sample-web01", name: "샘플-웹서버 (10.0.0.100)", path: "-" });
    registerAsset({ id: "other-01", name: "전혀 다른 것", path: "-" });
    expect(getAsset("샘플-웹서버")?.id).toBe("vuln:sample-web01");
  });

  it("★ 여럿이 걸리면 **고르지 않는다** — 엉뚱한 자산을 집는 것이 못 찾는 것보다 나쁘다", () => {
    registerAsset({ id: "w1", name: "웹서버 A", path: "-" });
    registerAsset({ id: "w2", name: "웹서버 B", path: "-" });
    expect(getAsset("웹서버"), "둘 중 하나를 임의로 집었다").toBeUndefined();
  });
});
