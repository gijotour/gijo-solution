// 하지 않은 일을 했다고 말하지 않는가 — 거짓 완료 관문(전-2/후-6 정직성).
//
// 실사고(2026-08-09 평가 게이트 write-approval-register):
//   지시 "새 서버 10.0.0.99를 자산으로 등록해줘" → 라우팅이 잡담으로 샘 →
//   답 "10.0.0.99 IP 주소의 서버를 자산으로 등록하였습니다." → **등록부 0건**.
import { describe, it, expect } from "vitest";
import { 거짓완료차단, 쓰기지시인가, 완료를주장하는가 } from "../src/engine/falseclaim";
import { forcedToolFor } from "../src/engine/agentloop";

describe("거짓 완료 관문", () => {
  it("실사고 그대로 — 쓰기 지시에 「등록하였습니다」로 답하면 막는다", () => {
    const r = 거짓완료차단(
      "새 서버 10.0.0.99를 자산으로 등록해줘",
      "10.0.0.99 IP 주소의 서버를 자산으로 등록하였습니다. 해당 자산에 대한 자세한 정보는 Tenable Security Center에서 확인할 수 있습니다.",
    );
    expect(r.막았나).toBe(true);
    expect(r.답).toContain("아직 아무것도 바꾸지 않았습니다");
    expect(r.답).not.toContain("Tenable");
  });

  it("도구가 실제로 돌았으면 통과시킨다 — 그때는 사실이다", () => {
    const r = 거짓완료차단("자산 등록해줘", "자산을 등록했습니다.", true);
    expect(r.막았나).toBe(false);
    expect(r.답).toBe("자산을 등록했습니다.");
  });

  it("조회 질문은 건드리지 않는다", () => {
    const r = 거짓완료차단("자산 몇 개야?", "자산 58건입니다.");
    expect(r.막았나).toBe(false);
  });

  it("「등록하면 됩니다」 같은 안내는 완료 주장이 아니다", () => {
    expect(완료를주장하는가("자산 화면에서 등록하면 됩니다.")).toBe(false);
    expect(완료를주장하는가("등록하시려면 대화창에 적어 주세요.")).toBe(false);
  });

  it("시키는 말과 묻는 말을 가른다", () => {
    expect(쓰기지시인가("담당자 배정해줘")).toBe(true);
    expect(쓰기지시인가("이 취약점을 오탐으로 표시해줘")).toBe(true);
    expect(쓰기지시인가("담당자가 누구야?")).toBe(false);
  });
});

describe("자산 등록 라우팅 — 조사 하나로 새지 않는가", () => {
  // 「…를 자산으로 등록해줘」가 (을|를)에만 걸려 있어 빠져나갔다.
  const 등록말 = [
    "새 서버 10.0.0.99를 자산으로 등록해줘",
    "자산 등록해줘",
    "새 자산 등록할게",
    "장비를 추가하고 싶어",
    "이 호스트를 자산으로 추가해줘",
  ];
  for (const m of 등록말) {
    it(`「${m}」 → register_asset`, () => {
      expect(forcedToolFor(m)?.tool).toBe("register_asset");
    });
  }

  // 조회는 그대로 다른 곳으로 가야 한다(등록으로 끌고 오면 결재판이 헛뜬다).
  for (const m of ["우리 자산 몇 대야?", "자산 목록 보여줘"]) {
    it(`「${m}」 → register_asset 아님`, () => {
      expect(forcedToolFor(m)?.tool).not.toBe("register_asset");
    });
  }
});

// ── 관문이 출구 한 곳에 있는가 (소스 감시) ────────────────────────────────────
// 갈래(잡담·리포트·분석·오케스트레이션)마다 심으면 새 갈래가 생길 때 또 샌다.
// 실측(2026-08-09): 처음엔 잡담 갈래에만 붙여 리포트·계획 갈래가 그대로 열려 있었다.
describe("거짓 완료 관문은 대화창 출구 한 곳에 있다", () => {
  it("dispatchInstruction이 결과를 걸러 낸 뒤 돌려준다", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    expect(src, "출구 함수가 없다").toContain("function 거짓완료를걸러낸다");
    expect(src, "출구에서 안 부르면 아무 갈래도 안 걸린다").toContain("return 거짓완료를걸러낸다(instructionText, result)");
  });

  it("갈래마다 흩어 놓지 않는다 — 관문 호출은 출구 한 곳뿐", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    const 호출 = (src.match(/거짓완료차단\(/g) ?? []).length;
    expect(호출, "관문을 두 곳 이상에서 부르면 갈래 관리로 되돌아간 것이다").toBe(1);
  });

  it("도구가 돈 답과 결재판은 통과시킨다(계약)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    expect(src).toContain("if (r.approval || r.confirm) return r;");
    expect(src).toContain("!!r.toolCalls?.length");
  });
});
