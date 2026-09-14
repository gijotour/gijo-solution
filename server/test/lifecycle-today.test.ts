// 계획서: 중-7 + 전-4 — 📅 계약·생애주기가 "오늘의 할 일" device 축 **세 번째 원천**으로
// 얹히는지를 today.ts 쪽에서 잰다(L1의 lifecycle.ts 자체 계산 — 배지 경계값 등 — 은
// server/test/lifecycle.test.ts가 진다. 이 파일은 today.ts의 소비 쪽만 본다).
//
// 승인 시안 mockups/asset-lifecycle/시안.html §5-d·§13(today.ts:229-283 deviceItems() 세 번째
// 원천 자리) — TodayItem 인터페이스(:28-41)는 그대로 재사용하고 새 axis를 만들지 않는다.
import { describe, it, expect, beforeEach, vi } from "vitest";

// LLM 스텁 — buildToday(false)로 부르므로 실제로는 안 불리지만, today.ts가 동적 import하는
// 모듈 표면은 다른 시험(today.test.ts)과 같은 이유로 맞춰 둔다(안 맞으면 그 모듈을 import하는
// 파일이 통째로 죽는다 — 2026-08-29 화살 #14·#15 실사고).
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => ""),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { buildToday } from "../src/engine/today";
import { resetAssetsForTests } from "../src/engine/assets";
import { resetMaintenanceForTests } from "../src/engine/maintenance";
import { resetHardeningForTests } from "../src/engine/hardeningtargets";
import { resetApprovalsForTests } from "../src/engine/approvals";
import { saveLifecycle, 오늘글 } from "../src/engine/lifecycle";
import { db } from "../src/db";

/** 오늘 기준 +offsetDays의 YYYY-MM-DD. */
function 날짜(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return 오늘글(d);
}

describe("오늘의 할일 — 📅 계약·생애주기(device 축 세 번째 원천)", () => {
  beforeEach(() => {
    resetAssetsForTests();
    resetApprovalsForTests();
    resetMaintenanceForTests();
    resetHardeningForTests();
    // lifecycle.ts는 resetForTests를 내보내지 않는다(계약 표에 없음) — alertschedule.test.ts와
    // 같은 방식(db.exec 직접)으로 표를 비운다.
    db.exec("DELETE FROM asset_lifecycle");
  });

  it("ⓐ 계약 0건이면 device 항목이 늘지 않는다", async () => {
    const t = await buildToday(false);
    expect(t.items.filter((i) => i.axis === "device").length).toBe(0);
    expect(t.items.some((i) => i.id === "lifecycle")).toBe(false);
  });

  it("ⓑ 30일 이내 2건이면 항목이 정확히 1개 늘고 title에 2건이 들어간다", async () => {
    saveLifecycle("asset", "asset-lc-1", { eol: 날짜(5) });
    saveLifecycle("product", "prod-lc-1", { maintenanceEnd: 날짜(10) });
    const t = await buildToday(false);
    const lc = t.items.filter((i) => i.id === "lifecycle");
    expect(lc.length).toBe(1);
    expect(lc[0].axis).toBe("device");
    expect(lc[0].title).toContain("2건");
    expect(lc[0].title).toContain("계약·생애주기");
    // 가장 이른 것(+5일)이 앞선다 — listLifecycleDueSoon이 dday 오름차순 정렬이다.
    expect(lc[0].subtitle).toContain("D-5");
    expect(lc[0].badges).toEqual(["D-5"]);
  });

  it("ⓒ 31~90일짜리만 있으면 안 는다(임박일=30 잣대)", async () => {
    saveLifecycle("asset", "asset-lc-2", { eol: 날짜(60) });
    const t = await buildToday(false);
    expect(t.items.some((i) => i.id === "lifecycle")).toBe(false);
    expect(t.items.filter((i) => i.axis === "device").length).toBe(0);
  });

  it("ⓓ axis는 전부 vuln|device뿐이다(새 축을 안 만든다)", async () => {
    saveLifecycle("asset", "asset-lc-3", { eol: 날짜(1) });
    const t = await buildToday(false);
    expect(t.items.every((i) => i.axis === "vuln" || i.axis === "device")).toBe(true);
  });

  it("ⓔ 날짜를 못 읽는 행만 있으면 안 는다(ⓜ 폴백 — 확인 필요는 할 일이 아니다)", async () => {
    // eol을 날짜 꼴이 아닌 문자열로 저장 — saveLifecycle은 저장 시 형식을 검증하지 않는다
    // (형식 검증은 set_lifecycle 도구의 validate()가 맡는다, L1 registry.ts 쪽). lifecycle.ts의
    // 남은일수()가 ^\d{4}-\d{2}-\d{2}$가 아니면 null을 돌려주므로 후보에서 빠진다.
    saveLifecycle("asset", "asset-lc-4", { eol: "확인 필요" });
    const t = await buildToday(false);
    expect(t.items.some((i) => i.id === "lifecycle")).toBe(false);
    expect(t.items.filter((i) => i.axis === "device").length).toBe(0);
  });

  it("종료(dday<0)도 만료 임박에 섞여 들어간다 — 「지원 종료」 글자로 표시", async () => {
    saveLifecycle("asset", "asset-lc-5", { eol: 날짜(-3) });
    const t = await buildToday(false);
    const lc = t.items.find((i) => i.id === "lifecycle");
    expect(lc).toBeTruthy();
    expect(lc!.subtitle).toContain("지원 종료");
    expect(lc!.badges).toEqual(["지원 종료"]);
  });
});
