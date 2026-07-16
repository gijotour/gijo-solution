import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import {
  addTriple,
  addTriples,
  listTriples,
  deleteTriple,
  expandOntology,
  ontologyContextFor,
} from "../src/engine/ontology";

// vitest.config.ts가 GIJO_DB_PATH=:memory:로 격리 — 디스크에 아무것도 안 남는다.
// 워커 하나가 여러 테스트를 돌 수 있으므로 매 테스트 전에 트리플 테이블을 비운다.
beforeEach(() => {
  db.exec("DELETE FROM ontology_triples");
});

describe("ontology (온톨로지 / 지식 그래프) — 하이브리드 지식모델의 의미 계층", () => {
  it("트리플 CRUD 왕복 — 저장·조회·삭제", () => {
    const t = addTriple({ subject: "SQL인젝션", predicate: "완화기법", object: "입력검증" });
    expect(t.id).toBeTruthy();
    expect(t.scope).toBe("global");

    const listed = listTriples();
    expect(listed).toHaveLength(1);
    expect(listed[0].object).toBe("입력검증");

    expect(deleteTriple(t.id)).toBe(true);
    expect(listTriples()).toHaveLength(0);
    expect(deleteTriple("존재하지-않는-id")).toBe(false);
  });

  it("subject/predicate/object 중 하나라도 비면 거부한다", () => {
    expect(() => addTriple({ subject: "", predicate: "완화기법", object: "입력검증" })).toThrow();
    expect(() => addTriple({ subject: "A", predicate: " ", object: "B" })).toThrow();
  });

  it("expandOntology: 질문에 등장한 엔티티의 1홉 관계를 찾는다", () => {
    addTriple({ subject: "관리자API", predicate: "접근권한", object: "보안운영팀" });
    addTriple({ subject: "결제API", predicate: "접근권한", object: "결제팀" }); // 무관 — 걸리면 안 됨

    const hits = expandOntology("관리자API 호출을 왜 차단했나요?");
    expect(hits).toHaveLength(1);
    expect(hits[0].object).toBe("보안운영팀");
  });

  it("expandOntology: 관계를 따라 2홉까지 확장한다 (그래프 탐색)", () => {
    // SQL인젝션 → 입력검증 → 화이트리스트 로 이어지는 사슬.
    addTriple({ subject: "SQL인젝션", predicate: "완화기법", object: "입력검증" });
    addTriple({ subject: "입력검증", predicate: "권장방식", object: "화이트리스트" });
    addTriple({ subject: "무관엔티티", predicate: "관계", object: "무관대상" });

    const hits = expandOntology("SQL인젝션 대응 방법은?", undefined, { hops: 2 });
    const objects = hits.map((h) => h.object);
    expect(objects).toContain("입력검증"); // 1홉
    expect(objects).toContain("화이트리스트"); // 2홉 (입력검증을 경유)
    expect(objects).not.toContain("무관대상");
  });

  it("scope 격리: 다른 에이전트 전용 트리플은 새지 않는다", () => {
    addTriple({ subject: "공통정책", predicate: "적용", object: "전사", scope: "global" });
    addTriple({ subject: "공통정책", predicate: "담당", object: "노말틱전용", scope: "normaltic" });

    // 에이전트 미지정 → 전역만
    const globalOnly = expandOntology("공통정책 관련");
    expect(globalOnly.map((t) => t.object)).toContain("전사");
    expect(globalOnly.map((t) => t.object)).not.toContain("노말틱전용");

    // normaltic 에이전트 → 전역 + 자기 전용
    const forNormaltic = expandOntology("공통정책 관련", "normaltic");
    const objs = forNormaltic.map((t) => t.object);
    expect(objs).toContain("전사");
    expect(objs).toContain("노말틱전용");

    // 다른 에이전트 → normaltic 전용은 안 보임
    const forOther = expandOntology("공통정책 관련", "monitoring");
    expect(forOther.map((t) => t.object)).not.toContain("노말틱전용");
  });

  it("ontologyContextFor: 벡터 RAG 청크에서 엔티티를 찾아 규칙을 동반 주입 payload로 만든다", () => {
    addTriple({ subject: "관리자API", predicate: "접근권한", object: "보안운영팀", source: "접근제어지침 3.2" });

    // 질문 자체엔 '관리자API'가 없지만, 벡터 RAG가 찾아온 청크에 있으면 걸려야 한다 (하이브리드 핵심).
    const ctx = ontologyContextFor(
      "이 요청을 처리해도 되나요?",
      ["로그 분석 결과 이 트래픽은 관리자API 엔드포인트를 향합니다."]
    );
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("관리자API");
    expect(ctx).toContain("보안운영팀");
    expect(ctx).toContain("접근제어지침 3.2"); // 출처(추론 투명성)
  });

  it("ontologyContextFor: 걸리는 엔티티가 없으면 null (RAG처럼 조용히 생략)", () => {
    addTriple({ subject: "관리자API", predicate: "접근권한", object: "보안운영팀" });
    expect(ontologyContextFor("오늘 점심 뭐 먹지", ["날씨가 좋다"])).toBeNull();
  });

  it("addTriples: 트랜잭션 일괄 삽입", () => {
    const rows = addTriples([
      { subject: "A", predicate: "r", object: "B" },
      { subject: "B", predicate: "r", object: "C" },
    ]);
    expect(rows).toHaveLength(2);
    expect(listTriples()).toHaveLength(2);
  });
});

