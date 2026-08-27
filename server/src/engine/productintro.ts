// engine/productintro.ts — 제품 소개자료 대장 (추가 기능, 2026-08-09 사용자 지시)
//
// ⚠ **보안제품 등록부(securityproducts)와 별도다** — 사용자 지시("매뉴얼이랑 별도로 관리").
//   등록부는 "우리 회사에 실제 도입·운영 중인 제품"의 대장이고 매뉴얼이 거기 붙는다.
//   이 대장은 "도입 검토·비교를 위한 소개자료" — 아직 우리 것이 아닌 제품도 들어온다.
//   섞으면 담당자가 '운영 중'과 '검토 중'을 구분하지 못하게 된다.
//
// 등록·삭제는 대화창(결재판) 몫 — 화면은 「내 문서 > 📦 보안제품 자료」이고 보는 자리다(메뉴는 보기용 원칙).
//   ⚠ 2026-08-22 흡수 — 옛 intro.html은 삭제됐다.
import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { db, migrate } from "../db";
import { recordAudit } from "./audit";
import { addTriples, deleteTriplesBySource } from "./ontology";

migrate(
  "product-intro-2026-08-09",
  `CREATE TABLE IF NOT EXISTS product_intro (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     category TEXT NOT NULL,
     vendor TEXT,
     summary TEXT,
     docName TEXT,
     createdAt INTEGER NOT NULL
   )`
);

export interface ProductIntro {
  id: string;
  name: string;
  category: string;
  vendor: string | null;
  /** 한 줄 소개 — 반입 자료에서 담당자가 적은 것. 지어내지 않는다. */
  summary: string | null;
  /** 연결된 소개자료 문서명(지식 저장소에 올린 것) — 있으면 대화창 비교가 근거로 쓴다 */
  docName: string | null;
  createdAt: number;
}

const insertStmt = db.prepare(
  "INSERT INTO product_intro (id, name, category, vendor, summary, docName, createdAt) VALUES (@id, @name, @category, @vendor, @summary, @docName, @createdAt)"
);
const listStmt = db.prepare("SELECT * FROM product_intro ORDER BY category, name");
const getStmt = db.prepare("SELECT * FROM product_intro WHERE id = ?");
const delStmt = db.prepare("DELETE FROM product_intro WHERE id = ?");

// ── 비교 항목(필드) — 사실이 사는 **유일한 곳** (2026-08-28, 승인 설계 2026-08-23) ─────────
//
// ■ 설계 세 원칙 (그날 사장님 지시 + 실측)
//   ① 「각 항목별로 학습이 가능하도록」 — 항목 하나 = 아래 표의 한 줄 = 트리플 하나.
//   ② 「온톨로지에 넣을 때도 관계성이 필요하잖아」 — 트리플은 이 표의 **파생 인덱스**다.
//     값이 바뀔 때마다 source 단위로 지우고 다시 만든다(docgraph 멱등 관례). 두 곳에 적지 않는다.
//   ③ 자동 추출은 **값이 아니라 인용까지만**(실측: 「SaaS 기반(On-Prem 지원 가능)」을
//     「도입형태=SaaS」로 단정하면 틀린다) — quote 칸에 원문을 담아 제안하고, value는 담당자가 확정한다.
//
// ■ 항목 선정 근거(2026-08-23 SafeBreach 실측): 자동 신호가 있던 것(도입형태·경쟁제품) +
//   도입 검토서에 늘 들어가는 것. 과한 세분화 지양 — 비면 「―」로 정직하게 보인다.
export const INTRO_FIELD_SCHEMA = [
  { key: "deployType", label: "도입 형태" },        // 온프레미스/SaaS/하이브리드
  { key: "license", label: "라이선스·과금" },
  { key: "mainFeatures", label: "주요 기능" },
  { key: "differentiator", label: "차별점" },
  { key: "targetSize", label: "대상 규모" },
  { key: "integration", label: "연동" },            // SIEM·AD 등
  { key: "competitors", label: "경쟁 제품" },
] as const;
const INTRO_FIELD_KEYS = new Set<string>(INTRO_FIELD_SCHEMA.map((f) => f.key));

migrate(
  "product-intro-field-2026-08-28",
  `CREATE TABLE IF NOT EXISTS product_intro_field (
     introId TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     quote TEXT,
     updatedAt INTEGER NOT NULL,
     updatedBy TEXT,
     PRIMARY KEY (introId, key)
   )`
);

export interface IntroField { introId: string; key: string; value: string; quote: string | null; updatedAt: number; updatedBy: string | null }

const fieldUpsertStmt = db.prepare(`
  INSERT INTO product_intro_field (introId, key, value, quote, updatedAt, updatedBy)
  VALUES (@introId, @key, @value, @quote, @updatedAt, @updatedBy)
  ON CONFLICT(introId, key) DO UPDATE SET value=excluded.value, quote=excluded.quote,
    updatedAt=excluded.updatedAt, updatedBy=excluded.updatedBy
`);
const fieldDelStmt = db.prepare("DELETE FROM product_intro_field WHERE introId = ? AND key = ?");
const fieldsOfStmt = db.prepare("SELECT * FROM product_intro_field WHERE introId = ? ORDER BY key");
const fieldsAllDelStmt = db.prepare("DELETE FROM product_intro_field WHERE introId = ?");

export function listIntroFields(introId: string): IntroField[] {
  return fieldsOfStmt.all(introId) as IntroField[];
}

/** 트리플 파생 — **주어는 제품 이름**이다(id가 아니라). expandOntology는 질문 글자에
 *  주어가 있으면 걸린다: 「SafeBreach 도입 형태 어때?」가 걸리려면 주어=SafeBreach여야 한다.
 *  (pi-… id를 주어로 넣으면 어떤 질문에도 안 걸린다 — 2026-08-23 설계 검토가 잡은 기존 버그 부류.) */
