// 전-4 — #8 「네 자료엔 없음」 배너의 **도구 경로 판** (2026-08-13 라이트 QA에서 잡힘).
//
// 챗 RAG 경로(llm.ts ragResult.자료없음)는 배너가 붙는데, 도구 경로(composeFinalAnswer)는
// RAG를 일부러 꺼서(GPU 경합) 배너 로직 자체가 없었다 — "우리 회사 연차 휴가 규정"(빈 DB)이
// explain 도구로 흘러 배너 없이 나갔다. 답이 정직했던 건 모델의 운이었다.
// 수리: agentloop 지식없음을밝힌다 — explain·remediation의 0-근거 문장(결정적 표지)을 보고
// **코드가** 배너를 붙인다.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ★ 「발췌가 실리면 온톨로지 표지는 안 선다」시험 전용 — queryMemoryGraded를 모킹해 runExplain의
//   실제 출력을 잰다(소스가 아니라 출력으로 단언). 다른 시험(지식없음을밝힌다 단위 시험·소스 감시)은
//   runExplain을 안 부르므로 이 모킹의 영향을 안 받는다.
vi.mock("../src/engine/memory", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/engine/memory")>();
  return {
    ...orig,
    queryMemoryGraded: vi.fn(async () => ({
      chunks: ["VPR은 Tenable이 매기는 취약점 우선순위 점수다."],
      titles: ["epss_vs_vpr.md"],
      scored: [{ text: "VPR은 Tenable이 매기는 취약점 우선순위 점수다.", distance: 0.5, documentId: "epss_vs_vpr.md", lexicalHit: false }],
      약한근거만: false,
    })),
  };
});

import { 지식없음을밝힌다, 온톨로지근거임을밝힌다 } from "../src/engine/agentloop";
import { 지식근거없음표지, 온톨로지전용알림, 온톨로지전용표지, runExplain } from "../src/engine/agenttools";
import { 자료없음배너 } from "../src/engine/llm";

const call = (tool: string, result: string) => ({ tool, args: {}, result });

// 실제 도구가 내는 0-근거 문장 그대로(아래 소스 감시가 이 가정을 지킨다).
const EXPLAIN_없음 = `"연차 휴가 규정"에 대해 사내 온톨로지·문서·보안제품 등록부에서 찾은 근거가 없습니다. 일반 지식으로만 답하거나, 관련 문서를 업로드하면 근거가 쌓입니다.`;
const REMED_없음 = `"XYZ"에 대한 사내 완화통제·보안제품·매뉴얼 근거가 검색되지 않았습니다. 일반적 조치는 최신 패치 적용·설정 강화·접근통제이며, 관련 매뉴얼을 올리면 구체 절차가 쌓입니다.`;

describe("#8 배너 — 도구 경로(지식없음을밝힌다)", () => {
  it("explain이 0-근거인데 모델이 자신 있게 답하면 배너를 붙인다", () => {
    const reply = "연차 휴가는 근로기준법에 따라 1년 근속 시 15일이 부여됩니다.";
    const out = 지식없음을밝힌다(reply, [call("explain", EXPLAIN_없음)]);
    expect(out.startsWith(자료없음배너)).toBe(true);
    expect(out).toContain(reply); // 답을 버리지 않는다 — 사실을 먼저 말할 뿐
  });

  it("remediation의 0-근거 문장도 같은 표지로 잡는다", () => {
    const out = 지식없음을밝힌다("일반적으로 최신 패치를 적용하세요.", [call("remediation", REMED_없음)]);
    expect(out.startsWith(자료없음배너)).toBe(true);
  });

  it("답 머리가 이미 「없습니다」로 정직하면 겹쳐 붙이지 않는다 (QA에서 본 그 답)", () => {
    // 2026-08-13 라이트 QA 실답: 모델 스스로 정직 — 배너를 겹치면 같은 말이 두 번 나간다.
    const honest = "우리 회사 연차 휴가 규정에 대한 사내 온톨로지, 문서, 보안제품 등록부에서 찾을 수 없습니다. 일반 지식 기준으로는 명확한 규정이 없습니다.";
    expect(지식없음을밝힌다(honest, [call("explain", EXPLAIN_없음)])).toBe(honest);
  });

  it("다른 도구가 사내 데이터를 가져왔으면 붙이지 않는다 — 자료 있는 대화다", () => {
    const reply = "웹서버에서 취약점 3건이 발견되었습니다.";
    const calls = [call("explain", EXPLAIN_없음), call("search", "자산 2건: web01, web02 …")];
    expect(지식없음을밝힌다(reply, calls)).toBe(reply);
  });

  it("도구를 안 썼거나 답이 비면 그대로 둔다", () => {
    expect(지식없음을밝힌다("답", [])).toBe("답");
    expect(지식없음을밝힌다("", [call("explain", EXPLAIN_없음)])).toBe("");
  });
});

