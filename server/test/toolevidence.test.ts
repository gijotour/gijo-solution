// 도구가 답한 자리의 **근거 배지 생산자** (2026-09-08 · 라이브 실측 수리)
//
// ★★ 왜 이 시험이 필요한가
//   근거 배지(sources·근거세기·quotes)의 생산자는 dispatcher의 재검색 블록 **하나뿐**인데,
//   근거재검색대상인가()는 explain·search·law_lookup이 돌면 그 블록을 건너뛴다. 즉 도구가
//   답한 자리에는 **소비자만 있고 생산자가 없었다** — 라이브 실물이 그대로 보여 준다:
//     「AI 시대 소프트웨어 보안 점검표에서 …」 → tools=["explain"] · sources=null · 근거세기=「-」
//   문서를 읽고 답해 놓고 무엇을 근거로 했는지 못 말한 것이다.
//
// ■ 계약 우회가 아니다
//   sourcebadge.test:37은 「법령·개념 설명은 자기 근거라 **재검색**을 하지 않는다」고 못박는다.
//   재검색을 말라는 뜻이지 근거를 대지 말라는 뜻이 아니다 — explain이 **자기가 읽은 것**을
//   실으면 `result.sources !== undefined`가 먼저 false를 내고, 집계조회도구_RE는 그대로다.
//   그 계약이 살아 있는지는 아래 ③이 sourcebadge와 **같은 제품 함수**로 확인한다.
import { describe, it, expect, beforeAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB·인입 루트를 임시 디렉터리로 — memory.test와 같은 격리(개발 머신 data/를 안 건드린다).
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-toolevidence-"));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;
process.env.GIJO_INGEST_ROOT = tmpDb;

// 임베딩은 결정적 목 — 실서버(8081)에 붙지 않는다(memory.test와 같은 이유·같은 경로).
vi.mock("../src/engine/embedding", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [1 / 3, 2 / 3, 1])),
}));

