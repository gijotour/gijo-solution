// 상태 점검이 담당자의 프롬프트 캐시를 밀어내지 않는가.
//
// 실사고(2026-08-09): 유휴 뒤 첫 질문이 늘 38~43초였다. 라우팅도, 모델 교체도, 답 길이도
// 아니었다 — 90초마다 도는 상태 점검(ping)이 llama-server의 칸을 덮어써서, 그 다음 질문이
// 시스템 프롬프트를 처음부터 다시 읽고 있었다. ping을 직접 쏘고 재면 34.4초, 그 다음은 0.6초.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "localengine.ts"), "utf8");

describe("프롬프트 캐시를 지키는 칸 나누기", () => {
  it("채팅 엔진을 띄울 때 확인용 칸 인자를 넣는다", () => {
    expect(src, "spawn 인자에서 빠지면 다시 40초가 된다").toMatch(/확인용칸\(adaptation\.fittedCtx\)/);
  });

  it("문맥이 넉넉하면 칸을 둘로 나눈다", async () => {
    // 함수만 떼어 검사한다(엔진을 띄우지 않는다).
    const 본문 = src.slice(src.indexOf("function 확인용칸"), src.indexOf("async function probeChatAlive"));
    expect(본문).toContain('"--parallel", "2"');
  });

  it("문맥이 좁으면 나누지 않는다 — 속도 얻자고 문맥을 깎지 않는다", () => {
    const 본문 = src.slice(src.indexOf("function 확인용칸"), src.indexOf("async function probeChatAlive"));
    expect(본문).toMatch(/칸당\s*<\s*칸당_최소문맥/);
    expect(본문).toMatch(/return \[\];/);
  });

  // ★ 숫자가 아니라 **이유**를 지킨다.
  //
  // 예전 시험은 문턱 8192를 글자 그대로 검사했다. 그런데 8192 자체가 재기 전에 정한 판단값이라
  // **이미 모자랐다** — 실측(2026-08-10, /api/llm-activity/history)에서 한 요청이 쓰는 문맥은
  //   구조화 응답(도구 고르는 결정문) 7,984 토큰 + 답변 생성분(llm.ts DEFAULT_MAX_TOKENS 800)
  //   = **8,784**
  // 이라, ctx 16384에서 칸당 8192로 나누면 요청 하나가 안 들어갔다(여유 208토큰).
  // 캐시를 지키려다 요청 자체를 못 담으면 본말전도다. 그래서 숫자를 박지 않고 **하한의 근거**를
  // 검사한다 — 나중에 누가 문턱을 낮추면 실측값에 걸려 실패한다.
  it("★ 칸 하나가 실제 요청 하나를 담는다 — 문턱이 실측 요청 크기보다 작으면 실패", () => {
    const 실측_최대_프롬프트 = 7984; // 2026-08-10 실측(구조화 응답)
    const 답변분 = Number(
      fs
        .readFileSync(path.join(__dirname, "..", "src", "engine", "llm.ts"), "utf8")
        .match(/DEFAULT_MAX_TOKENS\s*=\s*(\d+)/)?.[1] ?? 0
    );
    expect(답변분, "llm.ts의 DEFAULT_MAX_TOKENS를 못 읽었다").toBeGreaterThan(0);

    const 문턱 = Number(src.match(/칸당_최소문맥\s*=\s*(\d+)/)?.[1] ?? 0);
    expect(문턱, "localengine.ts의 칸당_최소문맥을 못 읽었다").toBeGreaterThan(0);
    expect(문턱, `한 요청이 쓰는 문맥(${실측_최대_프롬프트} + ${답변분})보다 커야 한다`).toBeGreaterThanOrEqual(
      실측_최대_프롬프트 + 답변분
    );
  });
});
