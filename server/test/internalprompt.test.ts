// 내부 프롬프트가 가드레일에 걸려 **제품이 자기 자신을 막는** 사고를 막는다.
//
// ■ 2026-07-30 실사고
//   가드레일 기본값을 차단(block)으로 올린 뒤 도구 결정이 0/4로 죽었다. 원인은 규칙이 아니라
//   **검사 대상**이었다 — agentloop의 결정 호출이 `trusted`를 켜지 않아, 도구 카탈로그가 실린
//   우리 결정 프롬프트가 "사용자 입력"으로 검사됐다. 그 카탈로그에는 보안 제품이라면 당연히
//   들어가는 낱말("탈옥", "프롬프트 인젝션")이 있어 jailbreak 규칙에 걸렸다.
//   flag 모드에서는 로그만 쌓여 아무도 몰랐고, 차단으로 바꾸자 제품이 죽었다(A/B/A로 확인).
//
// ■ 그래서 무엇을 시험하나
//   ① 도구 카탈로그는 앞으로도 규칙에 걸릴 것이다 — 보안 도메인이라 그 낱말을 써야 한다.
//      그 사실을 시험으로 **기록**해 둔다. "우연히 안 걸리는 상태"에 기대지 않는다.
//   ② 그러므로 내부 프롬프트를 만드는 호출은 **반드시 trusted**여야 한다. agentloop의 chat
//      호출을 소스에서 직접 확인한다 — 주석·커밋으로 약속하고 코드가 안 지키는 유형은
//      동작 시험으로 잡히지 않는다(flag 모드에서는 증상이 없다).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { detectInjectionAttempt } from "../src/engine/redteam";
import { listToolsFor } from "../src/engine/agenttools";

function catalogText(): string {
  return listToolsFor(undefined, "admin")
    .map((t) => `- ${t.name}: ${t.description ?? ""}`)
    .join("\n");
}

describe("도구 카탈로그와 가드레일", () => {
  it("카탈로그에는 보안 낱말이 들어 있어 규칙에 걸린다 — 이 사실을 전제로 설계해야 한다", () => {
    const d = detectInjectionAttempt(catalogText());
    // 여기가 false로 바뀌었다면 "지금은 우연히 안 걸린다"는 뜻일 뿐이다. 낱말 하나만 추가되면
    // 다시 걸리므로, 내부 프롬프트를 검사 대상에서 빼는 설계(trusted)를 그대로 유지해야 한다.
    expect(d.flagged).toBe(true);
    expect(d.categories).toContain("jailbreak");
  });

  it("걸리는 도구 설명을 지워서 해결하지 않는다 — 보안 제품은 그 말을 써야 한다", () => {
    const tools = listToolsFor(undefined, "admin");
    const redteam = tools.find((t) => t.name === "run_redteam");
    expect(redteam, "run_redteam 도구가 사라졌다").toBeTruthy();
    // 레드팀 도구는 자기 일을 정확히 설명해야 한다. 규칙에 걸린다고 설명을 뭉개면
    // 담당자가 그 도구를 못 찾고 라우팅도 흔들린다.
    expect(redteam!.description ?? "").toMatch(/인젝션|탈옥/);
  });
});

describe("내부 프롬프트는 게이트를 다시 지나지 않는다", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");

  it("agentloop의 모든 chat 호출은 trusted를 명시한다", () => {
    // chat({ … }) 블록을 대괄호 균형으로 잘라 각 호출을 본다.
    const calls: string[] = [];
    let idx = 0;
    while ((idx = src.indexOf("chat({", idx)) !== -1 && idx >= 0) {
      let depth = 0;
      let end = idx + "chat(".length;
      for (; end < src.length; end++) {
        if (src[end] === "{") depth++;
        else if (src[end] === "}") { depth--; if (depth === 0) break; }
      }
      calls.push(src.slice(idx, end + 1));
      idx = end;
    }
    expect(calls.length, "agentloop에서 chat 호출을 찾지 못했다(시험이 낡았다)").toBeGreaterThan(0);
    const 누락 = calls.filter((c) => !/trusted:\s*true/.test(c));
    expect(
      누락.map((c) => c.slice(0, 90)),
      "trusted 없이 chat을 부르면 우리 프롬프트가 사용자 입력으로 검사된다 — 차단 모드에서 제품이 자기 자신을 막는다"
    ).toEqual([]);
  });

  it("dispatcher가 사용자 지시를 먼저 검사한다 — trusted의 전제", () => {
    const d = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    // 내부 재진입을 trusted로 넘기는 근거는 "사용자 입력은 이미 관문을 지났다"는 것이다.
    // 그 전제가 사라지면 trusted가 곧 우회 구멍이 된다.
    expect(d).toMatch(/gateUserInput\(\s*instructionText\s*,\s*"dispatch"\s*\)/);
  });
});
