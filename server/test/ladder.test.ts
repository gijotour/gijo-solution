// 증류 사다리(계획서 §12)의 **자들**이 제대로 세는지 본다 — 게이트 판정 · 회차 이름표 · 재료 허용목록.
//
// 왜 이 시험이 있나:
//   이 셋은 전부 「틀리면 조용히 망하는」 종류다.
//     · 게이트가 헐거우면 → 나빠진 모델이 「합격」으로 채택된다(그리고 아무도 모른다).
//     · 회차 이름표가 겹치면 → 앞 회차 결과가 덮여 **사라진다**(비교할 것이 없어진다).
//     · 허용목록이 헐거우면 → 고객 자산·운영 DB가 학습 재료로 샌다(되돌릴 수 없다).
//   밤새 도는 자동화라 사람이 옆에서 안 본다. 자 자체를 여기서 잰다.
//
// ★ 「그 값을 누가 넣는가」 — 게이트가 읽는 값은 전부 **다른 자가 이미 남긴 것**이다:
//   20자 겹침은 tasks.mjs T6 채점기가, 점수·한글·tok/s는 run.mjs가 남긴다. 그래서 이 시험은
//   「게이트가 그 값을 다시 계산하지 않고 **그대로 읽는가**」를 함께 본다(잣대 단일 출처).
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  판정, 표만들기, kev판정, cisa본문, detail숫자, 인용겹침, 잘림수, tps중앙값, 한글평균, 기준선기본, NEEDLE64K,
} from "../../tools/team-bench/gates.mjs";
import {
  회차이름표, 회차번호, 허용인가, 참조정규화, 매니페스트파일들, 허용목록읽기, 재료가르기,
} from "../../tools/ladder/ladderlib.mjs";

// ── 재료: run.mjs가 남기는 꼴 그대로(필드 이름을 지어내지 않는다) ────────────
const 과제 = (score: number, extra: Record<string, unknown> = {}) => ({
  role: "x", score, ms: 1000, genTps: 20, 한글: 1, 한자: 0, finish: "stop", detail: "", ...extra,
});
const 기준easy = () => ({
  id: "base", tasks: {
    scan_extract: 과제(1),
    glossary_cite: 과제(1, { detail: "인용 1 · 20자겹침 1 · 핵심 1" }),
    tool_select: 과제(1, { 한글: 0 }),
  },
});
const 기준hard = () => ({
  id: "base", tasks: {
    ti_trap: 과제(0, { 한글: 0.9, detail: "맞음 2/2 · 오탐 3/4" }),
    // ⚠ needle_64k는 ctx 초과로 **요청 자체가 실패**한다 — finish가 없다(잘림과 다르다).
    [NEEDLE64K]: { role: "scan", score: 0, ms: 1899, 한글: 0, 한자: 0, detail: "요청 실패 400" },
  },
});
/** 기준선보다 나아진 실행(ti_trap 0 → 0.5). 나머지는 그대로. */
const 나아진 = () => {
  const h = 기준hard();
  h.tasks.ti_trap = 과제(0.5, { 한글: 0.9, detail: "맞음 2/2 · 오탐 1/4" });
  return h;
};
const kev좋음 = [
  { label: "prompt", q: "KEV 목록은 누가 발표해?", text: "KEV 목록은 미국 CISA가 발표합니다." },
  { label: "prompt", q: "KEV가 뭐야?", text: "사이버보안 및 인프라 보안국(CISA)이 관리합니다." },
  { label: "prompt", q: "누가 관리해?", text: "CISA입니다." },
];

