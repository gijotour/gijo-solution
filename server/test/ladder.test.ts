// 증류 사다리(계획서 §12)의 **자들**이 제대로 세는지 본다 — 게이트 판정 · 회차 이름표 · 재료 허용목록.
//
// 왜 이 시험이 있나:
//   이 셋은 전부 「틀리면 조용히 망하는」 종류다.
//     · 게이트가 헐거우면 → 나빠진 모델이 「합격」으로 채택된다(그리고 아무도 모른다).
//     · 회차 이름표가 겹치면 → 앞 회차 결과가 덮여 **사라진다**(비교할 것이 없어진다).
//     · 허용목록이 헐거우면 → 고객 자산·운영 DB가 학습 재료로 샌다(되돌릴 수 없다).
//   밤새 도는 자동화라 사람이 옆에서 안 본다. 자 자체를 여기서 잰다.
//
// ★ 「그 값을 누가 넣는가」 — 게이트가 읽는 값은 전부 **다른 자가 이미 남긴 것**이다:
//   20자 겹침은 tasks.mjs T6 채점기가, 점수·한글·tok/s는 run.mjs가 남긴다. 그래서 이 시험은
//   「게이트가 그 값을 다시 계산하지 않고 **그대로 읽는가**」를 함께 본다(잣대 단일 출처).
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  판정, 표만들기, kev판정, cisa본문, detail숫자, 인용겹침, 잘림수, tps중앙값, 한글평균, 기준선기본, NEEDLE64K,
  kev베이스대비, 근거인용률, 자료없음비율, 자료없음중복가드, 자료없음이라말함, 인용토막들, 창작인용, 창작인용찾기,
  kev대상행, 창작인용대상인가,
  genTokens중앙값, 서술과제, 건너뜀수, 자료없음_최소비율, 길이_허용낙폭,
} from "../../tools/team-bench/gates.mjs";
import { 절세기 } from "../../tools/team-bench/tasks.mjs";
import {
  회차이름표, 회차번호, 허용인가, 참조정규화, 매니페스트파일들, 허용목록읽기, 재료가르기,
} from "../../tools/ladder/ladderlib.mjs";

// ── 재료: run.mjs가 남기는 꼴 그대로(필드 이름을 지어내지 않는다) ────────────
const 과제 = (score: number, extra: Record<string, unknown> = {}) => ({
  role: "x", score, ms: 1000, genTps: 20, genTokens: 150, 한글: 1, 한자: 0, finish: "stop", detail: "", ...extra,
});
const 기준easy = () => ({
  id: "base", tasks: {
    scan_extract: 과제(1),
    glossary_cite: 과제(1, { detail: "인용 1 · 20자겹침 1 · 핵심 1" }),
    tool_select: 과제(1, { 한글: 0 }),
  },
});
const 기준hard = () => ({
  id: "base", tasks: {
    ti_trap: 과제(0, { 한글: 0.9, detail: "맞음 2/2 · 오탐 3/4" }),
    // ⚠ needle_64k는 ctx 초과로 **요청 자체가 실패**한다 — finish가 없다(잘림과 다르다).
    [NEEDLE64K]: { role: "scan", score: 0, ms: 1899, 한글: 0, 한자: 0, detail: "요청 실패 400" },
  },
});
/** 기준선보다 나아진 실행(ti_trap 0 → 0.5). 나머지는 그대로. */
const 나아진 = () => {
  const h = 기준hard();
  h.tasks.ti_trap = 과제(0.5, { 한글: 0.9, detail: "맞음 2/2 · 오탐 1/4" });
  return h;
};
const kev좋음 = [
  { label: "prompt", q: "KEV 목록은 누가 발표해?", text: "KEV 목록은 미국 CISA가 발표합니다." },
  { label: "prompt", q: "KEV가 뭐야?", text: "사이버보안 및 인프라 보안국(CISA)이 관리합니다." },
  { label: "prompt", q: "누가 관리해?", text: "CISA입니다." },
];

// ── 표본 세 조건(ask-samples.mjs가 남기는 꼴) ─────────────────────────────
const 정답조각 = "기본 관리자 계정명을 변경하지 않고 사용할 경우 공격자에 의한 계정 및 비밀번호 추측 공격이 가능함";
const 방해조각 = "백업 매체는 외부 보관 위탁처에 월 1회 반출하며 반출 이력을 자동으로 남긴다";
const 표본행 = (mode: string, text: string, extra: Record<string, unknown> = {}) => ({
  mode, question: "기본 관리자 계정명을 그대로 두면 어떤 위협이 있나요?", chunk: mode === "grounded" ? 정답조각 : "",
  distractor: mode === "bare" ? "" : 방해조각, text, 한글: 1, finish: "stop", promptSha12: "0123456789ab", systemChars: 900,
});
/** 근거를 준 자리에서 **옮겨 적은** 답 — overlap20이 20자 창을 찾는다. */
const grounded좋음 = [
  표본행("grounded", `자료에 따르면 ${정답조각}. 그러므로 계정명을 바꿔야 합니다.`),
  표본행("grounded", `${정답조각}. 계정명 변경을 권합니다.`),
];
/** 같은 뜻이지만 제 말로 바꿔 쓴 답 — 20자 창이 하나도 안 남는다(베이스 자리). */
const grounded나쁨 = [
  표본행("grounded", "관리자 계정 이름을 그대로 쓰면 위험합니다. 바꾸는 것이 좋습니다."),
  표본행("grounded", "기본 계정명은 널리 알려져 있어 안전하지 않습니다."),
];
const 방해만좋음 = [
  표본행("distractor-only", "제공된 자료에는 없습니다. 일반 지식으로 답하면 계정명을 바꾸는 것이 좋습니다."),
  표본행("distractor-only", "이 내용은 자료에는 없습니다. 다른 문서를 넣어 주세요."),
];
const 맨질문깨끗 = [표본행("bare", "기본 관리자 계정명을 바꾸는 것이 좋습니다.")];

describe("게이트 — KEV 발표 주체", () => {
  it("★ URL만 cisa.gov이고 본문은 딴소리인 답을 **잡는다**(2026-09-03 실측: 본문이 「보건복지부」였다)", () => {
    const 거짓 = "KEV 목록은 대한민국 보건복지부에서 발표합니다. 참고: https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
    expect(cisa본문(거짓), "URL을 세면 이 거짓이 통과한다").toBe(false);
    expect(cisa본문("KEV는 미국 CISA가 발표합니다.")).toBe(true);
  });

  it("대조군(noprompt)은 세지 않는다 — 같이 세면 절대 통과 못 한다", () => {
    const 섞임 = [...kev좋음, { label: "noprompt", q: "KEV?", text: "보건복지부입니다." }];
    const r = kev판정(섞임);
    expect(r.대상).toBe(3);
    expect(r.통과).toBe(true);
  });

  it("문항이 3개 미만이면 통과가 아니다 — 「3/3」의 3은 최소 문항 수다", () => {
    const r = kev판정(kev좋음.slice(0, 2));
    expect(r.성립).toBe(2);
    expect(r.통과, "2/2도 통과가 되면 문항을 줄여 게이트를 넘길 수 있다").toBe(false);
  });

  it("라벨이 아예 없는 파일은 전부를 대상으로 본다", () => {
    const r = kev판정(kev좋음.map(({ q, text }) => ({ q, text })));
    expect(r.대상).toBe(3);
    expect(r.통과).toBe(true);
  });
});

describe("게이트 — 잣대를 다시 계산하지 않고 인용한다", () => {
  it("20자 겹침은 채점기가 남긴 detail에서 읽는다", () => {
    expect(detail숫자("인용 1 · 20자겹침 1 · 핵심 1", "20자겹침")).toBe(1);
    expect(detail숫자("인용 1 · 20자겹침 0 · 핵심 0.4", "핵심")).toBe(0.4);
    expect(인용겹침(기준easy())).toBe(1);
  });

  it("detail이 그 꼴이 아니면 null — 0으로 적지 않는다(모르는 것과 없는 것은 다르다)", () => {
    expect(detail숫자("항목 6/6 · 심각도 6/6", "20자겹침")).toBeNull();
    expect(인용겹침({ tasks: {} })).toBeNull();
  });

  it("잘림은 finish=length만 센다 — 요청 실패(finish 없음)는 잘림이 아니다", () => {
    expect(잘림수(기준easy(), 기준hard()), "needle_64k의 400을 잘림으로 세면 원인을 잘못 읽는다").toBe(0);
    const 잘린 = 기준easy();
    잘린.tasks.scan_extract = 과제(1, { finish: "length" });
    expect(잘림수(잘린)).toBe(1);
    expect(잘림수(null, [{ finish: "length" }, { finish: "stop" }]), "samples 배열도 같은 규칙으로 센다").toBe(1);
  });

  it("한글 평균은 JSON만 뱉는 과제의 0도 포함해 잰다(기준선과 같은 방식이어야 견줄 수 있다)", () => {
    // scan_extract 1 · glossary_cite 1 · tool_select 0 → 2/3
    expect(한글평균(기준easy())).toBeCloseTo(2 / 3, 6);
  });

  it("tok/s 중앙값은 run.mjs 표와 같은 규칙(정렬 후 floor(n/2))으로 고른다", () => {
    const r = { tasks: { a: 과제(1, { genTps: 10 }), b: 과제(1, { genTps: 20 }), c: 과제(1, { genTps: 30 }) } };
    expect(tps중앙값(r)).toBe(20);
    expect(tps중앙값({ tasks: {} }), "잰 것이 없으면 null").toBeNull();
  });
});

