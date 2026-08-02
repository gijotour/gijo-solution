// ⑤ 보고 칸이 세는 것 — **사람이 쓴 보고서만.**
//
// 실측(2026-08-02): 규칙을 처음 넣었더니 「이번 주 보고 369건」이 떴다.
//   data/reports에는 보고서만 있는 게 아니었다 —
//   answer-* 265건(긴 답변이 리포트로 자동 전환된 것) · ingest-* 3건(파일 반입 기록).
//   숫자가 **틀리지 않았는데 뜻이 달랐다.** 담당자가 369를 보면 그 칸을 영영 안 믿는다.
//   (오늘 스캔 오류를 취약점으로 세던 것과 같은 부류의 함정이다.)
//
// ⚠ REPORT_DIR은 **모듈을 처음 불러올 때** 정해진다. 그래서 폴더는 파일 맨 위에서 한 번만
//   잡고, 시험마다 그 안의 **파일만** 갈아 끼운다(재임포트로 바꾸려다 헛돌았다).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const 폴더 = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-report-"));
process.env.GIJO_REPORT_DIR = 폴더;

const { reportActivity } = await import("../src/engine/report");

afterAll(() => { try { fs.rmSync(폴더, { recursive: true, force: true }); } catch { } });
beforeEach(() => {
  if (!fs.existsSync(폴더)) fs.mkdirSync(폴더, { recursive: true });
  for (const f of fs.readdirSync(폴더)) fs.rmSync(path.join(폴더, f), { force: true });
});

const 만들기 = (이름: string, 며칠전 = 0) => {
  const f = path.join(폴더, 이름);
  fs.writeFileSync(f, "x");
  const t = new Date(Date.now() - 며칠전 * 86400000);
  fs.utimesSync(f, t, t);
};

describe("⑤ 보고 — 사람이 쓴 보고서만 센다", () => {
  it("긴 답변 전환(answer-)과 반입 기록(ingest-)은 안 센다", () => {
    for (let i = 0; i < 20; i++) 만들기(`answer-${1000 + i}.md`);
    만들기("ingest-2001.md");
    만들기("ondemand-3001.docx");
    const r = reportActivity();
    expect(r, "폴더가 있는데 null이면 안 된다").not.toBeNull();
    expect(r!.thisWeek, "답변 전환·반입 기록이 보고서로 세어졌다").toBe(1);
  });

  it("같은 보고서의 docx·pdf는 한 건으로 묶는다", () => {
    // ⚠ 안 묶으면 한 번 쓴 보고서가 두세 건으로 잡혀 "열심히 보고했다"로 보인다.
    만들기("ondemand-4001.docx");
    만들기("ondemand-4001.pdf");
    만들기("weekly-4002.docx");
    expect(reportActivity()!.thisWeek).toBe(2);
  });

  it("지난달 것은 이번 주에 안 넣는다", () => {
    만들기("ondemand-5001.docx", 30);
    const r = reportActivity()!;
    expect(r.thisWeek).toBe(0);
    expect(r.daysSinceLast, "마지막 보고가 30일 전이면 그렇게 말해야 한다").toBeGreaterThanOrEqual(29);
  });

  it("보고서가 하나도 없으면 0건 · 마지막은 모른다(null)", () => {
    const r = reportActivity()!;
    expect(r.thisWeek).toBe(0);
    expect(r.daysSinceLast, "없는 것을 0일 전이라 하면 오늘 썼다는 뜻이 된다").toBeNull();
  });

  it("폴더가 아예 없어도 지어내지 않는다", () => {
    fs.rmSync(폴더, { recursive: true, force: true });
    const r = reportActivity()!;
    expect(r.thisWeek).toBe(0);
    expect(r.daysSinceLast).toBeNull();
  });
});

// QA·시험이 만든 리포트는 세지 않는다 — 시간 KPI(중-2)와 같은 규칙.
// ⚠ 실측 2026-08-02: 안 빼면 「이번 주 보고 119건」이 뜬다(대부분 QA가 만든 것).
//   반대로 **모르는 것을 시험으로 몰면** 숫자가 부당하게 낮아진다 — 메타가 없으면 사람 것으로 본다.
describe("⑤ 보고 — QA·시험 리포트 제외", () => {
  const 메타 = (base: string, qa: boolean) =>
    fs.writeFileSync(path.join(폴더, `${base}.json`), JSON.stringify({ base, qa }));

  it("qa 표식이 붙은 리포트는 안 센다", () => {
    만들기("ondemand-6001.docx"); 메타("ondemand-6001", true);
    만들기("ondemand-6002.docx"); 메타("ondemand-6002", false);
    expect(reportActivity()!.thisWeek, "QA가 만든 것이 보고로 세어졌다").toBe(1);
  });

  it("메타가 없으면 사람이 만든 것으로 본다 — 숫자를 함부로 낮추지 않는다", () => {
    만들기("ondemand-7001.docx");   // 메타 없음
    expect(reportActivity()!.thisWeek).toBe(1);
  });

  it("메타가 깨져 있어도 세는 쪽으로 —조용히 빠지면 보고를 안 한 것처럼 보인다", () => {
    만들기("ondemand-8001.docx");
    fs.writeFileSync(path.join(폴더, "ondemand-8001.json"), "{망가진");
    expect(reportActivity()!.thisWeek).toBe(1);
  });
});
