// 시연 실측(2026-07-29)이 잡은 라우팅 결함 3건 고정 — 계획서 전-1 검증.
// [전중후 계획서 정렬] 시연 대본의 "피해야 할 표현" 표를 비우는 것이 이 시험의 목적이다.
//   ① "리포트 작성해줘" → 스케줄 조회로 새던 것 → 실제 생성(파일)으로
//   ② "반려 사유 주로 뭐였어?" → 일반론으로 새던 것 → 사내 이력 실데이터로
//   ③ "점검은 어떻게 해?" → 실제 점검이 실행되던 것 → 방법 질문은 실행 금지
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));
// 실제 DOCX 생성은 무겁고 파일을 남긴다 — 경로 검증엔 모의로 충분.
vi.mock("../src/engine/report", () => ({
  generateReport: vi.fn(async () => ({ executiveSummary: "모의 요약", filePath: "reports/모의-리포트.docx" })),
  registerReportRoutes: vi.fn(),
}));
// 하드닝 점검이 "실행되면 안 되는" 케이스를 재기 위해 실행 자체를 기록한다.
const scanRuns: string[] = [];
vi.mock("../src/engine/hardeningscan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/hardeningscan")>()),
  runHardeningScan: vi.fn(async (opts: { standard: string }) => {
    scanRuns.push(opts.standard);
    return { standard: opts.standard, results: [] };
  }),
  scanSummaryText: vi.fn(() => "점검 완료(모의)"),
}));

import { dispatchInstruction, formatRejectHistory, REPORT_CREATE_RE, REPORT_QUERY_EXCLUDE_RE } from "../src/engine/dispatcher";
import { isHowtoNotCommand, ontologyQueryOf, isRelationQuestion, forcedToolFor } from "../src/engine/agentloop";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { updateFindingReview, findingKey } from "../src/engine/approvals";
import { db } from "../src/db";

beforeEach(() => {
  resetAssetsForTests();
  db.prepare("DELETE FROM finding_approvals").run(); // 반려 이력 시험 간 격리
  db.prepare("DELETE FROM maintenance_events").run();
  db.prepare("DELETE FROM maintenance_items").run(); // 데모 시드 점검이 남아 '이력 없음' 검증을 깨뜨린다
  db.prepare("DELETE FROM work_session_turns").run();
  db.prepare("DELETE FROM work_sessions").run();
  scanRuns.length = 0;
});

describe("① 보고서 생성 라우팅", () => {
  it("'주간 보안 리포트 작성해줘'는 스케줄 조회가 아니라 실제 생성으로 간다", async () => {
    const r = await dispatchInstruction("주간 보안 리포트 작성해줘");
    expect(r.output).toContain("리포트 파일 생성됨");
    expect(r.output).toContain("모의-리포트.docx");
    expect(r.output).not.toContain("스케줄");
  });

  it("대상이 없는 짧은 지시는 기존 되물음을 유지한다", async () => {
    const r = await dispatchInstruction("보고서 만들어줘");
    expect(r.output).toContain("어떤 보고서를 만들까요");
  });

  it("조회 낱말(스케줄·언제)이 섞이면 생성 분기를 타지 않는다", () => {
    expect(REPORT_CREATE_RE.test("리포트 자동 생성 언제야")).toBe(true); // 문구 자체는 걸리지만
    expect(REPORT_QUERY_EXCLUDE_RE.test("리포트 자동 생성 언제야")).toBe(true); // 제외로 걸러진다
  });
});

describe("② 반려 이력 — 사내 실데이터로 답한다", () => {
  it("반려된 취약점의 사유·검토자가 그대로 나온다 (LLM 일반론 아님)", async () => {
    registerAsset({ id: "fw-01", name: "경계 방화벽", path: "p" });
    const f = { finding_type: "SNMP 커뮤니티 기본값", severity: "medium" as const, evidence: "public", source_tool: "nessus" };
    recordFindings("fw-01", [f]);
    updateFindingReview("fw-01", findingKey("fw-01", f), { status: "rejected", rejectReason: "false_positive", note: "모니터링 전용 세그먼트 — 시그니처 오탐" }, "김검토");
    const r = await dispatchInstruction("방화벽 반려 사유는 주로 뭐였어?");
    expect(r.output).toContain("반려 이력 요약");
    expect(r.output).toContain("오탐");
    expect(r.output).toContain("시그니처 오탐");
    expect(r.output).toContain("김검토");
    expect(r.output).not.toBe("[mock]"); // chat으로 새지 않았다
  });

  it("이력이 없으면 없다고 정직하게 답한다", () => {
    expect(formatRejectHistory("반려 사유 알려줘")).toContain("반려 이력이 아직 없습니다");
  });
});

