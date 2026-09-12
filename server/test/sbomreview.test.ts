// 공급망 점검 — 검수·이력·조회 (계획서 중-7 확장).
//
// ★ 이 시험이 지키는 것: **남이 준 파일**을 다루는 자리라 「조용히 넘기지 않는다」가 핵심이다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { sbom검수, 검수목록, 검수상세, 검수삭제, 검수요약문 } from "../src/engine/sbomreview.js";
import { 표식, 말투위반 } from "../src/engine/tone";

function 비우기() {
  db.prepare("DELETE FROM sbom_review_components").run();
  db.prepare("DELETE FROM sbom_reviews").run();
}

function 부품표(부품: Array<{ name: string; license?: string; version?: string }>, 대상?: string) {
  return JSON.stringify({
    bomFormat: "CycloneDX", specVersion: "1.6",
    metadata: 대상 ? { component: { name: 대상 } } : undefined,
    components: 부품.map((c) => ({
      name: c.name, version: c.version ?? "1.0",
      licenses: c.license ? [{ license: { id: c.license } }] : undefined,
    })),
  });
}

describe("검수 — 우리가 걸린 그 건이 목록에서 드러난다", () => {
  beforeEach(비우기);

  it("★ AGPL 부품 하나가 300개 사이에 있어도 요약에 뜬다", () => {
    const 많이 = Array.from({ length: 300 }, (_, i) => ({ name: `p${i}`, license: "MIT" }));
    많이.splice(150, 0, { name: "PyMuPDF", license: "AGPL-3.0-only" });
    const r = sbom검수({ 파일이름: "협력사.json", 내용: 부품표(많이, "협력사 납품물") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.결과.name, "문서가 말하는 대상을 이름으로 쓴다").toBe("협력사 납품물");
    expect(r.결과.componentCount).toBe(301);
    expect(r.결과.summary.서비스도공개).toBe(1);
    expect(r.결과.summary.고지만).toBe(300);
  });

  it("이름이 없으면 파일 이름을 쓴다 — 목록에서 알아볼 수 있어야 한다", () => {
    const r = sbom검수({ 파일이름: "이름없는-부품표.json", 내용: 부품표([{ name: "a", license: "MIT" }]) });
    expect(r.ok && r.결과.name).toBe("이름없는-부품표.json");
  });

  it("★ 면책이 **모든 출구**에 붙는다", () => {
    const r = sbom검수({ 파일이름: "x.json", 내용: 부품표([{ name: "a", license: "MIT" }]) });
    expect(r.ok && r.면책).toContain("법률 자문이 아닙니다");
    const id = r.ok ? r.결과.id : "";
    expect(검수상세(id)?.면책).toContain("법률 자문이 아닙니다");
    expect(검수요약문()).toContain("법률 자문이 아닙니다");
  });

  // B9(2026-09-12 야간 회귀) — 「소스 공개를 요구받는 부품 없음」 줄이 사전 밖 ✅를 새로 박아
  // tone-realanswers.test.ts를 빨갛게 만들었다. 무거운 라이선스가 0건인(=이 분기) 상태로
  // 재현해 사전 상수(표식.좋음 ✓)로 나가는지 잰다.
  it("★ B9 — 무거운 라이선스가 0건이면 사전 상수(표식.좋음)로 말한다(글자 ✅를 새로 안 박는다)", () => {
    const r = sbom검수({ 파일이름: "가벼운것.json", 내용: 부품표([{ name: "a", license: "MIT" }]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const 요약 = 검수요약문(r.결과.id);
    expect(요약, "무거운 부품이 없다는 줄이 안 보인다").toContain("소스 공개를 요구받는 부품은 없습니다");
    expect(요약).toContain(`${표식.좋음} 소스 공개를 요구받는 부품은 없습니다`);
    const 기호위반 = 말투위반(요약).filter((x) => x.이름.startsWith("뜻이 겹치는 기호"));
    expect(기호위반, `겹치는기호가 다시 샜다: ${기호위반.map((x) => x.이름).join(", ")}`).toEqual([]);
  });
});

describe("못 읽으면 못 읽었다고 — 「실패」 한 마디로 끝내지 않는다", () => {
  beforeEach(비우기);

  it("JSON이 아니면 이유와 함께 거절하고 **아무것도 저장하지 않는다**", () => {
    const r = sbom검수({ 파일이름: "깨진.json", 내용: "{이건 JSON이 아니다" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.사유).toContain("읽지 못했습니다");
    expect(r.알림.join(" ")).toContain("JSON");
    expect(검수목록().length, "실패한 것이 대장에 남으면 안 된다").toBe(0);
  });

  it("부품이 0개면 거절한다 — 「검수 완료 0건」으로 남기지 않는다", () => {
    const r = sbom검수({ 파일이름: "빈.json", 내용: 부품표([]) });
    expect(r.ok).toBe(false);
    expect(검수목록().length).toBe(0);
  });

  // 2026-09-01: 겉만 세던 것을 편다. **안쪽에 든 GPL도 소스 공개 의무를 지운다** —
  // 한 겹 안에 있다고 의무가 사라지지 않는다. 겉만 세면 검수 결과가 실제보다 안전해 보인다.
  it("★★ 안쪽 부품까지 검수에 들어간다 — 한 겹 안의 GPL이 숨지 않는다", () => {
    const 내용 = JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{
        name: "겉", licenses: [{ license: { id: "MIT" } }],
        components: [{ name: "속", licenses: [{ license: { id: "GPL-3.0-only" } }] }],
      }],
    });
    const r = sbom검수({ 파일이름: "중첩.json", 내용 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.결과.componentCount, "안쪽을 안 셌다").toBe(2);
    expect(r.결과.notes.join(" "), "숫자가 왜 겉보다 많은지 안 밝힌다").toContain("펴서 셌습니다");
  });
});

describe("저장 — 근거를 잃지 않는다", () => {
  beforeEach(비우기);

  it("★ 라이선스 원문을 **자르지 않고** 저장한다", () => {
    // 실측 571자짜리가 있었다. 자르면 뒤에 붙은 AGPL이 날아가 판정이 조용히 뒤집힌다.
    const 긴것 = "LGPL-2.1-or-later AND SunPro AND BSD-3-Clause AND MIT AND ISC AND Zlib AND AGPL-3.0-only";
    const 내용 = JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{ name: "glibc", version: "2.34", licenses: [{ expression: 긴것 }] }],
    });
    const r = sbom검수({ 파일이름: "긴것.json", 내용 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = 검수상세(r.결과.id);
    expect(d?.부품[0].license, "원문 그대로여야 한다").toBe(긴것);
    expect(d?.부품[0].tier, "뒤의 AGPL을 놓치지 않는다").toBe("서비스도공개");
  });

  it("★ 「받게 되는 요구」는 저장 안 하고 조회 때 만든다 — 규칙이 바뀌면 저장본이 낡는다", () => {
    const r = sbom검수({ 파일이름: "x.json", 내용: 부품표([{ name: "a", license: "AGPL-3.0-only" }]) });
    if (!r.ok) return;
    const 열 = db.prepare("PRAGMA table_info(sbom_review_components)").all() as Array<{ name: string }>;
    const 이름들 = 열.map((c) => c.name);
    expect(이름들, "요구 문장을 표에 굳히지 않는다").not.toContain("received");
    expect(검수상세(r.결과.id)?.부품[0].받게되는요구).toContain("네트워크로 서비스만 해도");
  });

  it("어느 자리에서 읽었는지 남는다 — 근거를 화면이 보여 줄 수 있어야 한다", () => {
    const 내용 = JSON.stringify({
      spdxVersion: "SPDX-2.3",
      packages: [{ name: "p", licenseDeclared: "MIT", licenseConcluded: "GPL-3.0-only" }],
    });
    const r = sbom검수({ 파일이름: "s.json", 내용 });
    if (!r.ok) return;
    const c = 검수상세(r.결과.id)?.부품[0];
    expect(c?.licenseFrom).toEqual(expect.arrayContaining(["licenseConcluded", "licenseDeclared"]));
  });
});

describe("이력 — 지우면 부품도 함께 지워진다", () => {
  beforeEach(비우기);

  it("삭제하면 자식 행도 남지 않는다(ON DELETE CASCADE)", () => {
    const r = sbom검수({ 파일이름: "x.json", 내용: 부품표([{ name: "a", license: "MIT" }, { name: "b", license: "MIT" }]) });
    if (!r.ok) return;
    const 전 = (db.prepare("SELECT COUNT(*) n FROM sbom_review_components").get() as { n: number }).n;
    expect(전).toBe(2);
    expect(검수삭제(r.결과.id)).toBe(true);
    const 후 = (db.prepare("SELECT COUNT(*) n FROM sbom_review_components").get() as { n: number }).n;
    expect(후, "부모만 지우고 자식이 남으면 유령 행이 쌓인다").toBe(0);
  });

  it("없는 것을 지우면 false — 지운 척하지 않는다", () => {
    expect(검수삭제("없는id")).toBe(false);
  });
});

describe("대화 답 — 숫자만 주고 끝내지 않는다", () => {
  beforeEach(비우기);

  it("한 건도 없으면 **넣는 법**을 알려 준다", () => {
    const s = 검수요약문();
    expect(s).toContain("없습니다");
    expect(s, "다음에 뭘 할지 말해야 한다").toContain("＋");
  });

  it("★ 「모른다」를 「없음」과 섞지 않는다", () => {
    sbom검수({ 파일이름: "x.json", 내용: 부품표([{ name: "a" }, { name: "b", license: "MIT" }]) });
    // 알아본 조건부(NC)는 「알 수 없는 부품」에 안 섞인다 — 별도 줄로 말한다(2026-09-03 검토관: 요약 줄의 거짓 셈)
    const 조건 = 부품표([{ name: "nc", license: "CC-BY-NC-4.0" }, { name: "u" }]);
    sbom검수({ 파일이름: "nc.json", 내용: 조건 });
    // 같은 초에 검수한 두 건은 목록 순서가 갈릴 수 있어 id로 집는다
    const ncId = 검수목록(5).find((x) => x.name === "nc.json")?.id;
    const t = 검수요약문(ncId);
    expect(t).toContain("알 수 없는 부품 1개");
    expect(t).toContain("조건 때문에 등급을 매기지 않은 부품 1개");
    db.prepare("DELETE FROM sbom_reviews WHERE name='nc.json'").run();
    db.prepare("DELETE FROM sbom_review_components WHERE reviewId NOT IN (SELECT id FROM sbom_reviews)").run();
    const s = 검수요약문();
    expect(s).toContain("알 수 없는 부품 1개");
    expect(s, "모른다는 것이 없음이 아니라고 말한다").toContain("「없음」이 아닙니다");
  });

  it("무거운 것이 없으면 **없다고 분명히** 말한다 — 0건을 얼버무리지 않는다", () => {
    sbom검수({ 파일이름: "x.json", 내용: 부품표([{ name: "a", license: "MIT" }]) });
    expect(검수요약문()).toContain("소스 공개를 요구받는 부품은 없습니다");
  });
});

describe("★ 부하 — 부품이 많아도 감당한다", () => {
  beforeEach(비우기);

  it("5,000개를 한 번에 담는다(트랜잭션)", () => {
    const 많이 = Array.from({ length: 5000 }, (_, i) => ({ name: `p${i}`, license: i % 500 === 0 ? "GPL-3.0-only" : "MIT" }));
    const t0 = Date.now();
    const r = sbom검수({ 파일이름: "대형.json", 내용: 부품표(많이) });
    const 걸린 = Date.now() - t0;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.결과.componentCount).toBe(5000);
    expect(r.결과.summary.전체소스공개).toBe(10);
    // 낱개 INSERT였으면 수 초가 걸린다 — 트랜잭션이 살아 있는지 값으로 지킨다.
    expect(걸린, `5,000개에 ${걸린}ms — 트랜잭션이 빠졌는지 확인할 것`).toBeLessThan(5000);
  });
});
