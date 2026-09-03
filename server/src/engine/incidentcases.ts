// engine/incidentcases.ts — 침해사고 히스토리(사고 사례) 대장 + 지식 반입 + 대화창 서식 + API (2026-09-03).
//
// ■ 왜
//   담당자가 「이 CVE로 실제 사고가 난 적 있어?」를 물으면 제품은 지식베이스 발췌를 뒤지거나 모델이 지어냈다.
//   실제 사고 사례는 **표로 갖고 있어야** 규칙으로 찾고(CVE 교집합), 해설 팀원(normaltic)이 그것만 재료로 부연할 수 있다.
//   결정 ①(2026-09-03): 사례 1건 = 지식 문서 1건 — 같은 사실을 표와 문서 두 곳에 쓰지 않고, 문서는 표 칸에서 **렌더**한다(caseDocText).
//   결정 ⑥: 쉬운 설명의 정본은 표 칸(plainExplain) 하나다.
//
// ■ 정직 규칙
//   · 씨앗(incidentcases-seed.json)이 없거나 비어 있어도 서버는 뜬다 — 경고 로그만. 「사례 0건」은 0건이라고 말한다.
//   · 등록 입력은 규칙으로 검증한다(필수·길이·URL·CVE 꼴·지역). 못 지나면 **무엇이 왜** 안 되는지 사유를 전부 돌려준다.
//   · 지식 반입은 뒤에서 한다(learnmemory와 같은 id별 직렬 큐). 실패는 감사 기록(kind=write, result=error)에 남긴다 — 조용히 삼키지 않는다.
//   · 삭제하면 문서도 지운다(bomdrafts.deleteBomDraftsForReview처럼 짝을 시험으로 지킨다).
//   · 시험 환경엔 임베딩이 없다 — GIJO_CASE_INGEST=0이면 반입·삭제의 문서 쪽을 건너뛴다(vitest.config).
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { 말조사 } from "../util/josa";
import { recordAudit } from "./audit";
import { 표식 } from "./tone";

migrate(
  "incident-cases-2026-09-03",
  `CREATE TABLE IF NOT EXISTS incident_cases (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    title TEXT NOT NULL,
    oneLiner TEXT NOT NULL,
    plainExplain TEXT NOT NULL,
    year INTEGER NOT NULL,
    industry TEXT NOT NULL,
    region TEXT NOT NULL,
    techniques TEXT NOT NULL DEFAULT '[]',
    cves TEXT NOT NULL DEFAULT '[]',
    products TEXT NOT NULL DEFAULT '[]',
    lesson TEXT NOT NULL,
    sourceUrl TEXT NOT NULL,
    sourceName TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT 'user',
    registeredBy TEXT
  )`,
);

/** memory_documents.origin 값 — 새 문서 대장·중복 후보에서는 approved-qa와 같이 빠지고, 지식 건수에는 든다(결정 ①). */
export const INCIDENT_CASE_ORIGIN = "incident-case";
/** 지식 문서 id — 삭제 때 같은 id로 조각을 뺀다(ingestText는 documentId 단위 멱등). */
export const incidentCaseDocId = (id: string): string => `incident-case:${id}`;
/** 지식 문서의 업무영역 — hybridsearch CATEGORIES 다섯 중 하나. 위협 팀원(ti) 우선영역에 걸린다. */
export const INCIDENT_CASE_CATEGORY = "위협대응";
/** 등록 입력 검증용 CVE 꼴(대문자 CVE-YYYY-NNNN…). ⚠ 본문에서 CVE를 **뽑는** 것은 hybridsearch.extractLexicalTerms(CODE_RE) 한 곳 — 여기서 뽑기 정규식을 새로 짓지 않는다. */
export const CVE_ID_RE = /^CVE-\d{4}-\d{4,}$/;
const TECHNIQUE_RE = /^(?:TA\d{4}|T\d{4}(?:\.\d{3})?)$/; // ATT&CK T1190 · T1059.001 · TA0001
const ID_RE = /^ic-[0-9a-f]{16}$/;
export const REGIONS = ["국내", "해외"] as const;
export type IncidentRegion = (typeof REGIONS)[number];
export type IncidentOrigin = "builtin" | "user";
export const LIMITS = { title: 120, oneLiner: 200, plainExplain: 1500, lesson: 600, industry: 40, sourceName: 80, sourceUrl: 500, list: 30, item: 60 } as const;