describe("게이트 — KEV 발표 주체", () => {
  it("★ URL만 cisa.gov이고 본문은 딴소리인 답을 **잡는다**(2026-09-03 실측: 본문이 「보건복지부」였다)", () => {
    const 거짓 = "KEV 목록은 대한민국 보건복지부에서 발표합니다. 참고: https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
    expect(cisa본문(거짓), "URL을 세면 이 거짓이 통과한다").toBe(false);
    expect(cisa본문("KEV는 미국 CISA가 발표합니다.")).toBe(true);
  });

  it("대조군(noprompt)은 세지 않는다 — 같이 세면 절대 통과 못 한다", () => {
    const 섞임 = [...kev좋음, { label: "noprompt", q: "KEV?", text: "보건복지부입니다." }];
    const r = kev판정(섞임);
    expect(r.대상).toBe(3);
    expect(r.통과).toBe(true);
  });

  it("문항이 3개 미만이면 통과가 아니다 — 「3/3」의 3은 최소 문항 수다", () => {
    const r = kev판정(kev좋음.slice(0, 2));
    expect(r.성립).toBe(2);
    expect(r.통과, "2/2도 통과가 되면 문항을 줄여 게이트를 넘길 수 있다").toBe(false);
  });

  it("라벨이 아예 없는 파일은 전부를 대상으로 본다", () => {
    const r = kev판정(kev좋음.map(({ q, text }) => ({ q, text })));
    expect(r.대상).toBe(3);
    expect(r.통과).toBe(true);
  });
});

describe("게이트 — 잣대를 다시 계산하지 않고 인용한다", () => {
  it("20자 겹침은 채점기가 남긴 detail에서 읽는다", () => {
    expect(detail숫자("인용 1 · 20자겹침 1 · 핵심 1", "20자겹침")).toBe(1);
    expect(detail숫자("인용 1 · 20자겹침 0 · 핵심 0.4", "핵심")).toBe(0.4);
    expect(인용겹침(기준easy())).toBe(1);
  });

  it("detail이 그 꼴이 아니면 null — 0으로 적지 않는다(모르는 것과 없는 것은 다르다)", () => {
    expect(detail숫자("항목 6/6 · 심각도 6/6", "20자겹침")).toBeNull();
    expect(인용겹침({ tasks: {} })).toBeNull();
  });

  it("잘림은 finish=length만 센다 — 요청 실패(finish 없음)는 잘림이 아니다", () => {
    expect(잘림수(기준easy(), 기준hard()), "needle_64k의 400을 잘림으로 세면 원인을 잘못 읽는다").toBe(0);
    const 잘린 = 기준easy();
    잘린.tasks.scan_extract = 과제(1, { finish: "length" });
    expect(잘림수(잘린)).toBe(1);
    expect(잘림수(null, [{ finish: "length" }, { finish: "stop" }]), "samples 배열도 같은 규칙으로 센다").toBe(1);
  });

  it("한글 평균은 JSON만 뱉는 과제의 0도 포함해 잰다(기준선과 같은 방식이어야 견줄 수 있다)", () => {
    // scan_extract 1 · glossary_cite 1 · tool_select 0 → 2/3
    expect(한글평균(기준easy())).toBeCloseTo(2 / 3, 6);
  });

  it("tok/s 중앙값은 run.mjs 표와 같은 규칙(정렬 후 floor(n/2))으로 고른다", () => {
    const r = { tasks: { a: 과제(1, { genTps: 10 }), b: 과제(1, { genTps: 20 }), c: 과제(1, { genTps: 30 }) } };
    expect(tps중앙값(r)).toBe(20);
    expect(tps중앙값({ tasks: {} }), "잰 것이 없으면 null").toBeNull();
  });
});

