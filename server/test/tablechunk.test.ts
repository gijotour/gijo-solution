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

/** 한 조각 안의 표 덩어리 중 **구분선이 마지막 줄인 것**(=머리글+구분선만 남고 본문 행이 없는 표)을 센다.
 *  (2026-09-08 검토관 [상]) 반복 제거가 표 본문 행을 지우면 정확히 이 모양이 남는다.
 *  ⚠ 한 덩어리에 표가 둘이면 첫 구분선만 보므로 **적게 셀 수 있다** — 이 시험이 쓰는 하한이다.
 *  ⚠ 아래 머리글잃은표()와 **반대 모양**을 센다. 이름이 한 글자 차이라 주석이 엉뚱한 함수에
 *    붙기 쉽다(실제로 한 번 그랬다 — 2026-09-08 검토관 적발). 고칠 때 짝을 함께 본다. */
function 머리글만든표(조각: string): number {
  const L = 조각.split("\n").map((l) => l.trim());
  let n = 0, 덩어리: string[] = [];
  const 마감 = () => {
    const s = 덩어리.findIndex(구분선);
    if (s >= 1 && 덩어리.length === s + 1) n += 1;
    덩어리 = [];
  };
  for (const l of L) { if (표줄(l)) 덩어리.push(l); else 마감(); }
  마감();
  return n;
}

/** 한 조각 안의 표 덩어리 중 **구분선이 없는 것**(=머리글을 잃은 표)을 센다.
 *  ⓐ3의 원래 증상이 이쪽이다 — 위 머리글만든표()와 헷갈리지 말 것(세는 것이 정반대다). */
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

  it("★ 지움 예외를 **CRLF에서도** 똑같이 준다 — \\r가 붙으면 다른 글자로 세던 자리 (적발①)", () => {
    const 줄 = ["| 항목 | 값 |", "|---|---|", "| 가 | 1 |", "",
      "| 항목 | 값 |", "|---|---|", "| 나 | 2 |", "",
      "| 항목 | 값 |", "|---|---|", "| 다 | 3 |"];
    const 남은 = cleanExtractedText(줄.join("\r\n"));
    expect(남은.split("\n").filter((l) => l.trim() === "| 항목 | 값 |"), "CRLF면 머리글 예외가 안 걸린다").toHaveLength(3);
    expect(남은.split("\n").filter(구분선), "CRLF면 구분선 예외가 안 걸린다").toHaveLength(3);
    expect(남은, "줄바꿈 꼴을 한 벌로 맞추지 않으면 아래 표 인지가 통째로 어긋난다").not.toContain("\r");
  });
});

