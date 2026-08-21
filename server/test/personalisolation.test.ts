// LLM 위키 격리 1요건(2026-08-20 사장님 지시·판단 확정) — 개인 문서는 검색 쿼리 레벨에서
// 하드 필터된다. RAG 오염 53% 실사고의 개인판(「내 메모가 동료 답변에 샌다」)을 원천 봉쇄.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../src/db";
import { hiddenDocIds, recentDocCount } from "../src/engine/memory";

function 개인문서심기(id: string, userId: string, shared = false): void {
  db.prepare("INSERT OR REPLACE INTO personal_docs (id, userId, title, body, ragOptIn, shared, createdAt, updatedAt) VALUES (?, ?, '메모', '내용', 1, ?, 1, 1)")
    .run(id, userId, shared ? 1 : 0);
  db.prepare("INSERT OR REPLACE INTO memory_documents (documentId, scope, chunks, embeddingModel, ingestedAt, uploadedBy) VALUES (?, 'global', 1, 'test', 1, ?)")
    .run(`personal:${id}`, userId);
}

describe("개인 문서 검색 격리 — hiddenDocIds 하드 필터", () => {
  beforeEach(() => {
    db.exec("DELETE FROM personal_docs; DELETE FROM memory_documents WHERE documentId LIKE 'personal:%'");
  });
  // ⚠ 뒷정리 필수 — 같은 워커의 다음 시험 파일(gradeblock 등)이 이 표본을 보면
  //   「viewer 없으면 안 가림」 옛 계약 검사가 개인 문서 fail-closed에 걸려 넘어진다.
  afterEach(() => {
    db.exec("DELETE FROM personal_docs; DELETE FROM memory_documents WHERE documentId LIKE 'personal:%'");
  });

  it("남의 개인 문서는 검색 후보에서 원천 제외, 내 것은 보인다", () => {
    개인문서심기("d1", "userA");
    expect(hiddenDocIds({ userId: "userB" })).toContain("personal:d1");
    expect(hiddenDocIds({ userId: "userA" })).not.toContain("personal:d1");
  });

  it("viewer를 모르면 개인 문서 전부를 가린다 — fail-closed(무기명·내부 호출)", () => {
    개인문서심기("d2", "userA");
    expect(hiddenDocIds(undefined)).toContain("personal:d2");
    expect(hiddenDocIds({})).toContain("personal:d2");
  });

  it("회사에 공유(shared)한 것만 전 담당자에게 보인다 — 해제하면 다시 가려진다", () => {
    개인문서심기("d3", "userA", true);
    expect(hiddenDocIds({ userId: "userB" })).not.toContain("personal:d3");
    db.prepare("UPDATE personal_docs SET shared = 0 WHERE id = 'd3'").run();
    expect(hiddenDocIds({ userId: "userB" })).toContain("personal:d3");
  });

  it("개인 문서가 없으면 종전(등급만) 동작 그대로 — 빈 배열", () => {
    expect(hiddenDocIds(undefined)).toEqual([]);
  });
});