describe("게이트 — 판정", () => {
  const 기준 = () => ({ easy: 기준easy(), hard: 기준hard() });

  it("★ 자기 자신과 견주면 불합격이다 — avg13은 「이상」이 아니라 **초과**를 요구한다", () => {
    const r = 판정({ easy: 기준easy(), hard: 기준hard(), kev: kev좋음 }, 기준());
    const avg = r.검사.find((c: { 키: string }) => c.키 === "avg13");
    expect(avg.통과, "본전이면 학습한 값이 없다").toBe(false);
    expect(r.합격).toBe(false);
  });

  it("나아진 실행은 일곱 관문을 모두 넘는다", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음 }, 기준());
    const 못넘음 = r.검사.filter((c: { 통과: boolean }) => !c.통과).map((c: { 이름: string }) => c.이름);
    expect(못넘음, `못 넘은 관문: ${못넘음.join(", ")}`).toEqual([]);
    expect(r.합격).toBe(true);
  });

  it("★ 입력이 없으면 「미측정」이고 전체는 **불합격**이다(fail-closed)", () => {
    const r = 판정({ easy: 기준easy(), hard: 나아진() }, 기준()); // kev 없음
    const kev = r.검사.find((c: { 키: string }) => c.키 === "kev");
    expect(kev.값).toBe("미측정");
    expect(kev.통과).toBe(false);
    expect(r.합격, "못 잰 것을 통과로 세면 게이트가 게이트가 아니다").toBe(false);
  });

  it("1회차 과제가 하나라도 떨어지면 막고, **어느 과제인지** 말한다", () => {
    const 깨진 = 기준easy();
    깨진.tasks.tool_select = 과제(0.5, { 한글: 0 });
    const r = 판정({ easy: 깨진, hard: 나아진(), kev: kev좋음 }, 기준());
    const c = r.검사.find((x: { 키: string }) => x.키 === "easy7_no_drop");
    expect(c.통과).toBe(false);
    expect(c.설명).toContain("tool_select");
    expect(c.설명).toContain("1→0.5");
  });

  it("과제를 아예 안 돌리고 평균만 올리는 길을 막는다(미실시도 하락으로 본다)", () => {
    const 빠뜨림 = 기준easy();
    delete (빠뜨림.tasks as Record<string, unknown>).tool_select; // 한글 0짜리 과제를 빼면 한글 평균이 올라간다
    const r = 판정({ easy: 빠뜨림, hard: 나아진(), kev: kev좋음 }, 기준());
    const c = r.검사.find((x: { 키: string }) => x.키 === "easy7_no_drop");
    expect(c.통과).toBe(false);
    expect(c.설명).toContain("안 돌린 과제");
  });

  it("needle_64k는 기본으로 평균에서 빠지고, 어느 쪽으로 쟀는지 **표에 적힌다**", () => {
    const 뺀것 = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음 }, 기준());
    const 넣은것 = 판정({ easy: 기준easy(), hard: 나아진(), kev: kev좋음 }, 기준(), { needle64k포함: true });
    const 값 = (r: { 검사: { 키: string; 값: unknown }[] }) => Number(r.검사.find((c) => c.키 === "avg13")!.값);
    expect(값(뺀것)).toBeGreaterThan(값(넣은것)); // 0점 하나가 더 들어가면 평균이 내려간다
    expect(표만들기(뺀것)).toContain("needle_64k 제외");
    expect(표만들기(넣은것)).toContain("needle_64k 포함");
  });

  it("생성 속도가 10% 넘게 떨어지면 막는다 — 두뇌가 스왑에 밀린 신호다", () => {
    const 느린 = 기준easy();
    for (const k of Object.keys(느린.tasks)) (느린.tasks as Record<string, { genTps: number }>)[k].genTps = 17; // 20 → 17 = 15% 낙폭
    const r = 판정({ easy: 느린, hard: 나아진(), kev: kev좋음 }, 기준());
    expect(r.검사.find((c: { 키: string }) => c.키 === "tps_drop").통과).toBe(false);

    const 조금느린 = 기준easy();
    for (const k of Object.keys(조금느린.tasks)) (조금느린.tasks as Record<string, { genTps: number }>)[k].genTps = 18.5; // 7.5%
    const r2 = 판정({ easy: 조금느린, hard: 나아진(), kev: kev좋음 }, 기준());
    expect(r2.검사.find((c: { 키: string }) => c.키 === "tps_drop").통과, "정상 범위의 느려짐까지 막으면 아무것도 못 채택한다").toBe(true);
  });

  it("표는 못 넘었을 때 「채택하지 않는다」를 말한다", () => {
    const 표 = 표만들기(판정({ easy: 기준easy(), hard: 기준hard() }, 기준()));
    expect(표).toContain("불합격");
    expect(표).toContain("채택하지 않는다");
  });
});

describe("게이트 — 저장소에 실린 기준선 파일", () => {
  it("★ 기준선 두 파일이 실제로 읽히고, needle_64k가 0이다(빼는 이유의 근거)", () => {
    for (const p of [기준선기본.easy, 기준선기본.hard]) {
      expect(existsSync(p), `기준선이 없다: ${p} — 게이트가 무엇과 견줄지 모르게 된다`).toBe(true);
    }
    const hard = JSON.parse(readFileSync(기준선기본.hard, "utf8"));
    expect(hard.tasks[NEEDLE64K].score, "qwen3-14b는 n_ctx_train 40960이라 74,256토큰을 못 받는다").toBe(0);
    const easy = JSON.parse(readFileSync(기준선기본.easy, "utf8"));
    expect(인용겹침(easy), "기준선의 20자 겹침을 못 읽으면 인용 관문이 통째로 미측정이 된다").toBe(1);
  });
});

