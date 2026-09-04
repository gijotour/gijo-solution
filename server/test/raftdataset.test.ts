// RAFT 데이터 경로 — **배운 자리와 쓰는 자리가 같은가** (증류 사다리 ②, 계획서 §12).
//
// 이 파일이 지키는 것은 하나다: **학습 때 모델이 본 근거 꼴 = 추론 때 모델이 보는 근거 꼴**.
// 이 둘이 갈라져도 아무 오류가 안 난다 — 데이터셋은 만들어지고 학습도 끝나고 게이트도 돈다.
// 다만 모델이 못 보던 틀 앞에서 배운 것을 못 꺼낼 뿐이라, **숫자로만** 나쁘게 나오고 원인은 안 보인다.
// 그래서 문구·조립 꼴·조각 자르는 규칙을 전부 여기서 못 박는다.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ragBlock, RAG_BLOCK_HEADER } from "../src/engine/llm";
import {
  refParse, 허용목록읽기, 허용안되는이유, 라이선스판정기, 방해조각고르기, 섞기, 참고자료블록, 토큰추정, chunk,
  시험문항목록, 행만들기,
  결정값, 거절답, 인용있나, 인용떼기, 인용붙이기, 문장들, 긴형식경로, 긴형식읽기, 구성비, 사전검사, 절수,
} from "../../tools/build-raft-dataset.mjs";
// 정본 판정기(사다리 ④갈래). 이름이 겹치므로 사다리 쪽에 딱지를 붙여 부른다 — 어느 잣대로 쟀는지가 늘 보이게.
import { 허용인가, 허용목록읽기 as 사다리허용목록읽기 } from "../../tools/ladder/ladderlib.mjs";

const 루트 = path.join(__dirname, "..", "..");
const src = (rel: string) => fs.readFileSync(path.join(루트, rel), "utf8");

describe("★ 참고 자료 블록은 한 곳에서만 정한다", () => {
  it("머리말이 예전 문구 그대로다 — 바꾸면 이미 구운 어댑터의 학습 꼴과 갈라진다", () => {
    // ⚠ 이 값은 추출 **전** llm.ts:201에 인라인으로 있던 문자열 그대로다. 함수로 빼면서
    //   한 글자라도 달라졌다면 그날부터 제품의 근거 머리말이 바뀐 것이다(시험·프롬프트 누출 탐지가 이 문구를 본다).
    expect(RAG_BLOCK_HEADER).toBe(
      "참고 자료 — 사내 지식 베이스(장기 기억)에서 검색된 관련 내용입니다. 질문과 관련된 내용이면 네 사전지식과 다르더라도 이 자료를 우선 근거로 삼아 답하고, 질문과 무관하면 무시하세요."
    );
  });

  it("조각은 1부터 번호를 매겨 줄바꿈으로 잇는다", () => {
    expect(ragBlock(["가", "나"])).toBe(RAG_BLOCK_HEADER + "\n[1] 가\n[2] 나");
  });

  it("누출 탐지 표식이 이 머리말을 여전히 가리킨다", () => {
    // llm.ts SCAFFOLD_MARKERS는 답변에 머리말이 그대로 옮겨졌는지 본다 — 머리말을 바꾸면 그 탐지가 눈이 먼다.
    const code = src("server/src/engine/llm.ts");
    const i = code.indexOf("const SCAFFOLD_MARKERS");
    expect(i, "SCAFFOLD_MARKERS를 못 찾았다").toBeGreaterThan(-1);
    const 표식줄 = code.slice(i, i + 300);
    const 앞머리 = RAG_BLOCK_HEADER.slice(0, "참고 자료 — 사내 지식 베이스".length);
    expect(표식줄).toContain(앞머리);
  });

  it("★ 조립을 하는 곳이 하나뿐이다 — 인라인 문구가 남아 있으면 두 곳이 어긋난다", () => {
    const code = src("server/src/engine/llm.ts");
    // 머리말 문자열이 소스에 나타나는 자리는 상수 정의 한 곳뿐이어야 한다(SCAFFOLD_MARKERS는 앞부분만 쓴다).
    const 등장 = code.split(RAG_BLOCK_HEADER).length - 1;
    expect(등장, "머리말이 두 곳 이상에 적혀 있다 — 한쪽만 고치면 조용히 갈라진다").toBe(1);
    // 그리고 실제 주입부는 ragBlock()을 부른다.
    expect(code).toMatch(/parts\.push\(ragBlock\(chunks\)\)/);
  });
});

describe("★ 빌더가 만든 근거 꼴 = 서버가 만드는 근거 꼴", () => {
  it("빌더의 참고자료블록과 서버의 ragBlock이 같은 글을 낸다", () => {
    const 조각 = ["접속기록은 1년 이상 보관합니다", "방화벽 점검은 월 1회입니다"];
    expect(참고자료블록(RAG_BLOCK_HEADER, 조각)).toBe(ragBlock(조각));
  });

  it("창구가 주는 예시(ragBlockSample)와도 맞는다 — 빌더가 실행 중에 스스로 대조하는 그 값", () => {
    // 라우트는 ragBlock(["<조각 본문>"])을 예시로 준다. 빌더는 이것과 자기 조립을 비교해 다르면 멈춘다.
    expect(참고자료블록(RAG_BLOCK_HEADER, ["<조각 본문>"])).toBe(ragBlock(["<조각 본문>"]));
    const code = src("tools/build-raft-dataset.mjs");
    expect(code, "빌더가 조립 꼴 대조를 안 하면 어긋나도 아무도 모른다").toContain("ragBlockSample");
  });
});

describe("★★ 근거 되찾기 규칙이 증류기와 같은가 — 다르면 회수율이 조용히 0이 된다", () => {
  /** 소스에서 `function chunk(` 블록을 중괄호 균형으로 떼어 낸다(internalprompt.test의 chatCalls와 같은 수법). */
  function chunk본문(code: string): string {
    const i = code.indexOf("function chunk(");
    expect(i, "chunk() 함수를 못 찾았다 — 이 감시가 헛돈다").toBeGreaterThan(-1);
    const s = code.indexOf("{", i);
    let depth = 0, end = s;
    for (; end < code.length; end++) {
      if (code[end] === "{") depth++;
      else if (code[end] === "}") { depth--; if (depth === 0) break; }
    }
    return code.slice(s, end + 1).replace(/\s+/g, " ").trim();
  }

  it("빌더의 chunk()가 tools/distill.mjs의 chunk()와 글자 그대로 같다", () => {
    // 파일 근거의 ref는 distill.mjs가 자른 조각의 sha12다. 자르는 규칙이 어긋나면 해시가 안 맞아
    // **오류 없이** 「못 찾음」으로 새고, 회수율만 떨어진다. 두 곳을 같은 커밋에서 함께 고치라는 계약.
    expect(chunk본문(src("tools/build-raft-dataset.mjs"))).toBe(chunk본문(src("tools/distill.mjs")));
  });

  it("자른 조각이 실제로 같은 해시를 만든다 — 규칙 대조만으로는 부족하다", () => {
    const 글 = Array.from({ length: 12 }, (_, i) => `문단 ${i} — ` + "접속기록은 1년 이상 보관합니다. ".repeat(12)).join("\n\n");
    const 조각들 = chunk(글) as string[];
    expect(조각들.length, "고정 입력에서 조각이 안 나왔다 — 시험이 헛돈다").toBeGreaterThan(1);
    // 200자(공백 제외) 미만은 버린다 — 증류기와 같은 잣대.
    for (const c of 조각들) expect(c.replace(/\s/g, "").length).toBeGreaterThanOrEqual(200);
  });
});

