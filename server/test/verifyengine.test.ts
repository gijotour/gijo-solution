// 조치 검증 — 판정 로직을 RunFn 주입으로 고정한다(실 SSH 없이 검증 가능한 구조).
// 가장 중요한 계약: **모르면 NA**. 확인 실패를 "조치됨"으로 뭉개지 않는다.
import { describe, it, expect } from "vitest";
import {
  deriveExpected, probeFor, buildVerifyItems, runVerifyItems, summarize, extractCve,
} from "../src/engine/verifyengine";
import type { StandardFinding } from "../src/engine/bridge";
import type { RunFn } from "../src/engine/hardeningscan";
import { findingKey } from "../src/engine/approvals";

/** 명령 → 출력을 흉내내는 가짜 실행기. 매칭 안 되면 빈 출력. */
function fakeRun(map: Record<string, string>): RunFn {
  return async (cmd: string) => {
    const hit = Object.keys(map).find((k) => cmd.includes(k));
    return { code: 0, out: hit ? map[hit] : "", err: "" };
  };
}

const F = (over: Partial<StandardFinding>): StandardFinding => ({
  finding_type: "테스트", severity: "medium", evidence: "", source_tool: "test", ...over,
});

describe("deriveExpected — 스캐너 문구에서 기대 상태 읽기", () => {
  it("제목의 '< 버전'을 조치 기준으로", () => {
    const e = deriveExpected(F({ finding_type: "OpenSSH < 9.6 사용자 열거 (CVE-2024-6387)" }));
    expect(e).toEqual({ kind: "version", product: "openssh", fixedFrom: "9.6" });
  });

  it("근거의 '→ X 필요'(권고 버전)를 더 우선한다", () => {
    const e = deriveExpected(F({
      finding_type: "Apache Log4j < 2.15.0 RCE (CVE-2021-44228)",
      evidence: "경로: /opt/app/lib/log4j-core-2.11.0.jar (설치 2.11.0 → 2.12.2 필요)",
    }));
    expect(e).toEqual({ kind: "version", product: "log4j", fixedFrom: "2.12.2" });
  });

  it("인증서 만료는 cert", () => {
    expect(deriveExpected(F({ finding_type: "SSL 인증서 만료 임박" })).kind).toBe("cert");
  });

  it("평문 프로토콜은 absent(포트까지 잡는다)", () => {
    const e = deriveExpected(F({ finding_type: "Telnet 평문 서비스 사용", evidence: "포트: tcp/23" }));
    expect(e).toEqual({ kind: "absent", pattern: ":23" });
  });

  it("읽을 수 없으면 manual — 추측하지 않는다", () => {
    const e = deriveExpected(F({ finding_type: "권한 상승 가능성 있음", evidence: "동작 확인 필요" }));
    expect(e.kind).toBe("manual");
  });

  it("제품은 알지만 기준 버전을 모르면 manual + 사유에 제품명", () => {
    const e = deriveExpected(F({ finding_type: "nginx 설정 취약", evidence: "" }));
    expect(e.kind).toBe("manual");
    if (e.kind === "manual") expect(e.reason).toContain("nginx");
  });
});

describe("extractCve", () => {
  it("CVE 표기를 찾는다", () => {
    expect(extractCve("Apache Log4j < 2.15.0 RCE (CVE-2021-44228)")).toBe("CVE-2021-44228");
  });
  it("없으면 undefined", () => expect(extractCve("일반 취약점")).toBeUndefined());
});

describe("probeFor(version) — 버전 판정", () => {
  it("고쳐졌으면 PASS", async () => {
    const p = probeFor({ kind: "version", product: "openssh", fixedFrom: "9.6" });
    const r = await p(fakeRun({ "ssh -V": "OpenSSH_9.6p1, OpenSSL 3.0.13" }));
    expect(r.status).toBe("PASS");
    expect(r.evidence).toContain("조치 확인");
  });

  it("아직 낮으면 FAIL", async () => {
    const p = probeFor({ kind: "version", product: "openssh", fixedFrom: "9.6" });
    const r = await p(fakeRun({ "ssh -V": "OpenSSH_8.9p1, OpenSSL 3.0.2" }));
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("아직 취약");
  });

  it("버전을 못 읽으면 NA — 확인 실패를 조치됨으로 뭉개지 않는다", async () => {
    const p = probeFor({ kind: "version", product: "openssh", fixedFrom: "9.6" });
    const r = await p(fakeRun({ "ssh -V": "command not found" }));
    expect(r.status).toBe("NA");
    expect(r.evidence).toContain("수동 확인");
  });

  it("Cisco 트레인이 다르면 NA(숫자가 커도 최신이 아니다)", async () => {
    const p = probeFor({ kind: "version", product: "cisco", fixedFrom: "15.2(4)M7" });
    const r = await p(fakeRun({ "show version": "Cisco IOS Software, Version 15.2(4)S9, RELEASE" }));
    expect(r.status).toBe("NA");
  });
});