function introTripleSource(id: string): string {
  return `제품소개:${id}`;
}
function syncIntroTriples(intro: ProductIntro): void {
  const source = introTripleSource(intro.id);
  deleteTriplesBySource(source); // 멱등 — 같은 source를 통째로 갈아끼운다(docgraph 관례)
  const fields = listIntroFields(intro.id);
  const triples = [
    { subject: intro.name, predicate: "제품분류", object: intro.category, source },
    ...(intro.vendor ? [{ subject: intro.name, predicate: "공급사", object: intro.vendor, source }] : []),
    ...fields.map((f) => ({
      subject: intro.name,
      predicate: INTRO_FIELD_SCHEMA.find((s) => s.key === f.key)?.label ?? f.key,
      object: f.value,
      source,
    })),
  ];
  if (triples.length) addTriples(triples);
}

/** 항목 값 확정(빈 값이면 삭제) — 저장과 트리플 재생성이 한 함수에 있어 어긋날 수 없다. */
export function setIntroField(introId: string, key: string, value: string, opts?: { quote?: string | null; actor?: string | null }): IntroField[] {
  const intro = getStmt.get(introId) as ProductIntro | undefined;
  if (!intro) throw new Error("해당 소개자료가 없습니다");
  if (!INTRO_FIELD_KEYS.has(key)) throw new Error(`모르는 항목입니다: ${key}`);
  const v = (value ?? "").trim();
  if (v) {
    fieldUpsertStmt.run({ introId, key, value: v, quote: (opts?.quote ?? "")?.trim() || null, updatedAt: Date.now(), updatedBy: opts?.actor ?? null });
  } else {
    fieldDelStmt.run(introId, key);
  }
  syncIntroTriples(intro);
  recordAudit({
    kind: "write", actor: opts?.actor ?? null,
    action: v ? "제품 소개 항목 기록" : "제품 소개 항목 삭제",
    target: intro.name, detail: `${INTRO_FIELD_SCHEMA.find((s) => s.key === key)?.label ?? key}${v ? ` = ${v.slice(0, 80)}` : ""}`,
    result: "ok",
  });
  return listIntroFields(introId);
}

export function listProductIntros(): ProductIntro[] {
  return listStmt.all() as ProductIntro[];
}

export function addProductIntro(args: {
  name: string; category: string; vendor?: string | null; summary?: string | null; docName?: string | null; actor?: string | null;
}): ProductIntro {
  const name = (args.name ?? "").trim();
  const category = (args.category ?? "").trim() || "기타";
  if (!name) throw new Error("제품 이름이 비었습니다");
  const id = `pi-${name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}-${Date.now().toString(36)}`;
  insertStmt.run({
    id, name, category,
    vendor: (args.vendor ?? "")?.trim() || null,
    summary: (args.summary ?? "")?.trim() || null,
    docName: (args.docName ?? "")?.trim() || null,
    createdAt: Date.now(),
  });
  recordAudit({ kind: "write", actor: args.actor ?? null, action: "제품 소개자료 등록", target: name, detail: category, result: "ok" });
  const made = getStmt.get(id) as ProductIntro;
  syncIntroTriples(made); // 등록 즉시 기본 트리플(분류·공급사) — 항목은 담당자가 채우며 늘어난다
  return made;
}

export function removeProductIntro(id: string, actor?: string | null): boolean {
  const row = getStmt.get(id) as ProductIntro | undefined;
  if (!row) return false;
  delStmt.run(id);
  // 파생물도 같이 지운다 — 필드와 트리플이 남으면 지운 제품이 대화 답변에 유령으로 나온다.
  fieldsAllDelStmt.run(id);
  deleteTriplesBySource(introTripleSource(id));
  recordAudit({ kind: "write", actor: actor ?? null, action: "제품 소개자료 삭제", target: row.name, result: "ok" });
  return true;
}

export function registerProductIntroRoutes(app: Express): void {
  app.get("/api/product-intro", authMiddleware, (_req, res) => {
    // 필드까지 함께 — 화면(내 문서 vendor 탭)이 비교 판을 그릴 재료다. 스키마도 실어
    // 화면이 항목 이름을 **두 곳에 안 적게** 한다(단일 출처).
    res.json({
      items: listProductIntros().map((it) => ({ ...it, fields: listIntroFields(it.id) })),
      schema: INTRO_FIELD_SCHEMA,
    });
  });
  // 항목 값 확정 — 결재판(대화창)이 부른다. 빈 값이면 그 항목 삭제.
  app.put("/api/product-intro/:id/field/:key", authMiddleware, (req, res) => {
    const user = (req as Request & { user?: { displayName?: string } }).user;
    try {
      const fields = setIntroField(String(req.params.id), String(req.params.key),
        String((req.body as { value?: string })?.value ?? ""),
        { quote: (req.body as { quote?: string })?.quote ?? null, actor: user?.displayName ?? null });
      res.json({ ok: true, fields });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  // 삭제(2026-08-19 사장님 「리스트에서 필요 없는 건 삭제 가능해야」 — 삭제 일관화 ①).
  // removeProductIntro가 이미 감사까지 남긴다 — 라우트만 없어 화면이 막다른 길이었다.
  app.delete("/api/product-intro/:id", authMiddleware, (req, res) => {
    const user = (req as Request & { user?: { displayName?: string } }).user;
    const ok = removeProductIntro(String(req.params.id), user?.displayName ?? null);
    if (!ok) return res.status(404).json({ error: "해당 소개자료를 찾을 수 없습니다" });
    res.json({ ok: true });
  });
}