describe("게이트 — 판정", () => {
  // 기준선에는 과제 결과뿐 아니라 **베이스 대조**(kev · grounded 표본)도 들어간다 — 관문 ①·⑧이 견줄 상대다.
  const 기준 = () => ({ easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 });
  /** 열한 관문을 전부 재려면 입력이 이만큼 있어야 한다(하나라도 없으면 미측정=불합격이 맞다). */
  const 다갖춘입력 = (easy: unknown, hard: unknown) => ({
    easy, hard, kev: kev좋음,
    표본grounded: grounded좋음, 표본방해만: 방해만좋음, 표본맨질문: 맨질문깨끗,
  });

  it("★ 자기 자신과 견주면 불합격이다 — avg13은 「이상」이 아니라 **초과**를 요구한다", () => {
    const r = 판정({ easy: 기준easy(), hard: 기준hard(), kev: kev좋음 }, 기준());
    const avg = r.검사.find((c: { 키: string }) => c.키 === "avg13");
    expect(avg.통과, "본전이면 학습한 값이 없다").toBe(false);
    expect(r.합격).toBe(false);
  });

  it("나아진 실행은 **열한** 관문을 모두 넘는다", () => {
    const r = 판정(다갖춘입력(기준easy(), 나아진()), 기준());
    const 못넘음 = r.검사.filter((c: { 통과: boolean }) => !c.통과).map((c: { 이름: string }) => c.이름);
    expect(못넘음, `못 넘은 관문: ${못넘음.join(", ")}`).toEqual([]);
    expect(r.검사, "관문이 11개다 — 늘리거나 줄이면 여기가 먼저 말한다").toHaveLength(11);
    expect(r.합격).toBe(true);
  });

  it("★ 입력이 없으면 「미측정」이고 전체는 **불합격**이다(fail-closed)", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진() }, 기준()); // kev 없음
    const kev = r.검사.find((c: { 키: string }) => c.키 === "kev");
    expect(kev.값).toBe("미측정");
    expect(kev.통과).toBe(false);
    expect(r.합격, "못 잰 것을 통과로 세면 게이트가 게이트가 아니다").toBe(false);
  });

  it("1회차 과제가 하나라도 떨어지면 막고, **어느 과제인지** 말한다", () => {
    const 깨진 = 기준easy();
    깨진.tasks.tool_select = 과제(0.5, { 한글: 0 });
    const r = 판정({ easy: 깨진, hard: 나아진(), kev: kev좋음 }, 기준());
    const c = r.검사.find((x: { 키: string }) => x.키 === "easy7_no_drop");
    expect(c.통과).toBe(false);
    expect(c.설명).toContain("tool_select");
    expect(c.설명).toContain("1→0.5");
  });

  it("과제를 아예 안 돌리고 평균만 올리는 길을 막는다(미실시도 하락으로 본다)", () => {
    const 빠뜨림 = 기준easy();
    delete (빠뜨림.tasks as Record<string, unknown>).tool_select; // 한글 0짜리 과제를 빼면 한글 평균이 올라간다
    const r = 판정({ easy: 빠뜨림, hard: 나아진(), kev: kev좋음 }, 기준());
    const c = r.검사.find((x: { 키: string }) => x.키 === "easy7_no_drop");
    expect(c.통과).toBe(false);
    expect(c.설명).toContain("안 돌린 과제");
  });

  it("needle_64k는 기본으로 평균에서 빠지고, 어느 쪽으로 쟀는지 **표에 적힌다**", () => {
    const 뺀것 = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음 }, 기준());
    const 넣은것 = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음 }, 기준(), { needle64k포함: true });
    const 값 = (r: { 검사: { 키: string; 값: unknown }[] }) => Number(r.검사.find((c) => c.키 === "avg13")!.값);
    expect(값(뺀것)).toBeGreaterThan(값(넣은것)); // 0점 하나가 더 들어가면 평균이 내려간다
    expect(표만들기(뺀것)).toContain("needle_64k 제외");
    expect(표만들기(넣은것)).toContain("needle_64k 포함");
  });

  it("생성 속도가 10% 넘게 떨어지면 막는다 — 두뇌가 스왑에 밀린 신호다", () => {
    const 느린 = 기준easy();
    for (const k of Object.keys(느린.tasks)) (느린.tasks as Record<string, { genTps: number }>)[k].genTps = 17; // 20 → 17 = 15% 낙폭
    const r = 판정({ easy: 느린, hard: 나아진(), kev: kev좋음 }, 기준());
    expect(r.검사.find((c: { 키: string }) => c.키 === "tps_drop").통과).toBe(false);

    const 조금느린 = 기준easy();
    for (const k of Object.keys(조금느린.tasks)) (조금느린.tasks as Record<string, { genTps: number }>)[k].genTps = 18.5; // 7.5%
    const r2 = 판정({ easy: 조금느린, hard: 나아진(), kev: kev좋음 }, 기준());
    expect(r2.검사.find((c: { 키: string }) => c.키 === "tps_drop").통과, "정상 범위의 느려짐까지 막으면 아무것도 못 채택한다").toBe(true);
  });

  it("표는 못 넘었을 때 「채택하지 않는다」를 말한다", () => {
    const 표 = 표만들기(판정({ easy: 기준easy(), hard: 기준hard() }, 기준()));
    expect(표).toContain("불합격");
    expect(표).toContain("채택하지 않는다");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2026-09-04에 붙인 관문 넷(⑧⑨⑩⑪)과 고친 둘(①②)
//   왜: r1-base 회전까지 **RAFT의 목적(근거를 주면 인용한다)을 재는 관문이 0개**였고,
//   실제로 난 회귀 둘(「원문:」 창작 · 서술 답 34~72% 축소)을 세는 코드도 없었다.
//   관문은 「나빠졌을 때 빨강이 되는가」로만 값어치가 있으므로, 통과·불통과 **양쪽**을 여기서 잰다.
// ══════════════════════════════════════════════════════════════════════

describe("관문 ① — KEV는 베이스 대비로 본다", () => {
  const 베이스 = [
    { label: "prompt", q: "Q1", text: "미국 CISA가 발표합니다." },
    { label: "prompt", q: "Q2", text: "CISA입니다." },
    { label: "prompt", q: "Q3", text: "미국 국방부가 발표합니다." }, // 베이스도 틀리는 문항(실측: 3번)
  ];

  it("★ 베이스가 틀린 문항은 세지 않는다 — 절대 3/3은 베이스도 못 넘어 늘 빨강이었다", () => {
    const 이번 = [
      { label: "prompt", q: "Q1", text: "미국 CISA가 발표합니다." },
      { label: "prompt", q: "Q2", text: "CISA입니다." },
      { label: "prompt", q: "Q3", text: "여전히 국방부라고 답한다." },
    ];
    const k = kev베이스대비(이번, 베이스);
    expect(k.하락).toEqual([]);
    expect(k.통과, "베이스와 똑같으면 회귀가 아니다").toBe(true);
    expect(k.절대, "절대값은 참고로 남는다").toEqual({ 성립: 2, 대상: 3 });
  });

  it("맞던 문항이 틀리면 **어느 문항인지** 말하고 막는다", () => {
    const 나빠짐 = [
      { label: "prompt", q: "Q1", text: "미국 국방부가 발표합니다." }, // O → X
      { label: "prompt", q: "Q2", text: "CISA입니다." },
      { label: "prompt", q: "Q3", text: "국방부입니다." },
    ];
    const k = kev베이스대비(나빠짐, 베이스);
    expect(k.하락).toEqual(["Q1"]);
    expect(k.통과).toBe(false);
  });

  it("베이스에 있는 문항을 안 돌리면 미실시로 막는다(문항을 빼서 넘기는 길을 닫는다)", () => {
    const k = kev베이스대비(베이스.slice(0, 2), 베이스);
    expect(k.미실시).toEqual(["Q3"]);
    expect(k.통과).toBe(false);
  });

  it("★ --kev-base가 없으면 미측정이고 전체는 불합격이다(무엇과 견줄지 모르는 채로 통과시키지 않는다)", () => {
    const r = 판정({ easy: 기준easy(), hard: 기준hard(), kev: kev좋음 }, { easy: 기준easy(), hard: 기준hard() });
    const c = r.검사.find((x: { 키: string }) => x.키 === "kev");
    expect(c.값).toBe("미측정");
    expect(c.설명).toContain("베이스");
    expect(r.합격).toBe(false);
  });
});

describe("관문 ② — 「인용」 회귀도 함께 본다", () => {
  it("★ 20자겹침은 그대로인데 「인용」이 1→0이면 막는다(예전 게이트는 초록이었다 — r1-base 실측)", () => {
    const 기준 = 기준easy();
    const 회귀 = 기준easy();
    회귀.tasks.glossary_cite = 과제(0.7, { detail: "인용 0 · 20자겹침 1 · 핵심 1" });
    const r = 판정({ easy: 회귀, hard: 나아진(), kev: kev좋음 }, { easy: 기준, hard: 기준hard(), kev: kev좋음 });
    const c = r.검사.find((x: { 키: string }) => x.키 === "cite_overlap");
    expect(c.통과).toBe(false);
    expect(c.값).toContain("인용 0");
    expect(c.설명).toContain("겹침만 보면");
  });
});

describe("관문 ⑧ — 근거를 주면 옮겨 적는가", () => {
  it("근거를 옮겨 적으면 성립, 제 말로 바꿔 쓰면 불성립", () => {
    expect(근거인용률(grounded좋음)!.비율).toBe(1);
    expect(근거인용률(grounded나쁨)!.비율).toBe(0);
  });

  it("★ 조각이 없어 건너뛴 문항은 **셈에서 빼고 그 수를 남긴다**(0으로 세지 않는다)", () => {
    const 섞임 = [...grounded좋음, { mode: "grounded", question: "Q", skipped: "정답 조각(chunk)이 비어 있다" }];
    const g = 근거인용률(섞임)!;
    expect(g.대상, "건너뛴 문항을 0점으로 세면 인용률이 거짓으로 낮아진다").toBe(2);
    expect(g.건너뜀).toBe(1);
    expect(건너뜀수(섞임)).toBe(1);
  });

  it("베이스보다 나으면 통과, 못하면 막는다", () => {
    const 기준 = { easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded좋음 };
    const 나빠짐 = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음, 표본grounded: grounded나쁨 }, 기준);
    expect(나빠짐.검사.find((c: { 키: string }) => c.키 === "grounded_cite").통과).toBe(false);
    const 같음 = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음, 표본grounded: grounded좋음 }, 기준);
    expect(같음.검사.find((c: { 키: string }) => c.키 === "grounded_cite").통과, "본전이면 인용 관문은 통과다(avg13과 달리 「이상」이다)").toBe(true);
  });

  it("베이스 표본이 없으면 미측정 — 불합격", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음, 표본grounded: grounded좋음 }, { easy: 기준easy(), hard: 기준hard(), kev: kev좋음 });
    expect(r.검사.find((c: { 키: string }) => c.키 === "grounded_cite").값).toBe("미측정");
  });
});

