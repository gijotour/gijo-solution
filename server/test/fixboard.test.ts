// 「고칠 것」 갈래 잣대 — 계획서 중-1(파일럿 실사용 피드백 루프)의 두 번째 원장.
// [전중후 계획서 정렬] 중-1 「오답·미답 지적은 회귀셋으로 흡수」의 출구를 만드는 라운드다.
//
// 이 시험이 지키는 것 셋:
//   ⓐ 배너가 있었으면 doc, 아니면 **미분류(null)** — rule·prod은 어떤 입력으로도 자동으로 안 나온다.
//   ⓑ 판정에 쓰는 값 집합이 noevidence의 근거없음종류와 **같다**(글자 베끼기 감시).
//   ⓒ 위조·빈 값이 prod로 굳지 않는다(98%를 개발팀으로 보내던 옛 설계의 재발 감시).
import { describe, it, expect, beforeEach } from "vitest";
import {
  고칠것갈래, 고칠것후보, 고칠것갈래검증, 근거없음값검증, 근거없음정하기, 근거없음종류값들,
  인용정제, 인용읽기, 인용상한, 고칠것요약, 고칠것최근, 고칠것열림, 기간시작, 기간정리,
  지적상태값들, 지적종류값들, 질문가림, 회귀문항후보상태,
} from "../src/engine/fixboard";
import {
  근거없음종류판정,
  자료없음배너, 자료요청배너, 지정범위배너, 근거약함배너, 숫자무근거배너,
} from "../src/engine/noevidence";
import { recordFeedback, setFeedbackStatus, resetFeedbackForTests } from "../src/engine/answerfeedback";
import { db } from "../src/db";
import { dateOnlyLocal, todayLocal } from "../src/util/date";

beforeEach(() => resetFeedbackForTests());

describe("ⓐ 자동 갈래 — 배너가 있었으면 doc, 아니면 미분류", () => {
  it("근거없음 값이 실려 있으면 doc", () => {
    for (const noev of 근거없음종류값들) {
      expect(고칠것갈래({ kind: "wrong", noev }), noev).toBe("doc");
    }
  });

  it("★ rule·prod은 **어떤 입력으로도** 자동으로 안 나온다 — 사람만 정한다", () => {
    const 입력들 = [
      { kind: "wrong" }, { kind: "missing" }, { kind: "style" },
      { kind: "wrong", noev: null }, { kind: "style", noev: undefined },
      { kind: "wrong", noev: "자료없음" }, { kind: "missing", noev: "숫자무근거" },
    ];
    for (const i of 입력들) {
      expect(["doc", null], JSON.stringify(i)).toContain(고칠것갈래(i));
    }
  });

  it("후보는 갈래와 다른 것이다 — missing→doc · style→prod · wrong→없음(찍어 주지 않는다)", () => {
    expect(고칠것후보("missing")).toBe("doc");
    expect(고칠것후보("style")).toBe("prod");
    expect(고칠것후보("wrong")).toBeNull();
    expect(고칠것후보(undefined)).toBeNull();
    // 후보는 저장 값이 아니다 — 같은 입력의 자동 갈래는 여전히 미분류다.
    expect(고칠것갈래({ kind: "style" })).toBeNull();
  });
});

describe("ⓑ 원천 대조 — 값 집합이 noevidence와 같다", () => {
  it("배너 5종을 판정기에 넣어 나온 종류가 근거없음종류값들과 정확히 같다", () => {
    const 배너들 = [자료없음배너, 자료요청배너, 지정범위배너, 근거약함배너, 숫자무근거배너];
    const 판정된 = 배너들.map((b) => 근거없음종류판정(`${b}\n\n본문`));
    expect(판정된.every((x) => x !== null)).toBe(true);
    // 집합이 같아야 한다 — noevidence가 배너를 늘리면(또는 이름을 바꾸면) 여기서 빨개진다.
    expect(new Set(판정된 as string[])).toEqual(new Set(근거없음종류값들 as readonly string[]));
    expect(근거없음종류값들).toHaveLength(배너들.length);
  });

  it("실제 배너가 붙은 답 → 판정 → 갈래까지 한 줄로 이어진다(배관 확인)", () => {
    const noev = 근거없음종류판정(`${자료요청배너}\n\n우리 회사 백업 보관 기간은…`);
    expect(고칠것갈래({ kind: "wrong", noev })).toBe("doc");
  });
});

