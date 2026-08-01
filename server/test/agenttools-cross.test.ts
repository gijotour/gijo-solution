// 메뉴를 가로지르는 도구(search·explain·today)와 온톨로지 연계 검증.
// 설계 축: 화면 메뉴가 아니라 사용자 의도 — LLM이 "어느 메뉴?"를 풀지 않아도 되게 한다(2026-07-17).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

// 장기기억은 LanceDB(실 임베딩)라 단위 테스트에서 문서 목록만 대역으로 준다.
const mockListDocuments = vi.fn(async () => [] as unknown[]);
vi.mock("../src/engine/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/memory")>()),
  // 도구는 등급을 지키는 listVisibleDocuments를 쓴다 — 이름이 어긋나면 시험이 제품을 안 본다.
  listVisibleDocuments: () => mockListDocuments(),
}));

import { findAgentTool, toolCatalogText, buildApproval } from "../src/engine/agenttools";
import fs from "node:fs";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { addTriple, deleteTriplesBySource } from "../src/engine/ontology";
import { resetSecurityProductsForTests, createProduct } from "../src/engine/securityproducts";
import { resetAnalysisHubForTests, rebuildVulnEvents } from "../src/engine/analysishub";
import { resetKpiForTests } from "../src/engine/kpi";
import { createSession, appendTurn, setSessionStatus } from "../src/engine/worksessions";
import { db } from "../src/db";

const run = (name: string, args: Record<string, string> = {}) => Promise.resolve(findAgentTool(name)!.run(args)).then(String);

beforeEach(() => {
  resetAssetsForTests();
  resetSecurityProductsForTests();
  deleteTriplesBySource("test-seed");
  mockListDocuments.mockReset();
  mockListDocuments.mockResolvedValue([]);
});

describe("search — 메뉴를 가로지르는 단일 검색", () => {
  it("자산·취약점·보안제품을 한 번의 호출로 가로질러 찾는다", async () => {
    registerAsset({ id: "web-01", name: "웹 서비스", path: "p" });
    recordFindings("web-01", [
      { finding_type: "Log4Shell RCE", severity: "critical", evidence: "log4j 2.14", source_tool: "nessus", kev: true, epss: 0.94 },
    ]);
    createProduct({ name: "Log4j 스캐너", category: "취약점관리" });

    const out = await run("search", { query: "Log4Shell" });
    expect(out).toContain("취약점"); // 취약점 섹션
    expect(out).toContain("web-01"); // 자산명으로도 걸림
    expect(out).toContain("Log4Shell");
  });

  it("온톨로지 관계도 함께 돌려준다(접착제)", async () => {
    addTriple({ subject: "프롬프트 인젝션", predicate: "완화통제", object: "입력 필터링", source: "test-seed" });
    const out = await run("search", { query: "프롬프트 인젝션" });
    expect(out).toContain("온톨로지 관계");
    expect(out).toContain("입력 필터링");
  });

  it("아무것도 없으면 없다고 정직하게 답한다", async () => {
    const out = await run("search", { query: "존재하지않는키워드zzz" });
    expect(out).toContain("찾지 못했습니다");
  });

  it("임베딩 서버가 죽어도 나머지 검색은 계속된다", async () => {
    mockListDocuments.mockRejectedValue(new Error("임베딩 서버 연결 실패"));
    registerAsset({ id: "web-01", name: "웹 서비스", path: "p" });
    const out = await run("search", { query: "웹 서비스" });
    expect(out).toContain("web-01"); // 문서 검색 실패가 자산 검색을 죽이지 않는다
  });

  // 실측(2026-07-19): "자산A와 자산B 비교해줘" 질문에서 7B 모델이 두 대상을 "A OR B" 한 문자열로
  // 합쳐 검색해 0건이 되고, 비교 자체가 통째로 실패했다. 합쳐진 문자열은 매칭될 리 없으므로
  // 결정적으로 나눠서 각각 찾는다 — 비교 질문에서 한쪽이 통째로 누락되지 않게.
  it("여러 대상을 'A OR B'로 합쳐 보내도 각각 나눠 찾는다", async () => {
    registerAsset({ id: "web-01", name: "웹 서비스", path: "p" });
    registerAsset({ id: "db-02", name: "DB 서버", path: "p" });
    const out = await run("search", { query: "웹 서비스 OR DB 서버" });
    expect(out).toContain("web-01");
    expect(out).toContain("db-02");
  });

  // 회귀 하네스가 잡음(2026-07-28): "안전대부 웹서버 취약점 알려줘"가 0건이 돼, 호스트명을
  // 정확히 친 사람만 답을 받고 조직 이름으로 물은 담당자는 문서 요약만 받았다.
  // 통 문자열이 안 걸리면 낱말 AND로 한 번 더 본다 — 조회 의도어(취약점·알려줘)는 대상에서 뺀다.
  it("자산 이름을 통째로 안 치고 낱말로 물어도 찾는다", async () => {
    registerAsset({ id: "vuln:certify.example.co.kr", name: "안전대부 본인인증 웹 서버 (certify.example.co.kr)", path: "p" });
    recordFindings("vuln:certify.example.co.kr", [
      { finding_type: "[IW-32] 데이터 평문 전송", severity: "low", evidence: "평문 전송", source_tool: "웹취약점 보고서" },
    ]);
    const out = await run("search", { query: "안전대부 웹서버 취약점" });
    expect(out).toContain("certify.example.co.kr");
    expect(out).toContain("IW-32");
  });

  it("낱말 중 하나라도 안 맞으면 억지로 끌어오지 않는다", async () => {
    registerAsset({ id: "web-01", name: "안전대부 본인인증 웹 서버", path: "p" });
    const out = await run("search", { query: "국민은행 웹서버" });
    expect(out).toContain("찾지 못했습니다");
  });

  it("'A와 B' 형태(한국어 조사)도 나눠 찾는다", async () => {
    registerAsset({ id: "web-01", name: "웹서비스", path: "p" });
    registerAsset({ id: "db-02", name: "DB서버", path: "p" });
    const out = await run("search", { query: "웹서비스와 DB서버" });
    expect(out).toContain("web-01");
    expect(out).toContain("db-02");
  });
});