describe("관문 ⑨ — 「원문:」을 지어내지 않는가", () => {
  it("★ 근거를 안 준 자리의 「원문:」은 그 자체가 창작이다", () => {
    // 꼬리표 하나(ⓐ) + 「제 앞 문장을 원문이라 인용」 하나(ⓑ) = 사유 둘.
    expect(창작인용({ text: '미국 국방부가 KEV 목록을 발표하고 관리합니다. 원문: "미국 국방부가 KEV 목록을 발표하고 관리합니다."' })).toHaveLength(2);
    // 짧은 따옴표(20자 미만)는 ⓑ로 못 본다 — 그래도 꼬리표 하나는 남는다(모르는 것을 세지 않되, 아는 것은 센다).
    expect(창작인용({ text: '국방부입니다. 원문: "국방부입니다."' })).toHaveLength(1);
    expect(창작인용({ text: "미국 CISA가 발표합니다." })).toEqual([]);
  });

  it("★ 사용자 지시문을 원문이라 인용하면 잡는다(r1-base report_draft가 그랬다)", () => {
    const 행 = {
      question: "files.example.co.kr의 Apache Struts 원격 코드 실행에 대한 조치 요청서를 써라. 담당은 인프라팀.",
      text: '조치 요청서를 씁니다. 원문: "files.example.co.kr의 Apache Struts 원격 코드 실행에 대한 조치 요청서를 써라. 담당은 인프라팀."',
    };
    const 사유 = 창작인용(행);
    expect(사유.some((s: string) => s.includes("질문과 20자 겹침"))).toBe(true);
  });

  it("★★ 인용이라 **주장하지 않은** 따옴표는 안 센다 — 베이스의 정상 답이 걸렸던 오탐", () => {
    // 실측(2026-09-04): 베이스가 `CISA의 "Known Exploited Vulnerabilities Catalog"`라고 썼는데
    // 앞 문장에도 같은 고유명사가 있어 「자기 앞 문장 인용」으로 걸렸다. 그대로 두면 ⑨가 베이스에서도
    // 빨강이 되고, 늘 빨강인 관문은 회귀를 못 알린다.
    const 정상 = { text: 'KEV는 Known Exploited Vulnerabilities의 약자입니다. 목록은 CISA의 "Known Exploited Vulnerabilities Catalog"에 있습니다.' };
    expect(창작인용(정상), "고유명사를 두 번 쓴 정상 답").toEqual([]);
    const 주장 = { text: '이 목록은 미국 CISA가 관리하며 주기적으로 갱신됩니다. 출처: "이 목록은 미국 CISA가 관리하며 주기적으로 갱신됩니다."' };
    expect(창작인용(주장).length, "「출처:」를 붙여 제 말을 남의 글이라 우겼다").toBeGreaterThan(0);
  });

  it("따옴표 토막은 20자 이상만 본다(overlap20이 볼 수 있는 최소 창)", () => {
    expect(인용토막들('그는 "짧다"고 말했다')).toEqual([]);
    expect(인용토막들('원문: "스무 글자가 넘는 아주 기다란 인용 토막입니다"')).toHaveLength(1);
  });

  it("★ 빈 배열은 「0건 통과」가 아니라 **미측정**이다(0건과 못 잼은 다르다)", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진(), 표본맨질문: [] }, { easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 });
    expect(r.검사.find((c: { 키: string }) => c.키 === "no_fake_quote").값).toBe("미측정");
  });

  it("bare 표본과 kev를 함께 세고, 하나라도 걸리면 막는다", () => {
    const 기준 = { easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 };
    const 더러움 = [{ mode: "bare", question: "Q", text: '답입니다. 원문: "지어낸 원문"' }];
    const r = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음, 표본grounded: grounded좋음, 표본방해만: 방해만좋음, 표본맨질문: 더러움 }, 기준);
    const c = r.검사.find((x: { 키: string }) => x.키 === "no_fake_quote");
    expect(c.통과).toBe(false);
    expect(c.값).toContain("1건");
  });
});

