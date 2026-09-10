// 회전 5 재료 v6 — **승인 문답 등급 O에서 새로 굽는** 빌더의 짝 시험(계획서 §12.15).
//
// ■ 왜 이 파일이 생겼나 (2026-09-10 저녁 · 실측)
//   회전 5의 재료를 v4에서 다시 고르는 길은 천장을 쳤다 — 등급 O만 남기면 124행(회전 4의 13%)이고
//   거절로 시작하는 행이 87.1%가 되어, 그 판으로는 「bf16이 나았나 / 재료가 얇았나」를 못 가른다.
//   그래서 **원천(승인 문답 O 2,181건)에서 새로 굽는** 도구를 지었다(tools/team-bench/material-v6.mjs).
//
// ■ 이 파일이 못 박는 것
//   ① 굽는 도구는 운영을 **읽기만** 한다(sqlite readonly · 4000은 읽기 창구 둘 · 세션은 반드시 반납).
//   ② 등급은 **자기 문서 ∪ 인용한 근거 문서 중 가장 좁은 것**이다(모르면 O가 아니다).
//   ③ C 창 집합에서 **공개 원천에 있는 글을 뺀다** — 그 뺄셈은 자리 어긋남에 걸리지 않아야 한다.
//      ★ 이것이 2026-09-10 저녁에 새로 밟은 자리다: 해시 대 해시로 빼면 창 격자가 어긋나 144개만
//        빠지고, 정상 O 행 244건이 **거짓 빨강**으로 찍혔다. 글자로 빼야 한다.
//   ④ 시험지(홀드아웃)와 표본 문항은 재료와 **한 문항도 안 겹친다**(겹치면 재는 것이 「외웠나」가 된다).
//   ⑤ 걷어내는 자·판정하는 자는 저장소의 그 함수 하나다(여기서 다시 안 적는다 — 두 벌이면 갈린다).
//   ⑥ 커밋된 산출물(새 시험지·긴 형식·표본 문항·빌드 보고서)이 **말한 대로**다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  창생성걸음, 창목록, 창들만들기, 문서등급, 문답등급, ref문서,
  홀드아웃뗀다, 질문뭉치, 절제목, 금지절썼나, 언어맞추기, 거절비율맞추기, 창걸러내기, 순서키,
} from "../../tools/team-bench/material-v6.mjs";
import { 창길이, 창걸음, 창최소적중, 창정규화, 창적중수, 잣대지문, 등급관문 } from "../../tools/team-bench/material-r5.mjs";
import { 문항정규화 } from "../../tools/build-raft-dataset.mjs";
import { 제품거절문장 } from "../../tools/team-bench/gates.mjs";

const 루트 = path.join(__dirname, "..", "..");
const src = (rel: string) => fs.readFileSync(path.join(루트, rel), "utf8");
const 빌더 = () => src("tools/team-bench/material-v6.mjs");
/** 주석을 뺀 **실행줄**만 — 머리말이 「이 창구를 안 부른다」고 이름을 대며 약속하기 때문이다. */
const 실행줄 = () => 빌더().split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
const 머리말 = JSON.parse(src("tools/team-bench/prompt-spec.json")).ragHeader as string;

