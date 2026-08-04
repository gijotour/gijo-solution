// 147상황 회귀 5건 — [2026-08-04 · 계획서 전-1(시연 4시나리오)·중-3(평가 게이트)]
//
// 데이터를 16건 → 4,833건으로 되살린 뒤 146/147 → 142/147로 떨어졌다. 떨어진 5건은
// **데이터가 커져야 드러나는 결함**이었다 — 작을 땐 아무도 몰랐다.
//
// ⚠ 이 시험은 **소스를 읽는다.** 동작만 보면 「고쳤다고 주석에 적어 놓고 코드가 안 지키는 것」을
//   못 잡는다(2026-07-29 17건 실측). 그리고 감시가 헛돌고 있지 않은지도 함께 잰다.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { 대명사뿐인가 } from "../src/engine/agentloop";

const 읽기 = (p: string) => readFileSync(join(__dirname, "..", "src", p), "utf8");

describe("① 「SSH 취약점 찾아줘」가 2,561자 — 우리 제품 문서가 남의 점검 보고서로 둔갑했다", () => {
  const src = 읽기("engine/agenttools.ts");

  it("★★ 제품 이름은 자산 표식이 될 수 없다 — 「GIJO」 하나로 전 사내 문서가 걸렸다", () => {
    expect(src, "제품이름인가 걸름망이 있어야 한다").toContain("function 제품이름인가");
    expect(src, "표식을 뽑을 때 실제로 불러야 한다 — 만들어 놓고 안 부르면 그대로 샌다")
      .toMatch(/고유낱말[\s\S]{0,400}제품이름인가\(/);
  });

  it("★ 우리 제품 문서(GIJO_AS_*)는 어느 자산의 점검 보고서도 아니다", () => {
    expect(src).toContain("function 자산점검문서인가");
    // 걸름망이 실제로 GIJO_AS_ 이름을 막는지 — 정규식만 있고 안 쓰면 소용없다.
    expect(src).toMatch(/자산점검문서인가[\s\S]{0,600}GIJO/);
    expect(src, "발췌 후보를 고를 때 불러야 한다").toMatch(/후보\s*=\s*raw\.filter\(\(c\)\s*=>\s*자산점검문서인가/);
  });

  it("★ 「사내 점검 보고서」라고 단정하지 않는다 — 어느 문서인지 밝힌다", () => {
    expect(src, "단정 문구가 남아 있으면 안 된다").not.toContain("**사내 점검 보고서**에 적혀 있습니다");
    expect(src, "문서 이름을 넣어 말해야 한다").toMatch(/「\$\{발췌\.문서\}」/);
  });

  it("발췌 길이를 줄였다 — 600자×3=1,800자가 답을 2,561자로 만들었다", () => {
    const m = src.match(/글\.slice\(0,\s*(\d+)\)/);
    expect(m, "발췌 길이 자르기가 있어야 한다").toBeTruthy();
    expect(Number(m![1]), "한 조각 300자 이하").toBeLessThanOrEqual(300);
    expect(src, "조각 수도 2개 이하").toMatch(/확인된\.slice\(0,\s*[12]\)/);
  });

  it("⚠ 감시가 헛돌지 않는가 — 살균이 조각을 버려도 문서 이름이 어긋나지 않아야 한다", () => {
    // sanitizeRagChunks는 조각을 버린다. 한꺼번에 넣고 인덱스로 문서를 되찾으면 어긋난다.
    expect(src, "한 조각씩 살균해야 한다").toMatch(/for\s*\(const c of 후보\)[\s\S]{0,300}sanitizeRagChunks\(\[c\.text\]/);
  });
});

describe("② 「자산 중에 AI-BOM 비어 있는 거 뭐야?」가 27자 — 규칙에 아예 안 걸렸다", () => {
  const loop = 읽기("engine/agentloop.ts");
  const tools = 읽기("engine/agenttools.ts");

  it("★ AI-BOM 창구가 있다", () => {
    expect(loop).toMatch(/re:\s*\/ai\[-\\s_\]\?bom\/i,\s*\n\s*tool:\s*"aibom_status"/);
  });

  it("★★ SBOM은 AI-BOM 규칙에 걸리지 않는다 — 「SBOM」 안에 「ai」가 없다", () => {
    const aibom = /ai[-\s_]?bom/i;
    expect(aibom.test("SBOM 얼마나 채워졌어?"), "SBOM 질문이 AI-BOM으로 새면 안 된다").toBe(false);
    expect(aibom.test("자산 중에 AI-BOM 비어 있는 거 뭐야?")).toBe(true);
    expect(aibom.test("AI BOM 현황")).toBe(true);
  });

  it("「비어 있는」도 「비었」처럼 잡는다 — 사람은 둘 다 쓴다", () => {
    const re = /sbom[^.\n]{0,12}(얼마나|현황|범위|채워졌|채워져|정확|비었|비어\s?있|부족)/i;
    expect(re.test("SBOM 비어 있는 자산")).toBe(true);
    expect(loop, "제품 코드가 실제로 이 갈래를 가져야 한다").toContain("비어\\s?있");
  });

  it("★★ AI-BOM 현황이 내부 id를 보이지 않는다 — `vuln:192.168.219.98`은 읽는 글자가 아니다", () => {
    expect(tools, "머리줄").toMatch(/const head = `\$\{자산표시이름\(a\.id\)\}/);
    expect(tools, "목록줄").toMatch(/- \$\{자산표시이름\(r\.a\.id\)\}/);
  });

  it("★★ 없는 명령을 안내하지 않는다 — 따라가면 막다른 길이 된다", () => {
    expect(tools, "AI-BOM을 채우는 대화창 도구는 아직 없다").not.toContain('"○○ AI-BOM 채워줘"');
    // 안내한 명령은 실제 도구가 있어야 한다.
    expect(tools).toContain('"○○ SBOM 만들어줘"');
    expect(tools, "generate_sbom이 실제로 있어야 그 안내가 참이 된다").toContain('name: "generate_sbom"');
  });
});

describe("③④ 절차 질문이 35초·33초 — 규칙에 없어 남의 제품 가이드를 읽어 줬다", () => {
  const loop = 읽기("engine/agentloop.ts");
  const tools = 읽기("engine/agenttools.ts");

  it("★ 「○○ 단계에서 뭘 해야 해?」·「다음 단계가 뭐야?」가 규칙에 걸린다", () => {
    const m = loop.match(/re:\s*(\/\(단계\|절차\)[^\n]+\/),\s*\n\s*tool:\s*"workflow_status"/);
    expect(m, "workflow_status 규칙을 찾지 못했다").toBeTruthy();
    const re = eval(m![1]) as RegExp;
    expect(re.test("발견 단계에서 뭘 해야 해?"), "35초짜리 물음").toBe(true);
    expect(re.test("이 취약점 다음 단계가 뭐야?"), "33초짜리 물음").toBe(true);
    expect(re.test("지금 우리 어느 단계가 제일 밀렸어?"), "기존 물음도 그대로 걸려야 한다").toBe(true);
  });

  it("★★ 단계를 실제로 넘긴다 — 안 넘기면 묻지 않은 5단계 전체가 나온다", () => {
    expect(loop).toMatch(/f\.tool === "workflow_status"[\s\S]{0,300}stage: instruction/);
    expect(tools, "도구가 stage를 받아야 한다").toMatch(/절차현황글\(args\.stage/);
  });

  it("★ 단계별 「하는 일」이 코드에 박혀 있다 — 5단계 전부", () => {
    expect(tools).toContain("const 단계별할일");
    for (const no of [1, 2, 3, 4, 5]) {
      expect(tools, `${no}단계 항목이 없다`).toMatch(new RegExp(`\\n\\s*${no}:\\s*\\{\\s*일:`));
    }
  });

  it("★★ 2차: 「단계·절차」라는 말을 안 쓴 절차 질문도 잡는다 (1차가 절반만 덮었다)", () => {
    const m = loop.match(/re:\s*(\/\(단계\|절차\)[^\n]+\/),\s*\n\s*tool:\s*"workflow_status"/);
    const re = eval(m![1]) as RegExp;
    expect(re.test("우선순위 정하려면 뭘 봐야 해?"), "36초 걸리던 물음").toBe(true);
    expect(re.test("조치까지 갔는데 그다음은?"), "33초").toBe(true);
    expect(re.test("보고까지 끝내려면 뭐가 남았어?"), "34초").toBe(true);
  });

  it("★★ 남의 답을 빼앗지 않는다 — 「이 취약점 조치하려면?」은 그 건의 조치 절차다", () => {
    const m = loop.match(/re:\s*(\/\(단계\|절차\)[^\n]+\/),\s*\n\s*tool:\s*"workflow_status"/);
    const re = eval(m![1]) as RegExp;
    expect(re.test("이 취약점 조치하려면?"), "절차 현황이 아니라 그 취약점의 조치법을 물었다").toBe(false);
    expect(loop, "「하려면」을 넣으면 위 물음을 빼앗는다").not.toContain("|하려면|");
  });

  it("⚠ 감시가 헛돌지 않는가 — 단계 판별이 **한 곳**에만 있어야 한다", () => {
    // 두 곳에서 가르면 반드시 어긋난다(절차 숫자를 한 곳에서 세는 것과 같은 이유).
    expect(tools).toContain("function 질문속단계");
    expect(loop, "agentloop이 제 나름대로 단계를 가르면 안 된다").not.toContain("function 질문속단계");
  });
});

describe("⑥ 「위험도 높은 자산 알려줘」가 29자 — 목록을 물었는데 한 건을 답했다", () => {
  const loop = 읽기("engine/agentloop.ts");
  const tools = 읽기("engine/agenttools.ts");
  const re = /(위험도?\s*(높은|높음|큰)|고위험|위험한|위험\s*큰)\s*(ai\s*)?자산/i;

  it("★ 고위험 자산 목록으로 간다", () => {
    expect(loop).toMatch(/tool: "list_assets",\s*\n\s*args: \{ risk: "high" \}/);
    expect(re.test("위험도 높은 자산 알려줘")).toBe(true);
    expect(re.test("고위험 자산 뭐 있어?")).toBe(true);
  });

  it("★★ 「위험한 취약점」은 가로채지 않는다 — 자산 목록이 아니다", () => {
    expect(re.test("위험한 취약점 알려줘"), "'자산'이라는 말이 있어야 한다").toBe(false);
    expect(re.test("제일 위험한 거 하나만")).toBe(false);
  });

  it("★★ 등급 판정이 화면·KPI와 **같은 규칙**이다 — 어긋난 두 숫자는 둘 다 못 믿게 만든다", () => {
    expect(tools).toContain("function 자산위험등급");
    // kpi.ts riskCounts와 같은 규칙: critical/high → 고위험, medium → 중위험
    expect(tools).toMatch(/sev\.has\("critical"\) \|\| sev\.has\("high"\)[\s\S]{0,40}return "high"/);
    const kpi = 읽기("engine/kpi.ts");
    expect(kpi, "KPI 쪽 규칙이 바뀌면 이 시험이 알려 준다").toMatch(/sev\.has\("critical"\) \|\| sev\.has\("high"\)/);
  });
});

describe("⑦ 「KEV 걸린 거 있어?」 40초 — 「몇 건」이 없으면 세는 질문을 비켰다 (4차)", () => {
  const loop = 읽기("engine/agentloop.ts");
  it("★ KEV 걸린/잡힌/뜬 + 있어/없어 꼴이 세는 질문으로 간다", () => {
    const m = loop.match(/re:\s*(\/\(미배정[^\n]+\/i),\s*\n\s*tool:\s*"finding_status"/);
    expect(m, "finding_status 규칙을 못 찾았다").toBeTruthy();
    const re = eval(m![1]) as RegExp;
    expect(re.test("KEV 걸린 거 있어?")).toBe(true);
    expect(re.test("kev 뜬 것 없어?")).toBe(true);
    expect(re.test("미배정 몇 건이야?"), "기존 물음 그대로").toBe(true);
  });
  it("★★ 시연 대본을 가로채지 않는다 — 「KEV 등재 … 지침이 뭐야?」는 지식 질문이다", () => {
    const m = loop.match(/re:\s*(\/\(미배정[^\n]+\/i),\s*\n\s*tool:\s*"finding_status"/);
    const re = eval(m![1]) as RegExp;
    expect(re.test("KEV 등재 취약점 조치 기한 근거 지침이 뭐야?"), "시연 ③ 대본 문항").toBe(false);
  });
});

describe("「이 화면 설명해줘」 — 앱이 유도하는 말이 함수에 안 걸렸다 (게이트가 잡음)", () => {
  it("★★ 이 화면 설명해줘/안내해줘가 화면안내로 간다", async () => {
    const { isHelpIntent } = await import("../src/engine/screenguide");
    expect(isHelpIntent("이 화면 설명해줘", "analysis.html"), "앱 상단 「이 화면 설명 듣기」가 유도하는 말").toBe(true);
    expect(isHelpIntent("이 화면 안내해줘", "inventory.html")).toBe(true);
    expect(isHelpIntent("이 화면 소개해줘", "dashboard.html")).toBe(true);
  });

  it("★ 홀로 「설명해줘」는 잡지 않는다 — 대상이 없어 화면안내가 아니다", async () => {
    const { isHelpIntent } = await import("../src/engine/screenguide");
    expect(isHelpIntent("설명해줘", "analysis.html")).toBe(false);
    expect(isHelpIntent("Log4Shell 설명해줘", "vulnscan.html"), "취약점 설명은 explain의 몫").toBe(false);
  });
});

describe("지적함 2건 — 규칙이 없어 모델이 매번 다르게 골랐다 (2026-08-04)", () => {
  const loop = 읽기("engine/agentloop.ts");
  const 규칙 = (tool: string): RegExp => {
    const m = loop.match(new RegExp(`re:\\s*(/[^\\n]+/),\\s*\\n\\s*tool:\\s*"${tool}"`));
    if (!m) throw new Error(`${tool} 규칙을 못 찾았다`);
    return eval(m[1]) as RegExp;
  };

  it("★ 「오늘 로그에서 이상 징후 있어?」가 관제 허브로 간다 — 들쭉날쭉은 못 믿는 답이다", () => {
    const re = 규칙("analysis_status");
    expect(re.test("오늘 로그에서 이상 징후 있어?")).toBe(true);
    expect(re.test("로그에 수상한 거 있나?")).toBe(true);
    expect(re.test("통합 보안 분석 현황"), "기존 물음도 그대로").toBe(true);
  });

  it("★ 3차: 「이상한 접속 시도 있었어?」 — 회차마다 답이 달랐다(29.9초 → 되물음)", () => {
    const re = 규칙("analysis_status");
    expect(re.test("이상한 접속 시도 있었어?")).toBe(true);
    expect(re.test("수상한 로그인 있었나?")).toBe(true);
  });

  it("★ 3차: 「검증은 어떻게 하는 거야?」(32초) — 단계 이름 + 은/는 + 어떻게", () => {
    const m = loop.match(/re:\s*(\/\(단계\|절차\)[^\n]+\/),\s*\n\s*tool:\s*"workflow_status"/);
    const re = eval(m![1]) as RegExp;
    expect(re.test("검증은 어떻게 하는 거야?")).toBe(true);
    expect(re.test("조치는 어떻게 해?")).toBe(true);
    // ⚠ 「은/는」을 요구해 **그 건을 지목한 물음**은 비켜 준다 — 그건 remediation의 몫이다.
    expect(re.test("이 취약점 조치 어떻게 해?"), "지목한 취약점의 조치법을 빼앗으면 안 된다").toBe(false);
  });

  it("★ 「○○ 취약점 정리해줘」가 우리 취약점을 답한다 — 남의 진단 방법론이 아니라", () => {
    const re = 규칙("search");
    expect(re.test("SSH 취약점 정리해줘")).toBe(true);
    expect(re.test("OpenSSH 취약점 정리해줘")).toBe(true);
    expect(re.test("안전대부 웹서버 취약점 알려줘"), "기존 물음도 그대로").toBe(true);
  });

  it("⚠ 감시가 헛돌지 않는가 — 대상 없는 「취약점 정리해줘」는 검색으로 끌고 가지 않는다", () => {
    // 검색어가 빈 채로 search를 부르면 전건이 쏟아진다(적용부에서 `if (!대상) continue`).
    const 대상 = "취약점 정리해줘".replace(/\s*(의|에)?\s*취약점.*$/, "").trim();
    expect(대상, "대상이 비면 규칙이 비켜서야 한다").toBe("");
  });
});

describe("⑤ 「그거 어떻게 해」가 25초 걸려 23자 — 모델이 결국 똑같이 되물었다", () => {
  const disp = 읽기("engine/dispatcher.ts");

  it("★ 대명사뿐인 말을 가린다 — 직전 대상이 있든 없든 판정은 같다", () => {
    expect(대명사뿐인가("그거 어떻게 해")).toBe(true);
    expect(대명사뿐인가("그거 뭐야")).toBe(true);
    expect(대명사뿐인가("아까 그거")).toBe(true);
  });

  it("★★ 진짜 지시는 잡지 않는다 — 되묻기로 삼키면 일이 멈춘다", () => {
    expect(대명사뿐인가("그 취약점 담당자 배정해줘")).toBe(false);
    expect(대명사뿐인가("오늘 뭐부터 해야 해?")).toBe(false);
    expect(대명사뿐인가("이 취약점 조치 절차 알려줘")).toBe(false);
  });

  it("★★ 어느 쪽이든 모델을 타지 않는다 — 대상이 있으면 짚고, 없으면 되묻는다", () => {
    expect(disp).toMatch(/if \(대명사뿐인가\(instructionText\)\)/);
    expect(disp, "대상이 있을 때의 즉답 경로").toMatch(/대명사확인\(대화열쇠\)[\s\S]{0,300}확인 \?\? 되물음\(\)/);
  });
});