describe("관문 ⑩ — 방해 조각만 주면 「자료에 없다」고 말하는가", () => {
  it("제품과 같은 잣대로, 제품과 같이 **앞 60자만** 본다", () => {
    expect(자료없음이라말함("제공된 자료에는 없습니다.")).toBe(true);
    // 앞 60자 밖의 「없습니다」는 안 센다 — 전체를 보면 「영향이 없습니다」 같은 딴 문장이 걸린다.
    const 뒤늦게 = "관리자 계정명은 추측 공격의 표적이 되므로 반드시 변경해야 하며 그 근거는 여러 지침에 흩어져 있습니다만 이 자료에는 없습니다.";
    expect(뒤늦게.slice(0, 60).includes("없습니다")).toBe(false);
    expect(자료없음이라말함(뒤늦게)).toBe(false);
  });

  it("★ 정규식이 서버(llm.ts 자료없음중복가드)와 **글자 그대로 같다**", () => {
    // .mjs에서 .ts를 못 부르므로 복제했다 — 복제에는 반드시 짝 시험이 붙는다(안 붙이면 조용히 갈린다).
    const llm = readFileSync(join(__dirname, "..", "src", "engine", "llm.ts"), "utf8");
    const m = /export const 자료없음중복가드 = (\/.+\/);/.exec(llm);
    expect(m, "llm.ts에서 자료없음중복가드 선언을 못 찾았다 — 이름이 바뀌었으면 gates.mjs도 함께 고칠 것").toBeTruthy();
    expect(`/${자료없음중복가드.source}/`).toBe(m![1]);
  });

  it("기준(0.5) 아래면 막는다", () => {
    expect(자료없음비율(방해만좋음)!.비율).toBe(1);
    const 반만 = [방해만좋음[0], { mode: "distractor-only", question: "Q", text: "관리자 계정명을 바꾸는 것이 좋습니다." }];
    expect(자료없음비율(반만)!.비율).toBe(0.5);
    const 하나도 = [{ mode: "distractor-only", question: "Q", text: "관리자 계정명을 바꾸는 것이 좋습니다." }];
    const 기준 = { easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 };
    const r = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음, 표본grounded: grounded좋음, 표본방해만: 하나도, 표본맨질문: 맨질문깨끗 }, 기준);
    expect(r.검사.find((c: { 키: string }) => c.키 === "no_evidence_says_so").통과).toBe(false);
    expect(자료없음_최소비율).toBe(0.5);
  });
});

describe("관문 ⑪ — 서술 답이 짧아지지 않았는가", () => {
  it("★ 대상 과제는 **스키마 강제가 없는 것만**이다 — 출처는 tasks.mjs의 schema 필드다", () => {
    const { 대상, 스키마강제 } = 서술과제();
    expect(대상, "json_schema를 강제하면 길이가 스키마에 눌려 축소가 안 드러난다").toEqual(["report_draft", "report_fix", "glossary_cite"]);
    expect(스키마강제).toEqual(["priority_rank", "priority_6", "scan_messy"]);
  });

  it("40%보다 더 줄면 막고, 그 안이면 통과한다", () => {
    const 기준 = { easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 };
    const 짧아짐 = 기준easy();
    짧아짐.tasks.glossary_cite = 과제(1, { detail: "인용 1 · 20자겹침 1 · 핵심 1", genTokens: 50 }); // 150 → 50 = 66.7%
    const r = 판정({ easy: 짧아짐, hard: 나아진(), kev: kev좋음, 표본grounded: grounded좋음, 표본방해만: 방해만좋음, 표본맨질문: 맨질문깨끗 }, 기준);
    const c = r.검사.find((x: { 키: string }) => x.키 === "len_drop");
    expect(c.통과).toBe(false);
    expect(c.설명, "왜 뺐는지 표에 적힌다").toContain("priority_rank");

    const 조금 = 기준easy();
    조금.tasks.glossary_cite = 과제(1, { detail: "인용 1 · 20자겹침 1 · 핵심 1", genTokens: 110 }); // 26.7%
    const r2 = 판정({ easy: 조금, hard: 나아진(), kev: kev좋음, 표본grounded: grounded좋음, 표본방해만: 방해만좋음, 표본맨질문: 맨질문깨끗 }, 기준);
    expect(r2.검사.find((c2: { 키: string }) => c2.키 === "len_drop").통과, "정상 범위의 짧아짐까지 막으면 아무것도 못 채택한다").toBe(true);
    expect(길이_허용낙폭).toBe(0.4);
  });

  it("안 잰 과제는 0으로 채우지 않는다 — 잰 것이 없으면 null(미측정)", () => {
    expect(genTokens중앙값([{ tasks: {} }], ["report_draft"])).toBeNull();
    expect(genTokens중앙값([{ tasks: { report_draft: 과제(1, { genTokens: 300 }), glossary_cite: 과제(1, { genTokens: 100 }) } }], ["report_draft", "glossary_cite"])).toBe(300);
  });
});

describe("★ r1-base 실물 결과를 새 게이트에 넣으면 ⑨가 빨강이다", () => {
  const 폴더 = join(__dirname, "..", "..", "tools", "team-bench", "results-ladder", "day2", "r1-base");
  const 읽기 = (f: string) => JSON.parse(readFileSync(join(폴더, f), "utf8"));

  it("실제 kev.json·samples.json에서 「원문:」 창작이 잡힌다(가짜 재료가 아니라 그날의 파일이다)", () => {
    const kev = 읽기("kev.json");
    const bare = 읽기("samples.json");
    // ★ 관문이 세는 모집단은 **관문 ①과 같은 자리**다 — 대조군 noprompt(시스템 프롬프트 없음)는 뺀다.
    //   2026-09-04 검토관 적발: 예전에는 kev를 통째로 넘겨 대조군까지 셌다(18건 중 3건이 대조군).
    const f = 창작인용찾기(kev대상행(kev), bare);
    expect(f.대상, "kev[prompt] 3 + 표본 12").toBe(15);
    expect(f.걸린행, "예전 게이트는 이 5건을 세는 코드가 아예 없었다").toBe(5);
    // 통째로 세면 7건이 되는데, 그중 2건은 **제품이 쓰지 않는 조건**의 몫이다(그것으로 채택을 막으면 안 된다).
    expect(창작인용찾기(kev, bare).걸린행, "대조군까지 세면 2건이 더 붙는다").toBe(7);
  });

  it("★ 베이스(어댑터 없음)의 kev는 0건이다 — ⑨는 늘 빨강인 관문이 아니다", () => {
    const 베이스 = 읽기("kev-base-대조.json");
    expect(창작인용찾기(베이스).걸린행, "베이스도 걸리면 관문이 회귀를 못 알린다").toBe(0);
  });

  it("판정에 그대로 넣으면 no_fake_quote가 불통과다", () => {
    const r = 판정(
      { easy: 읽기("easy/qwen3-14b+r1-base.json"), hard: 읽기("hard/qwen3-14b+r1-base.json"), kev: 읽기("kev.json"), 표본맨질문: 읽기("samples.json") },
      { easy: JSON.parse(readFileSync(기준선기본.easy, "utf8")), hard: JSON.parse(readFileSync(기준선기본.hard, "utf8")), kev: 읽기("kev-base-대조.json") },
    );
    const c = r.검사.find((x: { 키: string }) => x.키 === "no_fake_quote");
    expect(c.통과).toBe(false);
    expect(r.합격).toBe(false);
    // 같은 파일로 ①(베이스 대비)과 ⑪(길이)도 빨강이어야 한다 — 그날 실제로 난 회귀다.
    expect(r.검사.find((x: { 키: string }) => x.키 === "kev").통과, "베이스 2/3 → 이번 0/3").toBe(false);
    expect(r.검사.find((x: { 키: string }) => x.키 === "len_drop").통과, "서술 답이 66% 짧아졌다").toBe(false);
  });
});

describe("채점 구멍 — 절은 「줄 머리 + 아래 본문」이라야 센다", () => {
  const 필수절6 = ["제목", "대상 자산", "위험 요약", "조치 방법", "조치 기한", "담당 부서"];

  it("★ 절 이름만 나열한 답은 0/6이다 — 예전 채점기는 이 답에 **6/6**을 줬다(r1-base 실측)", () => {
    const 나열 = "제목 / 대상 자산 / 위험 요약 / 조치 방법 / 조치 기한 / 담당 부서\nhr.example.co.kr(10.20.1.22) /upload.do 의 임의 파일 업로드 취약점";
    expect(필수절6.every((s) => 나열.includes(s)), "예전 잣대(includes)로는 전부 있다고 나온다").toBe(true);
    expect(절세기(나열, 필수절6).수).toBe(0);
  });

  it("마크다운 제목·번호·굵게·`:` 어느 꼴이든 본문이 있으면 센다", () => {
    const 제대로 = ["## 제목", "조치 요청", "", "**대상 자산**", "10.20.1.22", "", "3. 위험 요약", "웹셸 업로드가 가능하다", "", "조치 방법:", "- 검증 강화", "", "- 조치 기한", "3일 안", "", "담당 부서: 인프라팀"].join("\n");
    expect(절세기(제대로, 필수절6).수).toBe(6);
  });

  it("제목만 있고 아래가 비면 안 센다 — 서식은 「칸이 있다」가 아니라 「칸이 채워졌다」다", () => {
    expect(절세기("## 조치 기한", ["조치 기한"]).수).toBe(0);
    expect(절세기("## 조치 기한\n3일 안", ["조치 기한"]).수).toBe(1);
  });

  it("기준선 두 파일은 새 채점기로도 같은 값이 나온다(그래서 기준선을 안 바꿨다)", () => {
    const easy = JSON.parse(readFileSync(기준선기본.easy, "utf8"));
    const hard = JSON.parse(readFileSync(기준선기본.hard, "utf8"));
    expect(절세기(easy.tasks.report_draft.answer, ["제목", "대상 자산", "취약점 요약", "조치 방법", "조치 기한", "담당"]).수, "예전 detail도 5/6이었다").toBe(5);
    expect(절세기(hard.tasks.report_fix.answer, 필수절6).수, "예전 detail도 6/6이었다").toBe(6);
  });
});

