// 🗂 지금 범위가 **화면 목록도** 좁히는가 (승인 시안 mockups/자산_0단계, 2026-08-18)
//
// ⚠ 이 시험이 지키는 것은 **두 가지**다:
//   ① 되는 화면이 실제로 걸러지는가 — 배관이 6고리라 하나만 끊겨도 조용히 아무 일도 안 난다.
//   ② **못 거르는 화면이 그렇다고 말하는가** — 조용히 무시하면 담당자는 「걸렸겠지」 하고
//      그 숫자를 믿는다. 오늘 이미 세 번 겪었다(결정적 목록 · 도구 인자 없음 · 강제 규칙).
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const 읽기 = (p: string) => fs.readFileSync(new URL(`../../client/src/renderer/pages/${p}`, import.meta.url), "utf8");
const 부품 = 읽기("scopefilter.js");
const 허브 = 읽기("grouphub.js");

/** 범위로 목록을 좁히는 화면 — 자료에 자산 식별자가 **실제로 있는** 곳만. */
const 거르는화면 = ["vulnscan.html", "sbom.html", "approvals.html", "maintenance.html", "report.html", "analysis.html"];
/** 자산으로 나눌 수 없는 화면 — 그렇다고 **말해야** 한다. */
const 못거르는화면 = ["hardening.html", "kpi.html", "compliance.html", "terminal.html"];

