// 미점검 하드닝 조회 라우팅 — 2026-09-10 고객 QA 예행 ㉔ / 계획서 전-7
//
// 뿌리: 「점검 안 한 장비 있어?」가 강제 규칙 없이 ⑨ 모델 선택으로 새 SBOM·지원종료
//   화면으로 갔다(결함 3). 「보안설정 점검 안 한 장비 있어?」는 반대로 FORCED_INTENTS[3]
//   (run_hardening_scan)에 걸려 **우리 호스트 자신**의 하드닝 결과(준수율·U-02…)가 그대로
//   나갔다 — 고객 인스턴스(4100)에서는 형태 ⓑ 격리 전제 위반이다.
// 고친 것 둘(이중 방어):
//   ① datacard.isHardeningStatusAsk — 「안 했다/조회」 꼴도 받아 [17] 특수경로(카드)로 보낸다.
//   ② agentloop FORCED_INTENTS[3](run_hardening_scan) 정규식 — 조회·부정형 낱말이 있으면
//      run_hardening_scan을 안 잡는다.
// screenguide.ts verify.html can[]이 이미 「점검 안 한 장비 있어?」를 제품이 답할 말로
//   약속하고 있었다(대장 문서 GIJO_AS_대화시나리오_대장_2026-08-19.md:277에 기록된 공백).
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { isHardeningStatusAsk, hardeningStatusAnswer } from "../src/engine/datacard";
import { resetHardeningForTests } from "../src/engine/hardeningtargets";
import { 실제도착 } from "./helpers/routing";

// ⚠ FAIL_MARKS는 **글자로 베끼지 않는다** — drawer-audit.mjs를 읽어 배열을 뽑는다
//   (approvalstatustool.test.ts:26-38과 같은 관례. 베끼면 두 곳이 어긋난다).
function FAIL_MARKS목록(): string[] {
  const 경로 = path.join(__dirname, "..", "..", "tools", "drawer-audit.mjs");
  const src = fs.readFileSync(경로, "utf8");
  const 시작 = src.indexOf("const FAIL_MARKS = [");
  if (시작 < 0) throw new Error("FAIL_MARKS를 못 찾았다 — drawer-audit.mjs가 낡았다(이 시험을 손볼 것)");
  const 끝 = src.indexOf("];", 시작);
  const 몸통 = src.slice(시작, 끝);
  const 마크 = [...몸통.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (마크.length === 0) throw new Error("FAIL_MARKS를 하나도 못 뽑았다 — 추출 정규식이 낡았다");
  return 마크;
}

describe("① isHardeningStatusAsk — 미점검 조회 갈래", () => {
  it("★ 예행 ㉔ + 실측 신규 양성 — 조회 꼴을 잡는다", () => {
    for (const q of [
      "점검 안 한 장비 있어?",
      "보안설정 점검 안 한 장비 있어?",
      "하드닝 점검 안 한 서버 있어?",
      "보안설정 점검 안 한 대상 있어?",
      "미점검 장비 어디야?",
      "점검 안 한 시스템 목록 보여줘",
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(true);
    }
  });

  it("★ 뺏김 0 — 이웃 영토(asset_coverage·finding_status)는 그대로 비켜 준다", () => {
    for (const q of [
      "미점검 대상 몇 개야?",           // finding_status류 — 조회말에 「몇」이 없다
      "점검 안 된 자산 어떻게 처리해?", // asset_coverage — 「자산」이웃영토
      "점검 안 한 자산 있어?",          // asset_coverage — 「자산」이웃영토
      "유지보수 점검 뭐 남았어?",       // maintenance_status 영토
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(false);
    }
  });

  it("기존 음성(datacard.test.ts와 같은 계약) — 실행·스케줄·절차·취약점은 여전히 비켜 준다", () => {
    for (const q of [
      "하드닝 점검 돌려줘", "보안설정 점검 해줘",
      "하드닝 점검 스케줄 알려줘", "점검 일정 보여줘",
      "방화벽 월간 정기점검 절차를 알려줘", "하드닝 점검 방법 알려줘",
      "보안설정 점검 어떻게 하는지 알려줘", "정기점검 매뉴얼 보여줘",
      "취약점 현황 보여줘", "스캔결과 상태 알려줘",
      "자산 현황 보여줘", "",
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(false);
    }
  });

  it("기존 양성 반례 — 결과·현황은 여전히 카드다", () => {
    for (const q of ["하드닝 점검 결과 알려줘", "보안설정 점검 현황", "검증 현황 보여줘"]) {
      expect(isHardeningStatusAsk(q), q).toBe(true);
    }
  });
});

describe("② 실제 도착 — 강제도구(FORCED_INTENTS[3])가 조회 꼴을 안 잡는다(2차 방어)", () => {
  it("조회 꼴은 run_hardening_scan에 안 닿는다", () => {
    for (const q of ["보안설정 점검 안 한 장비 있어?", "하드닝 점검 안 한 서버 있어?", "점검 안 한 장비 목록 보여줘"]) {
      expect(실제도착(q), q).not.toBe("run_hardening_scan");
    }
  });
  it("실행 지시는 여전히 run_hardening_scan에 닿는다(유지)", () => {
    for (const q of [
      "보안장비 하드닝 점검 실행해줘", "CCE 기준 점검 돌려줘", "하드닝 점검해줘",
      "하드닝 점검 돌려줘", "보안설정 점검 해줘", "CIS 기준으로 점검해줘",
      "네트워크 장비 점검해줘", "내 PC 보안설정 점검해줘", "취약점 진단해줘",
    ]) {
      expect(실제도착(q), q).toBe("run_hardening_scan");
    }
  });
});

describe("③ 0-대상 안내 — FAIL_MARKS에 안 걸린다", () => {
  beforeEach(() => resetHardeningForTests());

  it("등록 대상 0일 때 안내 문구가 폴백 문구 감시에 안 걸린다", () => {
    const { output } = hardeningStatusAnswer();
    expect(output).toContain("등록된 점검 대상이 없습니다");
    const 마크 = FAIL_MARKS목록();
    const 걸린것 = 마크.filter((m) => output.includes(m));
    expect(걸린것, `0-대상 안내가 폴백 문구 감시에 걸렸다: ${걸린것.join(", ")}`).toEqual([]);
  });
});

describe("④ 소스 감시 — 만들어 두고 안 부르는 것 방지", () => {
  it("dispatcher.ts가 isHardeningStatusAsk(instructionText)를 실제로 부른다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    expect(src.includes("isHardeningStatusAsk(instructionText)"), "dispatcher.ts가 이 판별자를 안 부른다 — 표만 있고 실행이 없다").toBe(true);
  });
});
