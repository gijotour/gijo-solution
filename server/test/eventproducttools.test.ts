// 관제 이벤트 상태 바꾸기 · 보안제품 지우기 (2026-08-31 · 대장 §2 끊김 4 · §7 끊김 3)
//
// 왜: 둘 다 **엔진은 있는데 대화 도구가 없어** 화면 버튼으로만 되던 자리다.
//  · 이벤트: analysishub `setEventStatus`가 있는데 화면 API만 썼다.
//    (update_finding_status는 **취약점 전용**이라 관제 이벤트는 못 받았다.)
//  · 제품: securityproducts `deleteProduct`가 자식 문서까지 지우는데 대화 길이 없었다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { createProduct, listProducts } from "../src/engine/securityproducts";
import { listAnalysisEvents } from "../src/engine/analysishub";
import { runSetEventStatus, runDeleteProduct } from "../src/engine/agenttools/handlers";

beforeEach(() => {
  // ⚠ 테이블 이름은 **product_docs**다(security_product_docs가 아니다) — 지어냈다가
  //   「no such table」로 13건이 죽었다. 원천(securityproducts.ts)의 SQL에 그렇게 적혀 있다.
  db.exec("DELETE FROM product_docs");
  db.exec("DELETE FROM security_products");
});

describe("보안제품 지우기", () => {
  it("이름으로 지운다", async () => {
    createProduct({ name: "FW-01", category: "방화벽" });
    const 답 = await runDeleteProduct({ name: "FW-01" });
    expect(답).toContain("지웠습니다");
    expect(listProducts().length).toBe(0);
  });

  it("★ 문서도 함께 지워진다고 **미리 말한다**(오해를 막는다)", async () => {
    createProduct({ name: "FW-01", category: "방화벽" });
    const 답 = await runDeleteProduct({ name: "FW-01" });
    expect(답, "함께 지워지는 것을 안 밝히면 나중에 「왜 없어졌냐」가 된다").toContain("매뉴얼·점검 문서도 함께");
  });

  it("이름을 안 주면 **있는 것을 보여 준다** — 아무거나 안 지운다", async () => {
    createProduct({ name: "FW-01", category: "방화벽" });
    createProduct({ name: "IPS-01", category: "IPS" });
    const 답 = await runDeleteProduct({});
    expect(답).toContain("어느 제품을 지울지");
    expect(listProducts().length, "이름 없이 지웠다").toBe(2);
  });

  it("없는 이름이면 등록된 것을 알려 준다", async () => {
    createProduct({ name: "FW-01", category: "방화벽" });
    const 답 = await runDeleteProduct({ name: "없는제품" });
    expect(답).toContain("못 찾았습니다");
    expect(답).toContain("FW-01");
    expect(listProducts().length, "엉뚱한 것을 지웠다").toBe(1);
  });

  it("★ 여러 개가 걸리면 **정확한 이름**을 묻는다 — 긴 쪽을 함부로 집지 않는다", async () => {
    createProduct({ name: "FW", category: "방화벽" });
    createProduct({ name: "FW-01", category: "방화벽" });
    const 답 = await runDeleteProduct({ name: "FW-0" });
    expect(답).toContain("정확한 이름");
    expect(listProducts().length, "고르지도 않고 지웠다").toBe(2);
  });

  it("정확히 일치하는 이름이 있으면 그것을 지운다(부분 일치보다 우선)", async () => {
    createProduct({ name: "FW", category: "방화벽" });
    createProduct({ name: "FW-01", category: "방화벽" });
    const 답 = await runDeleteProduct({ name: "FW" });
    expect(답).toContain("「FW」");
    expect(listProducts().map((p) => p.name)).toEqual(["FW-01"]);
  });

  it("등록된 제품이 없으면 그렇다고 말한다", async () => {
    const 답 = await runDeleteProduct({ name: "FW-01" });
    expect(답).toContain("등록된 보안제품이 없습니다");
  });
});

describe("관제 이벤트 상태 바꾸기", () => {
  it("★ 상태를 못 읽으면 **고를 것을 알려 준다** — 지어내지 않는다", async () => {
    const 답 = await runSetEventStatus({ event: "아무거나", status: "그냥" });
    expect(답).toContain("어떤 상태로 바꿀지");
    expect(답, "받은 값을 되돌려 줘야 사람이 고친다").toContain("그냥");
  });

  it("이벤트가 없으면 왜 없는지 알려 준다(빈손으로 안 돌려보낸다)", async () => {
    // 운영 리셋 이후 관제 이벤트가 0건인 상태를 그대로 재현한다.
    if (listAnalysisEvents().length) return; // 이미 있으면 이 검사는 뜻이 없다
    const 답 = await runSetEventStatus({ event: "x", status: "완료" });
    expect(답).toContain("관제 이벤트가 없습니다");
    expect(답, "다음에 무엇을 하면 되는지 알려 줘야 한다").toContain("반입");
  });
});

describe("배선 — 대장의 물음이 이 도구로 오고, 남의 것은 안 삼킨다", () => {
  const 규칙 = (tool: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const 루프 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const i = 루프.indexOf(`tool: "${tool}"`);
    expect(i, `${tool} 강제 규칙이 없다`).toBeGreaterThan(-1);
    const 앞 = 루프.lastIndexOf("    re: ", i);
    return eval(루프.slice(앞 + 8, 루프.indexOf("\n", 앞)).replace(/,\s*$/, "").replace(/\r$/, "")) as RegExp;
  };

  it("「이 이벤트 확인 처리로 바꿔줘」가 걸린다", () => {
    expect(규칙("set_event_status").test("이 이벤트 확인 처리로 바꿔줘")).toBe(true);
  });

  it("★★ 이벤트 규칙이 **취약점 상태 변경**을 안 삼킨다(영토가 다르다)", () => {
    const ev = 규칙("set_event_status");
    for (const 남의것 of ["이 취약점 조치완료로 바꿔줘", "관제 이벤트 뭐 있어?"]) {
      expect(ev.test(남의것), `${남의것}을 삼킨다 — 낱말 가로채기`).toBe(false);
    }
  });

  it("「FW-01 등록부에서 삭제해줘」가 걸린다", () => {
    expect(규칙("delete_product").test("FW-01 등록부에서 삭제해줘")).toBe(true);
  });

  it("★★ 삭제 규칙이 **문서·자산·일정 삭제**를 안 삼킨다", () => {
    const dp = 규칙("delete_product");
    for (const 남의것 of ["이 문서 삭제해줘", "자산 삭제해줘", "점검 일정 삭제해줘"]) {
      expect(dp.test(남의것), `${남의것}을 삼킨다 — 낱말 가로채기`).toBe(false);
    }
  });
});
