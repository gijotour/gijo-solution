// ➡ 다음 작업 칩(QA ④, 2026-08-19) — 답마다 자동으로 붙는 후속 지시 제안.
//
// 위험은 하나: **눌렀는데 안 받아주는 칩**(막다른 길보다 나쁘다 — 없는 기능을 파는 것).
// 그래서 표의 문장은 시나리오 실측 보고서에서 ✓ 완주가 확인된 것만 쓰고, 이 시험이
// 표의 위생(빈 값·「안됨」 표기 유입·과다 개수)과 배선(서버→클라 3파일)을 지킨다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { nextChipsFor, routeFromParts } from "../src/engine/nextguide";
import { registerAsset, recordFindings, resetAssetsForTests } from "../src/engine/assets";

describe("표 위생", () => {
  it("모든 칩은 비어 있지 않고 「안됨」 표기가 없고 경로당 3개 이하다", async () => {
    const src = readFileSync(join(__dirname, "..", "src", "engine", "nextguide.ts"), "utf8");
    // 표에 등록된 모든 경로 이름을 소스에서 뽑아 실제 함수로 검사한다(사본 계산 금지).
    const 경로들 = [...src.matchAll(/^\s{2}(?:"([^"]+)"|([a-z_]+)):\s*\[/gm)].map((m) => m[1] || m[2]);
    expect(경로들.length).toBeGreaterThanOrEqual(20);
    for (const 경로 of 경로들) {
      const 칩 = nextChipsFor(경로);
      expect(칩.length, 경로).toBeGreaterThan(0);
      expect(칩.length, `${경로} — 3개 넘으면 제안이 아니라 소음`).toBeLessThanOrEqual(3);
      for (const c of 칩) {
        expect(c.trim().length, 경로).toBeGreaterThan(3);
        expect(c, `${경로} — 「안됨」 표기가 표에 새면 막다른 칩`).not.toMatch(/안됨|안 됨|도구 없음/);
      }
    }
  });
  it("모르는 경로는 빈 배열 — 지어내지 않는다", () => {
    expect(nextChipsFor("없는_경로")).toEqual([]);
    expect(nextChipsFor("")).toEqual([]);
  });
});

describe("경로 식별(routeFromParts)", () => {
  it("도구 답은 마지막 도구, 분기 답은 부품으로 식별한다", () => {
    expect(routeFromParts({ toolCalls: [{ tool: "search" }, { tool: "today" }] })).toBe("today");
    expect(routeFromParts({ picklist: { kind: "task" } })).toBe("분기:내업무");
    expect(routeFromParts({ picklist: { kind: "finding" } })).toBe("분기:우선순위");
    expect(routeFromParts({ dataCard: { title: "검증 — 보안설정 점검 현황" } })).toBe("분기:검증현황");
    expect(routeFromParts({ dataCard: { title: "자산 — 등록 현황" } })).toBe("분기:자산현황");
    expect(routeFromParts({})).toBeNull();
  });
});

describe("dispatcher 경유 — 답에 실려 나온다", () => {
  beforeEach(() => resetAssetsForTests());

  it("자산 현황 답에 다음 칩이 붙는다(카드 경로)", async () => {
    registerAsset({ id: "ng-a1", name: "칩-자산", path: "-", assetType: "서버" });
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const r = await dispatchInstruction("자산 현황 보여줘", undefined, undefined, undefined, true);
    expect(r.nextChips, "카드 답 끝에 다음 칩").toEqual(nextChipsFor("분기:자산현황"));
  });

  it("취약점 목록 답(체크칸 경로)에도 붙는다", async () => {
    registerAsset({ id: "ng-a2", name: "칩-자산2", path: "-", assetType: "서버" });
    recordFindings("ng-a2", [
      { finding_type: "약한 암호화", severity: "high", evidence: "TLS 1.0", source_tool: "s" },
    ]);
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const r = await dispatchInstruction("미조치 취약점 뭐 있어?", undefined, undefined, undefined, true);
    expect(r.nextChips).toEqual(nextChipsFor("분기:우선순위"));
  });
});

describe("배선 감시 — 부품·호출 두 자리", () => {
  const pages = join(__dirname, "..", "..", "client", "src", "renderer", "pages");
  it("chatparts.js가 nextChips 부품을 내놓는다", () => {
    const s = readFileSync(join(pages, "chatparts.js"), "utf8");
    expect(s).toContain("function nextChips(");
    expect(s).toMatch(/nextChips:\s*nextChips/);
  });
  it("지휘소·분리창 둘 다 **응답 처리 블록 안에서** 부른다 — 문자열 존재만 보면 IIFE 밖 죽은 줄도 통과한다(실사고: splice가 파일 끝에 떨어뜨려 칩이 영영 안 붙었다)", () => {
    const c = readFileSync(join(pages, "console.js"), "utf8");
    const i = c.indexOf("P.nextChips");
    expect(i).toBeGreaterThan(0);
    expect(i, "attachApproval(응답 처리 마지막) 앞에 있어야 같은 블록").toBeLessThan(c.indexOf("attachApproval(replyEl"));
    expect(i, "IIFE 닫힘 뒤(파일 꼬리)에 떨어지면 죽은 줄").toBeLessThan(c.lastIndexOf("})();"));
    const w = readFileSync(join(pages, "chatwidget.js"), "utf8");
    const iw = w.indexOf("P.nextChips");
    expect(iw).toBeGreaterThan(0);
    expect(iw, "P 가드 블록 안").toBeLessThan(w.lastIndexOf("})();"));
  });
});