describe("소스 감시 — 표지와 실제 문장이 어긋나면 배너가 조용히 꺼진다", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/engine/agenttools/handlers.ts"), "utf8");

  it("runExplain·runRemediation의 0-근거 반환 문장이 지식근거없음표지에 걸린다", () => {
    // 문구를 다듬는 순간 배너가 소리 없이 죽는 꼴을 막는다 — 소스에서 반환 문장을 찾아 표지로 재검.
    const 반환문장들 = [...src.matchAll(/return `([^`]*(?:근거가 없습니다|근거가 검색되지 않았습니다)[^`]*)`/g)].map((m) => m[1]);
    expect(반환문장들.length, "handlers.ts에서 0-근거 반환 문장을 못 찾았다 — 문구가 바뀌었으면 표지·시험을 함께 고칠 것").toBeGreaterThanOrEqual(2);
    for (const 문장 of 반환문장들) expect(지식근거없음표지.test(문장), `표지가 이 문장을 못 잡는다: "${문장.slice(0, 60)}…"`).toBe(true);
  });

  it("remediation 0-근거 문장이 서랍 점검 실패 문구(찾지 못했습니다)를 다시 쓰지 않는다", () => {
    // 같은 함정 4번째(llm→actioncheck→lawinfo→handlers). 전수 대조는 emptyanswer-guidance 몫,
    // 여기서는 이번에 고친 그 한 문장만 지킨다.
    expect(REMED_없음).not.toContain("찾지 못했습니다");
    expect(src).toContain("매뉴얼 근거가 검색되지 않았습니다");
  });

  it("배너 문장은 llm.ts와 도구 경로가 한 상수를 쓴다(두 벌 금지)", () => {
    // ⚠ 2026-09-05: 배너 문장이 llm.ts → noevidence.ts로 **이관**됐다(dispatcher가 판정기를
    //   쓰려면 llm을 흉내 내는 시험 76개를 안 건드려야 해서). 지키는 것은 그대로다 — 한 곳에만 있는가.
    const llmSrc = fs.readFileSync(path.join(__dirname, "../src/engine/noevidence.ts"), "utf8");
    const llm실제 = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");
    expect(llm실제, "llm.ts가 배너 문장을 다시 적었다 — 주인은 noevidence.ts 한 곳이다").not.toContain("이 PC의 사내 자료에는 이 내용이 없습니다");
    const loopSrc = fs.readFileSync(path.join(__dirname, "../src/engine/agentloop.ts"), "utf8");
    // 문장 원문(이 PC의 사내 자료에는…)이 정의 한 곳(llm.ts) 밖에 복제되면 어긋나기 시작한다.
    expect((llmSrc.match(/이 PC의 사내 자료에는 이 내용이 없습니다/g) ?? []).length).toBe(1);
    expect(loopSrc).not.toContain("이 PC의 사내 자료에는 이 내용이 없습니다");
    expect(loopSrc).toContain("자료없음배너");
  });
});

// ── B2 — 온톨로지 전용 답의 정직 표지 (2026-09-11 설계관 지시서 · 이 라운드에서 닫음) ──────
//
// 옛 백로그: explain이 문서 발췌 0건에 온톨로지 관계만 실으면 근거 없이 답한 것인데
// 지식근거없음표지도 자료없음배너도 안 걸려 아무 표시가 없었다. 이제 handlers.ts가
// 온톨로지전용알림을 out 맨 앞에 붙이고(발췌실림 조건), 이 함수가 그 표지를 보고 최종 답
// 머리에 같은 문장을 코드로 얹는다.
const 온톨로지결과 = `${온톨로지전용알림}\n사내 온톨로지 관계 — "VPR" 관련:\n  - VPR —[정식명칭]→ Vulnerability Priority Rating`;

