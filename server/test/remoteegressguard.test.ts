// 원격 LLM으로 나가는 **모든** 호출이 방어 둘을 거는지 전수 대조한다. (보안 경계 · 계획서 후-4 이웃)
//
// ⚠ 실결함 (2026-08-18 조사에서 발견):
//   `llm.ts`의 본 호출에는 원격 방어가 둘 다 있었다 —
//     · `...원격헤더` : 접속 토큰(x-gijo-serve-token)
//     · `redirect: 원격 ? "error" : "follow"` : *"VPN 안 서버가 3xx로 밖을 가리키면 질문 본문이 따라간다"*
//   그런데 **드리프트 재생성 경로에만 둘 다 빠져 있었다.** 같은 곳으로 같은 질문을 다시 보내는
//   자리인데 방어가 달랐다. 결과:
//     · 토큰이 없어 원격이 **401로 거절** → `.catch(() => null)`이 삼켜 원래 답이 그대로 나간다.
//       담당자는 재생성이 실패했다는 것조차 모른다.
//     · 리다이렉트 금지가 없어 **질문 본문이 밖으로 따라 나갈 수 있다.** 온프렘 제품에서
//       이건 기능 결함이 아니라 **유출 경로**다.
//
// ⚠ 왜 시험으로 묶나 — 이 부류가 세 번째다(「정상 경로엔 있는데 곁가지에만 빠진다」):
//   ① approvals의 목록 지우는 자리가 둘인데 한 곳만 막음
//   ② 조합 가드가 titlebar엔 있는데 주 대화창엔 없음
//   ③ 이번 원격 방어
//   사람 눈으로는 「본 호출을 고쳤으니 됐다」로 끝난다. 곁가지는 안 보인다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ⚠⚠ **파일 목록을 손으로 적지 않는다**(2026-08-18 검토 지적). 처음엔 `llm.ts` 하나만 읽었는데,
//   `searchrewrite.ts`가 같은 원격 통로로 `/chat/completions`를 부르면서 리다이렉트 금지가
//   빠져 있었다 — 「본 호출엔 있고 곁가지엔 없다」를 잡으려고 만든 시험이 **검사 대상을 손으로
//   적어 둔 탓에** 그 곁가지를 못 봤다. `airgap.test.ts`가 2026-08-05에 밟은 것과 같은 모양이다.
//   ⇒ engine 전체를 훑어 **원격으로 갈 수 있는 호출을 스스로 찾는다.**
const ENGINE_DIR = new URL("../src/engine/", import.meta.url);
function 엔진소스(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  const 훑기 = (dir: URL, prefix = "") => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) 훑기(new URL(e.name + "/", dir), prefix + e.name + "/");
      else if (e.name.endsWith(".ts")) out.push({ file: prefix + e.name, src: fs.readFileSync(new URL(e.name, dir), "utf8") });
    }
  };
  훑기(ENGINE_DIR);
  return out;
}
const src = fs.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");

/** `fetch(...)` 호출 하나를 통째로 집어 낸다(괄호 균형으로 끝을 찾는다). */
function fetch호출들(s: string): { 시작: number; 본문: string }[] {
  const out: { 시작: number; 본문: string }[] = [];
  const re = /await fetch\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length - 1; // '(' 위치
    let 깊이 = 0;
    for (; i < s.length; i++) {
      if (s[i] === "(") 깊이++;
      else if (s[i] === ")") {
        깊이--;
        if (깊이 === 0) break;
      }
    }
    out.push({ 시작: m.index, 본문: s.slice(m.index, i + 1) });
  }
  return out;
}

