// docs-drift의 **두 잣대 대조**(반입 대장 ↔ 지식 저장소) 짝 시험. (계획서 전-4 · 2026-09-07)
//
// ■ 무엇이 문제였나 (실측)
//   `node tools/docs-drift.mjs`는 「지식저장소 3,920건 인입」이라 하고, 운영 `memory_documents`에는
//   **3,921줄**이 있었다. 둘이 다른 것은 결함이 아니라 **세는 대상이 다른 것**이다:
//     · memory_documents = 반입 **대장**(문서 한 편당 한 줄 · 조각 수는 그때 적어 둔 값)
//     · docs-drift의 「N건 인입됨」 = **LanceDB에 실제 조각이 남아 있는** 문서 수
//   2026-09-07 운영 실측으로 차이 1건의 정체를 찾았다 — `2025년 사이버 위협 전망.pdf`(대장 21조각,
//   저장소 0조각). 대장에 줄만 남고 벡터가 없어 **AI가 근거로 못 쓰는** 문서다.
//   그 사실이 어디에도 안 적혀 있어 사람이 매번 손으로 찾아야 했다 — 이제 도구가 이름을 댄다.
// ■ 이 시험이 재는 것 / 안 재는 것
//   재는 것: 대조·분류 **순수 함수**의 논리(유령·대장밖·매니페스트 밖 갈래).
//   안 재는 것: WSL 조회 자체(운영 DB가 있어야 한다). 그 갈래는 도구가 「건너뛰었다」고 말하는지를
//              소스 감시로만 본다 — 0건으로 적어 거짓을 만들지 않는 것이 요점이다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — tools/는 순수 .mjs다(타입 선언을 두지 않는다).
import { 잣대대조, 매니페스트밖 } from "../../tools/docs-drift.mjs";

const 소스 = fs.readFileSync(path.join(__dirname, "../../tools/docs-drift.mjs"), "utf8");

const 대장 = [
  { documentId: "취약점관리_지침.md", origin: null, chunks: 12 },
  { documentId: "ISMS-P.md", origin: "builtin", chunks: 40 },
  { documentId: "문답-2026-09-01.md", origin: "approved-qa", chunks: 1 },
  { documentId: "사고-0912.md", origin: "incident-case", chunks: 2 },
  // ★ 유령 — 대장에는 21조각이라 적혀 있는데 저장소에는 한 조각도 없다(운영 실측의 그 문서).
  { documentId: "2025년 사이버 위협 전망.pdf", origin: null, chunks: 21 },
];
const 저장조각: Record<string, number> = {
  "취약점관리_지침.md": 12, "ISMS-P.md": 40, "문답-2026-09-01.md": 1, "사고-0912.md": 2,
  "손으로넣은벡터.md": 3, // 저장소에는 있는데 대장에 줄이 없다
};
const 문서들 = ["취약점관리_지침.md", "knowledge/ISMS-P.md"]; // 목록에는 하위 폴더가 붙어 온다

describe("docs-drift — 두 잣대가 다른 이유를 도구가 말한다 (전-4)", () => {
  it("★ 유령(대장에는 있는데 저장소에 조각이 없는 문서)을 **이름으로** 짚는다", () => {
    const r = 잣대대조(대장, 저장조각);
    expect(r.대장수).toBe(5);
    expect(r.저장수).toBe(5); // 대장 5 · 저장소 5인데 **겹치는 것은 4**다 — 셈만 보면 안 드러난다

    expect(r.유령).toEqual([{ 이름: "2025년 사이버 위협 전망.pdf", 조각: 21 }]);
  });

  it("★ 반대 방향도 본다 — 저장소에는 있는데 대장에 줄이 없는 문서", () => {
    expect(잣대대조(대장, 저장조각).대장밖).toEqual(["손으로넣은벡터.md"]);
  });

  it("차이가 없으면 유령도 대장밖도 0건이다 — 헛경보를 만들지 않는다", () => {
    const 딱맞음 = [{ documentId: "가.md", chunks: 1 }, { documentId: "나.md", chunks: 2 }];
    const r = 잣대대조(딱맞음, { "가.md": 1, "나.md": 2 });
    expect(r.유령).toEqual([]);
    expect(r.대장밖).toEqual([]);
    expect(r.대장수).toBe(r.저장수);
  });

  it("★ 매니페스트 밖 — built-in은 이름을 다 적고 대량 갈래는 건수로 말한다", () => {
    const 밖 = 매니페스트밖(저장조각, 문서들, 대장);
    // 목록은 하위 폴더가 붙어 있어도 **이름만**으로 맞춘다(저장소 id가 basename이라).
    expect(밖.총).toBe(3); // 문답 · 사고 · 손으로넣은벡터
    expect(밖.builtin, "ISMS-P.md는 목록 안이라 밖에 오면 안 된다").toEqual([]);
    expect(밖.갈래별).toEqual({ "approved-qa": 1, "incident-case": 1, "(대장에 없음)": 1 });
  });

  it("built-in인데 목록에 없는 문서는 **이름이 나온다**(제품 동봉 지식의 사각지대)", () => {
    const 밖 = 매니페스트밖({ "ISMS-P.md": 40, "제로트러스트.md": 9 }, ["취약점관리_지침.md"],
      [{ documentId: "ISMS-P.md", origin: "builtin", chunks: 40 }, { documentId: "제로트러스트.md", origin: "builtin", chunks: 9 }]);
    expect(밖.builtin).toEqual(["ISMS-P.md", "제로트러스트.md"]);
    expect(밖.갈래별).toEqual({});
  });

  it("대장을 못 읽었을 때도 셈은 낸다 — 출처만 못 가릴 뿐", () => {
    const 밖 = 매니페스트밖(저장조각, 문서들, null);
    expect(밖.총).toBe(3);
    expect(밖.builtin).toEqual([]);
    expect(밖.갈래별).toEqual({ "(대장에 없음)": 3 });
  });

  it("★ 대장을 못 읽으면 **건너뛰었다고 말한다**(0건으로 적지 않는다 · 소스 감시)", () => {
    // 2026-09-04 사고의 재발 방지: 조회 실패를 빈 값으로 삼켜 「0건 인입」이라 보고했던 자리다.
    expect(소스, "대장 조회가 실패해도 0건인 척한다").toContain("건너뛰었습니다");
    expect(소스, "대장 조회는 읽기 전용이어야 한다").toContain("{readonly:true}");
    expect(소스, "sqlite3 CLI는 운영 WSL에 없다 — node+better-sqlite3로 읽는다").toContain("better-sqlite3");
    expect(/sqlite3\s+["'/]/.test(소스), "sqlite3 CLI를 부른다 — 운영 WSL에는 그 명령이 없다").toBe(false);
  });

  it("도구는 **지우지 않는다**고 스스로 밝힌다", () => {
    expect(소스).toMatch(/지우지 않았습니다|아무것도 지우지 않는다/);
  });
});