describe("근거 주소(ref) 읽기 — 두 꼴뿐이다", () => {
  it("store: 접두는 지식 저장소 문서, 나머지는 저장소 파일 경로", () => {
    expect(refParse("store:GIJO_AS_사용자_매뉴얼.md#0123456789ab")).toMatchObject({ kind: "store", id: "GIJO_AS_사용자_매뉴얼.md" });
    expect(refParse("knowledge/kev.md#0123456789ab")).toMatchObject({ kind: "file", id: "knowledge/kev.md" });
  });

  it("documentId 안의 ':'는 건드리지 않는다 — 맨 앞 접두만 뗀다", () => {
    // personal:… 같은 id가 실제로 있다. 콜론으로 통째로 쪼개면 문서를 못 찾는다.
    expect(refParse("store:personal:u1:메모.md#0123456789ab")).toMatchObject({ kind: "store", id: "personal:u1:메모.md" });
  });

  it("꼬리 해시가 없으면 근거로 안 본다", () => {
    expect(refParse("knowledge/kev.md")).toBeNull();
    expect(refParse("#0123456789ab")).toBeNull();
    expect(refParse("")).toBeNull();
  });
});

describe("★ 라이선스 허용목록 — 애매하면 안 넣는다(fail-closed)", () => {
  const 목록 = 허용목록읽기(루트);

  it("매니페스트를 실제로 읽었다 — 0건이면 이 관문이 헛돈다", () => {
    expect(목록.매니페스트.size).toBeGreaterThan(0);
  });

  it("매니페스트 문서·GIJO_* 우리 글·knowledge/는 통과한다", () => {
    const 첫문서 = JSON.parse(src("server/docs-manifest.json")).files[0].file as string;
    expect(허용안되는이유(path.basename(첫문서), 목록)).toBeNull();
    expect(허용안되는이유("GIJO_AS_취약점관리_지침.md", 목록)).toBeNull();
    expect(허용안되는이유("knowledge/무엇이든.md", 목록)).toBeNull();
  });

  it("★ 그 밖은 전부 막는다 — 타사 문서를 외운 어댑터는 인용이 아니라 재배포다", () => {
    expect(허용안되는이유("타사_상용_운영가이드.pdf", 목록)).toBeTruthy();
    expect(허용안되는이유("어느공공기관_발간물_2024.pdf", 목록)).toBeTruthy();
    expect(허용안되는이유("", 목록)).toBeTruthy();
  });

  it("사다리 허용목록 파일이 없어도 돈다 — ④갈래가 만들기 전이라도 매니페스트+GIJO_*로 판정한다", () => {
    const 빈곳 = 허용목록읽기(path.join(루트, "이런폴더는없다"));
    expect(빈곳.사다리파일있음).toBe(false);
    expect(허용안되는이유("GIJO_AS_사용자_매뉴얼.md", 빈곳), "우리 글은 매니페스트 없이도 통과해야 한다").toBeNull();
    expect(허용안되는이유("타사_가이드.pdf", 빈곳)).toBeTruthy();
  });

  // [2026-09-03 합치기] ④갈래가 실제로 만든 allowed-sources.json은 **규칙 목록**(`{허용:[{kind,…}]}`)이다.
  //   내장 대비책은 그 규칙을 해석 못 하므로 **정본보다 좁다** — 공개 원천·사다리 재료는 여기서 막힌다.
  //   좁은 쪽으로 틀리는 것이 맞다(fail-closed). 이 시험은 「넓은 척」이 되살아나면 걸린다.
  it("★ 내장 대비책은 사다리 규칙을 해석하지 않는다 — 공개 원천은 정본(ladderlib)에서만 통과한다", () => {
    expect(목록.사다리파일있음, "④갈래가 이미 만들었다").toBe(true);
    expect(허용안되는이유("server/data/ladder/material/day1/kev/kev-01.md", 목록), "내장은 좁다").toBeTruthy();
    const 정본 = 허용인가("server/data/ladder/material/day1/kev/kev-01.md", 사다리허용목록읽기(), {
      매니페스트파일들: [],
    });
    expect(정본.허용, "정본에서는 통과해야 한다 — 여기서 막히면 1일차가 통째로 죽는다").toBe(true);
  });

  // ★ 정본은 사다리(④갈래)의 ladderlib이다 — 판정을 두 곳에 적으면 한쪽이 조용히 느슨해진다.
  it("★ 사다리 판정기가 있으면 그것을 쓴다(내장 규칙이 아니라)", async () => {
    const 있나 = fs.existsSync(path.join(루트, "tools", "ladder", "ladderlib.mjs"));
    const 판정기 = (await 라이선스판정기(루트)) as { 출처: string; 판정: (s: string) => string | null };
    if (있나) {
      expect(판정기.출처, "사다리가 있는데 내장 규칙으로 판정하고 있다").toContain("ladderlib");
      // 그쪽 판정기는 store: 접두·#해시 꼬리·'..' 경로까지 함께 본다 — 내장에는 없는 방어다.
      expect(판정기.판정("store:GIJO_AS_사용자_매뉴얼.md#0123456789ab")).toBeNull();
      expect(판정기.판정("knowledge/../운영DB.sqlite")).toBeTruthy();
    }
    // 어느 쪽이든 「우리 글은 통과 · 타사는 차단」은 같아야 한다.
    expect(판정기.판정("GIJO_AS_취약점관리_지침.md")).toBeNull();
    expect(판정기.판정("타사_상용_운영가이드.pdf")).toBeTruthy();
  });

  it("사다리가 없는 곳에서는 내장 규칙으로 떨어진다 — 빌더가 죽지 않는다", async () => {
    const 판정기 = (await 라이선스판정기(path.join(루트, "이런폴더는없다"))) as { 출처: string; 판정: (s: string) => string | null };
    expect(판정기.출처).toContain("내장");
    expect(판정기.판정("GIJO_AS_사용자_매뉴얼.md")).toBeNull();
    expect(판정기.판정("타사_가이드.pdf")).toBeTruthy();
  });
});

