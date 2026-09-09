// test/tabletext.test.ts — **마크다운 파이프 표를 읽는 잣대는 한 벌이다.**
//
// ■ 증상 (2026-09-10, 갈래 U)
//   「표가 무엇인가」를 서버 코드가 **네 벌**로 적고 있었다.
//     ① memory.ts:752-796  표줄·구분선·열수·표머리글들·표본문행자리 — 주석은 「유일한 정의」라 적혀 있었다
//     ② webreport.ts:88-96 위 셋의 **글자까지 같은 사본** + 칸가르기(이스케이프를 푸는 유일한 구현)
//     ③ inspectionreport.ts:273·276-277·340·343-344 — 이름 없는 인라인 사본. **딴 잣대였다.**
//     ④ dataset.ts:172·177·203 파이프표()·칸글()·표_최대열 — 내는 쪽(렌더러)
//   ①이 「유일한 정의」로 못박혀 있었는데도 ②가 생긴 이유는 정직하다: memory.ts가 DB·LanceDB를
//   물어서, 파서가 import하면 통째로 딸려 온다. **그래서 잎 모듈(tabletext.ts)로 뽑는다.**
//
// ■ 이 시험이 먼저 빨갛게 잡은 것 — ③이 딴 잣대라서 나던 **살아 있는 결함 3종**
//   (도달 경로: personaldocs.ts:156-175가 사용자가 쓴 md를 그대로 inspectionDocx/Html에 먹인다)
//   ㄱ `| a\|b | 1 |`  칸 안 파이프 → 오늘 3칸 + 역슬래시 잔류 (추출기 칸글()이 실제로 내는 꼴)
//   ㄴ `|:---|---:|`   정렬 구분선 → 오늘 구분선으로 못 알아봐 `:---`가 Word/PDF에 그대로 찍힌다
//   ㄷ `| - | - |`     대시만 든 본문 행 → 오늘 구분선으로 보고 **그 행을 통째로 버린다**(데이터 손실)
//
// ■ 왜 조이지 않았나
//   표 인지를 「머리글+구분선 필수」로 조이면 구분선을 안 쓴 사용자 표가 통째로 사라진다.
//   inspectionHtml은 종전대로 **파이프 줄만 있어도** 표를 만든다 — 넓히기만 하고 안 조인다.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  표줄, 구분선, 열수, 칸가르기, 표머리글들, 표본문행자리,
  칸글, 파이프표, 표_최대열,
} from "../src/engine/tabletext";
import { inspectionHtml, inspectionDocx } from "../src/engine/inspectionreport";

// ── ① 잎 계약 — import이 한 줄도 없다 ────────────────────────────────────────────────
describe("tabletext는 잎이다 — 아무것도 물지 않는다", () => {
  const src = fs.readFileSync(path.resolve("src/engine/tabletext.ts"), "utf8");

  it("★★ import 줄이 0개다 — 하나라도 붙으면 파서·도구가 부담 없이 부르지 못한다", () => {
    // 값이든 타입이든, 정적이든 동적이든 전부 막는다. 이 계약이 깨지는 순간 webreport가
    // 다시 사본을 만들 이유가 생긴다(그 이유로 2026-09-09에 실제로 사본이 하나 늘었다).
    const 정적 = src.match(/^\s*import\s/gm) ?? [];
    const 동적 = src.match(/\brequire\s*\(|\bimport\s*\(/g) ?? [];
    expect(정적, `import 줄이 생겼다: ${정적.join(" / ")}`).toHaveLength(0);
    expect(동적, "동적 import/require가 생겼다").toHaveLength(0);
  });

  it("fs·path·env를 안 문다 — .mjs 도구가 dist로 부를 길을 막지 않는다", () => {
    // ⚠ **주석을 걷고** 잰다 — 안 걷으면 「fs·path·process.env도 안 쓴다」고 적어 둔 머리말이
    //   스스로 걸려 헛빨강이 난다(2026-09-10에 실제로 그렇게 한 번 빨개졌다).
    const 코드 = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:/])\/\/[^\n]*/g, "$1");
    expect(/\bfs\.|\bpath\.|process\.env/.test(코드), "런타임 환경에 손을 뻗었다").toBe(false);
  });
});

