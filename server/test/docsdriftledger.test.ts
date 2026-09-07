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

// ─────────────────────────────────────────────────────────────────────────────
// ★★ **반쪽 유령** — 이름은 양쪽에 있는데 판이 다르다 (2026-09-07 실측)
//
// 옛 판은 이름 집합 둘만 견줬다. 그래서 「대장에 이름이 있고 저장소에도 이름이 있다」면 초록인데,
// 운영 실측에서 **조각 수가 다른 문서 셋**이 나왔다:
//   · CrowdStrike…(101/99) · Tenable IE…(4/2) · model-intake-policy…(1/2)
// 대장 쪽 숫자는 **반입하던 그때** 적은 값이다. 저장소가 적으면 벡터가 부분적으로 날아간 것이고,
// 많으면 옛 판 조각이 남아 **AI가 두 판을 섞어 읽는다.** 「있다」와 「같은 판이다」는 다른 말이다.
// ⚠ 종료 코드는 안 바꾼다 — 배포 관문의 빨강은 「리포↔운영↔목록이 어긋났다」는 뜻이고, 조각 수
//   어긋남은 재인입으로 푸는 다른 일이다. 섞으면 배포가 엉뚱한 이유로 멈춘다.
describe("docs-drift — 조각 수까지 대조한다(이름만 맞으면 초록이던 자리)", () => {
  it("★ 세 경우를 한 번에 가른다 — 같음 · 저장소가 적음 · 저장소가 많음", () => {
    const 대장반쪽 = [
      { documentId: "같음.md", chunks: 5 },
      { documentId: "CrowdStrike_GTR.pdf", chunks: 101 }, // 저장소가 **적다**(벡터가 날아갔다)
      { documentId: "model-intake-policy.md", chunks: 1 }, // 저장소가 **많다**(옛 판 조각이 남았다)
    ];
    const r = 잣대대조(대장반쪽, { "같음.md": 5, "CrowdStrike_GTR.pdf": 99, "model-intake-policy.md": 2 });
    expect(r.유령, "이름은 다 있으므로 통째 유령은 0건이어야 한다").toEqual([]);
    expect(r.대장밖).toEqual([]);
    // 차이가 큰 것부터 — 위에서 몇 줄만 봐도 심한 것을 먼저 만난다.
    expect(r.조각어긋남).toEqual([
      { 이름: "CrowdStrike_GTR.pdf", 대장: 101, 저장: 99 },
      { 이름: "model-intake-policy.md", 대장: 1, 저장: 2 },
    ]);
  });

  it("★★ 조각 수가 같으면 0건이다 — 헛경보를 만들지 않는다", () => {
    const r = 잣대대조(대장, 저장조각); // 위 재료는 겹치는 넷의 조각 수가 모두 같다
    expect(r.조각어긋남).toEqual([]);
    expect(r.조각미기재).toEqual([]);
    // 통째 유령은 조각 수 대조에서 **뺀다** — 이미 유령으로 이름을 댔다(같은 문서를 두 번 세지 않는다).
    expect(r.유령.map((g) => g.이름)).toEqual(["2025년 사이버 위협 전망.pdf"]);
  });

  it("★★ 대장에 조각 수가 안 적힌 줄은 **빼되 몇 건인지 말한다** — 0으로 치면 전부 어긋남이 된다", () => {
    const r = 잣대대조(
      [{ documentId: "안적힘.md" }, { documentId: "영.md", chunks: 0 }, { documentId: "널.md", chunks: null }],
      { "안적힘.md": 7, "영.md": 3, "널.md": 1 } as Record<string, number>,
    );
    expect(r.조각어긋남, "조각 수를 모르는 줄을 어긋남으로 셌다").toEqual([]);
    expect(r.조각미기재).toEqual(["널.md", "안적힘.md", "영.md"]);
  });

  it("★ 도구가 조각 수 어긋남을 **찍는다** · 종료 코드는 안 바꾼다(소스 감시)", () => {
    expect(소스, "조각 수 어긋남을 사람에게 안 알린다").toContain("조각 수 어긋남");
    expect(소스, "이름·대장/저장소를 함께 찍지 않는다").toContain("이름 · 대장/저장소");
    // 실패(종료 1) 판정에 조각 수가 섞이면 배포 관문의 뜻이 흐려진다.
    const 실패줄 = 소스.slice(소스.indexOf("const 실패 ="), 소스.indexOf("const 실패 =") + 120);
    expect(실패줄).toContain("어긋남.length > 0 || 미인입.length > 0");
    expect(실패줄, "조각 수 어긋남이 종료 코드를 바꾼다").not.toContain("조각어긋남");
  });
});