describe("게이트 — 저장소에 실린 기준선 파일", () => {
  it("★ 기준선 두 파일이 실제로 읽히고, needle_64k가 0이다(빼는 이유의 근거)", () => {
    for (const p of [기준선기본.easy, 기준선기본.hard]) {
      expect(existsSync(p), `기준선이 없다: ${p} — 게이트가 무엇과 견줄지 모르게 된다`).toBe(true);
    }
    const hard = JSON.parse(readFileSync(기준선기본.hard, "utf8"));
    expect(hard.tasks[NEEDLE64K].score, "qwen3-14b는 n_ctx_train 40960이라 74,256토큰을 못 받는다").toBe(0);
    const easy = JSON.parse(readFileSync(기준선기본.easy, "utf8"));
    expect(인용겹침(easy), "기준선의 20자 겹침을 못 읽으면 인용 관문이 통째로 미측정이 된다").toBe(1);
  });
});

describe("회차 이름표 — 앞 회차를 덮지 않는다", () => {
  it("빈 곳에서는 01부터", () => {
    expect(회차이름표("취약점", [])).toBe("취약점-01");
  });

  it("★ 있는 것 다음 번호를 준다 — 같은 이름을 두 번 주면 앞 결과가 사라진다", () => {
    expect(회차이름표("취약점", ["취약점-01.json", "취약점-02.json"])).toBe("취약점-03");
  });

  it("번호에 구멍이 있어도 최대+1이다(빈자리를 다시 쓰면 그 자리 로그와 어긋난다)", () => {
    expect(회차이름표("취약점", ["취약점-01.json", "취약점-05.json"])).toBe("취약점-06");
  });

  it("다른 주제 파일은 안 센다", () => {
    expect(회차이름표("일반", ["취약점-01.json", "취약점-02.json", "일반-01.json"])).toBe("일반-02");
  });

  it("곁다리 파일(로그·승인 결과)에 끌려가지 않는다", () => {
    expect(회차번호("취약점-01.approve.json", "취약점"), "확장자가 두 겹인 곁다리는 회차가 아니다").toBeNull();
    expect(회차번호("distill-취약점-2026-09-03-02-47.json", "취약점"), "시각 기반 원본 이름은 회차가 아니다").toBeNull();
    expect(회차번호("취약점-01.json", "취약점"), "보고서 하나만 회차다").toBe(1);
    expect(회차이름표("취약점", ["취약점-01.json", "취약점-01.approve.json", "취약점-01.log"])).toBe("취약점-02");
  });

  // [2026-09-03 1일차 실기동] `사내규정-01.log`가 회차 1로 세어져 **보고서 없이 죽은 회차를**
  //   --skip-done이 영영 건너뛰었다(그날은 로그를 손으로 `.crash.log`로 바꿔 피했다 — 자동화가
  //   사람 손을 부른 것이 결함의 증거다). 로그는 증류가 **시작될 때**, 보고서는 **끝나야** 생긴다.
  it("★ 로그만 있으면 끝난 회차 0 — .log를 세면 실패가 성공으로 둔갑한다", () => {
    expect(회차번호("사내규정-01.log", "사내규정"), "로그는 시작의 증거일 뿐 끝의 증거가 아니다").toBeNull();
    expect(회차이름표("사내규정", ["사내규정-01.log"]), "끝난 회차가 0이니 같은 번호를 다시 시도한다").toBe("사내규정-01");
  });

  it("★ .json 보고서가 있어야 그 회차가 1로 센다", () => {
    expect(회차이름표("사내규정", ["사내규정-01.log", "사내규정-01.json"])).toBe("사내규정-02");
    // 실패 표식(day1-distill.sh가 옮긴 이름)도 셈에 안 걸린다 — 점이 둘인 이름은 보고서 꼴이 아니다.
    expect(회차번호("사내규정-01.failed.log", "사내규정")).toBeNull();
    expect(회차이름표("사내규정", ["사내규정-01.failed.log"])).toBe("사내규정-01");
  });
});

describe("실패한 회차는 로그 이름으로 표식을 남긴다(day1-distill.sh 소스 감시)", () => {
  // ★ 짝이 되는 반쪽이다: 셈(ladderlib)이 .json만 세게 고쳐도, 셸이 실패 로그를 그대로 두면
  //   사람이 폴더를 열었을 때 어느 회차가 죽었는지 못 읽는다. 약속과 코드가 함께 있는지 본다.
  const 셸 = readFileSync(join(__dirname, "..", "..", "tools", "ladder", "day1-distill.sh"), "utf8");

  it("실패·중단 자리는 로그를 `<주제>-<번호>.failed.log`로 옮긴다", () => {
    expect(셸).toContain('dead="${LOG%.log}.failed.log"');
    expect(셸).toContain("ladder_round_failed()");
    // 증류 실패·보고서 없음·하한 미달·승인 실패 — 네 자리 모두 이 함수를 지난다(하나라도 빠지면 표식이 안 남는다)
    expect((셸.match(/ladder_round_failed "/g) ?? []).length, "네 실패 자리 + 트랩 둘").toBeGreaterThanOrEqual(6);
  });

  it("사람이 끊어도(Ctrl+C·SIGTERM) 표식을 남기고 나간다", () => {
    expect(셸).toMatch(/trap 'ladder_round_failed[\s\S]*exit 130' INT/);
    expect(셸).toMatch(/trap 'ladder_round_failed[\s\S]*exit 143' TERM/);
    // 성공한 회차는 표식을 비운다 — 안 비우면 다음 회차 준비 중의 Ctrl+C가 앞 회차를 실패로 적는다
    expect(셸).toMatch(/이 회차는 끝까지 갔다[\s\S]*LOG=""/);
  });
});

describe("재료 허용목록 — 허용만 적고 제외는 안 적는다", () => {
  const 목록 = 허용목록읽기();
  const 문맥 = { 매니페스트파일들: ["GIJO_AS_사용자_매뉴얼.md", "KISA_취약점_분석평가_상세가이드.md"] };
  const 된다 = (r: string) => 허용인가(r, 목록, 문맥).허용;

  it("우리 문서·지식 코퍼스·공개 원천은 재료가 된다", () => {
    expect(된다("GIJO_AS_취약점관리_지침.md"), "GIJO_ 앞머리").toBe(true);
    expect(된다("knowledge/보안용어.md"), "knowledge/*.md").toBe(true);
    expect(된다("KISA_취약점_분석평가_상세가이드.md"), "docs-manifest files[]").toBe(true);
    expect(된다("/home/gijohn_llm/bench/ladder/sources/nvd/cve-2024-21762.md"), "공개 원천 폴더").toBe(true);
    expect(된다("sources/kisa-kogl1/가이드.md"), "KISA는 KOGL 1유형 표기 이름 하나로 굳혔다").toBe(true);
    expect(된다("sources/kisa/가이드.md"), "gb10 실측에서 sources/kisa 는 빈 폴더였다 — 안 쓰는 이름을 열어 두지 않는다").toBe(false);
  });

  // [2026-09-03] 날것(sources/)을 .md로 구워 win으로 가져온 **학습 재료**. 증류기 --files 가 먹는 실제 경로다.
  //   여기가 허용에 없으면 밤새 도는 1일차가 「허용목록 밖 재료」로 즉사한다(굽고 나서 조용히 탈락).
  it("사다리 재료(server/data/ladder/material/…)는 재료가 된다 — 접두 아래 세트 폴더의 파일만", () => {
    expect(된다("server/data/ladder/material/day1/kev/kev-01.md")).toBe(true);
    expect(된다("server/data/ladder/material/day1/nvd-ours/nvd-ours-01.md")).toBe(true);
    expect(된다("server/data/ladder/material/day1/cisa-aa/cisa-aa-01.md")).toBe(true);
    expect(된다("D:/Connect AI/server/data/ladder/material/day1/attack/attack-03.md"), "절대경로로 넘어와도 잡힌다").toBe(true);
    expect(된다("server/data/ladder/material/day1/kev"), "폴더 자체는 재료가 아니다").toBe(false);
    expect(된다("server/data/ladder/material/day1/기타/무엇.md"), "세트 이름이 아니면 안 된다").toBe(false);
  });

  it("★ 접두를 벗어난 같은 이름의 폴더는 안 된다 — server/data 는 운영 데이터가 사는 곳이다", () => {
    expect(된다("server/data/kev/kev-01.md"), "ladder/material 밖이면 이름이 같아도 재료가 아니다").toBe(false);
    expect(된다("server/data/ladder/material/day1/kev/../../../gijo-as.sqlite"), "'..'은 규칙보다 먼저 막힌다").toBe(false);
  });

  it("★ 운영 데이터·고객 자료는 재료가 아니다 — 여기가 뚫리면 되돌릴 수 없다", () => {
    expect(된다("server/data/gijo-as.sqlite")).toBe(false);
    expect(된다("고객사_자산목록.xlsx")).toBe(false);
    expect(된다("server/data/backups/2026-09-01.sqlite")).toBe(false);
    expect(된다("client/src/renderer/pages/app.html"), "소스 코드도 학습 재료가 아니다").toBe(false);
  });

  it("★ 허용 폴더 안에서 밖으로 걸어 나가는 길을 막는다", () => {
    const v = 허용인가("sources/nvd/../../server/data/gijo-as.sqlite", 목록, 문맥);
    expect(v.허용).toBe(false);
    expect(v.왜).toContain("..");
  });

  it("store: 접두사와 #해시 꼬리를 벗겨서 본다(증류기가 그 꼴로 ref를 준다)", () => {
    expect(참조정규화("store:KISA_취약점_분석평가_상세가이드.md#2aed30e7f52b")).toBe("KISA_취약점_분석평가_상세가이드.md");
    expect(된다("store:KISA_취약점_분석평가_상세가이드.md#2aed30e7f52b")).toBe(true);
  });

  it("모르는 규칙(kind 오타)은 **통과시키지 않는다** — 허용목록의 오타로 문이 열리면 안 된다", () => {
    const 오타 = { 허용: [{ kind: "이름앞머리_오타", 값: "GIJO_" }] };
    expect(허용인가("GIJO_AS_사용자_매뉴얼.md", 오타, 문맥).허용).toBe(false);
  });

  it("sources/<폴더> 만으로는 안 되고 그 아래 파일이어야 한다", () => {
    expect(된다("sources/nvd")).toBe(false);
    expect(된다("sources/nvd/x.md")).toBe(true);
  });

  it("한 번에 가르면 거절 사유가 붙어 나온다(밤에 무엇이 왜 빠졌는지 남는다)", () => {
    const r = 재료가르기(["knowledge/a.md", "server/data/gijo-as.sqlite"], 목록, 문맥);
    expect(r.허용).toEqual(["knowledge/a.md"]);
    expect(r.거절).toHaveLength(1);
    expect(r.거절[0].왜).toBeTruthy();
  });

  it("실제 docs-manifest.json에서 files[]를 뽑아낼 수 있다(꼴이 바뀌면 여기서 걸린다)", () => {
    const m = JSON.parse(readFileSync(join(__dirname, "..", "docs-manifest.json"), "utf8"));
    const files = 매니페스트파일들(m);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f: string) => typeof f === "string" && f.length > 0)).toBe(true);
    expect(허용인가(files[0], 목록, { 매니페스트파일들: files }).허용).toBe(true);
  });
});

