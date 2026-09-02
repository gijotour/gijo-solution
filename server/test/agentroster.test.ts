// agentroster.test.ts — AI 팀 등록부 계약: 7번째 팀원 Curator(사서)와 「부르는 문」(2026-09-03).
//
// 왜 이 시험인가(계획서 GIJO_AS_AI팀_증류학습_계획서.md §7 병행·설계관 2026-09-03):
//   팀원이 여섯이었는데 실제로 LLM을 부르는 문이 있는 팀원은 넷이었다(scan·ti는 호출 0). 문서 반입의 LLM
//   호출 다섯 곳은 analysis/report가 **이름만 빌려** 쓰고 있어 감독 화면에는 「분석 팀원이 문서를 분류했다」로
//   찍혔다. 팀원은 등록부에 적는 것이 아니라 **부르는 문**이 만든다 — 이 시험은 그 문을 소스에서 센다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { listAgents, getAgentById } from "../src/engine/agents";
import { ROLE_CATEGORY, categoriesForRole } from "../src/engine/hybridsearch";
import { getAgentModelRecommendations } from "../src/engine/modeldex";

const ENGINE = path.join(__dirname, "..", "src", "engine");
const read = (f: string) => fs.readFileSync(path.join(ENGINE, f), "utf8");

describe("등록부 — 사서(curator)는 7번째 팀원이다", () => {
  it("일곱 명이고 사서가 맨 뒤(레일·사무실 책상 순서 = 등록부 순서)", () => {
    const ids = listAgents().map((a) => a.id);
    expect(ids).toEqual(["orchestrator", "scan", "analysis", "report", "ti", "normaltic", "curator"]);
  });

  it("사서의 약자·기본 상태·역할 — 레일 툴팁 [사서]와 사무실 명패가 여기서 나온다", () => {
    const c = getAgentById("curator")!;
    expect(c.abbr).toBe("사서");
    expect(c.defaultStatus).toBe("idle"); // 요청응답형 — 상시 루프가 없는데 watching이라 적으면 거짓
    expect(c.role).toMatch(/문서/);
    expect(c.desc).toMatch(/분류/);
  });

  it("분석(analysis)은 문서 분류·보강을 더는 자기 일로 적지 않는다(사서에게 넘어감)", () => {
    const a = getAgentById("analysis")!;
    expect(a.role).not.toMatch(/지식/);
    expect(a.desc).toMatch(/Curator|사서/);
  });

  it("검색 우선영역 표에 사서 자리가 있고 비어 있다(전 영역 평등 — 문서 분류가 한 영역으로 치우치면 안 된다)", () => {
    expect(ROLE_CATEGORY.curator).toEqual([]);
    expect(categoriesForRole("curator")).toEqual([]);
  });

  it("모델 도감 추천에 사서가 있다(추천 없는 팀원은 AI 팀 화면에서 빈 칸이 된다)", () => {
    expect(getAgentModelRecommendations().curator).toBeDefined();
  });
});