describe("방해 조각 — 「그럴듯하지만 답이 아닌」 것만", () => {
  const 정답 = { ref: "store:A.md#aaaaaaaaaaaa", text: "정답 본문", 문서: "A.md", category: "취약점" };
  const 후보 = [
    { ref: "store:A.md#bbbbbbbbbbbb", text: "같은 문서의 이웃 조각", 문서: "A.md", category: "취약점" },
    { ref: "store:B.md#cccccccccccc", text: "다른 문서 · 같은 영역 1", 문서: "B.md", category: "취약점" },
    { ref: "store:C.md#dddddddddddd", text: "다른 문서 · 같은 영역 2", 문서: "C.md", category: "취약점" },
    { ref: "store:D.md#eeeeeeeeeeee", text: "다른 영역", 문서: "D.md", category: "사내규정" },
    { ref: "store:E.md#ffffffffffff", text: "정답 본문", 문서: "E.md", category: "취약점" },
  ];

  it("같은 문서·다른 영역·같은 본문은 안 고른다", () => {
    const 고른것 = 방해조각고르기(정답, 후보, 3, "씨") as { 문서: string; text: string }[];
    expect(고른것.map((c) => c.문서).sort()).toEqual(["B.md", "C.md"]);
  });

  it("개수 0이면 아무것도 안 고른다(방해 없는 판을 만들 수 있어야 A/B가 된다)", () => {
    expect(방해조각고르기(정답, 후보, 0, "씨")).toHaveLength(0);
  });

  it("★ 결정적이다 — 같은 입력이면 같은 데이터셋이라야 지문이 뜻을 갖는다", () => {
    const a = (방해조각고르기(정답, 후보, 1, "씨") as { ref: string }[]).map((c) => c.ref);
    const b = (방해조각고르기(정답, 후보, 1, "씨") as { ref: string }[]).map((c) => c.ref);
    const c = (방해조각고르기(정답, 후보, 1, "다른씨") as { ref: string }[]).map((c) => c.ref);
    expect(a).toEqual(b);
    expect(a.length).toBe(1);
    expect(c.length).toBe(1); // 씨앗이 다르면 다른 것을 고를 수 있다(고정은 안 한다 — 후보가 둘뿐이라 같을 수도 있다)
  });

  it("섞기도 결정적이다 — 정답이 늘 [1]이면 「맨 앞이 정답」을 배운다", () => {
    const 항목 = ["가", "나", "다", "라"];
    expect(섞기(항목, "s")).toEqual(섞기(항목, "s"));
    expect([...(섞기(항목, "s") as string[])].sort()).toEqual([...항목].sort());
  });
});

// ── 빌더의 심장: 승인 문답 + 근거 색인 → 학습 행 ────────────────────────────────
//
// ⚠ 서버가 있어야만 도는 코드로 두면 **배포 전에는 아무도 못 잰다.** 순수 함수로 떼어 여기서 잰다.
describe("★★ 행 만들기 — 회수·라이선스·시험 문항·방해가 실제로 걸리는가", () => {
  const 조각 = (문서: string, 본문: string, category: string | null = "취약점") => ({
    ref: `store:${문서}#${"0".repeat(11)}${문서.length % 10}`, text: 본문, 문서, category,
  });
  const 정답조각 = 조각("GIJO_AS_취약점관리_지침.md", "KEV는 실제 악용이 확인된 취약점 목록입니다");
  const 방해조각 = 조각("GIJO_AS_보안담당자_실무매뉴얼.md", "EPSS는 악용 가능성 점수입니다");
  const 타사조각 = 조각("Tenable_User_Guide.pdf", "타사 상용 문서의 문장입니다");
  const 색인 = new Map([정답조각, 방해조각, 타사조각].map((c) => [c.ref, c]));
  const 판정 = (문서: string) => (/^GIJO_/.test(문서) ? null : "허용목록 밖");
  const 기본 = { 판정, system: "너는 보안 분석가다", ragHeader: RAG_BLOCK_HEADER, distractors: 1, 씨앗: "s", 시험: new Set<string>() };
  const 문답 = (id: string, q: string, cites: string[]) => ({ id, question: q, answer: "근거를 인용한 답입니다", cites });

  it("★ 정상 행 — 근거는 system에, 질문은 원질문 그대로", () => {
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인, 기본) as {
      rows: { question: string; answer: string; system: string }[]; 통계: Record<string, never>;
    };
    expect(rows).toHaveLength(1);
    expect(rows[0].question, "질문에 맥락을 붙이면 위생의 시험 문항 대조가 헛돈다").toBe("KEV가 뭔가요");
    // 팀원 프롬프트 + 빈 줄 둘 + 참고 자료 블록 — 제품 systemContent의 join("\n\n")과 같은 꼴.
    expect(rows[0].system.startsWith("너는 보안 분석가다\n\n" + RAG_BLOCK_HEADER)).toBe(true);
    expect(rows[0].system).toContain(정답조각.text);
    expect(rows[0].system, "방해 조각이 안 들어갔다 — 「참고 자료는 다 맞다」를 가르치게 된다").toContain(방해조각.text);
    expect((통계 as unknown as { 회수: { store: number } }).회수.store).toBe(1);
  });

  it("회수 실패는 숫자로 남는다 — 문서가 재인입되면 해시가 안 맞는다", () => {
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", ["store:GIJO_AS_취약점관리_지침.md#ffffffffffff"])], 색인, 기본) as {
      rows: unknown[]; 통계: { 회수: { 실패: number }; 회수실패상세: Record<string, number>; 제외: Record<string, number> };
    };
    expect(rows).toHaveLength(0);
    expect(통계.회수.실패).toBe(1);
    expect(통계.회수실패상세["GIJO_AS_취약점관리_지침.md"]).toBe(1);
    expect(통계.제외["회수 실패"]).toBe(1);
  });

  it("★ 라이선스에 걸린 근거가 하나라도 있으면 **행 전체**를 버린다", () => {
    // 막힌 조각만 빼면 「출처 없이 남의 문장을 외운 행」이 된다 — 막으려던 것이 그대로 남는다.
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref, 타사조각.ref])], 색인, 기본) as {
      rows: unknown[]; 통계: { 제외: Record<string, number>; 라이선스제외: { 행: number; 문서별: Record<string, number> } };
    };
    expect(rows).toHaveLength(0);
    expect(통계.제외["라이선스"]).toBe(1);
    expect(통계.라이선스제외.문서별["Tenable_User_Guide.pdf"]).toBe(1);
  });

  it("시험 문항은 사전검사에서 뺀다(최종 관문은 서버지만 숫자를 맞춘다)", () => {
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인, {
      ...기본, 시험: new Set(["KEV가뭔가요"]),
    }) as { rows: unknown[]; 통계: { 제외: Record<string, number> } };
    expect(rows).toHaveLength(0);
    expect(통계.제외["시험 문항(사전검사)"]).toBe(1);
  });

  it("★ 방해를 넣기로 했는데 못 넣으면 그 행은 안 만든다", () => {
    // 방해 없는 행이 섞이면 그 행들이 「참고 자료는 다 맞다」를 도로 가르친다.
    const 혼자 = new Map([[정답조각.ref, 정답조각]]);
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 혼자, 기본) as {
      rows: unknown[]; 통계: { 제외: Record<string, number> };
    };
    expect(rows).toHaveLength(0);
    expect(통계.제외["방해 조각 없음"]).toBe(1);
    // distractors=0이면 같은 재료로도 행이 만들어진다(A/B 판을 만들 수 있어야 한다).
    const b = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 혼자, { ...기본, distractors: 0 }) as { rows: unknown[] };
    expect(b.rows).toHaveLength(1);
  });

  it("근거가 없는 문답은 세고 넘긴다", () => {
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [])], 색인, 기본) as {
      rows: unknown[]; 통계: { 제외: Record<string, number> };
    };
    expect(rows).toHaveLength(0);
    expect(통계.제외["근거 없음"]).toBe(1);
  });

  it("★ 결정적이다 — 같은 입력이면 같은 행(지문이 뜻을 가지려면)", () => {
    const 입력 = [문답("a", "KEV가 뭔가요", [정답조각.ref])];
    const a = 행만들기(입력, 색인, 기본) as { rows: { system: string }[] };
    const b = 행만들기(입력, 색인, 기본) as { rows: { system: string }[] };
    expect(a.rows[0].system).toBe(b.rows[0].system);
  });
});