describe("표본 하네스가 저장소로 들어왔다 — 조건 셋이 파일로 갈린다", () => {
  const 문항들 = JSON.parse(readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "samples-questions.json"), "utf8"));

  it("문항 12개는 gb10 원본 그대로이고, 근거 조각을 **회수한 것만** chunk가 차 있다", () => {
    expect(문항들).toHaveLength(12);
    const 찬것 = 문항들.filter((q: { chunk: string }) => q.chunk);
    // ⚠ 8/12만 찬다 — 나머지 4는 원천이 chat이라 근거 ref 자체가 없다. 「없다」를 빈칸으로 남기고
    //   하네스가 건너뛴다(0으로 세면 인용률이 거짓으로 낮아진다).
    expect(찬것.length, "store: ref가 있는 문항만 회수된다").toBe(8);
    for (const q of 찬것) {
      expect(q.chunkRef, "어느 조각에서 왔는지 파일에 남는다").toMatch(/#[0-9a-f]{12}$/);
      expect(q.distractor.length, "방해 조각도 함께 회수한다").toBeGreaterThan(0);
      expect(q.distractorRef.split("#")[0], "방해는 **다른 문서**에서 고른다(같은 문서 이웃은 정답의 연장이다)").not.toBe(q.chunkRef.split("#")[0]);
    }
  });

  it("★★ 저장소에 실린 조각 본문은 **전부 라이선스 허용목록 안**이다 — 정답도 방해도", () => {
    // 실측(2026-09-04): 처음 회수했을 때 방해 조각 8개 중 4개가 **타사 상용 제품 가이드**에서 왔다.
    //   `방해조각고르기`에 라이선스 판정이 안 걸려 있기 때문이다(정답 조각에만 걸린다).
    //   학습 재료였다면 「그 문장을 외운 어댑터가 고객에게 나가는」 일이고, 저장소에 넣으면
    //   그냥 **재배포**다. 그래서 표본을 만들 때 후보 풀을 먼저 거르고, 여기서 그것을 지킨다.
    const 목록 = 허용목록읽기();
    const m = JSON.parse(readFileSync(join(__dirname, "..", "docs-manifest.json"), "utf8"));
    const 문맥 = { 매니페스트파일들: 매니페스트파일들(m) };
    for (const q of 문항들) {
      for (const ref of [q.chunkRef, q.distractorRef].filter(Boolean)) {
        const v = 허용인가(ref, 목록, 문맥);
        expect(v.허용, `${ref} — ${v.왜 ?? ""}`).toBe(true);
      }
    }
  });

  it("★ 조각이 없으면 grounded에서 null — 하네스가 그 문항을 건너뛴다", async () => {
    const h = await import("../../tools/team-bench/ask-samples.mjs");
    expect(h.조각들({ chunk: "A", distractor: "B" }, "grounded")).toEqual(["A", "B"]);
    expect(h.조각들({ chunk: "", distractor: "B" }, "grounded"), "정답 조각이 없으면 grounded로 못 던진다").toBeNull();
    expect(h.조각들({ chunk: "A", distractor: "" }, "distractor-only")).toBeNull();
    expect(h.조각들({ chunk: "A", distractor: "B" }, "bare"), "맨 질문은 조각을 안 쓴다").toEqual([]);
  });

  it("system은 학습(행만들기)과 같은 꼴로 이어 붙인다 — [팀원프롬프트, 참고자료블록]", async () => {
    const h = await import("../../tools/team-bench/ask-samples.mjs");
    expect(h.system만들기("팀원 프롬프트", "머리말", ["가", "나"])).toBe("팀원 프롬프트\n\n머리말\n[1] 가\n[2] 나");
    expect(h.system만들기("팀원 프롬프트", "머리말", []), "조각이 없으면 system도 없다(bare)").toBe("");
  });

  it("★ 로그아웃에 refreshToken을 함께 보낸다 — 안 보내면 {ok:true}만 받고 세션은 그대로다", () => {
    // auth.ts:495-499 — body의 refreshToken이 없으면 아무것도 안 지운다. 계정당 1세션이라
    // 안 닫힌 세션은 **다음 사람을 막는다**(실측: 「이미 다른 곳에서 로그인 중」으로 하네스가 죽었다).
    for (const f of ["ask-samples.mjs", "kev-probe.mjs"]) {
      const src = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", f), "utf8");
      expect(src, `${f}: 로그인은 refreshToken을 들고 있어야 한다`).toContain("refreshToken: j.refreshToken");
      expect(src, `${f}: 로그아웃 몸에 refreshToken을 실어야 한다`).toMatch(/logout[\s\S]{0,220}refreshToken/);
    }
  });

  it("KEV 3문항은 gb10 원본과 같은 문장이다(바꾸면 지난 회차와 못 견준다)", async () => {
    const k = await import("../../tools/team-bench/kev-probe.mjs");
    expect(k.KEV_문항).toHaveLength(3);
    expect(k.KEV_문항[0]).toBe("KEV 목록은 누가 발표해?");
  });
});