// ── 검토관(H갈래)이 잡은 자리 — 첫 수리가 놓친 곳 (2026-09-08) ────────────────────
// 셋은 실물·재현으로 확인됐고 하나(두 표)는 오늘 실물에 없는 **잠복**이다.
// 잠복도 시험으로 못박는 이유: 이번 수리가 **새로 만든** 실패 꼴이라, 사용자 업로드 문서가
// 그 모양이면 모델이 「틀린 열 이름」을 자신 있게 읽는다 — 머리글이 없는 것보다 나쁘다.
describe("표 청킹 — 검토관이 잡은 자리", () => {
  it("★★ 줄바꿈이 CRLF여도 조각이 같다 — 윈도우에서 만든 .md가 이 수리를 통째로 비켜 가던 자리 (적발①)", () => {
    for (const f of 대상) {
      const lf원문 = fs.readFileSync(path.join(지식, f), "utf8").replace(/\r\n/g, "\n");
      const lf = chunkText(lf원문);
      const crlf = chunkText(lf원문.replace(/\n/g, "\r\n"));
      const 고아 = (cs: string[]) => cs.reduce((n, c) => n + 머리글잃은표(c).개수, 0);
      expect(고아(crlf), `${f}: CRLF로 주면 머리글 잃은 표 조각이 생긴다 — 겹침 꼬리 보호가 "\n"만 본다`).toBe(0);
      expect(crlf, `${f}: 같은 글인데 줄바꿈 꼴에 따라 조각이 달라진다`).toEqual(lf);
    }
  });

  it("★ 한 블록에 표가 둘이면 **뒤 표에 앞 표의 머리글**을 붙이지 않는다 (적발③ · 잠복)", () => {
    const A머리 = "| 자산 구분 | 담당 부서 | 등급 |";
    const B머리 = "| 취약점 코드 | 조치 기한 | 판정 |";
    const 구분3 = "|---|---|---|";
    const 줄 = ["## 한 문단 안에 표가 둘", A머리, 구분3];
    for (let i = 1; i <= 12; i += 1) 줄.push(`| 자산-${i} | 정보보호팀 | 중요도 ${i}등급으로 관리한다 |`);
    줄.push(B머리, 구분3);
    for (let i = 1; i <= 12; i += 1) 줄.push(`| CVE-2026-10${i} | 30일 이내 | 조치 후 재검증이 필요하다 |`);

    const 조각 = chunkText(줄.join("\n"));
    expect(조각.length, "한 조각에 다 들어가면 이 시험은 아무것도 못 잰다 — 재료가 짧아졌다").toBeGreaterThan(1);
    const 잘못: string[] = [];
    for (const c of 조각) {
      const L = c.split("\n");
      for (let i = 1; i < L.length - 1; i += 1) {
        if (!구분선(L[i]) || !표줄(L[i - 1])) continue;
        const 머리 = L[i - 1].trim();
        for (let j = i + 1; j < L.length && 표줄(L[j]); j += 1) {
          const t = L[j].trim();
          if (구분선(t) || t === A머리 || t === B머리) break; // 새 표가 시작됐다
          const 제머리 = t.includes("CVE-") ? B머리 : A머리;
          if (머리 !== 제머리) 잘못.push(`「${머리}」 아래에 「${t.slice(0, 26)}…」`);
        }
      }
    }
    expect(잘못, "틀린 머리글이 붙으면 모델은 **자신 있게 틀린 열**로 읽는다").toEqual([]);
  });

  it("★ 머리글만 든 조각을 만들지 않는다 · 넘침은 머리글 값까지 (적발④)", () => {
    const 머리 = "| 점검 항목 | 판정 기준 | 담당 |";
    const 구분3 = "|---|---|---|";
    const 머리값 = 머리.length + 구분3.length + 2;
    const 줄 = ["## 좁은 예산", 머리, 구분3];
    // 한 행이 예산의 대부분을 먹게 만든다 — 「제목+머리글+구분선」만 남고 행이 다음 조각으로
    // 밀리는 자리가 여기서 열린다(칸 안의 「…적는다. 」는 문장 경계 오분할 함정도 함께 잰다).
    for (let i = 1; i <= 20; i += 1) 줄.push(`| 항목 ${i} | ${"판정 기준을 길게 적는다. ".repeat(11)} | 정보보호팀 |`);
    const doc = 줄.join("\n");

    for (const [size, overlap] of [[200, 40], [300, 50], [800, 100]] as const) {
      for (const c of chunkText(doc, size, overlap)) {
        const 본문행 = c.split("\n").filter((l) => 표줄(l) && !구분선(l) && l.trim() !== 머리);
        expect(본문행.length, `size=${size}: **머리글만 든 조각**이 생겼다 — 신고된 증상 그 자체다\n「${c.slice(0, 80)}」`).toBeGreaterThan(0);
        // 머리글 재부착은 예산을 그만큼 넘길 수 있다(한 행이 size에 가까우면 피할 수 없다).
        // 넘김을 **머리글 값까지**로 못박는다 — 그보다 넘으면 다른 데서 새는 것이다.
        expect(c.length, `size=${size}: 조각이 size+overlap+머리글(${size + overlap + 머리값})을 넘었다`)
          .toBeLessThanOrEqual(size + overlap + 머리값);
      }
    }
  });
});

