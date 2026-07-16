// engine/securityproducts.ts — 운영 중인 보안제품 등록부(종류별 관리 + 제품/로그 매뉴얼 문서)
//
// 보안담당자가 유지보수하는 보안제품(방화벽·EDR·DLP·WAF·VPN 등)을 종류별로 구분해 한곳에서
// 관리한다. maintenance.ts가 "언제 점검하나(일정·승인)"라면, 여기는 "무슨 제품을 운영하며 그
// 제품의 매뉴얼·로그 분석 매뉴얼이 어디 있나"를 다룬다. 대시보드에서 종류별로 한눈에 보이고,
// 각 제품에 제품 매뉴얼·로그 매뉴얼을 첨부하면 텍스트를 추출해 지식베이스(RAG)에도 수집한다
// (maintenance 점검서와 같은 패턴) — "올린 문서 검색"에서 바로 찾아지는 문서가 된다.

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import type { GijoUser } from "../auth/users";

// 보안제품 종류 카탈로그 — 대시보드/등록 폼에서 공용으로 쓴다. 한국 중소기업 보안팀이 흔히
// 운영하는 제품군 위주(과한 세분화 지양). "기타"로 흡수 가능.
export const PRODUCT_CATEGORIES = [
  { id: "방화벽", label: "방화벽", icon: "🧱" },
  { id: "EDR", label: "EDR (단말탐지대응)", icon: "🖥" },
  { id: "DLP", label: "DLP (정보유출방지)", icon: "🔒" },
  { id: "WAF", label: "WAF (웹방화벽)", icon: "🌐" },
  { id: "VPN", label: "VPN", icon: "🔑" },
  { id: "IPS", label: "IPS/IDS (침입방지)", icon: "🛡" },
  { id: "SIEM", label: "SIEM (통합로그관리)", icon: "📊" },
  { id: "백신", label: "백신 (안티바이러스)", icon: "🦠" },
  { id: "NAC", label: "NAC (접근제어)", icon: "🚪" },
  { id: "기타", label: "기타", icon: "📦" },
] as const;
const CATEGORY_IDS = new Set<string>(PRODUCT_CATEGORIES.map((c) => c.id));

// 제품 문서 종류 — 제품 매뉴얼 / 로그(분석) 매뉴얼 / 기타.
export const DOC_KINDS = [
  { id: "manual", label: "제품 매뉴얼" },
  { id: "logManual", label: "로그 매뉴얼" },
  { id: "etc", label: "기타 문서" },
] as const;
const DOC_KIND_IDS = new Set<string>(DOC_KINDS.map((k) => k.id));

export interface SecurityProduct {
  id: string;
  name: string;
  category: string;
  vendor?: string;
  model?: string;
  assetId?: string;
  assetName?: string; // assetId의 현재 자산명(읽을 때 조회)
  note?: string;
  docs: ProductDoc[];
  createdAt: number;
  updatedAt: number;
}

export interface ProductDoc {
  id: string;
  productId: string;
  kind: string; // manual | logManual | etc
  title: string;
  docName?: string; // 지식베이스(RAG)에 수집된 문서명 — 있으면 검색됨
  note?: string;
  uploadedBy?: string;
  at: number;
}

interface ProductRow {
  id: string;
  name: string;
  category: string;
  vendor: string | null;
  model: string | null;
  assetId: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}
interface DocRow {
  id: string;
  productId: string;
  kind: string;
  title: string;
  docName: string | null;
  note: string | null;
  uploadedBy: string | null;
  at: number;
}

const assetNameStmt = db.prepare("SELECT name FROM assets WHERE id = ?");
function resolveAssetName(assetId: string | null): string | undefined {
  if (!assetId) return undefined;
  return (assetNameStmt.get(assetId) as { name: string } | undefined)?.name;
}

