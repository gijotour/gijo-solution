// 등급 C **반출 감시** — 학습 재료가 gb10으로 나갈 때 기밀(C)이 딸려 나가지 않는가.
//
// ■ 왜 이 파일이 생겼나 (2026-09-10 · 실측)
//   승인 문답 3,778건 중 **1,597건이 등급 C**다(2026-09-03 한 묶음 — 승인자를 못 되짚어 기밀로
//   닫힌 폴백). 그런데 회전 1~4의 학습 재료는 그 등급을 **한 번도 안 봤고**, 구운 재료가 통째로
//   gb10에 복제돼 있었다: raft-vuln-v4 956행 중 **706행(74%)**이 C에서 온 행이었다
//   (처음 적은 577행은 창걸음 10이던 옛 도구의 숫자다 — 걸음 1로 다시 재면 706행이다).
//   `server/src/engine/learncandidates.ts`가 「C는 무엇을 줘도 안 나간다」고 창구를 막아 둔 그 정책이,
//   **도구로 만든 재료**에는 걸려 있지 않았다 — 정책이 한 창구에만 있으면 옆문은 그대로 열려 있다.
//
// ■ 이 파일이 못 박는 것
//   ① 재료 빌더(tools/team-bench/material-r5.mjs)의 산출물에는 **행마다 grade 칸**이 있다.
//   ② grade 칸이 없거나 O가 아니면 **빨강**이다(fail-closed — 모르는 등급은 O가 아니다).
//   ③ 칸은 O인데 **글에 C 본문**이 실린 행도 빨강이다(칸만 보면, 칸을 잘못 적은 빌더를 통과시킨다).
//   ④ 빌더는 파일을 쓰기 **전에** 그 감시를 스스로 통과해야 한다(소스 감시).
//   ⑤ 잣대는 한 곳이다 — 거절 문장·복사 비율은 gates.mjs의 그 함수를 부른다(두 벌이면 갈린다).
//
// ■ 2026-09-10 검토관 적발로 더 못 박은 것 (아래 다섯 묶음)
//   위 ①~⑤를 다 적어 놓고도 **잣대가 두 벌**이었다: 여기 JS는 창을 1자 걸음으로 훑는데, gb10의
//   재료를 실제로 지운 파이썬 스크립트는 10자 걸음이었다. 그래서 「재검사 C 0행」이 제 잣대로 잰
//   0이었고, 저장소 잣대로 다시 훑으니 1,957행 중 859행에 C 본문이 남아 있었다. 게다가 관문이
//   **빌더 안에만** 있어, 이미 구운 파일을 집어 굽는 밤 경로에는 한 번도 안 걸렸다.
//   → 구현을 하나로 모으고(strip-c.mjs·gradegate.mjs), 산출물이 **어느 잣대로 잰 판인지**를
//     스스로 말하게 했다(잣대지문). 「잣대를 고쳤다」와 「그 잣대로 다시 잤다」는 다른 일이다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  질문해시, 창길이, 창걸음, 창최소적중, 창정규화, 창적중수,
  등급판정, 등급관문, 등급세기, 잣대지문, 한글비율, 원천언어, 복사상한, 베낀비율행, 사실주장인가, 거절로시작하나,
  블록나누기, 제품인용들, 인용관문, 겹침관문,
  고르기, 구성표,
} from "../../tools/team-bench/material-r5.mjs";
import { 걷어내기 } from "../../tools/team-bench/strip-c.mjs";
import { 제품거절문장, 베낀글자비율여럿 } from "../../tools/team-bench/gates.mjs";
import { 문항정규화 } from "../../tools/build-raft-dataset.mjs";

const 루트 = path.join(__dirname, "..", "..");
const src = (rel: string) => fs.readFileSync(path.join(루트, rel), "utf8");
const 머리말 = JSON.parse(src("tools/team-bench/prompt-spec.json")).ragHeader as string;

/** 창 해시 만들기 — 시험이 **빌더와 같은 규칙**으로 만든다(다르게 만들면 시험이 제 코드를 검사한다). */
const 창해시 = (s: string) => crypto.createHash("sha1").update(s, "utf8").digest("hex").slice(0, 12);
function 창집합만들기(본문: string): Set<string> {
  const t = 창정규화(본문);
  const out = new Set<string>();
  for (let i = 0; i + 창길이 <= t.length; i += 창걸음) out.add(창해시(t.slice(i, i + 창길이)));
  return out;
}

const 긴C본문 = "기밀로 분류된 사내 침해사고 대응 절차서의 본문이다 담당자는 즉시 상황실에 보고하고 격리 절차를 수행한다 이 문장은 충분히 길어서 창이 여러 개 나온다 그래서 두 곳 이상 걸린다";
const 행 = (over: Record<string, unknown> = {}) => ({
  question: "취약점 조치 기한은 어떻게 정하나요?",
  answer: "사내 지침에 따라 상·중·하 등급별로 7일·30일·90일로 정합니다. 근거를 옮겨 적어 설명합니다.",
  system: "팀원 프롬프트\n\n" + 머리말 + "\n[1] 취약점 조치 기한은 등급별로 7일 30일 90일로 정한다 라고 지침에 적혀 있다",
  ...over,
});

