// engine/docledger — **반입 대장 ↔ 지식 저장소 잣대 한 곳**의 짝 시험. (계획서 전-4 · 2026-09-07)
//
// ■ 어디서 왔나
//   이 시험의 순수 함수 갈래는 `docsdriftledger.test.ts`에서 **그대로 옮겨 온 것**이다.
//   정의가 `tools/docs-drift.mjs` → `server/src/engine/docledger.ts`로 옮겨 갔으니
//   시험도 따라온다. ★ **회귀 0을 먼저 증명하려고 기대값을 한 글자도 안 고쳤다** —
//   옮기면서 기대값을 손보면 「옮겼더니 통과」인지 「고쳤더니 통과」인지 영영 못 가른다.
//   `tools/docs-drift.mjs`의 **소스 문자열 감시**는 그 파일 곁에 남겼다(그 자리를 재는 시험이라).
//
// ■ 무엇이 문제였나 (실측)
//   `node tools/docs-drift.mjs`는 「지식저장소 3,920건 인입」이라 하고, 운영 `memory_documents`에는
//   **3,921줄**이 있었다. 둘이 다른 것은 결함이 아니라 **세는 대상이 다른 것**이다:
//     · memory_documents = 반입 **대장**(문서 한 편당 한 줄 · 조각 수는 그때 적어 둔 값)
//     · docs-drift의 「N건 인입됨」 = **LanceDB에 실제 조각이 남아 있는** 문서 수
//   2026-09-07 운영 실측으로 차이 1건의 정체를 찾았다 — `2025년 사이버 위협 전망.pdf`(대장 21조각,
//   저장소 0조각). 대장에 줄만 남고 벡터가 없어 **AI가 근거로 못 쓰는** 문서다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 잣대대조, 매니페스트밖, 조각상태, 조각없음, 대장과같음, 상태꼬리 } from "../src/engine/docledger";

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

describe("docledger — 두 잣대가 다른 이유를 제품이 말한다 (전-4)", () => {
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
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ **반쪽 유령** — 이름은 양쪽에 있는데 판이 다르다 (2026-09-07 실측)
//
// 옛 판은 이름 집합 둘만 견줬다. 그래서 「대장에 이름이 있고 저장소에도 이름이 있다」면 초록인데,
// 운영 실측에서 **조각 수가 다른 문서 셋**이 나왔다:
//   · CrowdStrike…(101/99) · Tenable IE…(4/2) · model-intake-policy…(1/2)
// 대장 쪽 숫자는 **반입하던 그때** 적은 값이다. 저장소가 적으면 벡터가 부분적으로 날아간 것이고,
// 많으면 옛 판 조각이 남아 **AI가 두 판을 섞어 읽는다.** 「있다」와 「같은 판이다」는 다른 말이다.
describe("docledger — 조각 수까지 대조한다(이름만 맞으면 초록이던 자리)", () => {
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 판정 낱개 — 목록·현황·위생 점검이 전부 이 셋을 통해 묻는다(손으로 `!==`를 적지 않게).
describe("docledger — 상태 판정은 여기 한 곳", () => {
  it("차례가 뜻이다 — 저장소 0이면 대장이 뭐라 적혔든 missing", () => {
    expect(조각상태(0, 21)).toBe("missing");
    expect(조각상태(0, 0), "대장도 안 적혔지만 **못 읽는 것**이 더 큰 사실이다").toBe("missing");
    expect(조각상태(null, 5)).toBe("missing");
  });

  it("대장이 조각 수를 안 적었으면 unknown — 모르는 것을 어긋남이라 하지 않는다", () => {
    expect(조각상태(7, undefined)).toBe("unknown");
    expect(조각상태(7, 0)).toBe("unknown");
    expect(조각상태(7, null)).toBe("unknown");
  });

  it("같음·적음·많음", () => {
    expect(조각상태(12, 12)).toBe("ok");
    expect(조각상태(99, 101)).toBe("short");
    expect(조각상태(2, 1)).toBe("extra");
  });

  it("★ 조각없음은 missing **하나뿐**이다 — 판이 달라도 읽히기는 읽힌다", () => {
    expect(조각없음("missing")).toBe(true);
    for (const s of ["ok", "short", "extra", "unknown"] as const) {
      expect(조각없음(s), `${s}를 「조각 없음」으로 셌다 — 「지식 N건」이 반대 방향으로 틀린다`).toBe(false);
    }
  });

  it("★ 대장과같음은 ok **하나뿐**이다 — short/extra를 건너뛰면 반쪽 유령이 영영 안 낫는다", () => {
    expect(대장과같음("ok")).toBe(true);
    for (const s of ["missing", "short", "extra", "unknown"] as const) {
      expect(대장과같음(s), `${s}를 「이미 같다」로 셌다 — 기동 자가치유가 멈춘다`).toBe(false);
    }
  });

  it("정상인 줄에는 꼬리표를 안 붙인다", () => {
    expect(상태꼬리("ok")).toBe("");
    expect(상태꼬리("unknown")).toBe("");
    expect(상태꼬리("missing", 21)).toBe("조각 없음(대장 21개)");
    expect(상태꼬리("missing", null), "대장도 모르면 숫자를 지어내지 않는다").toBe("조각 없음");
    expect(상태꼬리("short")).toBe("조각 일부 사라짐");
    expect(상태꼬리("extra")).toBe("옛 판 조각 남음");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 소스 감시 — 이 파일이 **순수**해야 도구가 dist를 불러도 DB가 안 열린다.
describe("docledger — 순수해야 도구가 부를 수 있다(소스 감시)", () => {
  const 소스 = fs.readFileSync(path.join(__dirname, "../src/engine/docledger.ts"), "utf8");

  it("★ import 줄이 **하나도 없다** — engine이 ./db·lancedb를 끌면 win 호스트 도구가 WSL DB를 연다", () => {
    const import줄 = 소스.split("\n").filter((l) => /^\s*import\s/.test(l) || /\brequire\s*\(/.test(l) || /\bawait\s+import\s*\(/.test(l));
    expect(import줄, `docledger.ts에 import가 생겼다:\n  ${import줄.join("\n  ")}`).toEqual([]);
  });

  it("판정이 이 파일 밖에서 손으로 다시 적히지 않게 — 상태 유니언이 다섯 값 그대로다", () => {
    expect(소스).toContain('export type DocState = "ok" | "missing" | "short" | "extra" | "unknown";');
  });
});
