// 인수인계 자동 검증(verifyHandover) — 판정 로직을 주입 의존성으로 검증한다(실 LLM·DB 불필요).
// 실 환경 end-to-end는 운영에서 /api/handover/verify 호출로 별도 확인한다.
import { describe, expect, it } from "vitest";
import { verifyHandover, type HandoverDeps } from "../src/engine/handover";

function deps(over: Partial<HandoverDeps> = {}): HandoverDeps {
  return {
    sampleOf: async () => "방화벽 반복 차단 IP는 30분 내 3회 이상이면 격리 절차를 시작한다.",
    genQuestion: async () => "방화벽에서 반복 차단되는 IP는 어떻게 처리해?",
    ask: async () => ({ output: "격리 절차를 시작합니다.", sources: ["fw_절차.md"] }),
    ...over,
  };
}

describe("verifyHandover", () => {
  it("답변 근거(sources)에 해당 문서가 오르면 cited=true — 이관 성공", async () => {
    const r = await verifyHandover(["fw_절차.md"], deps());
    expect(r.results[0].cited).toBe(true);
    expect(r.passRate).toBe(100);
  });

  it("근거에 다른 문서만 오르면 cited=false — 검색이 그 문서를 못 찾은 것", async () => {
    const r = await verifyHandover(["fw_절차.md"], deps({ ask: async () => ({ output: "…", sources: ["엉뚱한.md"] }) }));
    expect(r.results[0].cited).toBe(false);
    expect(r.passRate).toBe(0);
  });

  it("문서 조각이 없으면(미인입) error를 남기고 계속 진행한다", async () => {
    const r = await verifyHandover(["없는문서.md", "fw_절차.md"], deps({ sampleOf: async (id) => (id === "없는문서.md" ? null : "본문") }));
    expect(r.results[0].error).toContain("찾지 못했습니다");
    expect(r.results[1].cited).toBe(true);
    expect(r.total).toBe(2);
    expect(r.passRate).toBe(50);
  });

  it("질문 생성 실패(LLM 다운)면 문서명 기반 폴백 질문으로 검증을 계속한다", async () => {
    const r = await verifyHandover(["EDR_manual_예외정책.md"], deps({ genQuestion: async () => { throw new Error("down"); } }));
    expect(r.results[0].question).toContain("EDR manual 예외정책");
    expect(r.results[0].cited).toBe(false); // sources는 fw_절차.md라 미인용
  });

  it("배치 상한(10)을 지킨다 — 문서당 LLM 2회라 폭주 방지", async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `doc${i}.md`);
    const r = await verifyHandover(ids, deps());
    expect(r.total).toBe(10);
  });

  it("디스패치 예외는 그 문서만 error 처리하고 나머지는 계속한다", async () => {
    let n = 0;
    const r = await verifyHandover(["a.md", "b.md"], deps({ ask: async () => { if (++n === 1) throw new Error("boom"); return { output: "ok", sources: ["b.md"] }; } }));
    expect(r.results[0].error).toBe("boom");
    expect(r.results[1].cited).toBe(true);
  });
});