describe("★★ explain이 자기 근거를 싣는다 (근거 배지의 생산자)", () => {
  beforeAll(async () => {
    const { ingestText } = await import("../src/engine/memory");
    await ingestText(
      "GIJO_지식_금융_취약점_평가기준.md",
      "금융 취약점 평가기준 — 평가 항목은 접근통제·암호화·로그보존 세 가지다.",
      "global", undefined, false, undefined, undefined, "builtin",
    );
  });

  it("① 근거를 읽으면 sources·근거세기·quotes를 **함께** 보고한다", async () => {
    const { 새근거수거, 근거를수거하며 } = await import("../src/engine/toolevidence");
    const { runExplain } = await import("../src/engine/agenttools/handlers");
    const 그릇 = 새근거수거();
    const out = await 근거를수거하며(그릇, () => runExplain({ topic: "금융 취약점 평가기준 항목 알려줘" }));

    expect(out, "발췌가 실려야 한다").toContain("사내 문서 근거(발췌)");
    expect(그릇.값, "도구가 읽고도 근거를 안 실으면 배지가 영영 빈다").toBeTruthy();
    expect(그릇.값!.sources).toContain("GIJO_지식_금융_취약점_평가기준.md");
    // ⚠ 근거세기는 **반드시** 함께 온다 — 클라(chatparts.js)는 `약함 = (근거세기==="약함")`이라
    //   비어 있으면 초록 「📄 근거」로 그린다. sources만 실으면 새 거짓 배지가 생긴다.
    expect(["강함", "약함"]).toContain(그릇.값!.근거세기);
    expect(그릇.값!.quotes?.[0]?.documentId, "원문 대목이 없으면 담당자가 숫자를 못 검증한다")
      .toBe("GIJO_지식_금융_취약점_평가기준.md");
  });

  it("② 지목한 문서가 「관련 사내 문서」에 실린다 — 죽어 있던 갈래", async () => {
    const { runExplain } = await import("../src/engine/agenttools/handlers");
    // 강제 경로의 topic은 **지시문 전체**다. 옛 잣대 matches(documentId, topic)는 문서 ID가
    // 질문을 통째로 포함해야 참이라 이 경로에서 **원리상 늘 0건**이었다.
    const out = await runExplain({ topic: "금융 취약점 평가기준 항목 알려줘" });
    expect(out, "제목을 통째로 댔는데 그 문서 이름이 안 뜨면 담당자가 원문을 못 찾아간다")
      .toContain("GIJO_지식_금융_취약점_평가기준.md");
  });

  it("③ 근거를 실으면 dispatcher가 **재검색을 건너뛴다** — sourcebadge 계약 그대로", async () => {
    const { 근거재검색대상인가 } = await import("../src/engine/dispatcher");
    const 답 = { steps: [], toolCalls: [{ tool: "explain", args: {}, result: "" }], output: "…" } as never;
    // 도구 이름으로도 걸러지고(옛 계약), sources가 실려도 걸러진다(새 생산자) — 둘 다 false.
    expect(근거재검색대상인가(답, "금융 취약점 평가기준 항목 알려줘"), "도구 이름 계약").toBe(false);
    expect(
      근거재검색대상인가({ ...(답 as object), sources: ["GIJO_지식_금융_취약점_평가기준.md"] } as never, "금융 취약점 평가기준 항목 알려줘"),
      "답을 만든 쪽이 근거를 확정했으면 재검색하지 않는다",
    ).toBe(false);
  });

  it("④ 첫 보고만 담는다 — 나중 도구가 앞선 근거를 덮지 않는다", async () => {
    const { 새근거수거, 근거를수거하며, 도구근거보고 } = await import("../src/engine/toolevidence");
    const 그릇 = 새근거수거();
    근거를수거하며(그릇, () => {
      도구근거보고({ sources: ["첫.md"], 근거세기: "강함" });
      도구근거보고({ sources: ["나중.md"], 근거세기: "약함" });
    });
    expect(그릇.값!.sources, "배지가 답과 다른 문서를 가리키던 2026-08-10 사고 계보").toEqual(["첫.md"]);
    expect(그릇.값!.근거세기).toBe("강함");
  });

  it("⑤ 빈 근거는 싣지 않는다 — sources:[]는 「사내 자료 안 봄」 선언이라 뜻이 다르다", async () => {
    const { 새근거수거, 근거를수거하며, 도구근거보고 } = await import("../src/engine/toolevidence");
    const 그릇 = 새근거수거();
    근거를수거하며(그릇, () => 도구근거보고({ sources: [], 근거세기: "약함" }));
    expect(그릇.값).toBeUndefined();
  });

  // ★★ 2026-09-11 설계관 지시서 §6 R2 — runExplain의 발췌 슬라이스(발췌최대)가 3이면 라벨(4건)·
  //   sources(최대 4)보다 적게 실려 **배지엔 있는데 모델은 못 본 문서**가 생긴다
  //   (「EPSS랑 VPR 뭐가 달라?」 2026-09-11 라이브 재현 — 뿌리 ⓐ). 5편을 넣어 queryMemoryGraded의
  //   topK=4 상한에 실제로 걸리게 하고, sources에 실린 문서는 전부 발췌 본문에도 있어야 한다.
  it("⑥ 배지에 실은 문서는 전부 발췌에도 있다 — 모델이 못 본 문서를 근거라 부르지 않는다", async () => {
    const { ingestText } = await import("../src/engine/memory");
    const { runWithRagScope } = await import("../src/engine/ragscope");
    const { 새근거수거, 근거를수거하며 } = await import("../src/engine/toolevidence");
    const { runExplain } = await import("../src/engine/agenttools/handlers");
    const 표지들 = ["가", "나", "다", "라", "마"];
    const ids = 표지들.map((표지) => `GIJO_지식_병렬수리_${표지}.md`);
    for (const [i, id] of ids.entries()) {
      await ingestText(
        id, `병렬수리 근거 표지 ${표지들[i]} — 짧은 한 조각 문서다.`,
        "global", undefined, false, undefined, undefined, "builtin",
      );
    }
    const 그릇 = 새근거수거();
    // ☑ 지정 범위(ragscope)로 검색 세계를 이 5편으로 좁힌다 — 안 좁히면 같은 tmp DB에
    //   먼저 넣어 둔 ①번 문서(같은 목 벡터라 거리가 늘 0)가 섞여 들어와 뜻이 흐려진다.
    const out = await runWithRagScope({ docIds: ids }, () =>
      근거를수거하며(그릇, () => runExplain({ topic: "병렬수리 근거 표지" })),
    );
    const sources = 그릇.값?.sources ?? [];
    // ★ 2026-09-11 검토관 [하] 수리 — 옛 단언은 `toBeGreaterThan(0)`이라 sources가 3 이하로
    //   떨어지면 옛 slice(0,3)으로 되돌려도 초록이었다(수리를 못 지키는 감시). 상한에 실제로
    //   걸렸음을 못 박고, 발췌 줄 수가 그 개수와 **같은지**도 함께 센다 — 이 시험의 불변식은
    //   「배지에 실은 문서 수 = 발췌에 실린 줄 수」이지 「0보다 크다」가 아니다.
    expect(sources.length, "5편 중 topK=4 상한에 걸려야 이 시험이 뜻을 갖는다").toBe(4);
    const 발췌줄수 = out.split("\n").filter((l) => l.startsWith("  · ")).length;
    expect(발췌줄수, "배지 개수와 발췌 줄 수가 다르면 모델이 못 본 문서를 근거라 부른 것이다")
      .toBe(sources.length);
    for (const id of sources) {
      const 표지 = id.replace("GIJO_지식_병렬수리_", "").replace(".md", "");
      expect(out, `배지에 실은 ${id}의 본문이 발췌 줄에 없다 — 모델이 못 본 문서를 근거라 불렀다`)
        .toContain(`근거 표지 ${표지}`);
    }
  });
});