describe("회차 이름표 — 앞 회차를 덮지 않는다", () => {
  it("빈 곳에서는 01부터", () => {
    expect(회차이름표("취약점", [])).toBe("취약점-01");
  });

  it("★ 있는 것 다음 번호를 준다 — 같은 이름을 두 번 주면 앞 결과가 사라진다", () => {
    expect(회차이름표("취약점", ["취약점-01.json", "취약점-02.json"])).toBe("취약점-03");
  });

  it("번호에 구멍이 있어도 최대+1이다(빈자리를 다시 쓰면 그 자리 로그와 어긋난다)", () => {
    expect(회차이름표("취약점", ["취약점-01.json", "취약점-05.json"])).toBe("취약점-06");
  });

  it("다른 주제 파일은 안 센다", () => {
    expect(회차이름표("일반", ["취약점-01.json", "취약점-02.json", "일반-01.json"])).toBe("일반-02");
  });

  it("곁다리 파일(로그·승인 결과)에 끌려가지 않는다", () => {
    expect(회차번호("취약점-01.approve.json", "취약점"), "확장자가 두 겹인 곁다리는 회차가 아니다").toBeNull();
    expect(회차번호("취약점-01.log", "취약점")).toBe(1);
    expect(회차번호("distill-취약점-2026-09-03-02-47.json", "취약점"), "시각 기반 원본 이름은 회차가 아니다").toBeNull();
    expect(회차이름표("취약점", ["취약점-01.json", "취약점-01.approve.json", "취약점-01.log"])).toBe("취약점-02");
  });
});

