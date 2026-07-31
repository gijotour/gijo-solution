// 지식 번들 반입의 멱등성 (계획서 후-3 2단계)
//
// ⚠ 실사고(2026-07-31): 검증은 완벽했는데 **적용이 멱등이 아니었다.**
//   서버에서 뽑은 번들을 도로 반입했더니 운영 온톨로지가 2185행 → 4185행이 됐다.
//   addTriples가 중복을 걸러 준다고 **주석에 적어 놓고** 실제로는 매번 새 UUID로 INSERT였다.
//   서명 검증만 보고 "안전하다"고 끝냈으면 고객이 번들 받을 때마다 지식이 배로 늘었을 것이다.
//   보안 검증과 데이터 정합은 **다른 문제**다 — 둘 다 봐야 한다.
import { describe, it, expect, beforeEach } from "vitest";
import { addTriples, listTriples, countTriples, deleteTriplesBySource } from "../src/engine/ontology";

const SRC = "테스트 번들 출처";
const SRC2 = "테스트 번들 출처2";
const 고객지식 = "고객이 손으로 넣은 것";

const 트리플 = (n: number, source: string) =>
  Array.from({ length: n }, (_, i) => ({ subject: `S${i}`, predicate: "관계", object: `O${i}`, source }));

beforeEach(() => {
  for (const s of [SRC, SRC2, 고객지식]) deleteTriplesBySource(s);
});

describe("addTriples는 중복을 걸러 주지 않는다 — 이 사실을 시험으로 박아 둔다", () => {
  // 이걸 명시해 두는 이유: 다음 사람이 나처럼 "멱등이겠지"라고 믿고 그냥 쓰면 같은 사고가 난다.
  it("같은 트리플을 두 번 넣으면 두 행이 된다", () => {
    addTriples(트리플(3, SRC));
    addTriples(트리플(3, SRC));
    expect(listTriples({ source: SRC })).toHaveLength(6);
  });
});

describe("출처별 교체가 멱등을 만든다", () => {
  // 반입 경로가 쓰는 전략을 그대로 재현한다(deleteTriplesBySource → addTriples).
  const 반입 = (n: number, source: string) => { deleteTriplesBySource(source); return addTriples(트리플(n, source)); };

  it("같은 번들을 몇 번 반입해도 행 수가 그대로다", () => {
    반입(5, SRC);
    const 첫번째 = countTriples();
    반입(5, SRC);
    반입(5, SRC);
    expect(listTriples({ source: SRC })).toHaveLength(5);
    expect(countTriples(), "총계도 늘면 안 된다").toBe(첫번째);
  });

  it("새 번들이 내용을 바꾸면 옛 내용은 남지 않는다", () => {
    반입(5, SRC);
    deleteTriplesBySource(SRC);
    addTriples([{ subject: "새주제", predicate: "관계", object: "새대상", source: SRC }]);
    const rows = listTriples({ source: SRC });
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("새주제");
  });

  it("★ 고객이 손으로 넣은 지식은 건드리지 않는다 — 출처가 다르다", () => {
    addTriples([{ subject: "우리회사 방화벽", predicate: "담당", object: "김보안", source: 고객지식 }]);
    반입(5, SRC);
    반입(5, SRC); // 두 번 반입해도
    const 고객 = listTriples({ source: 고객지식 });
    expect(고객, "고객 지식이 사라지면 번들 반입이 곧 사고다").toHaveLength(1);
    expect(고객[0].object).toBe("김보안");
  });

  it("출처가 여럿이어도 각각 독립으로 교체된다", () => {
    반입(3, SRC);
    반입(4, SRC2);
    반입(3, SRC); // SRC만 다시
    expect(listTriples({ source: SRC })).toHaveLength(3);
    expect(listTriples({ source: SRC2 }), "다른 출처는 영향 없어야 한다").toHaveLength(4);
  });
});
