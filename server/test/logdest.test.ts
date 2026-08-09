// test/logdest.test.ts — 계획서 전-1(분석 허브: 3소스 상관)
//
// ⚠ 왜 이 시험이 있나(2026-08-10 실측): 「소스 겹침 0건」이라고 여러 번 적었는데,
//   실제로는 **1건이 잡히고 있었다**(10.10.20.41 — Zerologon 취약점 + 브루트포스 표적).
//   내가 `entity`만 세고 `peers`를 안 봐서 난 오판이다. 제품은 멀쩡했다.
//
//   다만 파고들다 **진짜 결함**이 나왔다: 방화벽 탐지기는 `dst=`(목적지)를 뽑는데
//   **인증 브루트포스 탐지기는 안 뽑았다.** 전통 syslog 형식의 호스트 이름만 봤는데,
//   국내 보안장비는 대개 CEF/LEEF·key=value로 보낸다 — 그 줄에는 호스트 이름이 없다.
//   → 같은 파일 안에서 한 탐지기는 우리 자산을 찾고 다른 탐지기는 못 찾았다.
//
// ⚠ 상관은 **목적지(우리 자산)**로만 이어진다. 출발지는 남의 IP라 영영 안 겹친다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseSecurityLog, computeCorrelations, 목적지IP } from "../src/engine/analysishub";

// ⚠ `act=deny`를 일부러 뺐다 — 넣으면 방화벽 탐지기도 같은 줄을 잡아 **한 줄이 두 번 세어진다**
//   (2026-08-10 확인: matchedLines가 14 대신 28). 그건 별개 사안이라 여기서 섞지 않는다.
const CEF인증실패 = (src: string, dst: string, n: number) =>
  Array.from({ length: n }, () =>
    `CEF:0|AhnLab|TrusGuard|1.0|100|auth failure|5|src=${src} dst=${dst} dpt=22 msg=login failure for root`,
  );

const SYSLOG인증실패 = (src: string, host: string, n: number) =>
  Array.from({ length: n }, () => `Aug  1 10:00:01 ${host} sshd[1234]: Failed password for root from ${src} port 52134 ssh2`);