describe("등급 열쇠 — 질문 해시는 빌더의 정규화를 **그대로** 쓴다", () => {
  it("공백·문장부호가 달라도 같은 열쇠다(원질문이 열쇠라 사소한 차이로 갈리면 대조가 헛돈다)", () => {
    expect(질문해시("조치 기한은?")).toBe(질문해시("조치기한은"));
    expect(질문해시("조치 기한은?")).not.toBe(질문해시("조치 주기는?"));
  });

  it("★ 열쇠를 만드는 규칙이 빌더의 문항정규화 하나다 — 여기서 따로 만들지 않는다", () => {
    const q = "  로그온 하지 않고… 종료 허용?!  ";
    const 기대 = crypto.createHash("sha256").update(문항정규화(q), "utf8").digest("hex").slice(0, 16);
    expect(질문해시(q)).toBe(기대);
  });
});

describe("창 해시 — 본문 없이 「C에서 온 글」을 알아본다", () => {
  it("규격은 40자 창 · **1자 걸음** · 최소 2적중이다(값을 바꾸면 여기가 먼저 말한다)", () => {
    expect([창길이, 창걸음, 창최소적중]).toEqual([40, 1, 2]);
  });

  it("★ 자리 어긋남 함정 — C 본문이 **아무 자리에서나** 시작해도 잡는다(2026-09-10에 밟은 그 자리)", () => {
    // C 창 집합은 그 문서 본문의 0·20·40…자리에서 뜬다. 재료 행에서는 앞에 프롬프트·머리말이 붙어
    // 본문 시작 자리가 제멋대로다. 찾는 걸음이 1이 아니면 시작 자리가 안 맞는 행을 **원리상 못 본다**.
    const 집합 = 창집합만들기(긴C본문);
    for (const 앞머리 of ["", "가", "가나", "가나다", "가나다라", "머리말 일곱자"]) {
      expect(창적중수(앞머리 + 긴C본문, 집합), `앞머리 ${앞머리.length}자에서 놓쳤다`).toBeGreaterThanOrEqual(창최소적중);
    }
  });

  it("C 본문이 실린 글은 두 곳 이상 걸린다", () => {
    const 집합 = 창집합만들기(긴C본문);
    expect(창적중수(긴C본문, 집합)).toBeGreaterThanOrEqual(창최소적중);
  });

  it("★ 한 창만 겹치는 글은 안 걸린다 — 정형 문구 하나로 멀쩡한 행을 지우면 안 된다", () => {
    const 집합 = new Set([창해시(창정규화(긴C본문).slice(0, 창길이))]);
    expect(창적중수(긴C본문.slice(0, 60), 집합)).toBeLessThan(창최소적중);
  });

  it("무관한 글은 0적중이다", () => {
    expect(창적중수("전혀 다른 내용의 답변입니다", 창집합만들기(긴C본문))).toBe(0);
  });
});

describe("등급판정 — 모르면 O가 아니다(fail-closed)", () => {
  const 지도 = { [질문해시("취약점 조치 기한은 어떻게 정하나요?")]: "O", [질문해시("기밀 질문입니다")]: "C" };

  it("지도에 O로 적힌 행은 O다", () => {
    expect(등급판정(행(), 지도, null)).toBe("O");
  });

  it("지도에 C로 적힌 행은 C다", () => {
    expect(등급판정(행({ question: "기밀 질문입니다" }), 지도, null)).toBe("C");
  });

  it("★ 지도에 없는 행은 「미매칭」이지 O가 아니다 — 긴 형식 행이 여기로 온다", () => {
    expect(등급판정(행({ question: "지도에 없는 질문" }), 지도, null)).toBe("미매칭");
  });

  it("★ 질문은 O인데 **글에 C 본문**이 실리면 C다 — 질문 해시만 보면 원리상 못 보는 자리다", () => {
    const 집합 = 창집합만들기(긴C본문);
    const r = 행({ system: "팀원 프롬프트\n\n" + 머리말 + "\n[1] " + 긴C본문 });
    expect(등급판정(r, 지도, null), "창 없이 보면 O로 보인다").toBe("O");
    expect(등급판정(r, 지도, 집합), "글을 보면 C다").toBe("C");
  });

  it("답 칸에 C 본문이 실려도 잡는다", () => {
    expect(등급판정(행({ answer: 긴C본문 }), 지도, 창집합만들기(긴C본문))).toBe("C");
  });
});