// ── ② 읽는 잣대 — 옮기기 전 memory.ts/webreport.ts와 **한 글자도 안 달라졌다** ────────
describe("읽는 잣대", () => {
  it("표줄 — 들여쓴 표행도 표행이다", () => {
    expect(표줄("| 가 | 1 |")).toBe(true);
    expect(표줄("  | 가 | 1 |")).toBe(true); // 들여쓰기 허용(trimStart)
    expect(표줄("| 가 | 1")).toBe(true);     // 꼬리 파이프가 없어도 표행
    expect(표줄("가 | 1")).toBe(false);
  });

  it("구분선 — 정렬(:---)까지 알아보고, 대시 하나짜리 본문 행은 아니라고 본다", () => {
    expect(구분선("|---|---|")).toBe(true);
    expect(구분선("| --- | --- |")).toBe(true);
    expect(구분선("|:---|---:|")).toBe(true);
    expect(구분선("| :--: | :--: |")).toBe(true);
    expect(구분선("| - | - |"), "대시 하나는 본문 행이다").toBe(false);
    expect(구분선("| 가 | 1 |")).toBe(false);
  });

  it("열수 — 칸 안 이스케이프(`\\|`)는 안 센다", () => {
    expect(열수("| 가 | 나 |")).toBe(2);
    expect(열수("| a\\|b | 1 |"), "이스케이프를 세면 이 행만 표에서 떨어져 나간다").toBe(2);
    expect(열수("| 가 | 1")).toBe(1);
  });

  it("칸가르기 — 양끝 파이프를 벗기고 칸 안 이스케이프를 되돌린다", () => {
    expect(칸가르기("| 가 | 나 |")).toEqual(["가", "나"]);
    expect(칸가르기("| a\\|b | 1 |")).toEqual(["a|b", "1"]);
    expect(칸가르기("| 가 | 1"), "꼬리 파이프가 없어도 칸 수는 같다").toEqual(["가", "1"]);
  });

  it("표머리글들 — **바로 다음 줄이 구분선인** 행만 머리글이다", () => {
    const L = ["| 가 | 나 |", "|---|---|", "| 1 | 2 |", "| 한국인터넷진흥원 |"];
    expect([...표머리글들(L)]).toEqual(["| 가 | 나 |"]);
  });

  it("표본문행자리 — 구분선과 열 수가 같은 줄까지만 본문 행이다", () => {
    const L = ["| 가 | 나 |", "|---|---|", "| 1 | 2 |", "| 한국인터넷진흥원 |"];
    expect(표본문행자리(L)).toEqual([false, false, true, false]);
  });
});

// ── ③ 내는 쪽 — 옮겨도 출력이 한 글자도 안 바뀐다 ──────────────────────────────────
describe("내는 잣대", () => {
  it("칸글 — 파이프를 이스케이프하고 공백을 접는다", () => {
    expect(칸글(" a\n b ")).toBe("a b");
    expect(칸글("a|b")).toBe("a\\|b");
  });

  it("파이프표 — 한 표의 모든 행을 같은 열 수로 낸다", () => {
    expect(파이프표([["가", "나"], ["1", "2"]])).toBe("| 가 | 나 |\n| --- | --- |\n| 1 | 2 |");
    expect(파이프표([["", ""]]), "글자가 없는 표는 지식이 아니다").toBe("");
    expect(파이프표([])).toBe("");
  });

  it("★ 내고 → 읽기가 맞물린다 — 낸 표의 모든 본문 행이 표본문행자리로 보호된다", () => {
    const 줄들 = 파이프표([["항목", "값"], ["Patch|A", "1"]].map((r) => r.map(칸글))).split("\n");
    expect(표본문행자리(줄들)).toEqual([false, false, true]);
    expect(칸가르기(줄들[2])).toEqual(["Patch|A", "1"]);
  });

  it("표_최대열은 한 곳이다 — 두 번째 상한을 만들지 않는다", () => {
    expect(표_최대열).toBe(512);
    // 640열을 달라고 해도 상한에서 멈춘다(머리글 줄의 파이프 = 열 수 + 1).
    const 머리 = 파이프표([Array.from({ length: 640 }, () => "x")]).split("\n")[0];
    expect((머리.match(/\|/g) ?? []).length - 1).toBe(표_최대열);
  });
});