describe("보안로그에서 **목적지(우리 자산)**를 놓치지 않는다 (전-1)", () => {
  it("★ CEF·key=value 형식의 인증 실패가 **이벤트로 잡힌다** — 고치기 전에는 한 건도 안 잡혔다", () => {
    const r = parseSecurityLog("cef-test.log", CEF인증실패("203.0.113.9", "10.0.0.5", 14).join("\n"));
    const brute = r.events.find((e) => /브루트포스/.test(e.title));
    expect(brute, "국내 보안장비 형식에서도 브루트포스가 나와야 한다").toBeTruthy();
    expect(brute!.entity, "entity는 공격 출발지다").toBe("203.0.113.9");
    expect(r.matchedLines, "14줄 모두 인증 실패로 세어야 한다").toBe(14);
  });

  it("★ 목적지를 실제로 뽑는다 — peers는 등록 자산만 남기므로 **뽑는 단계**를 직접 잰다", () => {
    // ⚠ peers만 보면 「등록부에 없어서 비었다」와 「못 뽑아서 비었다」를 구별할 수 없다.
    //   그래서 추출 함수 자체를 잰다 — 이 구별을 못 해서 오늘 판정을 두 번 틀렸다.
    expect(목적지IP("CEF:0|AhnLab|TrusGuard|1.0|100|auth failure|5|src=203.0.113.9 dst=10.0.0.5 dpt=22")).toBe("10.0.0.5");
    expect(목적지IP("Aug  1 10:00:01 fw01 kernel: DENY SRC=203.0.113.9 DST=10.0.0.5 DPT=445")).toBe("10.0.0.5");
    expect(목적지IP("... dst 10.0.0.5 ...")).toBe("10.0.0.5");
    // 출발지와 같으면 버린다 — 둘 다 「줄의 첫 IP」를 주운 경우다.
    expect(목적지IP("src=10.0.0.5 dst=10.0.0.5", "10.0.0.5")).toBeUndefined();
    // 목적지가 없는 줄에서 지어내지 않는다.
    expect(목적지IP("Failed password for root from 203.0.113.9 port 52134 ssh2")).toBeUndefined();
  });

  it("★ 목적지 추출이 두 탐지기에 **같은 함수**로 걸려 있다 — 한 곳에서만 적는다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "analysishub.ts"), "utf8");
    // 목적지 추출 정규식이 파일에 **한 벌만** 있어야 한다(두 벌이면 반드시 어긋난다).
    const 벌수 = (src.match(/\\bDST=\(\\d\+\\\.\\d\+\\\.\\d\+\\\.\\d\+\)/g) ?? []).length;
    expect(벌수, "목적지 추출 정규식이 여러 곳에 복사돼 있으면 안 된다").toBeLessThanOrEqual(1);
    expect(/function 목적지IP\(/.test(src), "공용 함수 목적지IP가 있어야 한다").toBe(true);
    // 브루트포스 탐지기가 그 함수를 실제로 부르는가 — 만들어 두고 안 부르면 없는 것과 같다.
    const bfStart = src.indexOf("function detectBruteForce");
    const bfEnd = src.indexOf("function detectFirewall");
    expect(bfStart).toBeGreaterThan(-1);
    expect(src.slice(bfStart, bfEnd).includes("목적지IP("), "브루트포스 탐지기가 목적지IP를 불러야 한다").toBe(true);
  });

  it("전통 syslog 형식은 그대로 호스트 이름을 잡는다 — 넓히다가 잃으면 안 된다", () => {
    const r = parseSecurityLog("syslog-test.log", SYSLOG인증실패("203.0.113.9", "fw01", 14).join("\n"));
    const brute = r.events.find((e) => /브루트포스/.test(e.title));
    expect(brute).toBeTruthy();
    expect(brute!.entity).toBe("203.0.113.9");
  });

  it("★ 상관은 **목적지**로만 이어진다 — 출발지끼리는 겹쳐도 뜻이 없다", () => {
    // 같은 목적지를 가리키는 두 소스가 있으면 상관이 잡혀야 한다.
    const evs = [
      { id: "v1", source: "vuln" as const, title: "Zerologon", entity: "10.0.0.5", severity: "critical" as const,
        priority: "P0" as const, detail: "", signals: [], peers: [], aiSummary: "", ref: "", at: Date.now() },
      { id: "l1", source: "log" as const, title: "브루트포스", entity: "203.0.113.9", severity: "high" as const,
        priority: "P1" as const, detail: "", signals: [], peers: ["10.0.0.5"], aiSummary: "", ref: "", at: Date.now() },
    ];
    const corr = computeCorrelations(evs);
    expect(corr.length, "같은 목적지를 본 두 소스는 묶여야 한다").toBe(1);
    expect(corr[0].entity).toBe("10.0.0.5");
    expect(corr[0].sources.sort()).toEqual(["log", "vuln"]);
  });

  it("출발지만 같은 두 로그는 상관이 아니다 — 남의 IP를 우리 위험으로 세지 않는다", () => {
    const evs = [
      { id: "l1", source: "log" as const, title: "브루트포스", entity: "203.0.113.9", severity: "high" as const,
        priority: "P1" as const, detail: "", signals: [], peers: [], aiSummary: "", ref: "", at: Date.now() },
      { id: "l2", source: "log" as const, title: "포트스캔", entity: "203.0.113.9", severity: "high" as const,
        priority: "P1" as const, detail: "", signals: [], peers: [], aiSummary: "", ref: "", at: Date.now() },
    ];
    expect(computeCorrelations(evs).length, "같은 소스끼리는 교차 위험이 아니다").toBe(0);
  });
});

describe("처리·무시한 이벤트는 상관에서 빠진다 — 한 화면에서 규칙이 어긋나면 안 된다", () => {
  const 만들기 = (id: string, source: "vuln" | "log", entity: string, peers: string[], status?: "done" | "ignored") => ({
    id, source, title: "t", entity, severity: "high" as const, priority: "P1" as const,
    detail: "", signals: [], peers, aiSummary: "", ref: "", at: Date.now(), ...(status ? { status } : {}),
  });

  it("★ 무시(ignored) 표시한 로그는 상관 줄에 다시 뜨지 않는다", () => {
    const 살아있음 = computeCorrelations([
      만들기("v1", "vuln", "10.0.0.5", []),
      만들기("l1", "log", "203.0.113.9", ["10.0.0.5"]),
    ]);
    expect(살아있음.length, "둘 다 살아 있으면 상관이다").toBe(1);

    const 무시함 = computeCorrelations([
      만들기("v1", "vuln", "10.0.0.5", []),
      만들기("l1", "log", "203.0.113.9", ["10.0.0.5"], "ignored"),
    ]);
    expect(무시함.length, "한쪽을 무시하면 더 이상 두 소스가 아니다").toBe(0);
  });

  it("처리 완료(done)도 마찬가지다 — 끝낸 일을 다시 알리지 않는다", () => {
    const r = computeCorrelations([
      만들기("v1", "vuln", "10.0.0.5", [], "done"),
      만들기("l1", "log", "203.0.113.9", ["10.0.0.5"]),
    ]);
    expect(r.length).toBe(0);
  });
});
