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
    expect(본문).toContain("8192");
  });

  it("문맥이 좁으면 나누지 않는다 — 속도 얻자고 문맥을 깎지 않는다", () => {
    const 본문 = src.slice(src.indexOf("function 확인용칸"), src.indexOf("async function probeChatAlive"));
    expect(본문).toMatch(/칸당\s*<\s*8192/);
    expect(본문).toMatch(/return \[\];/);
  });
});
