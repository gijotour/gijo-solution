// 버튼이 **말없이 아무 일도 안 하는** 자리를 막는다.
//
// ⚠ 실사고(2026-08-01, 클릭 전수 점검에서 발견): 활성 상태인 버튼 3개가 빈 입력이면
//   `if (!값) return;`으로 조용히 돌아갔다 — 터미널 「명령 제안 받기」, 기억·학습 「수집」·
//   「Q&A 변환」. 담당자는 눌렀는데 아무 말이 없으면 **고장으로 읽는다.**
//   무엇이 없어서 못 하는지 말하고 커서를 놓아 주는 것이 맞다.
//
//   같은 날 다른 두 사고와 한 뿌리다 — gijoDialog(없는 함수), office 맡기기(결재판 버림).
//   전부 "화면은 멀쩡하고 버튼도 눌리는데 반응만 없음"이었다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);

// 고쳐 둔 자리 — 여기서 안내 문구가 사라지면 다시 조용해진다.
const 지킬자리: { 파일: string; 함수: string; 안내: RegExp }[] = [
  { 파일: "terminal.html", 함수: "askChatbot", 안내: /먼저 하고 싶은 일을 적어/ },
  { 파일: "memory.html", 함수: "ingest", 안내: /먼저 가져올 폴더나 파일 경로/ },
  { 파일: "memory.html", 함수: "convertDataset", 안내: /먼저 변환할 원문을 넣어/ },
];

describe("빈 입력에도 말은 한다", () => {
  for (const { 파일, 함수, 안내 } of 지킬자리) {
    it(`${파일} / ${함수} — 그냥 return하지 않고 이유를 말한다`, () => {
      const src = fs.readFileSync(new URL(파일, pagesDir), "utf8");
      // 함수 본문을 잘라 본다(다음 함수 선언 전까지).
      const 시작 = src.indexOf(`function ${함수}(`);
      expect(시작, `${함수}를 못 찾았다 — 이름이 바뀌었으면 이 시험도 고칠 것`).toBeGreaterThan(-1);
      const 본문 = src.slice(시작, 시작 + 2200);
      expect(안내.test(본문), `${함수}가 빈 입력에 아무 말도 안 한다`).toBe(true);
      // 안내 없이 곧바로 돌아가는 옛 꼴이 남아 있으면 안 된다.
      expect(
        /if \(![\w.]+\) return;/.test(본문.slice(0, 700)),
        `${함수} 앞부분에 "if (!값) return;"이 남아 있다 — 그 자리는 조용한 실패다`,
      ).toBe(false);
    });
  }
});