// ── ④ 살아 있는 결함 3종 — inspection 내보내기가 같은 잣대를 쓴다 ────────────────────
describe("★★ 점검보고서 내보내기가 표를 같은 잣대로 읽는다", () => {
  it("ㄱ 칸 안 파이프(`\\|`)가 칸을 늘리지 않는다 — 추출기 칸글()이 실제로 내는 꼴이다", () => {
    const html = inspectionHtml("| 항목 | 값 |\n|---|---|\n| a\\|b | 1 |");
    const 행 = /<tr>(?:(?!<\/tr>).)*a\|b(?:(?!<\/tr>).)*<\/tr>/.exec(html);
    expect(행, "역슬래시가 남았거나 칸이 갈렸다").toBeTruthy();
    expect((행![0].match(/<td>/g) ?? []).length, "머리글보다 칸이 많아졌다").toBe(2);
    expect(html, "이스케이프 역슬래시가 사용자 문서에 그대로 찍힌다").not.toContain("a\\|b");
  });

  it("ㄴ 정렬 구분선(`|:---|---:|`)이 표에 찍히지 않는다 — LLM 초안에 가장 흔한 꼴이다", () => {
    const html = inspectionHtml("| 항목 | 값 |\n|:---|---:|\n| 가 | 1 |");
    expect(html, "구분선을 못 알아봐 `:---`가 Word/PDF에 그대로 나간다").not.toContain(":---");
    expect((html.match(/<tr>/g) ?? []).length, "머리글+본문 두 행이어야 한다").toBe(2);
  });

  it("ㄷ 대시만 든 본문 행(`| - | - |`)을 버리지 않는다 — 내보내기 데이터 손실이다", () => {
    const html = inspectionHtml("| 항목 | 값 |\n|---|---|\n| - | - |\n| 가 | 1 |");
    expect((html.match(/<tr>/g) ?? []).length, "「해당 없음」을 대시로 적은 행이 사라진다").toBe(3);
  });

  it("ㄹ 들여쓴 표행도 표로 읽는다 — 목록 안에 넣은 표가 문단으로 떨어지지 않는다", () => {
    const html = inspectionHtml("  | 항목 | 값 |\n  |---|---|\n  | 가 | 1 |");
    expect(html).toContain("<table");
    expect((html.match(/<tr>/g) ?? []).length).toBe(2);
  });

  it("표가 없는 글은 종전 그대로다 — 넓히기만 하고 안 조인다", () => {
    const html = inspectionHtml("# 제목\n\n- 항목\n\n> 경고");
    expect(html).toContain("<h1>제목</h1>");
    expect(html).not.toContain("<table");
  });

  it("DOCX도 같은 잣대다 — 브라우저 없이(에어갭) 나오는 길이 PDF와 안 갈린다", async () => {
    await expect(inspectionDocx("| 항목 | 값 |\n|:---|---:|\n| a\\|b | - |")).resolves.toBeInstanceOf(Buffer);
  });
});

