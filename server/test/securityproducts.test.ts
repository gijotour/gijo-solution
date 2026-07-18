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
  classifyManual,
  importManual,
  listProducts,
} from "../src/engine/securityproducts";
import { createMaintenanceItem, resetMaintenanceForTests } from "../src/engine/maintenance";

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

  // ── 매뉴얼 자동 분류(Nessus처럼 파일만 올리면 반영) ────────────────────────
  it("classifies a manual to an existing product by model token in the filename", () => {
    const fw = createProduct({ name: "경계 방화벽 (FW-01)", category: "방화벽", vendor: "SECUI", model: "MF2" });
    createProduct({ name: "임직원 단말 EDR", category: "EDR", vendor: "AhnLab", model: "EPP" });

    // 모델명 "MF2"가 파일명에 있으면 그 제품으로 (구분자 달라도: mf2 / MF-2 스쿼시 매칭)
    const c = classifyManual("MF2_관리자_매뉴얼_v3.2.pdf", listProducts());
    expect(c.product?.id).toBe(fw.id);
    expect(c.reason).toBe("product-match");
    expect(c.kind).toBe("manual");
  });

  it("detects log manuals and attaches to the single product of a keyword-guessed category", () => {
    const fw = createProduct({ name: "경계 방화벽 (FW-01)", category: "방화벽" });
    createProduct({ name: "임직원 단말 EDR", category: "EDR" });

    // "방화벽" 키워드 + 그 종류 제품이 1개 → 그 제품. "로그" → logManual.
    const c = classifyManual("방화벽_차단로그_분석_가이드.txt", listProducts());
    expect(c.product?.id).toBe(fw.id);
    expect(c.reason).toBe("category-single");
    expect(c.kind).toBe("logManual");
    // "카탈로그"의 '로그'는 로그 매뉴얼로 오탐하지 않는다
    expect(classifyManual("방화벽_제품_카탈로그.pdf", listProducts()).kind).toBe("manual");
  });

  it("auto-creates a product (like Nessus auto-registers hosts) when nothing matches", () => {
    createProduct({ name: "경계 방화벽", category: "방화벽" });

    // VPN 키워드는 있지만 VPN 제품이 없다 → 새 제품(category VPN) 자동 등록
    const r = importManual("VPN_게이트웨이_설정_매뉴얼.pdf", undefined, "정요한");
    expect(r.createdProduct).toBe(true);
    expect(r.category).toBe("VPN");
    // 신규 등록 제품명은 파일명 그대로가 아니라 버전/문서종류 표기를 걷어낸 추천값으로 저장된다
    // (2026-07-19: "User_Guide" 같은 표기가 이름에 남으면 다른 벤더 매뉴얼과 오매칭되는 사고가
    //  있었다 — guessProductName으로 정리).
    expect(r.productName).toBe("VPN 게이트웨이 설정");
    expect(r.kind).toBe("manual");
    const created = getProduct(r.productId)!;
    expect(created.docs).toHaveLength(1);
    expect(created.docs[0].title).toBe("VPN_게이트웨이_설정_매뉴얼");

    // 키워드도 없으면 "기타"
    expect(importManual("이상한_장비_설명서.pdf", undefined).category).toBe("기타");
  });

  // ── 유지보수 점검 ↔ 보안제품 연결 ─────────────────────────────────────────
  it("links a maintenance item to a product by name (구분자·공백 차이 흡수)", () => {
    resetMaintenanceForTests();
    const fw = createProduct({ name: "경계 방화벽 (FW-01)", category: "방화벽" });

    // 제품명 표기가 달라도("방화벽(FW-01)" vs "방화벽 (FW-01)") 스쿼시 매칭으로 연결된다
    const m = createMaintenanceItem({ title: "정책 점검", productName: "경계 방화벽(FW-01)", scheduleDate: "2026-08-01" });
    expect(m.productId).toBe(fw.id);

    // 등록부에 없는 제품명이면 연결 없이 자유텍스트로만 남는다(기존 동작 보존)
    const loose = createMaintenanceItem({ title: "x", productName: "등록 안 된 장비", scheduleDate: "2026-08-01" });
    expect(loose.productId).toBeUndefined();

    // 명시적 productId가 오면 이름 매칭보다 우선
    const explicit = createMaintenanceItem({ title: "y", productName: "아무 이름", scheduleDate: "2026-08-01", productId: fw.id });
    expect(explicit.productId).toBe(fw.id);
  });

  it("POST /api/security-products/import-doc classifies via API (metadata-only, no file body)", async () => {
    await request(app).post("/api/security-products").set(auth()).send({ name: "웹방화벽 (WAF-01)", category: "WAF", model: "WEBFRONT" });

    const r = await request(app)
      .post("/api/security-products/import-doc")
      .set(auth())
      .send({ filename: "WEBFRONT_탐지로그_해설.txt" });
    expect(r.status).toBe(200);
    expect(r.body.reason).toBe("product-match"); // 모델명 WEBFRONT 매칭
    expect(r.body.kind).toBe("logManual");
    expect(r.body.createdProduct).toBe(false);

    const bad = await request(app).post("/api/security-products/import-doc").set(auth()).send({});
    expect(bad.status).toBe(400);
  });
});
