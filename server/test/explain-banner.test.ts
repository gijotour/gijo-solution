// 전-4 — #8 「네 자료엔 없음」 배너의 **도구 경로 판** (2026-08-13 라이트 QA에서 잡힘).
//
// 챗 RAG 경로(llm.ts ragResult.자료없음)는 배너가 붙는데, 도구 경로(composeFinalAnswer)는
// RAG를 일부러 꺼서(GPU 경합) 배너 로직 자체가 없었다 — "우리 회사 연차 휴가 규정"(빈 DB)이
// explain 도구로 흘러 배너 없이 나갔다. 답이 정직했던 건 모델의 운이었다.
// 수리: agentloop 지식없음을밝힌다 — explain·remediation의 0-근거 문장(결정적 표지)을 보고
// **코드가** 배너를 붙인다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 지식없음을밝힌다 } from "../src/engine/agentloop";
import { 지식근거없음표지 } from "../src/engine/agenttools";
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
    const llmSrc = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");
    const loopSrc = fs.readFileSync(path.join(__dirname, "../src/engine/agentloop.ts"), "utf8");
    // 문장 원문(이 PC의 사내 자료에는…)이 정의 한 곳(llm.ts) 밖에 복제되면 어긋나기 시작한다.
    expect((llmSrc.match(/이 PC의 사내 자료에는 이 내용이 없습니다/g) ?? []).length).toBe(1);
    expect(loopSrc).not.toContain("이 PC의 사내 자료에는 이 내용이 없습니다");
    expect(loopSrc).toContain("자료없음배너");
  });
});
