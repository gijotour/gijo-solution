// test/sourcebadge.test.ts — 근거 배지(sources)가 "답의 실제 근거"와 맞물리는지 못박는다.
//
// ⚠ 왜 이 시험이 있나(2026-08-10 실측, Mac 인계에서 발단):
//   근거 배지가 두 방향으로 답과 어긋나 있었다 —
//   ① analyze 경로는 무조건 dataHits=1이라, RAG 문서로 답하는 「안전대부 취약점 분석」이
//      근거가 있는데도 sources=null이었다(근거 **누락**). 고객이 남의 웹취약점 보고서를
//      근거 없이 자기 것처럼 읽는 자리였다.
//   ② urgent_todo·scan_status 같은 데이터 집계 즉답과 되묻기("무엇을 알고 싶으신가요")는
//      dataHits=0이라 무관한 문서가 근거로 **둔갑**했다.
//   → 판정을 dataHits(리포트 알약)와 분리해 근거재검색대상인가()로 뽑았다. 이 시험이 그 계약이다.
//   ⚠ 새 조회 도구를 만들면 dispatcher의 집계조회도구_RE에 넣어야 한다 — 아래 "새 도구 대표" 케이스가 잡는다.
import { describe, it, expect } from "vitest";
import { 근거재검색대상인가 } from "../src/engine/dispatcher";

// 최소 목 — 함수가 보는 필드만 채운다(Pick).
const R = (o: Partial<Parameters<typeof 근거재검색대상인가>[0]>) => o as Parameters<typeof 근거재검색대상인가>[0];

describe("근거재검색대상인가 — 답이 사내 문서(RAG)로 자유 답했을 자리만 true", () => {
  it("① analyze라도 도구 없이 문서형으로 답하면 근거를 싣는다 (누락 결함)", () => {
    // 「안전대부 취약점 분석」 재현: action=analyze, 도구 없음, 문서 서술 답.
    expect(근거재검색대상인가(R({ output: "(주) 안전대부의 대외 서비스에 대한 웹 취약점 진단 결과 …" }), "안전대부 취약점 분석")).toBe(true);
  });

  it("② 데이터 집계 즉답 도구는 재검색을 건너뛴다 (둔갑 결함)", () => {
    expect(근거재검색대상인가(R({ toolCalls: [{ tool: "urgent_todo" }] as any, output: "지금 손댈 일 6건 …" }), "우선순위 분석해줘")).toBe(false);
    expect(근거재검색대상인가(R({ toolCalls: [{ tool: "scan_status" }] as any }), "웹 취약점 진단 결과 분석해줘")).toBe(false);
    expect(근거재검색대상인가(R({ toolCalls: [{ tool: "finding_status" }] as any }), "취약점 몇 건이야")).toBe(false);
    expect(근거재검색대상인가(R({ toolCalls: [{ tool: "list_assets" }] as any }), "자산 목록")).toBe(false);
  });

  it("② 되묻기·모호·대상 못 찾음 안내형 답은 재검색을 건너뛴다 (둔갑 결함)", () => {
    expect(근거재검색대상인가(R({ output: '"취약점"에 대해 무엇을 알고 싶으신가요? 이렇게 물어보시면 바로 답합니다.' }), "취약점")).toBe(false);
    expect(근거재검색대상인가(R({ output: "무엇을 도와드릴까요?" }), "어")).toBe(false);
    expect(근거재검색대상인가(R({ output: "어느 자산을 말씀하시는지 몰라 되묻습니다 …" }), "이 서버 뭐 돌아")).toBe(false);
  });

  it("법령·개념 설명은 자기 근거(조문·정의)라 사내 문서 재검색을 하지 않는다", () => {
    expect(근거재검색대상인가(R({ toolCalls: [{ tool: "law_lookup" }] as any }), "개인정보보호법 제29조")).toBe(false);
    expect(근거재검색대상인가(R({ toolCalls: [{ tool: "explain" }] as any }), "EPSS가 뭐야")).toBe(false);
  });

  it("결재·확인 대기, 이미 확정된 근거, 인사말은 재검색하지 않는다", () => {
    expect(근거재검색대상인가(R({ approval: { } as any }), "제품 등록해줘")).toBe(false);
    expect(근거재검색대상인가(R({ confirm: { } as any }), "이거 지워줘")).toBe(false);
    expect(근거재검색대상인가(R({ sources: [] }), "무엇이든")).toBe(false); // 답이 "근거 없음"을 이미 확정
    expect(근거재검색대상인가(R({ sources: ["a.pdf"] }), "무엇이든")).toBe(false);
    expect(근거재검색대상인가(R({ output: "안녕하세요" }), "안녕")).toBe(false);
  });

  it("일반 질의를 도구 없이 자유 답하면 재검색해 근거를 붙인다 (정상 경로)", () => {
    expect(근거재검색대상인가(R({ output: "사내 보안 규정상 로그는 1년 보관합니다 …" }), "로그 보관 기간 알려줘")).toBe(true);
  });

  it("⚠ 새 조회 도구 대표 — 상태·조회성 도구는 반드시 재검색에서 빠진다(정규식 누락 방지)", () => {
    // action_check_history·report_activity: 예전엔 `cti`가 a"cti"on/a"cti"vity에 우연히 부분일치해
    //   커버됐다. `cti`→`action_check` 수리 뒤에도 이 둘이 계속 빠지는지 못박는다(2026-08-10 Mac 발견).
    for (const tool of ["kpi_status", "posture_impact", "asset_coverage", "audit_search", "recent_documents", "ontology_query", "maintenance_status", "redteam_status", "action_check_history", "report_activity"]) {
      expect(근거재검색대상인가(R({ toolCalls: [{ tool }] as any }), "질의"), `${tool}은 재검색에서 빠져야 한다`).toBe(false);
    }
  });
});
