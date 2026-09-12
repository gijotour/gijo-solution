// 소스 감시 — forcedToolFor의 **배열 밖 분기**가 조회 도구를 쓰기 흐름에 삼키지 않는가
// (2026-09-12 B10 수리 · 계획서 전-4/중-3).
//
// ■ 왜 소스를 글자로 보나 — 「세 번째면 소스 감시」(CLAUDE.md)
//   같은 구멍이 **세 라운드에 걸쳐 이관**됐다: B5(2026-09-11 explain을 Set에 더함) →
//   B7(비교개념질문 한 곳에만 잣대를 걺) → B10(나머지 넷) → 그리고 이번 검토관이 **또 넷**을
//   찾았다(제품 설명·CVE·유지보수 절차·문서 소재)와 상태어취약점. 뿌리는 늘 같다:
//   `조회로못박지않을것` Set 검사는 **FORCED_INTENTS 루프 안 한 줄**에서만 돌아서,
//   배열 밖에 새 분기를 손으로 적는 사람은 그 가드를 **안 부른 줄도 모른다**.
//   문장 시험은 이것을 원리상 못 잡는다 — 새 분기를 만든 사람이 그 문장을 시험에 안 적으면
//   아무도 모른다(실측: B10 첫 판의 시험 19문장에 넷 중 한 문장도 없었다).
//
// ■ 무엇을 재나: forcedToolFor 본문에서 `available.has("<조회 도구>")`로 시작하는 분기 줄에
//   `쓰기흐름인가`가 함께 있는가. 도구 목록은 **제품 상수를 그대로 읽는다**(베끼지 않는다 —
//   Set에 도구가 늘면 이 시험도 같이 넓어진다).
// ■ 예외는 **이유를 적어야** 통과한다(아래 예외표) — 이유 없는 예외는 빨간불이다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 소스경로 = path.join(__dirname, "../src/engine/agentloop.ts");
const 소스 = fs.readFileSync(소스경로, "utf8").split(/\r?\n/);

/** 예외 — 「이 분기는 잣대를 안 태워도 된다」는 자리. **이유 없이 넣지 말 것.** */
const 예외: { 표시: string; 이유: string }[] = [];

function 본문범위(): [number, number] {
  const 시작 = 소스.findIndex((l) => l.startsWith("export function forcedToolFor"));
  expect(시작, "forcedToolFor를 못 찾았다 — 함수 이름이 바뀌었으면 이 시험도 함께 고친다").toBeGreaterThan(0);
  let 끝 = -1;
  for (let i = 시작 + 1; i < 소스.length; i++) if (/^\}\s*$/.test(소스[i])) { 끝 = i; break; }
  expect(끝, "forcedToolFor의 닫는 괄호를 못 찾았다").toBeGreaterThan(시작);
  return [시작, 끝];
}

