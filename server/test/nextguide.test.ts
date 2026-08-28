// ➡ 다음 작업 칩(QA ④, 2026-08-19) — 답마다 자동으로 붙는 후속 지시 제안.
//
// 위험은 하나: **눌렀는데 안 받아주는 칩**(막다른 길보다 나쁘다 — 없는 기능을 파는 것).
// 그래서 표의 문장은 시나리오 실측 보고서에서 ✓ 완주가 확인된 것만 쓰고, 이 시험이
// 표의 위생(빈 값·「안됨」 표기 유입·과다 개수)과 배선(서버→클라 3파일)을 지킨다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
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

  it("★ 승인 실행 뒤에도 칩이 붙는다 — 사슬이 가장 자주 죽던 자리(2026-08-20)", () => {
    // 실측: 시나리오 177단계 중 **37단계가 결재판**인데 승인 응답에 다음 걸음 안내가 없어
    // 매일 지나는 길목에서 대화가 끝났다. 표(nextguide)에는 쓰기 도구 4항목이 **적혀 있는데도**
    // 읽는 쪽이 없어 한 번도 발화된 적이 없었다 — 그 소비부를 계약으로 못박는다.
    const d = readFileSync(join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    const ap = d.indexOf('"/api/agent/approve"');
    expect(ap, "승인 라우트를 못 찾았다").toBeGreaterThan(0);
    const 승인블록 = d.slice(ap, ap + 9000);
    expect(승인블록, "승인 응답이 nextChips를 안 싣는다 — 표에 적힌 칩이 영영 발화되지 않는다")
      .toMatch(/nextChips/);
    // ⚠ **두 곳 다** 본다(2026-08-20 병렬 검토 중: 감시가 console.js만 봐서 반쪽 수리를
    //   계약으로 굳힐 뻔했다). 승인 창은 지휘소와 화면 안 챗 위젯 둘 다에 있다.
    for (const f of ["console.js", "chatwidget.js"]) {
      const c = readFileSync(join(pages, f), "utf8");
      const 승인후 = c.indexOf("approveAgentTool(ap.tool");
      expect(승인후, `${f}에 승인 실행 경로가 없다`).toBeGreaterThan(0);
      expect(c.slice(승인후, 승인후 + 1500), `${f}가 승인 응답의 nextChips를 안 그린다`)
        .toMatch(/nextChips/);
    }
  });
});
