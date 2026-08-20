// 대화 안 「데이터 카드」 — 검증(하드닝) 현황 KPI+표 (승인 시안 mockups/대화_데이터카드, 2026-08-19).
//
// 이 기능의 위험은 하나다: **카드의 숫자가 화면과 다르게 나오는 것.**
// 사장님 실화면에서 이미 「등록 장비 0 vs 미점검 29」 이중 계산 어긋남을 봤다 —
// 카드는 hardeningtargets 원천 하나만 읽으므로, 여기서 그 계약(원천=DB 직접)을 못박는다.
// LLM이 채우는 칸이 없어야 한다(트리거·계산 전부 결정적).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { isHardeningStatusAsk, hardeningStatusAnswer, isAssetStatusAsk, assetStatusAnswer } from "../src/engine/datacard";
import {
  createTarget, createSchedule, runDueSchedules, resetHardeningForTests,
} from "../src/engine/hardeningtargets";
import type { RunFn } from "../src/engine/hardeningscan";
import { registerAsset, recordFindings, resetAssetsForTests } from "../src/engine/assets";
import { findingListAnswer } from "../src/engine/picklist";

// hardeningtargets.test.ts와 같은 결정적 러너 — 실 셸/원격 없이 점검 1회를 완주시킨다.
function fakeRunner(): RunFn {
  return async (cmd: string) => {
    const map: Array<[RegExp, string]> = [
      [/test -f \/etc\/ssh\/sshd_config/, "n"],
      [/\$3==0/, "root "],
      [/UMASK/, "022"],
      [/is-active rsyslog/, "active"],
      [/stat -c .* \/etc\/passwd/, "root 644"],
      [/stat -c .* \/etc\/shadow/, "root 640"],
      [/PASS_MAX_DAYS/, "90"],
      [/PASS_MIN_DAYS/, "1"],
      [/pam_pwquality|pam_cracklib/, "password requisite pam_pwquality.so minlen=10"],
      [/pam_faillock|pam_tally2/, "auth required pam_faillock.so deny=5"],
      [/PASS_MIN_LEN/, "10"],
    ];
    for (const [re, out] of map) if (re.test(cmd)) return { code: 0, out, err: "" };
    return { code: 0, out: "", err: "" };
  };
}

describe("트리거 — 결정적(LLM 이전)", () => {
  it("검증/하드닝 현황 물음을 알아듣는다", () => {
    expect(isHardeningStatusAsk("검증 현황 보여줘")).toBe(true);
    expect(isHardeningStatusAsk("하드닝 점검 상태 어때")).toBe(true);
    expect(isHardeningStatusAsk("보안설정 점검 현황 알려줘")).toBe(true);
    expect(isHardeningStatusAsk("정기 점검 상태 보여줘")).toBe(true);
  });
  it("★ 취약점 현황은 가로채지 않는다 — findingList 영토다", () => {
    expect(isHardeningStatusAsk("취약점 현황 보여줘")).toBe(false);
    expect(isHardeningStatusAsk("스캔결과 상태 알려줘")).toBe(false);
  });
  it("실행 지시는 가로채지 않는다 — run_hardening 영토다", () => {
    expect(isHardeningStatusAsk("하드닝 점검 돌려줘")).toBe(false);
    expect(isHardeningStatusAsk("보안설정 점검 해줘")).toBe(false);
  });
  it("★ 스케줄 물음은 가로채지 않는다 — hardening_schedule_list 영토다(게이트 실측 결함)", () => {
    expect(isHardeningStatusAsk("하드닝 점검 스케줄 알려줘")).toBe(false);
    expect(isHardeningStatusAsk("점검 일정 보여줘")).toBe(false);
  });
  it("검증 낱말 없는 현황 물음은 지나간다", () => {
    expect(isHardeningStatusAsk("자산 현황 보여줘")).toBe(false);
    expect(isHardeningStatusAsk("")).toBe(false);
  });
});