describe("부르는 문 — 팀원 이름은 실제 호출부가 만든다", () => {
  // 문서 반입의 LLM 호출 다섯 곳. 파일:프롬프트 머리로 잡는다 — 줄 번호는 움직여도 프롬프트는 안 움직인다.
  const 문서반입_호출 = [
    ["memory.ts", "다음 문서가 어느 업무 자료인지"],
    ["memory.ts", "다음 문서를 아래 4가지 중"],
    ["docdigest.ts", "다음 문서를 딱 세 줄로"],
    ["docenrich.ts", "${ENRICH_SYSTEM}"],
    ["securityproducts.ts", "message: buildFieldDraftPrompt("], // 함수 정의가 아니라 호출 자리
  ] as const;

  it("문서 반입 LLM 호출 다섯 곳은 전부 사서(curator)가 부른다", () => {
    for (const [file, 머리] of 문서반입_호출) {
      const src = read(file);
      const at = src.indexOf(머리);
      expect(at, `${file}: 「${머리}」 호출이 사라졌다`).toBeGreaterThan(0);
      // 그 호출 앞 600자 안의 마지막 agentId가 curator여야 한다.
      const 앞 = src.slice(Math.max(0, at - 600), at);
      const ids = [...앞.matchAll(/agentId: "([a-z]+)"/g)].map((m) => m[1]);
      expect(ids.at(-1), `${file}: 「${머리}」 호출의 agentId`).toBe("curator");
    }
  });

  it("검색어 재작성은 짝 있는 신호(start↔done/error)로 사서의 일을 센다 — done만 내면 레일이 일하는 중인 불을 꺼 버린다", () => {
    const src = read("searchrewrite.ts");
    expect(src).toMatch(/emitLlmActivity\(\{ kind: "chat", phase: "start", agent: "curator", agentName: "Curator Agent"/);
    expect(src).toMatch(/emitLlmActivity\(\{ kind: "chat", phase: "done", agent: "curator", agentName: "Curator Agent"/);
    expect(src).toMatch(/emitLlmActivity\(\{ kind: "chat", phase: "error", agent: "curator", agentName: "Curator Agent"/);
    // 질문 원문은 신호에 싣지 않는다 — 활동 신호는 전 접속자에게 방송된다(검토관 2026-09-03)
    expect(src).not.toMatch(/detail: `검색어 재작성: \$\{/);
  });

  it("대시보드·팀 화면 아이콘표에 등록부 id가 전부 있다(빠지면 그 팀원만 폴백 ◆로 그려진다)", () => {
    const pages = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");
    const dash = fs.readFileSync(path.join(pages, "dashboard.html"), "utf8");
    const icon = dash.slice(dash.indexOf("var AGENT_ICON = {"), dash.indexOf("};", dash.indexOf("var AGENT_ICON = {")));
    const agent = fs.readFileSync(path.join(pages, "agent.html"), "utf8");
    const style = agent.slice(agent.indexOf("const AGENT_STYLE = {"), agent.indexOf("\n  };", agent.indexOf("const AGENT_STYLE = {")));
    for (const a of listAgents()) {
      expect(icon, `dashboard.html AGENT_ICON에 ${a.id}가 없다`).toMatch(new RegExp(`\\b${a.id}: "`));
      expect(style, `agent.html AGENT_STYLE에 ${a.id}가 없다`).toMatch(new RegExp(`\\b${a.id}: \\{`));
    }
  });

  it("협업 창(office·팀사무실)의 문서 흐름 말풍선은 사서가 낸다", () => {
    const m = read("memory.ts");
    expect(m).toContain('to: "curator", message: `문서 분류 요청');
    expect(m).toMatch(/from: "curator",\s+to: "orchestrator",\s+message: `문서 분류 완료/);
    expect(m).toMatch(/from: "curator",\s+to: "orchestrator",\s+message: `매뉴얼 자동 연결/);
    expect(read("docenrich.ts")).toMatch(/from: "curator",\s+to: "orchestrator",\s+message: `문서 보강 인입/);
    // 반입 소식 말풍선 — 예전엔 존재하지 않는 id "analyze"로 나가 사무실이 분석 팀원 자리에 띄웠다(검토관 2026-09-03)
    expect(read("docdigest.ts")).toContain('from: "curator", to: "orchestrator", message: 반입알림문구(m)');
  });

  it("★ 팀원마다 부르는 문이 있다 — 없으면 이유가 적혀 있어야 한다(등록부에만 있는 팀원 금지)", () => {
    // 2단계(계획서 §7)에서 문이 생길 팀원은 이유와 함께 예외로 둔다. 문이 생기면 예외를 지운다 — 이 시험이 그때 다시 말한다.
    // 2단계(2026-09-03 같은 날)에서 scan(scandrafts.draftScanInterpretation)·ti(scandrafts.interpretThreats)의 문이 생겨 예외가 비었다.
    // (총괄도 예외가 아니다 — agentloop·dispatcher가 agentId "orchestrator"로 수십 곳 부른다. 예외 사유가 사실과 달랐다: 검토관 2026-09-03)
    const 예외: Record<string, string> = {};
    const files = (fs.readdirSync(ENGINE, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
    const 전부 = files.map((f) => read(f)).join("\n");
    // 「부르는 문」= LLM을 실제로 부르는 자리: chat({ … agentId: "id" }) 또는 활동 신호 emitLlmActivity({ … agent: "id" }).
    // intent.ts의 { agentId: "scan", action: "scan" } 같은 **라우팅 표기**는 문이 아니다(모델을 안 부른다).
    const 문수 = (id: string) =>
      (전부.match(new RegExp(`chat\\(\\{[\\s\\S]{0,300}?agentId: "${id}"`, "g")) ?? []).length +
      (전부.match(new RegExp(`emitLlmActivity\\(\\{[^\\n]*agent: "${id}"`, "g")) ?? []).length;
    for (const a of listAgents()) {
      if (예외[a.id]) continue;
      expect(문수(a.id), `${a.id}: 소스 어디서도 LLM을 부르지 않는다 — 등록부에만 있는 팀원은 「동작하는 척」이다`).toBeGreaterThan(0);
    }
    // 예외가 실제 사실인지도 본다 — 문이 생겼는데 예외에 남아 있으면 예외를 지우라고 알린다.
    for (const id of Object.keys(예외)) {
      const 문 = 문수(id);
      expect(문, `${id}: 이제 부르는 문이 있다(${문}곳) — 예외 목록에서 지워라`).toBe(0);
    }
  });
});

describe("팀 구성 변경은 감사 기록에 남는다(누가 어느 팀원의 두뇌를 바꿨나)", () => {
  it("네 설정 함수 전부 recordAudit 경로(감사)를 지난다 — 소스 감시", () => {
    const src = read("agents.ts");
    for (const fn of ["setAgentName", "setAgentAdapter", "setAgentLocation", "setAgentModel"]) {
      const body = src.slice(src.indexOf(`export function ${fn}(`), src.indexOf("\n}\n", src.indexOf(`export function ${fn}(`)));
      expect(body, `${fn}: 감사 기록이 없다`).toContain("감사(agentId,");
      // 해제 가지만 잘라서 본다 — 예전 정규식(return; 앞뒤에 감사( 가 있기만 하면 통과)은 항진식이었다(검토관 2026-09-03).
      const 해제시작 = body.indexOf("delModelStmt.run");
      const 해제가지 = body.slice(해제시작, body.indexOf("return;", 해제시작));
      expect(해제가지, `${fn}: 해제 가지도 감사에 남아야 한다`).toContain("감사(agentId,");
    }
    // 라우트가 행위자를 넘긴다(넘기지 않으면 actor가 늘 null — 「누가」가 빠진 감사는 반쪽이다)
    expect((src.match(/행위자\(req\)/g) ?? []).length).toBe(4);
  });
});