describe("원격 LLM 호출은 어디서든 방어 둘을 건다", () => {
  const 호출 = fetch호출들(src);
  // 원격으로 갈 수 있는 것 = baseUrl로 /chat/completions를 부르는 것.
  const 채팅호출 = 호출.filter((c) => c.본문.includes("/chat/completions"));

  it("채팅 호출을 실제로 찾아 온다 — 못 찾으면 이 시험이 헛돈다", () => {
    // ⚠ 헛돎 방지. 정규식이 표기 변화를 놓치면 「위반 0건」으로 **거짓 통과**한다.
    expect(채팅호출.length, "llm.ts에서 /chat/completions 호출을 못 찾았다").toBeGreaterThanOrEqual(2);
    expect(src, "원격헤더라는 이름이 사라졌다 — 아래 검사의 근거가 바뀐 것이다").toContain("원격헤더");
  });

  it("★ 모든 채팅 호출이 접속 토큰(원격헤더)을 싣는다", () => {
    const 빠짐 = 채팅호출
      .map((c, i) => ({ i, 본문: c.본문 }))
      .filter((c) => !/\.\.\.원격헤더/.test(c.본문));
    expect(
      빠짐.map((c) => `#${c.i}: ${c.본문.replace(/\s+/g, " ").slice(0, 110)}`).join("\n"),
      "이 호출들은 원격 접속 토큰을 안 싣는다 — 원격이 401로 조용히 거절한다",
    ).toBe("");
  });

  it("★ 모든 채팅 호출이 원격일 때 리다이렉트를 막는다", () => {
    // 온프렘 제품에서 이건 유출 경로다 — VPN 안 서버가 3xx로 밖을 가리키면 질문이 따라간다.
    const 빠짐 = 채팅호출
      .map((c, i) => ({ i, 본문: c.본문 }))
      .filter((c) => !/redirect:\s*원격\s*\?\s*"error"/.test(c.본문));
    expect(
      빠짐.map((c) => `#${c.i}: ${c.본문.replace(/\s+/g, " ").slice(0, 110)}`).join("\n"),
      "이 호출들은 원격일 때 리다이렉트를 안 막는다 — 질문 본문이 밖으로 따라 나갈 수 있다",
    ).toBe("");
  });

  it("★ engine 전체에서 원격으로 갈 수 있는 호출을 찾아 방어를 대조한다", () => {
    // 「원격으로 갈 수 있는 호출」 = `/chat/completions`를 부르면서 `remoteLlmTarget()`을 쓰는 파일.
    const 후보 = 엔진소스().filter((f) => f.src.includes("/chat/completions") && f.src.includes("remoteLlmTarget"));
    expect(후보.length, "원격 채팅 호출이 있는 파일을 못 찾았다 — 이 검사가 헛돈다").toBeGreaterThanOrEqual(2);
    const 빠짐: string[] = [];
    for (const { file, src: s } of 후보) {
      for (const c of fetch호출들(s).filter((x) => x.본문.includes("/chat/completions"))) {
        if (!/redirect:\s*[^,}]*\?\s*"error"/.test(c.본문)) 빠짐.push(`${file}: ${c.본문.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
    expect(빠짐.join("\n"), "이 호출들은 원격일 때 리다이렉트를 안 막는다 — 질문 원문이 밖으로 따라 나갈 수 있다").toBe("");
  });

  it("깨지면 정말 빨간불이 나는가 — 검사기 자체 확인", () => {
    // 방어가 빠진 가짜 소스를 만들어 검사기가 잡는지 본다. 잡으면 위 두 검사를 믿을 수 있다.
    const 가짜 = `
      const a = await fetch(\`\${baseUrl}/chat/completions\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "local" }),
      });
    `;
    const c = fetch호출들(가짜).filter((x) => x.본문.includes("/chat/completions"));
    expect(c.length, "가짜 소스에서 호출을 못 찾았다 — 검사기가 고장 났다").toBe(1);
    expect(/\.\.\.원격헤더/.test(c[0].본문), "방어 없는 호출을 통과시킨다").toBe(false);
    expect(/redirect:\s*원격/.test(c[0].본문), "방어 없는 호출을 통과시킨다").toBe(false);
  });
});