export interface IncidentCaseInput {
  title: string; oneLiner: string; plainExplain: string; year: number; industry: string; region: IncidentRegion;
  techniques: string[]; cves: string[]; products: string[]; lesson: string; sourceUrl: string; sourceName: string;
}
export interface IncidentCaseRow extends IncidentCaseInput {
  id: string; createdAt: number; updatedAt: number; origin: IncidentOrigin; registeredBy: string | null;
}
/** 사례의 샘(갈래 D · incidentsources.json) 한 줄. 화면은 이름·언어·주기·링크를 그린다. */
export interface IncidentSource { id: string; name: string; kind: "youtube" | "site" | "domestic"; url: string; lang: string; cadence: string; desc: string }
export type IncidentSourceKind = IncidentSource["kind"] | "all";

interface Raw { id: string; createdAt: number; updatedAt: number; title: string; oneLiner: string; plainExplain: string; year: number; industry: string; region: string; techniques: string; cves: string; products: string; lesson: string; sourceUrl: string; sourceName: string; origin: string; registeredBy: string | null }

const parseList = (s: string | null | undefined): string[] => {
  try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.map((x) => String(x)) : []; } catch { return []; }
};
const toRow = (r: Raw): IncidentCaseRow => ({
  ...r,
  region: (r.region === "해외" ? "해외" : "국내"),
  techniques: parseList(r.techniques), cves: parseList(r.cves), products: parseList(r.products),
  origin: r.origin === "builtin" ? "builtin" : "user",
});

// ── 입력 검증 ───────────────────────────────────────────────────────────────
const str = (v: unknown) => String(v ?? "").trim();
/** 코드 목록(CVE·기법)은 쉼표·공백·가운뎃점 어디로 나눠도 된다 — 담당자는 「CVE-a, CVE-b」로도 「CVE-a CVE-b」로도 쓴다. */
const splitCodes = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : str(v).split(/[,;·\s]+/).map((s) => s.trim()).filter(Boolean);
/** 이름 목록(제품)은 쉼표·세미콜론·가운뎃점으로만 — 「Apache Log4j」처럼 이름 안에 공백이 있다. */
const splitNames = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : str(v).split(/[,;·]+/).map((s) => s.trim()).filter(Boolean);
const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * 등록 입력을 규칙으로 검증한다 — 사유는 전부 모아 돌려준다(하나씩 되묻지 않는다).
 * 정규화: CVE·기법은 대문자, 지역은 국내/해외, 목록은 중복 제거.
 */
export function validateIncidentCaseInput(raw: Record<string, unknown>): { value: IncidentCaseInput; errors: string[] } {
  const errors: string[] = [];
  const need = (k: keyof IncidentCaseInput, label: string, max: number): string => {
    const v = str(raw[k]);
    // 조사는 손으로 적지 않는다(josa.test 소스 감시) — 받침에 따라 「제목이」「출처가」로 갈린다
    if (!v) errors.push(`${말조사(label, "이")} 비었습니다`);
    else if (v.length > max) errors.push(`${말조사(label, "이")} ${max}자를 넘습니다(${v.length}자)`);
    return v.slice(0, max);
  };
  const title = need("title", "제목", LIMITS.title);
  const oneLiner = need("oneLiner", "한 줄 요약", LIMITS.oneLiner);
  const plainExplain = need("plainExplain", "쉬운 설명", LIMITS.plainExplain);
  const lesson = need("lesson", "교훈", LIMITS.lesson);
  const industry = need("industry", "업종", LIMITS.industry);
  const sourceName = str(raw.sourceName).slice(0, LIMITS.sourceName);
  const yearRaw = str(raw.year);
  const year = Number(yearRaw);
  const thisYear = new Date().getFullYear();
  if (!yearRaw) errors.push("연도가 비었습니다");
  else if (!Number.isInteger(year) || year < 1980 || year > thisYear + 1) errors.push(`연도가 맞지 않습니다: ${yearRaw} (1980~${thisYear + 1})`);
  const regionRaw = str(raw.region);
  const region: IncidentRegion = regionRaw === "해외" ? "해외" : "국내";
  if (!regionRaw) errors.push("지역(국내/해외)이 비었습니다");
  else if (regionRaw !== "국내" && regionRaw !== "해외") errors.push(`지역은 「국내」 또는 「해외」여야 합니다: ${regionRaw}`);
  const sourceUrl = str(raw.sourceUrl).slice(0, LIMITS.sourceUrl);
  if (!sourceUrl) errors.push("출처 URL이 비었습니다(필수 — 근거 없는 사례는 등록하지 않습니다)");
  else if (!/^https?:\/\/\S+$/i.test(sourceUrl)) errors.push(`출처 URL은 http(s)로 시작해야 합니다: ${sourceUrl}`);
  const cves = uniq(splitCodes(raw.cves).map((c) => c.toUpperCase()));
  for (const c of cves) if (!CVE_ID_RE.test(c)) errors.push(`CVE 꼴이 아닙니다: ${c} (예: CVE-2021-44228)`);
  const techniques = uniq(splitCodes(raw.techniques).map((t) => t.toUpperCase()));
  for (const t of techniques) if (!TECHNIQUE_RE.test(t)) errors.push(`ATT&CK 기법 꼴이 아닙니다: ${t} (예: T1190, T1059.001, TA0001)`);
  const products = uniq(splitNames(raw.products).map((p) => p.slice(0, LIMITS.item)));
  for (const [label, xs] of [["CVE", cves], ["기법", techniques], ["제품", products]] as const) if (xs.length > LIMITS.list) errors.push(`${label} 목록이 ${LIMITS.list}개를 넘습니다`);
  return { value: { title, oneLiner, plainExplain, year, industry, region, techniques, cves, products, lesson, sourceUrl, sourceName }, errors };
}