describe("카드 내용 — 전부 DB에서 결정적으로", () => {
  beforeEach(() => resetHardeningForTests());

  it("빈 상태: 등록 0 · 표 0줄 · 시작 안내", () => {
    const { output, dataCard } = hardeningStatusAnswer();
    expect(dataCard.kpis[0]).toMatchObject({ label: "등록 장비", value: "0" });
    expect(dataCard.table.shown).toHaveLength(0);
    expect(dataCard.table.totalCount).toBe(0);
    expect(output).toContain("등록된 점검 대상이 없습니다");
  });

  it("점검 1회 완주 후: KPI·표가 이력과 일치한다", async () => {
    const t = createTarget({ label: "웹서버-카드", host: "local", port: 22, authMethod: "local" });
    createSchedule(t.id, "kisa", 24);
    await runDueSchedules(Date.now(), () => fakeRunner());
    const { dataCard } = hardeningStatusAnswer();
    expect(dataCard.kpis[0].value).toBe("1"); // 등록 장비
    expect(dataCard.kpis[1].value).toBe("1"); // 활성 스케줄
    expect(dataCard.kpis[2].value).toMatch(/%$/); // 평균 준수율 — 측정값이 있어야 한다
    expect(dataCard.kpis[3].value).toBe("0"); // 점검 실패
    const row = dataCard.table.shown[0];
    expect(row.장비).toBe("웹서버-카드");
    expect(row.기준).toBe("KISA");
    expect(row.상태).toBe("정상");
    expect(row.준수율).not.toBe("—");
  });

  it("미점검 대상은 '미점검'으로, 실패·미점검이 표 앞에 온다", async () => {
    const 됨 = createTarget({ label: "점검됨", host: "local", port: 22, authMethod: "local" });
    createSchedule(됨.id, "kisa", 24);
    await runDueSchedules(Date.now(), () => fakeRunner());
    createTarget({ label: "미점검-장비", host: "10.9.9.9", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const { dataCard } = hardeningStatusAnswer();
    expect(dataCard.table.totalCount).toBe(2);
    expect(dataCard.table.shown[0].장비).toBe("미점검-장비"); // 급한 것 먼저
    expect(dataCard.table.shown[0].상태).toBe("미점검");
    expect(dataCard.table.shown[1].상태).toBe("정상");
  });

  it("★ 표는 10줄로 자르되 totalCount는 진짜 총계다 — 잘못 자르면 숫자가 거짓말", () => {
    for (let i = 0; i < 13; i++) {
      createTarget({ label: `장비-${String(i).padStart(2, "0")}`, host: "h", port: 22, username: "a", authMethod: "key", secret: "/k" });
    }
    const { dataCard, output } = hardeningStatusAnswer();
    expect(dataCard.table.shown).toHaveLength(10);
    expect(dataCard.table.totalCount).toBe(13);
    expect(output).toContain("13곳");
    // 정렬용 내부 필드(_급함)가 클라로 새지 않는다
    expect(Object.keys(dataCard.table.shown[0])).not.toContain("_급함");
  });

  it("★ 지워진 대상의 옛 이력은 평균에 안 섞인다 — 운영 실측 결함(등록 0인데 평균 48%)", async () => {
    const t = createTarget({ label: "지워질-장비", host: "local", port: 22, authMethod: "local" });
    createSchedule(t.id, "kisa", 24);
    await runDueSchedules(Date.now(), () => fakeRunner());
    const { deleteTarget } = await import("../src/engine/hardeningtargets");
    deleteTarget(t.id);
    const { dataCard } = hardeningStatusAnswer();
    expect(dataCard.kpis[0].value).toBe("0");
    expect(dataCard.kpis[2].value, "대상이 없으면 평균도 없어야 한다").toBe("—");
  });

  it("🗔 화면 연결·📌 선택 열쇠가 계약대로다", () => {
    const { dataCard } = hardeningStatusAnswer();
    expect(dataCard.screen).toEqual({ page: "verify.html", label: "검증" });
    expect(dataCard.pickKey).toBe("장비");
    expect(dataCard.table.cols.find((c) => c.key === "준수율")?.align).toBe("num");
  });
});

describe("2차 ① 우선순위 카드 — findingListAnswer가 KPI만 동봉한다", () => {
  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "dc-web", name: "웹서버-카드2", path: "-", assetType: "서버" });
    recordFindings("dc-web", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "CVE-2026-9001", source_tool: "scanner" },
      { finding_type: "약한 암호화", severity: "high", evidence: "TLS 1.0", source_tool: "scanner" },
    ]);
  });

  it("KPI 4칸이 실데이터와 일치하고 ★표는 없다(목록 세 벌 금지)", () => {
    const { output, picklist, dataCard } = findingListAnswer("미조치 취약점 뭐 있어?");
    expect(dataCard, "카드가 동봉돼야 한다").toBeTruthy();
    expect(dataCard!.kpis[0]).toMatchObject({ label: "조치할 취약점", value: "2" });
    expect(dataCard!.kpis[1]).toMatchObject({ label: "매우 심각", value: "1", color: "bad" });
    expect(dataCard!.table, "표를 넣으면 본문·체크칸과 같은 목록이 세 벌이 된다").toBeUndefined();
    expect(dataCard!.screen).toEqual({ page: "triage.html", label: "우선순위" });
    // 기존 계약은 그대로 — 본문 목록·체크칸이 안 죽는다
    expect(output).toContain("원격코드실행");
    expect(picklist?.items).toHaveLength(2);
  });

  it("0건이면 카드도 없다 — 빈 KPI 카드는 소음이다", () => {
    resetAssetsForTests();
    const { dataCard } = findingListAnswer("미조치 취약점 뭐 있어?");
    expect(dataCard).toBeUndefined();
  });

  it("좁힌 범위가 카드 제목에도 적힌다 — 안 적으면 전체 수로 읽는다", () => {
    const { dataCard } = findingListAnswer("웹서버-카드2 취약점만 보여줘");
    expect(dataCard!.title).toContain("웹서버-카드2");
  });
});