describe("ⓒ 반증 — 위조·모르는 값은 prod로 굳지 않고 미분류로 남는다", () => {
  it("값 집합 밖은 전부 null", () => {
    for (const v of ["prod", "제품", "자료없", "", "  ", 0, 1, true, {}, [], null, undefined]) {
      expect(근거없음값검증(v), String(v)).toBeNull();
      expect(고칠것갈래({ kind: "wrong", noev: v }), String(v)).toBeNull();
    }
  });

  it("갈래 검증도 같은 규율 — 허용 셋 밖은 null", () => {
    expect(고칠것갈래검증("doc")).toBe("doc");
    expect(고칠것갈래검증("rule")).toBe("rule");
    expect(고칠것갈래검증("prod")).toBe("prod");
    for (const v of ["fixed", "unclassified", "", null, undefined, 3]) expect(고칠것갈래검증(v), String(v)).toBeNull();
  });
});

describe("★ 근거없음은 답 글자와 대조한다 — 클라 주장보다 서버가 본 사실이 앞선다", () => {
  it("답에 배너가 있으면 클라가 다른 값을 보내도 **답이 이긴다**", () => {
    // 실측(검토관): 배너가 자료없음인데 noev=근거약함을 보내면 그대로 저장됐다.
    expect(근거없음정하기("근거약함", `${자료없음배너}

본문`)).toBe("자료없음");
    expect(근거없음정하기(null, `${숫자무근거배너}

본문`)).toBe("숫자무근거");
    expect(근거없음정하기("위조", `${지정범위배너}

본문`)).toBe("지정범위");
  });

  it("배너가 없는 답에서는 클라 값을 받는다 — **배너억제 갈래는 원리상 대조 불가**다", () => {
    // 못 하는 것을 하는 척하지 않는다: 배너를 일부러 뗀 답은 저장된 글자에 흔적이 없다.
    expect(근거없음정하기("자료없음", "배너가 없는 평범한 답")).toBe("자료없음");
    expect(근거없음정하기("제품결함", "배너가 없는 평범한 답")).toBeNull();
    expect(근거없음정하기(undefined, "")).toBeNull();
  });

  it("접수까지 이어진다 — 배너가 붙은 답에 위조 noev를 보내도 저장은 배너 값이다", () => {
    const f = recordFeedback({
      kind: "wrong", question: "질문", answer: `${자료없음배너}

본문`, noev: "근거약함",
    });
    expect(f.noev).toBe("자료없음");
    expect(f.fixkind).toBe("doc");
  });
});

describe("인용 조각 — 서버가 자른다(원문 전체가 표에 실리지 않는다)", () => {
  it("조각 수·조각 글자·총 글자 상한을 넘겨도 잘려서 들어간다", () => {
    const 큰 = "가".repeat(5000);
    const v = 인용정제([
      { documentId: "d1", text: 큰, title: "문서1" },
      { documentId: "d2", text: 큰 },
      { documentId: "d3", text: 큰 },
      { documentId: "d4", text: 큰 },
    ]);
    expect(v).not.toBeNull();
    expect(v!.length).toBeLessThanOrEqual(인용상한.조각);
    for (const q of v!) expect(q.text.length).toBeLessThanOrEqual(인용상한.조각글자);
    expect(v!.reduce((s, q) => s + q.text.length, 0)).toBeLessThanOrEqual(인용상한.총글자);
  });

  it("인용 꼴이 아니면 null — 있는 척하지 않는다", () => {
    expect(인용정제(null)).toBeNull();
    expect(인용정제("문자열")).toBeNull();
    expect(인용정제([])).toBeNull();
    expect(인용정제([{ text: "본문만 있고 문서가 없다" }])).toBeNull();
    expect(인용정제([{ documentId: "d1", text: "   " }])).toBeNull();
    expect(인용읽기(null)).toBeNull();
    expect(인용읽기("{깨진 JSON")).toBeNull();
  });
});