// 반입 배지 COUNT(recentDocCount) — 오늘 필터 + 격리가 **목록 라우트(남의개인문서인가)와 같은
//   규칙**인지 잠근다(2026-08-21 검토관 4갈래 적발: 배지만 공유 예외를 빠뜨려 목록엔 뜨는데 배지엔
//   안 세어졌다). 이 시험이 있으면 다음에 누가 SQL을 손대도 격리가 조용히 갈리지 못한다.
describe("반입 배지 COUNT — 오늘 필터 + 개인문서 격리", () => {
  const 자정 = "2026-08-21T00:00:00.000Z";
  const 어제 = "2026-08-20T10:00:00.000Z";
  const 오늘 = "2026-08-21T09:00:00.000Z";
  function 회사문서(id: string, ingestedAt: string, origin: string | null = null): void {
    db.prepare("INSERT OR REPLACE INTO memory_documents (documentId, scope, chunks, embeddingModel, ingestedAt, uploadedBy, origin) VALUES (?, 'global', 1, 'test', ?, 'sys', ?)")
      .run(id, ingestedAt, origin);
  }
  function 개인문서(id: string, userId: string, ingestedAt: string, shared: boolean): void {
    db.prepare("INSERT OR REPLACE INTO personal_docs (id, userId, title, body, ragOptIn, shared, createdAt, updatedAt) VALUES (?, ?, 'm', 'b', 1, ?, 1, 1)")
      .run(id, userId, shared ? 1 : 0);
    db.prepare("INSERT OR REPLACE INTO memory_documents (documentId, scope, chunks, embeddingModel, ingestedAt, uploadedBy) VALUES (?, 'global', 1, 'test', ?, ?)")
      .run(`personal:${id}`, ingestedAt, userId);
  }
  const 청소 = () => db.exec("DELETE FROM personal_docs; DELETE FROM memory_documents WHERE documentId LIKE 'personal:%' OR documentId LIKE 'badge:%'");
  beforeEach(청소);
  afterEach(청소);

  it("오늘 반입한 회사 문서만 세고, 어제 것·내장 문서는 안 센다", () => {
    회사문서("badge:a", 오늘);
    회사문서("badge:old", 어제);
    회사문서("badge:builtin", 오늘, "builtin");
    expect(recentDocCount(자정, "userA")).toBe(1);
  });

  it("남의 미공유 개인문서는 안 세고, 공유된 것·내 것은 센다 — 목록 필터와 같은 규칙", () => {
    개인문서("p1", "userB", 오늘, false); // 남의 미공유 → 제외
    개인문서("p2", "userB", 오늘, true);  // 공유 → 포함
    개인문서("p3", "userA", 오늘, false); // 내 것 → 포함
    expect(recentDocCount(자정, "userA")).toBe(2);
  });

  it("since가 비면 0 — 배지가 켜지기 전 안전값", () => {
    회사문서("badge:a", 오늘);
    expect(recentDocCount("", "userA")).toBe(0);
  });
});

// 검토관 하13 — hiddenDocIds만 재던 시험이 syncRag 무동작(상1)·마스킹 부재(상2)를 못 잡았다.
// 인입 결정을 순수 함수(인입본문)로 떼어 직접 잰다.
import { 인입본문 } from "../src/engine/personaldocs";

describe("개인 문서 인입 결정(인입본문) — 공유·마스킹 계약", () => {
  // secretscan은 「이름: 값」 꼴을 잡는다("비밀번호: xxx") — 설명문·이름 없는 값은 원리상 못 잡는다.
  const 원문 = "장비 접속 메모 — 비밀번호: Passw0rd!23 (교체 예정)";

  it("둘 다 꺼짐 → null(지식에서 뺀다)", () => {
    expect(인입본문({ title: "t", body: 원문, ragOptIn: false, shared: false })).toBeNull();
  });

  it("AI 포함(나만) → 원문 그대로 — 격리 필터가 남을 막는다", () => {
    const t = 인입본문({ title: "t", body: 원문, ragOptIn: true, shared: false });
    expect(t).toContain("Passw0rd!23");
  });

  it("회사 공유 → 비밀은 가려 담는다(마스킹) — 원문 비밀번호가 전역 지식에 못 들어간다", () => {
    const t = 인입본문({ title: "t", body: 원문, ragOptIn: false, shared: true });
    expect(t).not.toBeNull();
    expect(t!, "공유본에 비밀번호 원문이 남아 있다 — 상2 재발").not.toContain("Passw0rd!23");
  });

  it("공유 중이면 AI 포함을 꺼도 지식에서 빠지지 않는다(중5 — 공유가 조용히 깨지던 것)", () => {
    expect(인입본문({ title: "t", body: 원문, ragOptIn: false, shared: true })).not.toBeNull();
  });
});
