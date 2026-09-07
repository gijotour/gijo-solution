// `tools/docs-drift.mjs`가 **정직하게 말하는가** — 소스 문자열 감시. (계획서 전-4 · 2026-09-07)
//
// ■ 왜 여기만 남았나 (2026-09-07 이 라운드)
//   두 잣대 대조의 **논리**는 `server/src/engine/docledger.ts`로 옮겼다(제품도 같은 판정을
//   해야 해서다 — 「AI 지식」 목록·지식 현황·위생 점검이 전부 「조각 없는 문서」를 알아야 한다).
//   그래서 순수 함수 시험도 `docledger.test.ts`로 따라갔다. **여기 남은 것은 도구 자체의 태도**다 —
//   못 읽었을 때 「건너뛰었다」고 말하는가, 지운다고 오해할 말을 하지 않는가, 조각 수 어긋남이
//   종료 코드를 흔들지 않는가. 이건 도구 파일을 읽어야만 잴 수 있다.
//
// ■ 재는 것 / 안 재는 것
//   재는 것: 도구 소스에 실재해야 하는 문구·금지된 호출.
//   안 재는 것: WSL 조회 자체(운영 DB가 있어야 한다).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 소스 = fs.readFileSync(path.join(__dirname, "../../tools/docs-drift.mjs"), "utf8");
const docledger소스 = fs.readFileSync(path.join(__dirname, "../src/engine/docledger.ts"), "utf8");

describe("docs-drift — 못 읽었으면 못 읽었다고 말한다(소스 감시)", () => {
  it("★ 대장을 못 읽으면 **건너뛰었다고 말한다**(0건으로 적지 않는다)", () => {
    // 2026-09-04 사고의 재발 방지: 조회 실패를 빈 값으로 삼켜 「0건 인입」이라 보고했던 자리다.
    expect(소스, "대장 조회가 실패해도 0건인 척한다").toContain("건너뛰었습니다");
    expect(소스, "대장 조회는 읽기 전용이어야 한다").toContain("{readonly:true}");
    expect(소스, "sqlite3 CLI는 운영 WSL에 없다 — node+better-sqlite3로 읽는다").toContain("better-sqlite3");
    expect(/sqlite3\s+["'/]/.test(소스), "sqlite3 CLI를 부른다 — 운영 WSL에는 그 명령이 없다").toBe(false);
  });

  it("도구는 **지우지 않는다**고 스스로 밝힌다", () => {
    expect(소스).toMatch(/지우지 않았습니다|아무것도 지우지 않는다/);
  });

  it("★ 도구가 조각 수 어긋남을 **찍는다** · 종료 코드는 안 바꾼다", () => {
    expect(소스, "조각 수 어긋남을 사람에게 안 알린다").toContain("조각 수 어긋남");
    expect(소스, "이름·대장/저장소를 함께 찍지 않는다").toContain("이름 · 대장/저장소");
    // 실패(종료 1) 판정에 조각 수가 섞이면 배포 관문의 뜻이 흐려진다.
    const 실패줄 = 소스.slice(소스.indexOf("const 실패 ="), 소스.indexOf("const 실패 =") + 120);
    expect(실패줄).toContain("어긋남.length > 0 || 미인입.length > 0");
    expect(실패줄, "조각 수 어긋남이 종료 코드를 바꾼다").not.toContain("조각어긋남");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ **잣대는 한 벌** — 정의가 도구로 되돌아오면 여기서 빨개진다 (2026-09-07)
//
// 이 대조는 처음에 `tools/docs-drift.mjs` 안에서 태어났다. 제품도 같은 판정을 해야 해서
// `server/src/engine/docledger.ts`로 **옮겼는데**(복사가 아니다), 나중에 누군가 도구 쪽이
// 빌드에 매이는 게 불편해서 「여기도 하나 적어 두자」고 하면 **셋째 벌**이 된다.
// 그 순간 도구와 제품이 다른 답을 내고, 어느 쪽이 맞는지는 아무도 모른다
// (이 저장소가 반복해 겪은 「같은 것을 여러 곳에 적으면 어긋난다」).
describe("docs-drift — 판정 정의는 제품 한 곳뿐이다(두 벌 금지)", () => {
  it("★ docs-drift.mjs에 잣대대조·매니페스트밖 **정의가 없다**(부르기만 한다)", () => {
    expect(/function\s+잣대대조\s*\(/.test(소스),
      "docs-drift.mjs가 잣대대조를 스스로 정의한다 — 제품(engine/docledger.ts)과 두 벌이 된다").toBe(false);
    expect(/function\s+매니페스트밖\s*\(/.test(소스),
      "docs-drift.mjs가 매니페스트밖을 스스로 정의한다 — 제품과 두 벌이 된다").toBe(false);
    expect(소스, "제품 판을 부르는 자리가 없다").toContain("server\", \"dist\", \"engine\", \"docledger.js\"");
  });

  it("★ 빌드가 없으면 **멈춘다**(exit 2) — 건너뛰면 「어긋남 0건」이라는 거짓 초록이 된다", () => {
    const 자리 = 소스.slice(소스.indexOf("async function 잣대모듈"), 소스.indexOf("async function 잣대모듈") + 2200);
    expect(자리, "빌드가 없을 때 중단하지 않는다").toContain("중단([");
    expect(자리, "낡은 빌드(내보내기 없음)를 그냥 쓴다").toContain("npm run build");
  });

  it("★ 빌드가 **낡아도** 멈춘다 — 「없으면 멈춘다」만 지키면 옛 정의로 재고 초록을 준다", () => {
    // 2026-09-07 적발: existsSync만 봐서 소스보다 낡은 dist를 그대로 썼다. 같은 dist를 부르는
    // tools/route-explain.mjs는 같은 자리에서 mtime을 견줘 낡으면 다시 빌드한다 — 한쪽만 눈을 감고 있었다.
    const 자리 = 소스.slice(소스.indexOf("async function 잣대모듈"), 소스.indexOf("async function 잣대모듈") + 2200);
    expect(자리, "mtime을 안 견준다 — 낡은 dist로 재고 「어긋남 0건」을 준다").toContain("mtimeMs");
    expect(자리, "낡았을 때 무엇을 하라는지 안 알려 준다").toContain("낡았습니다");
  });

  it("★ docledger.ts는 **순수**하다 — 도구가 dist를 불러도 DB가 안 열린다", () => {
    // 도구는 win 호스트에서 돌고 DB는 WSL 운영본이다. engine이 ./db·lancedb를 끌면
    // import하는 순간 엉뚱한 기계에서 SQLite·LanceDB를 연다.
    const import줄 = docledger소스.split("\n").filter((l) => /^\s*import\s/.test(l));
    expect(import줄, `docledger.ts에 import가 생겼다:\n  ${import줄.join("\n  ")}`).toEqual([]);
  });
});
