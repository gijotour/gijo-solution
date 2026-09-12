import { describe, it, expect, beforeEach, vi } from "vitest";

// LLM 스텁 — 이 파일이 검증하는 건 **규칙 계산과 폴백**이지 모델 문장이 아니다.
const mockChat = vi.fn(async () => "오늘은 Log4Shell부터 처리하시길 권합니다.");
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { buildToday, ruleBrief, buildBriefPrompt, groupNameFor } from "../src/engine/today";
import { resetAssetsForTests, recordFindings, registerAsset } from "../src/engine/assets";
import { resetMaintenanceForTests } from "../src/engine/maintenance";
import { resetHardeningForTests, createTarget, createSchedule } from "../src/engine/hardeningtargets";
import { resetApprovalsForTests, updateFindingReview, findingKey } from "../src/engine/approvals";
import { epss값표기 } from "../src/engine/tone";
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
  describe("취약점 묶기 (groupNameFor 정규화 + 호스트 단위)", () => {
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

    it("한 호스트의 취약점을 '취약점 점검' 한 줄로 묶고 대상=호스트·건수를 표시한다", async () => {
      recordFindings("srv-1", [
        { ...KEV_FINDING, finding_type: "Oracle Database Server (Apr 2024 CPU) (CVE-1 외 3건)" },
        { ...KEV_FINDING, finding_type: "Oracle Database Server (Oct 2020 CPU) (CVE-2 외 5건)" },
        { ...KEV_FINDING, finding_type: "Apache Log4j < 2.15.0 RCE (CVE-2021-44228)" },
      ] as StandardFinding[]);

      const t = await buildToday(false);
      const host = t.items.filter((i) => i.axis === "vuln");
      expect(host).toHaveLength(1); // 호스트 1대 → 1줄
      expect(host[0].title).toBe("취약점 점검");
      expect(host[0].subtitle).toBe("oracle.local"); // 대상 = 호스트
      expect(host[0].badges).toContain("3건");
      expect(host[0].why).toContain("취약점 3건");
      // 제품·취약점 이름은 브리핑 문장에 넣지 않는다(LLM 나열 방지 + 쉬운 내용)
      expect(host[0].why).not.toContain("Oracle");
    });

    it("호스트가 다르면 각각 한 줄이다 — 조치 대상이 다른 장비다", async () => {
      registerAsset({ id: "srv-2", name: "web-01", path: "hosts/web-01" });
      recordFindings("srv-1", [KEV_FINDING]);
      recordFindings("srv-2", [KEV_FINDING]);
      const t = await buildToday(false);
      const vuln = t.items.filter((i) => i.axis === "vuln");
      expect(vuln).toHaveLength(2);
      expect(new Set(vuln.map((i) => i.subtitle))).toEqual(new Set(["oracle.local", "web-01"]));
    });
  });

  it("KEV는 기한이 없어도 '지금'으로 올라온다 — CISA 관행(큐 건너뛰기)", async () => {
    recordFindings("srv-1", [KEV_FINDING]);
    const t = await buildToday(false);
    const kev = t.items.find((i) => i.axis === "vuln" && i.subtitle === "oracle.local");
    expect(kev).toBeDefined();
    expect(kev?.title).toBe("취약점 점검");
    expect(kev?.urgency).toBe("now");
    expect(kev?.badges).toContain("KEV");
    // 근거는 계산된 사실만 — 모델이 지어낼 여지를 주지 않는다.
    expect(kev?.why).toContain("실제 악용(KEV)");
    expect(kev?.why).toContain("악용예측 94%");
  });

  // B11(전-6 정직): EPSS 0.5% 미만이 "최고 악용예측 0%"로 나가던 결함 — 값은 tone.epss값표기
  // 한 곳(단일 출처)에서 만들고, today.ts는 낱말만 "악용예측"으로 바꿔 붙인다. 글자를 손으로
  // 베끼면 tone.ts 반올림 규칙과 따로 놀 수 있어, 기대값도 그 함수를 불러 대조한다.
  describe("★ B11: 최고 악용예측 — EPSS 낮은 값을 '0%'로 단정하지 않는다(2026-09-12)", () => {
    function kevFindingWithEpss(epss: number | undefined): StandardFinding {
      // kev:true로 고정해 기한 유무와 무관하게 오늘 목록에 뜨게 한다(테스트 편의).
      return { ...KEV_FINDING, epss } as StandardFinding;
    }

    it("0.003(0.5% 미만)은 '최고 악용예측 1% 미만'이다", async () => {
      recordFindings("srv-1", [kevFindingWithEpss(0.003)]);
      const t = await buildToday(false);
      const item = t.items.find((i) => i.axis === "vuln" && i.subtitle === "oracle.local");
      expect(item?.why).toContain(`최고 악용예측 ${epss값표기(0.003)}`);
      expect(item?.why).toContain("최고 악용예측 1% 미만");
      expect(item?.epssLabel).toBe(epss값표기(0.003));
    });

    it("0.12는 그대로 반올림해 '최고 악용예측 12%'다", async () => {
      recordFindings("srv-1", [kevFindingWithEpss(0.12)]);
      const t = await buildToday(false);
      const item = t.items.find((i) => i.axis === "vuln" && i.subtitle === "oracle.local");
      expect(item?.why).toContain(`최고 악용예측 ${epss값표기(0.12)}`);
      expect(item?.why).toContain("최고 악용예측 12%");
    });

    it("정말 0이면 '최고 악용예측 0%' 그대로다 — 없는 값과 구분한다", async () => {
      recordFindings("srv-1", [kevFindingWithEpss(0)]);
      const t = await buildToday(false);
      const item = t.items.find((i) => i.axis === "vuln" && i.subtitle === "oracle.local");
      expect(item?.why).toContain(`최고 악용예측 ${epss값표기(0)}`);
      expect(item?.why).toContain("최고 악용예측 0%");
    });

    it("epss가 없으면(null) 최고 악용예측 항목 자체를 안 싣는다", async () => {
      recordFindings("srv-1", [kevFindingWithEpss(undefined)]);
      const t = await buildToday(false);
      const item = t.items.find((i) => i.axis === "vuln" && i.subtitle === "oracle.local");
      expect(item?.why).not.toContain("악용예측");
      expect(item?.epssLabel).toBeUndefined();
    });

    // ★ 검토관 적발(2026-09-12): 호스트 정렬이 **표시 글자(why)**에서 정규식으로 %를 되팔고 있었다.
    //   표기가 「1% 미만」을 내기 시작하자 EPSS 0.004가 「1」로 읽혀 0.012(「1%」)와 동점이 된다
    //   — 표기를 바꿀 때마다 순서가 조용히 따라 바뀌는 구조다. 정렬은 원값으로 해야 한다.
    it("★ 호스트 순서는 EPSS 원값으로 정한다 — 표기(「1% 미만」)를 되팔지 않는다", async () => {
      registerAsset({ id: "srv-2", name: "web-01", path: "hosts/web-01" });
      // 넣는 순서를 일부러 뒤집어 둔다: 낮은 EPSS 호스트가 우선순위 점수(VPR 가산)로 **먼저** 들어온다
      // (approvals.priorityScore = kev*1000 + epss*100 + vpr*5 + 심각도 → 낮음 14.4 · 높음 5.2).
      // 그래서 글자를 되파는 옛 정렬로는 동점이 되어 oracle.local이 앞에 남는다.
      const 낮음 = { ...PLAIN_FINDING, severity: "critical", epss: 0.004, vpr: 2 } as StandardFinding;
      const 높음 = { ...PLAIN_FINDING, severity: "critical", epss: 0.012 } as StandardFinding;
      recordFindings("srv-1", [낮음]);
      recordFindings("srv-2", [높음]);
      // 둘 다 KEV가 아니라 기한이 걸려야 오늘 목록에 오른다.
      updateFindingReview("srv-1", findingKey("srv-1", 낮음), { dueDate: ymd(-1) }, "tester");
      updateFindingReview("srv-2", findingKey("srv-2", 높음), { dueDate: ymd(-1) }, "tester");

      const t = await buildToday(false);
      expect(t.items.filter((i) => i.axis === "vuln").map((i) => i.subtitle)).toEqual(["web-01", "oracle.local"]);
      // 두 호스트의 글자는 정규식으로 되팔면 똑같이 「1」이다 — 그래서 글자로는 이 순서가 안 나온다.
      expect(t.items.find((i) => i.subtitle === "oracle.local")?.why).toContain(`최고 악용예측 ${epss값표기(0.004)}`);
      expect(t.items.find((i) => i.subtitle === "web-01")?.why).toContain(`최고 악용예측 ${epss값표기(0.012)}`);
    });
  });

  it("기한이 안 걸린 일반 취약점은 오늘 목록에 넣지 않는다 — 화면을 백로그로 채우지 않는다", async () => {
    recordFindings("srv-1", [PLAIN_FINDING]);
    const t = await buildToday(false);
    expect(t.items.filter((i) => i.axis === "vuln")).toHaveLength(0);
  });

  it("기한이 지나면 '지금', 오늘까지면 '오늘'로 분류하고 일수를 계산한다", async () => {
    recordFindings("srv-1", [PLAIN_FINDING]);
    const key = findingKey("srv-1", PLAIN_FINDING);
    updateFindingReview("srv-1", key, { dueDate: ymd(-3), assignee: "정요한" }, "tester");

    const t = await buildToday(false);
    const item = t.items.find((i) => i.axis === "vuln" && i.subtitle === "oracle.local");
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
    expect(t.items.filter((i) => i.axis === "vuln")).toHaveLength(0);
  });

  // 실측(2026-07-21): 급한 취약점이 12건이라 상위 6칸을 다 먹어 장비 점검이 화면에서 사라졌다
  // (counts.today=3인데 items에는 0건). 두 축은 성격이 달라 한쪽이 다른 쪽을 굶기면 안 된다.
  it("취약점이 많아도 장비 점검 자리를 보장한다 — 한 축이 다른 축을 굶기지 않는다", async () => {
    const many: StandardFinding[] = [];
    for (let i = 0; i < 12; i++) {
      many.push({ ...KEV_FINDING, finding_type: `제품${i} 취약점`, evidence: `CVE-9999-${i}` } as StandardFinding);
    }
    recordFindings("srv-1", many);
    // createSchedule은 nextRunAt=now로 만든다(첫 틱에 즉시 1회) → 생성 즉시 "주기 도래" 상태
    const target = createTarget({ label: "FW-01", host: "local", port: 22, authMethod: "local" });
    createSchedule(target.id, "kisa", 720); // 월간

    const t = await buildToday(false);
    expect(t.items.filter((i) => i.axis === "vuln").length).toBeGreaterThan(0);
    expect(t.items.filter((i) => i.axis === "device").length).toBeGreaterThan(0); // 굶지 않는다
  });

  it("한쪽 축이 비면 남은 자리를 다른 축이 쓴다 — 화면을 낭비하지 않는다", async () => {
    // 호스트 단위 집계이므로, 남는 자리를 채우려면 호스트가 여러 대여야 한다(6대 등록).
    for (let i = 0; i < 6; i++) {
      registerAsset({ id: `h-${i}`, name: `host-${i}.local`, path: `hosts/host-${i}` });
      recordFindings(`h-${i}`, [KEV_FINDING]);
    }
    const t = await buildToday(false); // 장비 축 비어 있음
    expect(t.items.filter((i) => i.axis === "vuln").length).toBe(5); // 3 + 남은 2칸
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

    // 실측(2026-07-21): 프롬프트에 "목록을 다시 나열하지 마라"를 넣었는데 7B가 그대로 7개를
    // 나열했다. 화면 바로 아래 목록이 있으니 중복이고 브리핑 구실을 못 한다. 규칙으로 잡는다.
    it("모델이 대상(호스트) 목록을 나열하면 규칙 문장으로 대체한다", async () => {
      // 호스트 단위 집계 후엔 화면 목록이 호스트다 — 모델이 여러 호스트를 읊으면 목록 복창으로 본다.
      for (const [id, name] of [["srv-1", "oracle.local"], ["srv-a", "web-01"], ["srv-b", "db-02"]] as const) {
        if (id !== "srv-1") registerAsset({ id, name, path: `hosts/${name}` });
        recordFindings(id, [KEV_FINDING]);
      }
      // 운영에서 실제로 나온 나열형 응답(대상 3개 이상 읊음)
      mockChat.mockResolvedValueOnce(
        "오늘은 oracle.local, web-01, db-02의 취약점 점검이 필요합니다. 이 중 oracle.local을 먼저 처리하세요."
      );
      const t = await buildToday(true);
      expect(t.briefBy).toBe("rule");
      expect(t.brief).toContain("급한 건");
    });

    it("정상 브리핑(항목 1~2개 언급)은 그대로 쓴다 — 과하게 막지 않는다", async () => {
      recordFindings("srv-1", [KEV_FINDING]);
      mockChat.mockResolvedValueOnce("Apache Log4j RCE가 가장 급합니다. 실제 악용이 확인돼 오늘 안에 패치하시길 권합니다.");
      const t = await buildToday(true);
      expect(t.briefBy).toBe("llm");
      expect(t.brief).toContain("가장 급합니다");
    });

    it("긴 브리핑은 3문장으로 자른다 — 아침에 안 읽힌다", async () => {
      recordFindings("srv-1", [KEV_FINDING]);
      mockChat.mockResolvedValueOnce("첫째 문장. 둘째 문장. 셋째 문장. 넷째 문장. 다섯째 문장.");
      const t = await buildToday(true);
      expect(t.brief).toBe("첫째 문장. 둘째 문장. 셋째 문장.");
    });

    it("프롬프트는 계산된 사실만 주고 숫자 창작을 금지한다", async () => {
      recordFindings("srv-1", [KEV_FINDING]);
      const t = await buildToday(false);
      const p = buildBriefPrompt(t.items);
      expect(p).toContain("건수·일수·비율을 새로 만들지 마라");
      expect(p).toContain("악용예측 94%"); // 계산된 값이 실려 나간다
      expect(p).toContain("다른 취약점 이름을 나열하지 마라");
    });

    it("프롬프트에 개별 항목은 최우선 1건만 넣는다 — 나열의 원인을 없앤다", async () => {
      recordFindings("srv-1", [
        KEV_FINDING,
        { ...KEV_FINDING, finding_type: "Citrix NetScaler CitrixBleed", evidence: "CVE-2023-4966" },
        { ...KEV_FINDING, finding_type: "Ivanti Connect Secure 버퍼 오버플로", evidence: "CVE-2024-21887" },
      ] as StandardFinding[]);
      const t = await buildToday(false);
      const p = buildBriefPrompt(t.items);
      expect(p).toContain("최우선:");
      // 2·3번째 취약점 이름은 프롬프트에 없어야 한다(있으면 모델이 나열한다).
      expect(p).not.toContain("CitrixBleed");
      expect(p).not.toContain("Ivanti");
      // 대신 집계 숫자로 상황을 전한다.
      expect(p).toMatch(/급한 항목 \d+건/);
    });

    it("규칙 문장은 건수·최우선 항목을 정확히 반영한다", () => {
      const brief = ruleBrief([
        // kev/epssLabel은 문장 조립용 구조화 값(epssLabel=tone.epss값표기 산출물) — 실제 코드도 badges와 함께 채운다.
        { id: "a", axis: "vuln", urgency: "now", title: "Log4Shell", subtitle: "oracle.local", why: "실제 악용 확인", action: "", badges: ["KEV"], kev: true, epssLabel: "97%" },
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