const upsertProductStmt = db.prepare(`
  INSERT INTO security_products (id, name, category, vendor, model, assetId, note, createdAt, updatedAt)
  VALUES (@id, @name, @category, @vendor, @model, @assetId, @note, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, category=excluded.category, vendor=excluded.vendor, model=excluded.model,
    assetId=excluded.assetId, note=excluded.note, updatedAt=excluded.updatedAt
`);
const getProductStmt = db.prepare("SELECT * FROM security_products WHERE id = ?");
const listProductsStmt = db.prepare("SELECT * FROM security_products ORDER BY category ASC, name ASC");
const deleteProductStmt = db.prepare("DELETE FROM security_products WHERE id = ?");
const listDocsStmt = db.prepare("SELECT * FROM product_docs WHERE productId = ? ORDER BY at ASC, id ASC");
const insertDocStmt = db.prepare(
  "INSERT INTO product_docs (id, productId, kind, title, docName, note, uploadedBy, at) VALUES (@id, @productId, @kind, @title, @docName, @note, @uploadedBy, @at)"
);
const getDocStmt = db.prepare("SELECT * FROM product_docs WHERE id = ?");
const deleteDocStmt = db.prepare("DELETE FROM product_docs WHERE id = ?");
const deleteDocsOfProductStmt = db.prepare("DELETE FROM product_docs WHERE productId = ?");

function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function docsOf(productId: string): ProductDoc[] {
  return (listDocsStmt.all(productId) as DocRow[]).map((r) => ({
    id: r.id,
    productId: r.productId,
    kind: r.kind,
    title: r.title,
    docName: r.docName ?? undefined,
    note: r.note ?? undefined,
    uploadedBy: r.uploadedBy ?? undefined,
    at: r.at,
  }));
}

