// 팀원별 두뇌 위치가 **화면부터 실제 호출까지** 끊기지 않고 이어졌는지 본다.
// (사장님 지시 2026-08-18: "여러 개의 두뇌가 공동작업을 하는 게 목적")
//
// ⚠ 이 배관도 여러 칸을 지난다 — 화면 → preload → api → 라우트 → 저장 → `llm.ts` 판정.
//   한 칸만 빠지면 **아무 오류 없이 조용히 죽는다**: 눌러도 저장이 안 되거나, 저장은 되는데
//   실제 호출이 안 갈린다. 오늘 이미 같은 부류(보는목록 배관)가 통째로 죽어 있던 것을 겪었다.
//
// ⚠ 무엇을 푸는가: 로컬 모델은 이미 팀원별로 갈리는데(`localengine.ts ensureAgentModel`)
//   **원격은 전역 on/off 하나**였다. 켜면 전원 원격, 끄면 전원 로컬 — 그래서
//   「총괄은 로컬 빠른 두뇌로 판단, 분석가는 원격 큰 두뇌로 깊게」가 불가능했다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { db } from "../src/db";
import { getAgentLocation, setAgentLocation, listAgents } from "../src/engine/agents";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

beforeEach(() => {
  db.prepare("DELETE FROM app_state WHERE key LIKE 'agentLocation:%'").run();
});

describe("팀원별 두뇌 위치 — 저장·규칙", () => {
  it("기본은 비어 있다 = 전역을 따른다 (무변경 보장)", () => {
    // ⚠ 이게 깨지면 **아무것도 안 고른 고객의 동작이 바뀐다.** 가장 중요한 기본값이다.
    for (const a of listAgents()) expect(getAgentLocation(a.id), `${a.id}의 기본이 비어 있지 않다`).toBe(null);
  });

  it("local·remote를 저장하고 되읽는다", () => {
    setAgentLocation("analysis", "remote");
    expect(getAgentLocation("analysis")).toBe("remote");
    setAgentLocation("analysis", "local");
    expect(getAgentLocation("analysis")).toBe("local");
    setAgentLocation("analysis", null);
    expect(getAgentLocation("analysis"), "null이면 해제(전역 따름)여야 한다").toBe(null);
  });

  it("★ 총괄은 이 PC 고정 — 원격을 못 붙인다", () => {
    // ⚠ 근거는 실측이다(2026-08-18 gb10): 같은 질문에 14B 17.4초 / 32B 36.6초 / **72B 89~90초**.
    //   총괄은 지시마다 도구를 고르는 짧고 잦은 판단을 하고 그 앞에서 담당자가 기다린다.
    //   어댑터 금지(`agents.ts` setAgentAdapter)와 같은 자리·같은 모양이다.
    expect(() => setAgentLocation("orchestrator", "remote")).toThrow(/이 PC에서만/);
    expect(getAgentLocation("orchestrator"), "던지고도 저장됐으면 소용없다").toBe(null);
    // 이 PC로 명시하는 것은 된다(뜻이 같으므로).
    expect(() => setAgentLocation("orchestrator", "local")).not.toThrow();
  });

  it("모르는 값·없는 팀원은 거부한다", () => {
    // ⚠ "cloud"는 **아직 안 받는다** — cloudllm이 agentId를 안 받아 저장해도 라우팅이 안 된다.
    //   저장만 되면 「설계는 됐는데 쓰인 적 없는 값」이 된다.
    expect(() => setAgentLocation("analysis", "cloud" as never)).toThrow(/local·remote/);
    expect(() => setAgentLocation("없는팀원", "local")).toThrow(/존재하지 않는/);
  });

  it("목록 응답에 위치가 실린다 — 안 실리면 화면이 늘 「전역 따름」으로 보인다", () => {
    setAgentLocation("report", "remote");
    const a = listAgents().find((x) => x.id === "report")!;
    expect(a.assignedLocation, "서버가 위치를 안 돌려준다 — 고른 것이 화면에 안 남는다").toBe("remote");
  });
});

describe("팀원별 두뇌 위치 — 배관이 끝까지 이어졌다", () => {
  it("① 실제 호출이 갈린다 (llm.ts가 위치를 본다)", () => {
    const s = 읽기("../src/engine/llm.ts");
    expect(s, "llm.ts가 팀원 위치를 안 읽는다 — 저장만 되고 호출은 안 갈린다").toContain("getAgentLocation");
    // "local"이면 전역 원격을 **타지 않아야** 한다.
    expect(s, "local일 때 원격을 건너뛰는 갈래가 없다").toMatch(/팀원위치 === "local"/);
  });

  it("② 라우트가 있고 admin 전용이다", () => {
    const s = 읽기("../src/engine/agents.ts");
    const i = s.indexOf('app.post("/api/agents/:id/location"');
    expect(i, "위치 저장 라우트가 없다 — 화면이 부를 곳이 없다").toBeGreaterThan(0);
    const 줄 = s.slice(i, s.indexOf("\n", i));
    // 「채팅이 어디로 가는지」를 정하는 설정이라 원격 전역 스위치와 같은 급으로 admin에 둔다.
    expect(줄, "admin 전용이 아니다").toContain("adminMiddleware");
  });

  it("③ 클라 통로가 이어져 있다 (api → preload → 화면)", () => {
    const api = 읽기("../../client/src/api/console.ts");
    const pre = 읽기("../../client/src/preload.ts");
    const 화면 = 읽기("../../client/src/renderer/pages/agent.html");
    expect(api, "api에 setLocation이 없다").toMatch(/setLocation:/);
    expect(api, "라우트 주소가 서버와 다르다").toContain("/location");
    expect(pre, "preload가 안 열어 준다 — 화면에서 window.gijo.setAgentLocation이 undefined가 된다").toContain(
      "setAgentLocation"
    );
    expect(화면, "화면이 저장을 안 부른다 — 눌러도 아무 일이 없다").toContain("window.gijo.setAgentLocation");
  });

  it("④ 화면이 위치를 그리고, 총괄은 잠근다", () => {
    const 화면 = 읽기("../../client/src/renderer/pages/agent.html");
    expect(화면, "위치 칸을 안 그린다").toContain("locationHtml");
    expect(화면, "카드에 안 넣었다 — 함수만 있고 안 부르면 안 보인다").toMatch(/\$\{locationHtml\(a\)\}/);
    // 서버가 막고 화면도 막는다 — **양쪽에서**. 화면만 막으면 라우트로 새고,
    // 서버만 막으면 눌렀다가 오류를 보는 경험이 된다.
    expect(화면, "총괄을 화면에서 안 잠근다").toMatch(/a\.id === "orchestrator"/);
    // 고르고 나서 「그래서 어떻게 되는지」를 그 자리에서 말해야 한다.
    expect(화면, "고른 결과를 설명하지 않는다").toContain("locationNote");
  });

  it("⑤ 전역이 꺼져 있으면 그렇게 말한다 — 고르면 되는 줄 알면 안 된다", () => {
    const 화면 = 읽기("../../client/src/renderer/pages/agent.html");
    // 전역 원격이 꺼진 상태에서 "remote"를 골라도 실제로는 이 PC로 간다 — 그 사실을 밝혀야 한다.
    expect(화면, "전역 원격 상태를 안 읽는다").toContain("remoteLlmWhere");
    expect(화면, "전역이 꺼졌을 때 안내가 없다").toMatch(/원격 GPU가 꺼져 있어/);
  });
});