describe("③ 점검 방법 질문 — 실행 금지", () => {
  it("방법 질문과 실행 지시를 가른다", () => {
    expect(isHowtoNotCommand("SonicWall VPN 인증서 점검은 어떻게 해?")).toBe(true);
    expect(isHowtoNotCommand("하드닝 점검 절차가 뭐야?")).toBe(true);
    expect(isHowtoNotCommand("하드닝 점검해줘")).toBe(false);
    expect(isHowtoNotCommand("이 서버 보안 점검 실행해")).toBe(false);
  });

  it("'어떻게 해?' 질문에는 점검이 실행되지 않는다", async () => {
    await dispatchInstruction("보안 설정 점검은 어떻게 해?");
    expect(scanRuns.length).toBe(0); // 실행 기록이 없어야 한다
  });

  it("명령형이면 종전대로 점검이 실행된다", async () => {
    const r = await dispatchInstruction("하드닝 점검해줘");
    expect(scanRuns.length).toBe(1);
    expect(r.output).toContain("점검 완료(모의)");
  });
});

// ─────────────────────────────────────────────────────────────────────
// [전중후 계획서 정렬: 중-3] 평가 게이트 첫 실행(2026-07-29)이 잡은 라우팅 결함.
// 게이트의 값어치는 "돌렸더니 뭐가 나왔나"에 있다 — 나온 것을 고치고 여기에 못박는다.
describe("④ 평가 게이트가 잡은 결함 — 컴플라이언스 현황", () => {
  it("'컴플라이언스 현황 요약해줘'는 이행 현황 도구로 간다", async () => {
    const r = await dispatchInstruction("컴플라이언스 현황 요약해줘");
    expect((r.toolCalls ?? []).map((t) => t.tool)).toContain("compliance_status");
  });

  it("'이행 현황 알려줘'도 같은 길로 간다", async () => {
    const r = await dispatchInstruction("이행 현황 알려줘");
    expect((r.toolCalls ?? []).map((t) => t.tool)).toContain("compliance_status");
  });
});

