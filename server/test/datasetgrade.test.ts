// 등급 C **반출 감시** — 학습 재료가 gb10으로 나갈 때 기밀(C)이 딸려 나가지 않는가.
//
// ■ 왜 이 파일이 생겼나 (2026-09-10 · 실측)
//   승인 문답 3,778건 중 **1,597건이 등급 C**다(2026-09-03 한 묶음 — 승인자를 못 되짚어 기밀로
//   닫힌 폴백). 그런데 회전 1~4의 학습 재료는 그 등급을 **한 번도 안 봤고**, 구운 재료가 통째로
//   gb10에 복제돼 있었다: raft-vuln-v4 956행 중 **577행(60%)**이 C에서 온 행이었다.
//   `server/src/engine/learncandidates.ts`가 「C는 무엇을 줘도 안 나간다」고 창구를 막아 둔 그 정책이,
//   **도구로 만든 재료**에는 걸려 있지 않았다 — 정책이 한 창구에만 있으면 옆문은 그대로 열려 있다.
//
// ■ 이 파일이 못 박는 것
//   ① 재료 빌더(tools/team-bench/material-r5.mjs)의 산출물에는 **행마다 grade 칸**이 있다.
//   ② grade 칸이 없거나 O가 아니면 **빨강**이다(fail-closed — 모르는 등급은 O가 아니다).
//   ③ 칸은 O인데 **글에 C 본문**이 실린 행도 빨강이다(칸만 보면, 칸을 잘못 적은 빌더를 통과시킨다).
//   ④ 빌더는 파일을 쓰기 **전에** 그 감시를 스스로 통과해야 한다(소스 감시).
//   ⑤ 잣대는 한 곳이다 — 거절 문장·복사 비율은 gates.mjs의 그 함수를 부른다(두 벌이면 갈린다).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  질문해시, 창길이, 창걸음, 창최소적중, 창정규화, 창적중수,
  등급판정, 등급관문, 한글비율, 원천언어, 복사상한, 베낀비율행, 사실주장인가, 거절로시작하나,
  고르기, 구성표,
} from "../../tools/team-bench/material-r5.mjs";
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
