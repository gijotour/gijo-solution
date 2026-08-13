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

import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import { db } from "../db";
import 별칭자료 from "./onto-aliases-ko.json";

// memory.ts와 동일한 스코프 규칙 — 'global'은 모든 에이전트가 공유, 그 외는 해당 agentId 전용 지식.
export const GLOBAL_SCOPE = "global";

// 1글자 엔티티는 부분문자열 매칭 시 오탐(예: '망'이 '희망'에 걸림)이 심해 시드에서 제외한다.
const MIN_ENTITY_LEN = 2;

// 엔티티 매칭용 정규화 — 공백·구분점(·•・-/)을 지우고 소문자화한다. 엔티티명이 "벡터 DB·임베딩 유출"처럼
// 가운뎃점/공백을 포함해도 사용자가 "벡터 DB 임베딩 유출"로 자연스럽게 쳤을 때 걸리게 하는 게 목적.
function normalizeForMatch(s: string): string {
  return s.replace(/[\s·•・\-/]/g, "").toLowerCase();
}

// ── 한국어 별칭 → 온톨로지 주어 (2026-08-13) ──────────────────────────────────
//
// ■ 왜 필요한가 — **온톨로지가 한국어로는 안 닿았다.** 위 매칭은 주어 이름이 질문 안에
//   그대로 들어 있어야 걸리는데, 주어 2,166건 중 한글이 든 것은 264건(12%)뿐이고
//   나머지는 영문 ATT&CK 코드명이다. 담당자는 「T1566 Phishing」을 외우고 있지 않다.
//   실측(`max`, 2026-08-13): `T1566 Phishing` 12건 · `T1566` **0건** · `피싱` **0건**.
// ■ ⚠ RAG의 「거리가 밀린다」와는 **다른 문제**다. 저쪽은 질의 재작성으로 되찾았지만
//   여기는 부분문자열 정확 매칭이라 **0이다** — 재작성으로도 안 된다. 낱말↔주어 사전이 답이다.
// ■ 왜 여기(expandOntology)에 두나 — 도구·화면·RAG 주입이 **전부 이 함수를 지난다.**
//   호출부마다 붙이면 새 호출부가 생기는 순간 샌다(이 저장소가 반복해 겪은 유형).
// ⚠ `require`가 아니라 **import**로 읽는다 — tsc(resolveJsonModule)가 이 형태만 .json을
//   dist로 함께 옮긴다. require로 뒀다가 빌드 후 dist에 파일이 없어 **운영에서 터질 뻔했다**
//   (2026-08-13, 배포 전 확인에서 잡음). lite-tools.json이 쓰는 방식과 같다.
const 별칭표: Record<string, string[]> = (별칭자료 as { 별칭?: Record<string, string[]> }).별칭 ?? {};
// 역인덱스: 정규화한 낱말 → 주어. **긴 낱말부터** 본다 — 「무차별 대입」이 「대입」보다 먼저
// 걸려야 한다(짧은 쪽이 먼저 먹으면 엉뚱한 주어가 붙는다).
const 별칭목록: { 낱말: string; 주어: string }[] = Object.entries(별칭표)
  .flatMap(([주어, 낱말들]) => 낱말들.map((낱말) => ({ 낱말: normalizeForMatch(낱말), 주어 })))
  .filter((x) => x.낱말.length >= MIN_ENTITY_LEN)
  .sort((a, b) => b.낱말.length - a.낱말.length);

/**
 * 정규화된 질문에서 한국어 별칭을 찾아 대응 주어를 돌려준다(겹치면 긴 낱말이 이긴다).
 *
 * ★ 2026-08-13 — **한 낱말이 여러 표준을 가리키는 것은 정상이다. 전부 돌려준다.**
 *
 *   ATLAS 별칭이 들어오자 같은 한국어 낱말이 두 주어를 가리키는 일이 18건 생겼다.
 *   같은 개념이 표준마다 있어서지, 사전이 틀린 게 아니다:
 *     「코드 서명」       = ATT&CK M1045 Code Signing    +  ATLAS AML.M0013 Code Signing
 *     「탈옥」           = OWASP LLM01 Prompt Injection +  ATLAS AML.T0054 LLM Jailbreak
 *     「프롬프트 인젝션」  = OWASP LLM01                 +  ATLAS AML.T0051
 *
 *   ⚠ 진짜 문제는 사전이 아니라 **아래 「자리 지우기」였다.** 먼저 걸린 하나가 자리를 지워
 *     나머지가 영영 안 걸렸고, 어느 쪽이 이기는지는 **JSON에 적힌 순서**에 달려 있었다.
 *     담당자가 「탈옥」을 물었을 때 OWASP로 갈지 ATLAS로 갈지 아무도 모르는 상태였다 —
 *     `ontology-aliases.test.ts`가 정확히 그것을 경고하고 있었다("어느 쪽으로 갈지 알 수 없어진다").
 *     ⚠ **시험이 옳았다.** 사전에서 충돌을 지우는 것이 아니라 코드가 둘 다 답하게 하는 것이 답이다 —
 *       한쪽을 지우면 그 표준이 한국어로 다시 안 닿고, 낱말을 갈라 쓰면(「AI 코드 서명」) 아무도 그렇게 안 묻는다.
 *
 *   → 고침: **자리는 낱말마다 한 번만 지우되, 그 낱말을 가진 주어는 전부 담는다.**
 *     「탈옥」을 물으면 두 표준의 관계를 함께 본다. 순서로 하나를 골라 주던 것이 틀린 답이었다.
 *   ⚠ 긴 낱말 우선(위 정렬)은 그대로다 — 「무차별 대입」이 「대입」보다 먼저 걸려야 한다.
 */
