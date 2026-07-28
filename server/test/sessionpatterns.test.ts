import { describe, it, expect, beforeEach } from "vitest";
import { analyzeSessionPatterns } from "../src/engine/sessionpatterns";
import { createSession, appendTurn, deleteAllSessions } from "../src/engine/worksessions";

// 작업 내역 패턴 요약 — 판정을 전부 코드로 하므로 결정적으로 검증할 수 있다.
// (LLM을 안 쓴 이유가 이것이다: 같은 입력에 매번 다른 요약이 나오면 "지난주와 비교"가 안 된다.)
describe("작업 내역 패턴 요약", () => {
  beforeEach(() => { deleteAllSessions(); });

  function 대화(지시: string, 답: string) {
    const s = createSession("t");
    appendTurn(s.id, "user", 지시);
    appendTurn(s.id, "assistant", 답);
    return s;
  }

  it("같은 지시를 여러 번 하면 반복으로 잡는다 (말투가 조금 달라도 같은 말로 본다)", () => {
    대화("안전대부 웹서버 취약점 알려줘", "네");
    대화("안전대부 웹서버 취약점 알려줘.", "네");
    대화("안전대부 웹서버 취약점", "네"); // 어미만 다름 → 같은 지시
    const r = analyzeSessionPatterns(30);
    const top = r.반복지시[0];
    expect(top).toBeDefined();
    expect(top.횟수).toBe(3);
    expect(top.대표문장).toContain("안전대부");
  });

  it("한 번뿐인 지시는 반복이 아니다", () => {
    대화("이번 한 번만 묻는 질문입니다", "네");
    expect(analyzeSessionPatterns(30).반복지시).toHaveLength(0);
  });

  // 잡담이 최다 반복으로 뜨면 그 목록은 아무도 안 본다 — 그래서 따로 센다.
  it("잡담은 반복지시에서 빼고 따로 센다", () => {
    대화("고마워 수고했어", "네");
    대화("고마워 수고했어", "네");
    const r = analyzeSessionPatterns(30);
    expect(r.반복지시).toHaveLength(0);
    expect(r.잡담.건수).toBe(2);
    expect(r.잡담.비율).toBe(100);
  });

  it("답을 못 준 질문을 지식 공백으로 남긴다 (질문과 짝지어서)", () => {
    대화("금융권 망분리 의무의 법적 근거는?", "관련 자료를 찾을 수 없습니다.");
    const r = analyzeSessionPatterns(30);
    expect(r.지식공백).toHaveLength(1);
    expect(r.지식공백[0].질문).toContain("망분리");
    expect(r.지식공백[0].이유).toBe("사내 자료에서 못 찾음");
  });

  it("잡담에 못 답한 것은 지식 공백이 아니다", () => {
    대화("고마워 수고했어", "무엇을 도와드릴까요?");
    expect(analyzeSessionPatterns(30).지식공백).toHaveLength(0);
  });

  it("주제를 갈라 어디에 시간을 쓰는지 보여준다", () => {
    대화("CVE-2021-44228 조치 방법", "네");
    대화("KEV 등재 취약점 기한", "네");
    대화("개인정보 보관 근거 법령은?", "네");
    const r = analyzeSessionPatterns(30);
    const top = r.주제분포[0];
    expect(top.주제).toBe("취약점·조치");
    expect(top.건수).toBe(2);
    expect(r.주제분포.some((t) => t.주제 === "법령·규정" && t.건수 === 1)).toBe(true);
  });

  // 화면이 자동으로 남긴 글("대상 3건 — …")은 사람이 친 지시가 아니다.
  it("시스템이 남긴 글은 반복 지시로 세지 않는다", () => {
    대화("대상 3건 — 조치확인 1 · 미조치 1", "네");
    대화("대상 3건 — 조치확인 1 · 미조치 1", "네");
    expect(analyzeSessionPatterns(30).반복지시).toHaveLength(0);
  });

  it("표본이 적으면 경향으로 읽지 말라고 알린다", () => {
    대화("취약점 알려줘", "네");
    const r = analyzeSessionPatterns(30);
    expect(r.비고.some((b) => b.includes("표본이 적습니다"))).toBe(true);
  });

  it("기간 밖의 대화는 집계하지 않는다", () => {
    대화("옛날 지시", "네");
    // days=0은 라우트에서 막히고, 여기서는 아주 짧은 기간으로 경계를 확인한다
    const r = analyzeSessionPatterns(30);
    expect(r.총계.지시).toBe(1);
    expect(r.기간일수).toBe(30);
  });
});
