// 긴 작업 완료 알림이 **화면을 덮지 않는가** — 소스에서 계약을 확인한다.
//
// 실사고(2026-07-30): 알림이 5개 넘게 쌓여 화면 오른쪽 아래를 덮었고, 그 아래 버튼을
// 누를 수 없게 됐다. QA 탭 셸 검사가 클릭 불가로 실패해 드러났다
// ("gijoLnWrap subtree intercepts pointer events") — 담당자도 긴 작업을 몇 개 돌리면
// 똑같이 겪는다. 원인은 셋이었다: ① 개수 상한 없음 ② ack 실패 시 같은 알림을 매 폴링마다
// 새로 만듦 ③ 실패 알림은 영영 안 사라짐.
//
// 이 파일은 브라우저 코드라 단위 실행이 어렵다 — 대신 **약속이 코드에 있는지**를 본다.
// (오늘 배운 유형: 주석·커밋으로 약속하고 코드가 안 지키면 동작 시험으로는 안 잡힌다.)
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const src = fs.readFileSync(
  path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "longnotice.js"),
  "utf8"
);

describe("긴 작업 알림이 화면을 덮지 않는다", () => {
  it("동시에 띄우는 개수에 상한이 있다", () => {
    expect(src).toMatch(/MAX_NOTICES\s*=\s*[1-5]\b/);
    // 상한을 넘으면 **오래된 것부터** 접어야 한다(새 알림을 버리면 방금 끝난 일을 못 본다).
    expect(src).toMatch(/while\s*\([^)]*children\.length\s*>\s*MAX_NOTICES\s*\)[^]{0,80}removeChild\([^)]*firstChild/);
  });

  it("이미 띄운 알림을 다시 띄우지 않는다 — ack가 실패해도", () => {
    // ⚠ 정규식이 중첩 대괄호를 넘어야 한다 — 코드가 seen[list[i].id]이므로 [^\]]+로는 못 잡는다
    //   (내 첫 시험이 그래서 옳은 코드를 실패로 찍었다).
    expect(src).toMatch(/if\s*\(\s*seen\[[^\n]*\]\s*\)\s*continue/);
    expect(src).toMatch(/seen\[[^\n]*\]\s*=\s*true/);
    // ack 실패를 삼키는 것 자체는 맞다(다음 주기에 서버가 다시 준다) — 화면 판단과 분리한다.
    expect(src).toMatch(/longAnswerAck[^]{0,120}catch/);
  });

  it("실패 알림도 영영 남지 않는다 — 리포트 이력에 남아 있다", () => {
    // 성공/실패 모두 setTimeout으로 정리하되 실패는 더 오래 둔다.
    expect(src).toMatch(/setTimeout\([^]{0,60}remove\(\)[^]{0,40}ok\s*\?\s*\d+\s*:\s*\d+/);
  });
});
