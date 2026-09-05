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
import crypto from "node:crypto";
import { ragBlock, RAG_BLOCK_HEADER, systemPromptFor } from "../src/engine/llm";
import {
  refParse, 허용목록읽기, 허용안되는이유, 라이선스판정기, 방해조각고르기, 섞기, 참고자료블록, 토큰추정, chunk,
  시험문항목록, 행만들기,
  결정값, 거절답, 인용있나, 인용흔적있나, 인용떼기, 인용붙이기, 인용근거대조, 문장들, 긴형식경로, 긴형식읽기, 구성비, 사전검사, 절수,
  근거조각뽑기, 근거블록있나, 규격읽기, 예시블록,
  제품인용만들기, 문장경계자르기, 블록번호찾기,
  제품인용맞추기, 인용규칙이름표, 인용규칙칸, 번호참조떼기, 거절답만들기, 일반답머리,
  거절꼴고르기, 번호참조있나, 홀드아웃고르기,
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
    // ★ 2026-09-05 J3 — 조각과 함께 **문서 제목**도 넘긴다(`[n] 《제목》 본문`). 제목을 안 넘기면
    //   프롬프트가 「사례 제목과 출처를 밝히라」고 시켜 놓고 재료를 안 주는 꼴이라, 모델의 제목은
    //   **구조적으로 지어낸 것**이 된다. 이 감시는 「제목을 실제로 넘기는가」까지 본다 —
    //   ragBlock에 옵셔널 인자만 만들어 두고 안 넘기면 아무 오류 없이 옛 동작 그대로이기 때문이다.
    expect(code, "제목을 안 넘긴다 — 블록에 제목이 안 실린다").toMatch(/parts\.push\(ragBlock\(chunks, titles\)\)/);
  });

  it("★★ 제목을 **안 주면** 옛 꼴 그대로 — 제목 없는 재료도 그대로 돈다", () => {
    expect(ragBlock(["가", "나"])).toBe(RAG_BLOCK_HEADER + "\n[1] 가\n[2] 나");
    expect(ragBlock(["가"], ["제목.md"])).toBe(RAG_BLOCK_HEADER + "\n[1] 《제목.md》 가");
  });

  it("★★ K4 — 빌더도 **제목을 싣는다**(학습 꼴 = 추론 꼴). 규칙이 한 글자도 안 갈린다", () => {
    // ★ 2026-09-05 결정: 옛 주석은 「빌더에는 제목 개념이 없다」였고, 그래서 학습 표본에는 제목이 없고
    //   추론 지문에는 있었다 — 어긋나도 **아무 오류가 안 나는** 부류다. 여기서 닫는다.
    expect(참고자료블록(RAG_BLOCK_HEADER, ["가", "나"], ["A.md", "B.md"]))
      .toBe(ragBlock(["가", "나"], ["A.md", "B.md"]));
    // 제목 칸이 비면 양쪽 다 옛 꼴이다(같은 규칙이라야 대조가 성립한다).
    expect(참고자료블록(RAG_BLOCK_HEADER, ["가"], [""])).toBe(ragBlock(["가"], [""]));
    expect(참고자료블록(RAG_BLOCK_HEADER, ["가"])).toBe(ragBlock(["가"]));
  });
});

describe("★ 빌더가 만든 근거 꼴 = 서버가 만드는 근거 꼴", () => {
  it("빌더의 참고자료블록과 서버의 ragBlock이 같은 글을 낸다", () => {
    const 조각 = ["접속기록은 1년 이상 보관합니다", "방화벽 점검은 월 1회입니다"];
    expect(참고자료블록(RAG_BLOCK_HEADER, 조각)).toBe(ragBlock(조각));
  });

  it("창구가 주는 예시(ragBlockSample)와도 맞는다 — 빌더가 실행 중에 스스로 대조하는 그 값", () => {
    // 라우트는 ragBlock(["<조각 본문>"], ["<문서 제목>"])을 예시로 준다(2026-09-05 K4).
    //   빌더는 예시블록(머리말)으로 같은 글을 지어 비교하고, 다르면 멈춘다.
    expect(예시블록(RAG_BLOCK_HEADER)).toBe(ragBlock(["<조각 본문>"], ["<문서 제목>"]));
    expect(예시블록(RAG_BLOCK_HEADER), "예시에 제목 자리표가 없다 — 제품이 안 쓰는 꼴을 대조하게 된다")
      .toContain("《<문서 제목>》");
    const code = src("tools/build-raft-dataset.mjs");
    expect(code, "빌더가 조립 꼴 대조를 안 하면 어긋나도 아무도 모른다").toContain("ragBlockSample");
  });
});

