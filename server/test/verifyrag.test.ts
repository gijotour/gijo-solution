// 조치 검증 근거(RAG) — 근거는 "제안"이지 판정이 아니다. 그 경계를 테스트로 못 박는다.
import { describe, it, expect, beforeEach, vi } from "vitest";

const queryMemoryScored = vi.fn();
vi.mock("../src/engine/memory", () => ({
  queryMemoryScored,
  RAG_RELEVANCE_MAX_DISTANCE: 0.95,
}));

const { collectBasis, attachBasis } = await import("../src/engine/verifyrag");
import type { VerifyOutcome } from "../src/engine/verifyengine";

const chunk = (text: string, distance = 0.3, documentId = "doc-1") => ({ text, distance, documentId });

beforeEach(() => queryMemoryScored.mockReset());

describe("collectBasis — 상태에 따라 필요한 근거만 찾는다", () => {
  it("아직 취약(FAIL)이면 보상통제 근거를 찾는다", async () => {
    // 근거는 그 취약점 이야기여야 한다 — 제목 토큰(log4j)이 문서에도 있어야 붙는다.
    queryMemoryScored.mockResolvedValue([chunk("Log4j 취약점은 경계 IPS 시그니처로 차단 중이며 내부망에서만 접근 가능하다.")]);
    const b = await collectBasis({ findingKey: "k1", title: "Log4j RCE", status: "FAIL", expectedKind: "version" });
    expect(b.basis.some((x) => x.kind === "compensating")).toBe(true);
    // ⚠ 근거를 찾아도 "반려됨"이 아니라 "반려 후보"라고 말해야 한다 — 확정은 사람이 한다
    expect(b.basis.find((x) => x.kind === "compensating")!.label).toContain("후보");
  });

  it("조치확인(PASS)이면 보상통제를 찾지 않는다 — 고쳐진 건에 '안 고쳐도 된다'는 불필요하다", async () => {
    const b = await collectBasis({ findingKey: "k1", title: "Log4j RCE", status: "PASS", expectedKind: "version" });
    expect(b.basis).toHaveLength(0);
    expect(queryMemoryScored).not.toHaveBeenCalled();
  });

  it("관련 없는 문서(임계값 밖)는 근거로 쓰지 않는다 — 지어낸 근거 방지", async () => {
    queryMemoryScored.mockResolvedValue([chunk("IPS로 차단 중", 2.5)]); // 거리 초과
    const b = await collectBasis({ findingKey: "k1", title: "Log4j RCE", status: "FAIL", expectedKind: "version" });
    expect(b.basis).toHaveLength(0);
  });

  it("보상통제 표현이 없는 문서는 보상통제로 오해하지 않는다", async () => {
    queryMemoryScored.mockResolvedValue([chunk("Log4j는 자바 로깅 라이브러리입니다.")]);
    const b = await collectBasis({ findingKey: "k1", title: "Log4j RCE", status: "FAIL", expectedKind: "version" });
    expect(b.basis.some((x) => x.kind === "compensating")).toBe(false);
  });

  // 2026-07-26 실측 회귀: 취약점과 무관한 문서(제품소개·WAF 일반설명)가 "보상통제 후보"로 붙었다.
  // 틀린 근거는 없는 근거보다 나쁘다 — 담당자가 믿고 반려하면 진짜 취약점이 닫힌 것으로 굳는다.
  it("보상통제 어휘가 있어도 이 취약점 이야기가 아니면 근거로 쓰지 않는다", async () => {
    queryMemoryScored.mockResolvedValue([
      chunk("WAF는 SQL 인젝션 요청을 차단합니다. 페이로드 평판을 확인하세요."), // 차단 어휘는 있지만 OpenSSH와 무관
    ]);
    const b = await collectBasis({
      findingKey: "k1", title: "OpenSSH < 10.0 원격 코드 실행", cve: "CVE-2099-00001",
      status: "FAIL", expectedKind: "version",
    });
    expect(b.basis).toHaveLength(0);
  });

  it("CVE가 겹치면 근거로 쓴다", async () => {
    queryMemoryScored.mockResolvedValue([chunk("CVE-2099-00001은 경계 IPS 시그니처로 차단 중이다.")]);
    const b = await collectBasis({
      findingKey: "k1", title: "OpenSSH 원격 코드 실행", cve: "CVE-2099-00001",
      status: "FAIL", expectedKind: "version",
    });
    expect(b.basis.some((x) => x.kind === "compensating")).toBe(true);
  });

  it("자동 판정 불가(NA)면 장비 확인 방법을 붙인다", async () => {
    queryMemoryScored.mockResolvedValue([chunk("FortiOS 펌웨어 버전 확인: System > Firmware & Registration 메뉴에서 확인한다.")]);
    const b = await collectBasis({ findingKey: "k1", title: "FortiOS 펌웨어 취약점", status: "NA", expectedKind: "version" });
    expect(b.basis.some((x) => x.kind === "device_howto")).toBe(true);
  });

  it("근거가 없으면 '어떤 문서가 있으면 되는지' 알려준다 — 자료 없음으로 끝내지 않는다", async () => {
    queryMemoryScored.mockResolvedValue([]);
    const b = await collectBasis({ findingKey: "k1", title: "알 수 없는 취약점", status: "NA", expectedKind: "version" });
    expect(b.basis).toHaveLength(0);
    expect(b.hint?.need).toContain("버전 확인 방법");
  });

  it("RAG가 이상한 값을 줘도 무너지지 않는다 — 검증 결과 경로는 살아 있어야 한다", async () => {
    // 실패 주입은 throw 대신 '망가진 응답'으로 한다. (throw 주입은 vitest가 미처리 오류로
    // 따로 집계해 정작 보려는 것을 가린다 — 코드의 try/catch 자체는 별도 프로브로 확인함.)
    queryMemoryScored.mockResolvedValue(null as unknown as never);
    let leaked: string | null = null;
    let basisLen = -1;
    try {
      const b = await collectBasis({ findingKey: "k1", title: "Log4j RCE", status: "FAIL", expectedKind: "version" });
      basisLen = b.basis.length;
    } catch (e) { leaked = (e as Error).message; }
    expect(leaked).toBe(null);
    expect(basisLen).toBe(0);
  });

  it("출처(documentId)를 함께 준다 — 담당자가 원문을 찾아갈 수 있어야 한다", async () => {
    queryMemoryScored.mockResolvedValue([chunk("SQL Injection 공격은 WAF 룰로 차단 중", 0.2, "보안운영지침.md")]);
    const b = await collectBasis({ findingKey: "k1", title: "SQL Injection 취약점", status: "FAIL", expectedKind: "manual" });
    expect(b.basis[0].documentId).toBe("보안운영지침.md");
  });
});

