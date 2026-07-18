// 작업 세션(대화 세션형) — 세션·턴 CRUD, 자동 제목, 목록 미리보기, 맥락 텍스트.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import {
  createSession,
  getSession,
  listSessions,
  getSessionTurns,
  appendTurn,
  renameSession,
  setSessionStatus,
  deleteSession,
  recentTurnsText,
} from "../src/engine/worksessions";

beforeEach(() => {
  db.exec("DELETE FROM work_session_turns; DELETE FROM work_sessions;");
});

describe("worksessions — 세션 생성·조회", () => {
  it("새 세션은 기본 제목·active 상태로 생성된다", () => {
    const s = createSession();
    expect(s.title).toBe("새 세션");
    expect(s.status).toBe("active");
    expect(getSession(s.id)?.id).toBe(s.id);
  });

  it("제목을 지정해 생성할 수 있다", () => {
    const s = createSession("주간 취약점 재점검");
    expect(s.title).toBe("주간 취약점 재점검");
  });

  it("없는 세션 조회는 null", () => {
    expect(getSession("nope")).toBeNull();
  });
});

describe("worksessions — 턴 추가·자동 제목", () => {
  it("첫 user 턴이 기본 제목 세션의 이름을 자동으로 짓는다", () => {
    const s = createSession();
    appendTurn(s.id, "user", "오늘 제일 급한 취약점 뭐야?");
    expect(getSession(s.id)?.title).toBe("오늘 제일 급한 취약점 뭐야?");
  });

  it("긴 첫 지시는 40자에서 잘리고 …가 붙는다", () => {
    const s = createSession();
    const long = "이것은 아주 긴 지시문으로 마흔 글자를 확실히 넘기기 위해 계속 이어지는 문장입니다 그래서 잘려야 합니다";
    appendTurn(s.id, "user", long);
    const t = getSession(s.id)!.title;
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(41);
  });

  it("사용자가 정한 제목은 후속 턴이 덮어쓰지 않는다", () => {
    const s = createSession("내가 정한 제목");
    appendTurn(s.id, "user", "첫 지시");
    expect(getSession(s.id)?.title).toBe("내가 정한 제목");
  });

  it("턴은 시간순으로 조회되고 tool 배지를 담는다", () => {
    const s = createSession();
    appendTurn(s.id, "user", "오늘 급한거");
    appendTurn(s.id, "assistant", "Log4j RCE가 최우선입니다", "today");
    const turns = getSessionTurns(s.id);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[1].tool).toBe("today");
  });

  it("없는 세션에 턴 추가는 null", () => {
    expect(appendTurn("nope", "user", "x")).toBeNull();
  });
});

describe("worksessions — 목록 미리보기·정렬", () => {
  it("최근 수정순으로 정렬하고 마지막 턴·턴수를 함께 준다", async () => {
    const a = createSession("첫 세션");
    appendTurn(a.id, "user", "질문A");
    await new Promise((r) => setTimeout(r, 5));
    const b = createSession("둘째 세션");
    appendTurn(b.id, "user", "질문B");
    appendTurn(b.id, "assistant", "답변B", "search");

    const list = listSessions();
    expect(list[0].id).toBe(b.id); // 더 최근에 갱신된 b가 먼저
    expect(list[0].turnCount).toBe(2);
    expect(list[0].lastPreview).toBe("답변B");
    expect(list[0].lastRole).toBe("assistant");
    const first = list.find((s) => s.id === a.id)!;
    expect(first.turnCount).toBe(1);
    expect(first.lastRole).toBe("user");
  });
});

describe("worksessions — 이름·상태·삭제", () => {
  it("rename은 제목을 바꾸고 빈 값이면 기본 제목", () => {
    const s = createSession("원래");
    expect(renameSession(s.id, "바뀜")?.title).toBe("바뀜");
    expect(renameSession(s.id, "   ")?.title).toBe("새 세션");
  });

  it("상태를 done/ignored로 바꿀 수 있다", () => {
    const s = createSession();
    expect(setSessionStatus(s.id, "done")?.status).toBe("done");
    expect(setSessionStatus(s.id, "ignored")?.status).toBe("ignored");
  });

  it("삭제하면 세션과 턴이 모두 사라진다", () => {
    const s = createSession();
    appendTurn(s.id, "user", "x");
    expect(deleteSession(s.id)).toBe(true);
    expect(getSession(s.id)).toBeNull();
    expect(getSessionTurns(s.id)).toEqual([]);
    expect(deleteSession(s.id)).toBe(false);
  });
});

describe("worksessions — recentTurnsText(맥락)", () => {
  it("최근 턴을 역할 라벨과 함께 압축한다", () => {
    const s = createSession();
    appendTurn(s.id, "user", "web01 Log4j 담당 정요한으로 배정해줘");
    appendTurn(s.id, "assistant", "배정 결재판을 준비했습니다", "결재판");
    const ctx = recentTurnsText(s.id);
    expect(ctx).toContain("이전 대화 맥락");
    expect(ctx).toContain("사용자: web01 Log4j");
    expect(ctx).toContain("AI: 배정 결재판");
  });

  it("턴이 없으면 빈 문자열", () => {
    const s = createSession();
    expect(recentTurnsText(s.id)).toBe("");
  });

  it("maxTurns 상한을 넘는 오래된 턴은 제외한다", () => {
    const s = createSession();
    for (let i = 0; i < 10; i++) appendTurn(s.id, "user", `지시${i}`);
    const ctx = recentTurnsText(s.id, 3);
    expect(ctx).toContain("지시9");
    expect(ctx).toContain("지시7");
    expect(ctx).not.toContain("지시6");
  });
});
