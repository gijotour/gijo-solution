// K2(2026-09-05) — 「참고 자료」 블록의 제목이 **사람이 읽는 제목**인가.
//
// ★ 왜 이 파일이 생겼나(라이브 실측): 제목을 documentId **그대로** 실었더니 내부 ID가 프롬프트와
//   답에 그대로 나갔다 — 실물이 「(출처: 《incident-case:ic-c37e91a2db580f43》)」다. 담당자에게
//   이 문자열은 아무것도 가리키지 않고, 우리 저장 구조만 드러낸다.
// ⚠ 이 시험은 **정규식으로 전수**를 본다(한 꼴만 찍어 보면 다음 접두가 생길 때 또 샌다).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../src/db";
import { 사람이읽는문서제목, 내부ID꼴 } from "../src/engine/memory";
// ⚠ 불러야 표(incident_cases)가 만들어진다 — 접두 문자열의 **단일 출처**이기도 하다.
import { incidentCaseDocId } from "../src/engine/incidentcases";

// ⚠⚠ 잣대는 **제품 함수**(내부ID꼴)를 부른다 — 여기에 정규식을 베끼지 않는다.
//   2026-09-06 실측: 이 파일이 `^[a-z]…` 사본을 들고 있어서, 제품이 「승인문답:dtmtl40khqg8uehk」를
//   제목으로 내보내고 있는데도 **전수 시험이 초록**이었다(사본이 ASCII 접두만 봤다).
//   같은 것을 두 곳에 적으면 어긋나고, 어긋난 줄 아무도 모른다.

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

  // ★★ 2026-09-06 라이브 실측 — **한글 접두 ID**. 그물이 `^[a-z]…`라 ASCII 접두만 봤고,
  //   우리가 가장 많이 만드는 내부 ID인 「승인문답:<로그 id>」가 그냥 지나가 제목으로 실렸다.
  //   실물이 프롬프트에 「[3] 《승인문답:dtmtl40khqg8uehk》 …」로 나갔다.
  it("⑥ ★★ 한글 접두 ID도 제목을 생략한다 — 「승인문답:…」이 실물 사례다", () => {
    for (const id of ["승인문답:dtmtl40khqg8uehk", "승인문답:ab12cd34", "사례:ic-abc123", "개인:u1-9f8e"]) {
      expect(사람이읽는문서제목(id), `내부 ID가 제목으로 나갔다: ${id}`).toBe("");
    }
  });

  // ⚠ 반대편 — 넓힌 그물이 **사람이 붙인 진짜 제목**을 삼키면 안 된다. 꼬리가 ASCII가 아니면
  //   ID가 아니다(사람은 「제1장:개요.md」라고 적고, 우리 ID는 꼬리가 늘 영숫자 토막이다).
  it("⑦ 꼬리에 한글이 있으면 ID가 아니다 — 사람이 붙인 제목은 그대로 나간다", () => {
    for (const id of ["제1장:개요.md", "2024년: 보안감사 결과.pdf", "지침:취약점 관리"]) {
      expect(사람이읽는문서제목(id), `사람이 붙인 제목을 삼켰다: ${id}`).toBe(id);
    }
  });

  // ★★ 2026-09-06 검토관 실측 — ⑦이 **덮지 못한 자리**. 위 셋은 꼬리에 한글이 있어
  //   「꼬리는 ASCII만」 규칙으로 이미 살아 있었다. 진짜 위험한 것은 **꼬리가 전부 ASCII인
  //   사람 제목**(콜론 든 파일 이름)이고, 접두를 한글까지 넓히면서 그 넷이 통째로 삼켜졌다.
  //   → 판정을 「꼬리가 `.확장자`로 끝나면 파일 이름이지 ID가 아니다」로 되좁혔다.
  it("⑦-2 ★★ 꼬리가 전부 ASCII라도 **파일 이름꼴**이면 제목이다", () => {
    for (const id of [
      "보안점검:2024.pdf", "월간보고:202409.xlsx", "NIST:SP800-53.pdf",
      "ISMS-P:2023.pdf", "CVE-2021-44228:PoC.md",
    ]) {
      expect(사람이읽는문서제목(id), `사람이 붙인 파일 이름을 삼켰다: ${id}`).toBe(id);
      expect(내부ID꼴(id), `파일 이름을 내부 ID로 봤다: ${id}`).toBe(false);
    }
  });

  it("⑦-3 되좁힘이 **내부 ID를 놓치지는 않는다** — 확장자 없는 꼬리는 그대로 ID다", () => {
    for (const id of ["승인문답:dtmtl40khqg8uehk", "store:abc#1", "store:v1.2", "사례:ic-abc123"]) {
      expect(내부ID꼴(id), `내부 ID가 그물을 빠져나갔다: ${id}`).toBe(true);
      expect(사람이읽는문서제목(id), `내부 ID가 제목으로 나갔다: ${id}`).toBe("");
    }
  });

  // ⚠ 이 전수 시험은 이제 **제품과 같은 잣대**를 쓴다(내부ID꼴) — 그래서 잣대 자체가 좁아지면
  //   여기는 조용히 초록이다. **실제로 무는 자리는 ④⑥⑦의 글자 그대로 적힌 사례들**이고,
  //   이 전수는 「제품이 자기 잣대와 어긋나지 않는가」를 지키는 그물이다. 둘 다 있어야 한다.
  it("★★ 전수 — 어떤 입력을 줘도 **ID 꼴이 제목으로 나가지 않는다**", () => {
    사례심기("ic-k2bbbbbbbbbbbb", "사례 제목");
    개인문서심기("k2-3333", "개인 제목");
    const 입력들 = [
      "incident-case:ic-k2bbbbbbbbbbbb", "incident-case:ic-없는것", "personal:k2-3333", "personal:없는것",
      "store:abc#1", "foo-bar:baz-1", "a:b", "지침.md", "", "  ", null, undefined,
      // 한글 접두(2026-09-06) — 라이브에서 실제로 샌 꼴이다.
      "승인문답:dtmtl40khqg8uehk", "사례:ic-abc123", "개인:u1-9f8e",
    ];
    for (const id of 입력들) {
      const t = 사람이읽는문서제목(id as string);
      expect(내부ID꼴(t), `제목 자리에 내부 ID가 실렸다: ${id} → ${t}`).toBe(false);
    }
  });

  it("★ 접두 문자열이 incidentcases와 **글자 그대로 같다**(단일 출처)", () => {
    expect(incidentCaseDocId("ic-x")).toBe("incident-case:ic-x");
    사례심기("ic-k2cccccccccccc", "접두 대조용");
    // 접두가 갈리면 이 조회가 빈 문자열을 준다 — 그때 붉어진다.
    expect(사람이읽는문서제목(incidentCaseDocId("ic-k2cccccccccccc"))).toBe("[사례] 접두 대조용");
  });
});
