// uploadtypes.test.ts — 업로드 유형: 서버가 받는 것 ↔ 클라 결재판 버튼 **대조 감시**.
//
// ★ 왜 (2026-08-27 실사고): 서버는 8월 23일부터 productintro를 받고 guess까지 보냈는데,
//   클라 결재판(UPLOAD_TYPES)에 버튼이 없어 **나흘간 아무도 고를 수 없었다** —
//   SafeBreach pptx를 소개자료로 분류하려던 사장님이 「📄 일반 문서」로 갈 수밖에 없던
//   그 사건의 반쪽이 그대로 남아 있던 것이다. 서버 200·시험 초록·화면 멀쩡 — 셋 다
//   초록인데 사람은 못 쓰는 부류라, 두 목록을 기계로 묶는다(「그 값을 누가 넣는가」 계보).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRV = join(__dirname, "..", "src", "engine", "autoupload.ts");
const CON = join(__dirname, "..", "..", "client", "src", "renderer", "pages", "console.js");

function 서버유형(): string[] {
  const s = readFileSync(SRV, "utf-8");
  const m = s.match(/const ALLOWED: UploadType\[\] = \[([^\]]+)\]/);
  expect(m, "autoupload.ts에서 ALLOWED 목록을 못 찾았다 — 이 시험이 헛돈다").toBeTruthy();
  return [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
}
function 클라유형(): string[] {
  const s = readFileSync(CON, "utf-8");
  const i = s.indexOf("var UPLOAD_TYPES = [");
  expect(i, "console.js에서 UPLOAD_TYPES를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(-1);
  const 블록 = s.slice(i, s.indexOf("];", i));
  return [...블록.matchAll(/\{ t: "([a-z]+)"/g)].map((x) => x[1]);
}

describe("업로드 유형 대조 — 서버 ALLOWED ↔ 클라 결재판 버튼", () => {
  it("★ 서버가 받는 유형은 전부 결재판에 버튼이 있다 — 없으면 사람이 못 고른다", () => {
    const 서버 = 서버유형();
    const 클라 = new Set(클라유형());
    const 없는버튼 = 서버.filter((t) => !클라.has(t));
    expect(없는버튼, "서버는 받는데 결재판에 버튼이 없다 — productintro 나흘 공백의 재발").toEqual([]);
  });
  it("클라 버튼은 전부 서버가 받는 유형이다 — 누르면 서버가 무시하는 유령 버튼 방지", () => {
    const 서버 = new Set(서버유형());
    const 유령 = 클라유형().filter((t) => !서버.has(t));
    expect(유령, "버튼은 있는데 서버 ALLOWED에 없다 — 눌러도 자동 판별로 조용히 회귀한다").toEqual([]);
  });
  it("제품명을 묻는 유형(PRODUCT_NAME_TYPES)은 서버 유형의 부분집합이다", () => {
    const s = readFileSync(CON, "utf-8");
    const m = s.match(/var PRODUCT_NAME_TYPES = \{([^}]+)\}/);
    expect(m, "PRODUCT_NAME_TYPES를 못 찾았다").toBeTruthy();
    const keys = [...m![1].matchAll(/([a-z]+):/g)].map((x) => x[1]);
    const 서버 = new Set(서버유형());
    expect(keys.filter((k) => !서버.has(k)), "제품명을 묻는데 서버가 모르는 유형").toEqual([]);
    // 소개자료는 제품명이 핵심이다(어느 제품의 소개인가) — 빠지면 이름 없는 등록이 쌓인다.
    expect(keys, "productintro가 제품명을 안 묻는다").toContain("productintro");
  });
  it("결재판 결과 문구 갈래가 서버 라우팅 갈래를 빠짐없이 안다 — 「상세 정보 없음」 방지", () => {
    // 서버 routedTo 중 결재판 카드가 문구를 아는 것: vulnscan·product-manual·analysis·sbom·
    // productintro(+memory 공통 갈래). 새 라우팅을 더하면 여기서 걸리게 한다.
    const s = readFileSync(CON, "utf-8");
    for (const 갈래 of ["vulnscan", "product-manual", "analysis", "sbom", "productintro"]) {
      expect(s, `uploadResultMsg에 ${갈래} 갈래가 없다 — 등록되고도 「상세 정보 없음」으로 보인다`)
        .toContain(`r.routedTo === "${갈래}"`);
    }
  });
});
