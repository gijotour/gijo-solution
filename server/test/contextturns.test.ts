// 맥락 턴을 **필요한 만큼만** 읽도록 바꾼 것이, 읽는 내용까지 바꾸지 않았는지 대조한다.
// (계획서 중-1 연장 — 「긴 세션에서 아까 말한 그 서버를 잊는다」의 그 맥락 코드)
//
// ⚠ 왜 이 시험이 필요한가 (2026-08-18):
//   `recentTurnsText`는 세션 대화를 **통째로** 꺼내(getSessionTurns) 끝 6턴과
//   그 앞 사용자 12턴만 썼다. 500턴이면 500줄을 꺼내 482줄을 버린다 — 질문 한 번마다.
//   이걸 DB 질의 두 번으로 줄였는데, 이런 「빠르게 고치기」의 전형적 사고가
//   **뜻이 조용히 바뀌는 것**이다:
//     · DESC LIMIT으로 집고 되돌리기를 잊으면 → 대화 순서가 **거꾸로** 실린다
//     · "끝에서 50턴만" 같은 어림 상한을 쓰면 → 그 안에 사용자 턴이 12건보다 적을 때
//       요지가 **조용히 짧아진다**(= AI가 앞 얘기를 덜 기억한다)
//     · 경계를 rowid가 아니라 시각(at)으로 가르면 → 같은 밀리초 턴이 겹치거나 빠진다
//   셋 다 화면에선 안 보이고 시험에서만 보인다. 그래서 **옛 방식을 이 파일 안에 남겨 두고**
//   새 방식과 글자 단위로 맞춰 본다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { createSession, appendTurn, getSessionTurns, getContextTurns, getRecentSessionTurns, recentTurnsText } from "../src/engine/worksessions";

beforeEach(() => {
  db.exec("DELETE FROM work_session_turns; DELETE FROM work_sessions;");
});

/** 옛 방식 — 전체를 읽어 잘라 쓰던 그대로. **이것이 정답지다.** */
function 옛방식(sessionId: string, maxTurns = 6) {
  const turns = getSessionTurns(sessionId);
  return {
    recent: turns.slice(-maxTurns),
    olderUser: turns.slice(0, -maxTurns).filter((t) => t.role === "user").slice(-12),
  };
}

const 요약 = (ts: { id: string }[]) => ts.map((t) => t.id).join("|");

describe("맥락 턴 — 적게 읽되 같은 것을 읽는다", () => {
  it("긴 대화에서 옛 방식과 글자 단위로 같다", () => {
    const s = createSession("긴 대화");
    // 60턴: 사용자 → AI 번갈아. 요지(사용자 12건)가 충분히 채워지는 크기.
    for (let i = 0; i < 30; i++) {
      appendTurn(s.id, "user", `사용자 지시 ${i}`);
      appendTurn(s.id, "assistant", `AI 답 ${i}`);
    }
    const 옛 = 옛방식(s.id);
    const 새 = getContextTurns(s.id, 6, 12);
    expect(요약(새.recent), "끝 6턴이 옛 방식과 다르다").toBe(요약(옛.recent));
    expect(요약(새.olderUser), "이전 사용자 요지가 옛 방식과 다르다").toBe(요약(옛.olderUser));
    expect(새.olderUser.length, "요지가 12건보다 적다 — 상한을 잘못 걸었다").toBe(12);
  });

  it("대화가 짧을 때도 같다 (턴 3개 · 요지가 아예 없는 경우)", () => {
    const s = createSession("짧은 대화");
    appendTurn(s.id, "user", "안녕");
    appendTurn(s.id, "assistant", "안녕하세요");
    appendTurn(s.id, "user", "고마워");
    const 옛 = 옛방식(s.id);
    const 새 = getContextTurns(s.id, 6, 12);
    expect(요약(새.recent)).toBe(요약(옛.recent));
    expect(요약(새.olderUser)).toBe(요약(옛.olderUser));
    expect(새.olderUser.length).toBe(0);
  });

  it("AI 답이 없는 대화(사용자만 연달아)에서도 같다", () => {
    // ⚠ 어림 상한("끝 50턴")으로 고쳤다면 여기서 갈렸을 것이다 — 사용자 턴 비율이 다르다.
    const s = createSession("사용자만");
    for (let i = 0; i < 25; i++) appendTurn(s.id, "user", `혼잣말 ${i}`);
    const 옛 = 옛방식(s.id);
    const 새 = getContextTurns(s.id, 6, 12);
    expect(요약(새.recent)).toBe(요약(옛.recent));
    expect(요약(새.olderUser)).toBe(요약(옛.olderUser));
  });

  it("맥락 문장 전체가 옛 방식과 똑같이 만들어진다", () => {
    const s = createSession("문장 대조");
    for (let i = 0; i < 20; i++) {
      appendTurn(s.id, "user", `${i}번째 지시 — web-01 서버 점검`);
      appendTurn(s.id, "assistant", `${i}번째 답`);
    }
    const 글 = recentTurnsText(s.id);
    const 옛 = 옛방식(s.id);
    // 끝 6턴이 **시간순**으로 실려야 한다(거꾸로면 "방금 무슨 얘기했더라"가 뒤집힌다).
    const 마지막 = 옛.recent[옛.recent.length - 1].content;
    const 첫 = 옛.recent[0].content;
    expect(글.indexOf(첫), "끝 6턴이 시간순이 아니다 — reverse를 빠뜨렸다").toBeLessThan(글.indexOf(마지막));
    expect(글).toContain("이전 대화 요지");
    expect(글).toContain("이전 대화 맥락(같은 세션)");
  });

  it("턴이 하나도 없으면 빈 문자열 (맥락 없음)", () => {
    const s = createSession("빈 대화");
    expect(recentTurnsText(s.id)).toBe("");
    expect(getContextTurns(s.id, 6, 12).recent.length).toBe(0);
  });

  it("getRecentSessionTurns는 끝 N턴을 시간순으로 준다", () => {
    const s = createSession("끝 N턴");
    for (let i = 0; i < 10; i++) appendTurn(s.id, "user", `줄 ${i}`);
    const r = getRecentSessionTurns(s.id, 3);
    expect(r.map((t) => t.content)).toEqual(["줄 7", "줄 8", "줄 9"]);
    expect(getRecentSessionTurns(s.id, 0).length, "0을 주면 빈 배열").toBe(0);
    expect(getRecentSessionTurns(s.id, -5).length, "음수를 주면 빈 배열").toBe(0);
  });

  it("전체가 필요한 곳은 여전히 전체를 받는다", () => {
    // ⚠ 리포트 생성·세션 열람 API는 자르면 **대화가 빠진다**. 성능 때문에 내용을 잃는 건
    //   반대 방향의 사고라, getSessionTurns는 상한이 없는 채로 남아야 맞다.
    const s = createSession("전체");
    for (let i = 0; i < 40; i++) appendTurn(s.id, "user", `줄 ${i}`);
    expect(getSessionTurns(s.id).length).toBe(40);
  });
});