// ── 2회전 판 짜기(2026-09-04) — 「모른다」·폐쇄형·인용 규칙·긴 형식 ────────────────────────────
//
// 1회전(raft-vuln-v1) 실측이 이 시험들의 출처다: 1,297행 전부가 A갈래(P=100%)였고, 「모른다」 시연 행이
// 0이었으며, 답의 53.7%가 「원문: "…"」을 달았는데 그 인용의 98%가 영문이었다. 어댑터는 그 **꼴만** 배워
// 근거가 없을 때도 인용을 지어냈다. 아래는 그 넷이 다시 생기면 걸리게 만든 그물이다.
describe("★★ 거절 문구는 제품이 시키는 그 문장이다", () => {
  it("빌더의 거절답이 llm.ts 원문과 글자 단위로 같다", () => {
    // 타입이 다른 두 파일이라 import로 공유가 안 된다 — 복제하되 **여기서 감시**한다.
    // 이 시험이 깨지면 둘 중 하나가 먼저 바뀐 것이다. 배우는 문구와 제품이 내는 문구가 갈리면
    // 어댑터는 제품이 쓰지 않는 말을 배우고, 그 차이는 어디서도 오류를 안 낸다.
    const llm = src("server/src/engine/llm.ts");
    expect(llm, "제품이 내는 「자료 없음」 답이 바뀌었다 — 빌더의 거절답도 함께 고칠 것").toContain(거절답);
    // 팀원 프롬프트 규칙(llm.ts:254)도 같은 문장을 시킨다 — 둘 중 하나만 바뀌어도 잡는다.
    expect(llm).toContain("등록된 사내 자료에는 관련 내용이 없습니다");
    expect(거절답).not.toMatch(/원문\s*[:：]/); // 거절 답에 인용이 붙으면 그게 곧 지어낸 인용이다
  });
});

describe("★ 갈래 고르기는 결정적이다 — 같은 씨앗이면 같은 판", () => {
  it("결정값은 [0,1) 범위이고 같은 키면 같은 값이다", () => {
    const v = 결정값("씨|oracle|a1") as number;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
    expect(결정값("씨|oracle|a1")).toBe(v);
    expect(결정값("씨|oracle|a2")).not.toBe(v); // 문답이 다르면 다른 자리에 떨어진다
  });

  it("★ p-oracle 1.0은 「지금과 한 글자도 다르지 않다」 — 전부 정답을 싣는다", () => {
    // 이 값이 깨지면 1회전 데이터셋을 다시 못 만든다(A/B 비교의 바닥이 사라진다).
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(결정값("씨|oracle|" + id) as number, `${id}가 1.0 밖에 떨어졌다`).toBeLessThan(1);
    }
  });
});

describe("★★ 인용 꼬리표 — 실물 두 꼴을 다 잡는다(raft-vuln-v1 1,297행 실측)", () => {
  const 맨꼴 = '사용자가 파일을 직접 열어야 합니다. 원문: "Exploitation requires user interaction."';
  const 괄호꼴 = '최신 빌드로 올리세요. 「원문: "(Windows) before build 6.2.23089.203."」 해당 시스템은 조치가 필요합니다.';

  it("두 꼴 다 인용으로 본다 — 끝에만 있는 게 아니다(괄호 꼴은 문장 중간이 더 많았다)", () => {
    expect(인용있나(맨꼴)).toBe(true);
    expect(인용있나(괄호꼴)).toBe(true);
    expect(인용있나("근거를 인용한 답입니다"), "인용이 없는 답을 있다고 보면 안 된다").toBe(false);
    expect(인용있나("AI 답변에는 근거(참고한 문서·원문 대목)를 붙입니다"), "「원문 대목」은 인용이 아니다").toBe(false);
  });

  it("떼면 인용이 사라지고 나머지 글은 남는다", () => {
    expect(인용있나(인용떼기(맨꼴))).toBe(false);
    expect(인용떼기(맨꼴)).toBe("사용자가 파일을 직접 열어야 합니다.");
    expect(인용있나(인용떼기(괄호꼴))).toBe(false);
    expect(인용떼기(괄호꼴)).toBe("최신 빌드로 올리세요. 해당 시스템은 조치가 필요합니다.");
  });
});

describe("★★ 인용 규칙 strict — 근거에서 뽑은 문장만 붙인다", () => {
  const 한글문장 = "KEV 목록에 오른 취약점은 실제 악용이 확인된 것이므로 다른 취약점보다 먼저 조치해야 합니다.";
  const 영문문장 = "Exploitation of this issue requires user interaction in that a victim must open a malicious file and then follow the prompts.";

  it("답과 20자 이상 겹치는 문장을 근거에서 찾아 붙인다", () => {
    const 답 = `${한글문장} 담당자는 기한 안에 조치를 마쳐야 합니다.`;
    const r = 인용붙이기(답, [`${한글문장} 조치 기한은 별도로 정합니다.`]) as { answer: string; 붙임: boolean };
    expect(r.붙임).toBe(true);
    expect(인용있나(r.answer)).toBe(true);
    expect(r.answer).toContain(`원문: "${한글문장}"`);
  });

  it("★ 한글 문장이 있으면 그것을 인용한다 — 영문만 인용하던 습관을 끊는다", () => {
    // 영문 문장이 **더 길다**(길이순 고르기라면 영문이 이긴다). 그래도 한글이 나와야 규칙이 사는 것이다.
    // ⚠ 조각 전체의 한글 비율로 재면 안 된다 — 이 근거의 한글 비율은 0.25다(한글 설명 + 영문 원문이
    //   한 조각에 섞인 실제 꼴). 비율로 걸렀다면 「한국어 근거」인데도 영문이 뽑혔다.
    const 근거 = `${한글문장}\n${영문문장}`;
    expect(영문문장.length, "영문이 더 길어야 이 시험이 뜻을 갖는다").toBeGreaterThan(한글문장.length);
    const 답 = `${한글문장} ${영문문장}`;
    const r = 인용붙이기(답, [근거]) as { answer: string };
    expect(r.answer).toContain(`원문: "${한글문장}"`);
    expect(r.answer).not.toContain(영문문장.slice(0, 40) + '"');
  });

  it("영문뿐인 근거는 영문을 인용한다 — 없는 한글을 지어내는 것이 더 나쁘다", () => {
    const 답 = `사용자 상호작용이 필요합니다. ${영문문장}`;
    const r = 인용붙이기(답, [영문문장]) as { answer: string };
    expect(r.answer).toContain(`원문: "${영문문장}"`);
  });

  it("이미 인용이 있으면 손대지 않는다(두 번 붙이면 인용 안에 인용이 든다)", () => {
    const 답 = '사용자 상호작용이 필요합니다. 원문: "requires user interaction"';
    const r = 인용붙이기(답, [한글문장]) as { answer: string; 붙임: boolean };
    expect(r.붙임).toBe(false);
    expect(r.answer).toBe(답);
  });

  it("★ 겹치는 문장이 없으면 붙이지 않고 사유를 돌려준다 — 근거 없는 인용을 만들지 않는다", () => {
    const r = 인용붙이기("전혀 다른 주제로만 서술한 답변 문장입니다.", [한글문장]) as { answer: string | null; 왜: string };
    expect(r.answer).toBeNull();
    expect(r.왜).toContain("20자 겹침");
  });

  it("따옴표가 든 문장은 인용으로 안 고른다 — 되짚어 뗄 수 없는 꼬리가 된다", () => {
    const 따옴표문장 = '설정값이 "사용 안 함"이면 양호로 판정하며 그 밖에는 취약으로 봅니다.';
    const 답 = `${따옴표문장} 담당자는 이 기준을 그대로 적용합니다.`;
    const r = 인용붙이기(답, [따옴표문장]) as { answer: string | null };
    expect(r.answer, "따옴표가 든 문장을 고르면 인용 정규식이 중간에서 잘린다").toBeNull();
  });

  it("문장 쪼개기는 25자 미만 토막을 버린다(짧으면 20자 창이 어긋난다)", () => {
    expect(문장들("짧다. 아주 짧다.")).toEqual([]);
    expect((문장들(한글문장) as string[])[0]).toBe(한글문장);
  });
});