describe("ontology 시드 — KISA 위협 카탈로그 → 트리플 (실제 도메인 데이터)", () => {
  it("카탈로그의 위협을 실제 매핑 그대로 트리플로 만든다", async () => {
    const { seedOntologyFromCatalog, SEED_SOURCE } = await import("../src/engine/ontology-seed");
    const { inserted } = seedOntologyFromCatalog();
    expect(inserted).toBeGreaterThan(20); // 위협 20건 × (코드+분류+영역+프레임워크 매핑들)

    // '탈옥'(M06)은 카탈로그에 있는 실제 위협 — 코드·OWASP 매핑이 트리플로 있어야 한다.
    const jailbreak = listTriples({ subject: "탈옥" });
    expect(jailbreak.some((t) => t.predicate === "위협코드" && t.object === "M06")).toBe(true);
    expect(jailbreak.some((t) => t.object.includes("LLM01:2025 Prompt Injection"))).toBe(true);
    expect(jailbreak.every((t) => t.source === SEED_SOURCE)).toBe(true);
  });

  it("공유 매핑(OWASP LLM01)을 통해 서로 다른 위협이 그래프로 연결된다", async () => {
    const { seedOntologyFromCatalog } = await import("../src/engine/ontology-seed");
    seedOntologyFromCatalog();
    // '탈옥'과 '에이전트 하이재킹'은 둘 다 LLM01:2025로 매핑 → 2홉이면 서로 닿는다.
    const hits = expandOntology("탈옥 대응이 궁금합니다", undefined, { hops: 2, limit: 50 });
    const subjects = new Set(hits.map((t) => t.subject));
    expect(subjects.has("탈옥")).toBe(true);
    expect(subjects.has("에이전트 하이재킹")).toBe(true); // LLM01 공유 노드를 경유
  });

  it("재적재는 멱등 — 시드 출처 트리플이 중복되지 않고 수동 입력분은 보존한다", async () => {
    const { seedOntologyFromCatalog } = await import("../src/engine/ontology-seed");
    addTriple({ subject: "수동규칙", predicate: "적용", object: "보존대상" }); // 손으로 넣은 것
    const first = seedOntologyFromCatalog();
    const second = seedOntologyFromCatalog();
    expect(second.inserted).toBe(first.inserted); // 두 번 넣어도 같은 수
    expect(listTriples({ subject: "수동규칙" })).toHaveLength(1); // 수동 입력분 보존
  });

  it("완화통제 시드는 위협 노드에 직접 붙어 접근제어가 위협과 그래프로 연결된다", async () => {
    const { seedOntologyFromCatalog } = await import("../src/engine/ontology-seed");
    seedOntologyFromCatalog();
    // '벡터 DB·임베딩 유출'(M02) 위협에서 확장하면 완화통제(문서단위 접근제어)가 함께 나와야 한다.
    const hits = expandOntology("벡터 DB 임베딩 유출을 어떻게 막나요?", undefined, { hops: 1, limit: 50 });
    const objs = hits.map((t) => t.object);
    expect(objs.some((o) => o.includes("문서 단위 접근제어"))).toBe(true);
    expect(hits.some((t) => t.predicate === "완화통제")).toBe(true);
  });

  it("보안제품 카탈로그 시드 — 라벨 괄호에서 기능을 파싱한다", async () => {
    const { seedOntologyFromCatalog } = await import("../src/engine/ontology-seed");
    seedOntologyFromCatalog();
    const edr = listTriples({ subject: "EDR" });
    expect(edr.some((t) => t.predicate === "기능" && t.object === "단말탐지대응")).toBe(true);
    expect(edr.some((t) => t.predicate === "유형" && t.object === "보안제품")).toBe(true);
    expect(listTriples({ subject: "기타" })).toHaveLength(0); // '기타'는 제외
  });

  it("취약점 분류 시드 — 생애주기 루프·CVSS 밴드·우선순위 지표가 들어간다", async () => {
    const { vulnClassificationTriples, seedOntologyFromCatalog, VULN_SOURCE } = await import("../src/engine/ontology-seed");
    seedOntologyFromCatalog();

    // 생애주기 4단계가 루프로 연결(측정 → 발견·평가)
    const lifecycle = listTriples({ subject: "취약점 관리" }).filter((t) => t.predicate === "생애주기");
    expect(lifecycle).toHaveLength(4);
    expect(listTriples({ subject: "측정" }).some((t) => t.predicate === "다음단계" && t.object === "발견·평가")).toBe(true);

    // CVSS Critical 밴드
    expect(listTriples({ subject: "Critical" }).some((t) => t.object === "9.0–10.0")).toBe(true);

    // 우선순위 판단 지표에 CISA KEV 포함 + 의미
    const prio = listTriples({ subject: "취약점 우선순위" }).map((t) => t.object);
    expect(prio).toContain("CISA KEV");
    expect(listTriples({ subject: "CISA KEV" }).some((t) => t.object.includes("실제 악용"))).toBe(true);

    // 전부 지침 출처로 태깅
    expect(vulnClassificationTriples().every((t) => t.source === VULN_SOURCE)).toBe(true);
  });

  it("취약점 확장 — 'EPSS 우선순위' 질문에 지표·정의가 함께 나온다", async () => {
    const { seedOntologyFromCatalog } = await import("../src/engine/ontology-seed");
    seedOntologyFromCatalog();
    const hits = expandOntology("EPSS로 취약점 우선순위를 어떻게 정하나요?", undefined, { hops: 2, limit: 40 });
    const objs = hits.map((t) => t.object);
    expect(objs.some((o) => o.includes("악용 확률"))).toBe(true); // EPSS 의미
    expect(objs).toContain("VPR"); // 우선순위 지표로 연결
  });
});