export function 별칭주어찾기(normText: string): string[] {
  let 남은 = normText;
  const 주어들 = new Set<string>();
  const 먹은낱말 = new Set<string>();
  for (const { 낱말, 주어 } of 별칭목록) {
    // 이미 먹은 낱말이면 자리는 지워졌지만 **주어는 담는다** — 같은 개념의 다른 표준이다.
    if (먹은낱말.has(낱말)) { 주어들.add(주어); continue; }
    if (!남은.includes(낱말)) continue;
    주어들.add(주어);
    먹은낱말.add(낱말);
    // 먹은 자리를 지워 더 짧은 **다른** 낱말이 같은 자리에 또 걸리지 않게 한다.
    // ⚠ 구분자를 **날 NUL 문자로 적지 말 것** — grep이 파일을 binary로 보고 통째로 건너뛴다
    //   (2026-08-13 실사고: 이 파일이 소스 수색에서 빠져 있었다). 이스케이프 표기로 쓴다.
    남은 = 남은.split(낱말).join("\u0000");
  }
  return [...주어들];
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
  // 한국어 낱말로 물었을 때의 시드 — 「피싱」 → "T1566 Phishing".
  // ⚠ 별칭이 가리키는 주어가 온톨로지에 없으면 아무 일도 안 일어난다(조용히 무시된다).
  //   그래서 별칭표를 고칠 땐 주어 이름을 온톨로지와 **대조**해야 한다(ontology-aliases.test).
  const 별칭시드 = new Set(별칭주어찾기(normText));
  const mentions = (entity: string) => {
    if (entity.length < MIN_ENTITY_LEN) return false;
    const n = normalizeForMatch(entity);
    return n.length >= MIN_ENTITY_LEN && normText.includes(n);
  };
  for (const t of all) {
    if (별칭시드.has(t.subject) || mentions(t.subject)) frontierInit.add(t.subject);
    if (mentions(t.object)) frontierInit.add(t.object);
  }
  if (frontierInit.size === 0) return [];
  for (const e of frontierInit) seen.add(e);

  // BFS 홉 확장 — 시드에 연결된 트리플을 모으고, 새로 만난 엔티티를 다음 홉의 시작점으로.
  //
  // ★ 2026-08-13 — **시드별로 공평하게 담는다.** 예전엔 DB 순서대로 limit(12)칸을 채워,
  //   「탈옥」처럼 시드가 둘인 질문(OWASP LLM01 + ATLAS AML.T0054)에서 먼저 나온 표준이
  //   칸을 다 먹고 **다른 표준은 0건**이 됐다(실측: limit 12에 LLM01 부재, 400으로 올리면 등장).
  //   별칭이 「두 표준을 함께 본다」로 고쳐졌는데 확장이 도로 한쪽을 굶기던 자리다.
  //   limit을 올리는 길은 버렸다 — 이 결과가 RAG 프롬프트에 실리므로(ontologyContextFor)
  //   키우면 라이트 8K 문맥부터 부푼다. 칸 수는 그대로, **배분만** 공평하게.
  const collected = new Map<string, Triple>();
  let frontier = frontierInit;
  for (let hop = 0; hop < hops && frontier.size > 0 && collected.size < limit; hop++) {
    const next = new Set<string>();
    // 엔티티별 후보를 나눠 담아 라운드로빈으로 한 개씩 뽑는다 — 어느 시드도 0건이 안 되게.
    const 후보별: Triple[][] = [...frontier].map((e) =>
      all.filter((t) => t.subject === e || t.object === e)
    );
    let 남음 = true;
    for (let i = 0; 남음 && collected.size < limit; i++) {
      남음 = false;
      for (const 줄 of 후보별) {
        if (collected.size >= limit) break;
        const t = 줄[i];
        if (!t) continue;
        남음 = true;
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
      const deleted = deleteTriple(req.params.id);
      if (deleted) recordAudit({ kind: "write", action: "온톨로지 관계 삭제", target: String(req.params.id), actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
      res.json({ deleted });
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
