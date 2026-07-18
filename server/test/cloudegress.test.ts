// 클라우드 유출 방지 게이트 — 보안 핵심. "내부 정보가 절대 클라우드로 안 나간다"를 증명한다.
import { describe, it, expect, beforeEach } from "vitest";
import { screenForCloud } from "../src/engine/cloudegress";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { resetUsersForTests, createUser } from "../src/auth/users";

beforeEach(() => {
  resetAssetsForTests();
  resetUsersForTests();
});

describe("screenForCloud — 결정적 유출 방지 게이트", () => {
  it("순수 일반지식 질문은 통과시킨다", () => {
    const r = screenForCloud("Log4Shell(CVE-2021-44228)이 뭐야? 일반적인 방어 방법 알려줘");
    expect(r.allowed).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("사설/내부 IP가 있으면 차단한다", () => {
    for (const ip of ["10.10.20.15", "192.168.219.98", "172.16.0.5", "127.0.0.1"]) {
      const r = screenForCloud(`${ip} 서버 취약점 어떻게 조치해?`);
      expect(r.allowed, ip).toBe(false);
      expect(r.reasons.join()).toContain("IP");
    }
  });

  it("공인 IP는 내부 신호가 아니므로 통과시킨다", () => {
    const r = screenForCloud("8.8.8.8 같은 공개 DNS는 어떻게 동작해?");
    expect(r.allowed).toBe(true);
  });

  it("내부 자산 식별자(vuln:…)가 있으면 차단한다", () => {
    const r = screenForCloud("vuln:192.168.219.98 자산 요약해줘");
    expect(r.allowed).toBe(false);
    expect(r.reasons.join()).toContain("자산 식별자");
  });

  it("실제 등록된 자산 id를 지목하면 차단한다", () => {
    registerAsset({ id: "ai-secbot-01", name: "사내 보안 상담 챗봇", path: "p" });
    const r = screenForCloud("ai-secbot-01 이거 안전해?");
    expect(r.allowed).toBe(false);
    expect(r.reasons.join()).toContain("ai-secbot-01");
  });

  it("실제 등록된 자산명을 지목하면 차단한다", () => {
    registerAsset({ id: "ai-secbot-01", name: "사내 보안 상담 챗봇", path: "p" });
    const r = screenForCloud("사내 보안 상담 챗봇의 취약점을 클라우드로 물어봐줘");
    expect(r.allowed).toBe(false);
  });

  it("IP 없이 호스트명만 지목해도 차단한다(자산명에 IP가 붙어 있어도)", () => {
    // 취약점 스캔이 만드는 자산명은 "oracle.local (192.168.219.98)" 형태 — IP를 빼고 호스트명만
    // 말해도(oracle.local) 잡혀야 한다(실측 2026-07-19: 처음엔 통과하던 갭).
    registerAsset({ id: "vuln:192.168.219.98", name: "oracle.local (192.168.219.98)", path: "h", assetType: "infra-host" });
    const r = screenForCloud("oracle.local 취약점 우선순위 알려줘");
    expect(r.allowed).toBe(false);
  });

  it("등록된 담당자 실명이 있으면 차단한다", () => {
    createUser({ username: "kim", password: "changeme1!", displayName: "김보안", role: "security_officer" });
    const r = screenForCloud("김보안 담당자한테 뭘 시키면 좋을까?");
    expect(r.allowed).toBe(false);
    expect(r.reasons.join()).toContain("담당자");
  });

  it('"우리 자산" 같은 내부 지시 표현이 있으면 차단한다', () => {
    const r = screenForCloud("우리 자산 중에 제일 위험한 게 뭐야?");
    expect(r.allowed).toBe(false);
  });

  it("자산명이 너무 일반적인 단어면 오차단하지 않는다", () => {
    registerAsset({ id: "srv-1", name: "웹 서버", path: "p" });
    // "웹 서버가 뭐야" 같은 일반 질문까지 막으면 과한 오차단 — 제네릭 단어만인 자산명은 매칭 제외.
    const r = screenForCloud("웹 서버가 일반적으로 어떻게 동작하는지 설명해줘");
    expect(r.allowed).toBe(true);
  });

  it("finding 근거에 IP가 있어도 질문 자체에 없으면 통과(질문만 검사)", () => {
    registerAsset({ id: "ai-x", name: "테스트자산XYZ", path: "p" });
    recordFindings("ai-x", [{ finding_type: "노출", severity: "high", evidence: "10.0.0.1", source_tool: "t" }]);
    const r = screenForCloud("프롬프트 인젝션 방어 일반론 알려줘");
    expect(r.allowed).toBe(true);
  });
});