describe("사슬이 표본·KEV를 **직접 만든다**(day2-train.sh 소스 감시)", () => {
  // ★ 짝이 되는 반쪽이다: 게이트가 새 관문을 갖고 있어도, 셸이 그 입력을 안 만들면 전부 「미측정」이다.
  //   2026-09-04 전에는 「파일이 있으면 넘긴다」였다 — 즉 남이 손으로 만들어 뒀을 때만 관문이 살아 있었다.
  const 셸 = readFileSync(join(__dirname, "..", "..", "tools", "ladder", "day2-train.sh"), "utf8");

  it("세 조건 표본과 KEV를 스스로 돌린다", () => {
    expect(셸).toContain("ask-samples.mjs");
    expect(셸).toContain("kev-probe.mjs");
    expect(셸).toMatch(/for mode in grounded distractor-only bare/);
    expect(셸).toContain("run_probes \"$PROBE_DIR\"");
  });

  // ★ 2026-09-04: 잣대(관문 ⑧⑨⑩⑪)가 뒤늦게 생겨 **같은 회전을 다시 재야** 했다. 그때 옛 결과를
  //   덮으면 「잣대 전에는 뭐였나」를 견줄 상대가 사라진다 — 그래서 표본이 앉는 자리를 변수로 뺐다.
  //   변수로 뺀 순간 위험이 하나 생긴다: **기본값이 어긋나면** 여느 회전이 조용히 딴 곳에 쌓인다.
  //   그 기본값을 여기서 못 박는다.
  it("표본 자리는 기본이 회전 폴더다 — --probe-out 을 줄 때만 옆으로 간다", () => {
    expect(셸, "기본값이 회전 폴더가 아니면 여느 회전이 조용히 딴 곳에 쌓인다").toContain('PROBE_DIR="$OUTDIR"');
    expect(셸, "상대경로는 회전 폴더 **아래**로 읽어야 한다").toContain('PROBE_DIR="$OUTDIR/$PROBE_OUT"');
    expect(셸).toContain("--probe-out");
    // 게이트도 같은 자리를 봐야 한다 — 표본은 새 자리에 쓰고 판정은 옛 자리를 읽으면 표가 거짓이 된다.
    expect(셸, "게이트가 다시 잰 표본을 읽어야 한다").toContain('"$PROBE_DIR/samples-$mode.json"');
    expect(셸, "게이트 결과도 같은 자리에 남아야 한다").toContain('--out "$PROBE_DIR"');
  });

  // ★ --only-probe 는 **학습·변환·13과제를 건드리지 않는다**는 약속이다. 약속을 코드로 못 박는다.
  it("--only-probe 는 ④(13과제 A/B)를 건너뛴다 — 다시 재는 것은 표본뿐이다", () => {
    expect(셸).toContain("--only-probe");
    // 13과제(④)를 여는 조건에 ONLY_PROBE가 함께 걸려 있는가 — 이것이 빠지면 --only-probe가
    // 두 시간짜리 A/B를 다시 돌린다(그러고도 「표본만 다시 쟀다」고 보고하게 된다).
    const 줄들 = 셸.split(String.fromCharCode(10));
    const 여는칸 = 줄들.findIndex((l) => l.trim().startsWith("EASY_JSON="));
    expect(여는칸, "④(13과제)를 여는 자리가 있어야 한다").toBeGreaterThan(0);
    expect(줄들[여는칸 - 1], "④의 run.mjs 자리는 ONLY_PROBE에도 걸려야 한다").toContain('"$ONLY_PROBE" -eq 0');
  });

  it("무슨 인자로 쟀는지를 harness-args.json에 적는다", () => {
    expect(셸, "「--system을 줬는지조차 결과로 못 가렸다」의 수리").toContain("harness-args.json");
  });

  it("베이스 대조 한 번짜리(--baseline-probe)가 있고, 게이트에 대조 파일을 넘긴다", () => {
    expect(셸).toContain("--baseline-probe");
    expect(셸).toContain("run_probes \"$BASELINE_DIR\"");
    expect(셸).toContain("--kev-base");
    expect(셸).toContain("--baseline-samples");
    expect(셸).toMatch(/--samples-\$mode/);
  });

  it("★ 하네스를 harness/ 사본으로 복사하지 않는다 — 위쪽 build-raft-dataset을 불러 쓰기 때문", () => {
    const 복사줄 = /for f in run\.mjs run-r2\.mjs tasks\.mjs tasks-r2\.mjs; do/.exec(셸);
    expect(복사줄, "복사 목록이 바뀌었으면 이 계약을 다시 볼 것").toBeTruthy();
    expect(셸).toContain('$BENCH_SRC/ask-samples.mjs');
    expect(셸).not.toContain('$RUNDIR/ask-samples.mjs');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2026-09-04 검토관 적발 넷의 **짝 시험** — 고친 자리가 다시 헐거워지면 여기가 먼저 말한다.
//   ① ④-2가 두뇌 없는 포트에 던졌다(사슬이 게이트에 닿기 전에 죽었다)
//   ② 워밍업이 try 밖이라 죽은 포트에서 admin 세션이 남았다
//   ③ --baseline-probe가 서버를 띄운 뒤 env를 봐서, env가 비면 8093에 두뇌가 남았다
//   ④ 관문 ⑨가 대조군(noprompt)까지 셌다 · ⑥⑦⑪이 한쪽만 있어도 판정했다
// ══════════════════════════════════════════════════════════════════════

describe("관문 ⑨ — 모집단은 관문 ①과 같다(대조군 noprompt 제외)", () => {
  const 기준 = () => ({ easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 });

  it("★ 대조군 행이 「원문:」을 지어내도 ⑨는 안 센다 — 제품이 쓰지 않는 조건이다", () => {
    const kev섞임 = [
      ...kev좋음,
      { label: "noprompt", q: "KEV 목록은 누가 발표해?", text: '국방부가 발표합니다. 원문: "국방부가 발표하고 관리한다고 알려져 있습니다."' },
    ];
    expect(kev대상행(kev섞임), "라벨이 있는 파일은 noprompt를 뺀다").toHaveLength(3);
    const r = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev섞임, 표본grounded: grounded좋음, 표본방해만: 방해만좋음, 표본맨질문: 맨질문깨끗 }, 기준());
    const c = r.검사.find((x: { 키: string }) => x.키 === "no_fake_quote");
    expect(c.통과, "대조군 때문에 채택이 막히면 관문이 딴것을 재는 것이다").toBe(true);
    expect(c.값).toContain("대상 4"); // bare 1 + kev[prompt] 3
  });

  it("★ 표가 **모집단을 말한다** — 사람이 무엇을 셌는지 읽을 수 있어야 한다", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음, 표본grounded: grounded좋음, 표본방해만: 방해만좋음, 표본맨질문: 맨질문깨끗 }, 기준());
    const c = r.검사.find((x: { 키: string }) => x.키 === "no_fake_quote");
    expect(c.설명).toContain("모집단: bare 표본 1행 + KEV 3행");
    expect(c.설명).toContain("noprompt 제외");
  });

  it("세는 행은 「답이 든 행」뿐이다 — 건너뛴 문항·빈 답은 모집단이 아니다", () => {
    expect(창작인용대상인가({ text: "답" })).toBe(true);
    expect(창작인용대상인가({ text: "답", skipped: "조각 없음" })).toBe(false);
    expect(창작인용대상인가({ text: "" })).toBe(false);
    expect(창작인용대상인가(null)).toBe(false);
  });

  it("옛 이름(--samples)으로 준 표본은 ⑨가 안 세고, **표가 그 사실을 적는다**", () => {
    const 표 = 표만들기(판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음 }, 기준()), { 옛표본: 12 });
    expect(표).toContain("표본[--samples(옛 이름)] 12건");
    expect(표, "안 센다는 말이 표에 없으면 사람은 12건이 들어간 줄 안다").toContain("관문 ⑨의 모집단에는 안 들어간다");
  });
});

