// 통합 보안 분석 허브 — 3소스 정규화·우선순위·상관분석(결정적 파서).
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSecurityLog,
  parseProductReport,
  computePriority,
  computeCorrelations,
  detectIngestKind,
  resetAnalysisHubForTests,
  AnalysisEvent,
} from "../src/engine/analysishub";

beforeEach(() => resetAnalysisHubForTests());

describe("computePriority", () => {
  it("critical + KEV = P0", () => {
    expect(computePriority("critical", ["KEV"])).toBe("P0");
  });
  it("high 단독 = P1, high + 신호 = P0", () => {
    expect(computePriority("high", [])).toBe("P1");
    expect(computePriority("high", ["브루트포스", "활성 악용"])).toBe("P0");
  });
  it("medium 단독 = P2", () => {
    expect(computePriority("medium", [])).toBe("P2");
  });
});

describe("parseSecurityLog — 인증 브루트포스", () => {
  const bruteLog = [
    ...Array.from({ length: 12 }, () => "Jul 18 03:11:01 web01 sshd[1]: Failed password for root from 203.0.113.5 port 22 ssh2"),
    "Jul 18 03:12:00 web01 sshd[1]: Failed password for admin from 10.0.0.9 port 22 ssh2", // 1회 — 임계치 미만
  ].join("\n");

  it("임계치 초과 IP를 브루트포스로 탐지(성공 없으면 high)", () => {
    const r = parseSecurityLog("방화벽로그", bruteLog);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].entity).toBe("203.0.113.5");
    expect(r.events[0].severity).toBe("high");
    expect(r.events[0].signals).toContain("브루트포스");
  });

  it("실패 다발 후 성공 로그가 있으면 critical + 활성 악용", () => {
    const withSuccess = bruteLog + "\nJul 18 03:13:00 web01 sshd[1]: Accepted password for root from 203.0.113.5 port 22 ssh2";
    const r = parseSecurityLog("방화벽로그", withSuccess);
    expect(r.events[0].severity).toBe("critical");
    expect(r.events[0].signals).toContain("활성 악용");
    expect(r.events[0].priority).toBe("P0");
  });

  it("임계치 미만은 이벤트를 만들지 않는다", () => {
    const r = parseSecurityLog("로그", "Failed password for x from 1.2.3.4 port 22 ssh2");
    expect(r.events).toHaveLength(0);
  });
});

describe("parseProductReport — 운영 리포트", () => {
  const dlpReport = [
    "일시,사용자,행위,대상",
    "2026-07-18,홍길동,개인정보 유출 차단,mail",
    "2026-07-18,김철수,유출 시도 차단,mail",
    "2026-07-18,홍길동,유출 차단,usb",
  ].join("\n");

  it("키워드별 건수를 뽑고 요약 이벤트를 만든다", () => {
    const r = parseProductReport("DLP", dlpReport);
    expect(r.counts["유출"]).toBeGreaterThan(0);
    const summary = r.events.find((e) => e.title.includes("운영 리포트"));
    expect(summary).toBeTruthy();
    expect(summary!.signals).toContain("유출");
  });

  it("동일 대상(PC) 반복 등장 시 개별 이벤트(반복 신호)", () => {
    const avReport = ["PC-0417 격리 malware.exe", "PC-0417 격리 trojan.dll", "PC-1000 격리 x.exe"].join("\n");
    const r = parseProductReport("백신", avReport);
    const repeat = r.events.find((e) => e.entity === "PC-0417");
    expect(repeat).toBeTruthy();
    expect(repeat!.signals).toContain("반복");
  });
});

describe("detectIngestKind — 드롭존 자동 판별", () => {
  it("syslog/auth 시그니처는 로그로", () => {
    expect(detectIngestKind("auth.log", "Failed password for root from 1.2.3.4")).toBe("log");
    expect(detectIngestKind("x.txt", "Jul 18 sshd[1]: authentication failure")).toBe("log");
  });
  it("CSV 운영 리포트는 리포트로", () => {
    expect(detectIngestKind("dlp-2026.csv", "일시,사용자,행위\n2026,홍길동,유출 차단")).toBe("report");
  });
});

describe("computeCorrelations — 소스 간 상관", () => {
  it("같은 entity가 2개 소스에 있으면 상관으로 묶는다", () => {
    const events: AnalysisEvent[] = [
      { id: "log:x:PC-0417", source: "log", title: "비정상 아웃바운드", entity: "PC-0417", severity: "high", priority: "P1", detail: "", signals: [], aiSummary: "", ref: "", at: 1 },
      { id: "product:av:PC-0417", source: "product", title: "반복 탐지", entity: "PC-0417", severity: "high", priority: "P1", detail: "", signals: ["반복"], aiSummary: "", ref: "", at: 2 },
      { id: "vuln:a:x", source: "vuln", title: "Log4j", entity: "web01", severity: "critical", priority: "P0", detail: "", signals: ["KEV"], aiSummary: "", ref: "", at: 3 },
    ];
    const corr = computeCorrelations(events);
    expect(corr).toHaveLength(1);
    expect(corr[0].entity).toBe("PC-0417");
    expect(corr[0].sources.sort()).toEqual(["log", "product"]);
  });

  it("단일 소스만 있는 entity는 상관에서 제외", () => {
    const events: AnalysisEvent[] = [
      { id: "vuln:a:x", source: "vuln", title: "Log4j", entity: "web01", severity: "critical", priority: "P0", detail: "", signals: [], aiSummary: "", ref: "", at: 1 },
    ];
    expect(computeCorrelations(events)).toHaveLength(0);
  });
});
