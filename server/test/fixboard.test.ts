// 「고칠 것」 갈래 잣대 — 계획서 중-1(파일럿 실사용 피드백 루프)의 두 번째 원장.
// [전중후 계획서 정렬] 중-1 「오답·미답 지적은 회귀셋으로 흡수」의 출구를 만드는 라운드다.
//
// 이 시험이 지키는 것 셋:
//   ⓐ 배너가 있었으면 doc, 아니면 **미분류(null)** — rule·prod은 어떤 입력으로도 자동으로 안 나온다.
//   ⓑ 판정에 쓰는 값 집합이 noevidence의 근거없음종류와 **같다**(글자 베끼기 감시).
//   ⓒ 위조·빈 값이 prod로 굳지 않는다(98%를 개발팀으로 보내던 옛 설계의 재발 감시).
import { describe, it, expect, beforeEach } from "vitest";
import {
  고칠것갈래, 고칠것후보, 고칠것갈래검증, 근거없음값검증, 근거없음종류값들,
  인용정제, 인용읽기, 인용상한, 고칠것요약, 고칠것최근,
} from "../src/engine/fixboard";
import {
  근거없음종류판정,
  자료없음배너, 자료요청배너, 지정범위배너, 근거약함배너, 숫자무근거배너,
} from "../src/engine/noevidence";
import { recordFeedback, setFeedbackStatus, resetFeedbackForTests } from "../src/engine/answerfeedback";

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

  it("열림/닫힘을 상태로 가른다 — open만 열림", () => {
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

  it("★ 반증 — 201건을 넣어도 200에서 안 멈춘다(「200 포화, 실제 1578」 재발 감시)", () => {
    for (let i = 0; i < 201; i++) recordFeedback({ kind: "wrong", question: `질문${i}`, answer: "답" });
    expect(고칠것요약(7).total).toBe(201);
    expect(고칠것요약(7).byKind.wrong).toBe(201);
  });

  it("최근 목록은 본문·인용을 안 싣고 질문 앞 40자만 낸다", () => {
    recordFeedback({
      kind: "missing", question: "가".repeat(120), answer: "사내 문서 원문이 실린 답",
      quotes: [{ documentId: "d1", text: "기밀 조각" }],
    });
    const [r] = 고칠것최근(7, 5);
    expect(r.q).toHaveLength(40);
    expect(Object.keys(r).sort()).toEqual(["at", "fixkind", "id", "kind", "q", "status"]);
  });
});
