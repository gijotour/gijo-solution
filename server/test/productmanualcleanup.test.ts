// 제품 삭제 시 매뉴얼 동반 정리 — 되돌릴 수 없는 동작이라 안전장치를 코드로 못 박는다.
//
// 배경(2026-07-26): 제품만 지워지고 매뉴얼은 지식베이스에 남아, 없어진 장비의 매뉴얼을 AI가
// 계속 근거로 들고 답했다(FOCS 실사례). 이제 함께 지우되 ① 공용 매뉴얼은 보존 ② 범위를
// 담당자가 고른다. 이 두 가지가 깨지면 남의 자료가 소리 없이 사라진다.
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.GIJO_DB_PATH = ":memory:";

const deleted: { documentId: string; withFile: boolean }[] = [];
vi.mock("../src/engine/memory.js", () => ({
  deleteDocument: async (documentId: string, withFile = false) => {
    deleted.push({ documentId, withFile });
    return { documentId, deletedChunks: 3, deletedFile: withFile };
  },
}));

const {
  createProduct, addProductDoc, manualsOnDelete, cleanupProductManuals, resetSecurityProductsForTests,
} = await import("../src/engine/securityproducts");

describe("제품 삭제 시 매뉴얼 동반 정리", () => {
  beforeEach(() => {
    resetSecurityProductsForTests();
    deleted.length = 0;
  });

  it("제품에만 걸린 매뉴얼은 지운다", async () => {
    const p = createProduct({ name: "FOCS", category: "기타" });
    addProductDoc(p.id, { kind: "manual", title: "FOCS 매뉴얼", docName: "FOCS-매뉴얼.pdf" });

    const r = await cleanupProductManuals(p.id, "kb");
    expect(r.removed).toEqual(["FOCS-매뉴얼.pdf"]);
    expect(deleted).toEqual([{ documentId: "FOCS-매뉴얼.pdf", withFile: false }]);
  });

  it("다른 제품도 쓰는 매뉴얼은 절대 지우지 않는다 — 한 제품을 지웠다고 남의 자료가 사라지면 안 된다", async () => {
    const a = createProduct({ name: "방화벽 A", category: "방화벽" });
    const b = createProduct({ name: "방화벽 B", category: "방화벽" });
    addProductDoc(a.id, { kind: "manual", title: "공용 운영 매뉴얼", docName: "공용-운영매뉴얼.pdf" });
    addProductDoc(b.id, { kind: "manual", title: "공용 운영 매뉴얼", docName: "공용-운영매뉴얼.pdf" });

    const r = await cleanupProductManuals(a.id, "file");
    expect(r.removed).toEqual([]);
    expect(r.keptShared).toEqual([{ docName: "공용-운영매뉴얼.pdf", sharedWith: ["방화벽 B"] }]);
    expect(deleted).toEqual([]);
  });

  it("keep이면 아무것도 지우지 않는다 — 범위를 안 고른 오래된 클라이언트가 지식을 날리면 안 된다", async () => {
    const p = createProduct({ name: "V3", category: "백신" });
    addProductDoc(p.id, { kind: "manual", title: "V3 매뉴얼", docName: "V3-매뉴얼.pdf" });

    const r = await cleanupProductManuals(p.id, "keep");
    expect(r.removed).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it("file 모드는 원본 파일까지 지운다", async () => {
    const p = createProduct({ name: "EDR", category: "EDR" });
    addProductDoc(p.id, { kind: "manual", title: "EDR 매뉴얼", docName: "EDR-매뉴얼.pdf" });

    await cleanupProductManuals(p.id, "file");
    expect(deleted).toEqual([{ documentId: "EDR-매뉴얼.pdf", withFile: true }]);
  });

  it("파일 없이 제목만 적어 둔 문서는 대상이 아니다 — 지식베이스에 실체가 없다", () => {
    const p = createProduct({ name: "WAF", category: "WAF" });
    addProductDoc(p.id, { kind: "manual", title: "제목만 있는 항목" });
    expect(manualsOnDelete(p.id)).toEqual([]);
  });

  it("미리보기가 지워질 것과 남을 것을 구분해 알려준다", () => {
    const a = createProduct({ name: "DLP", category: "DLP" });
    const b = createProduct({ name: "DLP 예비", category: "DLP" });
    addProductDoc(a.id, { kind: "manual", title: "DLP 전용", docName: "dlp-전용.pdf" });
    addProductDoc(a.id, { kind: "logManual", title: "DLP 공용", docName: "dlp-공용.pdf" });
    addProductDoc(b.id, { kind: "manual", title: "DLP 공용", docName: "dlp-공용.pdf" });

    const plan = manualsOnDelete(a.id);
    expect(plan.find((m) => m.docName === "dlp-전용.pdf")?.sharedWith).toEqual([]);
    expect(plan.find((m) => m.docName === "dlp-공용.pdf")?.sharedWith).toEqual(["DLP 예비"]);
  });

  it("한 제품에 같은 파일이 두 번 걸려 있어도 한 번만 지운다", async () => {
    const p = createProduct({ name: "IPS", category: "IPS" });
    addProductDoc(p.id, { kind: "manual", title: "IPS 매뉴얼", docName: "ips.pdf" });
    addProductDoc(p.id, { kind: "logManual", title: "IPS 로그 매뉴얼", docName: "ips.pdf" });

    const r = await cleanupProductManuals(p.id, "kb");
    expect(r.removed).toEqual(["ips.pdf"]);
    expect(deleted).toHaveLength(1);
  });
});