describe("★★ 행 만들기 2회전 갈래 — A / B / B′ / C", () => {
  const 긴본문 = (앞: string) => `${앞} 이 대목은 근거 조각의 본문이며 담당자가 확인해야 하는 내용을 담고 있습니다.`;
  const 조각 = (문서: string, 본문: string) => ({
    ref: `store:${문서}#${"0".repeat(11)}${문서.length % 10}`, text: 본문, 문서, category: "취약점",
  });
  const 정답조각 = 조각("GIJO_AS_취약점관리_지침.md", 긴본문("KEV 목록에 오른 취약점은 실제 악용이 확인된 것입니다."));
  const 방해1 = 조각("GIJO_AS_보안담당자_실무매뉴얼.md", 긴본문("EPSS는 악용 가능성 점수입니다."));
  const 방해2 = 조각("GIJO_AS_사용자_매뉴얼.md", 긴본문("CVSS는 심각도 점수 체계입니다."));
  const 색인 = new Map([정답조각, 방해1, 방해2].map((c) => [c.ref, c]));
  const 판정 = (문서: string) => (/^GIJO_/.test(문서) ? null : "허용목록 밖");
  const 기본 = { 판정, system: "너는 보안 분석가다", ragHeader: RAG_BLOCK_HEADER, distractors: 1, 씨앗: "s", 시험: new Set<string>() };
  const 문답 = (id: string, q: string, cites: string[], answer = "근거를 인용한 답입니다") => ({ id, question: q, answer, cites });
  type 결과 = { rows: { question: string; answer: string; system: string }[]; 종류들: string[]; 통계: { 제외: Record<string, number> } };

  it("★ p-oracle 1.0(기본)은 전부 A — 1회전과 같은 판이다", () => {
    const 입력 = [문답("a", "KEV가 뭔가요", [정답조각.ref]), 문답("b", "EPSS가 뭔가요", [정답조각.ref])];
    const 기본판 = 행만들기(입력, 색인, 기본) as 결과;
    const 명시판 = 행만들기(입력, 색인, { ...기본, pOracle: 1 }) as 결과;
    expect(기본판.종류들).toEqual(["A", "A"]);
    expect(명시판.rows, "인자를 명시해도 같은 판이라야 「기본 = 지금과 동일」이 성립한다").toEqual(기본판.rows);
    // rows는 저장 창구로 그대로 나가는 몸이다 — 스키마에 없는 칸이 끼면 안 된다.
    expect(Object.keys(기본판.rows[0]).sort()).toEqual(["answer", "question", "system"]);
  });

  it("★★ p-oracle 0이면 전부 B — 정답 문서가 통째로 빠지고 답은 제품의 거절 문구다", () => {
    const { rows, 종류들 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인, { ...기본, pOracle: 0 }) as 결과;
    expect(종류들).toEqual(["B"]);
    expect(rows[0].answer, "정답만 빼고 원래 답을 두면 「근거에 없는 말을 지어내라」를 가르친다").toBe(거절답);
    expect(rows[0].system).toContain(RAG_BLOCK_HEADER); // 참고 자료는 **있다**(방해만 들었다)
    expect(rows[0].system, "정답 조각이 남아 있으면 거절이 거짓말이 된다").not.toContain(정답조각.text);
    // 방해는 distractors+1 = 2개 — 블록이 얇아지면 「자료가 적어서 모른다」를 배운다.
    expect(rows[0].system).toContain(방해1.text);
    expect(rows[0].system).toContain(방해2.text);
  });

  it("★ 같은 씨앗이면 같은 갈래로 갈린다(재현 없이는 A/B가 성립 안 한다)", () => {
    const 입력 = Array.from({ length: 40 }, (_, i) => 문답(`id${i}`, `질문 ${i}`, [정답조각.ref]));
    const a = 행만들기(입력, 색인, { ...기본, pOracle: 0.5 }) as 결과;
    const b = 행만들기(입력, 색인, { ...기본, pOracle: 0.5 }) as 결과;
    expect(a.종류들).toEqual(b.종류들);
    expect(a.종류들.filter((k) => k === "A").length, "0.5인데 한쪽으로 쏠렸다").toBeGreaterThan(5);
    expect(a.종류들.filter((k) => k === "B").length).toBeGreaterThan(5);
  });

  it("★ --noevidence-from-uncited — 근거 없는 문답이 「참고 자료 없는」 거절 행이 된다", () => {
    const 입력 = [문답("a", "우리 회사 방침이 뭔가요", [])];
    const 끈판 = 행만들기(입력, 색인, 기본) as 결과;
    expect(끈판.rows).toHaveLength(0);
    expect(끈판.통계.제외["근거 없음"]).toBe(1);

    const { rows, 종류들, 통계 } = 행만들기(입력, 색인, { ...기본, noEvidenceFromUncited: true }) as 결과;
    expect(종류들).toEqual(["B2"]);
    expect(통계.제외["근거 없음"]).toBe(0);
    expect(rows[0].answer).toBe(거절답);
    // ⚠ 제품 llm.ts가 rag=null일 때 만드는 system과 **글자 단위로 같아야** 한다(팀원 프롬프트 하나뿐).
    expect(rows[0].system).toBe("너는 보안 분석가다");
    expect(rows[0].system).not.toContain(RAG_BLOCK_HEADER);
  });

  it("★ --closedbook-ratio 1 — 블록 없이 원래 답, 인용 꼬리는 뗀다", () => {
    const 답 = '사용자가 파일을 직접 열어야 합니다. 원문: "requires user interaction"';
    const { rows, 종류들 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref], 답)], 색인, {
      ...기본, closedbookRatio: 1,
    }) as 결과;
    expect(종류들).toEqual(["C"]);
    expect(rows[0].system).not.toContain(RAG_BLOCK_HEADER);
    expect(rows[0].answer).toBe("사용자가 파일을 직접 열어야 합니다.");
    expect(인용있나(rows[0].answer), "근거를 안 줬는데 인용이 남으면 그게 곧 지어낸 인용이다").toBe(false);
  });

  it("★ 라이선스는 갈래보다 먼저 본다 — 막힌 문답이 B·C로 되살아나지 않는다", () => {
    const 타사 = 조각("Tenable_User_Guide.pdf", 긴본문("타사 상용 문서의 문장입니다."));
    const 색인2 = new Map([...색인, [타사.ref, 타사]]);
    for (const 옵션 of [{ pOracle: 0 }, { closedbookRatio: 1 }, {}]) {
      const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [타사.ref])], 색인2, { ...기본, ...옵션 }) as 결과;
      expect(rows, `${JSON.stringify(옵션)}에서 막힌 문답이 살아났다`).toHaveLength(0);
      expect(통계.제외["라이선스"]).toBe(1);
    }
  });

  it("★ quote-rule strict — A행은 근거에서 뽑은 인용이 붙고, 못 붙이면 행이 빠진다", () => {
    const 겹치는답 = `${정답조각.text} 담당자는 이 기준으로 판단합니다.`;
    const 붙음 = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref], 겹치는답)], 색인, {
      ...기본, quoteRule: "strict",
    }) as 결과;
    expect(붙음.종류들).toEqual(["A"]);
    expect(인용있나(붙음.rows[0].answer)).toBe(true);

    const 안겹침 = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref], "완전히 다른 주제만 말하는 답변입니다.")], 색인, {
      ...기본, quoteRule: "strict",
    }) as 결과;
    expect(안겹침.rows).toHaveLength(0);
    expect(안겹침.통계.제외["인용 없음(strict)"]).toBe(1);
  });

  it("★ strict에서도 비A행에는 인용이 안 붙는다 — 「원문:」 0%가 이 판의 계약이다", () => {
    const 입력 = [
      문답("a", "질문1", [정답조각.ref], '설명입니다. 원문: "quoted"'),
      문답("b", "질문2", []),
    ];
    const { rows, 종류들 } = 행만들기(입력, 색인, {
      ...기본, pOracle: 0, closedbookRatio: 0, noEvidenceFromUncited: true, quoteRule: "strict",
    }) as 결과;
    expect(종류들.sort()).toEqual(["B", "B2"]);
    for (const r of rows) expect(인용있나(r.answer), `비A행에 인용이 남았다: ${r.answer}`).toBe(false);
  });

  it("방해가 허용목록 밖에서 왔으면 숫자로 드러낸다(막지는 않는다 — 1회전 판을 조용히 안 바꾼다)", () => {
    // 2026-09-04 실측: 라이선스 판정은 **정답 조각에만** 걸린다. 방해는 안 거친다 — 실제로 v1 데이터셋의
    // 방해 자리에 Tenable 사용자 가이드 본문이 실려 있었다. 이 시험은 그 사실을 숫자로 붙잡아 둔다.
    const 타사 = 조각("Tenable_User_Guide.pdf", 긴본문("타사 상용 문서의 문장입니다."));
    const 색인2 = new Map([[정답조각.ref, 정답조각], [타사.ref, 타사]]);
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인2, 기본) as
      결과 & { 통계: { 방해라이선스노출: { 행: number; 문서별: Record<string, number> } } };
    expect(rows).toHaveLength(1);
    expect(통계.방해라이선스노출.행).toBe(1);
    expect(통계.방해라이선스노출.문서별["Tenable_User_Guide.pdf"]).toBe(1);
  });
});

