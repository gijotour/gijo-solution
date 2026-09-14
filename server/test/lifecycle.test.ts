// 계획서: 중-7 + 전-4 — 계약·생애주기(협력사·EOS/EOL·구독·유지보수) 잎 모듈
// 승인: 2026-09-14 사장님 「계약·생애주기 시안 승인」 · mockups/asset-lifecycle/시안.html
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  getLifecycle,
  saveLifecycle,
  listLifecycleDueSoon,
  listAllLifecycle,
  생애주기배지,
  listLifecycleBadges,
  EOS대체안내,
  남은일수,
  임박일,
  주의일,
  LIFECYCLE_FIELD_SCHEMA,
  resolveLifecycleField,
  type LifecycleRow,
} from "../src/engine/lifecycle";
import { registerAsset, resetAssetsForTests } from "../src/engine/assets";
import { createProduct, resetSecurityProductsForTests } from "../src/engine/securityproducts";
import { findAgentTool, buildApproval } from "../src/engine/agenttools";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAuditForTests, listAudit } from "../src/engine/audit";

async function 로그인(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body as { accessToken: string };
}

function 빈행(): Omit<LifecycleRow, "id" | "targetType" | "targetId" | "createdAt" | "updatedAt"> {
  return {
    vendorContact: null, licenseType: null, subStart: null, subEnd: null, maintenanceEnd: null,
    eos: null, eol: null, extName: null, extEnd: null, evidence: null, note: null, updatedBy: null,
  };
}

