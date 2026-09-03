// topiccolors.test.ts — 주제 이름표·색표는 서버 TOPICS(learnloop.ts) 전수를 담는다 (2026-09-03).
//
// 왜 이 시험인가(검토관 2026-09-03 — 커밋 474d063e 「5번째 주제 일반」 사후 검토):
//   주제가 넷→다섯이 될 때 learnloop.html·grouppanels.js는 따라갔는데 agent.html·settings.html의
//   어댑터 배지 색표는 넷 그대로였다 — 「일반」 어댑터가 미분류와 같은 회색으로 그려졌다.
//   주제 이름을 적는 자리가 클라에 일곱 곳이라, 서버가 주제를 더할 때 사람이 일곱 곳을 기억해야 한다.
//   기억 대신 이 시험이 센다 — 빠진 자리가 있으면 **어느 파일 몇 행의 어느 표에 몇 번째 주제**가 없는지 말한다.
//   같은 부류의 앞선 시험: agentroster.test 「아이콘표에 등록부 id 전부」 · topictag.test 「슬러그 전수」.
//   현황판(panelsboard.js)도 여기서 본다 — 타일이 조각을 4개만 그려 다섯째 주제가 조용히 잘렸었다(같은 검토).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { TOPICS } from "../src/engine/learnloop";

const PAGES = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");
const read = (f: string) => fs.readFileSync(path.join(PAGES, f), "utf8");
const 행 = (src: string, at: number) => src.slice(0, at).split("\n").length;

/** 소스에서 표 하나를 오려 낸다 — 머리(시작 문자열)부터 꼬리(끝 문자열)까지. 머리가 없으면 그 자체가 결함이다. */
function 표(file: string, 머리: string, 꼬리: string) {
  const src = read(file);
  const s = src.indexOf(머리);
  expect(s, `${file}: 「${머리}」 표가 사라졌다 — 이름을 바꿨으면 이 시험의 머리도 같이 바꾼다(감시가 헛돌면 안 된다)`).toBeGreaterThan(-1);
  expect(src.indexOf(머리, s + 1), `${file}: 「${머리}」가 둘 이상이다 — 어느 표를 보는지 모호해진다`).toBe(-1);
  const e = src.indexOf(꼬리, s + 머리.length);
  expect(e, `${file}: 「${머리}」 표의 꼬리 「${꼬리}」가 없다`).toBeGreaterThan(s);
  return { 본문: src.slice(s, e + 꼬리.length), 자리: `${file}:${행(src, s)} 「${머리}」` };
}