// ── 소스 감시 — **잣대는 한 함수뿐** ────────────────────────────────────────
// 「세 번째면 소스 감시」(2026-09-08 기준 다섯 번째 잣대다: 문서지목질문 · docScope · 문서우선 ·
//   currentDocIds · 제목지목). 잣대를 한 함수로 모아 놓고 사본이 생기면 이 감시가 잡는다.
describe("★ 지목 판정은 hybridsearch.제목지목매치 한 곳", () => {
  const 읽기 = (p: string) => fs.readFileSync(path.join(__dirname, "..", "src", p), "utf8");

  it("토큰 규칙(한글 2자↑/라틴 3자↑·성립 조건)이 hybridsearch.ts 밖에 사본으로 없다", () => {
    const 사본금지 = [/\[가-힣\]/, /length >= \(/];
    for (const f of ["engine/memory.ts", "engine/agentloop.ts", "engine/agenttools/handlers.ts"]) {
      const src = 읽기(f);
      const 지목부 = src.split("\n").filter((l) => /제목지목/.test(l) && !/^\s*(\/\/|\*)/.test(l)).join("\n");
      for (const re of 사본금지) {
        expect(re.test(지목부), `${f}에 지목 토큰 규칙 사본이 생겼다 — 잣대는 hybridsearch.제목지목매치 하나다`).toBe(false);
      }
    }
  });

  it("랭킹 부스트와 라우팅이 **같은 원천부**(memory.제목지목문서)를 부른다", () => {
    const mem = 읽기("engine/memory.ts");
    // ★ 2026-09-11 B1 — fuseResults가 terms.acronyms(3번째 인자)를 받는다(약어 히트 게이트).
    expect(mem, "랭킹 부스트가 옛 목록(업로드 한정)으로 되돌아갔다")
      .toContain("applyDocScopeBoost(applyOriginBoost(fuseResults({ vector, lexical }, terms.codes, terms.acronyms), builtinDocumentIds()), 제목지목문서(question))");
    expect(읽기("engine/agentloop.ts"), "라우팅 꼬리 갈래가 사라졌다").toContain("제목지목질문(instruction)");
  });

  // ★★ 2026-09-08 검토관 [중] — **배관의 가운데 두 고리에 가드가 없었다.**
  //   실측(격리 사본): ① dispatcher가 loop.sources를 싣는 3줄을 지워도 전체 시험 **초록**,
  //   ② runAgentLoop의 수거 래퍼를 되돌려도 **초록**. 잎(도구근거보고)만 물려 있어서, 배선이
  //   끊기면 배지가 조용히 옛 상태(sources=null)로 돌아가고 아무도 모른다 — 이 저장소가
  //   이름 붙인 「생산자 없는 값」이 바로 이 꼴이고, agentloop 강제 경로 주석 자신이
  //   「갈래 하나를 빠뜨리면 아무 일도 안 일어난다」고 적어 둔 자리다.
  it("★★ 가운데 고리 ① — runAgentLoop이 근거를 **수거해서** 돌려준다", () => {
    const src = 읽기("engine/agentloop.ts");
    expect(src, "수거 래퍼가 사라지면 도구가 보고해도 위로 안 올라간다")
      .toContain("const r = await 근거를수거하며(그릇, () => runAgentLoopCore(instruction, context, scope));");
    expect(src, "수거한 값을 결과에 얹는 자리")
      .toMatch(/return \{ \.\.\.r, sources, 근거세기, \.\.\.\(quotes\?\.length \? \{ quotes \} : \{\}\) \};/);
    // 감싸는 자리는 **하나**여야 한다 — 갈래마다 붙이면 반드시 하나를 빠뜨린다(그 함수 머리글)
    expect((src.match(/근거를수거하며\(/g) ?? []).length, "수거 래퍼가 여러 곳에 생겼다").toBe(1);
  });

  it("★★ 가운데 고리 ② — dispatcher가 루프의 근거를 **결과에 싣는다**", () => {
    const src = 읽기("engine/dispatcher.ts");
    expect(src, "싣는 자리가 사라지면 배지가 옛 상태(sources=null)로 조용히 돌아간다")
      .toContain("...(loop.sources ? { sources: loop.sources } : {}),");
    expect(src, "quotes까지 함께 실어야 담당자가 원문을 눈으로 검증한다")
      .toContain("...(loop.quotes?.length ? { quotes: loop.quotes } : {}),");
  });

  // ★★ 2026-09-08 검토관 [중] — 「같은 세 칸을 같은 값으로」는 **값 계산까지** 같아야 한다.
  //   재검색 블록에는 「답이 스스로 없다고 말하면 강함→약함」(없다는답인가)이 붙어 있는데,
  //   새 생산자는 답이 쓰이기 전에 근거세기를 확정하고 sources를 실어 그 블록을 통째로 건너뛴다.
  //   그대로 두면 explain이 조각을 가깝게 잡고 모델이 「사내 자료에 없습니다」로 답할 때
  //   **전에는 배지가 없던 자리에 초록 「📄 근거」가 새로 뜬다**(2026-08-13 4-ⓑ ISMS 사고와 같은 꼴).
  it("★★ 강등 규칙도 함께 온다 — 「없다」는 답에 초록 배지를 새로 만들지 않는다", async () => {
    const { 근거재검색대상인가, 없다는답인가 } = await import("../src/engine/dispatcher");
    const 없다는답 = "금융 취약점 평가기준 항목은 사내 지식 베이스에 포함되어 있지 않습니다.";
    // 전제 — 이 경로는 재검색 블록(강등이 사는 곳)에 **원리상 못 간다**
    expect(없다는답인가(없다는답)).toBe(true);
    expect(
      근거재검색대상인가({ steps: [], toolCalls: [{ tool: "explain", args: {}, result: "" }], output: 없다는답, sources: ["GIJO_지식_금융_취약점_평가기준.md"] } as never, "금융 취약점 평가기준 항목 알려줘"),
      "sources가 실리면 재검색 블록은 건너뛴다 — 강등이 거기 있으면 안 돈다",
    ).toBe(false);
    // 그래서 **싣는 자리**에서 같은 함수로 강등한다(소스 감시 — 실행 경로가 LLM에 묶여 있어 여기가 유일한 자)
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    expect(src, "루프 경로에 강등이 빠지면 「없습니다」에 초록 「📄 근거」가 뜬다")
      .toContain('근거세기: loop.근거세기 === "강함" && 없다는답인가(String(loop.output ?? "")) ? "약함" : loop.근거세기');
  });
});

// ── ★ 반쪽 수리 방어 — 문서로 보내 놓고 문서를 안 읽히면 소용없다 ──────────────
describe("★ 제목으로 집은 물음도 **발췌가 앞줄**이다", () => {
  it("온톨로지가 발췌를 앞지르지 않는다 — 7B는 앞줄을 답으로 삼는다", async () => {
    const { runExplain } = await import("../src/engine/agenttools/handlers");
    // 「금융 취약점 평가기준 항목 알려줘」는 유형어가 없어 문서지목질문이 **원리상 false**다.
    // 라우팅만 고치고 이 순서를 안 고치면, explain에 와서도 온톨로지를 앞줄로 받는다.
    const out = await runExplain({ topic: "금융 취약점 평가기준 항목 알려줘" });
    const 발췌 = out.indexOf("사내 문서 근거(발췌)");
    const 온톨 = out.indexOf("사내 온톨로지 관계");
    expect(발췌, "발췌가 없다").toBeGreaterThanOrEqual(0);
    if (온톨 >= 0) expect(발췌, "온톨로지가 발췌보다 앞이면 문서를 안 읽힌 것이다").toBeLessThan(온톨);
  });

  // ⚠ 위 실행 검사는 시험 DB의 온톨로지가 비면 **조용히 아무것도 안 잰다**(온톨 < 0).
  //   그래서 순서를 정하는 **잣대 자체**를 소스로 함께 문다 — 둘 중 하나만으로는 헛초록이 난다.
  it("문서우선 판정이 제목 지목을 함께 본다 — 잣대가 빠지면 여기가 빨개진다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agenttools", "handlers.ts"), "utf8");
    expect(src, "문서우선이 옛 잣대(문서지목질문)만 보면 유형어 없는 제목은 온톨로지를 앞줄로 받는다")
      .toContain("const 문서우선 = 문서지목질문(topic) || 지목.size > 0;");
  });
});