describe("⑤ 평가 게이트가 잡은 공백 — 원격 정기점검 스케줄", () => {
  it("'정기점검 언제 돌아?'는 스케줄 조회 도구로 간다", async () => {
    const r = await dispatchInstruction("정기점검 언제 돌아?");
    expect((r.toolCalls ?? []).map((t) => t.tool)).toContain("hardening_schedule_list");
  });

  it("실행 명령('하드닝 점검해줘')은 종전대로 점검을 실행한다 — 조회와 실행이 안 섞인다", async () => {
    const before = scanRuns.length;
    await dispatchInstruction("하드닝 점검해줘");
    expect(scanRuns.length).toBe(before + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// [검토 지적 수리 2026-07-29] 검토관이 잡은 라우팅 결함 3건 고정.
describe("⑥ 검토가 잡은 결함 — 온톨로지 강제분기가 검색어 없이 부르던 것", () => {
  it("질문에서 검색어를 뽑는다", () => {
    expect(ontologyQueryOf("Log4Shell 완화 방법을 온톨로지에서 찾아줘")).toBe("Log4Shell 완화 방법");
    expect(ontologyQueryOf("온톨로지에서 KEV 관계 조회해줘")).toContain("KEV");
  });

  it("현황 질문('뭐 들어있어')은 검색어가 아니라 빈 문자열 — 강제하지 않고 LLM에 맡긴다", () => {
    expect(ontologyQueryOf("온톨로지에 뭐 들어있어?")).toBe("");
    expect(ontologyQueryOf("지식 그래프 보여줘")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
// [라이트 게이트 lt-dup-1 수리 2026-08-13 · 계획서 전-1]
// `max`가 라이트 게이트를 처음 끝에서 끝까지 돌려(f491ff2) 남긴 5건 중 하나.
// 「도구를 켜 뒀는데 모델이 안 고른다」로 보였지만, **강제분기가 애초에 안 걸리고 있었다** —
// FORCED_INTENTS[51]이 「중복 → 문서」 어순만 받아 「문서함에 중복된 거」를 놓쳤다.
//
// ⚠ 정규식을 여기 베껴 쓰지 않는다(agentloop.ts:1348의 원칙) — 실제 라우팅 함수를 부른다.
//   베껴 쓰면 제품이 바뀌어도 시험만 통과하는 드리프트가 생긴다.
describe("⑦ 라이트 게이트가 잡은 결함 — 중복 문서 강제분기가 어순 한쪽만 받았다", () => {
  it("「중복된 문서 있어?」 (중복 → 문서) — 종전 어순은 그대로 간다", () => {
    expect(forcedToolFor("중복된 문서 있어?")?.tool).toBe("doc_duplicates");
    expect(forcedToolFor("겹치는 문서 찾아줘")?.tool).toBe("doc_duplicates");
  });

  it("★「내 문서함에 중복된 거 있어?」 (문서 → 중복) — 이게 안 걸리던 자리다", () => {
    expect(forcedToolFor("내 문서함에 중복된 거 있어?")?.tool).toBe("doc_duplicates");
    expect(forcedToolFor("문서함 중복 정리해줘")?.tool).toBe("doc_duplicates");
  });

  it("문서 낱말이 없으면 안 삼킨다 — 「중복된 자산」·「중복 로그인」은 다른 영토다", () => {
    expect(forcedToolFor("중복된 자산 있어?")?.tool).not.toBe("doc_duplicates");
    expect(forcedToolFor("중복 로그인 확인해줘")?.tool).not.toBe("doc_duplicates");
  });
});

describe("⑥-2 회귀가 잡은 결함 — 항목 질문에 LLM이 온톨로지를 잘못 고르던 것", () => {
  // kisa-u01 회귀 2연속 실패(2026-08-08): "…KISA 어떤 점검항목이야?"에 LLM이 ontology_query를
  // 골라 "연결을 찾지 못했다"가 답이 됐다 — RAG는 U-01 근거를 1순위로 들고 있었다.
  // 도구 설명("연결·매핑만")은 프롬프트라 흘려듣는다 — isRelationQuestion이 코드로 되돌린다.
  it("항목 자체를 묻는 질문은 관계 질문이 아니다 → 온톨로지 거부(RAG 폴백)", () => {
    expect(isRelationQuestion("리눅스 SSH root 원격 로그인 차단은 KISA 어떤 점검항목이야?")).toBe(false);
    expect(isRelationQuestion("U-01이 뭐야?")).toBe(false);
  });

  it("연결·매핑·관계를 물으면 온톨로지가 맞다", () => {
    expect(isRelationQuestion("CWE-79는 뭐랑 연결돼 있어?")).toBe(true);
    expect(isRelationQuestion("이 코드에 매핑된 다른 표준 알려줘")).toBe(true);
    expect(isRelationQuestion("Log4Shell 완화 방법을 온톨로지에서 찾아줘")).toBe(true);
    expect(isRelationQuestion("U-01과 CIS의 관계 보여줘")).toBe(true);
  });
});

describe("⑦ 검토가 잡은 결함 — 점검 스케줄 정규식 과포착", () => {
  it("유지보수 점검 일정은 하드닝 스케줄로 삼키지 않는다", async () => {
    const r = await dispatchInstruction("유지보수 점검 일정 알려줘");
    expect((r.toolCalls ?? []).map((t) => t.tool)).not.toContain("hardening_schedule_list");
  });

  it("'하드닝 점검 스케줄 알려줘'는 조회지 실행이 아니다", async () => {
    const before = scanRuns.length;
    const r = await dispatchInstruction("하드닝 점검 스케줄 알려줘");
    expect(scanRuns.length).toBe(before); // 점검이 돌면 안 된다
    expect((r.toolCalls ?? []).map((t) => t.tool)).toContain("hardening_schedule_list");
  });

  it("'정기점검 돌려줘'는 실행이다", async () => {
    const before = scanRuns.length;
    await dispatchInstruction("정기점검 돌려줘");
    expect(scanRuns.length).toBe(before + 1);
  });
});

// [실측 수리 2026-07-30] qa 경로가 신호 계산(computeOfferSignals)까지 건너뛰어 회귀 하네스가
// internalMiss=undefined로 깨졌다. 신호는 기록이 아니라 **답의 일부**다 — qa에서도 나와야
// "시험 경로가 실사용과 같은 답을 본다"는 전제가 성립한다.
describe("⑧ qa 경로도 답의 신호를 낸다", () => {
  it("qa=true 응답에 internalMiss·dataHits가 들어 있다", async () => {
    const r = await dispatchInstruction("고마워 수고했어", undefined, undefined, undefined, true);
    expect(r.internalMiss).toBeDefined();
    expect(r.dataHits).toBeDefined();
  });

  it("qa=false(실사용)와 신호 형태가 같다", async () => {
    const a = await dispatchInstruction("고마워 수고했어", undefined, undefined, undefined, true);
    const b = await dispatchInstruction("고마워 수고했어");
    expect(typeof a.internalMiss).toBe(typeof b.internalMiss);
    expect(typeof a.dataHits).toBe(typeof b.dataHits);
  });
});