describe("2차 ③ 자산 현황 카드", () => {
  beforeEach(() => resetAssetsForTests());

  it("트리거 — 현황·상태만 받고 목록·취약점·검증은 기존 영토로 보낸다", () => {
    expect(isAssetStatusAsk("자산 현황 보여줘")).toBe(true);
    expect(isAssetStatusAsk("우리 자산 상태 어때")).toBe(true);
    expect(isAssetStatusAsk("자산 목록 보여줘"), "list_assets 도구 영토").toBe(false);
    expect(isAssetStatusAsk("고위험 자산 리스트"), "list_assets 등급 갈래 영토").toBe(false);
    expect(isAssetStatusAsk("자산 취약점 현황"), "우선순위(findingList) 영토").toBe(false);
    expect(isAssetStatusAsk("최근 등록된 자산 현황"), "list_assets 최근 갈래 영토").toBe(false);
    expect(isAssetStatusAsk("검증 현황 보여줘"), "하드닝 카드 영토").toBe(false);
    expect(isAssetStatusAsk("자산 등록 해줘"), "등록은 실행 지시").toBe(false);
  });

  it("KPI·표가 등록부와 일치하고 위험한 순으로 선다", () => {
    registerAsset({ id: "dc-a1", name: "위험한-서버", path: "-", assetType: "서버" });
    recordFindings("dc-a1", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "e", source_tool: "s" },
      { finding_type: "권한 상승", severity: "high", evidence: "e", source_tool: "s" },
    ]);
    registerAsset({ id: "dc-a2", name: "조용한-서버", path: "-", assetType: "서버", owner: "김담당" });
    // ★ 스캔 실패·조사 정보(info)는 취약점 수에 안 섞인다 — 소스 감시가 요구한 계약을 값으로도 확인
    recordFindings("dc-a2", [
      { finding_type: "scan_error", severity: "high", evidence: "연결 실패", source_tool: "s" },
      { finding_type: "SSH 설치됨", severity: "info", evidence: "조사", source_tool: "s" },
    ]);
    const { output, dataCard } = assetStatusAnswer();
    expect(dataCard.kpis[0].value).toBe("2");          // 등록 자산
    // ★ 고위험 KPI(검토관 심각3): scan_error(high)가 등급을 끌어올리면 안 된다 — dc-a1만 고위험
    expect(dataCard.kpis[1].value).toBe("1");
    expect(dataCard.kpis[2].value).toBe("2");          // 미조치 취약점 총계
    expect(dataCard.kpis[3].value).toBe("1");          // 담당 미지정(dc-a1)
    expect(dataCard.table!.shown[0].자산).toBe("위험한-서버"); // 위험 순
    expect(dataCard.table!.shown[1].담당).toBe("김담당");
    expect(dataCard.screen).toEqual({ page: "inventory.html", label: "자산" });
    expect(output).toContain("등록 2개");
  });

  it("★ 고쳐진 것(fixed)·판정 끝난 것은 「미조치」에 안 섞인다(검토관 심각3 — 우선순위와 어긋났다)", async () => {
    registerAsset({ id: "dc-a3", name: "고친-서버", path: "-", assetType: "서버" });
    recordFindings("dc-a3", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "e", source_tool: "s", state: "fixed" },
      { finding_type: "약한 암호화", severity: "high", evidence: "e", source_tool: "s" },
    ]);
    const 첫 = assetStatusAnswer();
    expect(첫.dataCard.kpis[2].value, "fixed 제외 — 미조치는 1건뿐").toBe("1");
    expect(첫.dataCard.table!.shown[0].심각, "fixed critical은 심각 수에서도 빠진다").toBe("1");
    // 남은 1건을 오탐 판정하면 미조치 0 · 고위험 0(등급이 진짜 목록 기준)
    const { updateFindingReview, findingKey: fk } = await import("../src/engine/approvals");
    const { getAsset } = await import("../src/engine/assets");
    const a = getAsset("dc-a3")!;
    const f = a.findings.find((x) => x.finding_type === "약한 암호화")!;
    updateFindingReview("dc-a3", fk("dc-a3", f), { status: "rejected" }, "test");
    const 둘 = assetStatusAnswer();
    expect(둘.dataCard.kpis[2].value, "판정 끝난 건 제외").toBe("0");
    expect(둘.dataCard.kpis[1].value, "고위험도 0").toBe("0");
  });

  it("★ 🗂 범위가 걸리면 그 자산으로 좁히고 제목에 적는다(검토관 심각4 — 재발 방지)", () => {
    registerAsset({ id: "dc-r1", name: "범위-자산", path: "-", assetType: "서버" });
    recordFindings("dc-r1", [{ finding_type: "권한 상승", severity: "high", evidence: "e", source_tool: "s" }]);
    registerAsset({ id: "dc-r2", name: "딴-자산", path: "-", assetType: "서버" });
    recordFindings("dc-r2", [{ finding_type: "약한 암호화", severity: "high", evidence: "e", source_tool: "s" }]);
    const { dataCard, output } = assetStatusAnswer("dc-r1");
    expect(dataCard.kpis[0].value, "범위 안 1개만").toBe("1");
    expect(dataCard.kpis[2].value).toBe("1");
    expect(dataCard.title).toContain("범위-자산");
    expect(output).toContain("범위-자산");
  });

  it("「이 자산 현황 어때?」는 안 잡는다(심각4 — 선택 치환보다 앞 분기라 전체를 쏟는다)", () => {
    expect(isAssetStatusAsk("이 자산 현황 어때?")).toBe(false);
    expect(isAssetStatusAsk("선택한 자산 상태 알려줘")).toBe(false);
  });

  it("빈 등록부는 「아직 등록 전」으로 정직하게 — 0건≠없다", () => {
    const { output, dataCard } = assetStatusAnswer();
    expect(dataCard.kpis[0].value).toBe("0");
    expect(dataCard.table!.totalCount).toBe(0);
    expect(output).toContain("아직 등록 전");
  });
});

