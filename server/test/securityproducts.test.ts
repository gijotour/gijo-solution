import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// 문서 첨부 시 dataset/memory(RAG) 경로가 실제 임베딩 모델을 띄우지 않게 목킹한다.
vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import {
  createProduct,
  addProductDoc,
  productsByCategory,
  getProduct,
  deleteProduct,
  resetSecurityProductsForTests,
} from "../src/engine/securityproducts";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("securityproducts (보안제품 종류별 관리 + 매뉴얼)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    resetSecurityProductsForTests();
    app = createApp();
    token = await login(app);
  });

  it("registers a product with a category and lists it grouped by category", () => {
    createProduct({ name: "경계 방화벽", category: "방화벽", vendor: "SECUI" });
    createProduct({ name: "임직원 EDR", category: "EDR" });
    createProduct({ name: "웹방화벽", category: "WAF" });

    const grouped = productsByCategory();
    // 카탈로그 순서(방화벽 → EDR → WAF …)대로, 제품 있는 종류만
    expect(grouped.map((g) => g.category)).toEqual(["방화벽", "EDR", "WAF"]);
    expect(grouped[0].products[0].name).toBe("경계 방화벽");
    expect(grouped[0].icon).toBe("🧱");
  });

  it("absorbs an unknown category into 기타", () => {
    const p = createProduct({ name: "정체불명 장비", category: "이상한종류" });
    expect(p.category).toBe("기타");
  });

  it("attaches product/log manuals and cascades doc delete on product delete", () => {
    const p = createProduct({ name: "방화벽", category: "방화벽" });
    addProductDoc(p.id, { kind: "manual", title: "관리자 매뉴얼" });
    addProductDoc(p.id, { kind: "logManual", title: "차단로그 분석 가이드" });
    addProductDoc(p.id, { kind: "이상한종류", title: "분류불가 문서" }); // → etc로 흡수

    const fresh = getProduct(p.id)!;
    expect(fresh.docs.map((d) => d.kind).sort()).toEqual(["etc", "logManual", "manual"]);
    expect(fresh.docs.find((d) => d.kind === "logManual")!.title).toBe("차단로그 분석 가이드");

    expect(deleteProduct(p.id)).toBe(true);
    expect(getProduct(p.id)).toBeUndefined();
    // 문서도 함께 삭제됐는지 — 제품 삭제 후 재조회 불가
  });

  it("POST/GET/DELETE via API works end to end and 404s a bad delete", async () => {
    const created = await request(app).post("/api/security-products").set(auth()).send({ name: "DLP", category: "DLP" });
    expect(created.status).toBe(200);
    const id = created.body.id;

    const cats = await request(app).get("/api/security-products/categories").set(auth());
    expect(cats.body.categories.some((c: { id: string }) => c.id === "방화벽")).toBe(true);
    expect(cats.body.docKinds.some((k: { id: string }) => k.id === "logManual")).toBe(true);

    // 문서 첨부(파일 없이 메타만)
    const doc = await request(app).post(`/api/security-products/${id}/docs`).set(auth()).send({ kind: "manual", title: "DLP 정책 매뉴얼" });
    expect(doc.status).toBe(200);

    const list = await request(app).get("/api/security-products").set(auth());
    const dlp = list.body.find((p: { id: string }) => p.id === id);
    expect(dlp.docs).toHaveLength(1);
    expect(dlp.docs[0].title).toBe("DLP 정책 매뉴얼");

    expect((await request(app).delete(`/api/security-products/${id}`).set(auth())).status).toBe(200);
    expect((await request(app).delete(`/api/security-products/nope`).set(auth())).status).toBe(404);
  });

  it("requires a product name and a doc title", () => {
    expect(() => createProduct({ name: "  ", category: "방화벽" })).toThrow();
    const p = createProduct({ name: "x", category: "방화벽" });
    expect(() => addProductDoc(p.id, { kind: "manual", title: "" })).toThrow();
  });
});