describe("재료 허용목록 — 허용만 적고 제외는 안 적는다", () => {
  const 목록 = 허용목록읽기();
  const 문맥 = { 매니페스트파일들: ["GIJO_AS_사용자_매뉴얼.md", "KISA_취약점_분석평가_상세가이드.md"] };
  const 된다 = (r: string) => 허용인가(r, 목록, 문맥).허용;

  it("우리 문서·지식 코퍼스·공개 원천은 재료가 된다", () => {
    expect(된다("GIJO_AS_취약점관리_지침.md"), "GIJO_ 앞머리").toBe(true);
    expect(된다("knowledge/보안용어.md"), "knowledge/*.md").toBe(true);
    expect(된다("KISA_취약점_분석평가_상세가이드.md"), "docs-manifest files[]").toBe(true);
    expect(된다("/home/gijohn_llm/bench/ladder/sources/nvd/cve-2024-21762.md"), "공개 원천 폴더").toBe(true);
    expect(된다("sources/kisa-kogl1/가이드.md"), "KISA는 KOGL 1유형 표기 이름 하나로 굳혔다").toBe(true);
    expect(된다("sources/kisa/가이드.md"), "gb10 실측에서 sources/kisa 는 빈 폴더였다 — 안 쓰는 이름을 열어 두지 않는다").toBe(false);
  });

  // [2026-09-03] 날것(sources/)을 .md로 구워 win으로 가져온 **학습 재료**. 증류기 --files 가 먹는 실제 경로다.
  //   여기가 허용에 없으면 밤새 도는 1일차가 「허용목록 밖 재료」로 즉사한다(굽고 나서 조용히 탈락).
  it("사다리 재료(server/data/ladder/material/…)는 재료가 된다 — 접두 아래 세트 폴더의 파일만", () => {
    expect(된다("server/data/ladder/material/day1/kev/kev-01.md")).toBe(true);
    expect(된다("server/data/ladder/material/day1/nvd-ours/nvd-ours-01.md")).toBe(true);
    expect(된다("server/data/ladder/material/day1/cisa-aa/cisa-aa-01.md")).toBe(true);
    expect(된다("D:/Connect AI/server/data/ladder/material/day1/attack/attack-03.md"), "절대경로로 넘어와도 잡힌다").toBe(true);
    expect(된다("server/data/ladder/material/day1/kev"), "폴더 자체는 재료가 아니다").toBe(false);
    expect(된다("server/data/ladder/material/day1/기타/무엇.md"), "세트 이름이 아니면 안 된다").toBe(false);
  });

  it("★ 접두를 벗어난 같은 이름의 폴더는 안 된다 — server/data 는 운영 데이터가 사는 곳이다", () => {
    expect(된다("server/data/kev/kev-01.md"), "ladder/material 밖이면 이름이 같아도 재료가 아니다").toBe(false);
    expect(된다("server/data/ladder/material/day1/kev/../../../gijo-as.sqlite"), "'..'은 규칙보다 먼저 막힌다").toBe(false);
  });

  it("★ 운영 데이터·고객 자료는 재료가 아니다 — 여기가 뚫리면 되돌릴 수 없다", () => {
    expect(된다("server/data/gijo-as.sqlite")).toBe(false);
    expect(된다("고객사_자산목록.xlsx")).toBe(false);
    expect(된다("server/data/backups/2026-09-01.sqlite")).toBe(false);
    expect(된다("client/src/renderer/pages/app.html"), "소스 코드도 학습 재료가 아니다").toBe(false);
  });

  it("★ 허용 폴더 안에서 밖으로 걸어 나가는 길을 막는다", () => {
    const v = 허용인가("sources/nvd/../../server/data/gijo-as.sqlite", 목록, 문맥);
    expect(v.허용).toBe(false);
    expect(v.왜).toContain("..");
  });

  it("store: 접두사와 #해시 꼬리를 벗겨서 본다(증류기가 그 꼴로 ref를 준다)", () => {
    expect(참조정규화("store:KISA_취약점_분석평가_상세가이드.md#2aed30e7f52b")).toBe("KISA_취약점_분석평가_상세가이드.md");
    expect(된다("store:KISA_취약점_분석평가_상세가이드.md#2aed30e7f52b")).toBe(true);
  });

  it("모르는 규칙(kind 오타)은 **통과시키지 않는다** — 허용목록의 오타로 문이 열리면 안 된다", () => {
    const 오타 = { 허용: [{ kind: "이름앞머리_오타", 값: "GIJO_" }] };
    expect(허용인가("GIJO_AS_사용자_매뉴얼.md", 오타, 문맥).허용).toBe(false);
  });

  it("sources/<폴더> 만으로는 안 되고 그 아래 파일이어야 한다", () => {
    expect(된다("sources/nvd")).toBe(false);
    expect(된다("sources/nvd/x.md")).toBe(true);
  });

  it("한 번에 가르면 거절 사유가 붙어 나온다(밤에 무엇이 왜 빠졌는지 남는다)", () => {
    const r = 재료가르기(["knowledge/a.md", "server/data/gijo-as.sqlite"], 목록, 문맥);
    expect(r.허용).toEqual(["knowledge/a.md"]);
    expect(r.거절).toHaveLength(1);
    expect(r.거절[0].왜).toBeTruthy();
  });

  it("실제 docs-manifest.json에서 files[]를 뽑아낼 수 있다(꼴이 바뀌면 여기서 걸린다)", () => {
    const m = JSON.parse(readFileSync(join(__dirname, "..", "docs-manifest.json"), "utf8"));
    const files = 매니페스트파일들(m);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f: string) => typeof f === "string" && f.length > 0)).toBe(true);
    expect(허용인가(files[0], 목록, { 매니페스트파일들: files }).허용).toBe(true);
  });
});

describe("회차 파일이 실제 디렉터리에서도 쌓인다", () => {
  it("파일을 만들며 이름표를 세 번 뽑으면 01·02·03이 된다", () => {
    const 뿌리 = mkdtempSync(join(tmpdir(), "gijo-ladder-"));
    try {
      const 이름들: string[] = [];
      for (let i = 0; i < 3; i++) {
        const l = 회차이름표("취약점", 이름들);
        writeFileSync(join(뿌리, `${l}.json`), "{}");
        이름들.push(`${l}.json`);
      }
      expect(이름들).toEqual(["취약점-01.json", "취약점-02.json", "취약점-03.json"]);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });
});