describe("★ 반출 감시 — 재료가 학습에 나가도 되는가", () => {
  it("행마다 grade 칸이 있고 전부 O면 통과다", () => {
    const r = 등급관문([{ ...행(), grade: "O" }, { ...행(), grade: "O" }]);
    expect(r.ok, r.사유.join(" / ")).toBe(true);
  });

  it("★ grade 칸이 없는 행이 하나라도 있으면 빨강이다 — 모르는 등급은 O가 아니다", () => {
    const r = 등급관문([{ ...행(), grade: "O" }, 행()]);
    expect(r.ok).toBe(false);
    expect(r.칸없음).toBe(1);
    expect(r.사유.join(" ")).toContain("grade 칸이 없는 행");
  });

  it("★ grade가 C인 행이 있으면 빨강이다(이 감시의 존재 이유)", () => {
    const r = 등급관문([{ ...행(), grade: "C" }]);
    expect(r.ok).toBe(false);
    expect(r.등급아님).toBe(1);
  });

  it("빈 문자열·null 등급도 빨강이다(빈 칸은 「안 매김」이 아니라 「모름」으로 본다)", () => {
    expect(등급관문([{ ...행(), grade: "" }]).ok).toBe(false);
    expect(등급관문([{ ...행(), grade: null }]).ok).toBe(false);
  });

  it("★ 칸은 O인데 글에 C 본문이 실린 행도 빨강이다 — 칸만 믿으면 빌더의 오기를 통과시킨다", () => {
    const r = 등급관문([{ ...행({ system: "x\n\n" + 머리말 + "\n[1] " + 긴C본문 }), grade: "O" }], 창집합만들기(긴C본문));
    expect(r.ok).toBe(false);
    expect(r.글이C).toBe(1);
  });

  it("★ 행이 0개면 통과가 아니라 미측정이다 — 빈 재료를 초록으로 세면 감시가 감시가 아니다", () => {
    expect(등급관문([]).ok).toBe(false);
  });
});

describe("언어·복사·거절 — 잣대는 저마다 한 곳에서 온다", () => {
  it("한글 비율은 글자만 세고 숫자·기호는 안 센다", () => {
    expect(한글비율("한글 100%입니다 12345 !!!")).toBe(1);
    expect(한글비율("all english here")).toBe(0);
    expect(한글비율("12345 !!!"), "글자가 없으면 0").toBe(0);
  });

  it("원천 언어는 **근거 조각**으로 가른다(답이 아니라 배우는 원천이 기준이다)", () => {
    const 영문근거 = 행({
      answer: "한국어로만 답한 문장입니다 아주 길게 적어 봅니다",
      system: "x\n\n" + 머리말 + "\n[1] This is an English source chunk about vulnerability remediation deadlines",
    });
    expect(원천언어(영문근거, 머리말).언어).toBe("en");
    expect(원천언어(행(), 머리말).언어).toBe("ko");
  });

  it("근거 블록이 없는 행은 답으로 판단한다(그 행이 배우는 원천이 답뿐이다)", () => {
    expect(원천언어({ question: "q", answer: "한국어 답입니다", system: "팀원 프롬프트만" }, 머리말).조각수).toBe(0);
    expect(원천언어({ question: "q", answer: "한국어 답입니다", system: "팀원 프롬프트만" }, 머리말).언어).toBe("ko");
  });

  it("★ 복사 상한이 언어별이다 — 한국어 원천이 상한에 먼저 걸려 통째로 걸러지던 것을 되돌린다", () => {
    expect(복사상한.ko).toBe(0.7);
    expect(복사상한.en).toBe(0.6);
    expect(복사상한.ko).toBeGreaterThan(복사상한.en);
  });

  it("★ 베낀 비율은 관문 ⑫의 **그 함수**로 잰다 — 여기서 다시 계산하지 않는다", () => {
    const r = 행();
    const 조각 = "취약점 조치 기한은 등급별로 7일 30일 90일로 정한다 라고 지침에 적혀 있다";
    expect(베낀비율행(r, 머리말)).toBe(베낀글자비율여럿(r.answer, [조각]));
  });

  it("★ 거절 판정은 gates.mjs의 제품 거절 문장 하나다(제품 llm.ts의 그 문장)", () => {
    expect(거절로시작하나({ answer: 제품거절문장 + " 일반적으로는…" })).toBe(true);
    expect(거절로시작하나(행())).toBe(false);
  });

  it("사실 주장 행은 CVE·연도·기관·수치로 가른다(밤에 27B로 되물을 대상)", () => {
    expect(사실주장인가({ answer: "CVE-2024-3400은 …" })).toBe(true);
    expect(사실주장인가({ answer: "CISA가 KEV에 올렸습니다" })).toBe(true);
    expect(사실주장인가({ answer: "조치 절차를 따르세요" })).toBe(false);
  });
});

