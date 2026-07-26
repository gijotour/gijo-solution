// 버전 비교 — 조치 검증의 판정 근거라 결정적이어야 한다(같은 입력에 늘 같은 답).
// 특히 "모르면 unknown"을 지키는지 확인한다 — 억지 판정은 오판보다 나쁘다.
import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, isFixed, extractVersion, trainOf } from "../src/engine/versioncmp";

describe("parseVersion — 형식이 제각각인 실제 버전 표기", () => {
  it("일반 3자리", () => expect(parseVersion("7.2.5")).toEqual([7, 2, 5]));
  it("Cisco IOS 괄호 표기", () => expect(parseVersion("15.2(4)M7")).toEqual([15, 2, 4, 7]));
  it("Oracle 5자리", () => expect(parseVersion("19.3.0.0.0")).toEqual([19, 3, 0, 0, 0]));
  it("OpenSSH 패치 표기", () => expect(parseVersion("9.6p1")).toEqual([9, 6, 1]));
  it("접두 v·하이픈 패치", () => expect(parseVersion("v2.4.52-p1")).toEqual([2, 4, 52, 1]));
  it("숫자가 없으면 빈 배열(비교 불가 신호)", () => expect(parseVersion("unknown")).toEqual([]));
  it("빈 값도 안전", () => expect(parseVersion("")).toEqual([]));
});

describe("compareVersions — 문자열 비교로는 틀리는 것들", () => {
  it("3.0.10 > 3.0.9 (사전순이면 반대로 나온다)", () => {
    expect(compareVersions("3.0.10", "3.0.9")).toBe(1);
  });
  it("자릿수가 달라도 0으로 채워 비교 — 7.2 == 7.2.0", () => {
    expect(compareVersions("7.2", "7.2.0")).toBe(0);
  });
  it("7.2.5 < 7.4.1", () => expect(compareVersions("7.2.5", "7.4.1")).toBe(-1));
  it("Oracle 19.3.0.0.0 < 19.21.0.0.0", () => {
    expect(compareVersions("19.3.0.0.0", "19.21.0.0.0")).toBe(-1);
  });
});

describe("trainOf — Cisco IOS 계열 문자", () => {
  it("15.2(4)M7 → M", () => expect(trainOf("15.2(4)M7")).toBe("M"));
  it("15.2(4)S → S", () => expect(trainOf("15.2(4)S")).toBe("S"));
  it("일반 버전엔 트레인 없음", () => expect(trainOf("7.2.5")).toBeNull());
});

describe("isFixed — 조치 판정", () => {
  it("고친 버전에 도달했으면 fixed", () => {
    expect(isFixed("7.4.1", "7.4.0")).toBe("fixed");
  });
  it("같은 버전이면 fixed(그 버전부터 고쳐짐)", () => {
    expect(isFixed("7.4.0", "7.4.0")).toBe("fixed");
  });
  it("못 미치면 vulnerable", () => {
    expect(isFixed("7.2.5", "7.4.0")).toBe("vulnerable");
  });
  it("10 vs 9 — 문자열 비교였다면 오판했을 자리", () => {
    expect(isFixed("3.0.10", "3.0.9")).toBe("fixed");
  });

  // 정직한 판단불가 — 이게 이 모듈의 핵심 계약이다
  it("버전을 못 읽으면 unknown(억지 판정 금지)", () => {
    expect(isFixed("unknown", "7.4.0")).toBe("unknown");
    expect(isFixed("7.4.0", "")).toBe("unknown");
  });
  it("Cisco 트레인이 다르면 unknown — 숫자가 커도 최신이 아니다", () => {
    expect(isFixed("15.2(4)S9", "15.2(4)M7")).toBe("unknown");
  });
  it("같은 트레인이면 정상 비교", () => {
    expect(isFixed("15.2(4)M9", "15.2(4)M7")).toBe("fixed");
  });
});

describe("extractVersion — 명령 출력에서 버전만 골라내기", () => {
  it("OpenSSH", () => {
    expect(extractVersion("openssh", "OpenSSH_9.6p1, OpenSSL 3.0.13 30 Jan 2024")).toBe("9.6p1");
  });
  it("Apache", () => {
    expect(extractVersion("apache", "Server version: Apache/2.4.52 (Ubuntu)")).toBe("2.4.52");
  });
  it("nginx", () => {
    expect(extractVersion("nginx", "nginx version: nginx/1.24.0")).toBe("1.24.0");
  });
  it("Cisco IOS — 괄호·트레인까지 통째로", () => {
    expect(extractVersion("cisco", "Cisco IOS Software, Version 15.2(4)M7, RELEASE SOFTWARE")).toBe("15.2(4)M7");
  });
  it("FortiOS", () => {
    expect(extractVersion("fortios", "Version: FortiGate-100F v7.2.5,build1517,230608")).toBe("7.2.5");
  });
  it("NetScaler — 두 조각을 합친다", () => {
    expect(extractVersion("netscaler", "NetScaler NS13.1: Build 37.38.nc")).toBe("13.1.37.38");
  });
  it("Oracle 5자리", () => {
    expect(extractVersion("oracle", "Oracle Database 19c ... 19.3.0.0.0")).toBe("19.3.0.0.0");
  });
  it("모르는 제품이면 일반 규칙으로 시도", () => {
    expect(extractVersion("someapp", "someapp version 1.2.3 built")).toBe("1.2.3");
  });
  it("버전이 없으면 null — 호출자는 manual로 떨어뜨린다", () => {
    expect(extractVersion("openssh", "command not found")).toBeNull();
    expect(extractVersion("apache", "")).toBeNull();
  });
});
