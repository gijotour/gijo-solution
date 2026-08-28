// 문서 보강 인입 — 클라우드/로컬/수동 3모드 + 내부정보 차단 검증(실 서비스는 대역으로).
import { describe, it, expect, beforeEach, vi } from "vitest";

// 클라우드/로컬 호출과 저장(임베딩)·온톨로지를 대역으로 두고 "무엇을 저장하는지"를 본다.
const cloudSpy = vi.fn(async () => JSON.stringify({ korean: "한글 번역 결과", triples: [{ subject: "로그A", predicate: "의미", object: "설명" }] }));
vi.mock("../src/engine/cloudllm", () => ({ cloudComplete: (...a: unknown[]) => cloudSpy(...(a as [])) }));

const chatSpy = vi.fn(async () => JSON.stringify({ korean: "로컬 번역", triples: [] }));
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0), chat: (...a: unknown[]) => chatSpy(...(a as [])), registerLlmRoutes: vi.fn(), embed: vi.fn(), systemPromptFor: vi.fn() }));

const ingestSpy = vi.fn(async (documentId: string) => ({ documentId, chunks: 1, embeddingModel: "mock", scope: "global" }));
const addTriplesSpy = vi.fn((arr: unknown[]) => arr);
vi.mock("../src/engine/memory", () => ({ ingestText: (id: string, ...r: unknown[]) => ingestSpy(id, ...(r as [])), GLOBAL_SCOPE: "global" }));
vi.mock("../src/engine/ontology", () => ({ addTriples: (a: unknown[]) => addTriplesSpy(a) }));
vi.mock("../src/engine/collaboration", () => ({ emitCollaboration: vi.fn() }));

import { enrichAndIngest } from "../src/engine/docenrich";

beforeEach(() => { cloudSpy.mockClear(); chatSpy.mockClear(); ingestSpy.mockClear(); addTriplesSpy.mockClear(); });

describe("docenrich — 문서 보강 인입 3모드", () => {
  it("cloud 모드: 클라우드로 번역·구조화해 RAG+온톨로지에 저장한다", async () => {
    const r = await enrichAndIngest({ text: "English manual excerpt", productName: "Tenable SC", sourceDoc: "guide", section: "알림", mode: "cloud" });
    expect(cloudSpy).toHaveBeenCalledTimes(1);
    expect(chatSpy).not.toHaveBeenCalled();
    expect(r.via).toBe("cloud");
    expect(r.triples).toBe(1);
    const [, content] = ingestSpy.mock.calls[0];
    expect(content).toContain("한글 번역 결과");
  });

  it("local 모드: 클라우드를 안 쓰고 온프렘 LLM으로 처리한다(폐쇄망)", async () => {
    const r = await enrichAndIngest({ text: "English excerpt", productName: "Tenable SC", sourceDoc: "guide", section: "스캔", mode: "local" });
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(cloudSpy).not.toHaveBeenCalled();
    expect(r.via).toBe("local");
  });

  it("manual 모드: 사람이 작성한 한글·트리플을 AI 없이 그대로 저장한다", async () => {
    const r = await enrichAndIngest({
      text: "", productName: "Tenable SC", sourceDoc: "장애노트", section: "스캔 멈춤", mode: "manual",
      korean: "증상→해결 정리", triples: [{ subject: "스캔 멈춤", predicate: "해결", object: "Resume Schedule" }],
    });
    expect(cloudSpy).not.toHaveBeenCalled();
    expect(chatSpy).not.toHaveBeenCalled();
    expect(r.via).toBe("manual");
    expect(r.triples).toBe(1);
    const [, content] = ingestSpy.mock.calls[0];
    expect(content).toContain("증상→해결 정리");
  });

  it("내부정보가 있으면 클라우드로 안 보내고 로컬로 폴백한다", async () => {
    // 사설 IP가 든 텍스트 → screenForCloud가 막음 → auto 모드라도 클라우드 호출 없이 로컬로.
    const r = await enrichAndIngest({ text: "server 10.0.0.5 config", productName: "X", sourceDoc: "s", section: "sec", mode: "auto" });
    expect(cloudSpy).not.toHaveBeenCalled();
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(r.via).toBe("local");
  });
});
