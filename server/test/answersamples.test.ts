// 답 표본 — **본문 없이 숫자만 남긴다** (2026-09-06 · 계획서 전-4)
//
// ■ 왜 이 시험이 필요한가
//   이 표는 「측정 공백을 닫는다」는 이유로 생겼지만, 잘못 만들면 **사내 문서 조각이 통째로 쌓이는
//   새 저장소**가 된다. 그래서 짝 시험이 두 가지를 못박는다:
//     ① 본문·질문이 어디에도 안 남는다(스키마·소스·실제 행 전부)
//     ② 세는 값은 실제로 세어진다(빈 표를 초록으로 보고하지 않는다)
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/db";
import {
  recordAnswerSample, 표본요약내기, pruneAnswerSamples, resetAnswerSamplesForTests, 표본보존일,
} from "../src/engine/answersamples";

const 소스 = fs.readFileSync(path.join(__dirname, "../src/engine/answersamples.ts"), "utf8");

describe("★ 본문을 남기지 않는다 — 이 표의 존재 조건", () => {
  beforeEach(() => resetAnswerSamplesForTests());

  it("스키마에 본문·질문 칸이 아예 없다", () => {
    const cols = (db.prepare("PRAGMA table_info(answer_samples)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("sha");
    for (const 금지 of ["answer", "output", "question", "text", "body", "본문", "질문"]) {
      expect(cols, `«${금지}» 칸이 생겼다 — 이 표는 본문을 담지 않는다`).not.toContain(금지);
    }
  });

  it("실제로 쌓인 행에 답 글자가 하나도 없다", () => {
    const 본문 = "사내 문서 조각과 담당자 이름이 든 답입니다 — 김보안 · 방화벽-01 · 82.3%";
    recordAnswerSample({ agent: "analysis", route: "chat", 근거세기: "강함", 수치있음: true, 본문 });
    const 행 = db.prepare("SELECT * FROM answer_samples").all() as Record<string, unknown>[];
    expect(행).toHaveLength(1);
    const 통째 = JSON.stringify(행);
    for (const 조각 of ["김보안", "방화벽-01", "사내 문서", "82.3"]) {
      expect(통째.includes(조각), `답 글자가 표에 남았다: ${조각}`).toBe(false);
    }
    expect(String(행[0].sha)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("같은 답은 같은 지문 — 반복은 셀 수 있고 내용은 못 되돌린다", () => {
    recordAnswerSample({ 수치있음: false, 본문: "같은 답" });
    recordAnswerSample({ 수치있음: false, 본문: "같은 답" });
    recordAnswerSample({ 수치있음: false, 본문: "다른 답" });
    const shas = (db.prepare("SELECT sha FROM answer_samples").all() as { sha: string }[]).map((r) => r.sha);
    expect(new Set(shas).size).toBe(2);
  });
});

describe("★ 세는 값 — 빈 표를 초록으로 보고하지 않는다", () => {
  beforeEach(() => resetAnswerSamplesForTests());

  it("근거세기·표식·수치 분포를 센다", () => {
    recordAnswerSample({ 수치있음: true, 근거세기: "강함", 본문: "a" });                       // 수치 있는데 표식 없음
    recordAnswerSample({ 수치있음: true, 근거세기: "강함", 근거없음: "숫자무근거", 본문: "b" }); // 새 관문이 잡은 것
    recordAnswerSample({ 수치있음: false, 근거세기: "약함", 근거없음: "근거약함", 본문: "c" });
    recordAnswerSample({ 수치있음: false, 본문: "d" });                                        // 재검색 안 돈 답
    const s = 표본요약내기(7);
    expect(s.total).toBe(4);
    expect(s.근거세기).toEqual({ 강함: 2, 약함: 1, 모름: 1 });
    expect(s.근거없음).toEqual({ 없음: 2, 숫자무근거: 1, 근거약함: 1 });
    expect(s.수치있는답).toBe(2);
    // ★ 이 숫자가 곧 사고의 크기다 — 수치를 말했는데 아무 표식도 없는 답의 수.
    expect(s.수치있고표식없음).toBe(1);
    expect(s.일별[0].n).toBe(4);
  });

  it("보존 30일 — 오래된 표본은 정리된다", () => {
    expect(표본보존일).toBe(30);
    recordAnswerSample({ 수치있음: false, 본문: "옛것" });
    db.prepare("UPDATE answer_samples SET at = ?").run(Date.now() - 31 * 86400_000);
    recordAnswerSample({ 수치있음: false, 본문: "새것" });
    expect(pruneAnswerSamples()).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM answer_samples").get() as { n: number }).n).toBe(1);
  });

  it("기록이 실패해도 답을 막지 않는다 — try/catch가 실재한다", () => {
    expect(소스, "recordAnswerSample에 try/catch가 없다").toMatch(/export function recordAnswerSample[\s\S]{0,600}catch/);
  });
});

describe("★ 배선 — 부르는 자리와 지우는 자리", () => {
  it("dispatcher 출구에서 부르고, **qa는 뺀다**(시험이 운영 분포를 오염시키지 않게)", () => {
    const disp = fs.readFileSync(path.join(__dirname, "../src/engine/dispatcher.ts"), "utf8");
    expect(disp).toContain("recordAnswerSample({");
    expect(disp, "qa를 안 걸렀다 — 게이트 수백 건이 운영 분포에 섞인다").toMatch(/if \(!qa\) \{\s*\n\s*recordAnswerSample/);
    // 거르개·표식 뒤여야 한다 — 담당자가 실제로 본 답을 세는 것이 목적이다.
    expect(disp.indexOf("recordAnswerSample({")).toBeGreaterThan(disp.indexOf("const 걸러진 = 근거없음"));
  });

  it("실사용 전환 리셋이 이 표도 비운다 — 시연 분포가 실운영 추세에 섞이지 않게", () => {
    const clean = fs.readFileSync(path.join(__dirname, "../src/engine/datacleanup.ts"), "utf8");
    expect(clean, "answer_samples가 화이트리스트에 없다").toContain("\"answer_samples\"");
  });

  it("읽기는 admin 전용 — 운영 전체의 답 분포다", () => {
    expect(소스).toMatch(/"\/api\/answer-samples",\s*\n?\s*authMiddleware,\s*\n?\s*adminMiddleware/);
  });
});

// ── agent·route·tool·교차 분포 (2026-09-06 추가) ────────────────────────────────
//
// ■ 무슨 공백이었나 (실측 2026-09-06)
//   표에는 agent·route·tool 칸이 처음부터 있었는데 **요약 API가 그 칸을 안 내려줬다.**
//   그래서 「어느 팀원이 근거 없이 답하나」·「어떤 라우팅에서 표식이 안 붙나」를
//   표를 만들어 두고도 **아무도 못 봤다.** 쌓기만 하고 안 보이면 없는 것과 같다.
//   ★ 이 저장소가 반복해 겪은 「만들어 놓고 안 쓰는 것」의 답 표본 판이다.
describe("★ 누가·무엇으로 답했나 — 분포가 실제로 내려온다", () => {
  beforeEach(() => resetAnswerSamplesForTests());

  it("agent·route·tool을 세고, **값이 없는 답도 이름을 붙여** 센다", () => {
    recordAnswerSample({ agent: "analysis", route: "chat", tool: "search", 근거세기: "강함", 수치있음: false, 본문: "a" });
    recordAnswerSample({ agent: "analysis", route: "chat", 근거세기: "약함", 수치있음: false, 본문: "b" }); // 도구 없음
    recordAnswerSample({ route: "scan", tool: "search", 수치있음: false, 본문: "c" });                       // 팀원 없음
    const s = 표본요약내기(7);
    expect(s.agent별).toEqual([{ 이름: "analysis", n: 2 }, { 이름: "(팀원 미상)", n: 1 }]);
    expect(s.route별).toEqual([{ 이름: "chat", n: 2 }, { 이름: "scan", n: 1 }]);
    // ★ NULL을 버리면 「배선이 안 된 답이 몇 건인가」가 사라진다 — 그 숫자가 곧 구멍의 크기다.
    expect(s.tool별).toEqual([{ 이름: "search", n: 2 }, { 이름: "자유 답(도구 없음)", n: 1 }]);
  });

  it("★ 근거세기 × 근거없음 **교차** — 축을 따로 보면 안 보이는 칸을 본다", () => {
    recordAnswerSample({ 근거세기: "강함", 수치있음: false, 본문: "a" });                        // 강함 × 없음
    recordAnswerSample({ 근거세기: "강함", 근거없음: "숫자무근거", 수치있음: true, 본문: "b" });  // 강함 × 숫자무근거
    recordAnswerSample({ 수치있음: false, 본문: "c" });                                          // 모름 × 없음
    const s = 표본요약내기(7);
    // 셋 다 1건이라 **동수** — 이름 순(코드포인트)으로 갈린다. 「숫」 < 「없」, 「강」 < 「모」.
    expect(s.교차).toEqual([
      { 근거세기: "강함", 근거없음: "숫자무근거", n: 1 },
      { 근거세기: "강함", 근거없음: "없음", n: 1 },
      { 근거세기: "모름", 근거없음: "없음", n: 1 },
    ]);
    // 두 축을 따로 세면 「강함 2 · 없음 2」뿐이라, 「강함인데 표식이 붙은 답」 1건이 안 보인다.
    expect(s.근거세기).toEqual({ 강함: 2, 모름: 1 });
  });

  it("★ 상위 10만 준다 — 잘렸다는 사실이 종류수로 드러난다(전부인 척하지 않는다)", () => {
    for (let i = 0; i < 12; i++) recordAnswerSample({ agent: `a${String(i).padStart(2, "0")}`, 수치있음: false, 본문: `x${i}` });
    const s = 표본요약내기(7);
    expect(s.agent별).toHaveLength(10);
    expect(s.종류수.agent, "종류수가 없으면 읽는 사람이 「이게 전부」로 읽는다").toBe(12);
  });

  it("동수일 때 순서가 실행마다 흔들리지 않는다(이름 순으로 가른다)", () => {
    recordAnswerSample({ route: "zeta", 수치있음: false, 본문: "1" });
    recordAnswerSample({ route: "alpha", 수치있음: false, 본문: "2" });
    expect(표본요약내기(7).route별.map((r) => r.이름)).toEqual(["alpha", "zeta"]);
  });

  it("★★ 분포를 늘려도 **본문은 여전히 안 나간다** — 이 표의 존재 조건", () => {
    recordAnswerSample({
      agent: "analysis", route: "chat", tool: "search", 근거세기: "강함", 수치있음: true,
      본문: "김보안 담당 방화벽-01 조치율 82.3%",
    });
    const 통째 = JSON.stringify(표본요약내기(7));
    for (const 조각 of ["김보안", "방화벽-01", "82.3", "조치율"]) {
      expect(통째.includes(조각), `요약에 답 글자가 실렸다: ${조각}`).toBe(false);
    }
    expect(통째, "지문(sha)도 요약에 실을 값이 아니다 — 세는 자리지 되짚는 자리가 아니다").not.toContain("sha");
  });
});