// ── 표 본문 행이 반복 제거에 지워지던 자리 (2026-09-08 검토관 [상] · 실행 재현) ─────────
// ■ 무엇이 났나
//   추출기가 워드·pptx 표를 **파이프 표로** 내기 시작하자(dataset.ts) 표 본문 행이 60자 이하의
//   짧은 줄이 됐다. 그러자 cleanExtractedText의 「3회 이상 반복되는 짧은 줄은 지운다」가
//   **표 본문 행**을 지운다 — 예외가 구분선과 표 머리글까지뿐이었기 때문이다. 남는 것은
//   「머리글+구분선만 있고 행이 하나도 없는 표」로, 이 라운드가 없애려던 증상 그 자체다.
//   ⚠ 표를 한 줄 덩어리로 내던 종전에는 60자를 넘겨 원리상 안 걸리던 갈래다 — **추출기 변경이
//     새로 연 노출**이라 위 시험이 하나도 안 걸렸다(전부 초록이었다).
// ■ 예외를 어디까지 넓히나 — 「머리글+구분선으로 시작한 표 덩어리 안의 표줄」까지다.
//   **글자가 아니라 자리로** 센다. 글자로 예외를 주면 같은 글자가 딴 데서 바닥글일 때 그것까지
//   함께 살아난다(KISA 가이드의 「| 한국인터넷진흥원 |」 429줄이 그 모양이다).
describe("cleanExtractedText — 표 본문 행은 반복돼도 지우지 않는다 (검토관 [상])", () => {
  const 표 = ["| 점검 항목 | 판정 |", "| --- | --- |", "| 방화벽 정책 | 양호 |", "| 백신 설치 | 미흡 |"];

  it("★★ 같은 점검표가 3벌 든 문서에서 **본문 행이 살아 있다** (①)", () => {
    const doc = ["## 1장", ...표, "", "## 2장", ...표, "", "## 3장", ...표].join("\n");
    const 남은 = cleanExtractedText(doc);
    expect(남은.split("\n").filter((l) => l.trim() === "| 방화벽 정책 | 양호 |"),
      "표 본문 행이 「반복 머리글」로 지워졌다 — 머리글+구분선만 남은 표가 된다").toHaveLength(3);
    expect(남은.split("\n").filter((l) => l.trim() === "| 백신 설치 | 미흡 |")).toHaveLength(3);
    // 조각까지 가서도 살아 있어야 뜻이 있다 — 지식에 들어가는 것은 조각이다.
    const 조각 = chunkText(doc);
    expect(조각.join("\n"), "조각에 본문 행이 한 줄도 없다").toContain("방화벽 정책");
    expect(조각.reduce((n, c) => n + 머리글만든표(c), 0), "머리글만 든 표 조각이 생겼다").toBe(0);
  });

  it("★★ 반증 — 앞에 머리글·구분선이 없는 **홑 파이프 줄**은 여전히 지운다 (② KISA 429줄 꼴)", () => {
    // 진짜 표가 0개인 문서의 바닥글 모양. 「표줄이면 무조건 예외」로 넓히면 이것이 되살아난다.
    const doc: string[] = [];
    for (let i = 1; i <= 5; i += 1) doc.push(`## ${i}절`, "본문 문장입니다.", "| 한국인터넷진흥원 |", "");
    const 남은 = cleanExtractedText(doc.join("\n"));
    expect(남은.split("\n").filter((l) => l.trim() === "| 한국인터넷진흥원 |"),
      "홑 파이프 바닥글까지 살아났다 — 검색 상위를 잡음이 차지한다").toHaveLength(0);
  });

  it("★ 회귀 — 표가 **아닌** 반복 짧은 줄은 종전대로 지운다 (③ · GSTS pptx 슬라이드 범례 꼴)", () => {
    // 실물: GSTS_AICC_PoC_제안요약_v0.5.pptx의 판정 범례가 슬라이드 3장에 똑같이 붙어 있다(실측).
    // 표 밖의 줄이라 구조로는 페이지 바닥글과 구별할 수 없다 — 예외를 여기까지 넓히면
    // 「청크 앞머리를 잡음이 차지한다」는 이 규칙의 존재 이유가 통째로 풀린다.
    const 범례 = "충족 제품 보유 · 수행 PoC 기간 · 조건부 실측으로 확정";
    const 쪽바닥 = "GS텔레서비스 AICC PoC 제안";
    const doc: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      doc.push(`## 요구사항 대응 (${i}/3)`, "| ID | 요구 | 판정 |", "| --- | --- | --- |",
        `| DSR-0${i} | 추적성 | 충족 |`, "", 범례, "", 쪽바닥, "");
    }
    const 남은 = cleanExtractedText(doc.join("\n"));
    expect(남은.split("\n").filter((l) => l.trim() === 범례), "표 밖 반복 줄까지 살아났다").toHaveLength(0);
    expect(남은.split("\n").filter((l) => l.trim() === 쪽바닥), "쪽 바닥글이 살아났다").toHaveLength(0);
    // 표 본문 행은 쪽마다 달라 원래도 안 지워진다 — 이 시험이 ①과 섞이지 않게 못박는다.
    expect(남은, "회귀 시험 재료가 표 본문까지 지우고 있다").toContain("| DSR-01 | 추적성 | 충족 |");
  });

  // ── 잠복 봉쇄 — 「표 안이면 무조건 살린다」가 열어 두던 뒷문 (2026-09-08 검토관 2차 적발) ──
  //   앞 실행자가 open_issues에 「나타나면 그때 좁힌다」로 적어 둔 갈래인데, 재현해 보니
  //   **지금도 3줄 중 3줄이 살아남았다.** 「실물에 아직 그 모양이 없다」가 유일한 방어였다는 뜻이라
  //   좁혀서 못박는다(구분선과 열 수가 같은 줄까지만 표 본문으로 본다).
  it("★★ 반복 바닥글이 표 본문 행에 **빈 줄 없이 이어 붙어도** 지운다 (2차 적발)", () => {
    const doc: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      doc.push(`## ${i}장`, "| 점검 항목 | 판정 |", "| --- | --- |", "| 방화벽 정책 | 양호 |", "| 한국인터넷진흥원 |", "");
    }
    const 남은 = cleanExtractedText(doc.join("\n")).split("\n").map((l) => l.trim());
    expect(남은.filter((l) => l === "| 한국인터넷진흥원 |"),
      "표 바로 뒤에 붙은 반복 바닥글이 「표 안」으로 보여 살아났다 — 잡음이 조각에 들어간다").toHaveLength(0);
    // ⚠ 같은 손질이 **본문 행까지** 죽이면 이 라운드가 원점이다. 열 수가 맞는 행은 그대로 산다.
    expect(남은.filter((l) => l === "| 방화벽 정책 | 양호 |"),
      "바닥글을 잡으려다 표 본문 행까지 죽었다").toHaveLength(3);
  });

  it("★ 거울상 — 바닥글이 표 머리글 **위**에 붙어도 지운다(붙는 방향으로 답이 갈리지 않는다)", () => {
    const doc: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      doc.push(`## ${i}장`, "| 한국인터넷진흥원 |", "| 점검 항목 | 판정 |", "| --- | --- |", `| 방화벽 정책 ${i} | 양호 |`, "");
    }
    const 남은 = cleanExtractedText(doc.join("\n")).split("\n").map((l) => l.trim());
    expect(남은.filter((l) => l === "| 한국인터넷진흥원 |")).toHaveLength(0);
  });

  it("★ 받아들인 손해 — 구분선과 **열 수가 다른** 반복 행은 표 안이어도 지운다", () => {
    // 추출기가 내는 표는 한 표의 모든 행이 같은 열 수다(dataset.ts 파이프표). 그래서 열 수로
    // 가르는 것이 값이 싸고 정확하다. 대신 **손으로 쓴 .md에서 꼬리 파이프를 빠뜨린 행**이
    // 3벌 넘게 반복되면 종전처럼 지워진다 — 매니페스트 35편 실측 0줄이라 받아들인 손해다.
    // 넓히고 싶어지면 위 두 시험이 무엇을 막고 있는지부터 볼 것.
    const doc: string[] = [];
    for (let i = 1; i <= 3; i += 1) doc.push(`## ${i}장`, "| 점검 항목 | 판정 |", "| --- | --- |", "| 꼬리 파이프 없음 | 양호", "");
    const 남은 = cleanExtractedText(doc.join("\n")).split("\n").map((l) => l.trim());
    expect(남은.filter((l) => l === "| 꼬리 파이프 없음 | 양호"),
      "열 수가 다른 행이 살아났다 — 그러면 인접 바닥글도 함께 살아난다(짝 규칙이다)").toHaveLength(0);
  });

  // ⚠ **이 시험은 이 라운드의 결함을 못 잡는다.** 수리를 통째로 빼도 초록이다(실측: 예외를
  //   되돌리면 ①과 지문 감시만 빨개진다). 매니페스트 35편·지식 24편에는 「같은 표가 3벌」이
  //   없어 증상이 원리상 안 난다 — 실물에 안 나는 결함을 실물로 재려 한 자리였다.
  //   그러면 왜 남기나: **코퍼스가 바뀌는 날**(문서를 새로 넣거나 추출기를 고치는 날)
  //   표가 무너지는지 보는 잣대이기 때문이다. 결함을 지키는 것은 ①·2차 적발 시험이다.
  it("★ 코퍼스 현황 — 지식 24편에 무너진 표 조각이 0이다 (결함 잣대가 아니라 현황 잣대)", () => {
    const 파일들 = fs.readdirSync(지식).filter((f) => f.endsWith(".md"));
    expect(파일들.length, "지식 문서를 못 읽었다 — 시험 재료가 사라졌다").toBeGreaterThanOrEqual(20);
    let 조각수 = 0, 고아 = 0, 고아줄 = 0, 머리글만 = 0;
    const 나쁜: string[] = [];
    for (const f of 파일들) {
      for (const c of chunkText(fs.readFileSync(path.join(지식, f), "utf8"))) {
        조각수 += 1;
        const r = 머리글잃은표(c);
        고아 += r.개수; 고아줄 += r.줄수;
        const h = 머리글만든표(c);
        머리글만 += h;
        if (r.개수 > 0 || h > 0) 나쁜.push(`${f}: 고아 ${r.개수} · 머리글만 ${h}`);
      }
    }
    console.log(`[지식전편] 문서 ${파일들.length}편 · 조각 ${조각수} · 머리글 잃은 표 ${고아}(${고아줄}줄) · 머리글만 든 표 ${머리글만}`);
    expect(나쁜, "지식 전편에서 표가 무너진 조각이 나왔다").toEqual([]);
  });
});

