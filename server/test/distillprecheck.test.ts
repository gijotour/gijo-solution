// distillprecheck.test.ts — 증류기 사전검사 계약 (증류학습 계획서 §12.6 「영어 원천은 편입률 0」의 수리, 2026-09-03).
//
// 무엇을 지키나:
//   ① 사전검사는 **서버 규칙의 사본**이다 — 서버 근거겹침과 **같은 답**을 내는지 직접 대조한다(사본은 언젠가 어긋난다).
//   ② --src-lang en: 한국어 문답 + 영어 원문 한 문장 인용 → 20자 겹침을 **완화 없이** 통과. 인용이 없으면 거절.
//   ③ en 모드의 새 구멍 하나: 답이 통째로 영어면 겹침은 통과한다 — 그걸 배우면 **영어로 답하는 법**을 배운다.
//      그래서 「한국어 아님」을 여기서 막는다(서버에는 없는, 이 도구만의 더 엄한 규칙).
//   ④ distill.mjs가 이 모듈을 **가져다 쓴다**(같은 잣대를 두 벌 적지 않는다) · 영어 모드·주제선별 끄기·본문 보관 계약.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 사전검사, overlap20, 한글비율, 인용뺀설명, 시점데이터 } from "../../tools/distill-precheck.mjs";
import { 근거겹침 } from "../src/engine/learncandidates";

const 한글근거 = "취약점 조치 우선순위는 CVSS 점수만이 아니라 실제 악용 여부와 자산의 외부 노출 여부, 자산 중요도를 함께 보아 정한다. 악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치한다.";
const 한글답 = "취약점 조치 우선순위는 CVSS 점수만이 아니라 실제 악용 여부와 자산의 외부 노출 여부, 자산 중요도를 함께 보아 정합니다. 특히 악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치해야 합니다.";
const 질문 = "취약점 조치 우선순위는 어떻게 정하나요?";

// 영어 원천 조각(NVD·CISA 꼴)과 그 조각으로 만든 세 가지 답 — 통과 하나, 거절 둘.
const 영어근거 = "CISA maintains the authoritative source of vulnerabilities that have been exploited in the wild. Organizations should use the KEV catalog as an input to their vulnerability management prioritization framework, because the presence of a vulnerability in this catalog is evidence that threat actors are actively using it against real targets.";
const 인용문 = "Organizations should use the KEV catalog as an input to their vulnerability management prioritization framework";
const 인용한답 = `KEV 목록은 실제로 악용이 확인된 취약점을 모아 둔 자료라서 조치 우선순위를 정할 때 가장 먼저 봅니다. 근거 문서는 이 목록을 취약점 관리 우선순위 판단의 입력으로 쓰라고 말합니다. 원문: "${인용문}" 따라서 담당자는 이 목록에 오른 취약점부터 처리하도록 계획을 세우는 것이 좋습니다.`;
const 인용안한답 = "KEV 목록은 실제로 악용이 확인된 취약점을 모아 둔 자료라서 조치 우선순위를 정할 때 가장 먼저 보아야 합니다. 담당자는 이 목록에 오른 취약점부터 처리하도록 계획을 세우는 것이 좋습니다. 근거 문장을 그대로 옮기지는 않았습니다.";
const 통짜영어답 = `${인용문}. The catalog is authoritative and organizations are strongly encouraged to prioritize remediation of the listed entries before anything else, because attackers reuse them.`;

describe("증류 사전검사 — 서버 잣대의 사본이 어긋나지 않는가", () => {
  it("겹침 판정은 서버 근거겹침과 **같은 답**을 낸다(사본이 갈라지면 여기서 터진다)", () => {
    const 표본: [string, string][] = [
      [한글답, 한글근거],
      ["전혀 다른 내용의 문장입니다", 한글근거],
      [인용한답, 영어근거],
      [인용안한답, 영어근거],
      [통짜영어답, 영어근거],
      ["짧다", 한글근거],
    ];
    for (const [a, s] of 표본) {
      // 창을 4칸씩 미는 규칙이라 「겹친 창」 문자열까지 같아야 한다 — 하나라도 다르면 잣대가 갈라진 것이다.
      expect(overlap20(a, s), `답: ${a.slice(0, 20)}…`).toEqual(근거겹침(a, s));
    }
  });

  it("시점데이터 세 신호(날짜·「N건」 3회·우리 DB 식별자)를 서버와 같이 본다", () => {
    expect(시점데이터("조치 기한은 2026-07-28 입니다")).toBe(true);
    expect(시점데이터("높음 3건 · 중간 5건 · 낮음 7건")).toBe(true);
    expect(시점데이터("자산 vuln:sample-web01 을 보세요")).toBe(true);
    expect(시점데이터("개인정보 보호법 제30조에 따라 1년 이상 보관한다")).toBe(false); // 법령의 조·년은 걸리면 안 된다
  });
});