describe("화면 이름 → 현황 카드 (사장님 실측 — 「자산고르기」에 LLM 일반론이 나오던 결함)", () => {
  beforeEach(() => resetAssetsForTests());

  it("트리거 — 화면 이름·짧은 별칭만 받고 문장은 기존 분기에 넘긴다", async () => {
    const { screenNameCard } = await import("../src/engine/datacard");
    expect(screenNameCard("자산고르기")).toBe("asset");
    expect(screenNameCard("자산 고르기")).toBe("asset");
    expect(screenNameCard("발견수집")).toBe("ops");
    expect(screenNameCard("검증")).toBe("hardening");
    expect(screenNameCard("우선순위")).toBe("finding");
    expect(screenNameCard("자산 등록은 어떻게 해?"), "문장은 넘긴다").toBeNull();
    expect(screenNameCard("설정"), "카드 없는 화면 이름은 기존 경로(되묻기·안내)로").toBeNull();
    // QA 결함 1호(2026-08-20) — 신설 카드가 사전에 빠져 「내문서 확인」이 일반 경로로
    // 흘러가 무관 근거로 답을 지어냈다. 전 카드 종류가 화면 이름으로 닿아야 한다.
    expect(screenNameCard("내문서")).toBe("mydocs");
    expect(screenNameCard("내 문서 확인")).toBe("mydocs");
    expect(screenNameCard("작업 내역")).toBe("sessions");
    expect(screenNameCard("조치")).toBe("fix");
    expect(screenNameCard("보고")).toBe("report");
    expect(screenNameCard("보안제품")).toBe("products");
    expect(screenNameCard("기록")).toBe("records");
    expect(screenNameCard("위협")).toBe("threat");
    expect(screenNameCard("AI 팀 감독")).toBe("supervision");
    expect(screenNameCard("승인"), "메뉴 아닌 낱말은 안 삼킨다(결재 확인 문맥)").toBeNull();
    expect(screenNameCard("작업"), "낱말 단독(작업)은 애매 — 안 삼킨다").toBeNull();
  });

  it("★ dispatcher 경유 — 「내문서」가 지어낸 답이 아니라 내 문서 카드로 온다 (QA 결함 1호)", async () => {
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const r = await dispatchInstruction("내문서 확인", undefined, undefined, undefined, true);
    expect(r.dataCard?.title).toContain("내 문서");
    expect(r.output).not.toContain("수정 중"); // 날조된 상태 문구가 아니다
  });

  it("★ 내 문서 겨냥 문장 — 개인 조각 0건이면 지어내지 않고 「못 찾았다」로 (QA 결함 1b)", async () => {
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const r = await dispatchInstruction("내 문서에 서버 실행 오류 해결법 있어?", undefined, undefined, undefined, true);
    expect(r.output).toContain("내 문서에서 찾지 못했습니다");
    expect(r.sources).toEqual([]); // 무관 회사 문서가 근거 배지로 붙지 않는다
    // 쓰기 지시는 이 가드가 삼키지 않는다(찾기가 아니다)
    const w = await dispatchInstruction("이 내용 내 문서에 저장해줘", undefined, undefined, undefined, true);
    expect(String(w.output)).not.toContain("내 문서에서 찾지 못했습니다");
  });

  it("★ dispatcher 경유 — 「자산고르기」가 일반론이 아니라 자산 카드로 온다", async () => {
    registerAsset({ id: "dc-sn1", name: "이름-자산", path: "-", assetType: "서버" });
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const r = await dispatchInstruction("자산고르기", undefined, undefined, undefined, true);
    expect(r.dataCard?.title).toContain("자산 — 등록 현황");
    expect(r.output).not.toContain("핵심 단계"); // LLM 개념 설명이 아니다
  });
});

