// productcompare.test.ts — 제품 비교(2026-08-28, 승인 설계 2026-08-23 「DB 한 벌 + 트리플 파생」).
//
// ★ 이 시험이 지키는 계약 넷:
//   ① 트리플의 주어는 **제품 이름**이다(id 아님) — expandOntology는 질문 글자에 주어가
//     있어야 걸린다. pi-… id를 주어로 넣으면 어떤 질문에도 안 걸린다(설계 검토가 잡은 부류).
//   ② 파생은 멱등 — 같은 항목을 두 번 기록해도 트리플은 한 벌이다(두 곳에 적으면 어긋난다).
//   ③ 삭제는 파생물까지 — 필드·트리플이 남으면 지운 제품이 답변에 유령으로 나온다.
//   ④ 비교는 정직 — 담당자가 확정 안 한 항목은 「―」다. 소개자료에서 지어 채우지 않는다.
//     (이 도구가 생기기 전 mydocs 📦 「비교해줘」 안내는 받는 도구가 없는 거짓 약속이었다.)
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { readFileSync } from "fs";
import { join } from "path";
import {
  addProductIntro, removeProductIntro, listProductIntros,
  setIntroField, listIntroFields, INTRO_FIELD_SCHEMA,
} from "../src/engine/productintro";
import { listTriples } from "../src/engine/ontology";
import { runProductCompare, runSetIntroField } from "../src/engine/agenttools/handlers";

beforeEach(() => {
  db.exec("DELETE FROM product_intro");
  db.exec("DELETE FROM product_intro_field");
  db.exec("DELETE FROM ontology_triples");
});

describe("제품 소개 항목 → 온톨로지 파생 (DB 한 벌 원칙)", () => {
  it("★① 트리플 주어는 제품 **이름**이다 — id를 주어로 넣으면 질문에 안 걸린다", () => {
    const it_ = addProductIntro({ name: "SafeBreach", category: "BAS", vendor: "SafeBreach Inc" });
    setIntroField(it_.id, "deployType", "온프레미스(SaaS 지원)");
    const ts = listTriples();
    expect(ts.some((t) => t.subject === "SafeBreach" && t.predicate === "도입 형태")).toBe(true);
    expect(ts.some((t) => t.subject === "SafeBreach" && t.predicate === "제품분류" && t.object === "BAS")).toBe(true);
    expect(ts.some((t) => t.subject === "SafeBreach" && t.predicate === "공급사")).toBe(true);
    // id가 주어로 새지 않는다
    expect(ts.some((t) => t.subject.startsWith("pi-")), "pi-… id가 주어다 — 어떤 질문에도 안 걸린다").toBe(false);
  });

  it("★② 멱등 — 같은 항목을 두 번(값 바꿔) 기록해도 트리플은 한 벌", () => {
    const it_ = addProductIntro({ name: "Cymulate", category: "BAS" });
    setIntroField(it_.id, "deployType", "SaaS");
    setIntroField(it_.id, "deployType", "SaaS(온프렘 옵션)");
    const 도입 = listTriples().filter((t) => t.subject === "Cymulate" && t.predicate === "도입 형태");
    expect(도입.length, "두 벌 생겼다 — 재생성이 갈아끼우기가 아니다").toBe(1);
    expect(도입[0].object).toBe("SaaS(온프렘 옵션)");
  });

  it("★③ 삭제는 파생물까지 — 필드·트리플이 유령으로 남지 않는다", () => {
    const it_ = addProductIntro({ name: "Picus", category: "BAS" });
    setIntroField(it_.id, "license", "연 구독");
    expect(listTriples().some((t) => t.subject === "Picus")).toBe(true);
    removeProductIntro(it_.id);
    expect(listProductIntros().length).toBe(0);
    expect(listIntroFields(it_.id).length, "필드가 유령으로 남았다").toBe(0);
    expect(listTriples().some((t) => t.subject === "Picus"), "트리플이 유령으로 남았다").toBe(false);
  });

  it("빈 값 기록 = 항목 삭제 — 트리플도 함께 빠진다", () => {
    const it_ = addProductIntro({ name: "AttackIQ", category: "BAS" });
    setIntroField(it_.id, "integration", "SIEM 연동");
    setIntroField(it_.id, "integration", "");
    expect(listIntroFields(it_.id).length).toBe(0);
    expect(listTriples().some((t) => t.subject === "AttackIQ" && t.predicate === "연동")).toBe(false);
  });

  it("모르는 항목 키는 거부 — 자유 키가 쌓이면 비교표가 못 그린다", () => {
    const it_ = addProductIntro({ name: "X", category: "기타" });
    expect(() => setIntroField(it_.id, "price", "1억")).toThrow(/모르는 항목/);
  });
});