// ── 생산자 강제 — 자르는 규칙을 고치면 판을 올려야 한다 (적발⑥) ────────────────────
// 소비자(docsbundle의 hashOf)는 이미 소스 감시가 붙어 있다. 그런데 **판을 올리는 쪽**에는
// 아무 강제가 없어서, 다음 사람이 청커를 고치고 판을 안 올리면 이 기계가 조용히 no-op이 된다
// (=코드는 새것인데 지식은 옛 조각 — 2026-07-31 사고의 재발). 그 자리를 지문으로 막는다.
describe("청커 판 — 규칙을 고치면 CHUNKER_VERSION을 올린다 (소스 감시)", () => {
  const 시작표식 = "// ── 표(마크다운 테이블) 인지";
  const 끝표식 = "/** 글자로 그냥 읽으면 안 되는(추출이 필요한) 형식";
  /** 판 ↔ 그 판이 자르던 규칙의 지문. **둘은 언제나 함께 바뀐다.** */
  const 청커지문: Record<string, string> = {
    "2026-09-08-table-2": "4d7dfbeb4d40", // 표 구분선·머리글 예외까지 (지난 판 — 되돌리면 여기서 걸린다)
    "2026-09-08-table-3": "60ee63f200a7", // + 표 본문 행 예외를 **자리로** (검토관 [상])
    "2026-09-08-table-4": "29f0584db5ab", // + 그 자리를 **구분선과 같은 열 수**까지로 좁힘 (검토관 2차)
  };

  it("★★ chunkText·cleanExtractedText·표 술어의 지문이 지금 판과 짝이다", async () => {
    const { createHash } = await import("crypto");
    const { CHUNKER_VERSION } = await import("../src/engine/memory");
    const src = fs.readFileSync(path.resolve("src/engine/memory.ts"), "utf8");
    const 시작 = src.indexOf(시작표식), 끝 = src.indexOf(끝표식);
    expect(시작, "표식이 사라졌다 — 감시가 헛돈다(지문을 빈 글자로 세고 있었다)").toBeGreaterThan(0);
    expect(끝, "끝 표식이 사라졌다 — 감시 범위가 파일 끝까지 늘어난다").toBeGreaterThan(시작);
    // 주석·이름·들여쓰기는 뺀다 — 「자를 결과가 안 바뀌는 수정에는 판을 올리지 않는다」는
    // 코드 주석과 어긋나지 않게, **알맹이**만 센다.
    const 알맹이 = src.slice(시작, 끝)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:/])\/\/[^\n]*/g, "$1")
      .replace(/\s+/g, " ").trim();
    const 지문 = createHash("sha256").update(알맹이, "utf8").digest("hex").slice(0, 12);
    expect(청커지문[CHUNKER_VERSION],
      `자르는 규칙이 바뀌었는데 판이 그대로다(또는 지문을 안 갱신했다).\n` +
      `  → CHUNKER_VERSION을 올리고 이 표에 「"<새 판>": "${지문}"」를 적어라.\n` +
      `  안 올리면 배포해도 내장 문서가 다시 안 들어가 **고친 청커가 영영 안 돈다.**`).toBe(지문);
  });
});