// ── ⑤ 사본 감시 — server/src 어디에도 표 술어 사본이 다시 생기지 않는다 ────────────────
//   ★ 감시자를 **함수로 빼서 아래에서 반증한다**(opssimrules.test:313-328 방식). 옛 사고: 감시
//     정규식 자신이 무너져 「영원히 초록」이었다. 감시자를 안 재면 이 초록이 거짓이 된다.
const 표줄사본이있나 = (s: string) => /trimStart\(\)\s*\.\s*startsWith\(\s*["'`]\|["'`]\s*\)/.test(s);
const 구분선사본이있나 = (s: string) => s.includes(":?-{2,}:?");
const 열수사본이있나 = (s: string) => /match\(\s*\/\\\|\/g\s*\)\s*\?\.\s*length/.test(s);
const 칸가르기사본이있나 = (s: string) => /split\(\s*\/\(\?<!\\\\\)\\\|\/\s*\)/.test(s);

describe("★★ 표 술어 사본 감시 (server/src)", () => {
  /** server/src 아래 .ts 전부 — tabletext.ts 자신만 뺀다(거기가 원본이다). */
  function 소스들(): { 경로: string; 글: string }[] {
    const out: { 경로: string; 글: string }[] = [];
    const 훑기 = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) 훑기(p);
        else if (e.name.endsWith(".ts") && e.name !== "tabletext.ts") out.push({ 경로: p, 글: fs.readFileSync(p, "utf8") });
      }
    };
    훑기(path.resolve("src"));
    return out;
  }

  it("표줄·구분선·열수·칸가르기 사본이 server/src에 다시 생기지 않았다", () => {
    const 걸린 = 소스들().flatMap(({ 경로, 글 }) => [
      표줄사본이있나(글) && `${경로}: 표줄`,
      구분선사본이있나(글) && `${경로}: 구분선`,
      열수사본이있나(글) && `${경로}: 열수`,
      칸가르기사본이있나(글) && `${경로}: 칸가르기`,
    ].filter(Boolean));
    expect(걸린,
      `표 술어 사본이 생겼다 — engine/tabletext.ts에서 import해라.\n  ${걸린.join("\n  ")}`).toEqual([]);
  });

  it("★ 반증 — 감시자가 **심어 놓은 사본을 실제로 잡는다**(못 잡으면 위 초록은 거짓이다)", () => {
    expect(표줄사본이있나('const 표줄 = (l: string) => l.trimStart().startsWith("|");'), "표줄 사본을 못 잡는다").toBe(true);
    expect(표줄사본이있나("const t = (l) => l.trimStart().startsWith('|');"), "홑따옴표 사본을 못 잡는다").toBe(true);
    expect(구분선사본이있나("const 구분선 = (l) => /^\\s*\\|(?:\\s*:?-{2,}:?\\s*\\|)+\\s*$/.test(l);"), "구분선 사본을 못 잡는다").toBe(true);
    expect(열수사본이있나("const 열수 = (l) => (l.replace(/\\\\\\|/g, \"\").match(/\\|/g)?.length ?? 0) - 1;"), "열수 사본을 못 잡는다").toBe(true);
    expect(칸가르기사본이있나('return t.split(/(?<!\\\\)\\|/).map((c) => c.trim());'), "칸가르기 사본을 못 잡는다").toBe(true);
    // 애먼 글자에 안 샌다 — 주석에 이름으로 나오는 것까지 막지는 않는다.
    expect(표줄사본이있나("// 표줄·구분선은 tabletext 한 곳이다"), "따옴표 없는 언급까지 잡는다").toBe(false);
    expect(구분선사본이있나("/** 구분선 — |---|---| · |:---|---:| 꼴 */"), "주석의 표 그림까지 잡는다").toBe(false);
  });

  it("감시 범위는 server/src뿐이다 — test는 일부러 사본을 둔다(제품 잣대를 안 부르는 하네스)", () => {
    // tablechunk.test:47-49 · tableextract.test:47 · pdftableextract.test:52가 그 자리다.
    // 그 사본들까지 잡으면 「제품이 자기 잣대로 자기를 재는」 헛통과가 되므로 범위를 넓히지 않는다.
    expect(소스들().every(({ 경로 }) => !경로.includes(`${path.sep}test${path.sep}`))).toBe(true);
  });
});
