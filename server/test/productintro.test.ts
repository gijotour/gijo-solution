// 제품 소개자료 대장 (추가 기능, 2026-08-09) — 보안제품 등록부와 **별도 대장** 계약
//
// ① 등록·목록·삭제가 별도 표(product_intro)에서 돈다 — 등록부(security_products)에 안 섞임
// ② 등록은 쓰기 도구(결재판 경유) — write:true ("처음 올릴 때 결재판에서 확인" 사용자 지시)
// ③ 강제 라우팅은 이름을 뽑았을 때만 — 빈 결재판 방지
import { describe, it, expect, afterEach } from "vitest";
import { addProductIntro, listProductIntros, removeProductIntro } from "../src/engine/productintro";
import { listAgentTools } from "../src/engine/agenttools/registry";
import { forcedToolFor } from "../src/engine/agentloop";

afterEach(() => {
  for (const it of listProductIntros()) removeProductIntro(it.id);
});

describe("소개자료 대장", () => {
  it("등록·목록·삭제 — 별도 대장에서 돈다", () => {
    const a = addProductIntro({ name: "SecuFW", category: "방화벽", vendor: "시큐업" });
    expect(a.id).toMatch(/^pi-/);
    expect(listProductIntros().map((x) => x.name)).toContain("SecuFW");
    expect(removeProductIntro(a.id)).toBe(true);
    expect(listProductIntros()).toHaveLength(0);
  });

  it("빈 이름은 거절, 분류를 비우면 「기타」", () => {
    expect(() => addProductIntro({ name: " ", category: "" })).toThrow(/이름/);
    const b = addProductIntro({ name: "NoCat", category: "" });
    expect(b.category).toBe("기타");
  });
});

describe("결재판·라우팅 계약", () => {
  it("register_product_intro는 쓰기 도구다 — 결재판을 거친다", () => {
    const t = listAgentTools().find((x) => x.name === "register_product_intro")!;
    expect(t.write).toBe(true);
    expect(typeof t.effect).toBe("function");
  });

  it("「제품 소개자료 등록: 이름, 분류: …」가 결정적으로 붙는다(인자 추출 포함)", () => {
    const r = forcedToolFor("제품 소개자료 등록: SecuFW, 분류: 방화벽, 벤더: 시큐업", { role: "admin" });
    expect(r?.tool).toBe("register_product_intro");
    expect(r?.args.name).toBe("SecuFW");
    expect(r?.args.category).toBe("방화벽");
    expect(r?.args.vendor).toBe("시큐업");
  });

  it("이름을 못 뽑으면 강제하지 않는다 — 빈 결재판 방지", () => {
    const r = forcedToolFor("제품 소개자료 등록해줘", { role: "admin" });
    expect(r?.tool).not.toBe("register_product_intro");
  });
});