describe("발견·수집(관제) 카드", () => {
  it("트리거 — 관제 현황만 받고 기존 영토(검증·자산·취약점)는 지나간다", async () => {
    const { isOpsStatusAsk } = await import("../src/engine/datacard");
    expect(isOpsStatusAsk("통합 관제 현황 알려줘")).toBe(true);
    expect(isOpsStatusAsk("발견 수집 현황 보여줘")).toBe(true);
    expect(isOpsStatusAsk("검증 현황 보여줘")).toBe(false);
    expect(isOpsStatusAsk("자산 현황 어때")).toBe(false);
    expect(isOpsStatusAsk("관제 이벤트 처리해줘"), "실행 지시").toBe(false);
  });

  it("KPI·표가 이벤트 원장과 일치한다(취약점 반입 → 이벤트 재구성으로 시드)", async () => {
    resetAssetsForTests();
    registerAsset({ id: "dc-ops1", name: "관제-자산", path: "-", assetType: "서버" });
    recordFindings("dc-ops1", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "CVE-2026-1", source_tool: "s", kev: true, kevCves: ["CVE-2026-1"] },
    ]);
    const { rebuildVulnEvents } = await import("../src/engine/analysishub");
    rebuildVulnEvents();
    const { opsStatusAnswer } = await import("../src/engine/datacard");
    const { dataCard, output } = await opsStatusAnswer();
    expect(Number(dataCard.kpis[0].value)).toBeGreaterThanOrEqual(1); // 열린 이벤트
    expect(dataCard.table!.shown[0].소스).toBe("취약점");
    expect(dataCard.screen).toEqual({ page: "discover.html", label: "발견·수집" });
    expect(output).toContain("통합 관제");
  });
});

