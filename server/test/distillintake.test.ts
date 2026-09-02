// distillintake.test.ts — 증류 편입 계약 (증류학습 계획서 §3.5 · 설계관 ★4·6·8·12, 2026-09-03).
//
// 지키는 것 넷: ① rating NULL(승인은 사람) ② 제외 규칙을 넣기 전에 지난다 ③ 근거 20자 겹침 없으면 안 받는다
// ④ 거절 사유를 건별로 돌려준다(폐기율 = 교사 품질 지표). 그리고 admin만.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { resetLearnloopForTests, listChatLogs } from "../src/engine/learnloop";
import { intakeDistilledCandidates, listLearnCandidates, 근거겹침 } from "../src/engine/learncandidates";

const candSrc = readFileSync(join(__dirname, "..", "src", "engine", "learncandidates.ts"), "utf8");

const 근거 = "취약점 조치 우선순위는 CVSS 점수만이 아니라 실제 악용 여부와 자산의 외부 노출 여부, 자산 중요도를 함께 보아 정한다. 악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치한다.";
const 좋은답 = "취약점 조치 우선순위는 CVSS 점수만이 아니라 실제 악용 여부와 자산의 외부 노출 여부, 자산 중요도를 함께 보아 정합니다. 특히 악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치해야 합니다.";

describe("증류 편입", () => {
  beforeEach(() => resetLearnloopForTests());

  it("근거와 20자 이상 겹치는 답만 rating NULL·origin distill로 들어가 후보함(출처 증류)에 뜬다", () => {
    const r = intakeDistilledCandidates("qwen38-flash-next", [
      { question: "취약점 조치 우선순위는 어떻게 정하나요?", answer: 좋은답, topic: "취약점", cites: [{ ref: "knowledge/a.md#abc123", text: 근거 }], promptHash: "h1" },
    ]);
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([]);
    const { logs } = listChatLogs(10, 0);
    expect(logs[0].rating).toBeNull();
    expect(logs[0].origin).toBe("distill");
    expect(logs[0].teacher).toBe("qwen38-flash-next");
    expect(logs[0].cites).toEqual(["knowledge/a.md#abc123"]);
    expect(logs[0].topic).toBe("취약점");
    const { candidates } = listLearnCandidates(30, 60);
    expect(candidates.some((c) => c.source === "distill" && c.signals.cite)).toBe(true);
  });

  it("근거 겹침이 없으면 거절하고 사유를 돌려준다 — 교사 환각을 학습하지 않는다", () => {
    const r = intakeDistilledCandidates("t", [
      { question: "취약점 조치 우선순위는 어떻게 정하나요?", answer: "우선순위는 담당자의 감으로 정하면 되고 심각도 표시는 참고만 하면 충분합니다. 특별한 규칙은 없습니다.", topic: "취약점", cites: [{ ref: "x#1", text: 근거 }] },
    ]);
    expect(r.accepted).toBe(0);
    expect(r.rejected[0].reason).toMatch(/근거 겹침 없음/);
    expect(r.byReason[r.rejected[0].reason]).toBe(1);
  });

  it("주제를 못 정하면 거절한다(억지 딱지 금지) · 같은 문답은 한 번만", () => {
    const item = { question: "그거 어떻게 해?", answer: 좋은답, cites: [{ ref: "x#1", text: 근거 }] };
    expect(intakeDistilledCandidates("t", [item]).rejected[0].reason).toBe("주제 없음");
    const ok = { ...item, question: "취약점 조치 우선순위는 어떻게 정하나요?", topic: "취약점" };
    expect(intakeDistilledCandidates("t", [ok, ok]).byReason["이미 있음"]).toBe(1);
  });

  it("ref 꼬리(sha12)가 본문 해시와 다르면 거절한다 — 표시되는 근거가 검증된 것이어야 한다", () => {
    const r = intakeDistilledCandidates("t", [
      { question: "취약점 조치 우선순위는 어떻게 정하나요?", answer: 좋은답, topic: "취약점", cites: [{ ref: "knowledge/a.md#000000000000", text: 근거 }] },
    ]);
    expect(r.accepted).toBe(0);
    expect(r.rejected[0].reason).toMatch(/근거 ref 불일치/);
  });

  it("증류 후보는 실대화 뒤에 붙고 점수 0(일괄 승인 대상 아님), KPI는 따로 센다", () => {
    intakeDistilledCandidates("t", [
      { question: "취약점 조치 우선순위는 어떻게 정하나요?", answer: 좋은답, topic: "취약점", cites: [{ ref: "x#1", text: 근거 }] },
    ]);
    const { candidates, kpis } = listLearnCandidates(30, 60);
    const d = candidates.find((c) => c.source === "distill")!;
    expect(d.score).toBe(0);
    expect(d.signals.cite).toBe(true);
    expect(kpis.distill).toBe(1);
    expect(kpis.candidates).toBe(0); // 실대화·작업내역 기준
  });

  it("교사 id가 없으면 넣지 않는다 — 「무엇으로 배웠나」를 잃지 않기 위해", () => {
    expect(() => intakeDistilledCandidates("", [])).toThrow(/teacher/);
  });

  it("근거겹침은 공백을 무시하고 20자 창으로 본다", () => {
    expect(근거겹침("악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치", 근거)).toBeTruthy();
    expect(근거겹침("전혀 다른 내용의 문장입니다", 근거)).toBeNull();
  });

  it("라우트 계약 — admin만 · 제외 규칙 경유 · rating NULL", () => {
    expect(candSrc).toMatch(/"\/api\/learnloop\/distill\/intake", authMiddleware, adminMiddleware/);
    const fn = candSrc.slice(candSrc.indexOf("export function intakeDistilledCandidates"), candSrc.indexOf("export function registerLearnCandidateRoutes"));
    expect(fn).toContain("excluded(q, a)");
    expect(fn).toContain("insertDistillStmt.run(");
    expect(candSrc).toMatch(/insertDistillStmt = db\.prepare\([\s\S]*NULL, 0, @createdAt, @topic, 'distill'/);
  });
});
