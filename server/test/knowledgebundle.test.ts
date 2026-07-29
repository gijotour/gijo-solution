// 기본 지식 번들(계획서 전-4, 2026-07-29) — 버전·멱등·무결성.
// [전중후 계획서 정렬] 전-4의 약속: "설치하면 빈 깡통 아님"이 버전 붙은 상태로 추적된다.
import { describe, it, expect, vi, beforeEach } from "vitest";

// 실제 재시드·문서 인입은 무겁다 — 호출 여부와 상태 기록만 검증한다(멱등성 자체는 각 모듈의 시험 몫).
const seedMock = vi.fn(() => ({ inserted: 1980, sources: ["s1", "s2"] }));
vi.mock("../src/engine/ontology-seed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/ontology-seed")>()),
  seedOntologyFromCatalog: () => seedMock(),
}));
const docsMock = vi.fn(async () => ({ ingested: ["a.md"], skipped: ["b.md", "c.md"], missing: [], failed: [] }));
vi.mock("../src/engine/docsbundle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/docsbundle")>()),
  bootstrapDocsBundle: () => docsMock(),
}));

import {
  KNOWLEDGE_BUNDLE_VERSION, applyKnowledgeBundle, getAppliedBundle, getBundleStatus, ensureKnowledgeBundle,
} from "../src/engine/knowledgebundle";
import { db } from "../src/db";

beforeEach(() => {
  seedMock.mockClear();
  docsMock.mockClear();
  db.prepare("DELETE FROM app_state WHERE key = 'knowledgeBundle:applied'").run();
});

describe("기본 지식 번들", () => {
  it("적용하면 버전·건수가 상태로 남고 두 멱등 경로가 모두 돈다", async () => {
    const s = await applyKnowledgeBundle("시험자");
    expect(s.version).toBe(KNOWLEDGE_BUNDLE_VERSION);
    expect(s.triples).toBe(1980);
    expect(s.docsIngested).toBe(1);
    expect(s.docsSkipped).toBe(2);
    expect(seedMock).toHaveBeenCalledTimes(1);
    expect(docsMock).toHaveBeenCalledTimes(1);
    expect(getAppliedBundle()?.version).toBe(KNOWLEDGE_BUNDLE_VERSION);
  });

  it("부팅 확인: 같은 버전이면 아무것도 다시 하지 않는다", async () => {
    await applyKnowledgeBundle("시험자");
    seedMock.mockClear();
    docsMock.mockClear();
    await ensureKnowledgeBundle();
    expect(seedMock).not.toHaveBeenCalled();
    expect(docsMock).not.toHaveBeenCalled();
  });

  it("부팅 확인: 버전이 다르면(구판 상태) 자동 적용된다", async () => {
    db.prepare("INSERT INTO app_state (key, value) VALUES ('knowledgeBundle:applied', ?)").run(
      JSON.stringify({ version: "2026.06-1", at: 1, triples: 0, docsIngested: 0, docsSkipped: 0 })
    );
    await ensureKnowledgeBundle();
    expect(seedMock).toHaveBeenCalledTimes(1);
    expect(getAppliedBundle()?.version).toBe(KNOWLEDGE_BUNDLE_VERSION);
  });

  it("상태는 주장이 아니라 실측 — 온톨로지 트리플을 DB에서 직접 센다", () => {
    const st = getBundleStatus();
    expect(st.bundleVersion).toBe(KNOWLEDGE_BUNDLE_VERSION);
    expect(typeof st.ontology.triples).toBe("number");
    expect(Array.isArray(st.docs.fingerprints)).toBe(true);
    // 매니페스트에 편입한 지식 문서가 지문 목록에 있어야 한다(전-4의 핵심 편입분)
    expect(st.docs.fingerprints.some((f) => f.file.includes("knowledge/"))).toBe(true);
  });

  it("적용 실패는 기동을 막지 않는다(부팅 훅은 삼킨다)", async () => {
    docsMock.mockRejectedValueOnce(new Error("임베딩 서버 미기동"));
    await expect(ensureKnowledgeBundle()).resolves.toBeUndefined();
    expect(getAppliedBundle()).toBeNull(); // 실패했으니 적용 표시도 없어야 한다(거짓 완료 금지)
  });
});
