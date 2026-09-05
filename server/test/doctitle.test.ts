// K2(2026-09-05) — 「참고 자료」 블록의 제목이 **사람이 읽는 제목**인가.
//
// ★ 왜 이 파일이 생겼나(라이브 실측): 제목을 documentId **그대로** 실었더니 내부 ID가 프롬프트와
//   답에 그대로 나갔다 — 실물이 「(출처: 《incident-case:ic-c37e91a2db580f43》)」다. 담당자에게
//   이 문자열은 아무것도 가리키지 않고, 우리 저장 구조만 드러낸다.
// ⚠ 이 시험은 **정규식으로 전수**를 본다(한 꼴만 찍어 보면 다음 접두가 생길 때 또 샌다).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../src/db";
import { 사람이읽는문서제목 } from "../src/engine/memory";
// ⚠ 불러야 표(incident_cases)가 만들어진다 — 접두 문자열의 **단일 출처**이기도 하다.
import { incidentCaseDocId } from "../src/engine/incidentcases";

/** 내부 ID 꼴 — 이 꼴이 제목으로 나가면 안 된다. */
const ID꼴 = /^[a-z][a-z0-9-]*:[A-Za-z0-9_.#-]+$/;

const 사례심기 = (id: string, title: string): void => {
  db.prepare(
    `INSERT OR REPLACE INTO incident_cases
     (id, createdAt, updatedAt, title, oneLiner, plainExplain, year, industry, region, techniques, cves, products, lesson, sourceUrl, sourceName, origin)
     VALUES (?, 1, 1, ?, '한 줄', '풀이', 2023, '제조', '국내', '[]', '[]', '[]', '교훈', 'https://example.test', '출처', 'user')`,
  ).run(id, title);
};
const 개인문서심기 = (id: string, title: string): void => {
  db.prepare(
    "INSERT OR REPLACE INTO personal_docs (id, userId, title, body, ragOptIn, shared, createdAt, updatedAt) VALUES (?, 'u1', ?, '내용', 1, 0, 1, 1)",
  ).run(id, title);
};

describe("★★ K2 참고 자료 제목 — 내부 ID를 사람에게 내보내지 않는다", () => {
  beforeEach(() => {
    db.exec("DELETE FROM incident_cases WHERE id LIKE 'ic-k2%'; DELETE FROM personal_docs WHERE id LIKE 'k2-%'");
  });
  afterEach(() => {
    db.exec("DELETE FROM incident_cases WHERE id LIKE 'ic-k2%'; DELETE FROM personal_docs WHERE id LIKE 'k2-%'");
  });

  it("① 침해사고 사례는 **사례 제목**으로 나간다 — 종류를 앞에 밝힌다", () => {
    사례심기("ic-k2aaaaaaaaaaaa", "OO기업 랜섬웨어 감염");
    const 제목 = 사람이읽는문서제목(incidentCaseDocId("ic-k2aaaaaaaaaaaa"));
    expect(제목).toBe("[사례] OO기업 랜섬웨어 감염");
    expect(제목, "내부 ID가 제목에 남았다").not.toContain("incident-case:");
  });

  it("② 개인 문서는 **파일명(제목)**으로 나간다 — uuid가 아니다", () => {
    개인문서심기("k2-1111-2222", "내 점검 메모.md");
    expect(사람이읽는문서제목("personal:k2-1111-2222")).toBe("내 점검 메모.md");
  });

  it("③ 표에 없으면 **제목을 생략한다** — 없는 제목을 지어내지 않는다", () => {
    expect(사람이읽는문서제목("incident-case:ic-k2ffffffffffff")).toBe("");
    expect(사람이읽는문서제목("personal:k2-없는것")).toBe("");
  });

  it("④ 그 밖의 **ID 꼴**은 제목을 생략한다(옛 꼴 그대로 나간다)", () => {
    for (const id of ["store:abc123#0f40a", "kb-cache:9f8e7d", "internal-x:aa-bb"]) {
      expect(사람이읽는문서제목(id), `ID 꼴이 제목으로 나갔다: ${id}`).toBe("");
    }
  });

  it("⑤ 일반 문서는 파일 이름 그대로 — documentId가 곧 제목이다", () => {
    for (const id of ["침해사고_대응_지침.md", "2024 보안감사 결과.pdf", "internet-research-2026-07"]) {
      expect(사람이읽는문서제목(id)).toBe(id);
    }
  });

  it("★★ 전수 — 어떤 입력을 줘도 **ID 꼴이 제목으로 나가지 않는다**", () => {
    사례심기("ic-k2bbbbbbbbbbbb", "사례 제목");
    개인문서심기("k2-3333", "개인 제목");
    const 입력들 = [
      "incident-case:ic-k2bbbbbbbbbbbb", "incident-case:ic-없는것", "personal:k2-3333", "personal:없는것",
      "store:abc#1", "foo-bar:baz-1", "a:b", "지침.md", "", "  ", null, undefined,
    ];
    for (const id of 입력들) {
      const t = 사람이읽는문서제목(id as string);
      expect(ID꼴.test(t), `제목 자리에 내부 ID가 실렸다: ${id} → ${t}`).toBe(false);
    }
  });

  it("★ 접두 문자열이 incidentcases와 **글자 그대로 같다**(단일 출처)", () => {
    expect(incidentCaseDocId("ic-x")).toBe("incident-case:ic-x");
    사례심기("ic-k2cccccccccccc", "접두 대조용");
    // 접두가 갈리면 이 조회가 빈 문자열을 준다 — 그때 붉어진다.
    expect(사람이읽는문서제목(incidentCaseDocId("ic-k2cccccccccccc"))).toBe("[사례] 접두 대조용");
  });
});