function fromRow(row: ProductRow): SecurityProduct {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    vendor: row.vendor ?? undefined,
    model: row.model ?? undefined,
    assetId: row.assetId ?? undefined,
    assetName: resolveAssetName(row.assetId),
    note: row.note ?? undefined,
    docs: docsOf(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listProducts(): SecurityProduct[] {
  return (listProductsStmt.all() as ProductRow[]).map(fromRow);
}

export function getProduct(id: string): SecurityProduct | undefined {
  const row = getProductStmt.get(id) as ProductRow | undefined;
  return row ? fromRow(row) : undefined;
}

// 대시보드용 — 종류(category)별로 묶어 카탈로그 순서대로 돌려준다(제품 없는 종류는 제외).
export function productsByCategory(): { category: string; label: string; icon: string; products: SecurityProduct[] }[] {
  const all = listProducts();
  return PRODUCT_CATEGORIES.map((c) => ({
    category: c.id,
    label: c.label,
    icon: c.icon,
    products: all.filter((p) => p.category === c.id),
  })).filter((g) => g.products.length > 0);
}

export function createProduct(args: {
  name: string;
  category: string;
  vendor?: string;
  model?: string;
  assetId?: string;
  note?: string;
}): SecurityProduct {
  const name = (args.name ?? "").trim();
  if (!name) throw new Error("제품명(name)이 필요합니다");
  // 카탈로그에 없는 종류는 "기타"로 흡수한다(자유 입력 오염 방지).
  const category = CATEGORY_IDS.has(args.category) ? args.category : "기타";
  const now = Date.now();
  const id = newId("sp");
  upsertProductStmt.run({
    id,
    name,
    category,
    vendor: args.vendor?.trim() || null,
    model: args.model?.trim() || null,
    assetId: args.assetId?.trim() || null,
    note: args.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });
  return getProduct(id)!;
}

export function updateProduct(
  id: string,
  patch: { name?: string; category?: string; vendor?: string; model?: string; assetId?: string; note?: string }
): SecurityProduct | undefined {
  const existing = getProduct(id);
  if (!existing) return undefined;
  const category = patch.category !== undefined ? (CATEGORY_IDS.has(patch.category) ? patch.category : "기타") : existing.category;
  upsertProductStmt.run({
    id,
    name: patch.name?.trim() || existing.name,
    category,
    vendor: patch.vendor !== undefined ? patch.vendor.trim() || null : existing.vendor ?? null,
    model: patch.model !== undefined ? patch.model.trim() || null : existing.model ?? null,
    assetId: patch.assetId !== undefined ? patch.assetId.trim() || null : existing.assetId ?? null,
    note: patch.note !== undefined ? patch.note.trim() || null : existing.note ?? null,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  });
  return getProduct(id);
}

export function deleteProduct(id: string): boolean {
  if (!getProduct(id)) return false;
  deleteDocsOfProductStmt.run(id); // 자식 문서 먼저(FK 순서)
  deleteProductStmt.run(id);
  return true;
}

export function addProductDoc(
  productId: string,
  args: { kind: string; title: string; docName?: string; note?: string },
  uploadedBy?: string
): ProductDoc {
  if (!getProduct(productId)) throw new Error("존재하지 않는 보안제품입니다");
  const title = (args.title ?? "").trim();
  if (!title) throw new Error("문서 제목(title)이 필요합니다");
  const kind = DOC_KIND_IDS.has(args.kind) ? args.kind : "etc";
  const id = newId("pd");
  insertDocStmt.run({
    id,
    productId,
    kind,
    title,
    docName: args.docName?.trim() || null,
    note: args.note?.trim() || null,
    uploadedBy: uploadedBy ?? null,
    at: Date.now(),
  });
  return getDocStmt.get(id) as unknown as ProductDoc;
}

export function deleteProductDoc(docId: string): boolean {
  if (!getDocStmt.get(docId)) return false;
  deleteDocStmt.run(docId);
  return true;
}

// ── 매뉴얼 자동 분류 임포트 — Nessus 업로드처럼 "파일만 올리면 알아서 반영" ─────────
// 파일명으로 ① 어느 제품 문서인지(기존 제품 매칭, 없으면 자동 등록) ② 제품 종류(category)
// ③ 제품 매뉴얼인지 로그 매뉴얼인지(kind)를 판별한다. 내용이 아니라 파일명 휴리스틱이다 —
// 사내 매뉴얼 파일명에는 제품명/모델명이 들어가는 게 관례라 이걸 신뢰하고, 빗나가면
// 화면에서 옮기면 된다(자동 분류 결과를 reason으로 투명하게 보여준다).

// 종류 추정 키워드. "웹방화벽"이 "방화벽"을 포함하므로 WAF를 방화벽보다 먼저 검사한다.
const CATEGORY_KEYWORDS: { id: string; re: RegExp }[] = [
  { id: "WAF", re: /waf|웹방화벽|webfront/i },
  { id: "방화벽", re: /방화벽|firewall|(?:^|[^a-z])fw(?:[^a-z]|$)/i },
  { id: "EDR", re: /edr|단말탐지|엔드포인트/i },
  { id: "DLP", re: /dlp|정보유출|유출방지/i },
  { id: "VPN", re: /vpn|가상사설망/i },
  { id: "IPS", re: /(?:^|[^a-z])(ips|ids)(?:[^a-z]|$)|침입방지|침입탐지/i },
  { id: "SIEM", re: /siem|통합로그|splunk|qradar/i },
  { id: "백신", re: /백신|안티바이러스|antivirus|(?:^|[^a-z])v3(?:[^a-z]|$)|알약/i },
  { id: "NAC", re: /nac|접근제어|genian/i },
];

function guessCategory(filename: string): string | undefined {
  return CATEGORY_KEYWORDS.find((k) => k.re.test(filename))?.id;
}

// 로그 매뉴얼 판별. "카탈로그/catalog"의 '로그'는 오탐이라 먼저 제거하고 검사한다.
function guessKind(filename: string): string {
  const cleaned = filename.replace(/카탈로그|catalog/gi, "");
  return /로그|(?:^|[^a-z])logs?(?:[^a-z]|$)/i.test(cleaned) ? "logManual" : "manual";
}

// 한글/영숫자 토큰화 + 구분자 제거형(squash) — "FW-01"이 파일명에 "fw01"로 붙어 있어도 잡는다.
const tokensOf = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]+|[가-힣]+/g) ?? []).filter((t) => t.length >= 2);
const squash = (s: string): string => (s.toLowerCase().match(/[a-z0-9가-힣]+/g) ?? []).join("");

// 파일명 ↔ 기존 제품 유사도. 모델/벤더 같은 고유 식별자는 세게, 일반 이름 토큰은 약하게 친다.
function matchScore(filename: string, p: SecurityProduct): number {
  const fileSquashed = squash(filename);
  const fileTokens = new Set(tokensOf(filename));
  let score = 0;
  if (p.model && squash(p.model).length >= 2 && fileSquashed.includes(squash(p.model))) score += 3;
  if (p.vendor && squash(p.vendor).length >= 3 && fileSquashed.includes(squash(p.vendor))) score += 2;
  for (const t of tokensOf(p.name)) if (fileTokens.has(t)) score += 1;
  return score;
}