describe("dispatcher 경유 — 카드가 응답에 실린다", () => {
  beforeEach(() => resetHardeningForTests());

  it("검증 현황 물음이 dataCard를 달고 돌아온다", async () => {
    const t = createTarget({ label: "경유-장비", host: "local", port: 22, authMethod: "local" });
    createSchedule(t.id, "kisa", 24);
    await runDueSchedules(Date.now(), () => fakeRunner());
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const r = await dispatchInstruction("검증 현황 보여줘", undefined, undefined, undefined, true);
    expect(r.dataCard, "카드가 응답에 실려야 한다").toBeTruthy();
    expect(r.dataCard!.table!.shown[0].장비).toBe("경유-장비");
    expect(r.output).toContain("검증(보안설정 점검) 현황"); // 옛 클라 호환 글 답도 함께
  });

  it("2차: 자산 현황 물음이 자산 카드를, 취약점 물음이 우선순위 KPI 카드를 달고 온다", async () => {
    resetAssetsForTests();
    registerAsset({ id: "dc-d1", name: "경유-자산", path: "-", assetType: "서버" });
    recordFindings("dc-d1", [
      { finding_type: "원격코드실행", severity: "critical", evidence: "e", source_tool: "s" },
    ]);
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const a = await dispatchInstruction("자산 현황 보여줘", undefined, undefined, undefined, true);
    expect(a.dataCard?.title).toBe("자산 — 등록 현황");
    expect(a.dataCard?.table?.shown[0].자산).toBe("경유-자산");
    const f = await dispatchInstruction("미조치 취약점 뭐 있어?", undefined, undefined, undefined, true);
    expect(f.dataCard?.title).toContain("우선순위");
    expect(f.picklist, "체크칸(조치용)이 카드에 밀려 죽으면 안 된다").toBeTruthy();
    expect(f.dataCard?.table).toBeUndefined();
  });
});

describe("배선 감시 — 부품을 만들고 안 부르는 반쪽을 막는다", () => {
  const pages = join(__dirname, "..", "..", "client", "src", "renderer", "pages");
  it("chatparts.js가 dataCard 부품을 내놓는다", () => {
    const s = readFileSync(join(pages, "chatparts.js"), "utf8");
    expect(s).toContain("function dataCard(");
    expect(s).toMatch(/dataCard:\s*dataCard/);
    expect(s, "클라는 자르지 않는다 — 서버 shown 그대로").toContain("dc.table.shown");
  });
  it("지휘소(console.js)와 분리창(chatwidget.js) 둘 다 부른다 — 한쪽만 고치는 함정", () => {
    for (const f of ["console.js", "chatwidget.js"]) {
      const s = readFileSync(join(pages, f), "utf8");
      expect(s, `${f}에 P.dataCard 배선이 있어야 한다`).toContain("P.dataCard");
    }
  });
  it("지휘소 행 클릭은 setSelection으로 간다(📌 선택)", () => {
    const s = readFileSync(join(pages, "console.js"), "utf8");
    const 배선 = s.slice(s.indexOf("P.dataCard"), s.indexOf("P.dataCard") + 1200);
    expect(배선).toContain("setSelection");
  });
});