describe("★ 고르기 — 등급 O만 싣고, 실은 행마다 등급을 적는다", () => {
  const 지도 = {
    [질문해시("O질문")]: "O", [질문해시("C질문")]: "C", [질문해시("물음표질문")]: "?",
  };
  const rows = [
    행({ question: "O질문" }), 행({ question: "C질문" }),
    행({ question: "물음표질문" }), 행({ question: "지도에없는질문" }),
  ];

  it("C·미매칭·?는 안 싣고, 그 사유를 숫자로 적는다", () => {
    const { 재료, 보고 } = 고르기(rows, { 지도, 창집합: null, 머리말, 홀드아웃수: 0 });
    expect(재료).toHaveLength(1);
    expect(보고.등급).toEqual({ O: 1, C: 1, "?": 1, "미매칭": 1 });
    expect(보고.제외["등급 C"]).toBe(1);
  });

  it("★ 실은 행에는 **전부** grade 칸이 있고 O다 — 그래서 반출 감시를 스스로 지난다", () => {
    const { 재료 } = 고르기(rows, { 지도, 창집합: null, 머리말, 홀드아웃수: 0 });
    expect(재료.every((r: { grade?: string }) => r.grade === "O")).toBe(true);
    expect(등급관문(재료).ok).toBe(true);
  });

  it("속칸(_언어 등 셈에 쓴 임시 칸)은 재료에 안 남긴다 — 학습이 읽는 꼴은 question/answer/system/grade다", () => {
    const { 재료 } = 고르기(rows, { 지도, 창집합: null, 머리말, 홀드아웃수: 0 });
    expect(Object.keys(재료[0]).filter((k) => k.startsWith("_"))).toEqual([]);
  });

  it("★ 같은 입력이면 같은 판이 나온다(무작위를 쓰면 A/B가 성립하지 않는다)", () => {
    const a = 고르기(rows, { 지도, 창집합: null, 머리말, 홀드아웃수: 0 }).재료;
    const b = 고르기(rows, { 지도, 창집합: null, 머리말, 홀드아웃수: 0 }).재료;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("옛 홀드아웃 문항은 재료에서 뺀다 — 제외 기준은 **하나**(그 파일에 든 질문)다", () => {
    const { 재료, 보고 } = 고르기(rows, {
      지도, 창집합: null, 머리말, 홀드아웃수: 0,
      홀드아웃질문: new Set([문항정규화("O질문")]),
    });
    expect(재료).toHaveLength(0);
    expect(보고.제외["옛 홀드아웃 문항"]).toBe(1);
  });

  it("구성 표가 「거절로 시작하는 행」을 숫자로 적는다 — 등급으로 거르면 그 비중이 바뀌기 때문이다", () => {
    const { 보고 } = 고르기([...rows, 행({ question: "O질문", answer: 제품거절문장 })], { 지도, 창집합: null, 머리말, 홀드아웃수: 0 });
    expect(보고.재료.거절시작).toBe(1);
    expect(구성표(보고)).toContain("거절로 시작하는 행");
  });
});

describe("★ 소스 감시 — 빌더는 쓰기 **전에** 스스로 감시를 지난다", () => {
  const 빌더 = src("tools/team-bench/material-r5.mjs");

  it("등급관문을 부르고, 불합격이면 파일을 안 쓴다", () => {
    expect(빌더).toContain("등급관문(재료");
    expect(빌더, "관문 결과를 보고 쓰기를 가르는 자리가 없다").toMatch(/관문\.ok[^\n]*&&[^\n]*홀드관문\.ok/);
  });

  it("잣대를 스스로 다시 적지 않는다 — 복사 비율·거절 문장은 gates.mjs에서 받아 온다", () => {
    expect(빌더).toContain("베낀글자비율여럿");
    expect(빌더).toContain("제품거절문장");
    expect(빌더, "거절 문장을 여기 또 적으면 두 벌이 되어 갈린다").not.toContain("등록된 사내 자료에는 관련 내용이 없습니다.");
  });

  it("★ 등급이 O가 아닌 행을 싣는 길이 없다 — 판정이 O일 때만 후보에 담는다", () => {
    expect(빌더).toMatch(/if \(g !== "O"\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2026-09-10 검토관 적발 수리 — 아래 다섯 묶음은 **그날 밟은 자리**를 못 박는다.
// 하나로 요약하면: 「잣대를 고쳤다」와 「그 잣대로 다시 잤다」는 다른 일이다.
// ══════════════════════════════════════════════════════════════════════════

describe("★ 잣대 지문 — 산출물이 「어느 잣대로 잰 판인지」 스스로 말한다", () => {
  it("지문에 창 규격과 열쇠 방식이 다 들어 있다", () => {
    expect(잣대지문()).toEqual({ 창길이: 40, 창걸음: 1, 창최소적중: 2, 질문열쇠: "sha256/16", 창열쇠: "sha1/12" });
  });

  it("★ 커밋된 빌드 보고서는 **지금 잣대로 구운 판**이다 — 잣대가 바뀌면 여기가 먼저 빨강이다", () => {
    // 왜: 회전 5의 첫 v5는 창걸음 10이던 옛 도구가 구웠는데 걸음을 1로 고친 뒤 **다시 굽지 않았다.**
    //     보고서에는 「관문 통과 · 글이C 0」이 남아, 지금 잣대로 재면 105행이 빨강인 판을 초록이라 말했다.
    //     시각 순서(도구가 산출물보다 나중)로만 드러나던 것을 **숫자로** 드러나게 한다.
    const 보고서들 = fs.readdirSync(path.join(루트, "tools/team-bench/results-ladder"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(루트, "tools/team-bench/results-ladder", d.name, "build-report.json"))
      .filter((p) => fs.existsSync(p));
    expect(보고서들.length, "빌드 보고서가 하나도 없다 — 이 시험이 아무것도 안 지킨다").toBeGreaterThan(0);
    // ⚠ 대상은 **등급 관문 판정을 적은 보고서**다. 옛 빌더(build-raft-dataset.mjs)의 보고서는 꼴이
    //   아예 다르고 등급을 재지도 않는다 — 그것까지 걸면 고칠 수 없는 빨강(벽)이 된다.
    const 등급말하는보고서 = 보고서들.filter((p) => JSON.parse(fs.readFileSync(p, "utf8")).관문 !== undefined);
    expect(등급말하는보고서.length, "등급 관문을 말하는 보고서가 하나도 없다").toBeGreaterThan(0);
    for (const p of 등급말하는보고서) {
      const r = JSON.parse(fs.readFileSync(p, "utf8"));
      expect(r.잣대, `${path.basename(path.dirname(p))}: 관문 판정을 적어 놓고 **어느 잣대로 쟀는지**를 안 적었다`).toBeDefined();
      expect(r.잣대, `${path.basename(path.dirname(p))}: 옛 잣대로 구운 판이다 — 다시 구워야 한다(고치는 것과 다시 재는 것은 다른 일이다)`).toEqual(잣대지문());
    }
  });

  it("빌더가 보고서에 잣대와 산출물 지문을 적는다(소스 감시)", () => {
    const 빌더 = src("tools/team-bench/material-r5.mjs");
    expect(빌더).toContain("잣대: 잣대지문()");
    expect(빌더, "산출물 지문이 없으면 보고서만 남고 판이 갈려도 아무도 모른다").toContain("재료지문");
  });
});

describe("★ 걷어내기 — 이미 구운 재료에서 C를 뺄 때도 **같은 잣대** 하나다", () => {
  const 지도 = { [질문해시("O질문")]: "O", [질문해시("C질문")]: "C" };
  const 집합 = 창집합만들기(긴C본문);
  const rows = [
    행({ question: "O질문" }),
    행({ question: "C질문" }),
    행({ question: "지도에없는질문" }),
    행({ question: "O질문", system: "x\n\n" + 머리말 + "\n[1] " + 긴C본문 }),
  ];

  it("C로 판정된 행만 빠진다(질문 해시로 걸린 것 · 글로 걸린 것 둘 다)", () => {
    const { 남긴, 지운 } = 걷어내기(rows, 지도, 집합);
    expect(지운).toHaveLength(2);
    expect(남긴).toHaveLength(2);
  });

  it("★ 남은 행에 **일괄 O를 찍지 않는다** — 판정한 등급을 그대로 적는다", () => {
    // 왜: longform은 153행이 전부 미매칭·C였고 **O가 0행**이다(2026-09-10 실측). 일괄 O를 찍었다면
    //     「등급을 본 적 없는 행」이 초록 딱지를 달고 학습에 들어갔을 것이다 — 감시가 감시를 속이는 꼴.
    const { 남긴 } = 걷어내기(rows, 지도, 집합);
    expect(남긴.map((r: { grade?: string }) => r.grade).sort()).toEqual(["O", "미매칭"]);
  });

  it("★ C를 다 걷어내도 미매칭이 남으면 반출 감시는 **빨강**이다 — 「C 0」이 「나가도 된다」가 아니다", () => {
    const { 남긴 } = 걷어내기(rows, 지도, 집합);
    expect(등급세기(남긴, 지도, 집합).C ?? 0, "C는 다 걷어냈어야 한다").toBe(0);
    expect(등급관문(남긴, 집합).ok, "그래도 모르는 등급이 남았으면 통과가 아니다").toBe(false);
  });

  it("★ 걷어내는 도구가 **잣대를 새로 적지 않는다** — 판정은 빌더의 그 함수를 부른다(소스 감시)", () => {
    // 이 결함의 뿌리: 같은 잣대가 JS(걸음 1)와 파이썬(걸음 10) 두 벌이었다. 값을 맞추는 것으로는
    // 또 갈린다 — 구현이 하나여야 한다.
    const 도구 = src("tools/team-bench/strip-c.mjs");
    expect(도구).toContain("등급판정");
    expect(도구, "창 규격을 여기 또 적으면 두 벌이 되어 갈린다").not.toMatch(/창길이\s*=\s*\d/);
    expect(도구, "창 걸음을 여기 또 적으면 두 벌이 되어 갈린다").not.toMatch(/창걸음\s*=\s*\d/);
    expect(도구).toMatch(/import\(pathToFileURL\(빌더\)/);
  });
});

describe("★ 먹이는 자리의 관문 — 빌더가 안 도는 경로도 재고 나서 굽는다", () => {
  const 관문도구 = src("tools/team-bench/gradegate.mjs");
  const 밤 = src("tools/team-bench/night-r5-prep.sh");

  it("관문 도구는 잣대를 새로 적지 않고 빌더의 등급관문을 부른다", () => {
    expect(관문도구).toContain("등급관문");
    expect(관문도구).toMatch(/import\(pathToFileURL\(빌더\)/);
  });

  it("못 읽은 파일은 **통과가 아니다**(나가는 코드 3) — 못 잰 것을 초록으로 세지 않는다", () => {
    expect(관문도구).toMatch(/process\.exit\(3\)/);
  });

  it("★ 밤 스크립트가 학습기를 부르기 **전에** 관문을 건다", () => {
    const 관문자리 = 밤.indexOf("gradegate.mjs");
    const 학습자리 = 밤.indexOf('--precision bf16');
    expect(관문자리, "밤 경로에 등급 관문 호출이 없다 — 빌더 안의 관문은 이 경로를 원리상 못 지킨다").toBeGreaterThan(0);
    expect(관문자리).toBeLessThan(학습자리);
  });

  it("★ 관문이 빨강이면 굽지 않는다(폴백으로 그냥 복사해 굽던 길을 막는다)", () => {
    expect(밤).toMatch(/GATE=red/);
    expect(밤).toMatch(/\[ "\$GATE" != "ok" \]/);
  });
});

describe("★ 밤 스모크의 안전장치 — 「교사를 안 내린다」가 커널 OOM으로 깨지지 않게", () => {
  const 밤 = src("tools/team-bench/night-r5-prep.sh");

  it("굽기 전에 가용 메모리를 잰다(27B 쪽에만 있던 관문을 스모크에도 둔다)", () => {
    expect(밤).toContain("SMOKE_MIN_AVAIL");
    expect(밤).toMatch(/AVAIL2.*-lt.*SMOKE_MIN_AVAIL/s);
  });

  it("★ 우리가 **먼저 죽게** 한다 — choom 으로 oom_score_adj 를 올린다(교사는 780이다)", () => {
    expect(밤).toMatch(/choom -n 1000/);
  });

  it("cgroup 상한을 건다(최선의 노력이라고 코드가 스스로 밝힌다)", () => {
    expect(밤).toContain("MemoryMax=$SMOKE_MEM_MAX");
    expect(밤, "통합메모리에서 실릴지 안 쟀다는 사실을 안 적으면 「막았다」가 거짓이 된다").toContain("최선의 노력");
  });

  it("★ 교사 감시견이 있다 — 교사가 말을 멈추면 스모크를 내린다(cgroup 회계와 무관한 마지막 방어선)", () => {
    expect(밤).toMatch(/pkill -f "finetune_qlora14b\.py"/);
    expect(밤).toContain("8080/health");
  });

  it("교사·임베딩을 내리거나 다시 묶지 않는다(종전 계약 유지)", () => {
    // ⚠ **주석을 뺀 실행 줄**에서 본다 — 스크립트 주석에는 「pkill llama-server 같은 건 교사까지
    //   죽인다」가 경고로 적혀 있다. 주석까지 세면 경고문 때문에 시험이 빨강이 되어, 사람이
    //   경고를 지우게 만든다(감시가 문서를 갉아먹는 꼴).
    const 줄바꿈 = String.fromCharCode(10);
    const 실행줄 = 밤.split(줄바꿈).filter((l) => !l.trim().startsWith("#")).join(줄바꿈);
    expect(실행줄, "pkill llama-server 는 교사까지 죽인다").not.toMatch(/pkill\s+(-\w+\s+)*llama-server/);
    // ⚠ 문구가 아니라 **부르는 자리**를 본다 — 스크립트는 로그로 「--host 없음 = 루프백만」이라
    //   말하는데, 그 말까지 세면 「없다고 말한 것」 때문에 빨강이 된다.
    const 라마부르는줄 = 실행줄.split(줄바꿈).filter((l) => l.includes("$LLAMA"));
    expect(라마부르는줄.length, "llama-server 를 부르는 줄이 없다 — 시험이 아무것도 안 본다").toBeGreaterThan(0);
    for (const l of 라마부르는줄) expect(l, "--host 는 루프백을 빼앗는다").not.toContain("--host");
  });
});

describe("★ 홀드아웃 — 기본값이 말과 같고, 표가 어느 갈래인지 말한다", () => {
  const 빌더 = src("tools/team-bench/material-r5.mjs");

  it("--holdout-n 기본값은 0이다(주석은 「0이 기본」이라 적어 놓고 코드는 100이던 자리)", () => {
    expect(빌더).toContain('opt("--holdout-n", "0")');
  });

  it("★ 새로 뗀 판에서는 표가 「기준은 하나다」라고 말하지 않는다 — 그 판은 두 갈래를 섞은 판이다", () => {
    const 지도: Record<string, string> = {};
    const rows = Array.from({ length: 6 }, (_, i) => {
      const q = `질문${i}`;
      지도[질문해시(q)] = "O";
      return 행({ question: q });
    });
    const 뗀 = 고르기(rows, { 지도, 창집합: null, 머리말, 홀드아웃수: 3 });
    expect(구성표(뗀.보고)).toContain("새 시험지를 뗐다");
    expect(구성표(뗀.보고)).not.toContain("홀드아웃 제외 기준은 하나다");

    const 안뗀 = 고르기(rows, { 지도, 창집합: null, 머리말, 홀드아웃수: 0 });
    expect(구성표(안뗀.보고)).toContain("홀드아웃 제외 기준은 하나다");
  });
});

describe("★ 관문 ⑬·⑭의 모집단 24 — 근거가 사실이고, 길이 이름으로 적혀 있다", () => {
  const 잣대 = src("tools/team-bench/gates.mjs");

  it("★ 「홀드아웃 100 중 회수 가능분」이 **근거로 서 있지 않다**(정정문 안의 인용은 옳다)", () => {
    // 실측: holdout-vuln-100.json 은 키가 question/answer/system 뿐이라 chunk·cites가 0건이다.
    // ⚠ 문구를 통째로 금지하지 않는다 — 「그때 이렇게 적었고 그것은 틀렸다」는 기록은 남겨야
    //   같은 근거를 다시 짓지 않는다. 대신 그 문구 곁에 **틀렸다는 말**이 있어야 한다.
    const 자리 = [...잣대.matchAll(/홀드아웃 100 중 회수 가능분/g)].map((m) => m.index as number);
    expect(자리.length, "이 문구가 아예 없으면 정정 기록도 없는 것이다").toBeGreaterThan(0);
    for (const i of 자리) {
      expect(잣대.slice(Math.max(0, i - 300), i + 300), "근거로 서 있다 — 곁에 「사실이 아니다」가 없다")
        .toContain("사실이 아니다");
    }
  });

  it("홀드아웃 파일에는 정말로 조각이 없다(위 주장이 사실임을 파일로 확인한다)", () => {
    const h = JSON.parse(src("tools/team-bench/holdout-vuln-100.json")) as Record<string, unknown>[];
    expect(h.length).toBe(100);
    expect(h.filter((r) => String(r.chunk ?? "").length >= 20)).toHaveLength(0);
    expect(h.filter((r) => Array.isArray(r.cites) && r.cites.length)).toHaveLength(0);
  });

  it("★ 미측정 사유가 **채우는 길**을 이름으로 말한다 — 고칠 수 없는 빨강은 관문이 아니라 벽이다", () => {
    expect(잣대).toContain("samples-questions.json에 조각(chunk)이 든 문항을");
    expect((잣대.match(/\*\*채우는 길\*\*/g) ?? []).length, "⑬·⑭ 둘 다에 적혀야 한다").toBeGreaterThanOrEqual(2);
  });
});

describe("★ 인용 관문 — 「[n]에 따르면」이 **그 번호의 블록**을 가리키나", () => {
  // ■ 왜 이 잣대가 생겼나 (2026-09-10 저녁 · 검토관 적발 → 실측)
  //   번호를 매기는 자(build-raft-dataset.mjs 블록번호찾기)는 **20자 겹침**으로 블록을 고른다. 그래서
  //   인용 전체가 그 블록에 없어도 20자만 겹치면 번호가 붙는다. 실측으로 값이 **정반대인** 인용이
  //   통과했다 — 답은 "knownRansomwareCampaignUse: Known", 그 번호의 블록은 Unknown이었다.
  //   제품 가드(citeguard)도 같은 20자 잣대라 이런 인용을 안 뗀다. 그래서 재료 쪽에서 막는다.
  const 머리 = "팀원 프롬프트\n\n" + 머리말 + "\n";
  const 두블록 = 머리 + "[1] 《a.md》 랜섬웨어 캠페인 활용(knownRansomwareCampaignUse): Unknown 이라고 적혀 있다\n"
    + "[2] 《b.md》 랜섬웨어 캠페인 활용(knownRansomwareCampaignUse): Known 이라고 적혀 있다";

  it("제목이 있는 꼴·없는 꼴을 **둘 다** 읽는다(한 꼴만 읽으면 다른 판이 통째로 거짓 빨강이 된다)", () => {
    expect([...블록나누기(두블록).keys()]).toEqual(["1", "2"]);
    const 제목없음 = 머리 + "[1] 첫 조각 본문이다\n[2] 둘째 조각 본문이다";
    const b = 블록나누기(제목없음);
    expect([...b.keys()]).toEqual(["1", "2"]);
    expect(b.get("1")).toContain("첫 조각");
    expect(b.get("2")).toContain("둘째 조각");
  });

  it("인용이 제 번호의 블록에 그대로 있으면 통과", () => {
    const r = 인용관문([{ system: 두블록, answer: `설명입니다. [2]에 따르면 "knownRansomwareCampaignUse): Known"`, grade: "O" }]);
    expect(r.ok).toBe(true);
    expect(r.인용).toBe(1);
    expect(r.맞음).toBe(1);
  });

  it("★ 20자는 겹치는데 **값이 반대**인 인용을 잡는다(이 관문의 존재 이유)", () => {
    const r = 인용관문([{ system: 두블록, answer: `설명입니다. [1]에 따르면 "knownRansomwareCampaignUse: Known"`, grade: "O" }]);
    expect(r.ok, "20자 겹침만 보면 이 행은 통과한다 — 그래서 잣대를 「그대로 들어 있나」로 둔다").toBe(false);
    expect(r.없음).toBe(1);
    expect(r.사유.join(" ")).toContain("어디에도 그대로 없는");
  });

  it("인용이 **남의 번호**를 가리키면 잡는다", () => {
    const r = 인용관문([{ system: 두블록, answer: `설명입니다. [1]에 따르면 "knownRansomwareCampaignUse): Known"`, grade: "O" }]);
    expect(r.ok).toBe(false);
    expect(r.번호틀림).toBe(1);
    expect(r.걸린행[0].실제).toBe("2");
  });

  it("인용이 아예 없는 행은 이 관문이 건드리지 않는다(회전 1·2 꼴 「원문: \"…\"」 포함)", () => {
    expect(제품인용들('설명입니다. 원문: "어떤 문장"')).toHaveLength(0);
    expect(인용관문([{ system: 두블록, answer: '설명만 있는 답입니다', grade: "O" }]).ok).toBe(true);
  });

  it("★ 등급관문이 이 관문을 **부른다** — 따로 부르게 두면 부르는 것을 잊는 경로가 생긴다", () => {
    const r = 등급관문([{ ...행(), grade: "O", system: 두블록, answer: `설명입니다. [1]에 따르면 "knownRansomwareCampaignUse: Known"` }]);
    expect(r.ok).toBe(false);
    expect(r.인용.없음).toBe(1);
  });
});

describe("★ 겹침 관문 — 재료가 시험 문항을 물고 있나", () => {
  // ⚠ 2026-09-10 저녁 · 검토관 적발: 겹침을 보는 시험이 **긴 형식만** 보고 있었고, 실제 학습 재료는
  //   저장소에 안 들어와(data/ 무시) 어떤 시험도 읽지 못했다. 그래서 잣대를 여기 두고, 재는 자리는
  //   파일이 실제로 있는 곳(먹이기 직전 gradegate)으로 옮겼다.
  const 시험 = [{ question: "이 취약점이 랜섬웨어와 어떤 연관이 있나요?", answer: "…" }];

  it("안 겹치면 통과", () => {
    expect(겹침관문([행({ question: "다른 질문입니다" })], 시험).ok).toBe(true);
  });

  it("★ 공백·문장부호가 달라도 같은 문항이면 잡는다(열쇠가 원문자면 사소한 차이로 샌다)", () => {
    const r = 겹침관문([행({ question: "이 취약점이  랜섬웨어와 어떤 연관이 있나요" })], 시험);
    expect(r.ok).toBe(false);
    expect(r.겹침).toBe(1);
    expect(r.사유.join(" ")).toContain("외웠나");
  });

  it("시험지가 비어 있으면 **통과가 아니라 아무 것도 안 잰 것**이라고 셈이 말한다", () => {
    const r = 겹침관문([행()], []);
    expect(r.ok).toBe(true);
    expect(r.시험문항, "0이면 부르는 쪽이 파일을 잘못 준 것이다").toBe(0);
  });
});

describe("★ 먹이는 자리(gradegate)가 새 잣대를 **실제로** 부른다", () => {
  const 관문도구 = src("tools/team-bench/gradegate.mjs");

  it("겹침 잣대를 여기서 새로 안 적고 불러 쓴다", () => {
    expect(관문도구).toContain("겹침관문");
    expect(관문도구, "시험지·표본을 받는 길이 없으면 잴 수가 없다").toContain("--holdout");
    expect(관문도구).toContain("--samples");
  });

  it("★ 잣대가 **낡은 사본**이면 그렇다고 말한다(못 잰 것을 통과로 세지 않는다)", () => {
    expect(관문도구).toContain("못재는것");
    expect(관문도구).toMatch(/겹침관문[\s\S]{0,200}exit\(3\)/);
  });
});
