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
  listDocuments: () => mockListDocuments(),
}));

import { findAgentTool, toolCatalogText } from "../src/engine/agenttools";
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