// ── 조회 ───────────────────────────────────────────────────────────────────
const selectAll = "SELECT * FROM incident_cases";
const ORDER = " ORDER BY year DESC, createdAt DESC";

export function listIncidentCases(opts: { q?: string; cve?: string; year?: number; limit?: number } = {}): IncidentCaseRow[] {
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.year && Number.isInteger(Number(opts.year))) { where.push("year = ?"); params.push(Number(opts.year)); }
  const q = str(opts.q);
  if (q) {
    // 제목·한 줄·쉬운 설명·교훈·업종·제품·CVE 어디에 걸려도 — 담당자는 「랜섬웨어」·「병원」·「Log4j」 어느 말로든 묻는다.
    where.push("(title LIKE ? OR oneLiner LIKE ? OR plainExplain LIKE ? OR lesson LIKE ? OR industry LIKE ? OR products LIKE ? OR cves LIKE ? OR techniques LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like);
  }
  const cve = str(opts.cve).toUpperCase();
  let rows = (db.prepare(selectAll + (where.length ? ` WHERE ${where.join(" AND ")}` : "") + ORDER).all(...params) as Raw[]).map(toRow);
  if (cve) rows = rows.filter((r) => r.cves.some((c) => c.toUpperCase() === cve));
  return rows.slice(0, limit);
}

export function countIncidentCases(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM incident_cases").get() as { n: number }).n;
}

export function getIncidentCase(id: string): IncidentCaseRow | undefined {
  const r = db.prepare("SELECT * FROM incident_cases WHERE id = ?").get(str(id)) as Raw | undefined;
  return r ? toRow(r) : undefined;
}

/** CVE 목록과 겹치는 사례 — 규칙만(LLM 없음). 대문자로 맞춰 JSON 배열 교집합, 많이 겹치는 순 → 최근 연도 순. */
export function findCasesForCves(cves: string[], limit = 5): IncidentCaseRow[] {
  const want = new Set(cves.map((c) => str(c).toUpperCase()).filter(Boolean));
  if (!want.size) return [];
  const rows = (db.prepare(selectAll + " WHERE cves <> '[]'" + ORDER).all() as Raw[]).map(toRow);
  return rows
    .map((r) => ({ r, hit: r.cves.filter((c) => want.has(c.toUpperCase())).length }))
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit || b.r.year - a.r.year)
    .slice(0, Math.max(1, limit))
    .map((x) => x.r);
}

// ── 지식 반입(결정 ①) — 표 칸에서 렌더한 문서 1건, id별 직렬 큐, 실패는 감사에 ───────────────────
const ingestEnabled = () => process.env.GIJO_CASE_INGEST !== "0";
const docExistsStmt = db.prepare("SELECT 1 FROM memory_documents WHERE documentId = ?");
// 동적 import — memory ⇄ (llm·agentloop·registry) 순환 차단(learnmemory와 같은 이유). **한 번만** 불러 약속을 나눠 쓴다:
//   씨앗 수십 건이 같은 틱에 큐를 타면 import()가 동시에 여러 번 뜨는데, 모듈이 준비되기 전 두 번째 요청이 원본을 받는 일이
//   실제로 났다(vitest 모킹 실측 2026-09-03 — 한 건은 모킹, 한 건은 진짜 임베딩으로 갔다). 제품에서도 같은 모듈을 여러 번 풀 이유가 없다.
let memoryP: Promise<typeof import("./memory.js")> | undefined;
const memory = () => (memoryP ??= import("./memory.js"));