describe("attachBasis — 결과 목록에 근거 붙이기", () => {
  const R = (over: Partial<VerifyOutcome>): VerifyOutcome => ({
    findingKey: "k", title: "t", status: "FAIL", evidence: "e", expectedKind: "version", ...over,
  });

  it("PASS는 건너뛰고 FAIL/NA에만 조회한다", async () => {
    queryMemoryScored.mockResolvedValue([]);
    const out = await attachBasis([R({ findingKey: "a", status: "PASS" }), R({ findingKey: "b", status: "FAIL" })]);
    expect(out).toHaveLength(2);
    expect(out[0].basis).toBeUndefined();
    // FAIL 한 건에 대해서만 조회가 돌았다
    expect(queryMemoryScored.mock.calls.length).toBeGreaterThan(0);
  });

  it("판정(status)은 근거 때문에 바뀌지 않는다 — 근거는 제안일 뿐", async () => {
    queryMemoryScored.mockResolvedValue([chunk("Log4j 취약점은 IPS 시그니처로 차단 중")]);
    const out = await attachBasis([R({ status: "FAIL", title: "Log4j RCE" })]);
    expect(out[0].status).toBe("FAIL"); // 보상통제 근거가 있어도 여전히 '미조치'
    expect(out[0].basis?.length).toBe(1);
  });
});
