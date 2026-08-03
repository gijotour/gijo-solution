// GA 판정표 ↔ 코드 대조.
//
// 왜 필요한가(2026-08-03): 계획서 후-1이 "기존 productization 판정표 기준"이라고 적고 있었는데
//   **그 문서가 저장소에 없었다.** 판정이 예전 세션의 기억으로만 남아 있어서,
//   팔러 나가 "GA입니까?"를 받으면 **"기억으로는 닫힌 것 같습니다"** 말고는 답할 수 없었다.
//
// ★ 이 시험이 지키는 것은 **판정표가 낡지 않는 것**이다:
//   · 표에 적힌 항목의 기능이 코드에 실재하는가 (문서만 남고 기능이 사라지면 잡는다)
//   · 항목마다 **기준**이 적혀 있는가 ("구현됨"으로 채워지는 것을 막는다)
//   · 코드 밖 관문(외부 점검·법무·인증·실사용)이 **빠지지 않았는가**
//     — 이게 빠지면 "P0 다 닫았으니 GA"라는 잘못된 결론이 나온다.
//
// ⚠ 이 시험은 **값이 맞는지는 안 본다.** 값은 운영 서버에 실제 요청을 보내 재는 것이고
//   (판정표 §3), 그 결과를 사람이 표에 적는다. 여기서는 표와 코드의 뼈대만 맞댄다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 판정표경로 = path.join(__dirname, "../../GIJO_AS_GA_판정표.md");
const 판정표 = fs.readFileSync(판정표경로, "utf8");
const 엔진 = (f: string) => path.join(__dirname, "../src/engine", f);

describe("GA 판정표 — 표에 적힌 기능이 실재한다", () => {
  const 항목: [string, string][] = [
    ["자가 진단", "observability.ts"],
    ["백업·복원", "backup.ts"],
    ["감사 기록", "audit.ts"],
    ["이벤트 생애주기", "analysishub.ts"],
    ["알림 스케줄", "alertschedule.ts"],
    ["SIEM 전달", "siem.ts"],
  ];
  for (const [이름, 파일] of 항목) {
    it(`${이름} — ${파일}이 있다`, () => {
      expect(fs.existsSync(엔진(파일)), `표에 적힌 기능의 코드가 없다 — 표가 거짓말을 한다`).toBe(true);
      expect(판정표, `${이름}이 표에서 사라졌다`).toContain(이름);
    });
  }
});

describe("★ 표가 「구현됨」으로 채워지지 않는다", () => {
  it("모든 P0 항목에 **기준**이 적혀 있다", () => {
    // 표의 P0 줄은 | A | 이름 | 기준 | 실측값 | 판정 | 꼴이다.
    const 줄 = 판정표.split("\n").filter((l) => /^\|\s*[A-G]\s*\|/.test(l));
    expect(줄.length, "P0 항목을 못 읽었다 — 이 시험이 헛돈다").toBeGreaterThanOrEqual(6);
    for (const l of 줄) {
      const 칸 = l.split("|").map((x) => x.trim());
      const [, 기호, , 기준, 실측] = 칸;
      expect(기준.length, `${기호}: 기준이 비었다 — 기준 없이 항목만 늘리면 「구현됨」으로 채워진다`).toBeGreaterThan(10);
      expect(실측.length, `${기호}: 실측값이 비었다 — 「구현됨」은 근거가 아니다`).toBeGreaterThan(5);
      expect(/구현|완료됨|있음$/.test(실측), `${기호}: 실측 칸에 측정값이 아니라 상태말이 적혔다 — "${실측}"`).toBe(false);
    }
  });

  it("★ 코드 밖 관문이 빠지지 않았다 — 이게 빠지면 「P0 다 닫았으니 GA」가 된다", () => {
    for (const 관문 of ["외부 취약점 점검", "법무 검토", "실사용 4주", "인증"]) {
      expect(판정표, `코드 밖 관문 「${관문}」이 표에서 사라졌다`).toContain(관문);
    }
  });

  it("판정이 **정직한 표현**을 쓴다", () => {
    // "GA 달성"처럼 단정하면 안 된다 — 코드 밖 관문이 남아 있다.
    expect(판정표).toContain("파일럿");
    expect(판정표, "코드로 닫은 것만 보고 GA라고 선언했다").not.toMatch(/GA\s*(달성|완료|통과)/);
  });

  it("이 대조가 헛돌고 있지 않다", () => {
    expect(판정표.length, "판정표를 못 읽었다").toBeGreaterThan(1500);
    expect(판정표, "갱신 날짜가 없다 — 날짜 없는 근거는 근거가 아니다").toMatch(/최근 갱신: \d{4}-\d{2}-\d{2}/);
  });
});