describe("explain — 온톨로지 근거 조회", () => {
  it("위협의 완화통제·연관 관계를 온톨로지에서 모아준다", async () => {
    addTriple({ subject: "프롬프트 인젝션", predicate: "위협코드", object: "M06", source: "test-seed" });
    addTriple({ subject: "프롬프트 인젝션", predicate: "완화통제", object: "입력 필터링", source: "test-seed" });
    const out = await run("explain", { topic: "프롬프트 인젝션" });
    expect(out).toContain("온톨로지");
    expect(out).toContain("M06");
    expect(out).toContain("입력 필터링");
  });

  it("관련 보안제품(대응 수단)도 함께 제시한다", async () => {
    createProduct({ name: "DLP 솔루션", category: "정보유출방지", vendor: "지조" });
    const out = await run("explain", { topic: "DLP" });
    expect(out).toContain("보안제품");
    expect(out).toContain("DLP 솔루션");
  });

  it("근거가 없으면 지어내지 말라고 알린다(그라운딩)", async () => {
    const out = await run("explain", { topic: "존재하지않는위협zzz" });
    expect(out).toContain("찾은 근거가 없습니다");
  });

  it("업로드·자동분류된 사내 문서를 근거로 든다", async () => {
    mockListDocuments.mockResolvedValue([
      { documentId: "DLP_정책설정_가이드.pdf", scope: "global", chunks: 12, docClass: "매뉴얼", embeddingModel: null, ingestedAt: null, hasSource: true },
    ]);
    const out = await run("explain", { topic: "DLP" });
    expect(out).toContain("DLP_정책설정_가이드.pdf");
    expect(out).toContain("매뉴얼"); // 자동분류 결과가 근거에 붙는다
  });
});

describe("today — 오늘 뭐부터 (전 자산 가로지름)", () => {
  it("KEV·EPSS·VPR을 근거로 우선순위를 매긴다", async () => {
    registerAsset({ id: "web-01", name: "웹01", path: "p" });
    recordFindings("web-01", [
      { finding_type: "Log4Shell", severity: "critical", evidence: "e", source_tool: "nessus", kev: true, epss: 0.94, vpr: 10 },
      { finding_type: "정보노출", severity: "low", evidence: "e", source_tool: "nessus" },
    ]);
    const out = await run("today", { limit: "5" });
    expect(out).toContain("Log4Shell");
    expect(out).toContain("KEV(실제악용)");
    expect(out).toContain("EPSS 0.94");
    // KEV가 최상단이어야 한다(점수 정렬).
    expect(out.indexOf("Log4Shell")).toBeLessThan(out.indexOf("정보노출"));
  });

  it("조치할 게 없으면 없다고 답한다", async () => {
    expect(await run("today", {})).toContain("조치할 취약점이 없습니다");
  });

  it("limit이 없거나 이상해도 안전한 기본값으로 동작한다", async () => {
    registerAsset({ id: "a", name: "a", path: "p" });
    recordFindings("a", [{ finding_type: "x", severity: "high", evidence: "e", source_tool: "t" }]);
    expect(await run("today", { limit: "이상한값" })).toContain("상위 1건");
    expect(await run("today", { limit: "999" })).toContain("상위 1건");
  });
});