describe("★ 운영은 읽기만 한다 — 굽는 도구에 쓰는 창구가 하나도 없다", () => {
  it("sqlite를 readonly로 연다", () => {
    expect(빌더()).toContain("readonly: true");
  });

  it("★ 쓰는 SQL이 없다 — 재료를 굽다가 운영을 고치는 길이 아예 없어야 한다", () => {
    for (const 쓰기 of ["UPDATE ", "INSERT ", "DELETE ", "DROP ", "CREATE TABLE"]) {
      expect(실행줄(), `${쓰기} 가 코드에 있다 — 이 도구는 읽기 전용이라고 머리말이 약속했다`).not.toContain(쓰기);
    }
  });

  it("★ 데이터셋 저장 창구를 부르지 않는다(운영에 재료를 심는 길)", () => {
    // ⚠ **실행줄만** 본다 — 머리말은 「이 창구를 안 부른다」고 이름을 대며 약속하고 있어서,
    //   주석까지 세면 약속을 적었다는 이유로 시험이 빨개진다(고칠 수 없는 빨강은 관문이 아니라 벽이다).
    expect(실행줄()).not.toContain("/api/dataset/save");
  });

  it("★ 로그인한 자리마다 로그아웃이 있다 — 계정당 1세션을 유령으로 붙들지 않는다", () => {
    const s = 빌더();
    expect(s).toContain("/api/auth/login");
    expect(s).toContain("/api/auth/logout");
    // 실패 경로에서도 닫는다(성공했을 때만 닫으면, 죽는 날 세션이 남는다).
    expect(s, "실패 경로에 로그아웃이 없다").toMatch(/catch \(e\) \{[\s\S]{0,200}로그아웃\(\)/);
    // 몸에 refreshToken을 실어야 실제로 지워진다(빈 몸이면 {ok:true}만 오고 세션은 남는다).
    expect(s, "로그아웃 몸에 refreshToken이 없다 — 「로그아웃했다」가 거짓이 된다")
      .toMatch(/auth\/logout[\s\S]{0,260}refreshToken/);
  });

  it("로그인을 밀어내지 않는다(--force-login 이 없다)", () => {
    expect(실행줄()).not.toContain("force-login");
  });
});

describe("★ 창 만들기 — 만드는 걸음과 찾는 걸음은 다른 값이고, 달라도 된다", () => {
  it("만드는 걸음은 20, 찾는 걸음은 1이다(찾는 쪽이 1이라 자리가 어긋나도 맞는다)", () => {
    expect(창생성걸음).toBe(20);
    expect(창걸음).toBe(1);
    expect(창생성걸음).toBeLessThanOrEqual(창길이);
  });

  it("★ 만든 창은 **아무 자리에서 시작하는 글에서도** 찾힌다 — 자리 어긋남 함정의 그 자리다", () => {
    const 본문 = "기밀로 분류된 사내 대응 절차의 본문이며 담당자는 즉시 상황실에 보고하고 격리 절차를 수행한다 이 문장은 창이 여러 개 나오도록 충분히 길게 적는다";
    const 집합 = 창들만들기(본문);
    expect(집합.size).toBeGreaterThanOrEqual(창최소적중);
    // 앞에 머리말이 붙어 시작 자리가 20의 배수가 아니게 밀린 글
    const 밀린 = "팀원 프롬프트 일곱 글자 더" + 본문;
    expect(창적중수(밀린, 집합)).toBeGreaterThanOrEqual(창최소적중);
  });

  it("창목록은 해시와 **창 글자**를 함께 준다(뺄셈은 글자로 해야 격자가 안 어긋난다)", () => {
    const l = 창목록("가".repeat(200));
    expect(l.length).toBeGreaterThan(0);
    expect(l[0].w).toHaveLength(창길이);
    expect(l[0].h).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("★ 등급 — 모르면 O가 아니고, 근거까지 본다", () => {
  it("빈 칸은 O(아직 안 매김)이고 **모르는 값은 C**다(fail-closed)", () => {
    expect(문서등급("")).toBe("O");
    expect(문서등급(null)).toBe("O");
    expect(문서등급("o")).toBe("O");
    expect(문서등급("C")).toBe("C");
    expect(문서등급("기밀")).toBe("C");
    expect(문서등급("깨진값")).toBe("C");
  });

  it("ref에서 문서 이름만 떼어 낸다(store: 접두와 조각 해시를 뗀다)", () => {
    expect(ref문서("store:KISA_가이드.md#0123456789ab")).toBe("KISA_가이드.md");
    expect(ref문서("knowledge/GIJO_지식.md#0123456789ab")).toBe("knowledge/GIJO_지식.md");
  });

  it("★ 자기 문서가 O라도 **C 문서를 인용했으면 C**다 — 그 답에는 C 본문이 실려 있다", () => {
    const 표 = new Map([["승인문답:x1", "O"], ["기밀문서.md", "C"]]);
    expect(문답등급({ id: "x1", cites: ["store:기밀문서.md#0123456789ab"] }, 표)).toBe("C");
    expect(문답등급({ id: "x1", cites: [] }, 표)).toBe("O");
  });

  it("아무것도 못 대조하면 「?」다 — 모르는 것을 O로 세지 않는다", () => {
    expect(문답등급({ id: "없는id", cites: [] }, new Map())).toBe("?");
  });
});

describe("★ 홀드아웃 — 질문 뭉치를 통째로, 결정적 차례로", () => {
  const 문답 = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`, question: `질문${i}`, answer: "답", cites: ["store:문서.md#0123456789ab"], topic: "취약점",
  }));

  it("같은 질문은 **한쪽에만** 있다(반쪽을 떼면 「외웠나」를 재게 된다)", () => {
    const 쌍 = [...문답, { ...문답[0], id: "q0b" }];
    const { 뗀문답, 남은 } = 홀드아웃뗀다(쌍, { 주제: "취약점", 목표: 2 });
    const 뗀질문 = new Set(뗀문답.map((l) => 문항정규화(l.question)));
    expect(남은.some((l) => 뗀질문.has(문항정규화(l.question)))).toBe(false);
  });

  it("같은 입력이면 같은 판이다(무작위를 쓰면 A/B가 성립하지 않는다)", () => {
    const a = 홀드아웃뗀다(문답, { 주제: "취약점", 목표: 3 }).뗀문답.map((l) => l.id);
    const b = 홀드아웃뗀다(문답, { 주제: "취약점", 목표: 3 }).뗀문답.map((l) => l.id);
    expect(a).toEqual(b);
  });

  it("근거(cites)가 없는 문답은 시험지 후보가 아니다 — 근거 블록을 못 싣는다", () => {
    const { 후보 } = 질문뭉치([...문답, { id: "z", question: "무근거", answer: "답", cites: [], topic: "취약점" }], { 주제: "취약점" });
    expect(후보.some((l) => l.id === "z")).toBe(false);
  });

  it("뗄 질문을 밖에서 주면 그대로 쓴다(부르는 쪽이 「구운 행 수」로 목표를 셀 수 있게)", () => {
    const 집합 = new Set([문항정규화("질문3")]);
    const { 뗀문답 } = 홀드아웃뗀다(문답, { 주제: "취약점", 뗄질문: 집합 });
    expect(뗀문답.map((l) => l.id)).toEqual(["q3"]);
  });
});

describe("★ 긴 형식 — 절 제목은 질문에서 짓고, 벤치 채점기의 서식은 쓰지 않는다", () => {
  it("물음꼴 어미를 떼고 30자 안에서 **띄어쓰기 경계**로 끊는다", () => {
    expect(절제목("기본 공유를 중지하면 어떤 영향을 받나요?")).toBe("기본 공유를 중지하면 어떤 영향을 받");
    expect(절제목("보안 패치란 무엇인가요?")).toBe("보안 패치란");
    expect(절제목("")).toBe("관련 항목");
    expect(절제목("가".repeat(80)).length).toBeLessThanOrEqual(30);
  });

  it("★ 벤치 채점기의 6절을 통째로 쓴 답은 **재료가 아니다**(시험을 답에 맞추면 점수만 오른다)", () => {
    const 벤치 = ["제목", "대상 자산", "위험 요약", "조치 방법", "조치 기한", "담당 부서"]
      .map((n) => `## ${n}\n본문`).join("\n\n");
    expect(금지절썼나(벤치)).toBe(true);
    expect(금지절썼나("## 조치 기한\n본문\n\n## 점검 방법\n본문"), "낱말 하나는 허용이다").toBe(false);
  });
});

describe("★ 언어·거절 — 적어 놓은 숫자를 실제로 맞춘다", () => {
  const 행 = (조각: string) => ({
    question: "질문" + 조각.slice(0, 6), answer: "답",
    system: "팀원 프롬프트\n\n" + 머리말 + "\n[1] " + 조각,
  });

  it("한국어 원천 비중이 목표에 못 미치면 영어 원천 행을 덜어 낸다", () => {
    const rows = [행("한국어 근거 본문입니다"), ...Array.from({ length: 9 }, (_, i) => 행(`english evidence body number ${i}`))];
    const { rows: 고른, 보고 } = 언어맞추기(rows, { 머리말, 목표한글: 0.5 });
    expect(보고.ko).toBe(1);
    expect(고른.length).toBe(2);          // ko 1 + en 1 = 50%
    expect(보고.덜어낸영어).toBe(8);
  });

  it("★ 거절 비중 탐색은 결정적이고, 띠 안에 못 넣으면 **못 맞췄다고 말한다**", () => {
    // 굽기(p) — pOracle이 클수록 거절이 줄어드는 가짜 판(단조성만 흉내 낸다)
    const 굽기 = (p: number) => ({
      rows: Array.from({ length: 100 }, (_, i) => ({
        question: `q${i}`, answer: i < Math.round((1 - p) * 100) ? 제품거절문장 + " 그 뒤 설명" : "근거를 인용한 답",
      })),
    });
    const r = 거절비율맞추기(굽기 as never, { 띠: [0.4, 0.5] });
    expect(r.띠안).toBe(true);
    expect(r.비).toBeGreaterThanOrEqual(0.4);
    expect(r.비).toBeLessThanOrEqual(0.5);
    const 못 = 거절비율맞추기((() => ({ rows: [{ question: "q", answer: "거절 아닌 답" }] })) as never, { 띠: [0.4, 0.5] });
    expect(못.띠안, "못 맞췄는데 맞췄다고 하면 표가 거짓이 된다").toBe(false);
  });

  it("순서키는 같은 입력에 같은 값이다(판이 갈리면 「이 판으로 구웠다」가 뜻을 잃는다)", () => {
    expect(순서키("가나다")).toBe(순서키("가나다"));
    expect(순서키("가나다")).not.toBe(순서키("가나라"));
  });
});

describe("★ 걷어내기 — C에 걸린 행은 딱지를 고치지 않고 뺀다", () => {
  it("창에 걸린 행만 빠지고, 남은 행은 grade 칸이 O다", () => {
    const 본문 = "기밀로 분류된 사내 대응 절차의 본문이며 담당자는 즉시 상황실에 보고하고 격리 절차를 수행한다 이 문장은 창이 여러 개 나오도록 충분히 길게 적는다";
    const 집합 = 창들만들기(본문);
    const rows = [
      { question: "정상 질문", answer: "정상 답", system: "근거 없음", grade: "O" },
      { question: "샌 질문", answer: "정상 답", system: "머리\n" + 본문, grade: "O" },
    ];
    const { rows: 남긴, 지운 } = 창걸러내기(rows, 집합);
    expect(지운).toBe(1);
    expect(남긴).toHaveLength(1);
    expect(남긴[0].question).toBe("정상 질문");
    expect(등급관문(남긴, 집합).ok).toBe(true);
  });

  it("★ 걷어내는 자를 새로 안 적는다 — strip-c.mjs의 걷어내기를 부른다(소스 감시)", () => {
    const s = 빌더();
    expect(s).toContain('import(pathToFileURL(path.join(여기, "strip-c.mjs")).href)');
    expect(s).toContain("걷어내기(rows, 지도, 창집합)");
    // 창 규격을 여기서 다시 적으면 그것이 곧 잣대 두 벌이다.
    expect(s, "창 길이를 새로 적었다").not.toMatch(/창길이\s*=\s*\d+/);
  });

  it("★ 잣대는 material-r5의 것을 그대로 쓴다(창 40 · 걸음 1 · 적중 2)", () => {
    expect(잣대지문()).toEqual({ 창길이: 40, 창걸음: 1, 창최소적중: 2, 질문열쇠: "sha256/16", 창열쇠: "sha1/12" });
  });
});

describe("★ 커밋된 산출물 — 말한 대로인가", () => {
  const 보고서 = JSON.parse(src("tools/team-bench/results-ladder/raft-vuln-v6/build-report.json"));
  const 홀드 = JSON.parse(src("tools/team-bench/holdout-vuln-o.json"));
  const 긴형식 = JSON.parse(src("tools/team-bench/results-ladder/day2/build/longform-vuln-v3-o.json"));
  const 표본 = JSON.parse(src("tools/team-bench/samples-questions.json"));

  it("빌드 보고서가 **지금 잣대로 구운 판**이라고 말한다(옛 판이면 여기가 먼저 빨강이다)", () => {
    expect(보고서.잣대).toEqual(잣대지문());
    expect(보고서.창생성걸음).toBe(창생성걸음);
    expect(보고서.관문.ok).toBe(true);
    expect(보고서.홀드관문.ok).toBe(true);
    expect(보고서.긴관문.ok).toBe(true);
  });

  it("★ 커밋된 파일이 보고서에 적힌 **그 판**이다(지문 대조 — 보고서만 남고 판이 갈리는 일을 막는다)", () => {
    const 지문 = (rel: string) =>
      require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(루트, rel))).digest("hex").slice(0, 16);
    expect(지문("tools/team-bench/holdout-vuln-o.json")).toBe(보고서.산출물.홀드아웃지문);
    expect(지문("tools/team-bench/results-ladder/day2/build/longform-vuln-v3-o.json")).toBe(보고서.산출물.긴형식지문);
  });

  it("★ 새 시험지는 **파일 머리에서** 「회전 4 이전과 비교 불가」라고 말한다", () => {
    const 머리 = Object.keys(홀드).join(" ");
    expect(머리).toContain("비교 불가");
    expect(Array.isArray(홀드.행)).toBe(true);
    expect(홀드.행.length).toBeGreaterThanOrEqual(100);
    expect(홀드.행.every((r: Record<string, unknown>) => r.grade === "O")).toBe(true);
    expect(홀드.행.every((r: Record<string, unknown>) => String(r.system ?? "").includes(머리말)), "시험지 행에 근거 블록이 없다").toBe(true);
  });

  it("★ 시험지 꼴을 학습기와 관문이 **둘 다** 읽는다(머리 칸 있는 객체 + 행 배열)", () => {
    // 학습기: server/scripts/finetune_qlora14b.py 평가파일읽기 — raw.get("행", raw)
    expect(src("server/scripts/finetune_qlora14b.py")).toContain('raw.get("행", raw)');
    // 관문: gradegate.mjs 행꺼내기 — 같은 꼴을 읽는다(한쪽만 읽으면 학습은 되는데 관문이 못 잰다)
    expect(src("tools/team-bench/gradegate.mjs")).toContain("행꺼내기");
  });

  it("긴 형식은 100행 이상이고 절이 셋 이상이며 등급 칸이 O다", () => {
    expect(긴형식.length).toBeGreaterThanOrEqual(100);
    expect(긴형식.every((r: Record<string, unknown>) => r.grade === "O")).toBe(true);
    for (const r of 긴형식) {
      const 절 = (String(r.answer).match(/^##\s.+$/gm) ?? []).length;
      expect(절, "절이 셋 미만인 행이 있다 — 긴 형식이 아니다").toBeGreaterThanOrEqual(3);
      expect(금지절썼나(String(r.answer)), "벤치 채점기 서식을 쓴 행이 있다").toBe(false);
    }
  });

  it("★ 긴 형식은 **교사가 지은 글이 아니다** — 승인된 답을 절로 모은 것이라고 스스로 밝힌다", () => {
    expect(긴형식.every((r: { meta?: { kind?: string } }) => r.meta?.kind === "approved-digest")).toBe(true);
    expect(긴형식.every((r: { meta?: { 문답?: string[] } }) => (r.meta?.문답?.length ?? 0) >= 3)).toBe(true);
  });

  it("★ 관문 ⑬·⑭의 모집단 24를 채웠다 — 조각이 **실제로 회수된** 문항으로", () => {
    const 조각든 = 표본.filter((x: Record<string, unknown>) => String(x.chunk ?? "").length >= 20);
    expect(조각든.length).toBeGreaterThanOrEqual(24);
    expect(조각든.every((x: Record<string, unknown>) => Array.isArray(x.cites) && (x.cites as unknown[]).length > 0)).toBe(true);
  });

  it("★ 표본 문항은 **커밋된 학습 재료와 한 문항도 안 겹친다**(겹치면 재는 것이 「외웠나」가 된다)", () => {
    const 재료질문 = new Set(긴형식.map((r: { question: string }) => 문항정규화(r.question)));
    const 겹친 = 표본.filter((x: { question: string }) => 재료질문.has(문항정규화(x.question)));
    expect(겹친, `겹친 문항 ${겹친.length}건`).toHaveLength(0);
  });

  it("★ 시험지도 학습 재료와 안 겹친다", () => {
    const 재료질문 = new Set(긴형식.map((r: { question: string }) => 문항정규화(r.question)));
    expect(홀드.행.filter((r: { question: string }) => 재료질문.has(문항정규화(r.question)))).toHaveLength(0);
  });

  it("★ 빌더가 표본 문항을 재료에서 뺀다(소스 감시 — 이 성질이 코드로 지켜진다)", () => {
    const s = 빌더();
    expect(s).toContain("시험재료");
    expect(s, "표본 문항 파일을 안 읽는다").toContain("samples-questions.json");
  });

  it("보고서가 「무엇을 왜 못 실었나」를 숫자로 남긴다(라이선스·회수 실패·복사 비율)", () => {
    const 제외 = 보고서.보고.재료.제외;
    expect(제외).toHaveProperty("라이선스");
    expect(제외).toHaveProperty("회수 실패");
    expect(제외).toHaveProperty("베낀 비율 초과");
    expect(보고서.보고.재료.한국어비중, "한국어 원천 ≥50%라고 적어 놓고 밑돌면 그 줄이 거짓이다").toBeGreaterThanOrEqual(0.5);
    expect(보고서.보고.재료.거절비중).toBeGreaterThanOrEqual(0.40);
    expect(보고서.보고.재료.거절비중).toBeLessThanOrEqual(0.50);
  });

  it("★ 긴 형식이 재료와 답을 **얼마나 나눠 쓰는지**를 숨기지 않는다", () => {
    expect(보고서.보고.긴형식.재료겹침).toBeDefined();
    expect(보고서.보고.긴형식.재료겹침.쓴문답).toBeGreaterThan(0);
  });
});

describe("★ 회전 설정 — v6를 가리키되, **다시 굽지 말라**고 스스로 말한다", () => {
  // ⚠ 2026-09-10 저녁에 발견한 자리: day2-train.sh 의 ① 단계는 build-raft-dataset.mjs 로 재료를 다시 굽고,
  //   evalHoldoutFile 이 있으면 `--holdout-out` 으로 그 파일을 **덮어쓴다**(day2-train.sh:335).
  //   그 빌더는 등급을 모른다 — 승인 문답 전부(C 1,597건 포함)로 v6를 새로 구워 놓고 새 시험지를 갈아 버린다.
  //   스크립트를 고치는 것은 이 갈래의 파일 밖이라, **설정이 스스로 경고하게** 하고 여기서 그것을 못 박는다.
  for (const id of ["r5a", "r5b"]) {
    it(`${id} 는 v6·새 시험지·긴 형식 v3-o를 가리킨다`, () => {
      const j = JSON.parse(src(`tools/team-bench/results-ladder/day2/${id}/round.json`));
      expect(j.dataset).toBe("raft-vuln-v6");
      expect(j.evalHoldoutFile).toBe("tools/team-bench/holdout-vuln-o.json");
      expect(j.longformDataset).toBe("server/data/datasets/longform-vuln-v3-o.json");
      // 시험지가 둘이면 어느 것으로 쟀는지 알 수 없다 — day2-train.sh 도 학습기도 같은 이유로 막는다.
      expect(j.evalHoldout, "evalHoldoutFile 과 evalHoldout 을 함께 두면 시험지가 둘이 된다").toBeUndefined();
    });

    it(`★ ${id} 에 **빌드금지** 경고가 있고, 덮어쓰기 위험을 이름으로 말한다`, () => {
      const j = JSON.parse(src(`tools/team-bench/results-ladder/day2/${id}/round.json`));
      expect(j.빌드금지, "이 경고가 없으면 다음 사람이 day2-train.sh 를 그냥 돌린다").toBeTruthy();
      expect(j.빌드금지).toContain("holdout-out");
      expect(j.빌드금지).toContain("skip-build");
    });
  }

  it("★ 그 위험이 **실제로 있는** 코드다 — 경고가 낡으면 여기가 먼저 말한다", () => {
    // 경고가 「없는 위험」을 가리키게 되는 날(스크립트가 고쳐지는 날) 이 시험이 빨개져서,
    // 경고를 지울 때가 됐음을 알린다. 고칠 수 없는 빨강이 아니라 **갱신을 부르는 빨강**이다.
    const 스크립트 = src("tools/ladder/day2-train.sh");
    expect(스크립트).toContain('--holdout-out "$REPO/$EVAL_HOLDOUT_FILE"');
    expect(스크립트, "빌드금지를 읽는 줄이 생겼다면 round.json 의 경고를 갱신할 때다").not.toContain("빌드금지");
  });
});
