// 답 스트리밍 (계획서 전-7, 2026-08-09 시안 「정돈안」 승인 — "전부 진행 추천안으로 끝까지")
//
// 무엇을 지키나: 첫 글자가 빨리 나오되 **정직해야 한다** —
//  · 흘린 글자는 「쓰는 중」 표시일 뿐, 최종 답은 출구 관문(거짓 완료·내부키·말투)을 지난 done이다
//  · 생각 블록(<think>)·JSON 결정 프롬프트는 흐르지 않는다
//  · 끊기면 끊겼다고 말한다(잘린 답을 완성인 척 두지 않는다)
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const eng = (f: string) => fs.readFileSync(path.join(__dirname, "..", "src", "engine", f), "utf8");
const cli = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", ...p), "utf8");

describe("서버 — 스트림 통로 (소스 계약)", () => {
  it("산문 호출만 흘린다 — JSON 결정 프롬프트(스키마)는 담당자에게 보일 글이 아니다", () => {
    const llm = eng("llm.ts");
    expect(llm).toContain("args.responseSchema ? undefined : 스트림자리.getStore()");
    // 싱크가 있을 때만 stream:true — 평소 경로는 종전 그대로다(회귀 없음).
    expect(llm).toContain('...(싱크 ? { stream: true } : {})');
  });

  it("생각 블록은 흐르지 않는다 — 최종만 걷어내면 흐르는 중간에 누출된다", () => {
    const llm = eng("llm.ts");
    expect(llm).toContain('content.match(/<think>/g)');
    expect(llm).toContain("stripThink(content)");
  });

  it("스트림 라우트의 출구 손질은 기존 라우트와 같은 함수·같은 순서다", () => {
    const disp = eng("dispatcher.ts");
    const 라우트 = disp.slice(disp.indexOf('"/api/dispatch/stream"'));
    expect(라우트).toContain("recordAnswerTiming");
    expect(라우트).toContain("내부키치환");
    expect(라우트).toContain("말투재기");
    // 끊기면 error 이벤트 — 조용히 끝나지 않는다.
    expect(라우트).toContain('보냄({ t: "error"');
  });
});

describe("클라 — 끊김 정직성 (소스 계약)", () => {
  it("done 없이 끝나면 던진다 — 잘린 답을 완성인 척 두지 않는다", () => {
    const core = cli("api", "core.ts");
    expect(core).toContain("답이 중간에 끊겼습니다");
  });

  it("흐른 글자가 있으면 통짜 재시도로 덮지 않는다 — 끊겼다고 알린다", () => {
    const cs = cli("renderer", "pages", "console.js");
    expect(cs).toContain("if (live && live.textContent) throw se;");
    // 흐르는 글자 자리는 절차 띠(.cs-live)와 다른 이름이어야 한다(클래스 충돌 실수 방지).
    expect(cs).toContain('"cs-stream"');
  });
});