describe("집계 — 세는 곳은 SQL 한 곳(LIMIT 200에 안 걸린다)", () => {
  it("갈래 네 칸을 늘 전부 낸다 — 0건이어도 사라지지 않는다", () => {
    const s = 고칠것요약(7);
    expect(s.kinds.map((k) => k.fixkind)).toEqual(["doc", "rule", "prod", "unclassified"]);
    expect(s.total).toBe(0);
    expect(s.open).toBe(0);
    expect(s.closed).toBe(0);
  });

  it("열림/닫힘을 상태로 가른다 — **고쳐서 닫은 것만** 닫힘", () => {
    const a = recordFeedback({ kind: "wrong", question: "질문A", answer: "답A", noev: "자료없음" });
    recordFeedback({ kind: "wrong", question: "질문B", answer: "답B" });
    const b4 = 고칠것요약(7);
    expect(b4.total).toBe(2);
    expect(b4.open).toBe(2);
    expect(b4.kinds.find((k) => k.fixkind === "doc")!.total).toBe(1);
    expect(b4.kinds.find((k) => k.fixkind === "unclassified")!.total).toBe(1);
    setFeedbackStatus(a.id, "resolved");
    const 뒤 = 고칠것요약(7);
    expect(뒤.open).toBe(1);
    expect(뒤.closed).toBe(1);
    expect(뒤.kinds.find((k) => k.fixkind === "doc")).toMatchObject({ open: 0, closed: 1, total: 1 });
  });

  it("★ promoted는 **열린 채**다 — 회귀 문항으로 옮겨 적은 것이 「고쳤다」는 뜻은 아니다", () => {
    // 실측(검토관 2026-09-07): 자료를 한 장도 안 올렸는데 「자료 부족 1건(열림 0)」이 나왔다.
    const a = recordFeedback({ kind: "missing", question: "백업 보관", answer: "답", noev: "자료없음" });
    setFeedbackStatus(a.id, "promoted");
    const s = 고칠것요약(7);
    expect(s.open).toBe(1);
    expect(s.closed).toBe(0);
    expect(s.kinds.find((k) => k.fixkind === "doc")).toMatchObject({ open: 1, closed: 0, total: 1 });
    // dismissed는 사람이 「고칠 것도 없다」고 닫은 것이라 닫힘이다.
    setFeedbackStatus(a.id, "dismissed");
    expect(고칠것요약(7)).toMatchObject({ open: 0, closed: 1 });
  });

  it("잣대는 한 곳(고칠것열림) — 네 상태의 답이 표와 같다", () => {
    expect(지적상태값들.map(고칠것열림)).toEqual([true, true, false, false]);
    expect(고칠것열림("아무값")).toBe(false); // 모르는 상태는 열린 것으로 세지 않는다
  });

  it("★ 반증 — 201건을 넣어도 200에서 안 멈춘다(「200 포화, 실제 1578」 재발 감시)", () => {
    for (let i = 0; i < 201; i++) recordFeedback({ kind: "wrong", question: `질문${i}`, answer: "답" });
    expect(고칠것요약(7).total).toBe(201);
    expect(고칠것요약(7).byKind.wrong).toBe(201);
  });

  it("최근 목록은 본문·인용을 안 싣고 질문 앞 40자만 낸다(볼 수 있는 사람에게)", () => {
    recordFeedback({
      kind: "missing", question: "가".repeat(120), answer: "사내 문서 원문이 실린 답",
      quotes: [{ documentId: "d1", text: "기밀 조각" }],
    });
    const [r] = 고칠것최근(7, 5, true);
    expect(r.q).toHaveLength(40);
    expect(Object.keys(r).sort()).toEqual(["at", "fixkind", "id", "kind", "q", "status"]);
  });

  it("★ 질문 원문은 **기본이 가림**이다(fail-closed) — 부르는 쪽이 권한을 증명해야 나간다", () => {
    recordFeedback({ kind: "wrong", question: "A은행 위약금 조항이 3억이라던데", answer: "답" });
    const [기본] = 고칠것최근(7, 5);
    expect(기본.q).toBe(질문가림);
    expect(기본.q).not.toContain("A은행");
    // 가렸다는 사실 자체는 숨기지 않는다 — 빈 문자열이면 「질문 없음」과 못 가른다.
    expect(기본.q.length).toBeGreaterThan(0);
    // 건수·갈래·상태는 내용이 아니라 신호라 그대로 나간다.
    expect(기본.kind).toBe("wrong");
    expect(기본.status).toBe("open");
  });

  it("★ byKind는 셋을 늘 낸다 — 0건 종류가 undefined로 사라지지 않는다", () => {
    recordFeedback({ kind: "wrong", question: "질문", answer: "답" });
    const s = 고칠것요약(7);
    expect(Object.keys(s.byKind).sort()).toEqual([...지적종류값들].sort());
    expect(s.byKind.style).toBe(0);
    expect(s.byKind.missing).toBe(0);
    expect(s.byKind.wrong).toBe(1);
  });
});

