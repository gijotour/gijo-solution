// domainsense.test — **같은 낱말, 다른 뜻**: 도메인 뜻 표와 강제 라우팅이 어긋나지 않는가
//
// ■ 무엇을 지키나 (2026-09-06 운영 실측)
//   「클릭률 낮추는 법」에 제품이 웹 마케팅 조언을 냈다("목적을 명확히 설정해야 합니다…").
//   이 제품에서 클릭률·열람률·참여율·이수율·응답률은 **피싱 모의훈련·보안 교육**의 지표인데,
//   모델이 학습한 세상에서는 그 낱말의 주인이 마케팅이다.
//
// ■ 이 시험이 무는 **어긋남** — 방어가 두 층인데 서로를 모른다
//   ① 값 물음(「클릭률 얼마야?」)은 FORCED_INTENTS[83]이 kpi_status로 **강제**한다 → 모델을 안 거친다.
//   ② 개선·뜻 물음(「클릭률 낮추는 법」)은 [83]의 **배제어**(낮추·높이·올리·뭐야)에 일부러 걸려
//      비켜선다 → **모델이 자유롭게 답한다.** 사고가 나는 자리는 ②다.
//   그래서 ②에는 glossary.ts DOMAIN_SENSE가 뜻을 깔아 준다. 두 층이 어긋나면
//   (한쪽이 낱말을 늘리거나 배제어를 지우면) **아무도 안 지키는 낱말**이 조용히 생긴다.
//
// ⚠ [83]의 낱말 목록을 **여기 베끼지 않는다.** 베낀 목록은 한쪽만 고쳐져 어긋나고,
//   그러면 이 시험은 「제 사본이 제 사본과 같다」만 증명한다. 소스에서 **떼어 읽는다.**
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DOMAIN_SENSE, glossaryGroundingFor } from "../src/engine/glossary";

const agentloop = fs.readFileSync(path.join(__dirname, "../src/engine/agentloop.ts"), "utf8");

/** [83] 사내 지표율 — 배열 **맨 끝**의 kpi_status 강제규칙 정규식을 소스에서 떼어 온다. */
function 규칙83(): { re: RegExp; 본문: string } {
  const 끝 = agentloop.lastIndexOf('tool: "kpi_status"');
  expect(끝, "agentloop.ts에서 kpi_status 강제규칙을 못 찾았다").toBeGreaterThan(0);
  const 앞 = agentloop.slice(0, 끝);
  const i = 앞.lastIndexOf("\n    re: /");
  expect(i, "그 규칙 바로 앞의 re: 리터럴을 못 찾았다 — 조립식으로 바뀌었나(감시 도구도 함께 본다)")
    .toBeGreaterThan(0);
  const 줄끝 = 앞.indexOf("\n", i + 1);
  const 줄 = 앞.slice(i + 1, 줄끝 < 0 ? undefined : 줄끝).trim();
  const m = /^re: \/(.*)\/([a-z]*),$/.exec(줄);
  expect(m, `re: 줄의 모양이 예상과 다르다 — ${줄.slice(0, 60)}`).toBeTruthy();
  return { re: new RegExp(m![1], m![2]), 본문: m![1] };
}

describe("★ [83] 강제 라우팅을 소스에서 읽는다", () => {
  it("정규식을 떼어 올 수 있고, 사내 실적률 규칙이 맞다", () => {
    const { re, 본문 } = 규칙83();
    expect(본문).toContain("조치");
    expect(본문).toContain("율|률");
    // 값 물음은 도구로 간다(이 규칙의 본래 일).
    expect(re.test("조치 완료율 어때?")).toBe(true);
    expect(re.test("SLA 준수율 몇 %야?")).toBe(true);
  });
});

