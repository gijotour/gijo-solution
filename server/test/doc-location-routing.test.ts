// 라이트 게이트 실패 2건의 라우팅 수리 (2026-08-13 · 전-4 정직성 연장)
//
// ① 「내가 넣은 자료 뭐뭐 있어?」가 어떤 규칙에도 안 걸려 LLM이 **빈 DB에서 존재하지 않는
//    문서 대장을 지어냈다**(CrowdStrike 보고서·날짜·제출자 — 번들 기능설명 문서가 RAG에 잡혀
//    #8 배너도 안 붙는 사각). 재고 질문은 등록부를 직접 세는 knowledge_status로 못박는다.
// ② 「방화벽 매뉴얼 어디 있더라」는 도구 없이 자유작문(「할 일 추가로 찾을 수 있습니다」 헛길).
//    문서 소재 질문은 통합 검색(search)이 답한다.
import { describe, it, expect } from "vitest";
import { forcedToolFor } from "../src/engine/agentloop";

const admin = { role: "admin" as const };

describe("문서 소재 질문 → search (라이트 게이트 lt-search-1)", () => {
  it("「방화벽 매뉴얼 어디 있더라」 — 검색어는 어디 앞의 대상만", () => {
    const r = forcedToolFor("방화벽 매뉴얼 어디 있더라", admin);
    expect(r?.tool).toBe("search");
    expect(r?.args.query).toBe("방화벽 매뉴얼");
  });

  it("「SonicWall 설정 가이드 어디 있어?」", () => {
    const r = forcedToolFor("SonicWall 설정 가이드 어디 있어?", admin);
    expect(r?.tool).toBe("search");
    expect(r?.args.query).toBe("SonicWall 설정 가이드");
  });

  it("화면 소재 질문은 안 삼킨다 — 「자산 화면 어디 있어?」는 화면 안내 영토", () => {
    expect(forcedToolFor("자산 화면 어디 있어?", admin)?.tool).not.toBe("search");
  });

  it("법령 소재 질문은 안 삼킨다 — 법제처 영토", () => {
    expect(forcedToolFor("망분리 의무 법령 자료 어디 있어?", admin)?.tool).not.toBe("search");
  });
});

describe("넣은 자료 재고 → knowledge_status (라이트 게이트 lt-kb-1)", () => {
  it("「내가 넣은 자료 뭐뭐 있어?」 — 등록부를 직접 센다(지어내지 않는다)", () => {
    expect(forcedToolFor("내가 넣은 자료 뭐뭐 있어?", admin)?.tool).toBe("knowledge_status");
  });

  it("「새로 넣은 파일 뭐 있어?」", () => {
    expect(forcedToolFor("새로 넣은 파일 뭐 있어?", admin)?.tool).toBe("knowledge_status");
  });

  it("영토 보존 — 「최근 들어온 문서 뭐 있어?」는 여전히 반입 소식(recent_documents)", () => {
    // 「들어온」은 knowledge_status 어휘에 없어야 한다(2026-08-06 경계) — 이번 확장이 침범 안 했나.
    expect(forcedToolFor("최근 들어온 문서 뭐 있어?", admin)?.tool).toBe("recent_documents");
  });
});