// ── 기간 — 같은 화면 안에서 「N일」이 한 뜻이어야 한다 ────────────────────
describe("★ 기간 잣대 — 감독 화면 daily와 같은 달력을 쓴다", () => {
  it("NaN은 기본값으로 돌아온다 — 「지적이 없습니다」라고 거짓 단언하지 않는다", () => {
    expect(기간정리("abc", 7)).toBe(7);
    expect(기간정리(undefined, 7)).toBe(7);
    expect(기간정리("", 7)).toBe(1);      // 빈 값은 0 → 최소 1일
    expect(기간정리("3", 7)).toBe(3);
    expect(기간정리(9999, 7)).toBe(365);
    expect(기간정리(9999, 1, 90)).toBe(90);
    expect(기간정리(-5, 7)).toBe(1);
  });

  it("시작 시각이 **로컬 달력 자정**이다(굴림 24시간이 아니다)", () => {
    const 자정 = new Date(); 자정.setHours(0, 0, 0, 0);
    expect(기간시작(1)).toBe(자정.getTime());
    expect(기간시작(7)).toBe(자정.getTime() - 6 * 86400000);
  });

  it("★ 반증 — 어제 23:59:59에 들어온 지적을 「오늘 1일」로 세지 않는다(daily와 어긋나던 자리)", () => {
    const f = recordFeedback({ kind: "wrong", question: "질문", answer: "답" });
    const 자정 = new Date(); 자정.setHours(0, 0, 0, 0);
    db.prepare("UPDATE answer_feedback SET at = ? WHERE id = ?").run(자정.getTime() - 1, f.id);
    expect(고칠것요약(1).total).toBe(0);      // 굴림 24시간이면 1이 나온다
    expect(고칠것최근(1, 5, true)).toHaveLength(0);
    expect(고칠것요약(2).total).toBe(1);      // 어제까지 보면 있다
    // 감독 화면(activityDaily·citeReasonsDaily)이 쓰는 날짜 계산과 **같은 하루**에서 시작하는지
    // 직접 대조한다 — 둘이 어긋나면 한 JSON 안에서 「N일」이 두 뜻이 된다.
    expect(dateOnlyLocal(new Date(기간시작(1)))).toBe(todayLocal());
    expect(dateOnlyLocal(new Date(기간시작(7)))).toBe(todayLocal(new Date(Date.now() - 6 * 86400000)));
  });

  it("회귀 문항 후보 상태는 open+resolved 둘뿐이다(값 집합 감시)", () => {
    expect([...회귀문항후보상태]).toEqual(["open", "resolved"]);
  });
});
