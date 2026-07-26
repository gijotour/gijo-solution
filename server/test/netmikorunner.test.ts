// 네트워크 장비 어댑터 — 장비 식별과 "실패를 성공으로 오해하지 않기"를 검사한다.
// ⚠ 실장비 연결은 여기서 검증할 수 없다(대상 장비 없음). 브리지가 없거나 죽었을 때의
//   행동만이라도 못 박아 둔다 — 그게 가장 위험한 경로이기 때문이다.
import { describe, it, expect } from "vitest";
import { deviceTypeOf, netmikoRunnerFor, netmikoRunner } from "../src/engine/netmikorunner";
import type { HardeningTarget } from "../src/engine/hardeningscan";

const T = (over: Partial<HardeningTarget>): HardeningTarget => ({
  id: "t1", label: "장비", host: "10.0.0.1", port: 22, authMethod: "password", secret: "x", username: "admin", ...over,
});

describe("deviceTypeOf — 라벨·호스트로 장비 종류 추정", () => {
  it("Cisco IOS", () => expect(deviceTypeOf(T({ label: "Cisco 라우터" }))).toBe("cisco_ios"));
  it("Nexus", () => expect(deviceTypeOf(T({ label: "nexus-core" }))).toBe("cisco_nxos"));
  it("ASA", () => expect(deviceTypeOf(T({ label: "ASA 방화벽" }))).toBe("cisco_asa"));
  it("Juniper", () => expect(deviceTypeOf(T({ label: "juniper-edge" }))).toBe("juniper_junos"));
  it("FortiGate", () => expect(deviceTypeOf(T({ label: "fortigate-vpn-01" }))).toBe("fortinet"));
  it("Palo Alto", () => expect(deviceTypeOf(T({ label: "palo-fw" }))).toBe("paloalto_panos"));
  it("모르는 장비는 null — 기존 SSH로 가게 둔다(억지로 넘기지 않는다)", () => {
    expect(deviceTypeOf(T({ label: "웹서버-01", host: "10.0.0.9" }))).toBeNull();
  });
});

describe("netmikoRunnerFor — 실행기 선택", () => {
  it("장비면 Netmiko 실행기를 준다", () => {
    expect(netmikoRunnerFor(T({ label: "cisco-core" }))).toBeTypeOf("function");
  });
  it("일반 서버면 null(호출자가 기존 SSH를 쓴다)", () => {
    expect(netmikoRunnerFor(T({ label: "리눅스서버" }))).toBeNull();
  });
  it("local 대상은 null", () => {
    expect(netmikoRunnerFor(T({ label: "cisco", host: "local", authMethod: "local" }))).toBeNull();
  });
});

describe("실패 처리 — 가장 위험한 경로", () => {
  it("브리지를 못 돌리면 code≠0과 사유를 준다 — 빈 성공을 주면 상위가 '이상 없음'으로 오해한다", async () => {
    // 존재하지 않는 파이썬 경로로 강제 실패시킨다(실장비 없이 검사 가능한 지점).
    const prev = process.env.GIJO_PYTHON;
    process.env.GIJO_PYTHON = "gijo-no-such-python";
    try {
      // 모듈이 env를 로드 시점에 읽으므로 새로 import 한다.
      const mod = await import(`../src/engine/netmikorunner?ts=${Date.now()}`) as typeof import("../src/engine/netmikorunner");
      const run = mod.netmikoRunner(T({ label: "cisco-core" }), "cisco_ios");
      const r = await run("show version");
      expect(r.code).not.toBe(0);
      expect(r.out).toBe("");
      expect(r.err.length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.GIJO_PYTHON; else process.env.GIJO_PYTHON = prev;
    }
  });
});