describe("★★ K4 근거 되찾기 — 제목이 실려도 **본문만** 돌려준다", () => {
  it("「[1] 《문서》 본문」에서 제목을 떼고 돌려준다(옛 꼴도 그대로 읽힌다)", () => {
    const 머리 = RAG_BLOCK_HEADER;
    const 새꼴 = ["팀원 프롬프트", 참고자료블록(머리, ["가나다", "라마바"], ["A.md", "B.md"])].join("\n\n");
    expect(근거조각뽑기(새꼴, 머리), "제목이 근거 본문에 섞였다").toEqual(["가나다", "라마바"]);
    const 옛꼴 = ["팀원 프롬프트", 참고자료블록(머리, ["가나다", "라마바"])].join("\n\n");
    expect(근거조각뽑기(옛꼴, 머리)).toEqual(["가나다", "라마바"]);
    expect(근거블록있나(새꼴, 머리)).toBe(true);
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

  it("★★ 정답이 여럿이면 그 문서를 **전부** 뺀다 — 둘째 정답이 방해로 실리면 답을 눈앞에 두고 「모른다」가 된다", () => {
    // 2026-09-04 적발: 호출부가 정답들[0]만 넘겨, 두 문서를 인용한 문답의 둘째 정답 조각이 방해 자리에
    // 실릴 수 있었다(오늘 재료에서는 빈도 0 — 승인 문답 하나에 근거가 정확히 하나뿐이다).
    const 정답2 = { ref: "store:B.md#cccccccccccc", text: "다른 문서 · 같은 영역 1", 문서: "B.md", category: "취약점" };
    const 고른것 = 방해조각고르기([정답, 정답2], 후보, 3, "씨") as { 문서: string }[];
    expect(고른것.map((c) => c.문서).sort(), "B.md는 둘째 정답의 문서다").toEqual(["C.md"]);
    const 예전꼴 = 방해조각고르기(정답, 후보, 3, "씨") as { 문서: string }[];
    expect(예전꼴.map((c) => c.문서).sort(), "하나만 넘기던 예전 꼴도 그대로 돈다").toEqual(["B.md", "C.md"]);
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

  it("★★ 닫는 따옴표가 없는 **깨진 꼬리**도 세고 뗀다 — 관문과 수리기가 같은 사각지대를 갖지 않는다", () => {
    // 2026-09-04 적발: 인용있나·인용떼기가 한 정규식이라, 깨진 꼬리는 둘 다 못 보고 지나쳤다.
    // 그 결과 C·D행이 「원문: "」를 단 채 저장되는데 보고서는 「비A행 인용 0%」라고 말했다.
    const 깨진 = '설명입니다. 원문: "This catalog is maintained by CISA';
    expect(인용있나(깨진), "완전한 꼴이 아니니 인용「있나」는 false다").toBe(false);
    expect(인용흔적있나(깨진), "그래도 흔적은 남아 있다 — 세는 자는 이쪽을 본다").toBe(true);
    expect(인용떼기(깨진)).toBe("설명입니다.");
    expect(인용흔적있나(인용떼기(깨진))).toBe(false);
    expect(인용흔적있나("AI 답변에는 근거(참고한 문서·원문 대목)를 붙입니다"), "「원문 대목」은 인용이 아니다").toBe(false);
  });

  it("깨진 꼬리를 뗄 때 **그 줄만** 뗀다 — 뒤 문단까지 지우면 답이 사라진다", () => {
    const v = 인용떼기('앞줄 원문: "깨진\n뒷문단은 그대로 남아야 합니다.');
    expect(v).toContain("뒷문단은 그대로 남아야 합니다.");
    expect(v.startsWith("앞줄")).toBe(true);
    expect(인용흔적있나(v)).toBe(false);
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

  it("★ 40자 이상 중 **가장 짧은** 것을 고른다 — 긴 인용은 인용이 아니라 복제다", () => {
    // 처음엔 「가장 긴 것」을 골랐다가 재구성 실측에서 답 p90이 349 → 870자로 뛰었다(그래서 뒤집었다).
    const 짧은 = "취약점 조치는 정해진 기한 안에 반드시 끝내야 하는 일이며 근거를 남깁니다.";
    const 긴문장 = "그리고 조치 결과는 담당자가 직접 확인하여 대장에 기록하고 승인 절차를 거쳐 최종 마감까지 마쳐야 합니다.";
    expect(짧은.length, "40자 하한을 넘어야 후보에 든다").toBeGreaterThanOrEqual(40);
    expect(긴문장.length, "이 시험이 뜻을 가지려면 다른 후보가 더 길어야 한다").toBeGreaterThan(짧은.length);
    const 근거 = `${짧은} ${긴문장}`;
    const r = 인용붙이기(`${근거} 이상이 절차입니다.`, [근거]) as { answer: string };
    expect(r.answer).toContain(`원문: "${짧은}"`);
    expect(r.answer).not.toContain(`원문: "${긴문장}"`);
  });

  it("★ 300자 넘는 덩어리뿐이면 붙이지 않는다 — 줄바꿈 없는 PDF 조각은 문장이 아니다", () => {
    // 문장 경계(마침표·「…다.」)가 하나도 없는 글 — 변환된 PDF에서 실제로 나오는 꼴이다.
    const 덩어리 = "취약점조치절차와담당자확인및승인기록".repeat(20);
    expect(덩어리.length).toBeGreaterThan(300);
    const r = 인용붙이기(`${덩어리} 이상입니다.`, [덩어리]) as { answer: string | null; 왜: string };
    expect(r.answer).toBeNull();
    expect(r.왜).toContain("300자");
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

  it("★★ 이미 달린 인용도 **근거와 대조한다** — 근거에서 온 것이면 손대지 않는다", () => {
    const 답 = `${한글문장} 원문: "${한글문장}"`;
    const r = 인용붙이기(답, [한글문장]) as { answer: string; 붙임: boolean; 뗌: boolean };
    expect(r.붙임, "두 번 붙이면 인용 안에 인용이 든다").toBe(false);
    expect(r.뗌).toBe(false);
    expect(r.answer).toBe(답);
  });

  it("★★ 근거에 **없는** 인용은 떼고 근거에서 다시 붙인다(1회전이 지어낸 그 버릇의 뿌리)", () => {
    // 2026-09-04 적발: 이미 인용이 달린 답(1회전 재료의 53.7%)을 대조 없이 통과시켜, 이 회전의
    // 핵심 개입이 A행의 일부에만 닿았다. 아래 인용문은 근거 블록 어디에도 없는 문장이다.
    const 남의문장 = 'This catalog is maintained by the Cybersecurity and Infrastructure Security Agency';
    const 답 = `${한글문장} 원문: "${남의문장}"`;
    const r = 인용붙이기(답, [`${한글문장} 조치 기한은 별도로 정합니다.`]) as { answer: string; 붙임: boolean; 뗌: boolean };
    expect(r.뗌, "근거 밖 인용을 그대로 두면 「아무 문장이나 원문이라 부르기」를 가르친다").toBe(true);
    expect(r.붙임).toBe(true);
    expect(r.answer).not.toContain(남의문장);
    expect(r.answer).toContain(`원문: "${한글문장}"`);
  });

  it("★ 근거 밖 인용인데 대신 붙일 문장도 없으면 **행을 버린다**", () => {
    const r = 인용붙이기('전혀 다른 주제로만 서술한 답변 문장입니다. 원문: "지어낸 원문입니다"', [한글문장]) as
      { answer: string | null; 뗌: boolean };
    expect(r.answer).toBeNull();
    expect(r.뗌, "떼고 못 붙였다는 사실이 집계에 남아야 한다").toBe(true);
  });

  it("★ 인용 대조 — 근거에 통째로 있거나 20자 이상 이어 겹치면 근거로 본다", () => {
    expect(인용근거대조(한글문장, [`앞말. ${한글문장} 뒷말.`])).toBe(true);
    expect(인용근거대조(한글문장.slice(0, 30), [한글문장])).toBe(true);
    expect(인용근거대조("This catalog is maintained by CISA", [한글문장])).toBe(false);
    expect(인용근거대조("짧다", [한글문장]), "8자 미만은 우연히 걸린다 — 대조하지 않는다").toBe(false);
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

  // ── 방해 조각 허용목록 (2026-09-04 결정 D2 — 기본 on) ───────────────────────────────
  //
  // 왜 바꿨나: 재배포 위험은 「정답으로 실렸나 방해로 실렸나」를 가리지 않는다. 실측으로 v1 데이터셋의
  // 방해 자리에 Tenable 사용자 가이드 본문이 실려 있었고, 그 문장은 학습 재료의 system 칸에 그대로 나갔다.
  // 예전 판(거르지 않고 숫자만 드러내기)은 --no-distractor-allowlist 로 남겨 v1 재현을 지킨다.
  const 타사 = 조각("Tenable_User_Guide.pdf", 긴본문("타사 상용 문서의 문장입니다."));
  type 노출 = 결과 & {
    통계: {
      방해라이선스노출: { 행: number; 문서별: Record<string, number> };
      방해허용목록: { 켬: boolean; 후보총: number; 남은후보: number; 거른후보: number; 거른문서별: Record<string, number> };
      제외: Record<string, number>;
    };
  };

  it("★★ 기본값 — 방해 조각도 허용목록으로 거른다(타사 본문이 아예 안 뽑힌다)", () => {
    // 허용목록 안 문서가 하나(방해1) 더 있으니 행은 만들어지고, 방해로는 그것만 뽑혀야 한다.
    const 색인2 = new Map([[정답조각.ref, 정답조각], [방해1.ref, 방해1], [타사.ref, 타사]]);
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인2, 기본) as 노출;
    expect(rows).toHaveLength(1);
    expect(rows[0].system, "타사 상용 문서 본문이 학습 재료에 실리면 안 된다").not.toContain(타사.text);
    expect(rows[0].system).toContain(방해1.text);
    expect(통계.방해라이선스노출.행, "걸렀으니 노출이 0이라야 한다").toBe(0);
    // 「걸었다」를 숫자로 뒷받침한다 — 0이면 안 걸린 것과 같다.
    expect(통계.방해허용목록.켬).toBe(true);
    expect(통계.방해허용목록.거른후보).toBe(1);
    expect(통계.방해허용목록.거른문서별["Tenable_User_Guide.pdf"]).toBe(1);
  });

  it("★ 방해 후보가 전부 허용목록 밖이면 행을 안 만든다 — 몰래 타사 본문을 싣느니 행을 버린다", () => {
    const 색인2 = new Map([[정답조각.ref, 정답조각], [타사.ref, 타사]]);
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인2, 기본) as 노출;
    expect(rows).toHaveLength(0);
    expect(통계.제외["방해 조각 없음"]).toBe(1);
    expect(통계.방해라이선스노출.행).toBe(0);
  });

  it("★ --no-distractor-allowlist 면 1회전 판 그대로 — 거르지 않고 숫자로만 드러낸다", () => {
    // 2026-09-04 실측: v1은 방해에 라이선스 판정을 안 걸었다. 그 판을 재현할 길을 남겨 둔다.
    const 색인2 = new Map([[정답조각.ref, 정답조각], [타사.ref, 타사]]);
    const 끈판 = { ...기본, distractorAllowlist: false };
    const { rows, 통계 } = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인2, 끈판) as 노출;
    expect(rows).toHaveLength(1);
    expect(rows[0].system, "끈 판에서는 v1처럼 타사 본문이 실린다(그래서 기본이 아니다)").toContain(타사.text);
    expect(통계.방해라이선스노출.행).toBe(1);
    expect(통계.방해라이선스노출.문서별["Tenable_User_Guide.pdf"]).toBe(1);
    expect(통계.방해허용목록.켬).toBe(false);
    expect(통계.방해허용목록.거른후보).toBe(0);
  });

  it("★★ strict에 버려진 행은 방해 노출로 **안** 센다 — 사람더러 판단하라는 숫자에 유령 행이 섞였다", () => {
    // 2026-09-04 적발: 막힌방해 집계가 strict 인용 필터보다 먼저 돌아, 데이터셋에 실리지도 않은 행이
    // 「재배포 위험을 판단하라」는 그 숫자를 부풀렸다(실측 재구성에서 이 사유로 버려진 행이 334개였다).
    // ⚠ 허용목록을 **끈 판**으로 잰다 — 켠 판에서는 타사 방해가 아예 안 뽑혀 이 자리를 못 지난다.
    const 색인2 = new Map([[정답조각.ref, 정답조각], [타사.ref, 타사]]);
    const 끈판 = { ...기본, quoteRule: "strict", distractorAllowlist: false };
    // 답이 근거와 20자도 안 겹친다 → strict가 이 행을 버린다.
    const 버림 = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref])], 색인2, 끈판) as 노출;
    expect(버림.rows).toHaveLength(0);
    expect(버림.통계.방해라이선스노출.행, "실리지도 않은 행을 세면 안 된다").toBe(0);
    // 같은 방해인데 행이 실리면 그대로 센다(경보를 줄이는 수리가 아니다).
    const 실림 = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref], 정답조각.text)], 색인2, 끈판) as 노출;
    expect(실림.rows).toHaveLength(1);
    expect(실림.통계.방해라이선스노출.행).toBe(1);
  });

  it("★ strict가 **무엇을 했는지** 숫자로 남는다 — 「그대로」만 크면 개입이 재료에 안 닿은 것이다", () => {
    type 규칙 = 결과 & { 통계: { 인용규칙: Record<string, number> } };
    const 남의인용 = `${정답조각.text} 원문: "This catalog is maintained by CISA and updated regularly"`;
    const r = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref], 남의인용)], 색인, { ...기본, quoteRule: "strict" }) as 규칙;
    expect(r.통계.인용규칙["갈아끼움(근거 밖 인용을 떼고 다시)"]).toBe(1);
    expect(r.rows[0].answer).not.toContain("Cybersecurity");
    expect(r.rows[0].answer).not.toContain("This catalog");
    const 그대로 = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref], 정답조각.text)], 색인, { ...기본, quoteRule: "strict" }) as 규칙;
    expect(그대로.통계.인용규칙["새로 붙임"]).toBe(1);
    const 끈판 = 행만들기([문답("a", "KEV가 뭔가요", [정답조각.ref], 남의인용)], 색인, 기본) as 규칙;
    expect(Object.values(끈판.통계.인용규칙).every((v) => v === 0), "quote-rule off면 1회전과 한 글자도 다르지 않다").toBe(true);
    expect(끈판.rows[0].answer, "off면 남의 인용도 그대로 둔다(1회전 판 보존)").toBe(남의인용);
  });
});

