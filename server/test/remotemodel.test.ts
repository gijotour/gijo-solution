// 원격 GPU의 「어느 두뇌가 답하나」 계약.
//
// [전-7 하드웨어 갈래] 2026-09-02. 「🌐 외부지원 팀원」 시안을 구현하며 만든 시험이다.
//
// ■ 이 시험이 막는 것 셋 — 셋 다 실제로 있던 결함이다
//  ① **생산자 없는 소비자** — `lastCheck`가 타입에 있고 화면이 읽는데 **아무도 값을 넣지 않아
//     늘 null**이었다. 연결 시험이 `/models`를 이미 찌르고도 **개수만 쓰고 버렸다.**
//  ② **낡은 숫자가 코드에 박히는 것** — 화면 안내에 「32B 약 37초 · 72B 약 90초」가 상수로
//     박혀 있었다. 원격이 Qwen3.8-Flash-Next(125B)로 바뀐 뒤에도 그대로 남아 **틀린 안내**가 됐다.
//     틀린 안내는 없는 것보다 나쁘다 — 그래서 소스 감시로 다시 못 박게 한다.
//  ③ **주소가 담당자에게 새는 것** — `/where`는 비-admin도 부른다. 「어느 두뇌인가」는 열되
//     **주소는 안 연다**는 것이 remotellm.ts의 명시된 결정이다(2026-08-19 검토관 H4).

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const 뿌리 = path.resolve(__dirname, "..");
const 읽기 = (p: string) => fs.readFileSync(path.join(뿌리, p), "utf8");

const remotellm = 읽기("src/engine/remotellm.ts");
const agentHtml = fs.readFileSync(
  path.resolve(뿌리, "../client/src/renderer/pages/agent.html"),
  "utf8"
);

describe("원격 두뇌 표시 — 값의 생산자가 있다", () => {
  it("① lastCheck·lastModel을 **넣는 곳**이 있다 (연결 시험)", () => {
    // 타입에만 있고 아무도 안 넣던 시절로 돌아가지 않게 못박는다.
    expect(remotellm).toMatch(/lastCheck:\s*Date\.now\(\)/);
    expect(remotellm).toMatch(/lastModel:\s*모델/);
  });

  it("① 연결 시험이 /models 응답에서 **모델 id를 꺼낸다** (개수만 세지 않는다)", () => {
    expect(remotellm).toMatch(/j\.data\[0\]\?\.id/);
  });

  it("주소가 바뀌면 지난 확인은 **무효**로 돌려준다", () => {
    // lastCheckedUrl과 지금 url이 다르면 null — 옛 기계의 모델 이름이 남으면 거짓 표시다.
    expect(remotellm).toContain("lastCheckedUrl");
    expect(remotellm).toMatch(/유효\s*&&\s*typeof v\.lastModel/);
  });

  it("③ /where는 model을 주되 **url은 주지 않는다** (담당자에게 망 구조를 안 알린다)", () => {
    const i = remotellm.indexOf('"/api/llm/remote/where"');
    expect(i).toBeGreaterThan(0);
    const 본문 = remotellm.slice(i, i + 1200);
    expect(본문).toContain("model:");
    // res.json(...) 안에 url을 실으면 안 된다.
    expect(본문).not.toMatch(/res\.json\(\{[\s\S]*?\burl\b\s*:/);
  });
});

// ⚠ **주석은 빼고 본다.** 이 시험을 처음 쓸 때 「예전엔 …가 박혀 있었다」고 적은 **내 주석이**
//   그 패턴에 걸려 빨간불이 났다. 주석은 사람에게 하는 말이지 화면에 나가는 글이 아니다.
//   (같은 함정을 clientglobals 감시에서도 밟았다 — 주석에 파일명을 적어 거짓 실패)
//   완벽한 파서는 아니다: 줄머리가 `//`·`*`·`/*`인 줄만 뺀다. 코드 끝의 꼬리 주석은 남는데,
//   그건 오히려 좋다 — 꼬리 주석에 숫자를 박는 것도 막아야 할 일이다.
function 주석뺀(글: string): string {
  return 글
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join(" ");
}
const agent본문 = 주석뺀(agentHtml);

describe("② 낡은 숫자를 코드에 박지 않는다", () => {
  // 모델이 바뀌면 같이 안 움직이는 값들. 안내 문구에 상수로 박으면 반드시 낡는다.
  const 금지 = [
    { 조각: /32B\s*약?\s*\d+\s*초/, 왜: "모델별 응답 시간 — 모델이 바뀌면 낡는다" },
    { 조각: /72B\s*약?\s*\d+\s*초/, 왜: "같음" },
    { 조각: /실측:\s*\d+B/, 왜: "「실측: NNB …」 꼴로 모델 크기를 문구에 박은 것" },
  ];
  for (const { 조각, 왜 } of 금지) {
    it(`agent.html에 ${조각} 가 없다 — ${왜}`, () => {
      expect(agent본문).not.toMatch(조각);
    });
  }

  it("대신 **저장된 확인값**에서 읽는다", () => {
    expect(agentHtml).toContain("원격모델");
    expect(agentHtml).toContain("원격확인");
  });
});

describe("화면 배선 — 그려 놓고 안 불리는 것이 없다", () => {
  it("띠와 명패를 그리는 함수가 **실제로 불린다**", () => {
    for (const f of ["renderExtStrip", "extTagHtml"]) {
      const 정의 = new RegExp(`function\\s+${f}\\s*\\(`);
      expect(agentHtml, `${f} 정의`).toMatch(정의);
      // 정의 말고 호출이 최소 1번 더 있어야 한다.
      const 등장 = agentHtml.split(f).length - 1;
      expect(등장, `${f} 호출`).toBeGreaterThan(1);
    }
  });

  it("띠는 **팀원 목록을 채운 뒤**에 그린다 — 앞서 부르면 조용히 안 뜬다", () => {
    const r = agentHtml.indexOf("renderAgents(agents);");
    const e = agentHtml.indexOf("renderExtStrip();", r);
    expect(r).toBeGreaterThan(0);
    expect(e).toBeGreaterThan(r);
  });

  it("총괄에는 외부지원 명패가 안 붙는다 — 이 PC 고정이다", () => {
    expect(agentHtml).toMatch(/외부지원인가[\s\S]{0,200}orchestrator[\s\S]{0,40}return false/);
  });

  it("11px 미만 글자를 쓰지 않는다 (uireadability 하한)", () => {
    const 새CSS = agentHtml.slice(agentHtml.indexOf(".ext-strip{"), agentHtml.indexOf(".agent-loc{"));
    for (const m of 새CSS.matchAll(/font-size:\s*([\d.]+)px/g)) {
      expect(Number(m[1]), `${m[0]}`).toBeGreaterThanOrEqual(11);
    }
  });
});