describe("★ 긴 형식 재료 — 없으면 조용히 0건이 아니라 실패", () => {
  it("데이터셋 id는 서버 데이터 폴더로, 경로는 그 경로로 푼다", () => {
    expect(긴형식경로("longform-v1", 루트)).toBe(path.join(루트, "server", "data", "datasets", "longform-v1.json"));
    expect(긴형식경로("tools/x/y.json", 루트)).toBe(path.resolve(루트, "tools/x/y.json"));
    expect(긴형식경로("", 루트)).toBeNull();
  });

  it("★ 파일이 없으면 던진다 — 「섞었다」고 믿은 채 안 섞이는 것이 제일 나쁘다", () => {
    expect(() => 긴형식읽기("이런데이터셋은없다", 루트)).toThrow(/파일이 없습니다/);
  });

  it("배열도 {examples:[…]} 도 읽는다 · 빈 파일은 던진다", () => {
    const dir = path.join(루트, "server", "data", "datasets");
    fs.mkdirSync(dir, { recursive: true });
    const id = `vitest-longform-${Date.now().toString(36)}`;
    const p = path.join(dir, `${id}.json`);
    try {
      fs.writeFileSync(p, JSON.stringify({ examples: [{ question: "q", answer: "a" }] }), "utf8");
      expect(긴형식읽기(id, 루트)).toHaveLength(1);
      fs.writeFileSync(p, JSON.stringify([]), "utf8");
      expect(() => 긴형식읽기(id, 루트)).toThrow(/행이 없습니다/);
    } finally {
      fs.rmSync(p, { force: true });
    }
  });
});

describe("★★ 구성비·사전검사 — 판이 스스로를 배반하지 않는가", () => {
  const 행 = (answer: string) => ({ question: "q", answer, system: "s" });

  it("갈래별 행 수와 비율, 「원문:」 비율(A행·비A행)을 따로 센다", () => {
    const rows = [행('설명. 원문: "가나다"'), 행("설명만"), 행(거절답), 행("폐쇄형 답")];
    const 종류들 = ["A", "A", "B", "C"];
    const c = 구성비(rows, 종류들) as {
      표: Record<string, { 행: number; 비율: number }>;
      인용: { A행: { 행: number; 인용: number; 비율: number }; 비A행: { 행: number; 인용: number } };
      답길이: { p50: number; max: number }; 절3이상: number;
    };
    expect(c.표.A.행).toBe(2);
    expect(c.표.B.행).toBe(1);
    expect(c.표.C.행).toBe(1);
    expect(c.표.A.비율).toBe(0.5);
    expect(c.인용.A행).toMatchObject({ 행: 2, 인용: 1, 비율: 0.5 });
    expect(c.인용.비A행).toMatchObject({ 행: 2, 인용: 0 });
    expect(c.답길이.max).toBeGreaterThan(0);
  });

  it("★ 비A행에 「원문:」이 하나라도 있으면 실패다(1회전 결함을 그대로 가르치는 판)", () => {
    const c = 구성비([행(거절답 + ' 원문: "지어낸 인용"')], ["B"]);
    const r = 사전검사(c) as { 통과: boolean; 실패: string[] };
    expect(r.통과).toBe(false);
    expect(r.실패[0]).toContain("원문");
  });

  it("A행의 「원문:」이 95% 미만이면 경고한다(실패는 아니다)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => 행(i === 0 ? '설명. 원문: "가나다"' : "설명만"));
    const r = 사전검사(구성비(rows, rows.map(() => "A"))) as { 통과: boolean; 경고: string[] };
    expect(r.통과).toBe(true);
    expect(r.경고[0]).toContain("95%");
  });

  it("절 세기는 1회전 실측에 쓴 규칙과 같다(## · 1) · ①)", () => {
    expect(절수("## 가\n## 나\n## 다")).toBe(3);
    expect(절수("1) 가\n2) 나")).toBe(2);
    expect(절수("그냥 산문입니다.")).toBe(0);
  });
});