// 주제를 적는 자리 — 표 안에서 주제가 어떤 꼴로 적히는지(꼴)와, 표에 적힌 주제를 전부 뽑는 식(전부).
const 자리들: { file: string; 머리: string; 꼬리: string; 설명: string; 꼴: (t: string) => string; 전부: RegExp }[] = [
  { file: "agent.html", 머리: "const 색 = {", 꼬리: "}[topic]", 설명: "어댑터 배지 색표(AI 팀 화면)", 꼴: (t) => `${t}: "`, 전부: /[{,]\s*([가-힣]+): "/g },
  { file: "settings.html", 머리: "const 색 = {", 꼬리: "};", 설명: "어댑터 등록부 색표(설정)", 꼴: (t) => `${t}: "`, 전부: /[{,]\s*([가-힣]+): "/g },
  { file: "learnloop.html", 머리: "const 주제색 = {", 꼬리: "};", 설명: "주제 띠 막대색", 꼴: (t) => `${t}: "`, 전부: /[{,]\s*([가-힣]+): "/g },
  { file: "learnloop.html", 머리: "const 이름순 = [", 꼬리: "];", 설명: "주제 띠 순서", 꼴: (t) => `"${t}"`, 전부: /"([가-힣]+)"/g },
  { file: "grouppanels.js", 머리: "var 짧은 = {", 꼬리: "};", 설명: "🎓 학습 판 짧은 이름", 꼴: (t) => `"${t}":`, 전부: /"([가-힣]+)":/g },
  { file: "grouppanels.js", 머리: "var 순서 = [", 꼬리: "];", 설명: "🎓 학습 판 조각 순서", 꼴: (t) => `"${t}"`, 전부: /"([가-힣]+)"/g },
];

describe("주제 이름표·색표 — 서버 TOPICS 전수(클라 소스 감시)", () => {
  it("TOPICS는 다섯이고 「일반」이 마지막이다 — 아래 자리들이 세는 전제", () => {
    expect(TOPICS).toEqual(["취약점", "장비운영", "사내규정", "위협대응", "일반"]);
  });

  for (const z of 자리들) {
    it(`${z.file} ${z.설명} — TOPICS 전부 있고, 서버에 없는 주제는 없다`, () => {
      const { 본문, 자리 } = 표(z.file, z.머리, z.꼬리);
      TOPICS.forEach((t, i) => {
        expect(본문, `${자리}: TOPICS ${i + 1}번째 「${t}」가 없다 — 이 자리에 없으면 그 주제는 ${z.설명}에서 미분류(회색)처럼 그려지거나 아예 안 보인다`)
          .toContain(z.꼴(t));
      });
      // 반대 방향 — 표에 있는데 서버에 없는 주제는 유령이다(서버가 주제를 지웠는데 화면만 남은 것).
      const 적힌 = [...본문.matchAll(z.전부)].map((m) => m[1]);
      expect(적힌.length, `${자리}: 주제를 하나도 못 읽었다 — 「전부」 식이 표 꼴과 어긋난다`).toBeGreaterThan(0);
      for (const name of 적힌) expect(TOPICS as readonly string[], `${자리}: 「${name}」은 서버 TOPICS에 없다(유령 주제)`).toContain(name);
    });
  }

  it("learnloop.html .lt-<주제> CSS — TOPICS 전부 + 미분류(topic=null 배지)만", () => {
    const css = read("learnloop.html");
    TOPICS.forEach((t, i) => {
      expect(css, `learnloop.html .lt-<주제> CSS: TOPICS ${i + 1}번째 「.lt-${t}{」가 없다 — 그 주제 배지가 색 없이 그려진다`).toContain(`.lt-${t}{`);
    });
    // 미분류는 TOPICS 밖이지만 정당하다 — topic=null 후보의 배지(learnloop.html lc-topic lt-미분류)가 이 값을 입는다.
    const 허용 = new Set<string>([...TOPICS, "미분류"]);
    for (const m of css.matchAll(/\.lt-([가-힣]+)\{/g)) {
      expect(허용.has(m[1]), `learnloop.html:${행(css, m.index!)} 「.lt-${m[1]}」은 서버 TOPICS에도 미분류에도 없다(유령 주제)`).toBe(true);
    }
  });

  it("어댑터 배지(agent.html·settings.html)의 주제 바탕색은 learnloop.html .lt-<주제>와 같다 — 세 화면이 한 주제를 다른 색으로 부르면 안 된다", () => {
    // 글자색 토큰은 화면마다 폴백이 조금 다르다(blue-light ↔ blue-ink) — 주제의 정체성은 바탕(tint)이라 그것을 대조한다.
    const css = read("learnloop.html");
    const tint = (t: string) => {
      const m = css.match(new RegExp(`\\.lt-${t}\\{[^}]*background:(rgba\\([^)]*\\))`));
      expect(m, `learnloop.html .lt-${t}: background rgba가 없다`).toBeTruthy();
      return m![1];
    };
    for (const z of 자리들.filter((x) => x.file === "agent.html" || x.file === "settings.html")) {
      const { 본문, 자리 } = 표(z.file, z.머리, z.꼬리);
      for (const t of TOPICS) {
        const m = 본문.match(new RegExp(`${t}: "([^"]*)"`));
        expect(m, `${자리}: 「${t}」 값을 못 읽었다`).toBeTruthy();
        expect(m![1], `${자리}: 「${t}」 바탕색이 learnloop.html .lt-${t}(${tint(t)})와 다르다`).toContain(`background:${tint(t)}`);
      }
    }
  });
});

describe("현황판(panelsboard.js) — 판이 준 조각을 조용히 자르지 않는다", () => {
  it("조각 상한은 폭 계약(같은 파일의 CSS 숫자)에서 계산되고 TOPICS 수 이상이다 — 🎓 학습 판의 다섯 주제가 다 보인다", () => {
    const src = read("panelsboard.js");
    const 값 = (name: string) => {
      const m = src.match(new RegExp(`var ${name} = (\\d+);`));
      expect(m, `panelsboard.js: 「var ${name} = N;」이 없다 — 폭 계약 상수가 사라졌다`).toBeTruthy();
      return Number(m![1]);
    };
    // 같은 식을 소스 밖에서 다시 센다 — 코드가 상수를 바꾸면 여기가 그 값으로 다시 판정한다.
    const 안쪽 = 값("타일최소폭") - 2 * 값("타일여백") - 2 * 값("타일테두리");
    const 줄당 = Math.max(1, Math.floor((안쪽 + 값("조각간격")) / (값("조각폭") + 값("조각간격"))));
    const 상한 = 줄당 * 값("조각줄수");
    expect(상한, `현황판 조각 상한 ${상한} < 주제 ${TOPICS.length} — 🎓 학습 판의 주제가 「+N」 뒤로 숨는다(폭 계약을 바꿨으면 조각줄수도 다시 본다)`)
      .toBeGreaterThanOrEqual(TOPICS.length);
    // CSS 문자열이 그 상수를 실제로 쓴다 — 상수만 있고 CSS는 맨 숫자면 계약이 아니라 장식이다.
    expect(src).toContain('minmax(" + 타일최소폭 + "px,1fr)');
    expect(src).toContain('border:" + 타일테두리 + "px solid');
    expect(src).toContain('"padding:9px " + 타일여백 + "px;');
    expect(src).toContain('gap:" + 조각간격 + "px;flex-wrap:wrap;');
  });

  it("조용한 자르기(segments.slice(0, N))가 없고, 넘친 조각은 「+N」으로 드러낸다", () => {
    const src = read("panelsboard.js");
    expect(src, "panelsboard.js: 조각을 맨 숫자로 자르는 .slice(0, N)이 돌아왔다 — 다섯째 주제가 다시 조용히 잘린다").not.toMatch(/segments \|\| \[\]\)\.slice\(0, \d+\)/);
    expect(src).toContain('class="pv-more-seg"');
    expect(src).toContain("+' + 숨은.length");
    // 「+N」 글자는 .pv-v 크기(12.25px)를 그대로 물려받는다 — 따로 font-size를 낮추지 않는다(11px 미만 금지).
    expect(src).toMatch(/\.pv-v \.pv-more-seg\{[^}]*\}/);
    expect(src).not.toMatch(/\.pv-v \.pv-more-seg\{[^}]*font-size/);
  });
});
