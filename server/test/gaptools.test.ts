// 도구가 하나도 없던 화면들을 메운 4종 검증(2026-07-27 공백 점검).
// 기록은 이미 쌓여 있었는데 물어볼 길이 없어 챗봇이 일반 지식으로 얼버무리던 자리들이다.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

const mockListDocuments = vi.fn(async () => [] as unknown[]);
vi.mock("../src/engine/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/memory")>()),
  // 도구는 등급을 지키는 listVisibleDocuments를 쓴다 — 이름이 어긋나면 시험이 제품을 안 본다.
  listVisibleDocuments: () => mockListDocuments(),
}));

import { findAgentTool } from "../src/engine/agenttools";
import { recordAudit } from "../src/engine/audit";
import { addTriple, deleteTriplesBySource } from "../src/engine/ontology";

const run = async (name: string, args: Record<string, string> = {}) => {
  const t = findAgentTool(name);
  expect(t, `${name} 도구가 등록돼 있어야 한다`).toBeTruthy();
  return await t!.run(args, { username: "tester", role: "admin" } as never);
};

describe("작업 기록 조회 (audit_search)", () => {
  beforeEach(() => {
    recordAudit({ kind: "asset", actor: "정요한", action: "자산 삭제", target: "vuln:10.0.0.9", result: "ok" });
    recordAudit({ kind: "asset", actor: "김도희", action: "제품 등록", target: "FW-01", result: "ok" });
  });

  it("검색어로 찾고 사람·건수를 함께 준다", async () => {
    const out = await run("audit_search", { query: "삭제", days: "7" });
    expect(out).toContain("자산 삭제");
    expect(out).toContain("정요한");
    // 검색어에 안 걸리는 다른 기록은 섞이지 않아야 한다
    expect(out).not.toContain("제품 등록");
  });

  it("검색어 없이 기간만 줘도 최근 기록을 준다", async () => {
    const out = await run("audit_search", { days: "1" });
    expect(out).toContain("작업 기록");
    expect(out).toContain("사람별:");
  });

  it("없는 검색어면 '못 찾았다'고 분명히 말한다 — 지어내지 않는다", async () => {
    const out = await run("audit_search", { query: "존재하지않는작업명XYZ" });
    expect(out).toContain("찾지 못했습니다");
  });
});

describe("처리 실패 내역 (system_log_status)", () => {
  it("실패가 있으면 건수와 내역을 준다", async () => {
    recordAudit({ kind: "auth", actor: "unknown", action: "로그인 시도", target: "jyh", result: "blocked" });
    const out = await run("system_log_status", { days: "1" });
    expect(out).toContain("정상 처리되지 않았습니다");
    expect(out).toContain("blocked");
  });
});

describe("표준 코드 연결 조회 (ontology_query)", () => {
  beforeEach(() => {
    deleteTriplesBySource("gaptools-test");
    addTriple({ subject: "CWE-79", predicate: "대응표준", object: "OWASP A03:2021", scope: "global", source: "gaptools-test" });
  });

  it("연결된 관계를 주체—관계→객체 형태로 보여 준다", async () => {
    const out = await run("ontology_query", { query: "CWE-79" });
    expect(out).toContain("CWE-79");
    expect(out).toContain("OWASP A03:2021");
  });

  it("검색어가 없으면 되묻는다", async () => {
    const out = await run("ontology_query", {});
    expect(out).toContain("알려주세요");
  });

  it("못 찾으면 못 찾았다고 한다", async () => {
    const out = await run("ontology_query", { query: "없는코드ZZZ-999" });
    expect(out).toContain("찾지 못했습니다");
  });
});

describe("인수인계 현황 (handover_status)", () => {
  it("문서가 없으면 어디서 올리는지 알려 준다", async () => {
    mockListDocuments.mockResolvedValueOnce([]);
    const out = await run("handover_status");
    // 4.0.0에서 ＋가 대화 콘솔로 이사(2026-07-29 검토 #1) — 안내도 그리로.
    expect(out).toContain("대화 콘솔의 ＋");
  });

  it("서버가 모르는 것(담은 문서·통과율)은 모른다고 밝힌다", async () => {
    mockListDocuments.mockResolvedValueOnce([{ documentId: "인수인계_방화벽.pdf", chunks: 12, scope: "global" }]);
    const out = await run("handover_status");
    expect(out).toContain("인수인계_방화벽.pdf");
    expect(out).toContain("서버가 알지 못합니다");
  });
});
