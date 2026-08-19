// 화면이 **사라진 요소**를 계속 붙잡고 있지 않은지 대조한다.
//
// ⚠ 실사고 3건(전부 2026-08-01 하루에 발견):
//   ① office.html — 피드 패널(#feed)을 없애면서 "요소가 없으면 조용히 무시"로 두었더니, 그 뒤로
//      통보 9곳이 **허공에 썼다.** 그중 셋이 오류라 브리핑·할일·초기화가 실패해도 화면은 조용했다.
//   ② agent.html — 협업현황 패널을 없앤 뒤 chatFeed에 쓰는 7곳이 문서에 붙지 않은 더미에 썼다.
//      "협업 로그를 불러오지 못했습니다"가 어디에도 안 떴다.
//   ③ inventory.html — filterChips는 툴바 개편 때 사라졌는데 참조가 남아 **null.querySelector로
//      죽었다.** 「미점검 보기」가 눌러도 아무 일이 없었다.
//
//   공통점: **없앤 것은 화면이고, 그것을 부르는 코드는 남았다.** 셋 다 조용히 실패해서
//   스윕(화면이 뜨는가)·타입검사·단위시험 어디에도 안 걸렸다.
//
// 판정 기준: 같은 파일 안에서 getElementById("X")를 하는데 그 파일에 id="X"가 없으면 의심.
//   단, **스스로 만들어 붙이는 것**(createElement 후 id 지정)과 다른 문서를 가리키는 것은 뺀다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);

// 다른 문서(호스트 페이지·iframe)의 요소를 가리키는 공용 스크립트 — 자기 파일에 id가 없는 게 정상.
const 공용스크립트 = new Set(["nav.js", "titlebar.js", "chatparts.js", "chatwidget.js", "console.js", "fold.js", "dialog.js", "longnotice.js", "progresscard.js", "session-explorer.js", "railroster.js" /* app.html 전용 — 레일·로스터 id가 셸 문서에 있고 자기 안에서 동적 생성(2026-08-20 AI 팀 가시화) */]);

const 페이지 = fs
  .readdirSync(pagesDir)
  .filter((f) => /\.(html|js)$/.test(f) && !공용스크립트.has(f))
  .map((f) => ({ 이름: f, 내용: fs.readFileSync(new URL(f, pagesDir), "utf8") }));

describe("사라진 요소를 붙잡고 있지 않은가", () => {
  it("자기 화면에 없는 id를 getElementById로 찾지 않는다", () => {
    const 의심: string[] = [];
    for (const p of 페이지) {
      const ids = [...p.내용.matchAll(/getElementById\(["']([A-Za-z0-9_-]+)["']\)/g)].map((m) => m[1]);
      for (const id of [...new Set(ids)]) {
        if (new RegExp(`id=["']${id}["']`).test(p.내용)) continue; // HTML에 있다
        if (new RegExp(`\\.id\\s*=\\s*["']${id}["']`).test(p.내용)) continue; // 스스로 만들어 붙인다
        의심.push(`${p.이름}: #${id}`);
      }
    }
    expect(
      의심,
      `없는 요소를 찾고 있다 — 여기 쓰는 통보는 아무에게도 안 보이고, 메서드를 걸면 조용히 죽는다:\n  ${의심.join("\n  ")}`,
    ).toEqual([]);
  });
});