/** 지식 문서 본문 — 사람이 읽어도 출처가 보이고, 조각 검색엔 제목·한 줄·설명·교훈 문장이 걸린다. 정본은 표 칸이다(여기서 새 사실을 더하지 않는다). */
export function caseDocText(r: IncidentCaseRow): string {
  const lines = [
    `[침해사고 히스토리] ${r.title} (${r.year} · ${r.industry} · ${r.region})`,
    "",
    `한 줄: ${r.oneLiner}`,
    "",
    "쉬운 설명:",
    r.plainExplain,
    "",
    `교훈: ${r.lesson}`,
    "",
    `연도: ${r.year} · 업종: ${r.industry} · 지역: ${r.region}`,
  ];
  if (r.cves.length) lines.push(`관련 CVE: ${r.cves.join(", ")}`);
  if (r.products.length) lines.push(`관련 제품: ${r.products.join(", ")}`);
  if (r.techniques.length) lines.push(`공격 기법(ATT&CK): ${r.techniques.join(", ")}`);
  lines.push(`출처: ${r.sourceName ? `${r.sourceName} — ` : ""}${r.sourceUrl}`);
  return lines.join("\n");
}

const queues = new Map<string, Promise<void>>();
function enqueue(id: string, job: () => Promise<void>, what: string): void {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(job).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[incidentcases] 사례 문서 ${what} 실패(${id}): ${msg}`);
    recordAudit({ kind: "write", actor: "system", action: `침해사고 사례 문서 ${what} 실패`, target: incidentCaseDocId(id), detail: msg.slice(0, 300), result: "error" });
  });
  queues.set(id, next);
  void next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
}

async function ingestDoc(id: string, force: boolean): Promise<void> {
  const row = getIncidentCase(id);
  if (!row) return; // 반입 전에 지워졌다 — 정상(삭제 사건이 뒤에 온다)
  const docId = incidentCaseDocId(id);
  if (!force && docExistsStmt.get(docId)) return; // 멱등 — 재기동마다 다시 임베딩하지 않는다
  const m = await memory();
  const r = await m.ingestText(docId, caseDocText(row), m.GLOBAL_SCOPE, undefined, false, undefined, INCIDENT_CASE_CATEGORY, INCIDENT_CASE_ORIGIN);
  // 사후 재확인 — 반입이 도는 사이 지워졌으면 바로 뺀다(같은 큐라 뒤에 오지만, 큐 밖의 직접 삭제 대비).
  if (!getIncidentCase(id)) { await m.deleteDocument(docId, false); return; }
  재반입대기.delete(id); // 성공했을 때만 — 실패하면 다음 부팅 재시도가 다시 집는다
  console.log(`[incidentcases] 사례 문서 반입: ${docId} (${r.chunks}조각)`);
}

async function removeDoc(id: string): Promise<void> {
  const docId = incidentCaseDocId(id);
  if (!docExistsStmt.get(docId)) return; // 반입된 적 없음 — 정상
  const m = await memory();
  const r = await m.deleteDocument(docId, false);
  console.log(`[incidentcases] 사례 삭제로 문서에서 뺌: ${docId} (${r.deletedChunks}조각)`);
}

/** 시험·진단용 — 문서 큐가 비기를 기다린다. */
export async function incidentCaseDocsIdle(): Promise<void> {
  await Promise.all([...queues.values()]);
}

// ── 등록·삭제 ───────────────────────────────────────────────────────────────
const insertStmt = db.prepare(
  `INSERT INTO incident_cases (id, createdAt, updatedAt, title, oneLiner, plainExplain, year, industry, region, techniques, cves, products, lesson, sourceUrl, sourceName, origin, registeredBy)
   VALUES (@id, @createdAt, @updatedAt, @title, @oneLiner, @plainExplain, @year, @industry, @region, @techniques, @cves, @products, @lesson, @sourceUrl, @sourceName, @origin, @registeredBy)`,
);
const updateStmt = db.prepare(
  `UPDATE incident_cases SET updatedAt=@updatedAt, title=@title, oneLiner=@oneLiner, plainExplain=@plainExplain, year=@year, industry=@industry, region=@region,
     techniques=@techniques, cves=@cves, products=@products, lesson=@lesson, sourceUrl=@sourceUrl, sourceName=@sourceName WHERE id=@id`,
);
const toParams = (v: IncidentCaseInput) => ({
  ...v, techniques: JSON.stringify(v.techniques), cves: JSON.stringify(v.cves), products: JSON.stringify(v.products),
});

/**
 * 사례 등록 — 관리자 API 또는 결재판(register_incident_case)이 부른다. 검증을 못 지나면 사유를 전부 실어 던진다.
 * @param actor 등록자 표시 이름(결재판 승인자·API 호출자). registeredBy에 그대로 남는다.
 */
export function registerIncidentCase(raw: Record<string, unknown>, actor: string | null, origin: IncidentOrigin = "user"): IncidentCaseRow {
  const { value, errors } = validateIncidentCaseInput(raw);
  if (errors.length) throw new Error(`입력이 맞지 않습니다 — ${errors.join(" · ")}`);
  const id = `ic-${crypto.randomBytes(8).toString("hex")}`;
  const now = Date.now();
  insertStmt.run({ id, createdAt: now, updatedAt: now, ...toParams(value), origin, registeredBy: actor ?? null });
  recordAudit({ kind: "write", actor, action: "침해사고 히스토리 등록", target: id, detail: `${value.title} (${value.year}·${value.industry}·${value.region}) · 출처 ${value.sourceUrl}`.slice(0, 300), result: "ok" });
  if (ingestEnabled()) enqueue(id, () => ingestDoc(id, false), "반입");
  return getIncidentCase(id)!;
}

/** 사례 삭제 — 표에서 지우고 지식 문서도 짝으로 지운다(문서 쪽은 큐에서, 실패하면 감사 기록). 없는 id면 false. */
export function deleteIncidentCase(id: string, actor: string | null): boolean {
  const row = getIncidentCase(id);
  if (!row) return false;
  db.prepare("DELETE FROM incident_cases WHERE id = ?").run(row.id);
  recordAudit({ kind: "write", actor, action: "침해사고 히스토리 삭제", target: row.id, detail: `${row.title} (${row.year}) · ${row.origin === "builtin" ? "내장" : `등록자 ${row.registeredBy ?? "?"}`}`, result: "ok" });
  if (ingestEnabled()) enqueue(row.id, () => removeDoc(row.id), "삭제");
  return true;
}

// ── 씨앗(내장 사례) ─────────────────────────────────────────────────────────
/** 씨앗·샘 파일 — dist에는 copy-assets가 옮기고, 없으면 src/engine 폴백(examquestions.json과 같은 규칙). */
function assetPath(name: string): string | null {
  for (const p of [path.join(__dirname, name), path.join(__dirname, "..", "..", "src", "engine", name)]) if (fs.existsSync(p)) return p;
  return null;
}
/** 씨앗 사례의 id — 파일에 없으면 출처 URL+제목에서 결정적으로 만든다(재기동마다 같은 id → 멱등). */
export function builtinCaseId(seed: { id?: unknown; sourceUrl?: unknown; title?: unknown }): string {
  const given = str(seed.id);
  if (ID_RE.test(given)) return given;
  return `ic-${crypto.createHash("sha256").update(`${str(seed.sourceUrl)}|${str(seed.title)}`).digest("hex").slice(0, 16)}`;
}
export interface SeedResult { file: string | null; inserted: number; updated: number; unchanged: number; skipped: string[] }
/** 씨앗 칸이 바뀐 내장 사례 — 문서를 **강제로** 다시 반입해야 할 id(문서 행이 이미 있어 「없는 것만」 반입으로는 안 잡힌다). */
const 재반입대기 = new Set<string>();

/**
 * 기동 시 내장 사례를 넣는다 — id 기준 멱등. 같은 id의 내장 행이 있으면 칸이 달라졌을 때만 갱신(그때 문서도 다시 반입).
 * 파일이 없거나 비어 있어도 던지지 않는다(경고만). 담당자 등록분(origin=user)은 절대 건드리지 않는다.
 * @param opts.ingest false면 문서 반입을 큐에 넣지 않는다 — 모듈 로드 때는 임베딩 서버가 아직 없어 실패만 쌓인다.
 *   그 대신 index.ts가 부팅 뒤 syncIncidentCaseDocsWithRetry로 「문서 없는 사례 + 재반입대기」를 맞춘다.
 */
export function seedBuiltinCases(file?: string, opts: { ingest?: boolean } = {}): SeedResult {
  const ingest = opts.ingest ?? true;
  const p = file ?? assetPath("incidentcases-seed.json");
  const out: SeedResult = { file: p, inserted: 0, updated: 0, unchanged: 0, skipped: [] };
  if (!p) { console.warn("[incidentcases] 씨앗 파일(incidentcases-seed.json)이 없다 — 내장 사례 0건으로 뜬다"); return out; }
  let cases: unknown[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { cases?: unknown[] } | unknown[];
    cases = Array.isArray(j) ? j : Array.isArray(j?.cases) ? j.cases : [];
  } catch (e) {
    console.warn(`[incidentcases] 씨앗 파일을 읽지 못했다(${p}): ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
  if (!cases.length) { console.warn(`[incidentcases] 씨앗 파일이 비어 있다(${p}) — 내장 사례 0건`); return out; }
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const c of cases) {
      const raw = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      const { value, errors } = validateIncidentCaseInput(raw);
      if (errors.length) { out.skipped.push(`${str(raw.title) || "(제목 없음)"}: ${errors.join(" · ")}`); continue; }
      const id = builtinCaseId(raw);
      const cur = getIncidentCase(id);
      if (!cur) {
        insertStmt.run({ id, createdAt: now, updatedAt: now, ...toParams(value), origin: "builtin", registeredBy: null });
        out.inserted += 1;
        if (ingest && ingestEnabled()) enqueue(id, () => ingestDoc(id, false), "반입");
        continue;
      }
      if (cur.origin !== "builtin") { out.skipped.push(`${value.title}: 같은 id의 담당자 등록 사례가 있어 건너뜀`); continue; }
      const same = (Object.keys(value) as (keyof IncidentCaseInput)[]).every((k) => JSON.stringify(cur[k]) === JSON.stringify(value[k]));
      if (same) { out.unchanged += 1; continue; }
      updateStmt.run({ id, updatedAt: now, ...toParams(value) });
      out.updated += 1;
      if (ingest && ingestEnabled()) enqueue(id, () => ingestDoc(id, true), "재반입");
      else 재반입대기.add(id);
    }
  });
  tx();
  if (out.skipped.length) console.warn(`[incidentcases] 씨앗 ${out.skipped.length}건 건너뜀:\n  ${out.skipped.join("\n  ")}`);
  return out;
}

