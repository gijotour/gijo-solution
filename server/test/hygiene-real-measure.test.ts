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

    // ⚠ 예전 단언은 `kept.length <= rows.length`였다 — **위반이 불가능한 항진명제**라
    //   아무것도 안 지켰다(2026-08-01 검토 지적). 실제로 지켜야 할 성질을 단언한다:
    //   **남은 것에는 우리가 막기로 한 오염이 하나도 없어야 한다.**
    const 남은오염 = r.kept.filter(
      (e) =>
        /\d{4}-\d{2}-\d{2}/.test(e.answer) || // 시점 데이터
        (e.answer.match(/\d+\s*건/g) ?? []).length >= 3 ||
        /\b(?:vuln|asset|prod|cti):[\w.-]+/.test(e.answer) ||
        /당신은\s*(?:안전한\s*)?AI(?:입니다|이며)/.test(e.answer) || // 프롬프트 누출
        e.question.replace(/\s+/g, "").length < 3, // 뜻 없는 질문
    );
    expect(
      남은오염.map((e) => e.question.slice(0, 30)),
      "위생을 통과했는데 오염이 남아 있다 — 규칙과 실제가 어긋난다",
    ).toEqual([]);
    // 전부 걸러지는 것도 정상이 아니다 — 그러면 규칙이 너무 넓다는 신호다.
    expect(r.kept.length, "한 문항도 안 남았다 — 규칙이 지나치게 넓은지 확인할 것").toBeGreaterThan(0);
  });
});
