// 중복 문서 후보(표시만) — [2026-08-07 · 147상황 상비 질문인데 도구가 없던 미비]
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { 제목뿌리, findDuplicateDocs, duplicateDocsText } from "../src/engine/docdupe";
import { forcedToolFor } from "../src/engine/agentloop";

const 넣기 = (id: string, at = "2026-08-01T00:00:00Z") =>
  db.prepare("INSERT OR REPLACE INTO memory_documents (documentId, scope, chunks, embeddingModel, ingestedAt) VALUES (?, 'global', 3, 'bge-m3', ?)").run(id, at);

beforeEach(() => { db.prepare("DELETE FROM memory_documents WHERE documentId LIKE 'QA중복%'").run(); });

describe("제목뿌리 — 판박이 변형을 같은 뿌리로 본다", () => {
  it("버전·사본·날짜·(1)·확장자를 걷는다", () => {
    expect(제목뿌리("QA중복_방화벽매뉴얼_v1.2.pdf")).toBe(제목뿌리("QA중복 방화벽매뉴얼 (1).docx"));
    expect(제목뿌리("QA중복-방화벽매뉴얼-최종.pdf")).toBe(제목뿌리("qa중복_방화벽매뉴얼_사본2.PDF"));
    expect(제목뿌리("QA중복 보고서 2026-08-07.md")).toBe(제목뿌리("QA중복 보고서 20260101.md"));
  });
  it("다른 문서는 다른 뿌리다", () => {
    expect(제목뿌리("방화벽 매뉴얼.pdf")).not.toBe(제목뿌리("스위치 매뉴얼.pdf"));
  });
});

describe("중복 묶음 — 표시만 한다", () => {
  it("★ 같은 뿌리 2건 이상만 묶이고, 아무것도 지워지지 않는다", () => {
    넣기("QA중복_장비운영지침_v1.pdf");
    넣기("QA중복_장비운영지침_v2.pdf", "2026-08-05T00:00:00Z");
    넣기("QA중복_혼자인문서.pdf");
    const 전 = db.prepare("SELECT COUNT(*) AS n FROM memory_documents WHERE documentId LIKE 'QA중복%'").get() as { n: number };
    const g = findDuplicateDocs().filter((x) => x.docs.some((d) => d.documentId.startsWith("QA중복")));
    expect(g).toHaveLength(1);
    expect(g[0].docs.map((d) => d.documentId).sort()).toEqual(["QA중복_장비운영지침_v1.pdf", "QA중복_장비운영지침_v2.pdf"]);
    const 후 = db.prepare("SELECT COUNT(*) AS n FROM memory_documents WHERE documentId LIKE 'QA중복%'").get() as { n: number };
    expect(후.n, "보는 것만으로 문서가 지워졌다").toBe(전.n);
  });

  // ★ 2026-09-04: 개인 문서(personal:<uuid>)는 후보에서 뺀다. 이 도구는 viewer를 안 받아
  //   **누가 물었는지 모른다** — 남기면 남의 개인 메모가 아무에게나 간다(검색 격리의 옆문).
  //   이름도 「personal:<uuid>」라 사람이 못 읽고, 답 끝 안내(「문서 ○○ 지워줘」)도 안 통한다.
  it("개인 문서는 중복 후보에 들지 않는다 — 보는 사람을 모르는 창구다", () => {
    넣기("personal:qa1111_장비운영지침_v1.pdf");
    넣기("personal:qa1111_장비운영지침_v2.pdf");
    const 답 = duplicateDocsText();
    expect(답, "남의 개인 메모 이름이 답에 실렸다").not.toContain("personal:");
    expect(findDuplicateDocs().some((g) => g.docs.some((d) => d.documentId.startsWith("personal:")))).toBe(false);
    db.prepare("DELETE FROM memory_documents WHERE documentId LIKE 'personal:qa1111%'").run();
  });

  it("답에 「표시만·지우지 않았다」와 결재판 안내가 있다 / 없으면 없다고 말한다", () => {
    넣기("QA중복_지침_v1.pdf"); 넣기("QA중복_지침_v2.pdf");
    const t = duplicateDocsText();
    expect(t).toContain("지우지 않았습니다");
    expect(t).toContain("결재판");
    db.prepare("DELETE FROM memory_documents WHERE documentId LIKE 'QA중복%'").run();
  });
});

describe("라우팅 [51]", () => {
  it("조회는 잡고, 이웃(자산·로그인)은 안 삼킨다", () => {
    expect(forcedToolFor("중복된 문서 있어?")?.tool).toBe("doc_duplicates");
    expect(forcedToolFor("겹치는 문서 정리해야 해?")?.tool).toBe("doc_duplicates");
    expect(forcedToolFor("중복된 자산 있어?")?.tool).not.toBe("doc_duplicates");
    expect(forcedToolFor("중복 로그인 확인해줘")?.tool).not.toBe("doc_duplicates");
  });
});

describe("반입 알림 묶음 — 폴더째 반입이 협업 독을 도배하지 않는다(30건 스트레스 실측)", () => {
  it("★ 여러 건은 한 줄로, 단건은 예전 문구 그대로", async () => {
    const { 반입알림문구 } = await import("../src/engine/docdigest");
    const 여럿 = 반입알림문구({ 성공: 28, 실패: 2, 접점: 5, 첫문서: "a.pdf", 첫실패사유: "모델 다운" });
    expect(여럿).toContain("30건");
    expect(여럿).toContain("요약 실패 2건");
    expect(여럿, "낱개 문서명 나열 금지 — 그게 도배다").not.toContain("a.pdf");
    const 단건 = 반입알림문구({ 성공: 1, 실패: 0, 접점: 2, 첫문서: "CrowdStrike_보고서.pdf", 첫실패사유: null });
    expect(단건).toContain("「CrowdStrike_보고서.pdf」");
    expect(단건).toContain("접점 2건");
  });
});

describe("라우팅 [52] — 최근 추가 자산은 자산 도구로(문서 소식이 뺏던 실측)", () => {
  it("자산 낱말이 있으면 list_assets, 문서 질문은 그대로 문서 소식", () => {
    const r = forcedToolFor("최근에 추가된 자산 뭐야?");
    expect(r?.tool).toBe("list_assets");
    expect(r?.args.query).toContain("최근");
    expect(forcedToolFor("새로 등록된 장비 목록 보여줘")?.tool).toBe("list_assets");
    expect(forcedToolFor("최근 들어온 문서 뭐야?")?.tool, "[46]의 영토 보존").toBe("recent_documents");
  });
});
