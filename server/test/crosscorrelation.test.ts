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

// ── 국내 보안장비 형식 (계획서 전 단계, 파일럿 대비) ─────────────────────────
//
// ⚠ **없는 형식을 지어내지 않았다.** 국내 보안장비(안랩·시큐아이·윈스 등)는 대개
//   CEF(ArcSight) · LEEF(IBM) · key=value 로 syslog를 보낸다 — 공개된 표준 형식이다.
//   그 줄에는 syslog 호스트 이름이 없어서, dst= 를 못 뽑으면 우리 자산과 이어지지 않는다.
describe("★ CEF·LEEF 형식에서도 우리 자산과 이어진다", () => {
  const 반복 = (line: (i: number) => string, n = 40) => Array.from({ length: n }, (_, i) => line(i)).join("\n");

  it("CEF 차단 로그 — dst가 상관 키가 된다", () => {
    const cef = 반복((i) =>
      `CEF:0|AhnLab|TrusGuard|3.0|1001|Blocked|7|src=203.0.113.9 dst=10.0.0.5 dpt=${445 + i} act=deny`);
    const evs = parseSecurityLog("trusguard.log", cef).events;
    expect(evs.length, "CEF 차단 로그를 못 읽는다").toBeGreaterThan(0);
    expect(evs[0].entity, "주인공은 공격자여야 한다").toBe("203.0.113.9");
    expect(evs[0].peers, "dst(우리 자산)를 안 뽑으면 어느 소스와도 안 묶인다").toContain("10.0.0.5");
  });

  it("LEEF 차단 로그도 같다", () => {
    const leef = 반복((i) =>
      `LEEF:2.0|SECUI|MF2|4.0|3001|src=198.51.100.7|dst=10.0.0.9|dstPort=${1000 + i}|action=DENY`);
    const evs = parseSecurityLog("secui.log", leef).events;
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].peers).toContain("10.0.0.9");
  });

  it("iptables 형식(DST=)도 같다", () => {
    const ipt = 반복((i) =>
      `Aug  1 11:00:0${i % 10} gw01 kernel: [UFW BLOCK] IN=eth0 SRC=203.0.113.50 DST=10.0.0.12 PROTO=TCP DPT=${2000 + i}`);
    const evs = parseSecurityLog("ufw.log", ipt).events;
    expect(evs.length).toBeGreaterThan(0);
    // syslog 호스트(gw01)와 DST(10.0.0.12) 둘 다 실린다 — 어느 쪽 이름으로 등록돼 있어도 이어진다.
    expect(evs[0].peers).toEqual(expect.arrayContaining(["gw01", "10.0.0.12"]));
  });

  it("★ 목적지가 없으면 **지어내지 않는다**", () => {
    const 목적지없음 = 반복((i) => `CEF:0|X|Y|1|1|Blocked|5|src=203.0.113.9 dpt=${500 + i} act=deny`);
    const evs = parseSecurityLog("noDst.log", 목적지없음).events;
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].peers ?? [], "목적지를 모르는데 만들어 냈다").toEqual([]);
  });

  it("★★ CEF 로그 + 그 자산의 취약점이 묶인다", () => {
    const cef = 반복((i) =>
      `CEF:0|AhnLab|TrusGuard|3.0|1001|Blocked|7|src=203.0.113.9 dst=10.0.0.5 dpt=${445 + i} act=deny`);
    const 상관 = computeCorrelations([...parseSecurityLog("trusguard.log", cef).events, 취약점이벤트("10.0.0.5")]);
    const 묶임 = 상관.find((c) => c.entity === "10.0.0.5");
    expect(묶임, "국내 장비 로그가 취약점과 안 묶인다 — 파일럿에서 통합 분석이 안 보인다").toBeTruthy();
    expect(묶임!.sources.sort()).toEqual(["log", "vuln"]);
  });
});

// ── 검토 지적 수정 확인 (2026-08-01 오후 검토) ──────────────────────────────
describe("★ 검토가 짚은 사각지대", () => {
  const 반복 = (f: (i: number) => string, n = 14) => Array.from({ length: n }, (_, i) => f(i)).join("\n");

  it("★★ 여러 장비를 한 파일로 올려도 **엉뚱한 장비에 안 붙는다**", () => {
    // 파일 전체의 top-1 호스트를 모든 이벤트에 붙이던 것이 결함이었다 —
    // 파일럿에서 가장 흔한 형태(중앙 수집기 로그)에서 web01 공격이 fw01에 귀속됐다.
    const 섞임 = [
      반복((i) => `Aug  1 10:0${i % 6}:0${i % 6} fw01 sshd[${100 + i}]: Failed password for invalid user a from 203.0.113.1 port ${1000 + i} ssh2`, 20),
      반복((i) => `Aug  1 10:0${i % 6}:0${i % 6} web01 sshd[${200 + i}]: Failed password for invalid user b from 198.51.100.2 port ${2000 + i} ssh2`, 14),
    ].join("\n");
    const evs = parseSecurityLog("수집기.log", 섞임).events;
    const a = evs.find((e) => e.entity === "203.0.113.1");
    const b2 = evs.find((e) => e.entity === "198.51.100.2");
    expect(a?.peers, "fw01을 노린 공격의 대상이 틀렸다").toEqual(["fw01"]);
    expect(b2?.peers, "web01을 노린 공격이 fw01에 귀속됐다 — 담당자가 엉뚱한 장비를 조사한다").toEqual(["web01"]);
  });

  it("★ 호스트 필드가 없으면 프로그램 이름을 자산으로 삼지 않는다", () => {
    // "Aug  1 11:00:01 sshd[1234]: …" 처럼 호스트가 빠진 줄에서 sshd[1234]:를 우리 자산으로
    // 둔갑시키면 안 된다. 용어사전에 "못 알아내면 지어내지 않는다"고 공표한 계약이다.
    const 호스트없음 = 반복((i) => `Aug  1 11:0${i % 6}:0${i % 6} sshd[${300 + i}]: Failed password for invalid user c from 203.0.113.9 port ${3000 + i} ssh2`);
    const evs = parseSecurityLog("호스트없음.log", 호스트없음).events;
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].peers ?? [], "프로그램 이름을 우리 자산으로 지어냈다").toEqual([]);
  });

  it("★★ 공격 경로도 로그를 자산에 잇는다 (상관만 고치고 형제 함수를 빠뜨렸던 것)", async () => {
    const { computeAttackPaths } = await import("../src/engine/analysishub");
    const 로그ev = parseSecurityLog("경로.log", 로그).events; // fw01을 노린 브루트포스
    const paths = computeAttackPaths([...로그ev, 취약점이벤트("fw01")]);
    const p = paths.find((x) => x.entity === "fw01");
    expect(p, "취약 자산 경로가 안 나온다").toBeTruthy();
    expect(p!.steps.some((s) => s.kind === "entry"), "①진입(로그) 단계가 빠졌다 — 공격 신호가 있는데 없는 것처럼 보인다").toBe(true);
    expect(p!.reachability, "실제 공격 신호가 있는데 도달성이 「확인됨」이 아니다").toBe("확인됨");
  });
});
