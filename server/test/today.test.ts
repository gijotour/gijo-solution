import { describe, it, expect, beforeEach, vi } from "vitest";

// LLM 스텁 — 이 파일이 검증하는 건 **규칙 계산과 폴백**이지 모델 문장이 아니다.
const mockChat = vi.fn(async () => "오늘은 Log4Shell부터 처리하시길 권합니다.");
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { buildToday, ruleBrief, buildBriefPrompt, groupNameFor } from "../src/engine/today";
import { resetAssetsForTests, recordFindings, registerAsset } from "../src/engine/assets";
import { resetMaintenanceForTests } from "../src/engine/maintenance";
import { resetHardeningForTests } from "../src/engine/hardeningtargets";
import { resetApprovalsForTests, updateFindingReview, findingKey } from "../src/engine/approvals";
import type { StandardFinding } from "../src/engine/bridge";

const KEV_FINDING: StandardFinding = {
  finding_type: "Apache Log4j RCE",
  severity: "critical",
  evidence: "CVE-2021-44228",
  source_tool: "nessus",
  kev: true,
  epss: 0.94,
} as StandardFinding;

const PLAIN_FINDING: StandardFinding = {
  finding_type: "OpenSSH 사용자 열거",
  severity: "medium",
  evidence: "CVE-2018-15473",
  source_tool: "nessus",
} as StandardFinding;