describe("토큰 추정 — 실측(800자 ≈ 504토큰) 기준", () => {
  it("800자면 504토큰 언저리다", () => {
    expect(토큰추정("가".repeat(800))).toBe(504);
  });
  it("빈 값은 0", () => {
    expect(토큰추정("")).toBe(0);
  });
});

describe("시험 문항 사전검사 — 목록을 베끼지 않고 파일에서 읽는다", () => {
  it("문항을 실제로 읽었다 — 0건이면 사전검사가 헛돈다", () => {
    expect((시험문항목록(루트) as Set<string>).size).toBeGreaterThan(0);
  });
});

// ── 학습 스크립트가 근거 칸을 실제로 읽는가 (진짜 파이썬) ────────────────────────────
//
// ⚠ **있는 파이썬을 찾아서 돌린다.** `python` 하나만 보고 없으면 건너뛰게 두면, 운영 환경(WSL —
//   python3만 있다)에서 이 시험이 늘 조용히 skip된다. 초록은 뜨는데 아무것도 증명하지 않는 그 상태다.
function 파이썬찾기(): string | null {
  for (const c of [process.env.GIJO_TEST_PYTHON, "python3", "python"]) {
    if (c && spawnSync(c, ["--version"]).status === 0) return c;
  }
  return null;
}
const PY = 파이썬찾기();

describe.runIf(PY)("★ 학습 스크립트가 행마다의 근거(system)를 읽는다", () => {
  const id = `vitest-raft-${Date.now().toString(36)}`;
  const 데이터셋 = path.join("data", "datasets", `${id}.json`);
  const 산출 = path.join("data", "lora", `vitest-raft-${Date.now().toString(36)}`);

  it("스모크가 per-row system이 실린 행 수를 세어 말한다", () => {
    fs.mkdirSync("data/datasets", { recursive: true });
    fs.writeFileSync(
      데이터셋,
      JSON.stringify([
        { question: "접속기록 보관 기간은?", answer: "1년 이상입니다", system: "참고 자료\n[1] 1년 이상 보관" },
        { question: "방화벽 점검 주기는?", answer: "월 1회입니다" },
      ]),
      "utf-8"
    );
    try {
      // 제품 경로가 실제로 넘기는 인자 그대로 부른다 — --max-seq 오타 하나면 모든 학습이 argparse에서 죽는다.
      const r = spawnSync(PY!, ["scripts/finetune_qlora14b.py", "--dataset", id, "--output", 산출, "--max-seq", "3072", "--smoke"], {
        encoding: "utf-8",
        env: { ...process.env, PYTHONUTF8: "1" },
      });
      expect(r.status, `스크립트가 죽었다: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("행 2 · 근거(system) 실린 행 1");
      expect(r.stdout).toContain("max_seq=3072");
      // 진행률 계약(화면 막대가 이 꼴만 읽는다)은 그대로여야 한다.
      expect(r.stdout).toMatch(/step 1\/10 loss=/);
    } finally {
      fs.rmSync(데이터셋, { force: true });
      fs.rmSync(산출, { recursive: true, force: true });
    }
  });

  // [2026-09-04 · 2회전] 새 인자 셋. 이름이 틀리면 argparse가 **학습 시작 전에** 죽는데,
  //   그 죽음을 사람이 보는 건 몇 시간짜리 작업을 걸어 놓은 다음이다(1회전 warmup_ratio 사고 계보).
  it("★ --save-epochs · --eval-holdout · --lora-alpha-mult 를 받아들이고 로그에 찍는다", () => {
    fs.mkdirSync("data/datasets", { recursive: true });
    fs.writeFileSync(
      데이터셋,
      JSON.stringify([
        { question: "접속기록 보관 기간은?", answer: "1년 이상입니다", system: "참고 자료\n[1] 1년 이상 보관" },
        { question: "방화벽 점검 주기는?", answer: "월 1회입니다" },
      ]),
      "utf-8"
    );
    try {
      const r = spawnSync(
        PY!,
        ["scripts/finetune_qlora14b.py", "--dataset", id, "--output", 산출, "--max-seq", "3072",
          "--smoke", "--save-epochs", "--eval-holdout", "5", "--lora-alpha-mult", "1.5"],
        { encoding: "utf-8", env: { ...process.env, PYTHONUTF8: "1" } }
      );
      expect(r.status, `스크립트가 죽었다: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("save_epochs=1 · eval_holdout=5 · lora_alpha_mult=1.5");
      // ★ 평가 줄은 화면 파서의 정규식에 **걸리면 안 된다** — 걸리면 진행률 막대가 평가 손실로 튄다.
      const 평가줄 = r.stdout.split("\n").filter((l) => l.includes("eval_loss"));
      expect(평가줄.length, "eval_loss 줄이 안 나왔다").toBeGreaterThan(0);
      for (const l of 평가줄) expect(/step\s+(\d+)\/(\d+)\s+loss=([\d.]+)/.test(l), `파서에 걸린다: ${l}`).toBe(false);
      expect(r.stdout).toMatch(/step 1\/10 loss=/); // 기존 계약은 그대로
    } finally {
      fs.rmSync(데이터셋, { force: true });
      fs.rmSync(산출, { recursive: true, force: true });
    }
  });
});

// ── 창구가 실제로 막는가 (진짜 HTTP) ────────────────────────────────────────────
//
// ⚠ 소스 감시만으로는 부족하다. 미들웨어를 달아 놓고도 라우트 등록 순서·경로 오타로 안 걸리는 일이
//   이 저장소에서 실제로 있었다. **서버가 거절하는지**를 요청으로 잰다.
describe("★ RAFT 재료 창구는 관리자만 연다", () => {
  it("무인증 401 · 담당자 403 · 관리자 200", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("../src/app");
    const app = createApp();

    // ① 무인증
    expect((await request(app).get("/api/learnloop/approved")).status).toBe(401);
    expect((await request(app).get("/api/learnloop/raft/prompt?agentId=normaltic")).status).toBe(401);

    // ② 담당자(security_officer) — 승인 문답 통째 반출·내부 프롬프트 원문은 담당자 몫이 아니다.
    const { createUser, findUserByUsername, deleteUser } = await import("../src/auth/users");
    const uname = "raft-officer";
    if (findUserByUsername(uname)) deleteUser(findUserByUsername(uname)!.id);
    createUser({ username: uname, password: "officerPw12345", displayName: "RAFT 시험 담당자", role: "security_officer" });
    const 담당 = await request(app).post("/api/auth/login").send({ username: uname, password: "officerPw12345", force: true });
    const officer = { Authorization: `Bearer ${담당.body.accessToken as string}` };
    expect((await request(app).get("/api/learnloop/approved").set(officer)).status).toBe(403);
    expect((await request(app).get("/api/learnloop/raft/prompt?agentId=normaltic").set(officer)).status).toBe(403);

    // ③ 관리자 — 실제로 쓸 수 있어야 한다(너무 좁히는 것도 결함이다).
    const 관리 = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme", force: true });
    const admin = { Authorization: `Bearer ${관리.body.accessToken as string}` };
    const 승인 = await request(app).get("/api/learnloop/approved?limit=5").set(admin);
    expect(승인.status).toBe(200);
    expect(Array.isArray(승인.body.logs), "logs 배열을 안 준다 — 빌더가 읽을 것이 없다").toBe(true);
    expect(승인.body).toHaveProperty("상한도달"); // 조용히 잘리면 「이게 전부」로 읽힌다

    const 프롬 = await request(app).get("/api/learnloop/raft/prompt?agentId=normaltic").set(admin);
    expect(프롬.status).toBe(200);
    expect(프롬.body.ragHeader).toBe(RAG_BLOCK_HEADER);
    expect(프롬.body.ragBlockSample).toBe(ragBlock(["<조각 본문>"]));
    expect(String(프롬.body.system).length, "팀원 system 프롬프트가 비었다").toBeGreaterThan(20);

    // 잘못 부르면 말해 준다(조용한 빈 답 금지).
    expect((await request(app).get("/api/learnloop/raft/prompt").set(admin)).status).toBe(400);
    expect((await request(app).get("/api/learnloop/approved?topic=없는주제").set(admin)).status).toBe(400);

    if (findUserByUsername(uname)) deleteUser(findUserByUsername(uname)!.id);
  });
});

