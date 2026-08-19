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

import { isHardeningStatusAsk, hardeningStatusAnswer } from "../src/engine/datacard";
import {
  createTarget, createSchedule, runDueSchedules, resetHardeningForTests,
} from "../src/engine/hardeningtargets";
import type { RunFn } from "../src/engine/hardeningscan";

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

  it("🗔 화면 연결·📌 선택 열쇠가 계약대로다", () => {
    const { dataCard } = hardeningStatusAnswer();
    expect(dataCard.screen).toEqual({ page: "verify.html", label: "검증" });
    expect(dataCard.pickKey).toBe("장비");
    expect(dataCard.table.cols.find((c) => c.key === "준수율")?.align).toBe("num");
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
    expect(r.dataCard!.table.shown[0].장비).toBe("경유-장비");
    expect(r.output).toContain("검증(보안설정 점검) 현황"); // 옛 클라 호환 글 답도 함께
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
