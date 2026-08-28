// llmhooks.test.ts — 추론 층(llm)이 위층을 거슬러 물지 않는다는 계약(2026-08-29 화살 #14·#15).
//
// ★ 무엇을 막나
//   llm.ts는 추론 인프라(아래층)인데 RAG를 쓰려고 memory를, 대화를 남기려고 learnloop를
//   **위로 거슬러** 물었다 → llm ⇄ memory · llm → learnloop → dataset → llm 두 고리.
//   방향을 뒤집어 위층이 자기를 등록한다. 그 대가는 「등록을 잊으면 조용히 꺼진다」이고,
//   이 시험이 그 자리다(autoassign #7 · memoryhooks #13과 같은 계보).
//
// ⚠ RAG가 꺼지면 **오류가 안 난다** — 근거 없는 답이 그냥 나온다. 이 저장소가 가장 경계하는
//   조용한 고장이라, 등록 여부를 사람 눈이 아니라 기계가 본다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { hasRagProvider, chatLogListenerCount } from "../src/engine/llm";
import { 지식제공_배선 } from "../src/engine/memory";
import { 대화수집_배선 } from "../src/engine/learnloop";

const 엔진 = (f: string) => readFileSync(join(__dirname, "..", "src", "engine", f), "utf-8");
const APP = readFileSync(join(__dirname, "..", "src", "app.ts"), "utf-8");

describe("★ 추론 층은 위층을 모른다 — 등록으로 뒤집었다", () => {
  it("app.ts가 두 배선을 부른다 — 빠지면 RAG와 대화 수집이 조용히 꺼진다", () => {
    expect(APP, "지식제공_배선()이 없다 — RAG가 꺼져 근거 없는 답이 나간다").toContain("지식제공_배선()");
    expect(APP, "대화수집_배선()이 없다 — 학습 후보가 안 쌓인다").toContain("대화수집_배선()");
  });

  it("배선하면 제공자·청취자가 실제로 선다", () => {
    지식제공_배선();
    expect(hasRagProvider(), "RAG 제공자가 안 걸렸다 — 배선이 헛돈다").toBe(true);
    const 전 = chatLogListenerCount();
    대화수집_배선();
    expect(chatLogListenerCount(), "대화 수집기가 안 걸렸다").toBe(전 + 1);
  });

  it("llm이 memory·learnloop를 다시 물지 않는다 — 두 고리가 부활하지 않게", () => {
    const l = 엔진("llm.ts");
    // ⚠ **값 화살만 본다.** `import type`은 컴파일하면 사라져 런타임 의존이 아니다 —
    //   순환도 아니다(의존 지도 v2가 값/타입/동적을 가르는 이유가 그것이다).
    //   실제로 llm.ts는 `import type { Viewer } from "./memory"`를 쓰고, 그건 정상이다.
    //   전부 금지하면 타입을 쓰려고 타입을 복제하게 되어 「같은 것을 두 곳에」가 된다.
    expect(l, "llm이 memory를 다시 문다(동적) — llm ⇄ memory 부활").not.toContain('import("./memory');
    expect(l, "llm이 memory를 **값으로** 문다 — 순환 부활").not.toMatch(/import \{[^}]*\} from "\.\/memory"/);
    expect(l, "llm이 learnloop를 값으로 문다 — llm→learnloop→dataset→llm 부활")
      .not.toMatch(/import \{[^}]*\} from "\.\/learnloop"/);
    expect(l, "llm이 learnloop를 동적으로 문다").not.toContain('import("./learnloop');
  });

  it("★ 단일 관문은 그대로다 — 순환을 풀자고 보안 경계를 무르게 하지 않았다", () => {
    // chat()을 쪼개 추론만 잎으로 빼는 대안은 memory·dataset이 gateUserInput을 건너뛰게
    // 만든다(지금은 trusted:true로 의도적으로 지나가지만, 잊었을 때 잡아 주는 안전망이 사라진다).
    // 그래서 chat은 통째로 남기고 방향만 뒤집었다 — 이 시험이 그 결정을 지킨다.
    const l = 엔진("llm.ts");
    expect(l, "chat()에서 관문(gateUserInput)이 사라졌다").toContain("gateUserInput(args.message");
    expect(l, "chat()이 llm.ts 밖으로 나갔다 — 관문 우회 경로가 생긴다").toContain("export async function chat(");
  });

  it("★★ 「제공자 없음」과 「검색 실패」를 가른다 — 조용한 그라운딩 해제 방지", () => {
    // 이 구분은 grounding 시험이 구현 도중 드러낸 구멍이다:
    //   · 일반 RAG: 제공자가 없으면 근거 없이 진행한다(붙일 자료가 없을 뿐 — 채팅 생존).
    //   · normaltic(엄격 그라운딩): 제공자가 없으면 **막는다.** 「사내 자료에 없으면 없다고
    //     밝힌다」가 존재 이유인데 배선을 잊으면 그 약속이 **조용히 꺼져** 근거 없는 답이
    //     그대로 나간다 — 이 저장소가 가장 경계하는 조용한 고장이다.
    const l = 엔진("llm.ts");
    expect(l, "일반 RAG 갈래에서 제공자 부재 시 조기 반환이 없다")
      .toMatch(/if \(!ragProvider\) return \{ context: null/);
    expect(l, "normaltic 갈래가 제공자 부재를 조용히 지나간다 — 근거 없는 답이 나간다")
      .toMatch(/if \(!ragProvider\) \{[\s\S]{0,300}지식 검색이 준비되지 않아/);
    // 검색 「실패」는 여전히 막지 않는다 — 임베딩 서버 장애가 채팅을 죽이면 안 된다.
    expect(l, "검색 실패까지 막으면 서버 장애가 채팅을 죽인다").toMatch(/\.catch\(\(\) => null\)/);
  });
});