function 날짜더하기(base: string, days: number): string {
  // ⚠ toISOString()(UTC)로 뽑으면 로컬 표준시가 UTC+n일 때 하루씩 밀린다(2026-09-14 WSL
  //   실측 — dday=-1 요청이 -2로 나왔다) — lifecycle.ts의 오늘글()과 같은 방식(로컬 연/월/일을
  //   직접 뽑는다)으로 맞춘다.
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("engine/lifecycle — 계약·생애주기", () => {
  it("잣대 상수 — 임박일=30, 주의일=90 (사본 방지)", () => {
    expect(임박일).toBe(30);
    expect(주의일).toBe(90);
  });

  it("LIFECYCLE_FIELD_SCHEMA는 9칸이다(게시 관문 후보 ① 칸 수 검사의 잣대)", () => {
    expect(LIFECYCLE_FIELD_SCHEMA).toHaveLength(9);
  });

  // ⓐ 저장→조회 왕복
  it("ⓐ saveLifecycle → getLifecycle 왕복", () => {
    resetSecurityProductsForTests();
    const p = createProduct({ name: "경계 방화벽 (FW-A)", category: "방화벽" });
    const saved = saveLifecycle("product", p.id, { vendorContact: "㈜SECUI / 김보안 010-1234-5678", licenseType: "영구", maintenanceEnd: "2027-03-31" }, "정요한");
    expect(saved.vendorContact).toBe("㈜SECUI / 김보안 010-1234-5678");
    expect(saved.updatedBy).toBe("정요한");
    const row = getLifecycle("product", p.id);
    expect(row?.maintenanceEnd).toBe("2027-03-31");
    expect(row?.licenseType).toBe("영구");
  });

  it("saveLifecycle은 patch에 없는 칼럼은 기존 값을 유지한다(부분 갱신)", () => {
    resetSecurityProductsForTests();
    const p = createProduct({ name: "경계 방화벽 (FW-B)", category: "방화벽" });
    saveLifecycle("product", p.id, { vendorContact: "SECUI" });
    saveLifecycle("product", p.id, { maintenanceEnd: "2027-01-01" }); // vendorContact를 안 건드림
    const row = getLifecycle("product", p.id);
    expect(row?.vendorContact).toBe("SECUI");
    expect(row?.maintenanceEnd).toBe("2027-01-01");
  });

  it("saveLifecycle은 빈 문자열을 NULL로 저장한다", () => {
    resetSecurityProductsForTests();
    const p = createProduct({ name: "경계 방화벽 (FW-C)", category: "방화벽" });
    saveLifecycle("product", p.id, { vendorContact: "SECUI" });
    saveLifecycle("product", p.id, { vendorContact: "" });
    const row = getLifecycle("product", p.id);
    expect(row?.vendorContact).toBeNull();
  });

  // ⓑ 경계값 전수
  it("ⓑ 남은일수 경계값 전수 — -1/0/30/31/90/91 → 종료·임박·임박·주의·주의·여유", () => {
    const 기준 = "2026-01-15";
    const 표 : [number, "종료" | "임박" | "주의" | "여유"][] = [
      [-1, "종료"],
      [0, "임박"],
      [30, "임박"],
      [31, "주의"],
      [90, "주의"],
      [91, "여유"],
    ];
    for (const [dday, 기대] of 표) {
      const row: LifecycleRow = { id: "x", targetType: "product", targetId: "x", ...빈행(), maintenanceEnd: 날짜더하기(기준, dday), createdAt: 0, updatedAt: 0 };
      const badge = 생애주기배지(row, 기준);
      expect(badge.상태, `dday=${dday}`).toBe(기대);
      expect(남은일수(row.maintenanceEnd!, 기준)).toBe(dday);
    }
  });

  // ⓒ 후보 중 가장 이른 것이 이긴다
  it("ⓒ 여러 날짜 중 가장 이른 것이 이긴다 — 구독 2027-01-01 · 유지보수 2026-10-13 → 유지보수", () => {
    const 기준 = "2026-01-01";
    const row: LifecycleRow = { id: "x", targetType: "product", targetId: "x", ...빈행(), subEnd: "2027-01-01", maintenanceEnd: "2026-10-13", createdAt: 0, updatedAt: 0 };
    const badge = 생애주기배지(row, 기준);
    expect(badge.종류).toBe("유지보수");
    expect(badge.날짜).toBe("2026-10-13");
  });

  // ⓓ extEnd ?? eol ?? eos 우선순위
  it("ⓓ 유효지원종료 = extEnd ?? eol ?? eos", () => {
    const 기준 = "2026-01-01";
    const 우선연장: LifecycleRow = { id: "x", targetType: "product", targetId: "x", ...빈행(), extEnd: "2028-01-01", eol: "2027-01-01", eos: "2026-06-01", createdAt: 0, updatedAt: 0 };
    expect(생애주기배지(우선연장, 기준).날짜).toBe("2028-01-01"); // extEnd가 있으면 그것

    const eol만: LifecycleRow = { id: "x", targetType: "product", targetId: "x", ...빈행(), eol: "2027-01-01", eos: "2026-06-01", createdAt: 0, updatedAt: 0 };
    const b2 = 생애주기배지(eol만, 기준);
    expect(b2.날짜).toBe("2027-01-01");
    expect(b2.종류).toBe("지원종료");

    const eos만: LifecycleRow = { id: "x", targetType: "product", targetId: "x", ...빈행(), eos: "2026-06-01", createdAt: 0, updatedAt: 0 };
    const b3 = 생애주기배지(eos만, 기준);
    expect(b3.날짜).toBe("2026-06-01");
    expect(b3.종류).toBe("EOS"); // EOL이 없어 EOS로 대체했다는 사실을 종류에 남긴다
    // ⚠ 2026-09-14 검토관 [중] — 용어사전이 「답에 함께 적습니다」라고 약속한 문장이 **주석
    //   한 줄에만** 있었고 어떤 답·배지에도 안 나왔다(없는 동작을 문서가 약속한 부류).
    //   이제 배지가 그 문장을 실어 나르고, 도구 답·툴팁이 그대로 쓴다.
    expect(b3.안내).toBe(EOS대체안내);
    expect(b2.안내).toBeNull(); // EOL이 있으면 대체가 아니니 안내도 없다
  });

  // 등록 대상 전부의 배지 — 화면이 「없음·확인필요·여유·임박」을 가르는 원천(검토관 [상] 수리)
  it("listLifecycleBadges — 여유·확인필요도 빠짐없이 담는다(임박 목록은 이 둘을 버린다)", () => {
    resetSecurityProductsForTests();
    const 오늘 = new Date();
    const 기준 = `${오늘.getFullYear()}-${String(오늘.getMonth() + 1).padStart(2, "0")}-${String(오늘.getDate()).padStart(2, "0")}`;
    const 여유 = createProduct({ name: "여유장비", category: "방화벽" });
    const 확인 = createProduct({ name: "확인장비", category: "방화벽" });
    const 임박 = createProduct({ name: "임박장비", category: "방화벽" });
    saveLifecycle("product", 여유.id, { subEnd: 날짜더하기(기준, 주의일 + 30) }); // 90일 밖 = 여유
    saveLifecycle("product", 확인.id, { subEnd: "곧" });                          // 날짜 못 읽음 = 확인필요
    saveLifecycle("product", 임박.id, { subEnd: 날짜더하기(기준, 5) });            // 임박

    const 임박목록 = listLifecycleDueSoon(주의일).map((i) => i.targetId);
    expect(임박목록).not.toContain(여유.id);   // 임박 목록은 여유를 안 담는다(그래서 화면이 이것만 보면 안 된다)
    expect(임박목록).not.toContain(확인.id);

    const 배지들 = new Map(listLifecycleBadges().map((e) => [e.targetId, e]));
    expect(배지들.get(여유.id)?.상태).toBe("여유");
    expect(배지들.get(확인.id)?.상태).toBe("확인필요");
    expect(배지들.get(임박.id)?.상태).toBe("임박");
    expect(배지들.has("없는-대상-id")).toBe(false); // 등록 안 한 것은 목록에 없다 = 화면이 "없음"으로 그린다
  });

  // ⓔ ⓜ 폴백 — 날짜 칸이 전부 못 읽는 값이면 확인필요이지 종료가 아니다
  it("ⓔ ⓜ 폴백 — 날짜를 못 읽으면 확인필요다(0일·종료로 치지 않는다)", () => {
    const row: LifecycleRow = { id: "x", targetType: "product", targetId: "x", ...빈행(), subEnd: "곧", maintenanceEnd: "다음달", createdAt: 0, updatedAt: 0 };
    const badge = 생애주기배지(row, "2026-01-01");
    expect(badge.상태).toBe("확인필요");
    expect(badge.글).toBe("⚠ 확인 필요");
    expect(badge.상태).not.toBe("종료");
    expect(badge.dday).toBeNull();
  });

  // ⓕ 행 없음
  it("ⓕ 행 자체가 없으면 없음 — 글이 정확히 '등록된 계약이 없습니다'", () => {
    const badge = 생애주기배지(null);
    expect(badge.상태).toBe("없음");
    expect(badge.글).toBe("등록된 계약이 없습니다");
  });

  it("ⓕ' getLifecycle — 등록 안 된 대상은 null", () => {
    resetAssetsForTests();
    expect(getLifecycle("asset", "없는자산id")).toBeNull();
  });

  // ⓖ listLifecycleDueSoon dday 오름차순
  it("ⓖ listLifecycleDueSoon — dday 오름차순(종료가 먼저)", () => {
    resetSecurityProductsForTests();
    resetAssetsForTests();
    const 오늘 = new Date().toISOString().slice(0, 10);
    const p1 = createProduct({ name: "장비A(임박)", category: "방화벽" });
    const p2 = createProduct({ name: "장비B(종료)", category: "EDR" });
    registerAsset({ id: "test-asset-lc-1", name: "자산C(주의)", path: "vuln:test-asset-lc-1" });
    saveLifecycle("product", p1.id, { maintenanceEnd: 날짜더하기(오늘, 10) }); // 임박
    saveLifecycle("product", p2.id, { eol: 날짜더하기(오늘, -5) }); // 종료
    saveLifecycle("asset", "test-asset-lc-1", { subEnd: 날짜더하기(오늘, 60) }); // 주의

    const items = listLifecycleDueSoon(90);
    const 우리것 = items.filter((i) => [p1.id, p2.id, "test-asset-lc-1"].includes(i.targetId));
    expect(우리것.map((i) => i.targetId)).toEqual([p2.id, p1.id, "test-asset-lc-1"]); // dday 오름차순: 종료(-5) < 임박(10) < 주의(60)
    expect(우리것.find((i) => i.targetId === p2.id)!.상태).toBe("종료");
    expect(우리것.find((i) => i.targetId === "test-asset-lc-1")!.이름).toBe("자산C(주의)");
  });

  it("listAllLifecycle — 등록된 계약 전부(확인필요 포함) 건수", () => {
    resetSecurityProductsForTests();
    const p = createProduct({ name: "확인필요장비", category: "방화벽" });
    saveLifecycle("product", p.id, { subEnd: "알수없음" }); // 날짜 아님 — 확인필요
    const 전체 = listAllLifecycle();
    expect(전체.some((r) => r.targetId === p.id)).toBe(true);
    expect(생애주기배지(전체.find((r) => r.targetId === p.id)!).상태).toBe("확인필요");
  });

  // ⓗ 잣대 단일 출처 소스 감시 — 30/90을 다른 파일에 다시 적지 않는다
  it("ⓗ 소스 감시 — 임박 상수(30/90)를 lifecycle.ts 밖에서 다시 적지 않는다", () => {
    const 뿌리 = path.join(__dirname, "..", "..");
    const 대상들 = [
      "client/src/renderer/pages/inventory.html",
      "client/src/renderer/pages/products.html",
      "client/src/renderer/pages/map-view.js",
      "server/src/engine/today.ts",
    ];
    // ⚠ 2026-09-14 검토관 [중] — 이 하나로는 **원리상 못 잡는 꼴**이 있었다.
    //   `window.gijo.lifecycleDueSoon(90)`·`(30)`은 「임박」이 숫자 10자 안에 붙어 있지 않아
    //   그대로 통과했고(거짓 초록), 임박일을 45로 올리면 KPI만 조용히 적게 세는 상태였다.
    //   그래서 **날짜 수를 인자로 넘기는 꼴**을 따로 잰다 — 잣대는 서버 기본값 하나뿐이다.
    const 잣대들 = [/임박[^\n]{0,10}(30|90)/, /lifecycleDueSoon\s*\(\s*\d/];
    // ⚠ `//` 줄주석은 뗀다 — "잣대(30·90일)는 서버(lifecycle.ts) 한 곳" 같은 **설명 주석**까지
    //   걸리면 이 시험이 오히려 "숫자를 언급하지 마라"는 엉뚱한 규칙이 된다(2026-09-14 실측:
    //   L2가 이미 쓴 inventory.html 주석 2곳이 이렇게 걸렸다). 이 시험이 잡아야 할 것은
    //   **코드가 30/90을 다시 계산에 쓰는 것**이지, 사람이 읽는 설명이 아니다.
    const 주석없이 = (본문: string) => 본문.split("\n").map((줄) => 줄.replace(/\/\/.*/, "")).join("\n");
    for (const rel of 대상들) {
      const 경로 = path.join(뿌리, rel);
      if (!fs.existsSync(경로)) continue; // 아직 없는 화면 파일은 통과(그 파일이 생기면 이 시험이 다시 잰다)
      const 본문 = 주석없이(fs.readFileSync(경로, "utf8"));
      for (const 잣대 of 잣대들) {
        expect(잣대.test(본문), `${rel}에 임박 잣대(30/90 또는 lifecycleDueSoon(숫자))를 다시 적었나`).toBe(false);
      }
    }
  });

  // ⓗ-2 「만료」는 **선택 열**이다 — 기본 6열에 넣으면 머리글이 세로로 쪼개진다(2026-07-26 실측).
  // ⚠ 2026-09-14 검토관 [중] — 게시 관문(tools/publish-gate-ui.mjs)이 「기본 6열 여부는
  //   lifecycle.test.ts 소스 감시가 잰다」고 주석에 적어 두고 **아무도 안 쟀다**(약속-코드
  //   불일치). 관문은 localStorage 때문에 기본 열을 실화면에서 못 재므로 여기가 유일한 자리다.
  it("ⓗ-2 소스 감시 — inventory.html DEFAULT_COLS는 6개이고 expiry가 없다", () => {
    const 경로 = path.join(__dirname, "..", "..", "client/src/renderer/pages/inventory.html");
    const 본문 = fs.readFileSync(경로, "utf8");
    const m = 본문.match(/const DEFAULT_COLS\s*=\s*\[([^\]]*)\]/);
    expect(m, "inventory.html에서 DEFAULT_COLS 배열을 못 찾았다(이름이 바뀌었으면 이 감시를 고칠 것)").toBeTruthy();
    const 열들 = (m![1].match(/"([a-zA-Z]+)"/g) || []).map((x) => x.replace(/"/g, ""));
    expect(열들).not.toContain("expiry");
    expect(열들.length).toBe(6);
  });

  // ── 도구 답의 정직성(2026-09-14 검토관 수리) ─────────────────────────────────────
  // ⚠ 「0건」 판정을 **임박 목록**으로 하면, 계약이 50건 있어도 전부 90일 밖일 때
  //   「등록된 계약이 없습니다」가 나갔다. 등록 여부와 임박 여부는 다른 물음이다.
  describe("도구 답 — 「등록 0건」과 「임박 0건」을 뭉치지 않는다", () => {
    function 여유계약하나(): void {
      resetSecurityProductsForTests();
      const 오늘 = new Date();
      const 기준 = `${오늘.getFullYear()}-${String(오늘.getMonth() + 1).padStart(2, "0")}-${String(오늘.getDate()).padStart(2, "0")}`;
      const p2 = createProduct({ name: "여유계약장비", category: "방화벽" });
      saveLifecycle("product", p2.id, { subEnd: 날짜더하기(기준, 주의일 + 60) }); // 90일 밖
    }

    it("lifecycle_status — 90일 밖 계약만 있어도 「등록된 계약이 없습니다」라고 하지 않는다", () => {
      여유계약하나();
      const 답 = findAgentTool("lifecycle_status")!.run({}) as string;
      expect(답).not.toContain("등록된 계약이 없습니다");
      expect(답).toContain("등록된 계약");
    });

    it("maintenance_status — 등록된 계약이 있으면 점검 답 끝에 계약 꼬리를 붙인다", () => {
      여유계약하나();
      const 답 = findAgentTool("maintenance_status")!.run({}) as string;
      // 「유지보수 계약 만료 알려줘」류가 이 도구로 오는데 계약이 한 글자도 없었다(검토관 [중]).
      expect(답, "유지보수 답이 등록된 계약을 한 글자도 안 말한다").toContain("📅 등록된 계약");
    });
  });

  // resolveLifecycleField — set_lifecycle이 실제 지시문에서 뽑을 법한 낱말들
  describe("resolveLifecycleField — 낱말 → 칼럼", () => {
    it("정확 라벨·별칭이 올바른 칼럼으로 간다", () => {
      expect(resolveLifecycleField("유지보수")?.column).toBe("maintenanceEnd");
      expect(resolveLifecycleField("EOL")?.column).toBe("eol");
      expect(resolveLifecycleField("구독 종료일")?.column).toBe("subEnd");
      expect(resolveLifecycleField("계약 만료일")?.column).toBe("eol");
      expect(resolveLifecycleField("협력사")?.column).toBe("vendorContact");
      expect(resolveLifecycleField("비고")?.column).toBe("note");
      expect(resolveLifecycleField("알수없는아무말")).toBeNull();
    });
  });

  // ⓘ 결재판 — ⓛ 필수칸 계약(값은 지시문에 글자 그대로 있어야 한다)
  describe("ⓘ 결재판 — set_lifecycle", () => {
    it("모든 값이 지시문에 그대로 있으면 missing=[]·source=said", () => {
      const tool = findAgentTool("set_lifecycle")!;
      const approval = buildApproval(tool, { target: "FW-01", field: "유지보수", value: "2027-03-31" }, "FW-01 유지보수 2027-03-31까지 등록해줘");
      expect(approval.missing).toEqual([]);
      for (const f of approval.fields) expect(f.source, `${f.key} source`).toBe("said");
    });

    it("날짜 꼴이 아니면 missing에 value가 실리고 effect에 사유가 실린다", () => {
      const tool = findAgentTool("set_lifecycle")!;
      // ⚠ 지시문에도 같은 글자("2027년 3월")를 그대로 넣는다 — 안 그러면 said가 아니라 guess로
      //   먼저 비워지는 다른 경로(필수값 지어냄 방지)를 재게 되어, 이 시험이 보려는 "값이
      //   규칙에 안 맞는다"는 validate()의 판단을 실제로 통과시키지 못한다.
      const approval = buildApproval(tool, { target: "FW-01", field: "유지보수", value: "2027년 3월" }, "FW-01 유지보수 2027년 3월까지 등록해줘");
      expect(approval.missing).toContain("value");
      expect(approval.effect).toContain("YYYY-MM-DD");
    });

    it("항목 이름을 못 알아보면 missing에 field가 실린다", () => {
      const tool = findAgentTool("set_lifecycle")!;
      const approval = buildApproval(tool, { target: "FW-01", field: "아무말", value: "2027-03-31" }, "FW-01 아무말 2027-03-31까지 등록해줘");
      expect(approval.missing).toContain("field");
      expect(approval.effect).toContain("항목 이름을 못 알아봤습니다");
    });
  });
});

// ── REST 창구(계약 표 ③) — 2026-09-14 검토관 [하] 수리를 못박는다 ──────────────────────────
describe("POST /api/lifecycle/:targetType/:targetId", () => {
  it("없는 대상이면 404다 — 오타·삭제된 id로 고아 행을 만들지 않는다", async () => {
    const app = createApp();
    const { accessToken } = await 로그인(app);
    const res = await request(app)
      .post("/api/lifecycle/product/없는-제품-id")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fields: [{ key: "eol", value: "2027-01-01" }] });
    // ⚠ 안 막으면 그 행이 listLifecycleDueSoon에서 `이름 ?? targetId`로 살아남아
    //   오늘의 할 일·KPI·도구 답에 **내부 id가 그대로** 나온다(형제 창구는 이미 404로 막는다).
    expect(res.status).toBe(404);
    expect(getLifecycle("product", "없는-제품-id")).toBeNull();
  });

  it("저장하면 감사 로그의 target이 **사람이 읽는 이름**이다(내부 id가 아니다)", async () => {
    resetSecurityProductsForTests();
    resetAuditForTests();
    const p = createProduct({ name: "감사이름장비", category: "방화벽" });
    const app = createApp();
    const { accessToken } = await 로그인(app);
    const res = await request(app)
      .post(`/api/lifecycle/product/${p.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fields: [{ key: "eol", value: "2027-01-01" }] });
    expect(res.status).toBe(200);
    const 줄 = listAudit().find((a) => a.action === "계약·생애주기 저장");
    expect(줄?.target, "작업 기록은 사람이 읽는 화면이다 — id로 남기면 무엇을 고쳤는지 추적이 안 된다").toBe("감사이름장비");
    expect(줄?.target).not.toContain(p.id);
  });
});

describe("GET /api/lifecycle/due", () => {
  it("`등록`에는 **여유·확인필요까지** 담긴다 — 화면이 「없다」고 거짓말하지 않게", async () => {
    resetSecurityProductsForTests();
    const 오늘 = new Date();
    const 기준 = `${오늘.getFullYear()}-${String(오늘.getMonth() + 1).padStart(2, "0")}-${String(오늘.getDate()).padStart(2, "0")}`;
    const 여유 = createProduct({ name: "REST여유장비", category: "방화벽" });
    saveLifecycle("product", 여유.id, { subEnd: 날짜더하기(기준, 주의일 + 40) });
    const app = createApp();
    const { accessToken } = await 로그인(app);
    const res = await request(app).get("/api/lifecycle/due").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const 등록 = res.body.등록 as { targetId: string; 상태: string }[];
    expect(등록.find((e) => e.targetId === 여유.id)?.상태).toBe("여유");
    // 임박 목록(items)에는 안 담긴다 — 그래서 화면이 items만 보면 안 된다(검토관 [상]).
    expect((res.body.items as { targetId: string }[]).some((i) => i.targetId === 여유.id)).toBe(false);
  });
});

