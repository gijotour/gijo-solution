// engine/ontology.ts — 하이브리드 지식모델의 온톨로지(지식 그래프) 계층.
//
// 지식모델 전체 그림:
//   · 단기 기억 = 대화 이력 (llm.ts, 휘발성)
//   · 장기 기억 = 벡터 RAG (memory.ts / LanceDB) — "의미가 비슷한 문장"을 유사도로 검색
//   · 온톨로지 = 이 파일 — 엔티티 사이의 "명시적 관계·규칙"을 트리플(주어-술어-목적어)로 저장
//
// 벡터 RAG는 "왜 이게 검색됐는지"를 설명하기 어렵다(코사인 거리일 뿐). 온톨로지는 그 반대다:
// (관리자API)-[접근권한]->(보안운영팀) 같은 관계를 명시적으로 두어, LLM이 "이 요청은 보안운영팀만
// 접근 가능한 관리자API라 차단했다"처럼 근거를 추적·설명하게 한다(인핸스 조언의 '추론 투명성').
//
// 하이브리드 동작: llm.ts의 RAG 관문(ragContextFor)이 벡터 검색으로 청크를 찾은 뒤, 그 청크와
// 질문에 등장하는 엔티티를 이 모듈이 그래프에서 찾아 1~2홉 관계를 "관련 규칙·관계"로 동반 주입한다.
// 새 인프라(Neo4j 등) 없이 기존 SQLite(better-sqlite3)에 트리플을 담는다 — 온프레미스 원칙 유지.

import type { Express } from "express";
import { randomUUID } from "crypto";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";

// memory.ts와 동일한 스코프 규칙 — 'global'은 모든 에이전트가 공유, 그 외는 해당 agentId 전용 지식.
export const GLOBAL_SCOPE = "global";

// 1글자 엔티티는 부분문자열 매칭 시 오탐(예: '망'이 '희망'에 걸림)이 심해 시드에서 제외한다.
const MIN_ENTITY_LEN = 2;

// 엔티티 매칭용 정규화 — 공백·구분점(·•・-/)을 지우고 소문자화한다. 엔티티명이 "벡터 DB·임베딩 유출"처럼
// 가운뎃점/공백을 포함해도 사용자가 "벡터 DB 임베딩 유출"로 자연스럽게 쳤을 때 걸리게 하는 게 목적.
function normalizeForMatch(s: string): string {
  return s.replace(/[\s·•・\-/]/g, "").toLowerCase();
}

export interface Triple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  scope: string;
  source: string | null;
  createdAt: number;
}

export interface TripleInput {
  subject: string;
  predicate: string;
  object: string;
  scope?: string;
  source?: string;
}

// agentId를 주면 "그 에이전트 전용 + 전역" 지식만, 없으면 전역만. memory.queryMemory와 같은 격리 원칙.
function scopesFor(agentId?: string): string[] {
  return agentId && agentId !== GLOBAL_SCOPE ? [GLOBAL_SCOPE, agentId] : [GLOBAL_SCOPE];
}

export function addTriple(input: TripleInput): Triple {
  const subject = input.subject?.trim();
  const predicate = input.predicate?.trim();
  const object = input.object?.trim();
  if (!subject || !predicate || !object) {
    throw new Error("subject, predicate, object는 모두 필요합니다");
  }
  const row: Triple = {
    id: randomUUID(),
    subject,
    predicate,
    object,
    scope: input.scope?.trim() || GLOBAL_SCOPE,
    source: input.source?.trim() || null,
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO ontology_triples (id, subject, predicate, object, scope, source, createdAt)
     VALUES (@id, @subject, @predicate, @object, @scope, @source, @createdAt)`
  ).run(row);
  return row;
}

// 트랜잭션 일괄 삽입 — 온톨로지 시드(문서 → 트리플 추출 결과)를 한 번에 넣을 때.
export function addTriples(inputs: TripleInput[]): Triple[] {
  const tx = db.transaction((list: TripleInput[]) => list.map((i) => addTriple(i)));
  return tx(inputs);
}

export function listTriples(filter?: { scope?: string; subject?: string; source?: string }): Triple[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter?.scope) {
    clauses.push("scope = @scope");
    params.scope = filter.scope;
  }
  if (filter?.subject) {
    clauses.push("subject = @subject");
    params.subject = filter.subject;
  }
  if (filter?.source) {
    // 문서 파일별 관리 화면의 "이 파일이 만든 연결"용 — source="doc:<파일명>"으로 조회(2026-07-25).
    clauses.push("source = @source");
    params.source = filter.source;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM ontology_triples ${where} ORDER BY createdAt DESC`)
    .all(params) as Triple[];
}

export function deleteTriple(id: string): boolean {
  return db.prepare("DELETE FROM ontology_triples WHERE id = ?").run(id).changes > 0;
}

// 특정 출처의 트리플을 모두 제거 — 시드(자동 생성 트리플) 재적재를 멱등하게 만들 때 쓴다.
export function deleteTriplesBySource(source: string): number {
  return db.prepare("DELETE FROM ontology_triples WHERE source = ?").run(source).changes;
}

export function countTriples(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM ontology_triples").get() as { n: number }).n;
}