describe("get_asset — 상세에 AI-BOM·온톨로지 위협을 함께 준다", () => {
  it("AI-BOM이 상세에 흡수돼 별도 호출이 필요 없다", async () => {
    registerAsset({ id: "bot-01", name: "챗봇", path: "models/c.gguf" });
    const out = await run("get_asset", { assetId: "bot-01" });
    expect(out).toContain("AI-BOM");
  });

  it("자산 구성에 걸리는 온톨로지 위협을 함께 제시한다(AI-BOM→위협 흐름)", async () => {
    addTriple({ subject: "LLM 서비스", predicate: "위협", object: "프롬프트 인젝션", source: "test-seed" });
    registerAsset({ id: "bot-01", name: "챗봇", path: "models/c.gguf", assetType: "LLM 서비스" });
    const out = await run("get_asset", { assetId: "bot-01" });
    expect(out).toContain("관련 위협");
    expect(out).toContain("프롬프트 인젝션");
  });
});

describe("도구 카탈로그(LLM이 읽는 목록)", () => {
  it("의도 단위 도구가 모두 설명과 함께 노출된다", () => {
    const catalog = toolCatalogText();
    for (const name of ["list_assets", "get_asset", "search", "explain", "today", "register_asset"]) {
      expect(catalog).toContain(name);
    }
    // LLM이 언제 쓸지 알 수 있게 트리거 문구가 설명에 있어야 한다.
    expect(catalog).toContain("어디 있는지 모를 때");
    expect(catalog).toContain("오늘 뭐부터");
  });
});

// 화면 × 챗봇 도구 커버리지 감사(2026-07-21)에서 조회 도구가 전혀 없던 3개 핵심 화면
// (analysis.html·kpi.html·sessions.html)에 새로 연결한 도구들.
describe("analysis_status — 통합 보안 분석(관제) 현황", () => {
  beforeEach(() => resetAnalysisHubForTests());

  it("이벤트가 없으면 정직하게 없다고 답한다", async () => {
    const out = await run("analysis_status");
    expect(out).toContain("없습니다");
  });

  it("취약점 소스 이벤트의 종합위험·우선순위·최우선 항목을 보여준다", async () => {
    registerAsset({ id: "web-01", name: "웹 서비스", path: "p" });
    recordFindings("web-01", [
      { finding_type: "Log4Shell RCE", severity: "critical", evidence: "log4j 2.14", source_tool: "nessus", kev: true, epss: 0.94 },
    ]);
    rebuildVulnEvents();

    const out = await run("analysis_status");
    expect(out).toContain("통합 분석 이벤트");
    expect(out).toContain("종합위험 높음"); // KEV 신호로 P0 → overall "높음"
    expect(out).toContain("Log4Shell RCE");
    expect(out).toContain("웹 서비스");
  });
});

describe("kpi_status — 보안 KPI 현황", () => {
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
  });

  it("자산·취약점·조치·컴플라이언스 지표를 한 스냅샷으로 답한다", async () => {
    registerAsset({ id: "web-01", name: "웹 서비스", path: "p" });
    recordFindings("web-01", [{ finding_type: "Log4Shell RCE", severity: "critical", evidence: "e", source_tool: "nessus" }]);

    const out = await run("kpi_status");
    expect(out).toContain("보안 KPI 현황");
    expect(out).toContain("자산 1건");
    expect(out).toContain("조치 SLA 준수율");
    expect(out).toContain("컴플라이언스 이행률");
  });
});

describe("work_session_status — 작업 세션 현황", () => {
  beforeEach(() => {
    db.exec("DELETE FROM work_session_turns; DELETE FROM work_sessions;");
  });

  it("세션이 없으면 정직하게 없다고 답한다", async () => {
    const out = await run("work_session_status");
    expect(out).toContain("없습니다");
  });

  it("진행중/완료 건수와 최근 세션 제목·미리보기를 보여준다", async () => {
    const s1 = createSession("취약점 우선순위 정리");
    appendTurn(s1.id, "user", "오늘 급한 거 뭐야?");
    appendTurn(s1.id, "assistant", "Log4Shell이 최우선입니다", "today");
    const s2 = createSession("리포트 스케줄 확인");
    setSessionStatus(s2.id, "done");

    const out = await run("work_session_status");
    expect(out).toContain("진행중 1");
    expect(out).toContain("완료 1");
    expect(out).toContain("취약점 우선순위 정리");

    const activeOnly = await run("work_session_status", { status: "active" });
    expect(activeOnly).toContain("취약점 우선순위 정리");
    expect(activeOnly).not.toContain("리포트 스케줄 확인");
  });
});

