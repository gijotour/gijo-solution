// 화면 스크립트가 **파싱되는지** 전수로 본다. (2026-08-18 실사고)
//
// ⚠ 무엇이 있었나:
//   네이티브 확인 창(`confirm`)을 화면 안 대화상자(`await gijoAsk`)로 34곳 바꿨다.
//   `confirm`은 동기라 아무 데서나 쓸 수 있었는데 `gijoAsk`는 **비동기**다 —
//   감싸는 이벤트 처리기가 `async`가 아니면 **파일이 통째로 파싱 실패**한다.
//   실제로 `settings.html`의 모델 검색 결과 클릭 처리기(`(e) => {`)가 그랬다.
//
// ⚠ 왜 시험이 필요한가:
//   ⓐ 서버 시험 3,500개가 **화면 스크립트를 파싱하지 않는다** — 전부 초록이었다.
//   ⓑ 잡은 것은 `client/scripts/check-inline-scripts.mjs`인데 그건 **`npm run dist`(게시 빌드)에서만** 돈다.
//      즉 **게시 직전에야** 알게 된다. 그날 게시가 급하면 그때부터 원인을 찾아야 한다.
//   ⓒ 안 잡혔으면 개조본 경고(안전장치 제거 모델 다운로드 확인)가 **통째로 죽은 채** 나갔을 것이다.
//   ⇒ 같은 검사를 **평소 시험 게이트**에도 둔다. 27초짜리 전체 시험에서 바로 걸린다.
//
// ⚠ 이 시험은 `new Function()`으로 **문법만** 본다 — 실행하지 않는다.
//   window·document가 없어도 파싱은 된다(문법 오류만 잡는 것이 목적이다).
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);

interface 블록 { file: string; 시작: number; 코드: string }

function 화면스크립트들(): 블록[] {
  const out: 블록[] = [];
  for (const f of fs.readdirSync(pagesDir)) {
    if (!/\.(html|js)$/.test(f)) continue;
    const src = fs.readFileSync(new URL(f, pagesDir), "utf8");
    if (f.endsWith(".js")) {
      out.push({ file: f, 시작: 1, 코드: src });
      continue;
    }
    // html — 인라인 <script> 블록만 (src= 로 부르는 것은 위에서 .js로 따로 본다)
    const L = src.split(/\r?\n/);
    let 안 = false, 시작 = 0, 모음: string[] = [];
    L.forEach((l, i) => {
      if (!안 && /<script(?![^>]*\bsrc=)/.test(l)) { 안 = true; 시작 = i + 2; 모음 = []; return; }
      if (안 && /<\/script>/.test(l)) { out.push({ file: f, 시작, 코드: 모음.join("\n") }); 안 = false; return; }
      if (안) 모음.push(l);
    });
  }
  return out;
}

describe("화면 스크립트가 전부 파싱된다", () => {
  const 블록들 = 화면스크립트들().filter((b) => b.코드.trim());

  it("블록을 실제로 찾아 온다 — 못 찾으면 이 시험이 헛돈다", () => {
    // 헛돎 방지. `<script>` 표기가 바뀌어 0개가 되면 「전부 통과」로 **거짓 통과**한다.
    expect(블록들.length, "화면 스크립트 블록을 하나도 못 찾았다").toBeGreaterThan(30);
    expect(블록들.some((b) => b.file === "settings.html"), "settings.html을 못 읽었다").toBe(true);
    expect(블록들.some((b) => b.file === "console.js"), "console.js를 못 읽었다").toBe(true);
  });

  it("★ 문법 오류가 하나도 없다", () => {
    const 깨진: string[] = [];
    for (const b of 블록들) {
      try {
        new Function(b.코드);
      } catch (e) {
        깨진.push(`${b.file} (script ${b.시작}행부터): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(
      깨진.join("\n"),
      "화면 스크립트가 파싱되지 않는다 — 그 화면은 통째로 죽는다(버튼이 아니라 화면 전체다)",
    ).toBe("");
  });

  it("★ 비동기 확인창(gijoAsk/gijoPrompt)을 쓰는 곳은 await를 붙였다", () => {
    // ⚠ `gijoAsk`는 **Promise를 돌려준다.** `await` 없이 `if (!gijoAsk(...))`로 쓰면
    //   Promise는 언제나 참이라 **확인 없이 그대로 진행**한다 — 확인창을 없앤 것과 같다.
    //   파싱은 통과하므로 위 검사가 못 잡는다. 그래서 따로 본다.
    // ⚠ **결과를 쓰는 자리만** 본다. 알림용으로 부르고 값을 안 쓰는 곳은 문제가 아니다
    //   (그런 곳은 gijoTell이 맞지만, 그건 뜻의 문제이지 「확인이 건너뛰어지는」 결함이 아니다).
    //   처음엔 모든 호출을 잡아 **거짓 경보**가 났다 — 잡을 것을 정확히 좁힌다.
    //   결과를 쓰는 모양: `if (…gijoAsk(` · `!gijoAsk(` · `= gijoAsk(` · `&&`/`||` 뒤.
    const 결과씀 = /(if\s*\(|!\s*|=\s*|&&\s*|\|\|\s*)\(?\s*gijo(Ask|Prompt)\s*\(/;
    const 위반: string[] = [];
    for (const b of 블록들) {
      b.코드.split("\n").forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        if (!결과씀.test(l)) return;
        // 같은 줄 어딘가에 await가 있으면 통과(형태가 여러 가지다: `!await f()` · `!(await f())`)
        if (!/await/.test(l)) 위반.push(`${b.file}:${b.시작 + i}  ${l.trim().slice(0, 90)}`);
      });
    }
    expect(
      위반.join("\n"),
      "await 없이 gijoAsk/gijoPrompt를 쓴다 — Promise는 늘 참이라 **확인 없이 실행**된다",
    ).toBe("");
  });

  it("깨지면 정말 빨간불이 나는가 — 검사기 자체 확인", () => {
    // 실제로 밟은 모양: 비동기 확인창을 동기 처리기 안에서 쓴 것.
    const 나쁜예 = 'el.addEventListener("click", (e) => { if (!(await gijoAsk("x"))) return; });';
    expect(() => new Function(나쁜예), "파싱 검사기가 이 오류를 못 잡는다").toThrow();
    const 좋은예 = 'el.addEventListener("click", async (e) => { if (!(await gijoAsk("x"))) return; });';
    expect(() => new Function(좋은예), "정상 코드를 잡으면 안 된다").not.toThrow();
  });
});