describe("증류 사전검사 — 한국어 원천(ko, 기존 동작 그대로)", () => {
  it("근거 문장을 살린 답은 통과한다", () => {
    expect(사전검사(질문, 한글답, 한글근거)).toBeNull();
  });
  it("겹침이 없으면 「근거 겹침 없음(20자)」", () => {
    // ⚠ 80자를 넘겨야 한다 — 그 앞의 「답 너무 짧음」에 먼저 걸리면 겹침 규칙을 재는 것이 아니게 된다.
    const 겹침없는답 = "우선순위는 담당자의 감으로 정하면 되고 심각도 표시는 참고만 하면 충분합니다. 특별한 규칙 같은 것은 따로 없으니 편하게 판단하시면 되고, 급한 일부터 처리하셔도 괜찮습니다.";
    expect(겹침없는답.length).toBeGreaterThan(80);
    expect(사전검사(질문, 겹침없는답, 한글근거)).toBe("근거 겹침 없음(20자)");
  });
  it("빈 문답·길이 극단·시점데이터는 교사를 다시 부르기 전에 걸러진다", () => {
    expect(사전검사("", 한글답, 한글근거)).toBe("빈 문답");
    expect(사전검사(질문, "가".repeat(79), 한글근거)).toBe("답 너무 짧음");
    expect(사전검사(질문, "가".repeat(1201), 한글근거)).toBe("답 너무 김");
    expect(사전검사(질문, `${한글답} 기한은 2026-07-28 입니다.`, 한글근거)).toBe("시점데이터(날짜·N건)");
  });
  it("한국어 답은 영어 비중 규칙에 걸리지 않는다 — ko 모드는 그 검사를 하지 않는다", () => {
    expect(사전검사(질문, 한글답, 한글근거, { srcLang: "ko" })).toBeNull();
  });
});

describe("증류 사전검사 — 영어 원천(--src-lang en)", () => {
  it("★ 한국어 설명 + 영어 원문 한 문장 인용은 통과한다 — 20자 규칙을 **완화하지 않고** 지나는 길", () => {
    expect(사전검사("KEV 목록은 취약점 우선순위에 어떻게 쓰나요?", 인용한답, 영어근거, { srcLang: "en" })).toBeNull();
    // 통과의 근거가 진짜 「원문 그대로」인지 확인 — 서버도 같은 규칙으로 한 번 더 본다.
    expect(근거겹침(인용한답, 영어근거)).toBeTruthy();
  });

  it("★ 인용이 없으면 거절하고, 사유 이름이 한국어 모드와 다르다(원인이 다르므로 보고서에서 섞이면 안 된다)", () => {
    expect(사전검사(질문, 인용안한답, 영어근거, { srcLang: "en" })).toBe("영어 원문 인용 없음(20자 겹침)");
    expect(사전검사(질문, 인용안한답, 영어근거, { srcLang: "ko" })).toBe("근거 겹침 없음(20자)");
  });

  it("★★ 답이 통째로 영어면 **겹침은 통과하는데도** 거절한다 — 그걸 배우면 영어로 답하는 법을 배운다", () => {
    expect(근거겹침(통짜영어답, 영어근거)).toBeTruthy(); // 겹침만으로는 못 막는다는 증거
    expect(사전검사(질문, 통짜영어답, 영어근거, { srcLang: "en" })).toBe("한국어 아님(설명이 영어)");
  });

  it("한국어 비율은 **인용을 뺀 설명**으로 잰다 — 인용이 길다고 정상 답이 떨어지면 안 된다", () => {
    expect(한글비율(인용뺀설명(인용한답))).toBeGreaterThan(0.5);
    expect(한글비율(인용뺀설명(통짜영어답))).toBeLessThan(0.5);
    expect(인용뺀설명(인용한답)).not.toContain(인용문);
  });

  it("영어 원천이어도 시점데이터·길이 규칙은 그대로다(계획서: 규칙 완화 없음)", () => {
    const 날짜인용 = 인용한답.replace("원문:", "공개일 2026-01-15 · 원문:");
    expect(사전검사(질문, 날짜인용, 영어근거, { srcLang: "en" })).toBe("시점데이터(날짜·N건)");
  });
});