// ── 프롬프트 규격 파일 (2026-09-04 · R3) ──────────────────────────────────────────
//
// 규격 파일의 유일한 위험은 **낡는 것**이다 — 서버 llm.ts가 바뀌어도 파일은 안 따라온다.
// 그러면 gb10에서 도는 하네스가 학습과 **딴 틀**로 재면서 전부 초록을 띄운다(이 저장소가 반복해 겪은 꼴).
// 그래서 여기서 정본(llm.ts)과 글자 단위로 대조한다. 빨강 = 「win에서 다시 뽑아라」는 뜻이다.
describe("★★ 프롬프트 규격 파일이 서버와 같은 글인가", () => {
  const 규격경로 = path.join(루트, "tools", "team-bench", "prompt-spec.json");

  // ⚠ 규격 파일은 **살아 있는 서버에서만** 뽑힌다(관리자 창구) — 그래서 저장소에 아직 없을 수 있다.
  //   그때 이 시험이 빨강이면 「없는 데이터 파일」 때문에 저장소 전체가 빨강이 된다.
  //   그렇다고 조용히 건너뛰면 이 저장소가 반복해 겪은 「초록인데 아무것도 증명 안 함」이 된다.
  //   그래서 **둘로 가른다**:
  //     · 파일이 없을 때 → 사슬이 창구로 **떨어지는지**를 잰다(없어도 틀린 걸 재지는 않는다는 보증).
  //     · 파일이 있을 때 → 정본(llm.ts)과 글자 단위로 대조한다(낡으면 빨강).
  //   즉 지키는 자는 지킬 것이 생기는 순간 저절로 켜진다 — 규격을 쓰는데 대조가 없는 상태는 못 만든다.
  const 규격있음 = fs.existsSync(규격경로);

  it("★ 규격 파일이 없으면 사슬은 창구로 떨어진다 — 없다고 딴 틀로 재지는 않는다", () => {
    const sh = src("tools/ladder/day2-train.sh");
    expect(sh, "규격이 없을 때의 갈래가 없으면 사슬이 그냥 죽는다").toMatch(
      /if \[ -f "\$PROMPT_SPEC" \][\s\S]{0,600}else[\s\S]{0,400}ladder_need_env/
    );
    // 하네스 쪽도 fail-closed다 — 규격도 창구도 없으면 **지어내지 않고 죽는다**.
    expect(src("tools/team-bench/ask-samples.mjs")).toContain("process.exit(3)");
    if (!규격있음) {
      console.warn(
        `[시험] 규격 파일이 아직 없다(${규격경로}) — 아래 「정본과 대조」는 파일이 생기면 켜진다.` +
        " win에서 `node tools/ladder/export-prompt-spec.mjs` 로 뽑아 커밋할 것."
      );
    }
  });

  it.runIf(규격있음)("★★ 규격의 ragHeader가 llm.ts RAG_BLOCK_HEADER와 **글자 단위로** 같다", () => {
    const j = JSON.parse(fs.readFileSync(규격경로, "utf8"));
    expect(j.ragHeader, "규격이 낡았다 — export-prompt-spec.mjs 로 다시 뽑으세요").toBe(RAG_BLOCK_HEADER);
    expect(j.ragBlockSample, "머리말과 예시가 어긋나면 규격이 아니다").toBe(ragBlock(["<조각 본문>"], ["<문서 제목>"]));
    // 파일 안에서도 앞뒤가 맞아야 한다(지문이 본문과 따로 놀면 어느 쪽이 진짜인지 모른다).
    expect(String(j.system ?? "").length, "system이 비면 하네스가 프롬프트를 못 만든다").toBeGreaterThan(0);
    expect(j.systemChars).toBe(String(j.system).length);
  });

  // ★★ 2026-09-05 — **system도 정본과 대조한다.** 여기까지가 원래 비어 있던 칸이다:
  //   ragHeader만 보면 팀원 프롬프트가 바뀌어도 규격은 초록인 채 낡는다. 그러면 gb10 하네스가
  //   **딴 지문**으로 재면서 「회전 N 대비 좋아졌다」를 말하게 된다 — 잣대가 조용히 갈리는 꼴.
  //   ⚠ 이 시험이 빨개지면 값을 손으로 고치지 말고 win에서 다시 뽑는다(파일 머리말이 그렇게 적혀 있다).
  it.runIf(규격있음)("★★ 규격의 system이 llm.ts systemPromptFor(agentId)와 **글자 단위로** 같다", () => {
    const j = JSON.parse(fs.readFileSync(규격경로, "utf8"));
    const 정본 = systemPromptFor(String(j.agentId));
    expect(j.system, `규격이 낡았다(agentId=${j.agentId}) — win에서 node tools/ladder/export-prompt-spec.mjs 로 다시 뽑아 커밋할 것`).toBe(정본);
    expect(j.systemSha12, "지문이 본문과 따로 논다").toBe(
      crypto.createHash("sha1").update(정본).digest("hex").slice(0, 12)
    );
  });

  it("규격읽기가 fail-closed다 — 없는 파일·빈 칸·앞뒤 어긋남에서 죽는다", () => {
    expect(() => 규격읽기("tools/team-bench/없는-규격.json")).toThrow(/없습니다/);
    const 임시 = path.join(루트, "tools", "team-bench", `vitest-spec-${Date.now().toString(36)}.json`);
    try {
      fs.writeFileSync(임시, JSON.stringify({ ragHeader: "머리말", ragBlockSample: "머리말\n[1] 《<문서 제목>》 <조각 본문>" }));
      expect(() => 규격읽기(임시), "system이 없으면 하네스가 프롬프트를 못 만든다").toThrow(/system/);
      fs.writeFileSync(임시, JSON.stringify({ system: "s", ragHeader: "머리말", ragBlockSample: "엉뚱한 예시" }));
      expect(() => 규격읽기(임시)).toThrow(/어긋납니다/);
      // ★ 제목이 빠진 **옛 꼴**은 「낡은 규격」이 아니라 **그때의 사실**이다(2026-09-05 검토관).
      //   첫 판은 이 자리를 죽였는데, 그 바람에 저장소에 보관된 회전 1~4의 규격 파일 9개가
      //   통째로 안 읽혀 **옛 회전을 재현·재측정하는 길**까지 닫혔다(ask-samples --prompt-spec).
      //   이제 **아는 꼴이 둘**이다: 어느 꼴인지가 `꼴`로 따라 나오고, 둘 다 아니면 그대로 죽는다.
      fs.writeFileSync(임시, JSON.stringify({ system: "s", ragHeader: "머리말", ragBlockSample: "머리말\n[1] <조각 본문>" }));
      expect((규격읽기(임시) as { 꼴: string }).꼴, "옛 회전 규격을 못 읽으면 그 회전과 견줄 수 없다").toBe("제목없음(K4 이전)");
      // 앞뒤가 맞으면 읽힌다 — 오늘 꼴은 「제목있음」으로 적힌다.
      fs.writeFileSync(임시, JSON.stringify({ system: "s", ragHeader: "머리말", ragBlockSample: "머리말\n[1] 《<문서 제목>》 <조각 본문>" }));
      const 읽음 = 규격읽기(임시) as { system: string; 꼴: string };
      expect(읽음.system).toBe("s");
      expect(읽음.꼴, "어느 꼴로 읽었는지가 안 적히면 결과만 보고 못 가린다").toBe("제목있음");
    } finally {
      fs.rmSync(임시, { force: true });
    }
  });

  it("★★ 저장소에 보관된 회전 규격이 **전부 읽힌다** — 옛 회전을 재현할 수 있어야 한다", () => {
    // 2026-09-05 실측: 고치기 전 10개 중 9개가 「어긋납니다」로 죽었다(오늘 꼴 하나만 알던 탓).
    const 규격들 = [
      "tools/team-bench/prompt-spec.json",
      "tools/team-bench/results-ladder/baseline/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r1-base/probe-v2/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r2-v2/ep1/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r2-v2/ep2/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r2-v2/ep3/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r3-v3/ep1/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r3-v3/ep2/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r4-v4/ep1/prompt-spec.json",
      "tools/team-bench/results-ladder/day2/r4-v4/ep2/prompt-spec.json",
    ].filter((rel) => fs.existsSync(path.join(루트, rel)));
    expect(규격들.length, "보관 규격이 사라졌다(경로가 바뀌었나)").toBeGreaterThanOrEqual(9);
    for (const rel of 규격들) {
      const j = 규격읽기(rel) as { 꼴: string };
      expect(j.꼴, `보관 규격을 못 읽는다 — 이 회전과는 견줄 수 없다: ${rel}`).toBeTruthy();
    }
  });

  it("★ 하네스들이 --prompt-spec 을 실제로 받는다 — 인자만 만들고 안 넘기면 조용히 창구로 간다", () => {
    // 이 저장소가 반복해 겪은 꼴: 인자를 만들어 놓고 배선을 안 해 기본값으로 조용히 돈다.
    for (const rel of ["tools/team-bench/ask-samples.mjs", "tools/team-bench/kev-probe.mjs"]) {
      expect(src(rel), `${rel}이 --prompt-spec을 안 읽는다`).toContain('opt("--prompt-spec"');
    }
    expect(src("tools/build-raft-dataset.mjs")).toContain('opt("--prompt-spec"');
    // 사슬이 회전 폴더로 사본을 남기고 그 사본을 넘긴다(결과만 보고 무슨 꼴로 쟀는지 가릴 수 있게).
    const sh = src("tools/ladder/day2-train.sh");
    expect(sh).toContain('SPEC_ARGS=(--prompt-spec "$dir/prompt-spec.json")');
    expect(sh, "표본 하네스에 안 넘기면 규격 파일이 있으나 마나다").toMatch(/ask-samples\.mjs[\s\S]{0,300}SPEC_ARGS/);
  });

  it("★ 표본 갈래는 규격이 있으면 관리자 env를 요구하지 않는다 — 요구하면 gb10에서 못 돈다", () => {
    // 규격 파일의 목적이 「서버 없이 재기」인데 env를 그대로 막아 두면 매듭이 안 풀린다.
    // ⚠ ①(데이터셋 만들기)는 승인 문답·코퍼스 때문에 **진짜로** 서버가 필요하다 — 거기는 그대로 둔다.
    const 줄들 = src("tools/ladder/day2-train.sh").split("\n");
    const 조건부 = 줄들.filter((l) => l.includes("ladder_need_env") && l.includes('[ -f "$PROMPT_SPEC" ]'));
    expect(조건부.length, "베이스 대조·④-2 두 갈래 모두 조건부라야 한다").toBe(2);
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
  // ★ 2026-09-04 결정 D3 — 인용을 가르는 잣대는 **갈래 이름이 아니라 글**이다.
  //   그래서 시험도 진짜 근거 블록을 실은 행과 안 실은 행을 갈라서 만든다. 예전 시험은 전부
  //   `system: "s"` 였는데, 그 판에서는 「블록이 있나」를 물을 수 없어 규칙이 이름에 묶여 있었다.
  const 근거행 = (answer: string) => ({
    question: "q", answer,
    system: ["팀원 프롬프트", 참고자료블록(RAG_BLOCK_HEADER, ["근거 조각 본문입니다"])].join("\n\n"),
  });
  const 무근거행 = (answer: string) => ({ question: "q", answer, system: "팀원 프롬프트" });
  const 규격 = { ragHeader: RAG_BLOCK_HEADER };
  // 갈래 이름만 보던 옛 시험이 쓰던 이름 — 근거 블록을 실은 행이 기본값이다.
  const 행 = 근거행;

  it("갈래별 행 수와 비율, 「원문:」 비율(A행·비A행)을 따로 센다", () => {
    const rows = [행('설명. 원문: "가나다"'), 행("설명만"), 행(거절답), 무근거행("폐쇄형 답")];
    const 종류들 = ["A", "A", "B", "C"];
    const c = 구성비(rows, 종류들, 규격) as {
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

  it("★ 거절 답에 「원문:」이 붙으면 실패다 — 「없습니다」라 하면서 인용하면 그 인용은 거짓이다", () => {
    // ⓑ는 근거 블록이 **있는** 행이다(방해만 실린다). 그래도 답이 거절이라 인용은 0이라야 한다 —
    // 이 예외를 명시적으로 못 박는다(2026-09-04 결정 D3).
    const c = 구성비([행(거절답 + ' 원문: "지어낸 인용"')], ["B"], 규격);
    const r = 사전검사(c) as { 통과: boolean; 실패: string[] };
    expect(r.통과).toBe(false);
    expect(r.실패.join(" ")).toContain("원문");
    expect(r.실패.join(" "), "거절 행이 범인임을 말해야 한다").toContain("B 1행");
  });

  it("★ 실패 문구가 **어느 갈래**인지 댄다 — D면 고칠 자리가 이 빌더가 아니라 그 파일이다", () => {
    // 근거 블록이 **없는** D행이 인용을 달았다 → 없는 것을 인용한 것이다.
    const rows = [행("근거 답"), 행(거절답), 무근거행('긴 형식 보고. 원문: "어디선가"')];
    const c = 구성비(rows, ["A", "B", "D"], 규격) as { 표: Record<string, { 인용: number; 행: number }> };
    expect(c.표.D.인용, "갈래별 인용 수를 세지 않으면 범인을 못 댄다").toBe(1);
    expect(c.표.B.인용).toBe(0);
    const r = 사전검사(c) as { 통과: boolean; 실패: string[] };
    expect(r.통과).toBe(false);
    expect(r.실패[0]).toContain("D 1행");
    expect(r.실패[0], "죄 없는 갈래를 범인으로 부르면 안 된다").not.toContain("B ");
  });

  it("★★ 근거 블록을 실은 D행의 인용은 **통과**한다 — 갈래 이름으로 가르던 규칙이 재료를 지웠다", () => {
    // 2026-09-04 결정 D3의 핵심 회귀 방지. 실측: longform-vuln-v1.json 121행이 전부 근거 블록을
    // 싣고 121행 전부에 인용이 달려 있다. 「비A행이면 인용 0%」였던 옛 규칙은 그 121행을 통째로
    // 범인으로 몰았고, strict는 근거에서 온 정당한 인용을 떼어 버렸다(재료의 값어치를 지우는 수리).
    const rows = [행("근거 답"), 근거행('긴 형식 보고. 원문: "근거 조각 본문입니다"')];
    const c = 구성비(rows, ["A", "D"], 규격) as {
      인용: { 근거인용가능: { 행: number; 인용: number }; 근거블록없음: { 인용: number }; 거절행: { 인용: number } };
      근거블록: Record<string, number>;
    };
    expect(c.근거블록.D, "D행이 근거 블록을 실었음을 세어야 한다").toBe(1);
    expect(c.인용.근거인용가능).toMatchObject({ 행: 2, 인용: 1 });
    expect(c.인용.근거블록없음.인용).toBe(0);
    expect(c.인용.거절행.인용).toBe(0);
    const r = 사전검사(c) as { 통과: boolean; 실패: string[] };
    expect(r.통과, `근거에서 온 인용을 막으면 안 된다: ${JSON.stringify(r.실패)}`).toBe(true);
  });

  it("★★ 범인 문구는 **걸린 행만** 센다 — 죄 없는 D행 인용까지 지목하면 엉뚱한 파일을 뒤진다", () => {
    // 2026-09-04 자기검토에서 잡은 자리: 범인을 갈래의 **전체 인용 수**(표[k].인용)로 부르면,
    // 근거 블록을 실어 정당하게 인용한 D행 여럿이 실패 문구에 통째로 실린다. 실제로 고칠 행은 하나인데.
    const rows = [
      근거행('정당한 긴 형식. 원문: "근거 조각 본문입니다"'),
      근거행('또 하나 정당한 긴 형식. 원문: "근거 조각 본문입니다"'),
      무근거행('블록 없는 D행. 원문: "어디선가"'),
    ];
    const c = 구성비(rows, ["D", "D", "D"], 규격) as { 표: Record<string, { 인용: number }> };
    expect(c.표.D.인용, "갈래 전체 인용은 3이다(그래서 이 숫자로 범인을 부르면 안 된다)").toBe(3);
    const r = 사전검사(c) as { 통과: boolean; 실패: string[] };
    expect(r.통과).toBe(false);
    expect(r.실패[0], "걸린 행은 하나뿐이다").toContain("D 1행");
    expect(r.실패[0], "정당한 두 행까지 범인으로 부르면 안 된다").not.toContain("D 3");
  });

  it("★ ragHeader를 안 주면 fail-closed — 「전부 근거 없음」으로 보고 막는다", () => {
    // 규격을 안 넘긴 호출부가 **조용히 통과**하면, 블록을 가릴 수 없는 채로 초록이 뜬다.
    const c = 구성비([행('설명. 원문: "가나다"')], ["A"]);
    const r = 사전검사(c) as { 통과: boolean; 실패: string[] };
    expect(r.통과, "머리말 없이 판단할 수 있는 척하면 안 된다").toBe(false);
  });

  it("A행의 「원문:」이 95% 미만이면 경고한다(실패는 아니다)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => 행(i === 0 ? '설명. 원문: "가나다"' : "설명만"));
    const r = 사전검사(구성비(rows, rows.map(() => "A"), 규격)) as { 통과: boolean; 경고: string[] };
    expect(r.통과).toBe(true);
    expect(r.경고[0]).toContain("95%");
  });

  it("★★ A행의 **비중**이 절반 미만이면 경고한다 — --p-oracle 오타를 잡는 유일한 자리다", () => {
    // 2026-09-04 적발: 커밋은 「A행이 95% 미만이면 경고」라 했는데 코드는 A행 **안쪽 인용률**만 봤다.
    // 그래서 pOracle 0(전부 거절)인 판이 실패 0·경고 0으로 통과했다 — 0.8을 0.08로 잘못 쳐도 아무도 안 막는다.
    const rows = [행(거절답), 행(거절답), 행(거절답), 행("근거를 인용한 답")];
    const r = 사전검사(구성비(rows, ["B", "B", "B", "A"], 규격)) as { 통과: boolean; 경고: string[] };
    expect(r.통과, "비중은 경고지 실패가 아니다(낮은 P를 일부러 고를 수 있다)").toBe(true);
    expect(r.경고.some((w) => w.includes("p-oracle")), `경고에 안 나온다: ${JSON.stringify(r.경고)}`).toBe(true);
    const 기본판 = 사전검사(구성비([행('답. 원문: "가나다"')], ["A"], 규격)) as { 경고: string[] };
    expect(기본판.경고.some((w) => w.includes("p-oracle")), "전부 A인 기본판까지 경고하면 경고가 소음이 된다").toBe(false);
  });

  it("★★ ⓒ 폐쇄형과 ⓑ′ 무근거 거절을 **함께** 실으면 막는다 — 같은 프롬프트에 정반대 답이다", () => {
    // 둘 다 system이 「팀원 프롬프트만」(참고 자료 블록 없음)이라 글자 단위로 같다. C는 서술 답을,
    // B′는 거절을 가르친다 — 게다가 그 프롬프트 안에는 「자료가 없으면 없다고 먼저 밝힙니다」 규칙이 들어 있다.
    const c = 구성비([무근거행("폐쇄형 답"), 무근거행(거절답)], ["C", "B2"], 규격);
    const r = 사전검사(c) as { 통과: boolean; 실패: string[] };
    expect(r.통과).toBe(false);
    expect(r.실패.join(" ")).toContain("--allow-closedbook-conflict");
    const 허용 = 사전검사(c, { 폐쇄형충돌허용: true }) as { 통과: boolean };
    expect(허용.통과, "사람이 판단해 받아들이면 열려야 한다(그 사실은 보고서 「판」에 남는다)").toBe(true);
  });

  it("ⓒ만 있어도 경고는 남긴다 — 팀원 프롬프트 자신의 규칙을 어기는 답이다", () => {
    const r = 사전검사(구성비([무근거행("폐쇄형 답")], ["C"], 규격)) as { 통과: boolean; 경고: string[] };
    expect(r.통과).toBe(true);
    expect(r.경고.some((w) => w.includes("폐쇄형"))).toBe(true);
  });

  // ★ 2026-09-04 결정 D1 — ⓒ 폐쇄형은 **회전 2에 싣지 않는다**. 그 결정이 코드에 남아 있는지 본다.
  //   왜: 팀원 프롬프트 자신이 「참고 자료가 없으면 … '없습니다'라고 먼저 밝힙니다」라고 규칙을 두는데
  //   ⓒ는 그 규칙을 어기는 답을 가르친다. 제품은 언제나 RAG를 주고, 없으면 거절이 정답이다.
  it("★ D1 — ⓒ를 쓰지 않는 이유가 코드에 적혀 있고, 기본값은 0이다", () => {
    const code = src("tools/build-raft-dataset.mjs");
    expect(code, "--closedbook-ratio 기본값이 0이라야 한다").toContain('비율읽기("--closedbook-ratio", 0)');
    expect(code, "왜 안 쓰는지가 파일에 적혀 있어야 한다(결정이 글로 안 남으면 다음 사람이 되돌린다)")
      .toMatch(/회전 2에는 ⓒ를 싣지 않는다/);
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

  // [2026-09-04 · R6] --eval-holdout의 **결정적 분리가 학습 행과 겹치지 않는가**.
  //   왜 중요한가: 떼어 둔 행의 손실이 오르는 지점을 보자는 것이 이 인자의 목적인데, 같은 질문이 양쪽에
  //   있으면 그 손실은 「배웠나」가 아니라 「외웠나」를 잰다 — 그 숫자로 회전을 판정하면 판정이 거짓이 된다.
  //   옛 판은 자리를 input_ids 해시로 골라, 같은 질문이라도 system·answer이 다르면 다른 자리라
  //   **원리상 겹침을 못 막았다**(승인 문답의 중복 질문 · ⓓ 긴 형식이 딴 생성기에서 오는 길).
  it("★★ --eval-holdout — 같은 질문이 학습·평가 양쪽에 있지 않다(질문 뭉치를 통째로 뗀다)", () => {
    fs.mkdirSync("data/datasets", { recursive: true });
    // 같은 질문이 **세 행**으로 들어 있다(system·answer이 달라 옛 판에서는 서로 다른 자리였다).
    const 겹치는질문 = "KEV 목록에 오르면 무엇을 먼저 하나요?";
    fs.writeFileSync(
      데이터셋,
      JSON.stringify([
        { question: 겹치는질문, answer: "먼저 자산을 찾습니다", system: "참고 자료\n[1] 자산 식별" },
        { question: 겹치는질문, answer: "먼저 패치 여부를 봅니다", system: "참고 자료\n[1] 패치 확인" },
        { question: 겹치는질문, answer: "등록된 사내 자료에는 관련 내용이 없습니다" },
        { question: "접속기록 보관 기간은?", answer: "1년 이상입니다", system: "참고 자료\n[1] 1년 이상 보관" },
        { question: "방화벽 점검 주기는?", answer: "월 1회입니다" },
        { question: "백업 주기는?", answer: "주 1회입니다" },
      ]),
      "utf-8"
    );
    try {
      const 돌리기 = () => spawnSync(
        PY!,
        ["scripts/finetune_qlora14b.py", "--dataset", id, "--output", 산출, "--max-seq", "3072",
          "--smoke", "--eval-holdout", "2"],
        { encoding: "utf-8", env: { ...process.env, PYTHONUTF8: "1" } }
      );
      const r = 돌리기();
      expect(r.status, `스크립트가 죽었다: ${r.stderr}`).toBe(0);
      // 스모크가 **진짜 분리기**를 돌려 겹침을 세어 말한다(다른 식을 새로 적으면 제 코드를 검사하게 된다).
      expect(r.stdout, `분리 줄이 없다: ${r.stdout}`).toMatch(/평가 분리 —/);
      expect(r.stdout, "같은 질문이 양쪽에 있으면 평가 손실이 「외웠나」를 잰다").toContain("양쪽 겹친 질문 0");
      // 뭉치를 통째로 뗀다 — 3행짜리 질문이 걸리면 2가 아니라 3이 떨어진다(반쪽을 떼면 겹침이 생긴다).
      const m = r.stdout.match(/평가 (\d+)행 \/ 학습 (\d+)행/);
      expect(m, `분리 숫자를 못 읽었다: ${r.stdout}`).toBeTruthy();
      const [평가, 학습] = [Number(m![1]), Number(m![2])];
      expect(평가).toBeGreaterThanOrEqual(2);
      expect(평가 + 학습, "행이 사라지거나 늘면 안 된다").toBe(6);
      // ★ 결정적이다 — 같은 재료면 같은 시험지라야 회전끼리 견줄 수 있다.
      expect(돌리기().stdout.match(/평가 분리 —.*/)?.[0]).toBe(r.stdout.match(/평가 분리 —.*/)?.[0]);
    } finally {
      fs.rmSync(데이터셋, { force: true });
      fs.rmSync(산출, { recursive: true, force: true });
    }
  });

  // [2026-09-05 · 회전 4] --eval-file — 시험지를 **파일로 고정**한다.
  //   왜: --eval-holdout은 그 회전의 데이터셋 안에서 떼므로 재료가 바뀌면 시험지도 바뀐다.
  //   회전 2와 3의 eval_loss를 나란히 놓은 것은 **다른 시험지의 점수**를 견준 것이었다.
  it("★★ --eval-file — 파일을 읽고, 학습 재료와 질문이 겹치면 **죽는다**", () => {
    fs.mkdirSync("data/datasets", { recursive: true });
    const 평가파일 = path.join("data", "datasets", `${id}-holdout.json`);
    fs.writeFileSync(데이터셋, JSON.stringify([
      { question: "접속기록 보관 기간은?", answer: "1년 이상입니다", system: "참고 자료\n[1] 1년 이상 보관" },
      { question: "방화벽 점검 주기는?", answer: "월 1회입니다" },
    ]), "utf-8");
    try {
      const 돌리기 = (...더: string[]) => spawnSync(
        PY!,
        ["scripts/finetune_qlora14b.py", "--dataset", id, "--output", 산출, "--max-seq", "3072", "--smoke", ...더],
        { encoding: "utf-8", env: { ...process.env, PYTHONUTF8: "1" } }
      );

      // ⓐ 안 겹치는 평가 파일 — 읽고 평가 줄까지 낸다.
      fs.writeFileSync(평가파일, JSON.stringify([
        { question: "백업 주기는?", answer: "주 1회입니다", system: "참고 자료\n[1] 주 1회" },
      ]), "utf-8");
      const ok = 돌리기("--eval-file", 평가파일);
      expect(ok.status, `스크립트가 죽었다: ${ok.stderr}`).toBe(0);
      expect(ok.stdout).toContain(`eval_file=${평가파일}`);
      expect(ok.stdout).toContain("평가 파일 1행 · 양쪽 겹친 질문 0");

      // ⓑ 겹치는 평가 파일 — **죽는다**(겹치면 그 손실은 「배웠나」가 아니라 「외웠나」를 잰다).
      fs.writeFileSync(평가파일, JSON.stringify([
        { question: "방화벽 점검 주기는?", answer: "월 1회입니다" },
      ]), "utf-8");
      const 겹침 = 돌리기("--eval-file", 평가파일);
      expect(겹침.status, "조용히 넘기면 그 숫자로 회전을 판정하게 된다").not.toBe(0);
      expect(겹침.stdout + 겹침.stderr).toContain("평가 파일의 질문이 학습 재료에도 있습니다");

      // ⓒ --eval-holdout 과 **함께 못 쓴다** — 시험지가 둘이면 어느 것으로 쟀는지 알 수 없다.
      const 둘 = 돌리기("--eval-file", 평가파일, "--eval-holdout", "2");
      expect(둘.status).not.toBe(0);
      expect(둘.stdout + 둘.stderr).toContain("함께 못 씁니다");

      // ⓓ 파일이 없으면 죽는다(조용히 「평가 없음」으로 넘어가면 회전이 시험지 없이 굽힌다).
      const 없음 = 돌리기("--eval-file", path.join("data", "datasets", "없는-파일.json"));
      expect(없음.status).not.toBe(0);
    } finally {
      fs.rmSync(데이터셋, { force: true });
      fs.rmSync(평가파일, { force: true });
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
    expect(프롬.body.ragBlockSample).toBe(ragBlock(["<조각 본문>"], ["<문서 제목>"]));
    expect(프롬.body.ragBlockSample, "K4 — 창구 예시에 제목 자리표가 없다").toContain("《<문서 제목>》");
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

  it("★ 빌더는 **학습 행**을 파일로 안 떨군다 — 손에 쥐면 위생 관문을 건너뛰게 된다", () => {
    // 2026-09-03 실측: gb10 수동 경로가 관문을 건너뛰어 평가 게이트 문항 4건이 학습에 섞였다.
    const code = src("tools/build-raft-dataset.mjs");
    const 쓰기 = [...code.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
    // ★ 자리는 **둘뿐**이다(2026-09-05 · 회전 4):
    //   · out — 보고서(build-report.json)
    //   · abs — 홀드아웃(평가용) 파일. **학습에 안 쓰이는 행**이고, 오히려 데이터셋에서 **빠지는** 행이다.
    //     (그래서 위생을 건너뛰는 길이 아니다 — 건너뛸 학습이 없다. 아래 시험이 「빠지는가」를 실제로 잰다.)
    //   셋째가 생기면 여기가 먼저 빨강이 된다 — 그때 「학습 행인가」를 사람이 다시 물어야 한다.
    expect(쓰기, "보고서·홀드아웃 말고 다른 것을 쓰고 있다 — 학습 행 파일이 생기면 위생을 건너뛰는 길이 열린다").toEqual(["abs", "out"]);
    expect(code, "홀드아웃은 저장소에 커밋되므로 허용목록 밖 본문이 실렸으면 **쓰지 않고 죽는다**(재배포 금지)")
      .toMatch(/홀드아웃 파일을 저장소에 쓸 수 없습니다/);
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

  // [2026-09-04 실측] 빌더가 로그아웃을 안 해 **유휴 30분짜리 유령 세션**이 남았고, 계정당 1세션이라
  //   다음 도구가 26분을 기다렸다. 재료 굽는 시간보다 기다린 시간이 길었다.
  //   ⚠ 실서버 없이 「세션이 실제로 지워졌나」는 못 잰다 — 대신 **거짓말이 되는 자리 넷**을 소스로 못 박는다.
  it("★ 빌더는 끝에 세션을 닫는다 — refreshToken을 몸에 실어서(안 실으면 서버가 아무것도 안 지운다)", () => {
    const code = src("tools/build-raft-dataset.mjs");
    const i = code.indexOf('"/api/auth/logout"');
    expect(i, "로그아웃을 부르는 곳이 없다 — 유령 세션이 계정당 1세션을 물고 다음 도구를 막는다").toBeGreaterThan(-1);
    // ① 몸에 refreshToken이 없으면 서버는 {ok:true}만 주고 세션을 **그대로 둔다**(아래 ④에서 그 계약을 대조한다).
    expect(code.slice(i, i + 320), "logout 몸에 refreshToken이 없다 — 「로그아웃했다」가 거짓말이 된다")
      .toContain("refreshToken");
    // ② 성공이든 실패든 닫는가 — 직접 실행 꼬리의 finally가 그 자리다.
    expect(code, "finally가 없으면 실패로 끝난 회차의 세션이 남는다").toMatch(/finally \{\s*await 로그아웃\(\);/);
    // ③ ★ process.exit()는 finally를 **건너뛴다** — 로그인 뒤에 exit로 튀는 길이 하나라도 있으면 세션이 남는다.
    //    (실제로 사전검사 실패 갈래가 그 길이었다. 지금은 process.exitCode + return 이다.)
    const 로그인자리 = code.indexOf("const auth = await login(SERVER");
    const 꼬리자리 = code.indexOf("// 짝 시험이 위 순수 함수들을 import한다");
    expect(로그인자리, "로그인 호출부를 못 찾았다 — 이 감시가 헛돈다").toBeGreaterThan(-1);
    expect(꼬리자리, "직접 실행 꼬리를 못 찾았다 — 이 감시가 헛돈다").toBeGreaterThan(로그인자리);
    const 튀는곳 = [...code.slice(로그인자리, 꼬리자리).matchAll(/^[^/\n]*process\.exit\(/gm)].map((m) => m[0].trim());
    expect(튀는곳, "로그인 뒤 process.exit()로 튀면 세션을 닫는 finally가 안 돈다").toEqual([]);
    // ④ 서버 쪽 계약이 아직 그대로인가 — 여기가 바뀌면 ①의 뜻이 사라진다(빈 몸으로 불러도 지워지게 되면).
    expect(src("server/src/auth/auth.ts"), "logout 계약이 바뀌었다 — 빌더의 로그아웃 꼴을 다시 보라")
      .toMatch(/if \(refreshToken\) revokeRefreshToken\(refreshToken\)/);
    // ⑤ 같은 함정을 이미 넘은 짝(ask-samples)과 갈라지지 않았는가 — 이 저장소가 반복해 겪은 「두 파일이 어긋난다」.
    expect(src("tools/team-bench/ask-samples.mjs")).toContain("refreshToken: ctx.refreshToken");
  });
});

// ── 3회전(2026-09-04 · R3) — 인용 꼴을 **제품 규약**으로, 인용의 양을 재료에서 조인다 ─────────────
//
// 왜 이 시험들이 있나: 회전 2 실측(65132fe6)에서 ⑫ 베낀 글자 비율이 84~87%였고, 제품이 답에 기대하는
// 인용 꼴(참고 자료 블록의 번호 — llm.ts:191)과 학습이 가르친 꼴(「원문: "…"」)이 **달랐다.**
// 그 둘을 고치는 코드는 「돌려 보면 그럴듯한」 부류라, 아래에서 **하나씩 값으로** 못 박는다.
describe("★★ 제품 규약 인용 꼴 — 「[n]에 따르면 \"X′\"」", () => {
  const 조각A = "기본 관리자 계정명을 변경하지 않고 사용할 경우 공격자에 의한 계정 및 비밀번호 추측 공격이 가능하므로 관리자 계정명을 유추하기 어려운 이름으로 변경하여 운영하여야 한다.";
  const 조각B = "백업 매체는 외부 보관 위탁처에 월 1회 반출하며 반출 이력을 자동으로 남긴다. 반출 대장은 분기마다 점검한다.";
  const 답 = "기본 관리자 계정명을 그대로 두면 공격자에 의한 계정 및 비밀번호 추측 공격이 가능합니다. 그래서 담당자는 유추하기 어려운 이름으로 먼저 바꾸고, 로그인 실패 잠금 정책을 함께 두는 것이 좋습니다. 계정명 변경은 서비스 영향이 작아 우선 조치로 적합합니다.";

  it("★★ 꼴의 정본은 server/src/engine/llm.ts 다 — 주석이 바뀌면 여기가 먼저 빨강이 된다", () => {
    // llm.ts ragBlock 위의 그 한 줄: 「번호는 1부터 — 답이 「[2]에 따르면」으로 가리킨다」.
    // 제품 규약을 코드에 **두 번** 적으면 어긋난다 — 그래서 짓는 곳은 제품인용만들기 하나이고,
    // 그것이 서버의 말과 같은지를 여기서 대조한다.
    expect(src("server/src/engine/llm.ts"), "llm.ts가 더는 「[2]에 따르면」이라 말하지 않는다 — 규약이 바뀌었는지 확인하고 제품인용만들기를 함께 고칠 것")
      .toContain("「[2]에 따르면」");
    expect(제품인용만들기(2, "X")).toBe('[2]에 따르면 "X"');
  });

  it("★★ 통째로 담은 조각을 **먼저** 찾는다 — 붙박이 문구 겹침에 번호를 뺏기지 않는다(v4 실측 2건)", () => {
    // raft-vuln-v4 실측: 인용 「Apply updates per vendor instructions.」이 [2]에 통째로 있는데,
    // [1]의 「Apply mitigations per vendor instructions or …」와 "pervendorinstructions"(21자)가
    // 겹쳐 답이 [1]을 가리켰다 — 번호가 딴 조각을 가리키면 이 회전이 가르치려는 것의 반대가 된다.
    const 인용 = "Apply updates per vendor instructions.";
    const 겹치기만 = "requiredAction: Apply mitigations per vendor instructions or discontinue use of the product if mitigations are unavailable.";
    const 통째로 = "NVD: the vendor published guidance. requiredAction: Apply updates per vendor instructions. See the advisory for details.";
    expect(블록번호찾기(인용, [겹치기만, 통째로]), "통째로 담은 [2]라야 한다").toBe(2);
    expect(블록번호찾기(인용, [통째로, 겹치기만]), "통째로가 앞에 있어도 그대로 [1]").toBe(1);
    // 통째로 담은 조각이 없으면 옛 규칙(20자 겹침 · 첫 조각)으로 떨어진다 — 인용은 줄여 붙이므로 정상 경로다.
    expect(블록번호찾기(인용, [겹치기만])).toBe(1);
  });

  it("★ 번호는 **그 행의 참고 자료 블록** 자리다 — 정답 목록의 자리가 아니다", () => {
    // 블록은 [방해, 정답] 순서다. 정답 목록의 자리 번호(1)를 쓰면 답이 **방해 조각**을 가리킨다.
    const r = 인용붙이기(답, [조각A], { 꼴: "product", 블록조각들: [조각B, 조각A], 인용상한자: 300, 인용비중상한: null });
    expect(r.번호, "블록에서 정답 조각은 두 번째다").toBe(2);
    expect(r.answer).toContain("[2]에 따르면");
    // 블록을 뒤집으면 번호도 따라 뒤집힌다(자리에서 오는 값이라는 뜻).
    expect(인용붙이기(답, [조각A], { 꼴: "product", 블록조각들: [조각A, 조각B], 인용상한자: 300, 인용비중상한: null }).번호).toBe(1);
  });

  it("★ 문장 경계에서 줄인다 — 낱말 중간을 끊어 「원문」이라 내세우지 않는다", () => {
    expect(문장경계자르기("짧은 문장이다.", 120), "상한 이하면 한 글자도 안 건드린다").toBe("짧은 문장이다.");
    const 두문장 = "앞 문장은 여기서 끝난다. 뒤 문장은 훨씬 길게 이어지며 상한을 넘어가는 대목입니다.";
    expect(문장경계자르기(두문장, 30), "상한 안에 문장 끝이 있으면 거기서 자른다").toBe("앞 문장은 여기서 끝난다.");
    const 한문장 = "가나다라마바사아자차카타파하 가나다라마바사아자차카타파하 가나다라마바사아자차카타파하";
    const 잘림 = 문장경계자르기(한문장, 30);
    expect(잘림.length, "문장 끝이 없으면 띄어쓰기 경계").toBeLessThanOrEqual(30);
    expect(한문장.startsWith(잘림), "잘린 것은 원문의 앞토막이라야 한다(고쳐 쓰면 인용이 아니다)").toBe(true);
    expect(잘림.endsWith("하"), "낱말 중간에서 끊기지 않는다").toBe(true);
  });

  it("★ 줄인 뒤에도 조각과 20자 겹쳐야 번호가 뜻을 갖는다 — 안 되면 **행을 버린다**", () => {
    // 상한을 20자 밑으로 주면 겹침이 성립하지 않는다 — 억지로 [n]을 붙이지 않고 사유를 돌려준다.
    const r = 인용붙이기(답, [조각A], { 꼴: "product", 블록조각들: [조각A], 인용상한자: 20, 인용비중상한: null });
    expect(r.answer).toBeNull();
    expect(r.사유키).toBe("번호 못 찾음");
  });

  it("★ 인용 비중이 상한을 넘으면 **더 줄인다** — 인용이 답을 잡아먹지 않게", () => {
    const r = 인용붙이기(답, [조각A], { 꼴: "product", 블록조각들: [조각A], 인용상한자: 300, 인용비중상한: 0.2 });
    expect(r.answer, "설명이 80자를 넘으므로 살아야 한다").toBeTruthy();
    expect(r.인용문!.length / r.answer!.length, "인용 글자 ÷ 답 글자").toBeLessThanOrEqual(0.2 + 1e-9);
    // 같은 재료를 상한 없이 붙이면 더 길다 — 「줄였다」가 실제로 일어난 일이라는 뜻이다.
    const 안줄임 = 인용붙이기(답, [조각A], { 꼴: "product", 블록조각들: [조각A], 인용상한자: 300, 인용비중상한: null });
    expect(안줄임.인용문!.length).toBeGreaterThan(r.인용문!.length);
  });

  it("★★ 인용을 뺀 설명이 짧으면 붙이지 않고 **행을 버린다**(설명 없는 인용은 복사기다)", () => {
    const 짧은답 = "계정명을 바꾸는 것이 좋습니다. 공격자에 의한 계정 및 비밀번호 추측 공격이 가능합니다.";
    expect(짧은답.length, "이 시험의 전제 — 80자 미만이다").toBeLessThan(80);
    const r = 인용붙이기(짧은답, [조각A], { 꼴: "product", 블록조각들: [조각A], 인용상한자: 120, 인용비중상한: 0.35 });
    expect(r.answer).toBeNull();
    expect(r.사유키).toBe("설명이 짧음");
  });

  it("★ 거절·폐쇄형 행은 그대로다 — 이 꼴은 **인용을 붙이는 자리**에만 닿는다", () => {
    // ⓑ·ⓑ′는 인용붙이기를 아예 안 지난다(행만들기가 거절답을 그대로 단다). 그 계약을 갈래로 확인한다.
    const 조각 = (문서: string, 본문: string) => ({ ref: `store:${문서}#${"0".repeat(12)}`, text: 본문, 문서, category: "취약점" });
    const 정답 = 조각("GIJO_AS_취약점관리_지침.md", 조각A);
    const 방해 = 조각("GIJO_AS_보안담당자_실무매뉴얼.md", 조각B);
    const 색인 = new Map([정답, 방해].map((c) => [c.ref, c]));
    const { rows, 종류들 } = 행만들기(
      [{ id: "a", question: "질문1", answer: 답, cites: [정답.ref] }, { id: "b", question: "질문2", answer: 답, cites: [] }],
      색인,
      {
        판정: (문서: string) => (/^GIJO_/.test(문서) ? null : "허용목록 밖"),
        system: "너는 보안 분석가다", ragHeader: RAG_BLOCK_HEADER, distractors: 1, 씨앗: "s", 시험: new Set<string>(),
        pOracle: 0, noEvidenceFromUncited: true, quoteRule: "strict", quoteStyle: "product",
      },
    ) as { rows: { answer: string }[]; 종류들: string[] };
    expect(종류들.sort()).toEqual(["B", "B2"]);
    for (const r of rows) expect(인용흔적있나(r.answer), `거절 행에 인용이 붙었다: ${r.answer}`).toBe(false);
  });

  it("★★ 세는 자와 떼는 자가 **두 꼴을 다 본다** — 한 꼴만 보면 사전검사가 거짓말을 한다", () => {
    const 제품꼴 = `설명입니다. ${제품인용만들기(1, "스무 글자가 넘는 아주 기다란 인용 토막입니다")}`;
    expect(인용있나(제품꼴)).toBe(true);
    expect(인용흔적있나(제품꼴)).toBe(true);
    expect(인용떼기(제품꼴)).toBe("설명입니다.");
    // 옛 꼴도 그대로 — 회전 1·2의 재료를 다시 읽을 수 있어야 한다.
    expect(인용흔적있나('설명입니다. 원문: "옛 꼴"')).toBe(true);
  });

  it("★ 원래 꼴(original)은 **한 글자도 안 바뀐다** — 회전 1·2를 다시 만들 수 있어야 한다", () => {
    const r = 인용붙이기(답, [조각A]);
    expect(r.answer!.startsWith(`${답} 원문: "`)).toBe(true);
    expect(r.answer).not.toContain("에 따르면");
  });

  // ── 2026-09-05 수리(F1) — product 경로가 **정직한 인용을 죽이던** 자리 ──────────────
  //
  // 실측(d1e6f54c 판): A 672→137 · D 153→63. 사라진 535행은 「근거 밖 인용」이 아니라
  // **근거에서 온 인용**을 달고 있던 행이었다 — 인용을 먼저 떼고 그 뗀 답에서 20자 겹침을 찾으니,
  // 겹침이 인용 안에만 있던 행은 후보 0이 되어 죽었다. 그리고 통계는 그것을 「버림(근거 밖 인용…)」이라
  // 적었다. 아래 넷이 그 자리를 지킨다.
  describe("★★★ product 경로 수리 — 문장은 그대로, 번호만 다시", () => {
    // 답이 조각A를 **인용으로만** 겹치는 판: 설명 부분은 제 말로 쓰였고 겹침은 인용 꼬리에만 있다.
    const 제말설명 = "관리자 계정 이름을 기본값대로 두면 로그인 시도가 표적이 되기 쉽습니다. 담당자는 이름을 먼저 바꾸고 잠금 정책을 함께 두는 편이 좋으며, 이 조치는 서비스 영향이 작아 우선 처리하기에 알맞습니다.";
    const 정직한인용답 = `${제말설명} 원문: "${조각A}"`;

    it("★★★ 근거에서 온 인용은 **문장이 살아남고** 번호만 이 행의 블록에서 다시 매겨진다", () => {
      const r = 인용붙이기(정직한인용답, [조각A], { 꼴: "product", 블록조각들: [조각B, 조각A], 인용상한자: 120, 인용비중상한: 0.35 });
      expect(r.answer, "이 행이 죽던 자리다(실측 535행)").not.toBeNull();
      expect(r.번호다시, "번호만 다시 매겼다는 표식").toBe(true);
      expect(r.answer).toContain("[2]에 따르면");
      // 인용문은 **원래 그 문장**에서 왔다(120자 문장 경계로 줄어들 수는 있다).
      expect(조각A.replace(/\s+/g, "")).toContain(r.인용문!.replace(/\s+/g, ""));
      expect(r.인용문!.length, "120자 상한은 그대로 건다").toBeLessThanOrEqual(120);
      expect(인용흔적있나(r.answer!), "옛 꼴 「원문:」이 남으면 안 된다").toBe(true); // 새 꼴로는 있다
      expect(r.answer).not.toContain('원문: "');
    });

    it("★★ 후보 탐색은 **떼기 전 원문 답**에서 한다 — 뗀 답에는 겹침이 없어도 산다", () => {
      // 인용을 떼면 남는 것은 제말설명뿐이고, 거기엔 조각A와 20자 겹침이 없다.
      expect(제말설명).not.toContain(조각A.slice(0, 20));
      // 옛 코드는 여기서 후보 0 → 행 버림이었다.
      const r = 인용붙이기(정직한인용답, [조각A], { 꼴: "product", 블록조각들: [조각A], 인용상한자: 120, 인용비중상한: null });
      expect(r.answer).not.toBeNull();
      expect(r.붙임).toBe(true);
    });

    it("★★ 사유 이름표가 갈린다 — 「근거 밖 인용」은 **인용근거대조가 false일 때만**", () => {
      // ⓐ 근거에서 온 인용인데 못 붙인 경우 → 「근거 밖」이라 적지 않는다.
      expect(인용규칙이름표({ answer: null, 뗌: true, 근거에서온인용: true })).toBe("버림(근거에서 온 인용인데 다시 못 붙임)");
      // ⓑ 근거 밖 인용을 떼고 대신 붙일 문장도 없던 경우 → 예전 이름표 그대로.
      expect(인용규칙이름표({ answer: null, 뗌: true, 근거에서온인용: false })).toBe("버림(근거 밖 인용·대신 붙일 문장 없음)");
      // ⓒ 붙인 쪽도 갈린다 — 번호만 다시 매긴 것을 「갈아끼움」이라 적으면 통계가 거짓말을 한다.
      expect(인용규칙이름표({ answer: "x", 붙임: true, 뗌: true, 번호다시: true })).toBe("번호 다시 매김(근거에서 온 인용)");
      expect(인용규칙이름표({ answer: "x", 붙임: true, 뗌: true })).toBe("갈아끼움(근거 밖 인용을 떼고 다시)");
      expect(인용규칙이름표({ answer: "x", 붙임: true, 뗌: false })).toBe("새로 붙임");
      expect(인용규칙이름표({ answer: "x", 붙임: false })).toBe("그대로(근거에서 온 인용)");
      // 사유키가 있으면 그것이 이긴다(설명이 짧음·번호 못 찾음·비중 못 맞춤).
      expect(인용규칙이름표({ answer: null, 사유키: "설명이 짧음", 뗌: true, 근거에서온인용: true })).toBe("버림(설명이 짧음)");
      // ★ 이름표가 만드는 모든 키가 통계 칸에 **미리** 있어야 한다 — 없으면 표에서 조용히 빠진다.
      const 칸 = 인용규칙칸();
      for (const 결과 of [
        { answer: null, 뗌: true, 근거에서온인용: true }, { answer: null, 뗌: true, 근거에서온인용: false },
        { answer: null, 뗌: false }, { answer: "x", 붙임: true, 뗌: true, 번호다시: true },
        { answer: "x", 붙임: true, 뗌: true }, { answer: "x", 붙임: true, 뗌: false }, { answer: "x", 붙임: false },
        { answer: null, 사유키: "설명이 짧음" }, { answer: null, 사유키: "번호 못 찾음" }, { answer: null, 사유키: "비중 못 맞춤" },
      ]) expect(Object.keys(칸), `칸에 없는 이름표: ${인용규칙이름표(결과)}`).toContain(인용규칙이름표(결과));
    });

    it("★ 유지후보가 안 되면 **근거에서 새로 찾은 문장**으로 떨어진다(행을 그냥 버리지 않는다)", () => {
      // 인용은 근거에서 왔지만 블록에는 그 조각이 없다 → 번호를 못 매긴다. 그래도 답 본문이 조각B와
      // 겹치면 그쪽으로 붙는다.
      const 답2 = `${조각B.slice(0, 60)} 라고 정해 두었으므로 담당자는 반출 대장을 분기마다 확인하고 위탁처 점검 결과를 함께 남겨야 합니다. 원문: "${조각A}"`;
      const r = 인용붙이기(답2, [조각A, 조각B], { 꼴: "product", 블록조각들: [조각B], 인용상한자: 120, 인용비중상한: null });
      expect(r.answer).not.toBeNull();
      expect(r.번호다시, "유지후보가 아니라 새로 찾은 문장이다").toBe(false);
      expect(r.번호).toBe(1);
    });

    it("★ 제품인용맞추기는 **한 곳**이다 — 줄이기·번호·비중을 여기서만 센다", () => {
      const 빌더 = src("tools/build-raft-dataset.mjs");
      expect((빌더.match(/제품인용만들기\(n, ""\)/g) ?? []).length, "비중 계산이 두 곳에 있으면 어긋난다").toBe(1);
      const ok = 제품인용맞추기("설명입니다.", 조각A, { 블록조각들: [조각A], 인용상한자: 120, 인용비중상한: null });
      expect(ok.번호).toBe(1);
      const 실패 = 제품인용맞추기("설명입니다.", 조각A, { 블록조각들: [조각B], 인용상한자: 120, 인용비중상한: null });
      expect(실패.answer).toBeNull();
      expect(실패.사유키).toBe("번호 못 찾음");
    });
  });
});

// ── 거절 행의 답 꼴(2026-09-05 · F2) ────────────────────────────────────────────
//
// 왜: 회전 2의 재료는 거절 행에 **거절 문장 하나만** 달았고, r2-v2 ep2·ep3의 persona 12답이 전부
// 그 59자였다 — 관문 ⑨의 「창작 0건」은 「안 지어냄」이 아니라 **「안 답함」**이었다. 그런데 제품의
// 팀원 프롬프트(llm.ts:254)는 「'…없습니다'라고 **먼저 밝힙니다**(그 뒤 필요하면 아주 짧은 일반 정의만
// 덧붙입니다)」라고 시킨다. 재료가 그 뒷부분을 지우고 있었다.
describe("★★★ 거절 행 — 「먼저 밝히고 이어 답한다」", () => {
  const 원답 = '방화벽 정책은 최소 권한으로 설계하고 불필요한 포트를 닫는 것이 기본입니다. [2]에 따르면 "차단 정책은 기본 거부로 둔다" 라고 하며, 담당자는 분기마다 규칙을 점검하고 쓰이지 않는 규칙을 지워야 합니다. 변경 이력은 결재판에 남겨 두는 편이 좋습니다.';

  it("★ 팀원 프롬프트가 실제로 「먼저 밝히고 이어 답하라」고 시킨다 — 이 회전의 근거다", () => {
    const llm = src("server/src/engine/llm.ts");
    expect(llm).toContain("라고 먼저 밝힙니다");
    expect(llm, "그 뒤에 답할 수 있다는 말이 프롬프트에 있다").toContain("그 뒤 필요하면");
  });

  it("★ 번호 참조를 뗀다 — 가리킬 블록이 없는 자리에서 [n]은 거짓이다", () => {
    expect(번호참조떼기('앞말 [2]에 따르면 뒷말')).toBe("앞말 뒷말");
    expect(번호참조떼기("근거 [3] 를 보면")).toBe("근거 를 보면");
    expect(번호참조떼기("번호가 없다")).toBe("번호가 없다");
  });

  it("★★ declare-then-answer — 거절 문장 + 말머리 + 인용/번호를 뗀 본문", () => {
    const r = 거절답만들기(원답, { 꼴: "declare-then-answer" });
    expect(r.일반답).toBe(true);
    expect(r.answer.startsWith(거절답), "거절 문장은 **그대로** 앞에 온다").toBe(true);
    expect(r.answer).toContain(일반답머리);
    expect(인용흔적있나(r.answer), "거절 행에 인용이 남으면 사전검사가 막는다").toBe(false);
    expect(/\[\d+\]/.test(r.answer), "가리킬 블록이 없는 [n]").toBe(false);
    expect(r.answer).toContain("방화벽 정책은 최소 권한으로");
  });

  it("★ 기본(refuse-only)은 회전 2를 **한 글자도 안 바꾼다**", () => {
    expect(거절답만들기(원답).answer).toBe(거절답);
    expect(거절답만들기(원답, { 꼴: "refuse-only" }).answer).toBe(거절답);
  });

  it("★ 본문이 짧으면 거절 문장만 단다 — 「밝히고 두 마디」는 답이 아니다", () => {
    const r = 거절답만들기('짧습니다. 원문: "어쩌고"', { 꼴: "declare-then-answer" });
    expect(r.answer).toBe(거절답);
    expect(r.일반답).toBe(false);
    expect(r.왜).toContain("최소 80자");
  });

  it("★★ 깨진 인용 꼬리가 남으면 **되돌린다**(fail-closed) — 사전검사에 걸리느니 거절만 한다", () => {
    // 닫는 따옴표가 없는 꼬리가 줄 중간에 박히면 인용떼기가 그 줄 끝까지만 뗀다 — 그래도 남으면 되돌린다.
    const 깨진 = `앞말입니다. 원문: "닫는 따옴표가 없는 꼬리\n뒷말은 충분히 길어서 팔십 자를 넘기기 위한 문장이며 담당자는 분기마다 점검해야 합니다.`;
    const r = 거절답만들기(깨진, { 꼴: "declare-then-answer" });
    expect(인용흔적있나(r.answer)).toBe(false);
  });

  it("★★★ 행 만들기 — ⓑ·ⓑ′ 두 갈래가 다 「밝히고 일반 답」이 되고, 인용·번호는 0이다", () => {
    const 조각 = (문서: string, 본문: string) => ({ ref: `store:${문서}#${"0".repeat(12)}`, text: 본문, 문서, category: "취약점" });
    const 정답 = 조각("GIJO_AS_취약점관리_지침.md", "KEV 목록에 오른 취약점은 실제 악용이 확인된 것이며 담당자는 기한 안에 조치해야 한다.");
    const 방해 = 조각("GIJO_AS_보안담당자_실무매뉴얼.md", "EPSS는 악용 가능성 점수이며 CVSS와 함께 보아야 우선순위가 선다.");
    const 색인 = new Map([정답, 방해].map((c) => [c.ref, c]));
    const 옵션 = {
      판정: (문서: string) => (/^GIJO_/.test(문서) ? null : "허용목록 밖"),
      system: "너는 보안 분석가다", ragHeader: RAG_BLOCK_HEADER, distractors: 1, 씨앗: "s", 시험: new Set<string>(),
      pOracle: 0, noEvidenceFromUncited: true,
    };
    const 입력 = [
      { id: "a", question: "질문1", answer: 원답, cites: [정답.ref] },  // → B(방해만)
      { id: "b", question: "질문2", answer: 원답, cites: [] },           // → B′(무근거)
    ];
    type R = { rows: { answer: string }[]; 종류들: string[]; 통계: { 거절행꼴: Record<string, number | string> } };
    const 기본판 = 행만들기(입력, 색인, 옵션) as R;
    expect(기본판.종류들.sort()).toEqual(["B", "B2"]);
    for (const r of 기본판.rows) expect(r.answer, "기본은 거절 문장만").toBe(거절답);

    const 새판 = 행만들기(입력, 색인, { ...옵션, refusalStyle: "declare-then-answer" }) as R;
    expect(새판.종류들.sort(), "갈래는 안 바뀐다 — 바뀌는 것은 답 꼴뿐이다").toEqual(["B", "B2"]);
    for (const r of 새판.rows) {
      expect(r.answer.startsWith(거절답), "먼저 밝힌다").toBe(true);
      expect(r.answer.length, "이어 답한다").toBeGreaterThan(거절답.length + 20);
      expect(인용흔적있나(r.answer), "거절 행에 인용 0").toBe(false);
      expect(/\[\d+\]/.test(r.answer), "거절 행에 번호 0").toBe(false);
    }
    expect(새판.통계.거절행꼴.꼴).toBe("declare-then-answer");
    expect(새판.통계.거절행꼴["밝히고 일반 답"]).toBe(2);
    expect(새판.통계.거절행꼴["거절 문장만"]).toBe(0);
  });

  it("★ 사전검사는 그대로 통과한다 — 거절 행의 계약(인용 0)이 안 깨졌다", () => {
    const 행 = (a: string) => ({ question: "q", answer: a, system: `너는 보안 분석가다\n\n${참고자료블록(RAG_BLOCK_HEADER, ["조각"])}` });
    const 답 = 거절답만들기(원답, { 꼴: "declare-then-answer" }).answer;
    const c = 구성비([행(답)], ["B"], { ragHeader: RAG_BLOCK_HEADER });
    expect(c.인용.거절행.인용, "거절 행 인용 0").toBe(0);
    expect(사전검사(c).실패).toEqual([]);
  });
});

// ── 회전 4(2026-09-05) — 갈래별 거절 꼴 · Ⓝ 무블록 · 고정 홀드아웃 ─────────────────
//
// 왜: 회전 3은 ⓑ와 ⓑ′에 **같은 꼴**(declare-then-answer)을 먹였다. 그 결과 ⓑ 행은 「참고 자료 블록이
// 눈앞에 있는데 거절부터 하고 이어 답하는」 꼴이 되어 ⓐ와 겉모습이 같아졌고, 실측에서
// **근거를 준 자리의 답 8건 중 7건이 거절문으로 시작**했다(관문 ⑬이 그것을 센다).
describe("★★★ 회전 4 — 거절 꼴을 갈래별로 · Ⓝ 무블록 · 홀드아웃 고정", () => {
  const 원답 = '방화벽 정책은 최소 권한으로 설계하고 불필요한 포트를 닫는 것이 기본입니다. [2]에 따르면 "차단 정책은 기본 거부로 둔다" 라고 하며, 담당자는 분기마다 규칙을 점검하고 쓰이지 않는 규칙을 지워야 합니다.';
  const 조각 = (문서: string, 본문: string) => ({ ref: `store:${문서}#${"0".repeat(12)}`, text: 본문, 문서, category: "취약점" });
  const 정답 = 조각("GIJO_AS_취약점관리_지침.md", "KEV 목록에 오른 취약점은 실제 악용이 확인된 것이며 담당자는 기한 안에 조치해야 한다.");
  const 방해 = 조각("GIJO_AS_보안담당자_실무매뉴얼.md", "EPSS는 악용 가능성 점수이며 CVSS와 함께 보아야 우선순위가 선다.");
  const 색인 = new Map([정답, 방해].map((c) => [c.ref, c]));
  const 옵션 = {
    판정: (문서: string) => (/^GIJO_/.test(문서) ? null : "허용목록 밖"),
    system: "너는 보안 분석가다", ragHeader: RAG_BLOCK_HEADER, distractors: 1, 씨앗: "s", 시험: new Set<string>(),
  };
  type R = {
    rows: { question: string; answer: string; system: string }[];
    종류들: string[];
    통계: { 거절행꼴: { 갈래별: Record<string, Record<string, number>> }; 무블록: { 후보: number; 실림: number } };
  };

  it("★ by-kind는 **블록의 유무**로 가른다 — ⓑ만 거절 문장, 블록 없는 갈래는 밝히고 답", () => {
    expect(거절꼴고르기("by-kind", "B")).toBe("refuse-only");
    expect(거절꼴고르기("by-kind", "B2")).toBe("declare-then-answer");
    expect(거절꼴고르기("by-kind", "N")).toBe("declare-then-answer");
    // 옛 두 값은 갈래와 무관하게 그대로다 — 회전 2·3을 한 글자도 안 바꾼다.
    expect(거절꼴고르기("refuse-only", "B2")).toBe("refuse-only");
    expect(거절꼴고르기("declare-then-answer", "B")).toBe("declare-then-answer");
    expect(거절답만들기(원답, { 꼴: "by-kind", 갈래: "B" }).answer, "블록이 있는 자리는 거절만").toBe(거절답);
    expect(거절답만들기(원답, { 꼴: "by-kind", 갈래: "B2" }).일반답, "블록이 없는 자리는 밝히고 답").toBe(true);
  });

  it("★★ 행 만들기 by-kind — ⓑ는 59자 거절, ⓑ′는 밝히고 답. **한 판 안에서 둘이 다르다**", () => {
    const 입력 = [
      { id: "a", question: "질문1", answer: 원답, cites: [정답.ref] },  // → B(방해만)
      { id: "b", question: "질문2", answer: 원답, cites: [] },           // → B′(무근거)
    ];
    const { rows, 종류들, 통계 } = 행만들기(입력, 색인, {
      ...옵션, pOracle: 0, noEvidenceFromUncited: true, refusalStyle: "by-kind",
    }) as R;
    const 답 = Object.fromEntries(종류들.map((k, i) => [k, rows[i].answer]));
    expect(답.B, "블록이 눈앞에 있는데 이어 답하면 ⓐ와 겉모습이 같아진다").toBe(거절답);
    expect(답.B2.startsWith(거절답)).toBe(true);
    expect(답.B2.length, "블록이 없는 자리는 밝히고 이어 답한다").toBeGreaterThan(거절답.length + 20);
    expect(인용흔적있나(답.B2)).toBe(false);
    expect(번호참조있나(답.B2)).toBe(false);
    expect(통계.거절행꼴.갈래별.B["거절 문장만"]).toBe(1);
    expect(통계.거절행꼴.갈래별.B2["밝히고 일반 답"]).toBe(1);
  });

  it("★★ --noblock-ratio 1 — 정답 자리 후보가 전부 Ⓝ이 된다(블록 없음 · 인용·번호 0)", () => {
    const 입력 = [{ id: "a", question: "질문1", answer: 원답, cites: [정답.ref] }];
    const { rows, 종류들, 통계 } = 행만들기(입력, 색인, { ...옵션, noblockRatio: 1, refusalStyle: "by-kind" }) as R;
    expect(종류들).toEqual(["N"]);
    expect(rows[0].system, "블록이 없다 — llm.ts가 rag=null일 때 만드는 그 system이다").toBe("너는 보안 분석가다");
    expect(rows[0].system).not.toContain(RAG_BLOCK_HEADER);
    expect(rows[0].answer.startsWith(거절답)).toBe(true);
    expect(rows[0].answer).toContain(일반답머리);
    expect(인용흔적있나(rows[0].answer)).toBe(false);
    expect(번호참조있나(rows[0].answer), "가리킬 블록이 없는 [n]은 관문 ⑨가 세는 그 꼴이다").toBe(false);
    expect(통계.무블록).toEqual({ 비율: 1, 후보: 1, 실림: 1 });
  });

  it("★ 기본(0)은 **한 글자도 안 바꾼다** — 옛 회전을 그대로 다시 만들 수 있어야 한다", () => {
    const 입력 = [{ id: "a", question: "질문1", answer: 원답, cites: [정답.ref] }];
    const 옛 = 행만들기(입력, 색인, 옵션) as R;
    const 새 = 행만들기(입력, 색인, { ...옵션, noblockRatio: 0 }) as R;
    expect(새.rows).toEqual(옛.rows);
    expect(옛.종류들).toEqual(["A"]);
    expect(옛.통계.무블록).toEqual({ 비율: 0, 후보: 0, 실림: 0 });
  });

  it("★ 고르는 것은 결정적이다 — 같은 씨앗이면 같은 자리가 Ⓝ이 된다", () => {
    const 입력 = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, question: `질문${i}`, answer: 원답, cites: [정답.ref] }));
    const 한판 = 행만들기(입력, 색인, { ...옵션, noblockRatio: 0.5, refusalStyle: "by-kind" }) as R;
    const 두판 = 행만들기(입력, 색인, { ...옵션, noblockRatio: 0.5, refusalStyle: "by-kind" }) as R;
    expect(두판.종류들).toEqual(한판.종류들);
    expect(한판.종류들.filter((k) => k === "N").length, "절반 언저리가 Ⓝ이다").toBeGreaterThan(0);
    const 딴씨앗 = 행만들기(입력, 색인, { ...옵션, 씨앗: "다른씨앗", noblockRatio: 0.5, refusalStyle: "by-kind" }) as R;
    expect(딴씨앗.종류들, "씨앗이 다르면 판도 다르다(그래서 지문이 뜻을 갖는다)").not.toEqual(한판.종류들);
  });

  it("★★ 사전검사 — 블록 없는 행에 「[n]」이 남으면 **막는다**(인용 검사가 원리상 못 보는 꼴)", () => {
    const 행 = { question: "q", answer: "앞말입니다. [2]에 따르면 뒷말입니다.", system: "너는 보안 분석가다" };
    const c = 구성비([행], ["N"], { ragHeader: RAG_BLOCK_HEADER });
    expect(c.인용.근거블록없음.인용, "따옴표 꼬리는 없다 — 인용 검사는 통과한다").toBe(0);
    expect(c.번호참조.무근거행).toBe(1);
    const r = 사전검사(c);
    expect(r.통과).toBe(false);
    expect(r.실패.join(" "), "어느 갈래가 범인인지 댄다").toContain("N 1행");
  });

  it("★★ ⓒ 폐쇄형과 Ⓝ을 함께 실으면 막는다 — ⓑ′와 **같은 자리**다(갈래가 늘어도 검사가 따라간다)", () => {
    const 블록없는행 = (a: string) => ({ question: "q", answer: a, system: "너는 보안 분석가다" });
    const c = 구성비([블록없는행("원래 답입니다"), 블록없는행(거절답)], ["C", "N"], { ragHeader: RAG_BLOCK_HEADER });
    const r = 사전검사(c);
    expect(r.통과).toBe(false);
    expect(r.실패.join(" ")).toContain("Ⓝ 1");
    expect(사전검사(c, { 폐쇄형충돌허용: true }).통과, "사람이 판단해 받아들이면 연다").toBe(true);
  });

  it("★★ 홀드아웃 — 질문 뭉치를 **통째로** 뗀다(반쪽을 떼면 같은 질문이 학습·평가 양쪽에 남는다)", () => {
    const rows = [
      { question: "같은 질문", answer: "답1", system: "s" },
      { question: "같은 질문", answer: "답2", system: "s" },
      { question: "다른 질문", answer: "답3", system: "s" },
    ];
    const 고른 = 홀드아웃고르기(rows, ["A", "D", "A"], { n: 1 });
    const 뗀질문 = new Set([...고른].map((i) => rows[i].question));
    const 남은질문 = new Set(rows.filter((_, i) => !고른.has(i)).map((r) => r.question));
    expect([...뗀질문].every((q) => !남은질문.has(q)), "겹치면 그 손실은 「배웠나」가 아니라 「외웠나」를 잰다").toBe(true);
    expect(고른.size, "뭉치를 통째로 떼므로 n보다 클 수 있다").toBeGreaterThanOrEqual(1);
  });

  it("★ 홀드아웃은 결정적이고 **A행을 담은 뭉치가 먼저**다", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ question: `q${i}`, answer: "a", system: "s" }));
    const 종류들 = rows.map((_, i) => (i < 3 ? "B" : "A"));
    const 고른 = 홀드아웃고르기(rows, 종류들, { n: 4 });
    expect([...고른].every((i) => 종류들[i] === "A"), "A행이 이 재료의 본령이고 평가도 그 자리를 물어야 한다").toBe(true);
    expect([...홀드아웃고르기(rows, 종류들, { n: 4 })].sort(), "같은 입력이면 같은 시험지").toEqual([...고른].sort());
  });
});

describe("★★ 베낀 글자 비율 — 재료를 거르는 자와 판정하는 자가 **같은 함수**다", () => {
  it("★ 관문 ⑫의 그 함수를 불러 쓴다(복제가 아니다)", async () => {
    const g = await import("../../tools/team-bench/gates.mjs");
    const 빌더 = fs.readFileSync(path.join(루트, "tools", "build-raft-dataset.mjs"), "utf8");
    expect(빌더, "빌더가 잣대를 스스로 적으면 게이트와 갈라진다").toContain('from "./team-bench/gates.mjs"');
    // 조각이 하나면 단일 판과 **같은 값**이라야 한다(두 함수가 같은 계산을 한다는 뜻).
    const 조각 = "기본 관리자 계정명을 변경하지 않고 사용할 경우 공격자에 의한 계정 및 비밀번호 추측 공격이 가능함";
    const 답 = `앞말입니다. ${조각} 뒷말입니다.`;
    expect(g.베낀글자비율여럿(답, [조각])).toBe(g.베낀글자비율(답, 조각));
    // 조각이 여럿이면 **덮인 넓이를 합친다** — 하나씩 잰 최댓값보다 크거나 같다.
    const 조각2 = "로그인 실패 잠금 정책을 함께 두는 것이 좋으며 계정명 변경은 서비스 영향이 작다";
    const 답2 = `${조각.slice(0, 30)} 그리고 ${조각2.slice(0, 30)} 입니다.`;
    const 합 = g.베낀글자비율여럿(답2, [조각, 조각2])!;
    expect(합).toBeGreaterThan(Math.max(g.베낀글자비율(답2, 조각)!, g.베낀글자비율(답2, 조각2)!));
  });

  it("★★ 상한을 넘는 행은 **재료에 안 싣는다** — 문서별로 세어 범인을 댄다", () => {
    const 긴조각 = "기본 관리자 계정명을 변경하지 않고 사용할 경우 공격자에 의한 계정 및 비밀번호 추측 공격이 가능하므로 관리자 계정명을 유추하기 어려운 이름으로 변경하여 운영하여야 한다.";
    const 조각 = (문서: string, 본문: string) => ({ ref: `store:${문서}#${"0".repeat(12)}`, text: 본문, 문서, category: "취약점" });
    const 정답 = 조각("GIJO_AS_취약점관리_지침.md", 긴조각);
    const 방해 = 조각("GIJO_AS_보안담당자_실무매뉴얼.md", "백업 매체는 외부 보관 위탁처에 월 1회 반출하며 반출 이력을 자동으로 남긴다.");
    const 색인 = new Map([정답, 방해].map((c) => [c.ref, c]));
    const 기본 = {
      판정: (문서: string) => (/^GIJO_/.test(문서) ? null : "허용목록 밖"),
      system: "너는 보안 분석가다", ragHeader: RAG_BLOCK_HEADER, distractors: 1, 씨앗: "s", 시험: new Set<string>(),
    };
    // 답이 조각을 통째로 게워 낸 행 — 관문 ⑫가 「통째 복사」라 부르는 그것이다.
    const 복사기 = [{ id: "a", question: "질문", answer: 긴조각, cites: [정답.ref] }];
    const 안거름 = 행만들기(복사기, 색인, 기본) as { rows: unknown[]; 베낀비율들: (number | null)[] };
    expect(안거름.rows, "기본(상한 1)은 거르지 않는다 — 옛 회전 재현이 깨지면 안 된다").toHaveLength(1);
    expect(안거름.베낀비율들[0]).toBeGreaterThan(0.9);

    const 거름 = 행만들기(복사기, 색인, { ...기본, maxCopyRatio: 0.6 }) as {
      rows: unknown[]; 통계: { 제외: Record<string, number>; 베낀비율제외: { 행: number; 문서별: Record<string, number> } };
    };
    expect(거름.rows).toHaveLength(0);
    expect(거름.통계.제외["베낀 비율 초과"]).toBe(1);
    expect(거름.통계.베낀비율제외.문서별["GIJO_AS_취약점관리_지침.md"], "어느 문서가 복사기를 만드는지 이름을 대야 사람이 고친다").toBe(1);
  });

  it("★ 구성비 표가 평균·p90을 함께 낸다 — 값을 안 주면 **미측정(null)**이지 0이 아니다", () => {
    const rows = [{ question: "q", answer: "a", system: "s" }];
    expect(구성비(rows, ["A"], { ragHeader: RAG_BLOCK_HEADER }).베낀비율, "안 주면 미측정").toBeNull();
    const 표 = 구성비(rows, ["A"], { ragHeader: RAG_BLOCK_HEADER, 베낀비율들: [0.2] }).베낀비율;
    expect(표).toEqual({ 대상: 1, 평균: 0.2, p90: 0.2, 최대: 0.2 });
  });
});
