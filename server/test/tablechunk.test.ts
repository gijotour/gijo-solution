// test/tablechunk.test.ts — **표(마크다운 테이블)가 조각으로 갈릴 때 열 뜻을 잃지 않는다.**
//
// ■ 증상 (ⓐ3 「표 머리글만 답하는 청킹」, 2026-09-08)
//   한국 점검표 지식 문서(knowledge/*.md)는 표가 많다. 그런데 RAG 조각을 실제로 세어 보니
//   **머리글을 잃은 표 조각**이 나온다 — `| 분석·평가 계획이 글로 있나 | 대상이 해마다 … |` 처럼
//   행만 있고 `| 무엇을 보나 | 왜 | 증적 | 잣대 | 담당 |`이 없어서, 그 조각을 근거로 받은 모델은
//   **어느 칸이 무엇인지 모른다.** 「양호=…」가 무슨 열의 값인지 알 수 없으니 답이 흔들린다.
//
// ■ 두 뿌리 (설계관이 실측으로 갈랐다)
//   ① chunkText가 표 경계를 모른다 — 800자를 넘는 블록을 **줄 단위로** 쪼개면서 머리글과 행이 갈린다.
//      (표 행은 `|`로 끝나 문장 종결이 없으므로 문장 경계 분할이 원리상 안 걸린다)
//   ② cleanExtractedText의 「3회 이상 반복되는 짧은 줄」 제거가 **표 구분선(`|---|---|`)을 지운다.**
//      실측: ISMS-P·가명정보_처리·침해사고_대응절차 3편에서 9줄. 문서 쪽 규율(「머리글을 절마다
//      다르게 쓴다」)로는 구분선을 피할 수 없다 — 구분선은 열 수가 같으면 반드시 같은 글자다.
//
// ■ 왜 「머리글만 든 조각」이 아니라 이쪽인가
//   머리글만 남은 조각은 실측 0건이다(제목 병합 로직이 이미 막고 있다). 실제로 터진 것은
//   **반대쪽**이라 이 시험은 반대쪽을 잰다. 증상 이름에 끌려 엉뚱한 것을 재면 초록이 거짓이 된다.
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-tablechunk-"));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;

// ⚠ memory는 engine/embedding을 문다 — 목이 실제 import 경로를 따라가야 진짜 임베딩 서버를 안 찾는다.
vi.mock("../src/engine/embedding", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) }));
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  chat: vi.fn(), registerLlmRoutes: vi.fn(),
}));

const { chunkText, cleanExtractedText } = await import("../src/engine/memory");

const 지식 = path.join(__dirname, "../../knowledge");
/** 증상이 신고된 점검표 문서 — 표가 많고 800자를 넘는 표 블록이 있는 것들. */
const 대상 = [
  "GIJO_지식_중소기업_정보보호_점검표.md",
  "GIJO_지식_금융_취약점_평가기준.md",
  "GIJO_지식_금융_AI_보안_가이드라인.md",
  "GIJO_지식_AI시대_소프트웨어_보안점검표.md",
  "GIJO_지식_개인정보_자율점검표.md",
];

// ── 표 인지 — **이 시험이 쓰는 잣대**(제품 잣대는 memory.ts 안에 한 벌로 있다) ──────────
//   ⚠ 일부러 제품 함수를 import하지 않는다. 제품이 자기 잣대로 「표가 안 갈렸다」고 답하면
//     잣대가 틀렸을 때 시험도 함께 틀린다 — 여기서는 마크다운 규격을 그대로 다시 적어 잰다.
const 표줄 = (l: string) => l.trimStart().startsWith("|");
const 구분선 = (l: string) => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l);

/** 한 조각 안의 표 덩어리 중 **구분선이 없는 것**(=머리글을 잃은 표)을 센다. */
function 머리글잃은표(조각: string): { 개수: number; 줄수: number } {
  const lines = 조각.split("\n");
  let 개수 = 0, 줄수 = 0, 덩어리: string[] = [];
  const 마감 = () => {
    if (덩어리.length > 0 && !덩어리.some(구분선)) { 개수 += 1; 줄수 += 덩어리.length; }
    덩어리 = [];
  };
  for (const l of lines) { if (표줄(l)) 덩어리.push(l); else 마감(); }
  마감();
  return { 개수, 줄수 };
}

function 재기(파일: string) {
  const raw = fs.readFileSync(path.join(지식, 파일), "utf8");
  const 조각 = chunkText(raw);
  let 고아 = 0, 고아줄 = 0;
  for (const c of 조각) { const r = 머리글잃은표(c); 고아 += r.개수; 고아줄 += r.줄수; }
  return { 조각수: 조각.length, 고아, 고아줄, 조각 };
}