describe("product_compare 도구 (거짓 약속의 받는 곳)", () => {
  it("등록 0건이면 정직하게 안내한다 — 지어내지 않는다", () => {
    expect(runProductCompare({ a: "A", b: "B" })).toContain("등록된 제품 소개자료가 없습니다");
  });

  it("★④ 비교표 — 확정 값만 나오고 빈 항목은 「―」 + 채우는 법 안내", () => {
    const a = addProductIntro({ name: "SafeBreach", category: "BAS", vendor: "SafeBreach Inc" });
    addProductIntro({ name: "Cymulate", category: "BAS" });
    setIntroField(a.id, "deployType", "온프레미스", { quote: "SaaS 기반(On-Prem 지원 가능)" });
    const out = runProductCompare({ a: "safebreach", b: "Cymulate" }); // 대소문자 무시
    expect(out).toContain("SafeBreach vs Cymulate");
    expect(out).toContain("온프레미스");
    expect(out).toContain("―"); // 미확정 칸
    expect(out).toContain("확정하지 않은 항목"); // 정직 각주
    expect(out).toContain("SaaS 기반(On-Prem 지원 가능)"); // 근거 인용 원문 그대로
    // 표에 스키마 전 항목이 행으로 있다 — 화면·도구가 항목 이름을 두 곳에 안 적는다
    for (const s of INTRO_FIELD_SCHEMA) expect(out).toContain(s.label);
  });

  it("★ 한 제품만 지목되면 그 제품 카드를 준다 — 잘못 골라도 쓸모 있게(2026-08-29 라이브 수리)", () => {
    // 모델이 「SafeBreach 도입 형태가 뭐야?」에 이 도구를 골라 b가 비는 일이 실제로 있었다.
    // 그전에는 「비교 대상이 누락됐다」는 엉뚱한 답이 나갔다 — 아무것도 못 주는 것이 가장 나쁘다.
    const a = addProductIntro({ name: "SafeBreach", category: "BAS" });
    addProductIntro({ name: "Cymulate", category: "BAS" });
    setIntroField(a.id, "deployType", "온프레미스");
    const out = runProductCompare({ a: "SafeBreach", b: "" });
    expect(out, "한 제품 카드를 안 준다").toContain("SafeBreach");
    expect(out, "확정 값을 안 보인다").toContain("온프레미스");
    expect(out, "미확정 항목을 「―」로 안 보인다").toContain("―");
    expect(out, "비교하는 법을 안 알려 준다 — 막다른 답").toMatch(/비교하려면/);
    expect(out, "상대 후보를 제시하지 않는다").toContain("Cymulate");
  });

  it("못 찾으면 등록 목록을 보여 준다 — 막다른 답 금지", () => {
    addProductIntro({ name: "SafeBreach", category: "BAS" });
    const out = runProductCompare({ a: "SafeBreach", b: "없는제품" });
    expect(out).toContain("대장에 없습니다"); // 「찾지 못했」는 실패 문구와 겹쳐 금지(emptyanswer 감시)
    expect(out).toContain("SafeBreach"); // 등록된 이름 제시
  });

  it("set_intro_field 도구 — 한글 항목명으로도 기록되고 비교에 반영된다", () => {
    addProductIntro({ name: "SafeBreach", category: "BAS" });
    addProductIntro({ name: "Cymulate", category: "BAS" });
    const r = runSetIntroField({ name: "Cymulate", key: "도입 형태", value: "SaaS" });
    expect(r).toContain("기록했습니다");
    expect(runProductCompare({ a: "SafeBreach", b: "Cymulate" })).toContain("SaaS");
  });
});

describe("배선 계약 — 안내가 가리키는 도구가 실재한다", () => {
  it("★ mydocs 📦 「비교해줘」 안내의 받는 도구(product_compare)가 등록부에 있다", () => {
    const reg = readFileSync(join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf-8");
    expect(reg, "product_compare가 등록부에 없다 — 안내가 다시 거짓 약속이 된다").toContain('name: "product_compare"');
    expect(reg, "set_intro_field(빈칸 채우는 짝)가 없다").toContain('name: "set_intro_field"');
  });
});