describe("관문 ⑥⑦⑪ — 한쪽만 주면 **미측정**이다(거짓 대조를 막는다)", () => {
  // ⚠ 실측(2026-09-04, r1-base easy만): 고치기 전에는 ⑥ 0.71 vs 0.75 **거짓 빨강** ·
  //   ⑦ 6.8% **거짓 초록**(7과제 중앙값을 13과제 중앙값과 견줬다) · ⑪ 42.2%(넷 다면 66.4%).
  //   과제 구성이 다른 것을 견주면 그 숫자는 무엇도 뜻하지 않는다 — ④(avg13)와 같이 fail-close 한다.
  it("easy만 있으면 ⑥⑦⑪이 전부 미측정이고, 왜인지 말한다", () => {
    const r = 판정({ easy: 기준easy() }, { easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 });
    for (const 키 of ["hangul", "tps_drop", "len_drop"]) {
      const c = r.검사.find((x: { 키: string }) => x.키 === 키);
      expect(c.값, `${키}는 한쪽만으로 판정하면 안 된다`).toBe("미측정");
      expect(c.설명).toContain("넷 다");
      expect(c.통과).toBe(false);
    }
  });

  it("기준선 hard가 없어도 미측정이다(한쪽이 비면 어느 쪽이든 막는다)", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진() }, { easy: 기준easy(), kev: kev좋음, 표본grounded: grounded나쁨 });
    expect(r.검사.find((x: { 키: string }) => x.키 === "hangul").값).toBe("미측정");
  });

  it("넷 다 있으면 종전대로 잰다(막기만 하는 관문이 되면 안 된다)", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음 }, { easy: 기준easy(), hard: 기준hard(), kev: kev좋음, 표본grounded: grounded나쁨 });
    expect(r.검사.find((x: { 키: string }) => x.키 === "hangul").값).not.toBe("미측정");
    expect(r.검사.find((x: { 키: string }) => x.키 === "tps_drop").값).not.toBe("미측정");
  });
});

describe("사슬이 표본을 만들 **두뇌를 띄운다**(day2-train.sh 소스 감시)", () => {
  const 셸 = readFileSync(join(__dirname, "..", "..", "tools", "ladder", "day2-train.sh"), "utf8");

  it("★ ④-2 앞에 두뇌를 띄운다 — ④의 run.mjs가 자기 서버를 죽이고 끝나기 때문", () => {
    // 실측(2026-09-04, 껍데기 두뇌로 사슬 완주): 고치기 전에는 ECONNREFUSED → **exit 8**로
    // 게이트에 닿지도 못했다(관문 ⑧·⑩이 회전 갈래에서 영영 미측정). 고친 뒤엔 gate.md까지 나온다.
    const 앞 = 셸.indexOf("④-2");
    const 뒤 = 셸.indexOf('run_probes "$PROBE_DIR"');
    expect(앞, "④-2 단계가 있어야 한다").toBeGreaterThan(0);
    expect(뒤, "회전 표본을 만드는 자리가 있어야 한다").toBeGreaterThan(앞);
    const 사이 = 셸.slice(앞, 뒤);
    expect(사이, "표본을 던지기 전에 $PORT에 두뇌를 띄워야 한다").toContain("serve_start");
    expect(사이, "회전 표본은 **그 회전의 어댑터**를 얹고 재야 한다").toContain("--lora");
  });

  // ★★★ 2026-09-04 실기 사고의 짝 시험 — **못 잰 것을 「쟀다」고 적던** 자리다.
  //   그날 첫 --baseline-probe 는 9GB 모델을 읽는 중에 5초 만에 코드 0으로 끝났고,
   // 표본 42개가 전부 0자로 저장됐다. 뿌리는 아래 두 가지이며, 여기서 각각 못 박는다.
  it("★★ 준비 판정은 /health가 **200**일 때만 — 503도 curl -s 에게는 성공이다", () => {
    // llama.cpp는 모델을 읽는 동안 /health를 503으로 답한다. curl은 -f 없이는 503에도
    // 종료코드 0을 준다 — 그래서 옛 조건(`curl -s -o /dev/null … ; then`)은 「포트가 답하는가」만
    // 물었고, 적재 3초 만에 「준비됐다」가 됐다. 물어야 할 것은 **「다 읽었는가」**다.
    const 준비줄 = 셸.split(String.fromCharCode(10)).filter((l) => l.includes("/health") && l.includes("return 0"));
    expect(준비줄.length, "준비를 기다리는 자리가 하나 있어야 한다").toBe(1);
    expect(준비줄[0], "200을 요구하지 않으면 적재 중인 두뇌를 준비됐다고 읽는다").toContain("%{http_code}");
    expect(준비줄[0]).toContain('= "200"');
  });

  it("★★ 하네스는 빈 답을 **답으로 적지 않는다**(ask-samples · kev-probe)", () => {
    // 재는 자가 못 잰 것을 「쟀다」고 적으면 그 뒤의 모든 판정이 그 위에 선다. 특히 관문 ①은
    // 「베이스 대비 하락 0」이라, 베이스도 0자·이번도 0자면 **초록**이 된다(가장 나쁜 꼴).
    for (const f of ["ask-samples.mjs", "kev-probe.mjs"]) {
      const src = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", f), "utf8");
      expect(src, f + ": 빈 답에서 죽어야 한다").toMatch(/빈 답을 줬다/);
      expect(src, f + ": 던지는 자리여야 한다(조용히 넘기면 같은 사고가 난다)").toMatch(/throw new Error/);
    }
    const ask = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "ask-samples.mjs"), "utf8");
    expect(ask, "HTTP 오류 자체도 봐야 한다 — 503 몸에는 choices가 없어 그대로 0자가 된다").toContain("if (!r.ok)");
  });
  it("★ env는 두뇌를 띄우기 **전에** 본다 — ladder_need_env는 return이 아니라 exit 3이다", () => {
    const 앞 = 셸.indexOf('if [ "$BASELINE_PROBE" -eq 1 ]; then');
    const 뒤 = 셸.indexOf("serve_start", 앞);
    expect(뒤).toBeGreaterThan(앞);
    expect(셸.slice(앞, 뒤), "먼저 띄우면 exit 3에서 8093에 두뇌가 남는다").toContain("ladder_need_env");
  });

  it("★ EXIT에도 trap을 건다 — 옆길 exit에서도 8093에 두뇌를 안 남긴다", () => {
    expect(셸).toContain("trap 'serve_stop' EXIT");
    expect(셸).toContain("trap 'serve_stop; exit 130' INT");
    expect(셸).toContain("trap 'serve_stop; exit 143' TERM");
  });

  it("베이스 경로는 한 곳에서 온다 — ④(A/B)와 ④-2(표본)가 같은 베이스를 써야 견줄 수 있다", () => {
    expect(셸).toMatch(/BASE_GGUF="\$\{LADDER_BASE_GGUF:-/);
    expect(셸, "models.json이 경로를 따로 적어 두면 조용히 갈린다").toContain('"$ADAPTER_GGUF" "$BASE_GGUF"');
  });
});

describe("표본 하네스는 죽어도 **세션을 닫는다**(ask-samples.mjs 소스 감시)", () => {
  const src = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "ask-samples.mjs"), "utf8");

  it("★ 워밍업이 try **안**에 있다 — 가장 흔한 실패(포트에 두뇌 없음)가 거기서 난다", () => {
    // 실측(2026-09-04, 죽은 포트): 고치기 전 로그아웃 0건(세션 남음) → 고친 뒤 1건.
    const t = src.indexOf("try {");
    const w = src.indexOf('await ask("", "안녕하세요")');
    expect(t, "try 블록이 있어야 한다").toBeGreaterThan(0);
    expect(w, "워밍업이 있어야 한다").toBeGreaterThan(t);
    // ⚠ "finally" 낱말은 위쪽 주석에도 있다 — **닫는 자리**로 찾는다(주석을 세면 시험이 거짓말한다).
    expect(src.indexOf("} finally {"), "워밍업은 try와 finally 사이에 있어야 한다").toBeGreaterThan(w);
  });

  it("★ 근거 꼴 대조는 fail-closed다 — 창구가 그 값을 안 주면 **거기서 죽는다**", () => {
    expect(src, "「있으면 대조한다」는 대조가 아니다").not.toMatch(/if \(j\.ragBlockSample && 참고자료블록/);
    expect(src).toContain("if (!j.ragBlockSample)");
    expect(src).toContain("창구가 ragBlockSample을 안 준다");
  });
});

describe("회차 파일이 실제 디렉터리에서도 쌓인다", () => {
  it("파일을 만들며 이름표를 세 번 뽑으면 01·02·03이 된다", () => {
    const 뿌리 = mkdtempSync(join(tmpdir(), "gijo-ladder-"));
    try {
      const 이름들: string[] = [];
      for (let i = 0; i < 3; i++) {
        const l = 회차이름표("취약점", 이름들);
        writeFileSync(join(뿌리, `${l}.json`), "{}");
        이름들.push(`${l}.json`);
      }
      expect(이름들).toEqual(["취약점-01.json", "취약점-02.json", "취약점-03.json"]);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });
});
