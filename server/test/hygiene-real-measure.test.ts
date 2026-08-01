// 실제로 만들어진 학습 데이터셋에 위생 규칙을 다시 걸어 **얼마나 오염돼 있었는지** 잰다.
// 이 파일은 시험이라기보다 실측 기록이다 — 2026-08-01 첫 실전 데이터셋(loop-20260801-143529,
// includeUnrated 경로로 30문항)에 규칙 ⑥⑦⑧을 더한 뒤 몇 개가 남는지 확인한다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { cleanForTraining } from "../src/engine/datasethygiene";

const 파일 = process.env.GIJO_MEASURE_DATASET;

describe.skipIf(!파일)("실측 — 만들어진 데이터셋 재검사", () => {
  it("새 규칙으로 다시 거른다", () => {
    const rows = JSON.parse(fs.readFileSync(파일!, "utf8")) as { question: string; answer: string }[];
    const r = cleanForTraining(rows);
    console.log(`\n  들어간 것 ${rows.length}문항 → 남은 것 ${r.kept.length}문항`);
    console.log(`  걸러진 사유: ${JSON.stringify(r.dropped)}`);
    console.log(`  남은 질문: ${r.kept.map((e) => e.question.slice(0, 24)).join(" / ")}\n`);
    expect(r.kept.length).toBeLessThanOrEqual(rows.length);
  });
});
