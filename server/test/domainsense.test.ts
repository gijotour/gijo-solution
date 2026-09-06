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
import { DOMAIN_SENSE, glossaryGroundingFor, 남의지표_RE } from "../src/engine/glossary";
import { isOutOfScope } from "../src/engine/scopeguard";

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
// ★★ **남을 가리키는 물음**에는 뜻을 안 깐다 — 라우팅이 좁힌 것을 그라운딩이 도로 넓히면 안 된다
//
// [83]은 「업계 평균 클릭률」·「국내 백신 설치율 통계」를 일부러 비켜 준다(우리 실적이 아니므로).
// 그런데 뜻 주입에 그 배제가 없어서 같은 물음에 「이 제품에서의 뜻 … 마케팅 CTR이 아닙니다」가
// 깔렸다(2026-09-06 검토관 탐침 4문장 전부). 두 층이 같은 방향을 보게 못 박는다.
describe("★★ 남의 지표 물음 — 두 층이 같은 쪽을 본다", () => {
  const 본문83 = 규칙83().본문;
  // 낱말 목록은 **정규식 소스에서 떼어** 온다(양쪽 다 베끼지 않는다).
  const 남의낱말 = 남의지표_RE.source.split("|").filter((w) => /^[가-힣]+$/.test(w));

  it("배제어가 [83]의 배제어에 **다 들어 있다** — 한쪽만 늘리면 다시 어긋난다", () => {
    expect(남의낱말.length, "남의지표_RE에서 낱말을 못 떼어 왔다").toBeGreaterThanOrEqual(8);
    const 없는것 = 남의낱말.filter((w) => !본문83.includes(w));
    expect(없는것, "그라운딩만 아는 배제어가 있다 — [83]은 그 물음을 도구로 채 간다").toEqual([]);
  });

  it("★ 업계·타사·국내·일반적 물음에는 뜻이 안 깔린다", () => {
    for (const q of [
      "업계 평균 클릭률 알려줘",
      "타사 피싱 클릭률 통계 어때?",
      "일반적으로 이커머스 전환율이 얼마야?",
      "국내 기업 교육 참여율 평균",
    ]) {
      expect(glossaryGroundingFor(q) ?? "", `「${q}」에 우리 뜻이 깔렸다`).not.toContain("이 제품에서의 뜻");
    }
  });

  it("★ 우리 물음에는 종전대로 깔린다 — 고치다 방어를 끄지 않았는가", () => {
    for (const q of ["클릭률 낮추는 법", "전환율이 뭐야?", "보안 교육 참여율 높이려면?"]) {
      expect(glossaryGroundingFor(q) ?? "", `「${q}」에 뜻이 안 깔렸다`).toContain("이 제품에서의 뜻");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 신고율 — 뜻 표에 **방향이 반대인 지표**를 처음 들인다 (2026-09-07 · 계획서 전-4)
//
// ■ 왜 이 낱말이 급했나
//   지식 문서 4절(knowledge/GIJO_지식_보안인식교육.md)은 신고율을 클릭률의 **짝**으로 못 박는다 —
//   「클릭률과 신고율은 반대 방향인데 함께 봐야 한다. 둘 다 낮으면 좋아진 게 아니라 아무도
//   반응하지 않은 것이다.」 그런데 뜻 표에는 클릭률만 있었다.
//
// ■ 다른 여섯보다 위험한 자리
//   클릭률·열람률·전환율을 마케팅 뜻으로 읽으면 **딴 제품의 답**이 나간다(2026-09-06 사고).
//   신고율은 한 걸음 더 간다 — 모델이 학습한 세상에서 「신고율」의 주인은 범죄·민원·세금 신고라
//   뜻을 못 잡으면 **방향까지 뒤집힌다.** 「신고율을 낮추려면」이라 조언하는 순간, 침해 대응에서
//   가장 필요한 습관(즉시 신고)을 없애라는 말이 된다. 그래서 뜻과 **방향**을 함께 깐다.
describe("★ 신고율 — 뜻이 깔리고 방향이 함께 실린다", () => {
  it("★ 「신고율 올리려면?」에 이 제품의 뜻이 깔린다", () => {
    const g = glossaryGroundingFor("신고율 올리려면?") ?? "";
    expect(g, "신고율의 뜻이 안 깔렸다 — 모델이 범죄·민원 신고율로 읽는다").toContain("신고율:");
    expect(g).toContain("이 제품에서의 뜻");
    expect(g).toContain("피싱 모의훈련");
  });

  it("★★ 방향이 함께 실린다 — 「낮추라」고 조언하면 정반대다", () => {
    expect(DOMAIN_SENSE["신고율"] ?? "", "신고율에 방향(높을수록)이 없다").toContain("높을수록");
    // 뜻 줄 하나로 방향까지 전해야 한다 — 뒤에 따로 붙이면 프롬프트가 잘릴 때 방향만 떨어진다
    // (corpusnumowner의 「숫자와 주인은 같은 줄에」와 같은 이유).
    expect(DOMAIN_SENSE["신고율"] ?? "").toContain("피싱 모의훈련");
  });

  it("★★ 뜻이 지식 문서와 **글자로 일치**한다 — 두 곳이 갈리면 답도 갈린다", () => {
    // ⚠ 문서를 베껴 오는 게 아니라 **겹치는지 확인**한다. 뜻 표와 코퍼스 문서가 서로 다른 말을
    //   하면, RAG 근거(문서)와 프롬프트 근거(뜻 표)가 한 답 안에서 부딪친다.
    const 문서 = fs.readFileSync(
      path.join(__dirname, "../../knowledge/GIJO_지식_보안인식교육.md"), "utf8");
    for (const 조각 of ["훈련 메일을 신고 창구로 알린", "높을수록"]) {
      expect(문서, `지식 문서에 「${조각}」이 없다 — 문서가 바뀌었으면 뜻 표도 함께 본다`).toContain(조각);
      expect(DOMAIN_SENSE["신고율"] ?? "", `뜻 표에 「${조각}」이 없다 — 문서와 갈렸다`).toContain(조각);
    }
  });

  it("★★ 앞 층(업무 밖 거절)이 「신고」 계열을 안 삼킨다 — 「전환율」 사고의 재발 점검", () => {
    for (const q of ["신고율 올리려면?", "신고율이 뭐야?", "의심 메일 신고 어떻게 해?", "훈련 메일 신고율"]) {
      expect(isOutOfScope(q), `「${q}」가 업무 밖으로 거절된다 — 뜻은 그보다 뒤라 원리상 못 닿는다`)
        .toBe(false);
    }
  });

  it("★★ OFF_TOPIC 목록 자체에 「신고」 함정이 없다 — 우리지표_RE를 빼도 안 걸린다", () => {
    // 「환율」이 「전**환율**」을 삼킨 부류를 다시 재는 자리다. 위 시험은 우리지표_RE(뜻 표에서
    // 읽어 오는 안전장치)에 가려 초록일 수 있으므로, **거절 목록만 떼어** 직접 물어본다.
    const 소스 = fs.readFileSync(path.join(__dirname, "../src/engine/scopeguard.ts"), "utf8");
    const 자리 = 소스.indexOf("const OFF_TOPIC_RE");
    const 시작 = 소스.indexOf("/(", 자리);
    const 끝 = 소스.indexOf("/;", 시작);
    expect(자리, "scopeguard.ts에서 OFF_TOPIC_RE를 못 찾았다").toBeGreaterThan(0);
    expect(끝, "OFF_TOPIC_RE 정규식 리터럴의 모양이 바뀌었다 — 이 시험도 함께 볼 것").toBeGreaterThan(시작);
    const 거절 = new RegExp(소스.slice(시작 + 1, 끝));
    expect(거절.source.split("|").length, "거절 목록이 너무 짧다 — 엉뚱한 데를 떼어 왔다")
      .toBeGreaterThan(20);
    expect(거절.test("전환율이 뭐야?"), "옛 함정이 되살아났다 — 「환율」이 「전환율」을 삼킨다").toBe(false);
    for (const q of ["신고율", "신고율 올리려면?", "의심 메일 신고", "신고 창구"]) {
      expect(거절.test(q), `「${q}」가 거절 목록에 걸린다 — 남의 말 속에 낱말이 들어 있다`).toBe(false);
    }
    // 되돌리기 방지 — 진짜 업무 밖은 목록만으로도 걸려야 한다(고치다 목록을 비우지 않았는가).
    expect(거절.test("오늘 날씨 어때?")).toBe(true);
    expect(거절.test("비트코인 얼마야?")).toBe(true);
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

  // ⚠ 이 시험의 이름을 조심해 적는다(2026-09-06 검토관 적발). 전에는 「[83]에 안 걸린다
  //   (= 모델이 답한다)」였는데, [83]만 보고 「모델이 답한다」로 **넓게** 말한 것이었다.
  //   모델 앞에는 층이 더 있고(아래 시험), 실제로 그 앞 층이 「전환율이 뭐야?」를 삼키고 있었다.
  //   시험은 초록인데 제품은 그 문항을 모델에 안 보냈다 — 약속과 코드의 불일치.
  it("★ 다섯 다 [83]에 안 걸린다(= 강제 도구로 안 샌다)", () => {
    const { re } = 규칙83();
    const 샌것 = 물음.filter((q) => re.test(q));
    expect(샌것, "⑯의 물음이 kpi_status로 강제됐다 — 그 물음은 도메인 뜻을 못 잰다").toEqual([]);
  });

  // ★★ 모델 **앞 층**까지 본다 — 실사고를 무는 자리(2026-09-06)
  //   dispatcher는 도구·RAG보다 **먼저** isOutOfScope로 업무 밖 질문을 거절한다. 「환율」이
  //   「전환율」에 부분일치해서 「전환율이 뭐야?」가 1.0초 만에 거절로 끝났다(라이브 실측·도구 0).
  //   뜻 주입(DOMAIN_SENSE)은 그보다 **뒤**라 원리상 못 닿는다 — 앞 층이 삼키면 뒤 층은 없다.
  it("★★ 다섯 다 **업무 밖 거절**에도 안 걸린다 — 앞 층이 삼키면 뜻은 못 닿는다", () => {
    const 거절된것 = 물음.filter((q) => isOutOfScope(q));
    expect(거절된것, "⑯의 물음이 업무 밖으로 거절됐다 — 모델에 닿지 못하니 ⑯는 영영 빨강이다")
      .toEqual([]);
  });

  it("★ 뜻 표의 낱말은 그 자체로 업무 안이다 — 표에 낱말을 더해도 앞 층이 안 삼키게", () => {
    for (const k of Object.keys(DOMAIN_SENSE)) {
      expect(isOutOfScope(`${k}이 뭐야?`), `「${k}이 뭐야?」가 업무 밖으로 거절된다`).toBe(false);
      expect(isOutOfScope(`${k} 낮추는 법`), `「${k} 낮추는 법」이 업무 밖으로 거절된다`).toBe(false);
    }
    // 되돌리기 방지 — 진짜 업무 밖은 종전대로 거절해야 한다(고치다 방어를 없애지 않았는가).
    expect(isOutOfScope("환율 얼마야?"), "환율은 여전히 업무 밖이어야 한다").toBe(true);
    expect(isOutOfScope("오늘 날씨 어때?")).toBe(true);
  });

  it("★ 다섯 중 도메인 낱말이 든 물음에는 뜻이 깔린다", () => {
    const 걸린것 = 물음.filter((q) => (glossaryGroundingFor(q) ?? "").includes("이 제품에서의 뜻"));
    console.log(`[도메인뜻] ⑯ 물음 ${물음.length}개 중 뜻이 깔리는 물음 ${걸린것.length}개`);
    expect(걸린것.length, "⑯의 물음에 도메인 뜻이 하나도 안 깔린다 — 표의 낱말과 물음이 어긋났다")
      .toBe(물음.length);
  });
});