describe("공용 부품 — 한 곳에만 적는다", () => {
  it("범위를 받는 통로와 띠가 부품에 있다", () => {
    expect(부품, "범위 변경을 안 받는다").toContain('d.type !== "gijo:scope:set"');
    expect(부품, "바뀌면 알리는 통로가 없다").toMatch(/onChange: function/);
    expect(부품, "좁힌 사실을 알리는 띠가 없다").toMatch(/chip: function/);
    expect(부품, "못 나눈다고 말할 길이 없다").toMatch(/없음: function/);
  });

  it("★ 등록 즉시 한 번 부른다 — 안 그러면 이미 걸린 범위를 놓친다", () => {
    // 화면이 뜰 때 범위가 이미 걸려 있으면 `gijo:scope:set`은 안 온다(이미 지나갔다).
    // 등록할 때 한 번 부르지 않으면 **그 화면만 전체를 보여 준다.**
    expect(부품, "등록 즉시 안 부른다").toMatch(/듣는이\.push\(fn\);\s*\n\s*try \{ fn\(범위\); \}/);
  });

  it("★ 부품은 저장소에 **쓰지 않는다** — 쓰는 곳은 대화창 한 곳이다", () => {
    // iframe끼리 localStorage를 공유하므로 두 곳이 쓰면 경합한다.
    expect(부품, "부품이 범위를 직접 저장한다 — 대화창과 어긋난다").not.toMatch(/localStorage\.setItem/);
    expect(부품, "부품이 범위를 직접 지운다").not.toMatch(/localStorage\.removeItem/);
    // 푸는 것도 대화창에 부탁한다.
    expect(부품, "전체 보기가 대화창을 안 거친다").toMatch(/gijo:scope", scope: null/);
  });
});

describe("★★ 2단 중계 — 이게 없으면 판은 영영 범위를 모른다", () => {
  it("허브가 범위를 받아 무대에 다시 전한다", () => {
    // 셸은 자기 **탭**에만 보낸다. 판(무대)은 허브 화면 안의 **또 다른 iframe**이라 안 닿는다.
    expect(허브, "허브가 범위를 안 받는다").toContain('d.type !== "gijo:scope:set"');
    expect(허브, "무대에 다시 전하지 않는다 — 사슬이 여기서 끊긴다").toMatch(/function 무대에전하기\(/);
    const 호출 = (허브.match(/무대에전하기\(/g) || []).length;
    expect(호출, "함수만 있고 안 부른다 — 죽은 코드다").toBeGreaterThanOrEqual(3); // 정의 + 수신 + load
  });

  it("★ 나중에 뜨는 판에도 먹인다 — 안 그러면 그 판만 전체를 보여 준다", () => {
    // 판을 눌러 처음 열 때 무대는 **지금 만들어진다**. 그때 보내면 받을 창이 아직 없다.
    expect(허브, "새로 뜨는 판에 범위를 안 먹인다").toMatch(
      /stage\.addEventListener\("load", function 한번\(\)[\s\S]{0,200}무대에전하기\(stage, 지금범위\)/
    );
  });
});

describe("★ 거르는 화면 6곳", () => {
  for (const f of 거르는화면) {
    it(`${f} — 부품을 싣고 실제로 거른다`, () => {
      const s = 읽기(f);
      expect(s, "부품을 안 싣는다").toContain('<script src="scopefilter.js"></script>');
      // 실제로 값을 읽어 쓰는가 — 싣기만 하고 안 쓰면 아무 일도 안 일어난다.
      expect(s, "범위를 읽지 않는다 — 싣기만 했다").toMatch(/gijoScope\.(assetId|get)\(\)/);
    });
  }

  it("★ 좁힌 사실을 화면이 **말한다** — 안 말하면 그 수를 전체로 읽는다", () => {
    // 띠가 없으면 「3건뿐이네」 하고 넘어간다. approvals는 자기 띠(#rvScope)가 이미 있다.
    for (const f of 거르는화면) {
      const s = 읽기(f);
      const 알린다 = /gijoScope\.chip\(/.test(s) || /rvScope/.test(s);
      expect(알린다, `${f}가 좁히고도 안 알린다`).toBe(true);
    }
  });

  it("★ 전사 리포트를 지우지 않는다 — 없는 사실을 만들면 안 된다", () => {
    // 대상 자산이 빈 리포트는 「전체 자산 대상」이라 그 자산도 포함한다.
    // 걸러 내면 「이 자산은 보고가 없다」로 잘못 읽힌다.
    const s = 읽기("report.html");
    expect(s, "전사 리포트를 걸러 낸다").toMatch(/!\(r\.assetIds \|\| \[\]\)\.length \|\|/);
  });

  it("★ 통합관제는 소스마다 다른 칸을 본다 — 한 칸만 보면 그 소스가 통째로 사라진다", () => {
    // 취약점만 ref가 자산 id다. 로그·제품·점검은 entity(이름)·peers로 맞춰야 한다.
    const s = 읽기("analysis.html");
    expect(s, "자산 칸 하나만 본다").toMatch(/e\.ref === 범위\.id \|\| e\.entity === 범위\.label \|\| \(e\.peers \|\| \[\]\)\.includes/);
  });

  it("★ 쿼리로 콕 집어 들어온 것이 범위보다 **먼저다**", () => {
    // 담당자가 「이 건」을 눌러 들어온 것이라 화면 상태보다 구체적이다.
    const s = 읽기("approvals.html");
    expect(s, "쿼리보다 범위를 우선한다").toMatch(/if \(!scopeAsset && window\.gijoScope/);
    expect(s, "쿼리로 들어왔는데 범위가 덮어쓴다").toMatch(/쿼리로왔나/);
  });
});

describe("★★ 못 거르는 화면 4곳 — 조용히 무시하지 않는다", () => {
  for (const f of 못거르는화면) {
    it(`${f} — 「전체를 보여 준다」고 밝힌다`, () => {
      const s = 읽기(f);
      expect(s, "부품을 안 싣는다").toContain('<script src="scopefilter.js"></script>');
      expect(s, "못 나눈다는 사실을 안 알린다 — 담당자는 걸린 줄 안다").toMatch(/gijoScope\.없음\(/);
    });
  }

  it("★ 이유를 함께 적는다 — 「왜 안 되는지」가 없으면 결함으로 읽힌다", () => {
    const 이유들: [string, RegExp][] = [
      ["hardening.html", /점검 대상 표에 자산 칸이 없습니다/],
      ["kpi.html", /전사 합계/],
      ["compliance.html", /조직 단위/],
      ["terminal.html", /좁힐 목록이 없습니다/],
    ];
    for (const [f, re] of 이유들) expect(읽기(f), `${f}가 이유를 안 적는다`).toMatch(re);
  });
});

describe("★ 안내가 사실과 맞는다", () => {
  it("⓪ 자산 화면이 「전부 걸러진다」고 말하지 않는다", () => {
    const s = 읽기("assets.html");
    expect(s, "못 거르는 화면이 있다는 사실을 숨긴다").toMatch(/자산으로 못 나누는 화면은 그렇다고 알려 줍니다/);
    // 「준비 중」은 이제 거짓이다 — 만들었으니 그렇게 적으면 안 된다.
    expect(s, "이미 만든 것을 「준비 중」이라 적는다").not.toMatch(/화면 목록 자동 걸러내기는 아직 준비 중/);
  });

  it("챗봇 안내도 못 거르는 화면을 밝힌다", () => {
    const g = fs.readFileSync(new URL("../src/engine/screenguide.ts", import.meta.url), "utf8");
    expect(g, "안내가 아직 「준비 중」이라 말한다").not.toMatch(/화면의 목록을 자동으로 걸러 주는 것은 아직 준비 중/);
    expect(g, "못 나누는 화면을 안 밝힌다").toMatch(/자산으로 나눌 수 없는 화면/);
  });
});