describe("표 청킹 — 갈려도 머리글을 잃지 않는다 (ⓐ3)", () => {
  it("★★ 지정 5편에 **머리글 잃은 표 조각이 0개**다", () => {
    const 표 = 대상.map((f) => ({ 문서: f, ...재기(f) }));
    const 합 = 표.reduce((a, r) => ({ 조각: a.조각 + r.조각수, 고아: a.고아 + r.고아, 줄: a.줄 + r.고아줄 }), { 조각: 0, 고아: 0, 줄: 0 });
    // 실측 숫자를 남긴다 — 수리 전/후를 나란히 놓고 봐야 「줄었다」가 말이 된다.
    console.log(`[표청킹] 총 조각 ${합.조각} · 머리글 잃은 표 조각 ${합.고아} · 고아 표행 ${합.줄}`);
    for (const r of 표) console.log(`  · ${r.문서}: 조각 ${r.조각수} / 고아 ${r.고아}(${r.고아줄}줄)`);
    expect(합.고아, `머리글 없는 표 조각이 남았다 — 모델이 어느 칸이 무엇인지 모른다`).toBe(0);
  });

  it("★ 머리글을 다시 붙여도 **한 번만** 붙는다 — overlap과 겹쳐 같은 줄이 두 번 들어가지 않는다", () => {
    for (const f of 대상) {
      for (const c of 재기(f).조각) {
        const 표줄들 = c.split("\n").filter(표줄).map((l) => l.trim());
        const 셈 = new Map<string, number>();
        for (const l of 표줄들) 셈.set(l, (셈.get(l) ?? 0) + 1);
        for (const [줄, n] of 셈) {
          if (구분선(줄)) continue; // 한 조각에 표가 둘이면 구분선은 정당하게 두 번 나온다
          expect(n, `${f}: 같은 표 줄이 한 조각에 ${n}번 — 「${줄.slice(0, 40)}…」`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("★ 조각 첫 줄이 **반쪽 표 행**으로 시작하지 않는다 — 겹침 꼬리가 행 한가운데를 자르던 자리", () => {
    for (const f of 대상) {
      for (const c of 재기(f).조각) {
        const 첫줄 = c.split("\n")[0];
        if (!첫줄.includes("|")) continue;
        expect(표줄(첫줄), `${f}: 조각이 반쪽 표 행으로 시작한다 — 「${첫줄.slice(0, 50)}…」`).toBe(true);
      }
    }
  });
});

describe("cleanExtractedText — 반복 제거가 표를 무너뜨리지 않는다 (뿌리 ②)", () => {
  /** 구분선이 3회 이상 반복돼 실제로 지워지고 있던 문서들(2026-09-08 실측). */
  const 구분선피해 = ["GIJO_지식_ISMS-P_인증.md", "GIJO_지식_가명정보_처리.md", "GIJO_지식_침해사고_대응절차.md"];

  it("★★ 표 구분선(|---|---|)은 3회 넘게 반복돼도 지우지 않는다", () => {
    for (const f of 구분선피해) {
      const raw = fs.readFileSync(path.join(지식, f), "utf8");
      const 원본 = raw.split("\n").filter(구분선).length;
      const 남은 = cleanExtractedText(raw).split("\n").filter(구분선).length;
      expect(원본, `${f}에 구분선이 없다 — 시험 재료가 바뀌었다`).toBeGreaterThan(0);
      expect(남은, `${f}: 구분선 ${원본}줄 중 ${남은}줄만 남았다 — 표가 무너진다`).toBe(원본);
    }
  });

  it("★★ 반증 — 표꼴이어도 **머리글이 아닌** 반복 줄은 그대로 지운다(KISA 429줄)", () => {
    // KISA 가이드의 `| 한국인터넷진흥원 |`는 429번 나오는 바닥글 조각이고, 그 문서에 진짜 표는 없다.
    // 「표줄은 전부 예외」로 넓히면 이 429줄이 지식으로 되살아난다 — 예외는 구분선과 진짜 머리글까지다.
    const raw = fs.readFileSync(path.join(지식, "KISA_취약점_분석평가_상세가이드.md"), "utf8");
    const 원본 = raw.split("\n").filter((l) => l.trim() === "| 한국인터넷진흥원 |").length;
    expect(원본).toBeGreaterThan(100);
    const 남은 = cleanExtractedText(raw).split("\n").filter((l) => l.trim() === "| 한국인터넷진흥원 |").length;
    expect(남은, "바닥글 반복 제거가 풀렸다 — 검색 상위를 잡음이 차지한다").toBe(0);
  });

  it("★ 표꼴 반복 줄이라도 **바로 다음 줄이 구분선**이면 머리글이므로 남긴다", () => {
    const doc = ["| 항목 | 값 |", "|---|---|", "| 가 | 1 |", "",
      "| 항목 | 값 |", "|---|---|", "| 나 | 2 |", "",
      "| 항목 | 값 |", "|---|---|", "| 다 | 3 |"].join("\n");
    const 남은 = cleanExtractedText(doc);
    expect(남은.split("\n").filter((l) => l.trim() === "| 항목 | 값 |"), "절마다 반복된 표 머리글이 지워졌다").toHaveLength(3);
    expect(남은.split("\n").filter(구분선)).toHaveLength(3);
  });
});