/** 제품 상수를 **글자 그대로** 읽는다 — 도구 목록을 시험에 베끼면 어긋난다(단일 출처). */
function 조회도구목록(): string[] {
  const 줄 = 소스.find((l) => l.startsWith("const 조회로못박지않을것 = new Set("));
  expect(줄, "조회로못박지않을것 Set 선언을 못 찾았다").toBeTruthy();
  return [...(줄 as string).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("★ 소스 감시 — 배열 밖 분기는 전부 writeflow.쓰기흐름인가를 지난다", () => {
  it("조회 도구를 돌려주는 분기 줄에 잣대가 빠진 곳이 없다", () => {
    const [시작, 끝] = 본문범위();
    const 도구들 = 조회도구목록();
    expect(도구들.length, "Set이 비었다 — 읽기에 실패했다").toBeGreaterThan(3);
    const 빠진곳: string[] = [];
    for (let i = 시작; i <= 끝; i++) {
      const l = 소스[i];
      if (!/available\.has\("/.test(l)) continue;
      const 이줄도구 = [...l.matchAll(/available\.has\("([a-z_]+)"\)/g)].map((m) => m[1]).filter((t) => 도구들.includes(t));
      if (!이줄도구.length) continue;
      if (l.includes("쓰기흐름인가")) continue;
      const 표시 = `${i + 1}: ${l.trim().slice(0, 80)}`;
      if (예외.some((e) => 표시.includes(e.표시))) continue;
      빠진곳.push(`agentloop.ts:${i + 1} [${이줄도구.join(",")}] ${l.trim().slice(0, 90)}`);
    }
    expect(
      빠진곳,
      "배열 밖에서 조회 도구로 못 박는 분기에 `!쓰기흐름인가(instruction)`가 없다 —\n" +
        "  그 문장은 도구 하나를 부르고 끝나므로 「…알려주고 승인해줘/배정해줘」가 **영영 안 간다**.\n" +
        "  고칠 곳:\n    " + 빠진곳.join("\n    "),
    ).toEqual([]);
  });

  it("실제로 지키고 있는 분기가 열 곳 이상이다(감시가 아무것도 안 보고 초록이 되는 것을 막는다)", () => {
    const [시작, 끝] = 본문범위();
    const 도구들 = 조회도구목록();
    let 셈 = 0;
    for (let i = 시작; i <= 끝; i++) {
      const l = 소스[i];
      if (!l.includes("쓰기흐름인가")) continue;
      if ([...l.matchAll(/available\.has\("([a-z_]+)"\)/g)].some((m) => 도구들.includes(m[1]))) 셈++;
    }
    expect(셈, "가드가 걸린 분기 수 — 줄었으면 누가 가드를 뗀 것이다").toBeGreaterThanOrEqual(10);
  });

  it("FORCED 루프 안의 Set 검사 한 줄이 그대로 있다(배열 안쪽 방어)", () => {
    const [시작, 끝] = 본문범위();
    const 있나 = 소스.slice(시작, 끝 + 1).some((l) => l.includes("조회로못박지않을것.has(f.tool)") && l.includes("쓰기흐름인가"));
    expect(있나, "FORCED_INTENTS 루프의 가드가 사라졌다 — 배열 안 규칙 전부가 쓰기 흐름을 삼킨다").toBe(true);
  });

  it("picklist(dispatcher 특수경로 [14])도 같은 함수를 부른다 — 잣대는 한 곳뿐이다", () => {
    const pl = fs.readFileSync(path.join(__dirname, "../src/engine/picklist.ts"), "utf8");
    expect(pl.includes('from "./writeflow"'), "picklist가 잣대를 자기 낱말 목록으로 되돌렸다").toBe(true);
    expect(/isFindingListAsk[\s\S]{0,600}쓰기흐름인가\(/.test(pl), "isFindingListAsk 입구의 가드가 사라졌다").toBe(true);
  });

  // ★★ 네 번째 이관(B12, 2026-09-12) — 층이 dispatcher/agentloop/picklist가 아니라
  //   **screenguide.isHelpIntent**다. 화면 안내가 [22]에서 강제 도구보다 먼저 채 가므로
  //   같은 구멍(「…알려주고 승인해줘」가 한 수로 끝난다)이 이 층에도 그대로 났었다.
  // ⚠ 이 층만은 **뒷가지**(쓰기명령꼴인가 = 문장 끝 명령꼴)를 부른다. 앞가지(isAssign)는 문장
  //   끝 고정이 아니라 「배정」 낱말만 있으면 참이라, 안내 층에 그대로 걸었더니 시키는 말이
  //   아닌 **사용법 물음**까지 죽었다(실측 대조쌍: 「배정 도움말」⑨ ↔ 「승인 도움말」[22] ·
  //   「배정 사용법 알려줘」⑨ ↔ 「일괄 처리 사용법 알려줘」[22] — 2026-09-12 검토관 [상]).
  //   삼킴을 막는 데는 뒷가지면 충분하다(삼켜서 문제가 된 말은 전부 문장 끝 명령꼴이다).
  it("screenguide.isHelpIntent도 같은 잣대를 부른다 — 소스 감시", () => {
    const sg = fs.readFileSync(path.join(__dirname, "../src/engine/screenguide.ts"), "utf8").split(/\r?\n/);
    const 전문 = sg.join("\n");
    expect(전문.includes('from "./writeflow"'), "screenguide.ts가 writeflow의 잣대를 안 부른다").toBe(true);
    const 시작 = sg.findIndex((l) => l.startsWith("export function isHelpIntent"));
    expect(시작, "isHelpIntent를 못 찾았다 — 함수 이름이 바뀌었으면 이 시험도 함께 고친다").toBeGreaterThan(0);
    let 끝 = -1;
    for (let i = 시작 + 1; i < sg.length; i++) if (/^\}\s*$/.test(sg[i])) { 끝 = i; break; }
    expect(끝, "isHelpIntent의 닫는 괄호를 못 찾았다").toBeGreaterThan(시작);
    // ⚠ **주석을 떼고 잰다** — 이 파일의 주석에는 두 이름이 설명으로 등장한다(실측: 안 떼면
    //   「안 부른다」를 확인할 수 없어 아래 둘째 단언이 언제나 빨갛다). 재는 것은 **코드**다.
    const 몸통 = sg.slice(시작, 끝 + 1)
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(몸통.includes("쓰기명령꼴인가("), "isHelpIntent 본문에 쓰기 명령 가드가 사라졌다").toBe(true);
    expect(몸통.includes("쓰기흐름인가("), "안내 층에 넓은 앞가지(isAssign 포함)를 다시 걸었다 — 배정 사용법 물음이 죽는다").toBe(false);
  });

  // ★ 잣대의 낱말은 **한 곳**에만 적혀 있다 — 쓰기흐름인가도 쓰기명령꼴인가를 부른다.
  it("writeflow의 두 이름이 같은 정규식 하나를 쓴다(베낀 사본 0)", () => {
    const wf = fs.readFileSync(path.join(__dirname, "../src/engine/writeflow.ts"), "utf8");
    expect(/export function 쓰기명령꼴인가/.test(wf), "쓰기명령꼴인가가 없다").toBe(true);
    expect(/return isAssign \|\| 쓰기명령꼴인가\(instruction\);/.test(wf), "쓰기흐름인가가 정규식을 따로 베껴 적었다").toBe(true);
  });
});
