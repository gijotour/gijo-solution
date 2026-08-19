// LLM 위키 격리 1요건(2026-08-20 사장님 지시·판단 확정) — 개인 문서는 검색 쿼리 레벨에서
// 하드 필터된다. RAG 오염 53% 실사고의 개인판(「내 메모가 동료 답변에 샌다」)을 원천 봉쇄.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../src/db";
import { hiddenDocIds } from "../src/engine/memory";

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