describe("B2 — 온톨로지 전용 답에는 코드가 표지를 붙인다(전-6 정직)", () => {
  it("온톨로지만 실리면 답 머리에 표지가 선다", () => {
    const out = 온톨로지근거임을밝힌다("VPR은 Tenable의 우선순위 점수입니다.", [call("explain", 온톨로지결과)]);
    expect(out.startsWith(온톨로지전용알림)).toBe(true);
    expect(out).toContain("VPR은 Tenable의 우선순위 점수입니다."); // 답을 버리지 않는다
  });

  it("다른 도구가 사내 데이터를 가져왔으면 안 붙는다 — 자료 있는 대화다", () => {
    const reply = "VPR은 우선순위 점수입니다.";
    const calls = [call("explain", 온톨로지결과), call("search", "자산 2건: web01, web02 …")];
    expect(온톨로지근거임을밝힌다(reply, calls)).toBe(reply);
  });

  it("답 머리가 이미 정직하면 겹쳐 붙이지 않는다", () => {
    const honest = "근거가 없습니다 — 온톨로지 관계로만 보면 VPR은 우선순위 점수입니다.";
    expect(온톨로지근거임을밝힌다(honest, [call("explain", 온톨로지결과)])).toBe(honest);
  });

  it("도구를 안 썼거나 답이 비면 그대로 둔다", () => {
    expect(온톨로지근거임을밝힌다("답", [])).toBe("답");
    expect(온톨로지근거임을밝힌다("", [call("explain", 온톨로지결과)])).toBe("");
  });
});

describe("소스 감시 — 온톨로지 전용 표지가 다른 계약과 안 부딪힌다", () => {
  it("FAIL_MARKS 어느 것에도 안 걸린다 — 정직한 표지가 실패 딱지를 받으면 안 된다", () => {
    const auditSrc = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "drawer-audit.mjs"), "utf8");
    const m = auditSrc.match(/const FAIL_MARKS = \[([\s\S]*?)\];/);
    expect(m, "FAIL_MARKS 배열을 못 찾았다 — drawer-audit.mjs 꼴이 바뀌었으면 이 시험도 함께 볼 것").toBeTruthy();
    const marks = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(온톨로지전용알림.includes(mark), `표지가 FAIL_MARKS "${mark}"에 걸린다`).toBe(false);
    }
  });

  it("지식근거없음표지에는 안 걸린다 — 걸리면 자료없음 배너가 잘못 붙는다", () => {
    expect(지식근거없음표지.test(온톨로지전용알림)).toBe(false);
  });

  it("evalgate 배너_RE가 이 표지를 채점 본문에서 뗀다", () => {
    const evalSrc = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "evalgate", "run.mjs"), "utf8");
    const m = /const 배너_RE = \/(.+)\/([gimsuy]*);/.exec(evalSrc);
    expect(m, "배너_RE 정의를 못 찾았다 — 꼴이 바뀌었으면 이 시험도 함께 볼 것").toBeTruthy();
    const 배너_RE = new RegExp(m![1], m![2]);
    // 배너는 늘 `${배너}\n\n${답}` 꼴로 실제 답 앞에 붙는다 — 그 모양 그대로 대조한다.
    const 답 = `${온톨로지전용알림}\n\nVPR은 우선순위 점수입니다.`;
    expect(답.replace(배너_RE, ""), "새 표지가 배너_RE에 안 걸린다 — 채점 본문에 섞인다").toBe("VPR은 우선순위 점수입니다.");
  });
});

describe("발췌가 실리면 온톨로지 표지는 안 선다(반대 방향)", () => {
  it("queryMemoryGraded가 발췌를 주면 runExplain 출력에 온톨로지전용표지가 안 선다", async () => {
    const out = await runExplain({ topic: "VPR" });
    expect(out, "발췌가 실려야 이 시험이 뜻을 갖는다").toContain("사내 문서 근거(발췌)");
    expect(온톨로지전용표지.test(out), "발췌가 있는데 온톨로지 전용 표지가 섰다").toBe(false);
  });

  // ⚠ 위 실행 검사는 시험 DB에 온톨로지 씨앗이 없으면 온톨로지.length가 애초에 0이라
  //   조용히 아무것도 안 잰다(toolevidence.test.ts의 같은 함정과 동형). 그래서 표지를 거는
  //   조건 자체를 소스로 함께 문다 — 둘 중 하나만으로는 헛초록이 난다.
  it("표지 조건이 발췌실림을 함께 본다 — 잣대가 빠지면 여기가 빨개진다", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/agenttools/handlers.ts"), "utf8");
    expect(src, "발췌실림 없이 온톨로지 유무만으로 표지를 걸면 발췌가 있어도 표지가 선다")
      .toContain("if (!발췌실림 && 온톨로지.length && !지정범위.length) out.unshift(온톨로지전용알림);");
  });
});