/** 표에는 있는데 지식 문서가 없는 사례(+씨앗이 바뀐 사례)를 반입한다 — 부팅 뒤·임베딩이 늦게 뜰 때. 큐에 넣고 끝나기를 기다린다. */
export async function syncIncidentCaseDocs(): Promise<{ queued: number }> {
  if (!ingestEnabled()) return { queued: 0 };
  const 없는것 = (db.prepare("SELECT id FROM incident_cases").all() as { id: string }[]).map((r) => r.id).filter((id) => !docExistsStmt.get(incidentCaseDocId(id)));
  for (const id of 없는것) enqueue(id, () => ingestDoc(id, false), "반입");
  const 바뀐것 = [...재반입대기].filter((id) => !없는것.includes(id));
  for (const id of 바뀐것) enqueue(id, () => ingestDoc(id, true), "재반입"); // 성공하면 ingestDoc이 대기에서 지운다
  await incidentCaseDocsIdle();
  return { queued: 없는것.length + 바뀐것.length };
}
/** 부팅용 — docsbundle.bootstrapDocsBundleWithRetry와 같은 결(임베딩이 늦게 뜨면 20초 간격으로 다시). */
export async function syncIncidentCaseDocsWithRetry(attempts = 5, delayMs = 20_000): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    const { queued } = await syncIncidentCaseDocs();
    const 남음 = (db.prepare("SELECT id FROM incident_cases").all() as { id: string }[]).filter((r) => !docExistsStmt.get(incidentCaseDocId(r.id))).length + 재반입대기.size;
    if (남음 === 0) { if (queued) console.log(`[incidentcases] 사례 문서 ${queued}건 반입 완료`); return; }
    if (i === attempts) { console.error(`[incidentcases] 사례 문서 ${남음}건 반입 실패 — 임베딩 서버 상태를 확인하세요(감사 기록에 사유가 있습니다)`); return; }
    console.warn(`[incidentcases] 사례 문서 ${남음}건 남음 — 재시도 ${i}/${attempts - 1} (${Math.round(delayMs / 1000)}초 후)`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// ── 사례의 샘(갈래 D · incidentsources.json) ───────────────────────────────────
export function listIncidentSources(kind: IncidentSourceKind = "all"): IncidentSource[] {
  const p = assetPath("incidentsources.json");
  if (!p) return [];
  let items: unknown[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { sources?: unknown[] } | unknown[];
    items = Array.isArray(j) ? j : Array.isArray(j?.sources) ? j.sources : [];
  } catch (e) {
    console.warn(`[incidentcases] 샘 파일을 읽지 못했다(${p}): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  const out: IncidentSource[] = [];
  for (const it of items) {
    const s = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const k = str(s.kind);
    const url = str(s.url);
    if (!url || !/^https?:\/\//i.test(url)) continue; // 링크 없는 샘은 샘이 아니다
    const kk: IncidentSource["kind"] = k === "youtube" || k === "domestic" ? k : "site";
    // 파일(갈래 D)은 language·what으로 적는다 — API·화면(client security-ops.ts IncidentSource)은 lang·desc 한 이름으로 받는다(둘 다 읽어 한쪽으로 접는다).
    out.push({ id: str(s.id) || url, name: str(s.name) || url, kind: kk, url, lang: str(s.lang) || str(s.language), cadence: str(s.cadence), desc: str(s.desc) || str(s.what) || str(s.about) });
  }
  return kind === "all" ? out : out.filter((s) => s.kind === kind);
}

const KIND_KO: Record<IncidentSource["kind"], string> = { youtube: "유튜브", site: "사이트·블로그", domestic: "국내" };
export function formatIncidentSources(kind: IncidentSourceKind = "all"): string {
  const all = listIncidentSources("all");
  if (!all.length) return `${표식.사례} 사례의 샘 목록이 아직 없습니다 — 샘 파일(incidentsources.json)이 배포에 실리지 않았습니다. 관리자에게 알려 주세요.`;
  const rows = kind === "all" ? all : all.filter((s) => s.kind === kind);
  if (!rows.length) return `${표식.사례} ${KIND_KO[kind as IncidentSource["kind"]] ?? kind} 갈래의 샘은 없습니다 — 전체 ${all.length}곳 중 유튜브 ${all.filter((s) => s.kind === "youtube").length} · 사이트 ${all.filter((s) => s.kind === "site").length} · 국내 ${all.filter((s) => s.kind === "domestic").length}`;
  // 안내 줄은 **머리 바로 아래** — 목록이 길어 끝이 잘리면(3500자 컷) 「외부로 나간다」는 말이 함께 잘린다(실측 2026-09-03: 28곳에서 잘렸다).
  const MAX = 12;
  const lines = [
    `${표식.사례} 사례의 샘 — ${kind === "all" ? "전체" : KIND_KO[kind as IncidentSource["kind"]]} ${rows.length}곳 (보안 사고 소식을 꾸준히 보는 자리)`,
    `${표식.알아두기} 링크는 외부 사이트로 나갑니다 — 폐쇄망이면 열리지 않습니다. 본 사례를 제품에 남기려면 대화창에서 「사례 등록: …」로 등록하세요.`,
    "",
  ];
  for (const s of rows.slice(0, MAX)) {
    lines.push(`- ${s.name}${s.lang ? ` (${s.lang})` : ""}${s.cadence ? ` · ${s.cadence.slice(0, 60)}` : ""}${s.desc ? ` — ${s.desc.slice(0, 120)}` : ""}\n  ${s.url}`);
  }
  if (rows.length > MAX) lines.push(`… 외 ${rows.length - MAX}곳 — 「유튜브 사례의 샘」·「국내 사례의 샘」처럼 갈래로 물으면 그 갈래만 보입니다(전체는 📚 침해사고 히스토리 판 아래 띠).`);
  return lines.join("\n").slice(0, 3500);
}

// ── 대화창 서식 ──────────────────────────────────────────────────────────────
const 한줄 = (r: IncidentCaseRow) => `[${r.year} · ${r.region} · ${r.industry}] ${r.title} — ${r.oneLiner}`;
/**
 * 대화창용 — 숫자만 주고 끝내지 않는다: 건마다 한 줄·교훈·CVE/제품·출처 링크를 적고, 1~2건이면 쉬운 설명까지 싣는다.
 * 사례 글은 사람이 쓴 정본(표 칸)이라 🤖(AI가 쓴 글) 표식을 붙이지 않는다.
 */
export function formatIncidentCases(rows: IncidentCaseRow[], ctx: { q?: string; cve?: string } = {}): string {
  const total = countIncidentCases();
  const 조건 = [ctx.q ? `「${ctx.q}」` : "", ctx.cve ? `CVE ${ctx.cve.toUpperCase()}` : ""].filter(Boolean).join(" · ");
  if (!rows.length) {
    if (total === 0) return `${표식.사례} 침해사고 히스토리에 등록된 사례가 아직 없습니다 — 내장 씨앗이 비어 있고 담당자 등록도 없습니다. 대화창에서 「사례 등록: 제목, 연도, 업종, 국내/해외, 한 줄 요약, 쉬운 설명, 교훈, 출처 URL」로 등록할 수 있습니다.`;
    return `${표식.못찾음} 침해사고 히스토리 ${total}건 중 ${조건 || "이 조건"}에 걸리는 사례가 없습니다.\n(사고가 없었다는 뜻이 아니라, 이 말로는 못 찾았다는 뜻입니다 — 「침해사고 히스토리 보여줘」로 전체를 보거나 제품·업종 이름으로 다시 물어보세요.)`;
  }
  const lines = [`${표식.사례} 침해사고 히스토리 — ${rows.length}건${조건 ? ` (${조건})` : ""}${rows.length < total ? ` · 전체 ${total}건` : ""}`];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${한줄(r)}`);
    if (rows.length <= 2) lines.push(`   ${r.plainExplain}`);
    lines.push(`   교훈: ${r.lesson}`);
    const 꼬리 = [r.cves.length ? `CVE ${r.cves.join(", ")}` : "", r.products.length ? `제품 ${r.products.join(", ")}` : "", r.techniques.length ? `기법 ${r.techniques.join(", ")}` : ""].filter(Boolean).join(" · ");
    if (꼬리) lines.push(`   ${꼬리}`);
    lines.push(`   출처: ${r.sourceName ? `${r.sourceName} ` : ""}${r.sourceUrl}`);
  });
  lines.push("", `${표식.알아두기} 출처 링크에서 원문을 확인하세요(외부 사이트). 새 사례는 대화창에서 「사례 등록: …」, 목록은 📚 침해사고 히스토리 판에서 봅니다.`);
  return lines.join("\n").slice(0, 3500);
}

