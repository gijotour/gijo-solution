// ★ 3소스 **상관**이 실제로 걸리는가 — 제품 1차 목표의 핵심 주장.
//
// 2026-08-01 실측으로 드러난 설계 결함: 보안로그 이벤트 3종(브루트포스·방화벽·웹)이 전부
// entity에 **공격자 출발지 IP**를 넣고 있었다. 상관은 "같은 entity가 2개 이상 소스에
// 나타나면 묶는다"인데, 남의 IP가 우리 자산 이름과 같을 리 없다 —
// 즉 **로그는 취약점·운영리포트·하드닝 어느 것과도 구조적으로 절대 안 묶였다.**
// 상관분석 주석이 예로 든 "백신 재발(product) + 비정상 아웃바운드(log)가 같은 PC"조차
// 성립할 수 없었다. "통합 분석"이라 팔면서 실제로는 소스별 목록이었던 것이다.
//
// ⚠ 이 결함이 오래 안 보인 이유: **묶이지 않는 것은 화면에 아무것도 안 띄운다.**
//   에러도 0건 표시도 없고 그냥 상관 목록이 조용히 짧다. 그래서 시험으로 못 박는다.
import { describe, it, expect, beforeEach } from "vitest";
import { parseSecurityLog, computeCorrelations, type AnalysisEvent } from "../src/engine/analysishub";

/** 우리 장비(fw01)를 노린 공격 로그 — syslog 형식이라 4번째 토큰이 우리 호스트다. */
const 로그 = Array.from({ length: 14 }, (_, i) =>
  `Aug  1 11:0${i % 6}:0${i % 6} fw01 sshd[${2200 + i}]: Failed password for invalid user admin from 198.51.100.77 port ${52000 + i} ssh2`
).join("\n");

const 취약점이벤트 = (entity: string): AnalysisEvent => ({
  id: `vuln:${entity}:openssh`, source: "vuln", title: "OpenSSH 취약점", entity,
  severity: "high", priority: "P1", detail: "", signals: [], aiSummary: "", ref: entity, at: Date.now(),
});

describe("★ 로그가 우리 자산과 묶인다", () => {
  let 로그이벤트: AnalysisEvent[];
  beforeEach(() => { 로그이벤트 = parseSecurityLog("secure.log", 로그).events; });

  it("로그 이벤트가 만들어진다", () => {
    expect(로그이벤트.length, "로그를 못 읽으면 나머지 시험이 무의미하다").toBeGreaterThan(0);
  });

  it("주인공은 여전히 **공격자**다 (화면 제목이 그렇게 읽힌다)", () => {
    expect(로그이벤트[0].entity).toBe("198.51.100.77");
    expect(로그이벤트[0].title).toContain("198.51.100.77");
  });

  it("★ 그런데 **우리 대상 호스트**도 함께 지닌다 — 상관의 유일한 끈", () => {
    expect(로그이벤트[0].peers, "대상 호스트를 안 실으면 어느 소스와도 못 묶인다").toContain("fw01");
  });

  it("★★ 취약점 + 로그가 **같은 장비**로 묶인다", () => {
    const 상관 = computeCorrelations([...로그이벤트, 취약점이벤트("fw01")]);
    const 묶임 = 상관.find((c) => c.entity.toLowerCase() === "fw01");
    expect(묶임, "취약점과 로그가 같은 장비인데 안 묶였다 — '통합 분석'이 성립하지 않는다").toBeTruthy();
    expect(묶임!.sources.sort()).toEqual(["log", "vuln"]);
    expect(묶임!.note).toContain("fw01");
  });

  it("남의 장비까지 끌어다 묶지 않는다", () => {
    const 상관 = computeCorrelations([...로그이벤트, 취약점이벤트("web99")]);
    expect(상관.some((c) => c.sources.includes("log") && c.sources.includes("vuln")),
      "관계없는 자산을 묶었다 — 틀린 상관은 못 묶는 것보다 나쁘다").toBe(false);
  });

  it("★ 대상을 못 뽑으면 **지어내지 않는다**", () => {
    // syslog 형식이 아니면 우리 호스트를 알 수 없다. 그때 아무 자산에나 붙이면 오탐이 된다.
    const 형식없음 = Array.from({ length: 14 }, () =>
      "Failed password for invalid user admin from 198.51.100.77").join("\n");
    const evs = parseSecurityLog("무형식", 형식없음).events;
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].peers ?? [], "출처를 모르는데 대상을 지어냈다").toEqual([]);
  });

  it("한 묶음이 두 번 나오지 않는다 (entity·peers 양쪽에서 잡혀도)", () => {
    const 상관 = computeCorrelations([...로그이벤트, 취약점이벤트("fw01")]);
    const 지문 = 상관.map((c) => c.eventIds.slice().sort().join("|"));
    expect(new Set(지문).size, "같은 묶음이 중복으로 실렸다").toBe(지문.length);
  });
});