export interface ManualClassification {
  product?: SecurityProduct; // 붙일 기존 제품(없으면 자동 등록 대상)
  category: string; // 제품이 없을 때 만들 종류
  kind: string; // manual | logManual
  reason: "product-match" | "category-single" | "category-best" | "new-product";
}

export function classifyManual(filename: string, products: SecurityProduct[]): ManualClassification {
  const kind = guessKind(filename);
  const category = guessCategory(filename);
  const scored = products.map((p) => ({ p, score: matchScore(filename, p) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  // ① 고유 식별자(모델명 등)가 잡히면 그 제품으로.
  if (best && best.score >= 2) return { product: best.p, category: best.p.category, kind, reason: "product-match" };
  if (category) {
    const inCat = products.filter((p) => p.category === category);
    // ② 그 종류의 제품이 하나뿐이면 당연히 그 제품(중소기업은 종류당 1대가 보통).
    if (inCat.length === 1) return { product: inCat[0], category, kind, reason: "category-single" };
    // ③ 여러 개면 그중 파일명과 조금이라도 겹치는 쪽으로.
    const bestInCat = inCat.map((p) => ({ p, score: matchScore(filename, p) })).sort((a, b) => b.score - a.score)[0];
    if (bestInCat && bestInCat.score >= 1) return { product: bestInCat.p, category, kind, reason: "category-best" };
  }
  // ④ 아무 데도 못 붙이면 새 제품으로 자동 등록(Nessus가 처음 본 호스트를 자산으로 등록하듯).
  return { category: category ?? "기타", kind, reason: "new-product" };
}

export interface ManualImportResult {
  filename: string;
  productId: string;
  productName: string;
  category: string;
  kind: string;
  createdProduct: boolean;
  reason: ManualClassification["reason"];
  docName?: string; // RAG 수집됐으면 파일명(= "올린 문서 검색"에서 찾아짐)
}

// 분류 결과를 실제로 반영한다(제품 자동 등록 + 문서 추가). RAG 수집은 라우트에서 처리해 넘긴다.
export function importManual(filename: string, docName: string | undefined, uploadedBy?: string): ManualImportResult {
  const stem = filename.replace(/\.[^.]+$/, "");
  const c = classifyManual(filename, listProducts());
  const product = c.product ?? createProduct({ name: stem, category: c.category, note: "매뉴얼 일괄 업로드로 자동 등록" });
  addProductDoc(product.id, { kind: c.kind, title: stem, docName }, uploadedBy);
  return {
    filename,
    productId: product.id,
    productName: product.name,
    category: product.category,
    kind: c.kind,
    createdProduct: !c.product,
    reason: c.reason,
    docName,
  };
}

// 테스트 전용.
export function resetSecurityProductsForTests(): void {
  db.exec("DELETE FROM product_docs; DELETE FROM security_products;");
}

// 최초 기동 시(비어 있을 때) 종류별 감을 잡을 샘플 제품을 시드한다 — 다른 엔진의 seed 패턴과 동일.
// 문서는 메타만(파일 미첨부) 몇 건 넣어 "제품 매뉴얼/로그 매뉴얼" 자리를 보여준다.
export function seedSampleProductsIfEmpty(): void {
  if ((listProductsStmt.all() as ProductRow[]).length > 0) return;
  const samples: { name: string; category: string; vendor?: string; model?: string; docs?: { kind: string; title: string }[] }[] = [
    {
      name: "경계 방화벽 (FW-01)", category: "방화벽", vendor: "SECUI", model: "MF2",
      docs: [
        { kind: "manual", title: "MF2 관리자 매뉴얼 v3.2" },
        { kind: "logManual", title: "방화벽 로그 필드 해설 · 차단로그 분석 가이드" },
      ],
    },
    {
      name: "임직원 단말 EDR", category: "EDR", vendor: "AhnLab", model: "EPP",
      docs: [
        { kind: "manual", title: "EPP 운영자 매뉴얼" },
        { kind: "logManual", title: "EDR 이벤트 로그 해석 · 위협 헌팅 로그 가이드" },
      ],
    },
    {
      name: "정보유출 방지 (DLP)", category: "DLP", vendor: "Somansa",
      docs: [{ kind: "manual", title: "DLP 정책 설정 매뉴얼" }],
    },
    {
      name: "웹방화벽 (WAF-01)", category: "WAF", vendor: "Piolink", model: "WEBFRONT",
      docs: [{ kind: "logManual", title: "WAF 탐지 로그 분석 매뉴얼" }],
    },
  ];
  for (const s of samples) {
    const p = createProduct({ name: s.name, category: s.category, vendor: s.vendor, model: s.model });
    for (const d of s.docs ?? []) addProductDoc(p.id, { kind: d.kind, title: d.title }, "정요한");
  }
}
seedSampleProductsIfEmpty();

export function registerSecurityProductRoutes(app: Express): void {
  app.get("/api/security-products", authMiddleware, (_req, res) => res.json(listProducts()));
  app.get("/api/security-products/grouped", authMiddleware, (_req, res) => res.json(productsByCategory()));
  app.get("/api/security-products/categories", authMiddleware, (_req, res) =>
    res.json({ categories: PRODUCT_CATEGORIES, docKinds: DOC_KINDS })
  );

  app.post("/api/security-products", authMiddleware, (req, res) => {
    try {
      const { name, category, vendor, model, assetId, note } = req.body ?? {};
      res.json(createProduct({ name, category, vendor, model, assetId, note }));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put("/api/security-products/:id", authMiddleware, (req, res) => {
    const updated = updateProduct(String(req.params.id), req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "존재하지 않는 보안제품입니다" });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/security-products/:id", authMiddleware, (req, res) => {
    res.status(deleteProduct(String(req.params.id)) ? 200 : 404).json({ ok: true });
  });

  // 제품 문서 추가. filename+content(base64)가 함께 오면 텍스트를 추출해 지식베이스(RAG)에도
  // 수집한다(maintenance 점검서와 같은 패턴) — 매뉴얼이 곧 검색 가능한 문서가 된다.
  app.post(
    "/api/security-products/:id/docs",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { kind, title, note, filename, content } = req.body as {
        kind?: string;
        title?: string;
        note?: string;
        filename?: string;
        content?: string;
      };
      const user = (req as Request & { user?: GijoUser }).user;
      let docName: string | undefined;
      if (filename && content) {
        const { extractDocumentText } = await import("./dataset.js");
        const text = await extractDocumentText(filename, content);
        if (text.trim()) {
          const { ingestText, GLOBAL_SCOPE } = await import("./memory.js");
          await ingestText(filename, text, GLOBAL_SCOPE);
          docName = filename;
        }
      }
      try {
        // 제목이 없으면 첨부 파일명을 제목으로 쓴다.
        res.json(addProductDoc(String(req.params.id), { kind: kind ?? "etc", title: (title ?? "").trim() || filename || "", docName, note }, user?.displayName));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  app.delete("/api/security-products/docs/:docId", authMiddleware, (req, res) => {
    res.status(deleteProductDoc(String(req.params.docId)) ? 200 : 404).json({ ok: true });
  });

  // 매뉴얼 자동 분류 임포트 — 파일만 올리면 제품 매칭(없으면 자동 등록)·종류·문서구분까지
  // 알아서 반영한다(Nessus 업로드와 같은 UX). content(base64)가 있으면 텍스트를 추출해
  // 지식베이스(RAG)에도 수집하므로 업로드 즉시 오케스트레이터가 참고할 수 있다.
  app.post(
    "/api/security-products/import-doc",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { filename, content } = req.body as { filename?: string; content?: string };
      if (!filename || !filename.trim()) {
        res.status(400).json({ error: "filename이 필요합니다" });
        return;
      }
      const user = (req as Request & { user?: GijoUser }).user;
      let docName: string | undefined;
      if (content) {
        const { extractDocumentText } = await import("./dataset.js");
        const text = await extractDocumentText(filename, content);
        if (text.trim()) {
          const { ingestText, GLOBAL_SCOPE } = await import("./memory.js");
          await ingestText(filename, text, GLOBAL_SCOPE);
          docName = filename;
        }
      }
      res.json(importManual(filename.trim(), docName, user?.displayName));
    })
  );
}