// ── API ─────────────────────────────────────────────────────────────────────
const 사용자 = (req: Request) => (req as Request & { user?: GijoUser }).user;
export function registerIncidentCaseRoutes(app: Express): void {
  app.get("/api/incident-cases", authMiddleware, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json({ cases: listIncidentCases({ q: q.q, cve: q.cve, year: q.year ? Number(q.year) : undefined, limit: q.limit ? Number(q.limit) : undefined }) });
  });
  // ⚠ /sources·/similar는 /:id보다 **먼저** — 뒤에 두면 :id가 "sources"를 삼켜 404가 된다(incidentcases.test가 순서를 지킨다).
  app.get("/api/incident-cases/sources", authMiddleware, (req, res) => {
    const kind = String((req.query as Record<string, string | undefined>).kind ?? "all") as IncidentSourceKind;
    res.json({ sources: listIncidentSources(kind) });
  });
  app.get("/api/incident-cases/similar", authMiddleware, (req, res) => {
    const cves = splitCodes((req.query as Record<string, string | undefined>).cves ?? "");
    res.json({ cases: findCasesForCves(cves) });
  });
  app.get("/api/incident-cases/:id", authMiddleware, (req, res) => {
    const r = getIncidentCase(String(req.params.id));
    if (!r) { res.status(404).json({ error: "그 사례가 없습니다." }); return; }
    res.json(r);
  });
  // 등록은 관리자 API 또는 결재판(register_incident_case) — 일반 담당자는 대화창 결재판을 지난다(「지시는 대화창」).
  app.post("/api/incident-cases", authMiddleware, adminMiddleware, asyncRoute(async (req, res) => {
    const u = 사용자(req);
    try {
      const row = registerIncidentCase((req.body ?? {}) as Record<string, unknown>, u?.displayName ?? u?.username ?? null);
      res.status(201).json(row);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }));
  // 삭제 — 내장(builtin)은 관리자만, 담당자 등록분은 등록자·관리자.
  app.delete("/api/incident-cases/:id", authMiddleware, (req, res) => {
    const u = 사용자(req);
    const row = getIncidentCase(String(req.params.id));
    if (!row) { res.status(404).json({ error: "그 사례가 없습니다." }); return; }
    const admin = u?.role === "admin";
    const mine = row.origin === "user" && !!u && row.registeredBy != null && row.registeredBy === u.displayName;
    if (!admin && !mine) { res.status(403).json({ error: row.origin === "builtin" ? "내장 사례는 관리자만 지울 수 있습니다." : "본인이 등록한 사례만 지울 수 있습니다(관리자 제외)." }); return; }
    deleteIncidentCase(row.id, u?.displayName ?? null);
    res.json({ ok: true });
  });
}

// 기동 시 내장 사례를 넣는다(assets.ts의 seedSampleAssetsIfEmpty와 같은 자리 — 모듈 로드 때). 문서 반입은 여기서 안 한다 —
// 임베딩 서버가 아직 없어 실패만 쌓인다. index.ts가 부팅 뒤 syncIncidentCaseDocsWithRetry로 맞춘다.
seedBuiltinCases(undefined, { ingest: false });