describe("★ 목록 끝에 다음 걸음 한 줄 (2026-08-01 하루 실전)", () => {
  // 숫자와 목록은 잘 나오는데 담당자에게 "그래서 뭘 하지"가 남았다.
  // 특히 "오늘 뭐부터 볼까?"는 제품에서 가장 많이 쓰는 답인데 조치하러 갈 길이 없었다.
  const src = fs.readFileSync(new URL("../src/engine/agenttools.ts", import.meta.url), "utf8");

  it("today 답이 다음 행동을 알려 준다", () => {
    const i = src.indexOf("function runToday");
    const 본문 = src.slice(i, i + 1400);
    expect(본문, "우선순위만 보여 주고 끝나면 담당자가 화면을 헤맨다").toContain("다음걸음(");
  });

  it("★ 한 줄이다 — 안내를 세 줄씩 붙이면 그게 새 잡음이 된다", () => {
    const i = src.indexOf("function 다음걸음");
    const 본문 = src.slice(i, i + 200);
    expect(본문).toContain("▸ 다음:");
    // 줄바꿈이 앞에 하나(빈 줄 띄우기) + 내용 한 줄 = \n 하나. 더 늘어나면 문단이 된다.
    const 줄 = (본문.match(/return `[^`]*`/) || [""])[0];
    expect((줄.match(/\n/g) || []).length, "다음 걸음은 한 줄로 유지한다").toBeLessThanOrEqual(1);
  });

  it("★ 아무 답에나 붙이지 않는다 — 세 곳뿐이다", () => {
    // 붙인 곳: today(오늘 뭐부터) · briefing(아침 브리핑) · finding_status(조치할 취약점).
    //   셋 다 **일감 목록**이라 다음 행동이 정해져 있다.
    // 안 붙인 곳: kpi_status·list_assets·attack_paths·threats·knowledge_status —
    //   현황 조회라 다음 행동이 사람마다 다르다. 붙이면 안내가 아니라 추측이 된다.
    // 「내 업무」도 안 붙였다 — 체크칸(picklist)이 이미 그 자리에서 처리하게 해 준다.
    const 정의 = (src.match(/function 다음걸음\(/g) || []).length;
    const 전체 = (src.match(/다음걸음\(/g) || []).length;
    expect(정의, "다음걸음은 한 곳에만 정의한다").toBe(1);
    expect(전체 - 정의, "붙인 자리가 늘면 안내가 잡음이 된다").toBe(3);
  });
});

describe("★ 코드값 인자는 LLM이 맞혀도 비워지지 않는다 (2026-08-01 실측)", () => {
  // 결재판은 "지시문에 없는 필수값 = 지어낸 것"으로 보고 비워 되묻는다(환각 방어).
  // 그런데 kind는 **코드값**이라 정답(sla_due)이 사람 말("기한 임박")에 있을 리가 없다.
  // 실제로 LLM이 정확히 맞혔는데 빈 칸이 돼 승인이 400으로 막혔다 — 잘한 것을 벌준 셈이다.
  const 지시 = "매일 아침 9시에 기한 임박 알림을 hong@example.com 으로 보내줘";

  it("한국어로 말해도 코드값으로 채워진다", () => {
    const t = findAgentTool("alert_schedule_add")!;
    const a = buildApproval(t, {}, 지시);
    const 값 = Object.fromEntries(a.fields.map((f) => [f.key, f.value]));
    expect(값.kind, "「기한 임박」을 못 알아들었다").toBe("sla_due");
    expect(값.hour, "「아침 9시」를 못 알아들었다").toBe("9");
  });

  it("★ LLM이 이미 코드값을 넣어도 비워지지 않는다 — 이게 막혀 있었다", () => {
    const t = findAgentTool("alert_schedule_add")!;
    const a = buildApproval(t, { kind: "sla_due", hour: "09", to: "hong@example.com" }, 지시);
    const f = Object.fromEntries(a.fields.map((x) => [x.key, x]));
    expect(f.kind.value, "정답을 넣었는데 비워졌다").toBe("sla_due");
    expect(f.kind.source, "auto여야 비워지지 않는다").toBe("auto");
    expect(f.hour.value, "\"09\"도 받아 9로 다듬어야 한다").toBe("9");
    expect(a.missing, "빠진 값이 있으면 승인이 400으로 막힌다").toEqual([]);
  });

  it("오후를 24시간제로 고친다", () => {
    const t = findAgentTool("alert_schedule_add")!;
    const a = buildApproval(t, {}, "오후 6시에 시스템 이상 알림 보내줘");
    const 값 = Object.fromEntries(a.fields.map((f) => [f.key, f.value]));
    expect(값.hour).toBe("18");
    expect(값.kind).toBe("system_health");
  });
});
