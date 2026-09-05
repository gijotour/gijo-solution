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
