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

// ─────────────────────────────────────────────────────────────────────────────
// ★ 근거 배지 3상태 — 배지가 **거짓말을 하지 않는다** (2026-08-13 · 전-4 4-ⓑ, 시안 승인)
//
// ■ 무엇이 있었나 (운영 실측 8문항 8회 재현)
//     "ISMS 인증 취득일은 사내 지식 베이스에 **포함되어 있지 않습니다**"
//       + 📄 근거: GIJO_지식_보안거버넌스_표준.md · ismsp_접근권한_검토.md
//   답은 없다는데 출처는 있다. 담당자가 그 문서를 보고서에 출처로 적을 수 있다.
//   뿌리: sources는 **답이 인용한 자료가 아니라 서버가 따로 재검색한 후보**인데
//         화면 문구는 「📄 **근거**」라고 단언했다.
//   더 나쁜 것: 「랜섬웨어 대응 5단계」는 0.7초 코드 템플릿(AI가 불려나가지도 않음)인데
//         배지엔 GIJO_AS_제품소개.md까지 셋이 붙었다.
//
// ■ 설계 — 새 판정기 0개
//   ① 강함  = queryMemoryGraded().약한근거만 === false  → 📄 근거
//   ② 약함  = 그 값이 true                              → 📄 찾아본 자료 — 근거 아님
//   ③ 없음  = 코드 템플릿이 sources: [] 를 **스스로 선언** → 배지 없음
//   ①②는 llm.ts의 「⚠ 근거 약함」 배너가 이미 쓰는 값이고, ③은 actioncheck가 이미 쓰는 계약이다.
import * as fs2 from "fs";

describe("★ 근거 배지 3상태 (2026-08-13)", () => {
  const disp = fs2.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
  const parts = fs2.readFileSync(new URL("../../client/src/renderer/pages/chatparts.js", import.meta.url), "utf8");

  it("서버가 근거세기를 **계산해서 실어 보낸다** — 계산만 하고 버리면 화면이 못 쓴다", () => {
    expect(disp, "근거세기 필드가 응답 타입에 없다").toMatch(/근거세기\?:\s*"강함"\s*\|\s*"약함"/);
    // 새 판정기를 만들지 않고 이미 있는 값을 쓴다 — 이게 이 설계의 핵심이다.
    expect(disp, "약한근거만을 안 쓴다 — 새 판정기를 만들었다면 설계가 어긋난 것이다")
      .toMatch(/graded\.약한근거만\s*\?\s*"약함"\s*:\s*"강함"/);
    expect(disp, "근거세기를 응답에 안 싣는다").toMatch(/근거세기\s*\?\s*\{\s*근거세기\s*\}/);
  });

  it("★ 코드 템플릿 답이 sources: [] 로 「사내 자료를 안 봤다」를 스스로 선언한다", () => {
    // 안 실으면 근거재검색대상인가()가 통과시켜 배지용 재검색이 돌고 무관한 문서가 붙는다.
    //
    // ⚠ **정규식을 쓰지 않는다.** 앵커에 괄호·중괄호가 들어 있어 이스케이프가 한 겹만 어긋나도
    //   조용히 안 걸린다(2026-08-13에 실제로 그렇게 헛실패했다 — \\( 가 \( 로 줄어 정규식
    //   그룹이 됐다). 문자열 위치로 본다: 읽기 쉽고 이스케이프 함정이 원리상 없다.
    for (const [이름, 앵커] of [
      ["침해사고 초동절차(랜섬웨어)", "침해사고초동절차(instructionText)"],
      ["화면 안내(screenguide)", "formatScreenGuide(screen, instructionText)"],
      ["조치 플레이북", "formatRemediation({ findingType"],
    ] as [string, string][]) {
      const i = disp.indexOf(앵커);
      expect(i, `${이름} 의 앵커를 못 찾았다 — 코드가 바뀌었으면 이 시험도 같이 볼 것: ${앵커}`).toBeGreaterThan(-1);
      expect(
        disp.slice(i, i + 400),
        `${이름} 이 sources: [] 를 선언하지 않는다 — 배지가 거짓 출처를 가리킨다`,
      ).toContain("sources: []");
    }
  });

  it("화면이 3상태를 그린다 — 약할 때 문구와 색이 다르다", () => {
    expect(parts, "약함 배지 클래스가 없다").toContain("gcp-src2");
    expect(parts, "약함 문구가 없다").toContain("찾아본 자료 — 근거 아님");
    expect(parts, "근거세기를 안 받는다").toMatch(/function quotes\([^)]*근거세기/);

    // ⚠ 「찾지 못했습니다」는 drawer-audit 실패 문구 목록에 있어 좋은 답에 실패 딱지가 붙는다.
    //   ⚠ **주석은 빼고 본다** — 이 파일(chatparts.js)의 주석이 바로 그 규칙을 설명하느라
    //     그 말을 인용한다. 주석까지 걸면 「왜 그 말을 쓰면 안 되는지」를 적을 수가 없다
    //     (포트 시험에서 겪은 것과 같은 함정 — 역사를 적는 것을 시험이 막으면 안 된다).
    const 코드만 = parts
      .split("\n")
      .filter((l) => !/^\s*[*/]/.test(l))
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
      .join("\n");
    expect(코드만, "실패 문구 목록과 겹치는 말을 배지에 썼다").not.toContain("찾지 못했습니다");
    // 감시가 헛돌지 않는지 — 실제 배지 문구는 코드에 남아 있어야 한다.
    expect(코드만, "배지 문구가 코드에서 사라졌다 — 주석 걸러내기가 코드까지 지웠다").toContain("찾아본 자료");
  });

  it("두 대화 입구가 **둘 다** 근거세기를 넘긴다 — 한쪽만 고치면 분리창에서 안 나온다", () => {
    const con = fs2.readFileSync(new URL("../../client/src/renderer/pages/console.js", import.meta.url), "utf8");
    const wid = fs2.readFileSync(new URL("../../client/src/renderer/pages/chatwidget.js", import.meta.url), "utf8");
    expect(con, "지휘소가 근거세기를 안 넘긴다").toMatch(/P\.quotes\(replyEl[\s\S]{0,140}?근거세기/);
    expect(wid, "분리창이 근거세기를 안 넘긴다").toMatch(/P\.quotes\(typing[\s\S]{0,140}?근거세기/);
  });
});