describe("분기 순서 — 화면이름 카드가 모호 되묻기보다 앞이다", () => {
  // 2026-08-20 사장님 실측: 「자산」(2글자)을 쳤는데 카드가 아니라 「무엇을 도와드릴까요」가
  // 나왔다 — isTooVague의 「두 글자 이하」 규칙이 자산·관제·검증(전부 2글자)을 먼저 삼켰다.
  // 좁은 판정(화면이름 정확 일치)이 넓은 판정(모호)보다 앞이어야 한다(분기 순서가 기능을 죽인다).
  it("★ dispatcher에서 screenNameCard 분기가 isTooVague 분기보다 앞에 있다", () => {
    const s = readFileSync(join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    const 카드 = s.indexOf("screenNameCard(instructionText)");
    const 모호 = s.indexOf("isTooVague(instructionText)");
    expect(카드, "화면이름 카드 분기가 없다").toBeGreaterThan(-1);
    expect(모호, "모호 분기가 없다 — 지웠으면 '1'·'ㅁ' 입력이 LLM으로 흘러간다").toBeGreaterThan(-1);
    expect(카드, "카드 분기가 모호 분기 뒤로 밀리면 2글자 화면 이름이 삼켜진다").toBeLessThan(모호);
  });
  it("2글자 화면 이름(자산·관제·검증)이 전부 카드 맵에 있다", async () => {
    const { screenNameCard } = await import("../src/engine/datacard.js");
    expect(screenNameCard("자산")).toBe("asset");
    expect(screenNameCard("관제")).toBe("ops");
    expect(screenNameCard("검증")).toBe("hardening");
  });
});

describe("화면 열기 → 현황 카드 (2026-08-20 사장님 — 「메뉴를 누르면 대화창에 상위 카드」)", () => {
  const 클라 = join(__dirname, "..", "..", "client");
  it("서버 라우트가 등록돼 있고 화면 4갈래(자산·관제·검증·우선순위)를 안다", () => {
    const dc = readFileSync(join(__dirname, "..", "src", "engine", "datacard.ts"), "utf8");
    expect(dc).toContain('app.get("/api/screen-card"');
    for (const p of ["assets.html", "analysis.html", "hardening.html", "vulnscan.html"]) {
      expect(dc, `화면파일카드에 ${p}가 없다`).toContain(`"${p}"`);
    }
    const appTs = readFileSync(join(__dirname, "..", "src", "app.ts"), "utf8");
    expect(appTs, "라우트를 만들고 등록을 안 했다(만들어만 두는 함정)").toContain("registerScreenCardRoute(app)");
  });
  it("배선 사슬이 이어져 있다 — 셸 open → 콘솔 screenCard → preload → API", () => {
    const app = readFileSync(join(클라, "src", "renderer", "pages", "app.html"), "utf8");
    expect(app, "셸 open()이 콘솔을 안 부른다").toContain("gijoConsole.screenCard(page");
    const cs = readFileSync(join(클라, "src", "renderer", "pages", "console.js"), "utf8");
    expect(cs, "콘솔에 screenCard가 없다").toContain("function screenCard(");
    expect(cs, "gijoConsole에 노출 안 됨").toContain("screenCard: screenCard");
    expect(cs, "같은 화면 연속 열기 도배 방지가 없다").toContain("화면카드직전");
    const pre = readFileSync(join(클라, "src", "preload.ts"), "utf8");
    expect(pre, "preload 노출이 없다(clientglobals 계약)").toContain("screenCard:");
    const api = readFileSync(join(클라, "src", "api", "console.ts"), "utf8");
    expect(api).toContain("/api/screen-card?page=");
  });
});

describe("신설 카드 7종 — 생산자 정직 감시(검토관 2026-08-20 상 1~3의 재발 방지)", () => {
  const 소스 = readFileSync(join(__dirname, "..", "src", "engine", "datacard.ts"), "utf8");
  it("보고 카드의 스케줄은 reportschedule.ts가 생산한다(옵셔널 체크 금지 — 영원한 0)", () => {
    expect(소스).toContain('require("./reportschedule")');
    expect(소스, "listSchedules를 옵셔널로 감싸면 없는 생산자를 조용히 0으로 만든다").not.toMatch(/listSchedules\s*\?/);
  });
  it("조치 카드 검토 대기는 스캔 실패·info를 거른다(602 vs 3 실사고 규칙)", () => {
    const 함수 = 소스.slice(소스.indexOf("function fixStatusAnswer"), 소스.indexOf("function reportStatusAnswer"));
    expect(함수).toContain("isRealVulnerability");
  });
  it("위협 카드 「수집 중」은 connected+collects만 센다(시드·지원예정 거짓 초록 금지)", () => {
    const 함수 = 소스.slice(소스.indexOf("function threatStatusAnswer"), 소스.indexOf("function aiteamStatusAnswer"));
    expect(함수).toContain("f.connected && f.collects");
    expect(함수, "CtiFeedPublic에 없는 필드를 찍으면 전 행이 -가 된다").not.toContain("itemCount");
  });
  it("작업내역 카드는 QA·시스템 세션을 제외하고 센다(화면 기본 보기와 같은 모집단)", () => {
    const 함수 = 소스.slice(소스.indexOf("function sessionsStatusAnswer"), 소스.indexOf("function fixStatusAnswer"));
    expect(함수).toContain("listSessionsFiltered");
    expect(함수).toContain('origin: "user"');
    expect(함수).toContain("includeQa: false");
  });
});
