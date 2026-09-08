// 별칭 표 두 개의 짝 · 대화앞으로()의 생산자 — 2026-08-31 검토관 [중간]·[낮음]
//
// 왜: screenguide.ts에는 별칭 표가 **둘**이다 — 실제로 도는 `화면별칭`과, 여는 주소만 담는
// 곁표 `별명열기탭`. 곁표에만 적으면 아무도 안 읽어 **죽은 줄**이 된다. 📂(지켜보는폴더·
// 폴더감시)와 📨(조치요청서)가 실제로 그렇게 등록돼, 커밋은 「별칭 반영」이라 적었는데
// 사람이 그 이름으로 물으면 안 걸렸다. 사람이 셀 수 없으니 기계가 센다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "src", "engine", "screenguide.ts"), "utf8");

/** `const 이름: Record<string, string> = { … }` 한 덩어리에서 열쇠만 뽑는다. */
function 열쇠들(표이름: string): string[] {
  const i = SRC.indexOf("const " + 표이름);
  expect(i, 표이름 + " 표가 없다").toBeGreaterThan(-1);
  const s = SRC.indexOf("{", i), e = SRC.indexOf("};", s);
  return [...SRC.slice(s, e).matchAll(/^\s*([가-힣A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
}

describe("별칭은 도는 표에 있어야 산다", () => {
  it("별명열기탭의 모든 열쇠가 화면별칭에도 있다", () => {
    const 도는표 = new Set(열쇠들("화면별칭"));
    const 곁표 = 열쇠들("별명열기탭");
    expect(곁표.length, "곁표가 비었다 — 뽑기가 깨졌는지 먼저 볼 것").toBeGreaterThan(3);
    const 죽은줄 = 곁표.filter((k) => !도는표.has(k));
    expect(죽은줄, "곁표에만 있는 별칭은 아무도 안 읽는다: " + 죽은줄.join(", ")).toEqual([]);
  });
});

describe("대화앞으로()가 기대는 두 심볼이 셸에 다 있다", () => {
  // 소비자(console.js)만 지키면 생산자(app.html)가 이름을 바꿔도 조용히 죽는다.
  // toChat 하나만 지키던 옛 계약의 빈자리다(검토관 [낮음]).
  it("app.html이 toChat과 summonConsole을 둘 다 내놓는다", () => {
    const 셸 = readFileSync(
      join(__dirname, "..", "..", "client", "src", "renderer", "pages", "app.html"), "utf8");
    expect(셸, "gijoTabs.toChat 노출이 없다").toContain("toChat:");
    expect(셸, "gijoTabs.summonConsole 노출이 없다 — 화면을 덮지 않는 갈래가 죽는다")
      .toContain("summonConsole:");
  });
});
/* ── 구역 별칭 ↔ 실재하는 구역 (2026-09-07 · 계획서 중-1 마무리) ───────────────────────
   왜 이 짝이 필요한가: `resolvePanelHit`의 훑기()는 `g.panels[real]`이 없으면 **조용히
   건너뛴다.** 값에 오타가 나거나 구역 이름이 바뀌면 그 별칭은 **아무도 안 읽는 줄**이 되고,
   커밋 메시지에는 「별칭 반영」이라 적힌다 — 이 파일 머리말의 📂·📨 사고와 **같은 병**이
   이번엔 별칭 표 **안쪽**에서 나는 것이다.
   ⚠ 판정을 여기서 정규식으로 다시 짜지 않는다. 표 모양이 바뀌면 그 정규식이 조용히 눈을 감고,
     그러면 「시험이 있다」가 오히려 거짓 안심이 된다(guidance-check가 겪은 부류).
     판정은 제품 코드 한 곳(screenguide.죽은구역별칭)이 하고 여기서는 결과만 본다. */
import { 죽은구역별칭, 구역별칭들, 안내화면열쇠들, isHelpIntent } from "../src/engine/screenguide";
import { forcedToolFor } from "../src/engine/agentloop";

describe("구역 별칭은 실재하는 구역을 가리켜야 산다", () => {
  it("★ 죽은 별칭이 0개다 — 값은 panels 열쇠와 **한 글자까지** 같아야 한다", () => {
    const 죽은줄 = 죽은구역별칭();
    expect(죽은줄,
      "값이 실재하지 않는 구역을 가리킨다(그 별칭은 영영 안 걸린다): " +
      죽은줄.map((x) => `${x.screen} 「${x.shown}」→「${x.real}」`).join(" · ")
    ).toEqual([]);
  });

  it("판정 자체가 헛돌지 않는다 — 별칭 표가 실제로 읽혔나(모집단 감시)", () => {
    // 표를 못 읽으면 죽은줄이 늘 0이라 위 시험이 **언제나 초록**이다. 화면 수로 먼저 확인한다.
    expect(안내화면열쇠들().length, "GUIDES를 못 읽었다").toBeGreaterThan(20);
  });
});

/* ── 별칭이 강제 규칙을 가로채지 않는가 (2026-09-07 실사고 방지) ───────────────────────
   dispatcher.ts는 **화면 안내(isHelpIntent)를 강제 도구보다 먼저** 본다(1568줄 vs runAgentLoop).
   그래서 구역 별칭에 「조각 없는 문서」를 넣는 순간 강제 규칙 `doc_chunk_gaps`가 **통째로
   죽는다** — 도구는 멀쩡한데 그 말이 도구에 닿지 못한다. 「사유」 홑낱말 사고의 같은 계열이고,
   이번에는 **가로채는 쪽이 안내**다. 전 화면에서 확인한다(한 화면만 재면 다음에 다른 화면에서 난다). */
describe("안내 별칭이 강제 도구의 말을 가로채지 않는다", () => {
  const 강제로가야하는말 = [
    "조각 없는 문서 알려줘",   // doc_chunk_gaps (FORCED_INTENTS, route-explain [37])
    "조각이 없는 문서 알려줘", // ★ 조사 하나 다른 꼴 — 2026-09-07에 실제로 샜다(아래 전수 감시가 뿌리)
    "새 문서 뭐 들어왔어?",     // recent_documents
  ];
  for (const q of 강제로가야하는말) {
    it(`「${q}」는 어느 화면에서도 화면 안내로 새지 않는다`, () => {
      const 샌화면 = 안내화면열쇠들().filter((s) => isHelpIntent(q, s));
      expect(샌화면,
        "이 화면들에서 구역 이름·별칭이 강제 규칙보다 먼저 걸린다: " + 샌화면.join(", ")
      ).toEqual([]);
      expect(isHelpIntent(q), "화면 없이도 새면 공통(OVERVIEW) 구역이 원인이다").toBe(false);
    });
  }
});

/* ── ★★ 별칭 **전수** 감시 (2026-09-07 검토관 [중] 수리) ─────────────────────────────
   ■ 무엇이 틀렸었나: 바로 위 시험은 「가로채기 0」이라 초록이었는데, **모집단이 손으로 적은
     문구 두 줄뿐**이라 손이 안 적은 것은 원리상 못 봤다. 그 사이 별칭 「조각이 없는 문서」가
     강제 도구 doc_chunk_gaps를 화면 3곳에서 가로채고 있었다(실측). 시험은 초록, 제품은 결함.
   ■ 그래서 모집단을 **표 전체**로 바꾼다: 별칭 하나하나에 사람이 실제로 붙이는 꼬리를 달아
     ① 그 말이 강제 도구의 것인가(forcedToolFor) ② 그런데 안내가 먼저 채 가는가(isHelpIntent)
     둘 다 참이면 가로채기다. dispatcher.ts가 isHelpIntent를 강제 도구보다 **앞**에 두기 때문에
     (1568줄 vs runAgentLoop) 그 순간 도구는 멀쩡한 채로 말이 안 닿는다.
   ■ 아직 안 고친 것은 **이름을 적어 둔다**(빈 배열이 아니라 대장). 이 라운드가 만들지 않은
     9쌍이 남아 있는데, 별칭 하나를 걷어내면 그 화면의 안내 도달 경로가 함께 바뀌므로 마무리
     라운드에서 손대지 않는다. 새로 하나가 늘면 여기서 **빨개진다** — 그것이 이 감시의 값이다.
   ⚠ 구역 **이름**(별칭 아님)의 전수는 **test/panelname.test.ts**가 맡는다(2026-09-08 신설).
     여기 모집단은 별칭 표뿐이라 이름 쪽으로 새는 20쌍을 **원리상 못 봤다** — 2026-09-07에
     별칭 「조각이 없는 문서」를 걷어내고 초록을 받았는데, 이름 「조각이 없는 문서(⚠)」가
     그대로 doc_chunk_gaps를 채 가고 있었다. 두 시험은 **같은 판정 두 마디**를 쓰고
     모집단만 다르다(별칭 142개 / 이름 165개). */
describe("★ 별칭 전수 — 강제 도구의 말을 채 가는 별칭은 대장에 적힌 것뿐이다", () => {
  const 꼬리 = ["알려줘", "보여줘", "뭐야?", "있어?"];
  /** 남아 있는 가로채기 — `화면|별칭|도구`. **2026-09-08에 비었다.**
   *  ■ 어떻게 비웠나: 별칭을 하나도 걷어내지 않았다. 잣대를 한 곳에서 고쳤다 —
   *    screenguide.isHelpIntent가 「구역 이름·별칭이 제품 도구의 주제어와 같고, 질문에
   *    안내낱말(사용·설명·방법·어떻게…)이 하나도 없으면」 안내를 비켜 준다.
   *    그래서 「준수율 구간 알려줘」는 kpi_status로, 「지금 급한 것 뭐야?」는 today로 간다.
   *    「준수율 구간 설명해줘」처럼 안내를 구하는 말은 여전히 안내다(같은 라운드 실측).
   *  ■ 비었다고 감시가 헛도는 것은 아니다 — 아래 마지막 반증이 판정 두 마디를 되짚고,
   *    이름 쪽 전수는 test/panelname.test.ts가 **대장 5줄**을 들고 같은 판정을 돌린다. */
  const 대장: string[] = [];

  const 실측 = (): string[] => {
    const out = new Set<string>();
    for (const a of 구역별칭들()) {
      for (const t of 꼬리) {
        const q = `${a.shown} ${t}`;
        const f = forcedToolFor(q);
        if (!f) continue;
        const 화면들 = a.screen ? [a.screen] : 안내화면열쇠들();
        for (const sc of 화면들) if (isHelpIntent(q, sc)) out.add(`${sc}|${a.shown}|${f.tool}`);
      }
    }
    return [...out].sort();
  };

  it("모집단이 살아 있다 — 별칭 표를 실제로 읽었나", () => {
    expect(구역별칭들().length, "별칭 표를 못 읽었다 — 아래가 전부 헛초록이 된다").toBeGreaterThan(80);
  });

  it("★★ 가로채는 별칭이 대장과 **정확히** 같다(늘어도 줄어도 빨강)", () => {
    const 지금 = 실측();
    expect(지금,
      "대장에 없는 가로채기가 생겼거나(새 별칭이 강제 도구를 죽였다), 고쳤는데 대장을 안 지웠다. " +
      "새 별칭을 더할 때는 forcedToolFor(별칭 + ' 알려줘')가 null인지 먼저 보라."
    ).toEqual(대장);
  });

  it("★ 이 라운드가 만든 「조각 …」 별칭은 하나도 안 채 간다", () => {
    expect(실측().filter((x) => /조각/.test(x)), "조각 계열 별칭이 doc_chunk_gaps를 다시 가로챈다").toEqual([]);
  });

  it("★ 판정이 헛돌지 않는다(반증) — 걷어낸 별칭을 되돌리면 잡힌다", () => {
    // 「조각이 없는 문서」가 바로 그 걷어낸 별칭이다. 별칭 표에 없더라도 판정 두 마디는 그대로다.
    const q = "조각이 없는 문서 알려줘";
    expect(forcedToolFor(q)?.tool, "강제 규칙이 사라졌다 — 이 감시의 전제가 무너졌다").toBe("doc_chunk_gaps");
    expect(안내화면열쇠들().filter((s) => isHelpIntent(q, s)), "별칭을 걷어냈는데 아직 샌다").toEqual([]);
  });
});