describe("★ 창구·저장 관문 (소스 감시)", () => {
  const learnloop = src("server/src/engine/learnloop.ts");

  it("RAFT 재료 창구 둘 다 adminMiddleware를 단다", () => {
    // 승인 문답 반출·내부 프롬프트 반출 — 담당자 화면에 실릴 값이 아니다.
    expect(learnloop).toMatch(/"\/api\/learnloop\/approved",\s*authMiddleware,\s*adminMiddleware/);
    expect(learnloop).toMatch(/"\/api\/learnloop\/raft\/prompt",\s*authMiddleware,\s*adminMiddleware/);
  });

  it("승인 창구가 cites를 실어 보낸다 — 빌더가 이걸로 근거를 되찾는다", () => {
    // logFromRow가 cites를 채운다(learnloop.ts) — 매핑을 안 하면 SELECT *로 값이 와도 API에 안 실린다.
    expect(learnloop).toMatch(/rows\.map\(logFromRow\)/);
    expect(learnloop).toMatch(/cites: parseCites\(r\.cites\)/);
  });

  it("★ 빌더는 만든 행을 파일로 안 떨군다 — 손에 쥐면 위생 관문을 건너뛰게 된다", () => {
    // 2026-09-03 실측: gb10 수동 경로가 관문을 건너뛰어 평가 게이트 문항 4건이 학습에 섞였다.
    const code = src("tools/build-raft-dataset.mjs");
    const 쓰기 = [...code.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
    expect(쓰기, "보고서 말고 다른 것을 쓰고 있다 — 행 파일이 생기면 위생을 건너뛰는 길이 열린다").toEqual(["out"]);
    expect(code).toContain("build-report.json");
    // 저장은 오직 창구로. 종류 「근거」를 명시해야 system 칸이 살아남는다.
    expect(code).toMatch(/\/api\/dataset\/save[\s\S]{0,400}kind: "근거"/);
  });

  it("데이터셋 저장 창구가 종류를 받는다 — 안 받으면 근거 칸이 말없이 버려진다", () => {
    const dataset = src("server/src/engine/dataset.ts");
    expect(dataset).toMatch(/req\.body\?\.kind/);
    expect(dataset).toMatch(/saveDataset\(String\(req\.body\.id \?\? ""\), req\.body\.examples \?\? \[\], kind as 데이터종류\)/);
  });

  it("★ 제품 학습 경로가 --max-seq를 명시한다 — 기본 1024면 RAFT 행이 조용히 버려진다", () => {
    const finetune = src("server/src/engine/finetune.ts");
    expect(finetune).toMatch(/scriptArgs\.push\("--max-seq"/);
    expect(finetune).toContain("GIJO_FINETUNE_MAX_SEQ");
    // 파이썬은 행마다 system을 읽어야 한다(전역 --system은 딱 하나뿐이다).
    const py = src("server/scripts/finetune_qlora14b.py");
    expect(py).toMatch(/def render\(q: str, a: str, system: str = ""\)/);
    expect(py).toMatch(/render\(r\["question"\], r\["answer"\], str\(r\.get\("system"\) or ""\)\)/);
    expect(py).toContain('"content": system or args.system');
  });

  // [2026-09-04 · 2회전] 인자를 만들어 놓고 **안 넘기면** 기본값으로 조용히 돈다 — 이 저장소가 반복해
  //   겪은 「만들어 놓고 안 쓴다」의 그 자리다. main()이 실제로 넘기는지 소스로 못 박는다.
  it("★ main()이 새 판 짜기 인자를 실제로 행만들기에 넘긴다", () => {
    const code = src("tools/build-raft-dataset.mjs");
    for (const k of ["--p-oracle", "--closedbook-ratio", "--noevidence-from-uncited", "--quote-rule", "--longform-dataset"]) {
      expect(code, `${k}를 읽는 곳이 없다`).toContain(k);
    }
    expect(code).toMatch(/pOracle: P_ORACLE/);
    expect(code).toMatch(/noEvidenceFromUncited: NOEV/);
    expect(code).toMatch(/closedbookRatio: CLOSEDBOOK/);
    expect(code).toMatch(/quoteRule: QUOTE_RULE/);
    // 사전검사에 걸리면 **저장하지 않는다** — 걸러 놓고 그대로 구우면 관문이 없는 것과 같다.
    expect(code).toMatch(/if \(!보고\.사전검사\.통과\)/);
    // ⚠ 머리 주석에도 창구 이름이 적혀 있다 — **실제 호출부**의 자리를 봐야 한다(주석 자리를 재면 늘 통과한다).
    const 저장호출 = code.indexOf('SERVER + "/api/dataset/save"');
    expect(저장호출, "저장 호출부를 못 찾았다 — 이 감시가 헛돈다").toBeGreaterThan(-1);
    expect(code.indexOf("if (!보고.사전검사.통과)"), "사전검사가 저장보다 뒤에 있으면 이미 저장된 뒤다")
      .toBeLessThan(저장호출);
  });

  it("★ 평가 손실 줄이 화면 진행률 파서에 안 걸린다 — 정규식을 finetune.ts에서 그대로 가져와 잰다", () => {
    // 시험 안에 정규식을 베껴 적으면 제품이 바뀌어도 이 시험은 옛 규칙으로 통과한다. 소스에서 읽는다.
    const finetune = src("server/src/engine/finetune.ts");
    const m = finetune.match(/const match = (\/.+\/)\.exec\(line\)/);
    expect(m, "finetune.ts의 진행률 정규식을 못 찾았다 — 이 감시가 헛돈다").toBeTruthy();
    const 파서 = new RegExp(m![1].slice(1, -1));
    expect(파서.test("step 12/300 loss=0.4210"), "진행률 줄은 여전히 걸려야 한다").toBe(true);
    expect(파서.test("eval 12/300 eval_loss=0.4210"), "평가 줄이 걸리면 막대가 평가 손실로 튄다").toBe(false);
    const py = src("server/scripts/finetune_qlora14b.py");
    expect(py).toContain("--save-epochs");
    expect(py).toContain("--eval-holdout");
    expect(py).toContain("--lora-alpha-mult");
    expect(py, "eval_strategy/evaluation_strategy 둘 다 시도해야 판본이 바뀌어도 안 죽는다").toMatch(
      /for 이름 in \("eval_strategy", "evaluation_strategy"\)/
    );
  });
});