describe("증류기 소스 감시 — 잣대가 두 벌이 되지 않았는가 · 새 스위치 계약", () => {
  const 도구 = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "distill.mjs"), "utf8");

  it("distill.mjs는 사전검사를 **가져다 쓴다** — 같은 규칙을 파일 안에 다시 적으면 언젠가 어긋난다", () => {
    expect(도구).toContain('from "./distill-precheck.mjs"');
    expect(도구).toContain("사전검사(q, a, c.text, { srcLang: SRC_LANG })");
    // 예전처럼 파일 안에서 직접 겹침·시점데이터를 정의하고 있으면 사본이 두 벌이 된 것이다.
    expect(도구).not.toMatch(/function overlap20\(/);
    expect(도구).not.toMatch(/const 시점데이터 = \(a\)/);
  });

  it("--src-lang en은 프롬프트만 바꾼다 — 통과 규칙을 손대지 않는다", () => {
    expect(도구).toContain('const SYSTEM = SRC_LANG === "en" ? SYSTEM_EN : SYSTEM_KO');
    expect(도구).toMatch(/SYSTEM_EN = \[[\s\S]*원문: /);
    expect(도구).toContain('if (!["ko", "en"].includes(SRC_LANG))');
  });

  it("--no-topic-filter는 --files 로 사람이 고른 문서일 때만 — 저장소(store)에서는 못 켠다", () => {
    expect(도구).toContain("if (NO_TOPIC_FILTER || TOPIC_RE[TOPIC].test(c))");
    expect(도구).toMatch(/NO_TOPIC_FILTER && \(SOURCE !== "files" \|\| !FILES\)/);
    // 저장소 갈래는 주제 정규식이 「분류가 틀린 문서」를 거르는 마지막 그물이라 그대로 남아 있어야 한다.
    expect(도구).toContain("for (const c of j.chunks) if (TOPIC_RE[TOPIC].test(c.text))");
  });

  it("★ 근거 **본문**을 보관한다 — 서버는 ref만 저장하므로 RAFT 빌더가 여기 없으면 본문을 영영 못 찾는다", () => {
    expect(도구).toContain('path.join(repo, "server", "data", "distill-archive")');
    // 한 줄 = {question, answer, topic, cites, promptHash, accepted} — 빌더가 읽는 계약
    expect(도구).toMatch(/question: it\.question, answer: it\.answer, topic: it\.topic,[\s\S]*cites: it\.cites, promptHash: it\.promptHash \?\? null,[\s\S]*accepted:/);
    // accepted는 서버가 돌려준 **건별 자리(i)**로 적는다 — 묶음 통째로 true를 적으면 거짓이 된다.
    expect(도구).toContain("const 거절자리 = new Set((r.rejected || []).map((x) => x.i));");
    expect(도구).toContain("보관(items, (i) => !거절자리.has(i));");
    // 편입을 안 했거나 못 했으면 **모른다(null)** — false로 적지 않는다.
    expect(도구).toContain("보관(items, null)");
  });

  it("보관 폴더는 운영 데이터라 저장소에 안 들어간다(.gitignore)", () => {
    const ignore = fs.readFileSync(path.join(__dirname, "..", "..", ".gitignore"), "utf8");
    expect(ignore).toMatch(/^server\/data\/$/m);
    expect(ignore).toContain("server/data/distill-archive/");
  });
});