// 하이브리드 확장의 핵심. 주어진 텍스트(질문 + 벡터 RAG가 찾아온 청크)에서 온톨로지에 등록된
// 엔티티를 부분문자열로 탐지해 시드로 삼고, 거기서 hops만큼 관계를 따라가며 관련 트리플을 모은다.
// 한국어는 공백 토큰화가 불안정하므로(형태소 분석기 없이) 부분문자열 매칭을 쓴다.
export function expandOntology(
  text: string,
  agentId?: string,
  opts?: { hops?: number; limit?: number }
): Triple[] {
  const hops = opts?.hops ?? 2;
  const limit = opts?.limit ?? 12;
  const scopes = scopesFor(agentId);
  const placeholders = scopes.map(() => "?").join(", ");
  const all = db
    .prepare(`SELECT * FROM ontology_triples WHERE scope IN (${placeholders})`)
    .all(...scopes) as Triple[];
  if (all.length === 0 || !text) return [];

  // 시드 엔티티: 텍스트에 실제로 등장하는 주어/목적어. 정규화 후 부분문자열로 비교해
  // 공백/가운뎃점 차이를 흡수한다.
  const normText = normalizeForMatch(text);
  const seen = new Set<string>();
  const frontierInit = new Set<string>();
  const mentions = (entity: string) => {
    if (entity.length < MIN_ENTITY_LEN) return false;
    const n = normalizeForMatch(entity);
    return n.length >= MIN_ENTITY_LEN && normText.includes(n);
  };
  for (const t of all) {
    if (mentions(t.subject)) frontierInit.add(t.subject);
    if (mentions(t.object)) frontierInit.add(t.object);
  }
  if (frontierInit.size === 0) return [];
  for (const e of frontierInit) seen.add(e);

  // BFS 홉 확장 — 시드에 연결된 트리플을 모으고, 새로 만난 엔티티를 다음 홉의 시작점으로.
  const collected = new Map<string, Triple>();
  let frontier = frontierInit;
  for (let hop = 0; hop < hops && frontier.size > 0 && collected.size < limit; hop++) {
    const next = new Set<string>();
    for (const t of all) {
      if (collected.size >= limit) break;
      if (frontier.has(t.subject) || frontier.has(t.object)) {
        if (!collected.has(t.id)) collected.set(t.id, t);
        if (!seen.has(t.subject)) { seen.add(t.subject); next.add(t.subject); }
        if (!seen.has(t.object)) { seen.add(t.object); next.add(t.object); }
      }
    }
    frontier = next;
  }
  return Array.from(collected.values()).slice(0, limit);
}

// llm.ts가 시스템 프롬프트에 붙일, 사람이 읽는 컨텍스트 블록. 관련 트리플이 없으면 null.
// RAG 청크(벡터 검색 결과)와 질문 양쪽에서 엔티티를 찾으므로, 벡터 검색이 비어도 규칙이 걸릴 수 있다.
export function ontologyContextFor(
  question: string,
  ragChunks: string[],
  agentId?: string
): string | null {
  const haystack = [question, ...ragChunks].join("\n");
  const triples = expandOntology(haystack, agentId);
  if (triples.length === 0) return null;
  const lines = triples.map(
    (t) => `- ${t.subject} —[${t.predicate}]→ ${t.object}${t.source ? ` (출처: ${t.source})` : ""}`
  );
  return (
    "관련 규칙·관계 — 사내 온톨로지(지식 그래프)에서 위 자료·질문과 연결된 명시적 관계입니다. " +
    "판단의 근거로 삼고, 답변할 때 어떤 규칙·관계에 따랐는지 함께 밝히세요.\n" +
    lines.join("\n")
  );
}

export function registerOntologyRoutes(app: Express): void {
  app.post(
    "/api/ontology/triple",
    authMiddleware,
    asyncRoute(async (req, res) => {
      // 입력 검증(2026-07-23): addTriple의 throw가 500으로 나가던 것을 400+안내로.
      if (!String(req.body?.subject ?? "").trim() || !String(req.body?.predicate ?? "").trim() || !String(req.body?.object ?? "").trim()) {
        res.status(400).json({ error: "주어(subject)·관계(predicate)·대상(object)을 모두 입력하세요" });
        return;
      }
      res.json(addTriple(req.body));
    })
  );
  // 일괄 등록 — { triples: [...] } 또는 배열 그대로 허용.
  app.post(
    "/api/ontology/triples",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const list = Array.isArray(req.body) ? req.body : req.body?.triples;
      if (!Array.isArray(list)) {
        res.status(400).json({ error: "triples 배열이 필요합니다" });
        return;
      }
      res.json(addTriples(list));
    })
  );
  app.get(
    "/api/ontology/triples",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(
        listTriples({
          scope: req.query.scope as string | undefined,
          subject: req.query.subject as string | undefined,
          source: req.query.source as string | undefined,
        })
      );
    })
  );
  app.delete(
    "/api/ontology/triple/:id",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json({ deleted: deleteTriple(req.params.id) });
    })
  );
  // 확장 미리보기 — 특정 질문/텍스트에 어떤 규칙이 동반 주입될지 화면에서 확인·디버깅용.
  app.post(
    "/api/ontology/expand",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const text: string = req.body?.text ?? req.body?.question ?? "";
      res.json(expandOntology(text, req.body?.agentId, { hops: req.body?.hops, limit: req.body?.limit }));
    })
  );
  // 그래프 개요 — 전체 트리플 수(화면 상태 표시용).
  app.get(
    "/api/ontology/stats",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json({ count: countTriples() });
    })
  );
  // 샘플 지식 적재 — KISA AI 보안 위협 카탈로그를 트리플로 변환해 넣는다(멱등). 화면 버튼용.
  app.post(
    "/api/ontology/seed",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      const { seedOntologyFromCatalog } = await import("./ontology-seed.js");
      res.json(seedOntologyFromCatalog());
    })
  );
}
