// 에디션별 도구 허용목록 — 라이트가 쓸 자리(2026-08-12, max 요청 ①).
//
// ⚠ 이 장치는 **VRAM을 줄이지 않는다.** llama.cpp는 KV 캐시를 --ctx-size만큼 미리 잡아서
//   프롬프트 길이는 잡히는 메모리와 무관하다. 얻는 것은 처리 속도와 ctx 안의 여유다.
//   (「프롬프트 91% 감소가 8GB의 근거」라는 서술은 성립하지 않는다 — 2026-08-12 확인.)
import { describe, it, expect, afterEach } from "vitest";
import { listToolsFor, listAgentTools, findAgentTool, setToolAllowlist, isToolAllowed } from "../src/engine/agenttools/registry";

afterEach(() => setToolAllowlist(null)); // 다른 시험에 새지 않게 반드시 되돌린다

describe("도구 허용목록", () => {
  it("설정 전에는 아무것도 안 거른다(종전 동작)", () => {
    const 전체 = listToolsFor().length;
    expect(전체).toBeGreaterThan(20);
    expect(isToolAllowed("today")).toBe(true);
  });

  it("허용목록을 걸면 카탈로그가 그 목록으로 줄어든다", () => {
    setToolAllowlist(["today", "explain"]);
    const 이름들 = listToolsFor().map((t) => t.name);
    expect(이름들).toContain("today");
    expect(이름들).toContain("explain");
    expect(이름들.length).toBe(2);
  });

  it("★ 모르는 이름은 조용히 넘기지 않고 던진다", () => {
    // 오타 하나로 도구가 사라지면 「그 기능이 원래 없나 보다」로 읽힌다 —
    // 오늘 라우팅 결함이 정확히 그렇게 오래 남았다.
    expect(() => setToolAllowlist(["today", "존재하지않는도구"])).toThrow(/존재하지않는도구/);
  });

  it("★ findAgentTool은 안 거른다 — 강제 의도가 이름으로 직접 부른다", () => {
    // 여기까지 막으면 결정 분기가 조용히 죽는다. 실행까지 막아야 하면 isToolAllowed를 그 자리에서 쓴다.
    setToolAllowlist(["today"]);
    expect(findAgentTool("explain")).toBeDefined();
    expect(isToolAllowed("explain")).toBe(false);
  });

  it("null로 되돌리면 전체가 돌아온다", () => {
    const 전체 = listAgentTools().length;
    setToolAllowlist(["today"]);
    expect(listToolsFor().length).toBe(1);
    setToolAllowlist(null);
    expect(listToolsFor().length).toBeLessThanOrEqual(전체);
    expect(listToolsFor().length).toBeGreaterThan(1);
  });
});