describe("★★ 도메인 뜻 표와 [83]이 어긋나지 않는가", () => {
  const { re } = 규칙83();
  // [83]이 「사내 실적률」로 보는 낱말 목록 — **소스에서** 떼어 온다(베끼지 않는다).
  // ⚠ 낱말 목록을 **정규식으로 파내지 않는다** — 정규식 안의 정규식을 다시 정규식으로 읽으면
  //   역슬래시가 층마다 줄어 조용히 딴 것을 잡는다(실제로 밟았다). 글자 위치로 떼어 온다.
  const 본문83 = 규칙83().본문;
  const 표식 = "(?:(?:완료|성공)";          // 사내 실적률 낱말 묶음 **바로 뒤**에 오는 조각
  const 표식자리 = 본문83.indexOf(표식);
  const 묶음시작 = 표식자리 < 0 ? -1 : 본문83.lastIndexOf("(?:", 표식자리 - 1);
  const 묶음끝 = 묶음시작 < 0 ? -1 : 본문83.indexOf(")", 묶음시작);
  const 목록m = 묶음끝 > 0 ? 본문83.slice(묶음시작 + 3, 묶음끝) : null;
  const 낱말 = (목록m ?? "").split("|").filter(Boolean);
  const 키 = Object.keys(DOMAIN_SENSE);
  const 어간 = new Map(키.map((k) => [k.replace(/[율률]$/, ""), k]));
  const 겹침 = 낱말.filter((w) => 어간.has(w));

  it("낱말 목록을 실제로 떼어 왔다 — 못 떼어 오면 아래가 전부 헛통과한다", () => {
    expect(목록m, "[83] 낱말 목록의 모양이 바뀌었다 — 정규식을 고쳤으면 이 시험도 함께 볼 것").toBeTruthy();
    expect(낱말.length, "낱말이 너무 적다 — 엉뚱한 괄호를 떼어 왔을 수 있다").toBeGreaterThan(10);
    expect(낱말).toContain("클릭");
  });

  it("★ 두 층이 겹치는 낱말이 있다 — 없다면 한쪽이 통째로 지워진 것이다", () => {
    console.log(`[도메인뜻] [83] 낱말 ${낱말.length}개 · 뜻 표 ${키.length}개 · 겹침 ${겹침.length}개 — ${겹침.join(", ")}`);
    expect(겹침.length, "겹치는 낱말이 사라졌다 — [83] 낱말 목록이나 DOMAIN_SENSE 한쪽이 무너졌다")
      .toBeGreaterThanOrEqual(5);
  });

  it("★★ 값 물음은 **도구**로, 개선 물음은 **모델**로 — 그리고 모델 쪽에는 뜻이 깔린다", () => {
    for (const w of 겹침) {
      const k = 어간.get(w)!;
      expect(re.test(`${k} 얼마야?`), `「${k} 얼마야?」가 kpi_status로 안 간다 — 값 물음은 도구가 답해야 한다`).toBe(true);
      for (const 개선 of [`${k} 어떻게 낮춰?`, `${k} 높이려면?`, `${k} 올리는 법`]) {
        expect(re.test(개선), `「${개선}」이 kpi_status로 강제됐다 — 개선 물음은 모델 갈래여야 도메인 뜻이 쓰인다`).toBe(false);
        expect(glossaryGroundingFor(개선) ?? "", `「${개선}」에 ${k}의 뜻이 안 깔렸다`).toContain(`${k}:`);
      }
    }
  });

  it("[83]이 안 잡는 뜻 낱말도 **뜻은 깔린다** — 전환율 계열(값을 아예 안 세는 지표)", () => {
    const 밖 = 키.filter((k) => !겹침.includes(k.replace(/[율률]$/, "")));
    console.log(`[도메인뜻] [83] 밖의 뜻 낱말 ${밖.length}개 — ${밖.join(", ") || "없음"}`);
    for (const k of 밖) {
      expect(glossaryGroundingFor(`${k}이 뭐야?`) ?? "", `${k}의 뜻이 안 깔렸다`).toContain(`${k}:`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 하네스 ⑯ 마당과 제품이 같은 갈래를 보고 있는가
//
// ⑯ 마당(tools/ops-sim.mjs)은 **모델이 자유롭게 답하는 갈래**를 재려고 만든 자리다.
// 누가 [83]에 낱말을 하나 더하면 그 물음이 도구로 새고, ⑯는 **아무것도 안 재면서 초록**이 된다
// (이 저장소가 반복해 겪은 「헛도는 시험」). 그래서 물음을 하네스 소스에서 읽어 못 박는다.
describe("★ 하네스 ⑯ 마당의 다섯 물음이 모델 갈래로 온다", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../tools/ops-sim.mjs"), "utf8");
  const 시작 = src.indexOf('이름: "⑯');
  const 물음시작 = src.indexOf("물음: [", 시작);
  const 물음끝 = src.indexOf("]},", 물음시작);
  const 물음 = 시작 < 0 || 물음끝 < 0
    ? []
    : [...src.slice(물음시작, 물음끝).matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  it("⑯ 마당을 찾았고 물음이 다섯이다", () => {
    expect(시작, "ops-sim.mjs에 ⑯ 마당이 없다 — 지웠다면 이 시험도 함께 볼 것").toBeGreaterThan(0);
    expect(물음.length).toBeGreaterThanOrEqual(5);
  });

  it("★ 다섯 다 [83]에 안 걸린다(= 모델이 답한다)", () => {
    const { re } = 규칙83();
    const 샌것 = 물음.filter((q) => re.test(q));
    expect(샌것, "⑯의 물음이 kpi_status로 강제됐다 — 그 물음은 도메인 뜻을 못 잰다").toEqual([]);
  });

  it("★ 다섯 중 도메인 낱말이 든 물음에는 뜻이 깔린다", () => {
    const 걸린것 = 물음.filter((q) => (glossaryGroundingFor(q) ?? "").includes("이 제품에서의 뜻"));
    console.log(`[도메인뜻] ⑯ 물음 ${물음.length}개 중 뜻이 깔리는 물음 ${걸린것.length}개`);
    expect(걸린것.length, "⑯의 물음에 도메인 뜻이 하나도 안 깔린다 — 표의 낱말과 물음이 어긋났다")
      .toBe(물음.length);
  });
});
