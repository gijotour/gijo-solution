// 요청에 달아 둔 "누가 묻는지" 꼬리표가 **끝까지 따라가는가**.
//
// 이 꼬리표가 새면 등급 통제가 조용히 뚫린다. 그런데 새는 방식이 눈에 안 띈다 —
// 화면도 멀쩡하고 오류도 없고, 그냥 못 볼 문서가 답에 섞여 나올 뿐이다.
// 그래서 AsyncLocalStorage가 실제로 실패하는 두 자리를 못 박는다:
//   ① await를 건너도 남아 있는가 (검색은 임베딩·DB를 기다린다 — await가 여러 번 있다)
//   ② 동시에 들어온 두 요청이 서로의 꼬리표를 보지 않는가 (여러 담당자가 같이 쓴다)
// ②가 깨지면 A담당자의 답에 B담당자 등급이 적용된다 — 가장 위험한 종류의 버그다.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { runWithViewer, currentViewer } from "../src/engine/viewerctx";

const 잠깐 = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("★ 사람 꼬리표가 요청 끝까지 따라간다", () => {
  it("await를 여러 번 건너도 남아 있다", async () => {
    const 본것: (string | null | undefined)[] = [];
    await runWithViewer({ userId: "u1", clearance: "S" }, async () => {
      본것.push(currentViewer()?.clearance);
      await 잠깐(5);
      본것.push(currentViewer()?.clearance);
      await Promise.resolve();
      본것.push(currentViewer()?.clearance);
    });
    expect(본것, "await 뒤에 꼬리표가 떨어지면 그 순간부터 통제가 없다").toEqual(["S", "S", "S"]);
  });

  it("★ 동시에 들어온 두 요청이 서로 섞이지 않는다", async () => {
    // 여기가 깨지면 A의 질문에 B의 열람 등급이 붙는다.
    const 결과: Record<string, string | null | undefined> = {};
    await Promise.all([
      runWithViewer({ userId: "낮은", clearance: "O" }, async () => {
        await 잠깐(20); // 일부러 늦게 끝내 서로 겹치게 한다
        결과.낮은 = currentViewer()?.clearance;
      }),
      runWithViewer({ userId: "높은", clearance: "C" }, async () => {
        await 잠깐(5);
        결과.높은 = currentViewer()?.clearance;
      }),
    ]);
    expect(결과).toEqual({ 낮은: "O", 높은: "C" });
  });

  it("요청 밖에서는 꼬리표가 없다 — 배치가 통째로 막히지 않게", () => {
    // 부팅 시 문서 인입 같은 시스템 작업은 사람이 없다. 여기서 '공개만'으로 쳐 버리면
    // 내부 작업이 자기 자료를 못 읽어 조용히 반쪽이 된다.
    expect(currentViewer()).toBeUndefined();
  });

  it("꼬리표가 없으면(null) 그냥 통과시킨다", async () => {
    let 안: unknown = "아직";
    await runWithViewer(undefined, async () => {
      안 = currentViewer();
    });
    expect(안).toBeUndefined();
  });

  it("★ 명시로 넘긴 viewer가 꼬리표를 이긴다 — 덧문이지 대문이 아니다", () => {
    // memory.ts는 `viewer ?? currentViewer()`로 쓴다. 순서가 뒤집히면
    // 명시로 넘긴 등급(예: 리포트를 특정 담당자 기준으로 뽑을 때)이 무시된다.
    const src = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    expect(src).toContain("hiddenDocIds(viewer ?? currentViewer())");
    expect(src, "꼬리표를 먼저 보면 명시 지정이 무시된다").not.toContain("hiddenDocIds(currentViewer() ?? viewer)");
  });
});