describe("probeFor(absent) — 서비스가 꺼졌는가", () => {
  it("아직 열려 있으면 FAIL", async () => {
    const p = probeFor({ kind: "absent", pattern: ":23" });
    const r = await p(fakeRun({ "ss -lntu": "tcp LISTEN 0 128 0.0.0.0:23 0.0.0.0:*" }));
    expect(r.status).toBe("FAIL");
  });
  it("안 보이면 PASS", async () => {
    const p = probeFor({ kind: "absent", pattern: ":23" });
    const r = await p(fakeRun({}));
    expect(r.status).toBe("PASS");
  });
});

describe("probeFor(manual) — 자동 검증 불가", () => {
  it("명령을 실행하지 않고 사유를 그대로 돌려준다", async () => {
    let called = false;
    const run: RunFn = async () => { called = true; return { code: 0, out: "", err: "" }; };
    const r = await probeFor({ kind: "manual", reason: "동작 확인이 필요합니다" })(run);
    expect(called).toBe(false);
    expect(r.status).toBe("NA");
    expect(r.evidence).toContain("동작 확인이 필요합니다");
  });
});

describe("buildVerifyItems / runVerifyItems", () => {
  const findings: StandardFinding[] = [
    F({ finding_type: "OpenSSH < 9.6 사용자 열거 (CVE-2024-6387)", key: "k-ssh", state: "active" }),
    F({ finding_type: "SSL 인증서 만료 임박", key: "k-ssl", state: "fixed" }), // 이미 조치 → 제외
    F({ finding_type: "권한 상승 가능성", key: "k-manual", state: "new" }),
  ];

  it("이미 조치된(fixed) 건은 대상에서 뺀다", () => {
    const items = buildVerifyItems("asset-1", findings);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual([findings[0].finding_type, findings[2].finding_type]);
  });

  // 승인 테이블과 같은 키를 써야 한다 — 다르면 상태가 고아 행에 쓰이고 유령 '완료'가 생긴다.
  it("findingKey는 approvals의 정식 키(sha1)와 같다", () => {
    const items = buildVerifyItems("asset-1", findings);
    expect(items[0].findingKey).toBe(findingKey("asset-1", findings[0]));
    expect(items[0].findingKey).not.toBe(findings[0].key); // 스캐너 원본 키가 아니다
  });

  it("실행 결과에 findingKey·CVE·유형이 실린다", async () => {
    const items = buildVerifyItems("asset-1", findings);
    const res = await runVerifyItems(items, fakeRun({ "ssh -V": "OpenSSH_9.6p1" }));
    expect(res[0]).toMatchObject({ findingKey: findingKey("asset-1", findings[0]), status: "PASS", cve: "CVE-2024-6387", expectedKind: "version" });
    expect(res[1]).toMatchObject({ findingKey: findingKey("asset-1", findings[2]), status: "NA", expectedKind: "manual" });
  });

  it("명령이 터져도 NA로 기록하고 계속 진행한다(조치됨으로 오해 금지)", async () => {
    const items = buildVerifyItems("asset-1", [findings[0]]);
    const boom: RunFn = async () => { throw new Error("ssh: connect timeout"); };
    const res = await runVerifyItems(items, boom);
    expect(res[0].status).toBe("NA");
    expect(res[0].evidence).toContain("실행 실패");
  });

  it("요약 집계", async () => {
    const items = buildVerifyItems("asset-1", findings);
    const res = await runVerifyItems(items, fakeRun({ "ssh -V": "OpenSSH_8.9p1" }));
    expect(summarize(res)).toEqual({ total: 2, fixed: 0, still: 1, manual: 1 });
  });
});