function ymd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("오늘의 할일 — 가이드형 집계", () => {
  beforeEach(() => {
    resetAssetsForTests();
    resetApprovalsForTests();
    mockChat.mockClear();
    // 유지보수는 샘플 6건을 자동 시드하고 하드닝도 상태를 남긴다 — 두 축을 비워야 취약점 축만 검증할 수 있다.
    resetMaintenanceForTests();
    resetHardeningForTests();
    // 검토대장은 자산에 달린 finding에서 파생된다 — 자산이 먼저 있어야 한다.
    registerAsset({ id: "srv-1", name: "oracle.local", path: "hosts/oracle.local" });
  });

  // 실측(2026-07-21 운영): 개별 finding을 그대로 올리니 KEV만 20건, 그중 6건이 같은 자산의
  // Oracle CPU였다. 담당자가 하는 일은 "Oracle DB 분기 패치 한 번"인데 20줄을 들이민 셈.
  // 아래 문자열은 전부 운영 DB의 실제 finding_type이다(지어낸 것 아님).
  describe("조치 단위로 묶기 (자산 × 제품)", () => {
    it("같은 제품의 버전·CPU·CVE 표기 차이를 한 이름으로 모은다", () => {
      expect(groupNameFor("Oracle Database Server (Apr 2024 CPU) (CVE-2022-34169 외 13건)")).toBe("Oracle Database Server");
      expect(groupNameFor("Oracle Database Server Multiple Vulnerabilities (Apr 2021 CPU)")).toBe("Oracle Database Server");
      expect(groupNameFor("Apache Log4j < 2.15.0 Remote Code Execution (Nix) (CVE-2021-44228)")).toBe("Apache Log4j");
      expect(groupNameFor("Apache Log4j 2.x < 2.16.0 RCE (CVE-2021-44228 외 1건)")).toBe("Apache Log4j");
      expect(groupNameFor("Apache Log4j 1.x Multiple Vulnerabilities (CVE-2019-17571 외 5건)")).toBe("Apache Log4j");
    });

    it("한글 취약점명도 묶는다", () => {
      expect(groupNameFor("OpenSSL 원격 코드 실행 (CVE-2024-0001)")).toBe("OpenSSL");
      expect(groupNameFor("Apache 버전 정보 노출 (CVE-2023-1234)")).toBe("Apache");
    });

    it("묶을 게 없으면 원문을 지킨다 — 과도한 병합 금지", () => {
      expect(groupNameFor("SMB 서명 미설정")).toBe("SMB 서명 미설정");
      expect(groupNameFor("만료된 SSL 인증서")).toBe("만료된 SSL 인증서");
      expect(groupNameFor("unsafe-pickle")).toBe("unsafe-pickle");
    });

    it("같은 자산의 같은 제품 여러 건이 한 줄로 접히고 건수가 표시된다", async () => {
      recordFindings("srv-1", [
        { ...KEV_FINDING, finding_type: "Oracle Database Server (Apr 2024 CPU) (CVE-1 외 3건)" },
        { ...KEV_FINDING, finding_type: "Oracle Database Server (Oct 2020 CPU) (CVE-2 외 5건)" },
        { ...KEV_FINDING, finding_type: "Oracle Database Server Multiple Vulnerabilities (Apr 2021 CPU)" },
      ] as StandardFinding[]);

      const t = await buildToday(false);
      const oracle = t.items.filter((i) => i.title.includes("Oracle Database Server"));
      expect(oracle).toHaveLength(1); // 3건 → 1줄
      expect(oracle[0].title).toContain("(3건)");
      expect(oracle[0].badges).toContain("3건");
      expect(oracle[0].action).toContain("3건을 한 번에");
    });

    it("자산이 다르면 묶지 않는다 — 조치 대상이 다른 장비다", async () => {
      registerAsset({ id: "srv-2", name: "web-01", path: "hosts/web-01" });
      recordFindings("srv-1", [KEV_FINDING]);
      recordFindings("srv-2", [KEV_FINDING]);
      const t = await buildToday(false);
      expect(t.items.filter((i) => i.title.includes("Log4j"))).toHaveLength(2);
    });
  });

  it("KEV는 기한이 없어도 '지금'으로 올라온다 — CISA 관행(큐 건너뛰기)", async () => {
    recordFindings("srv-1", [KEV_FINDING]);
    const t = await buildToday(false);
    const kev = t.items.find((i) => i.title.includes("Log4j"));
    expect(kev).toBeDefined();
    expect(kev?.urgency).toBe("now");
    expect(kev?.badges).toContain("KEV");
    // 근거는 계산된 사실만 — 모델이 지어낼 여지를 주지 않는다.
    expect(kev?.why).toContain("실제 악용 확인");
    expect(kev?.why).toContain("악용예측 94%");
  });

  it("기한이 안 걸린 일반 취약점은 오늘 목록에 넣지 않는다 — 화면을 백로그로 채우지 않는다", async () => {
    recordFindings("srv-1", [PLAIN_FINDING]);
    const t = await buildToday(false);
    expect(t.items.find((i) => i.title.includes("OpenSSH"))).toBeUndefined();
  });

  it("기한이 지나면 '지금', 오늘까지면 '오늘'로 분류하고 일수를 계산한다", async () => {
    recordFindings("srv-1", [PLAIN_FINDING]);
    const key = findingKey("srv-1", PLAIN_FINDING);
    updateFindingReview("srv-1", key, { dueDate: ymd(-3), assignee: "정요한" }, "tester");

    const t = await buildToday(false);
    const item = t.items.find((i) => i.title.includes("OpenSSH"));
    expect(item?.urgency).toBe("now");
    // 기한은 그 날 23:59 기준이라 "3일 전 지정"은 경과 시각에 따라 2~3일 초과로 계산된다.
    // 정확한 일수보다 "초과로 분류되고 일수가 붙는다"가 검증 대상.
    expect(item?.badges.some((b) => /\d+일 초과/.test(b))).toBe(true);
    // 담당자가 있으면 추천 행동이 달라진다(지정하라고 다시 시키지 않는다).
    expect(item?.action).toContain("정요한");
  });

  it("조치 승인된 건은 오늘 할 일에서 빠진다", async () => {
    recordFindings("srv-1", [KEV_FINDING]);
    const key = findingKey("srv-1", KEV_FINDING);
    updateFindingReview("srv-1", key, { status: "approved" }, "tester");
    const t = await buildToday(false);
    expect(t.items.find((i) => i.title.includes("Log4j"))).toBeUndefined();
  });

  it("취약점이 장비 주기보다 앞에 온다 — 반복 점검이 급한 KEV를 밀어내지 않게", async () => {
    recordFindings("srv-1", [KEV_FINDING]);
    const t = await buildToday(false);
    const axes = t.items.map((i) => i.axis);
    const firstDevice = axes.indexOf("device");
    const lastVuln = axes.lastIndexOf("vuln");
    if (firstDevice >= 0 && lastVuln >= 0) expect(lastVuln).toBeLessThan(firstDevice);
  });

  describe("브리핑 문장", () => {
    it("LLM이 죽어도 규칙 문장으로 화면이 뜬다 — 아침 화면이 LLM에 인질이 되면 안 된다", async () => {
      recordFindings("srv-1", [KEV_FINDING]);
      mockChat.mockRejectedValueOnce(new Error("llama-server 연결 실패"));
      const t = await buildToday(true);
      expect(t.briefBy).toBe("rule");
      expect(t.brief).toContain("급한 건");
      expect(t.items.length).toBeGreaterThan(0); // 목록은 그대로 살아 있다
    });

    it("LLM이 연결 실패 안내문을 주면 그것도 규칙 문장으로 대체한다", async () => {
      recordFindings("srv-1", [KEV_FINDING]);
      mockChat.mockResolvedValueOnce("⚠ AI 모델이 아직 준비되지 않았습니다.");
      const t = await buildToday(true);
      expect(t.briefBy).toBe("rule");
      expect(t.brief).not.toContain("⚠");
    });

    it("정상이면 LLM 문장을 쓰고 출처를 표시한다", async () => {
      recordFindings("srv-1", [KEV_FINDING]);
      const t = await buildToday(true);
      expect(t.briefBy).toBe("llm");
      expect(t.brief).toContain("Log4Shell");
    });

    it("할 일이 없으면 LLM을 부르지 않는다 — 부를 이유가 없을 때 GPU를 쓰지 않는다", async () => {
      const t = await buildToday(true);
      expect(mockChat).not.toHaveBeenCalled();
      expect(t.briefBy).toBe("rule");
      expect(t.brief).toContain("급한 일은 없습니다");
    });

    it("프롬프트는 계산된 사실만 주고 숫자 창작을 금지한다", async () => {
      recordFindings("srv-1", [KEV_FINDING]);
      const t = await buildToday(false);
      const p = buildBriefPrompt(t.items);
      expect(p).toContain("건수·일수·비율을 새로 만들지 마라");
      expect(p).toContain("악용예측 94%"); // 계산된 값이 실려 나간다
      expect(p).toContain("목록을 다시 나열하지 마라");
    });

    it("규칙 문장은 건수·최우선 항목을 정확히 반영한다", () => {
      const brief = ruleBrief([
        { id: "a", axis: "vuln", urgency: "now", title: "Log4Shell", subtitle: "oracle.local", why: "실제 악용 확인", action: "", badges: ["KEV"] },
        { id: "b", axis: "device", urgency: "today", title: "FW-01 점검", subtitle: "방화벽", why: "주기 도래", action: "", badges: [] },
      ]);
      expect(brief).toContain("급한 건 1건");
      expect(brief).toContain("KEV");
      expect(brief).toContain("Log4Shell");
      expect(brief).toContain("점검 주기가 도래한 항목이 1건");
    });
  });

  it("정기점검 예약이 없어도(현재 운영 상태) 취약점 축만으로 정상 동작한다", async () => {
    recordFindings("srv-1", [KEV_FINDING]);
    const t = await buildToday(false);
    expect(t.items.every((i) => i.axis === "vuln")).toBe(true);
    expect(t.counts.now).toBeGreaterThanOrEqual(1);
  });
});
