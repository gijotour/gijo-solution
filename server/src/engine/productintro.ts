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
  return getStmt.get(id) as ProductIntro;
}

export function removeProductIntro(id: string, actor?: string | null): boolean {
  const row = getStmt.get(id) as ProductIntro | undefined;
  if (!row) return false;
  delStmt.run(id);
  recordAudit({ kind: "write", actor: actor ?? null, action: "제품 소개자료 삭제", target: row.name, result: "ok" });
  return true;
}

export function registerProductIntroRoutes(app: Express): void {
  app.get("/api/product-intro", authMiddleware, (_req, res) => {
    res.json({ items: listProductIntros() });
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
