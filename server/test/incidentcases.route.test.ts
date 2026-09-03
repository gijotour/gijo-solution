// test/incidentcases.route.test.ts — 📚 침해사고 히스토리의 **대화 길**(2026-09-03, 갈래 1 통합 — 계획서 전-7 「보여 주기」의 연장).
//
// ⚠ 왜 있나: incidentcases.html 칩이 「침해사고 히스토리 보여줘」를 대화창에 넣어 주는데 받아 줄 규칙이 없어
//   guidance-routing이 「읽기인데 모델 판단 1개」로 잡았다(갈래 D 보고). 도구 넷(incident_cases·register·delete·sources)은
//   갈래 A~C가 만들었고 **길만** 없었다 — 「기능을 만들었다」와 「그 말이 그 기능에 닿는다」는 다르다(incidentsteps.route와 같은 관심사).
// ⚠ 판정은 제품 함수(forcedToolFor)로 한다(helpers/routing 머리글 — 규칙을 떼어 내 내 정규식을 내가 확인하면 늘 통과한다).
//   앞 층(dispatcher 특수경로·화면안내)이 먼저 채 가면 강제 규칙은 영영 안 닿으므로, 앞 층 판별자도 같은 문장으로 잰다
//   (routes.ts 「중복 문서 확인」의 실사고: forcedToolFor만 재면 시험은 통과하는데 안 닿는다).
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import { forcedToolFor, runAgentLoop, extractToolArgsByModel, 사례주제어, resetContextForTests } from "../src/engine/agentloop";
import { findAgentTool } from "../src/engine/agenttools";
import { 길목록 } from "../src/engine/routes";
import { 침해사고질문인가 } from "../src/engine/incidentsteps";
import { 이름으로화면찾기, 방법질문화면찾기, isHelpIntent } from "../src/engine/screenguide";
import { isFindingListAsk, isMyWorkAsk } from "../src/engine/picklist";
import { isOutOfScope, isTooVague } from "../src/engine/scopeguard";

const 도착 = (q: string, role = "admin") => forcedToolFor(q, { role })?.tool ?? null;
const 인자 = (q: string, role = "admin") => forcedToolFor(q, { role })?.args ?? {};

beforeEach(() => { mockChat.mockReset(); resetContextForTests(); });

describe("📚 조회 — 「침해사고 히스토리 보여줘」류는 incident_cases로 못 박힌다", () => {
  it("★ 화면 칩이 넣어 주는 말(incidentcases.html data-prompts)이 규칙에 걸린다 — guidance-routing이 잡던 자리", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "incidentcases.html"), "utf8");
    const m = html.match(/data-prompts='(\[[^']+\])'/);
    expect(m, "incidentcases.html의 data-prompts를 못 읽었다 — 화면 꼴이 바뀌었다").toBeTruthy();
    const prompts = JSON.parse(m![1]) as string[];
    expect(prompts).toContain("침해사고 히스토리 보여줘");
    expect(도착("침해사고 히스토리 보여줘", "security_officer")).toBe("incident_cases");
    expect(인자("침해사고 히스토리 보여줘")).toEqual({}); // 대상 없음 — 최근 목록
  });

  it("담당자가 부르는 말들(terms.ts 별칭 계열)이 전부 닿는다", () => {
    for (const q of ["침해사고 히스토리 알려줘", "사고 사례 보여줘", "비슷한 사례 있어?", "침해 사례 알려줘", "해킹 사고 사례 어떤 게 있었어?", "유사 사례 보여줄래", "침해사고 사례 목록"]) {
      expect(도착(q), q).toBe("incident_cases");
    }
  });

  it("CVE가 있으면 cve 인자(hybridsearch CODE_RE — 대문자), 앵커 앞 낱말 하나면 q, 꾸밈말이면 빈 인자", () => {
    expect(인자("CVE-2021-44228 비슷한 사례 있어?")).toEqual({ cve: "CVE-2021-44228" });
    expect(인자("cve-2021-44228로 실제 사고 사례 있어?")).toEqual({ cve: "CVE-2021-44228" });
    expect(인자("랜섬웨어 사고 사례 알려줘")).toEqual({ q: "랜섬웨어" });
    expect(인자("Log4j로 비슷한 사례 있어?")).toEqual({ q: "Log4j" });
    expect(인자("병원의 침해사고 히스토리 보여줘")).toEqual({ q: "병원" });
    // 낱말 둘(「병원 해킹」)은 통째로 LIKE에 못 넣는다 — 앵커에 붙은 「해킹」은 꾸밈말이라 전체 목록(없는 것을 있다고도, 있는 것을 없다고도 안 한다)
    expect(인자("병원 해킹 사고 사례 알려줘")).toEqual({});
    expect(인자("실제 사고 사례 보여줘")).toEqual({});
    expect(사례주제어("국내 침해사고 히스토리")).toBe("");
    expect(사례주제어("SK텔레콤 사고 사례")).toBe("SK텔레콤");
  });

  it("★ 「추천」이 붙어도 조회는 살아 있다 — 샘 규칙은 **매체 낱말**이 있을 때만 이긴다(검토관 2026-09-03)", () => {
    // 예전엔 배제어에 「추천」이 있어 「사고 사례 추천해줘」가 통째로 막혀 모델 판단으로 샜다.
    for (const q of ["사고 사례 추천해줘", "침해사고 히스토리 추천해줘", "비슷한 사례 추천해줘", "랜섬웨어 사고 사례 추천해줘"]) {
      expect(도착(q, "security_officer"), q).toBe("incident_cases");
    }
    // 매체 낱말(유튜브·사이트·소식)이 붙으면 앞에 있는 「사례의 샘」이 이긴다 — 배열 순서가 경계다
    for (const q of ["해킹 사례 유튜브 추천해줘", "보안 사고 소식 사이트 추천해줘"]) {
      expect(도착(q, "security_officer"), q).toBe("incident_sources");
    }
  });

  it("⚠ 낱말 가로채기 방어 — 「사례」·「히스토리」 홑낱말은 안 받는다(report.ts 「취약점 사례」·작업 히스토리 영토)", () => {
    for (const q of ["취약점 사례 보여줘", "이 취약점 조치 사례 있어?", "작업 히스토리 어디 있어?", "사례 연구 공유해줘", "리포트에 취약점 사례 넣어줘"]) {
      expect(도착(q), q).not.toBe("incident_cases");
    }
  });
});

describe("📚 사례의 샘 — 「보안 유튜브 추천」류는 incident_sources로", () => {
  it("screenguide가 약속한 말이 닿고, 갈래는 지시문 통째로 넘겨 handlers 한 곳이 읽는다", () => {
    for (const q of ["사례의 샘 보여줘", "해외 보안 유튜브 추천해줘", "보안 사고 소식 어디서 봐?", "침해사고 뉴스 볼 만한 데 있어?", "보안 사이트 추천해줘", "해킹 사례 유튜브 채널 추천"]) {
      expect(도착(q, "security_officer"), q).toBe("incident_sources");
      expect(인자(q)).toEqual({ kind: q });
    }
  });
  it("⚠ 「추천」·「사이트」 홑낱말은 안 삼킨다", () => {
    for (const q of ["어떤 모델 받으면 좋아? 추천해줘", "사이트 접속이 안 돼", "유튜브 봐도 돼?"]) {
      expect(도착(q), q).not.toBe("incident_sources");
    }
  });
});

describe("📚 등록·삭제 — 쓰기는 도구를 못 박고 결재판으로", () => {
  const 등록말 = "사례 등록: 2024년 한빛물류 랜섬웨어, 초기 침투는 VPN 계정 탈취, 교훈은 VPN에 MFA, 출처 https://example.com/case-1";

  it("「사례 등록: …」(콜론)이 register_incident_case — 담당자 권한에서도(requiredRole 없음) · 인자는 모델이 뽑는 표시", () => {
    const f = forcedToolFor(등록말, { role: "security_officer" });
    expect(f?.tool).toBe("register_incident_case");
    expect(f?.argsByModel).toBe(true);
    expect(도착("침해사고 사례 등록: 2023년 ○○병원 랜섬웨어, 출처 https://example.com/x")).toBe("register_incident_case");
    expect(도착("히스토리 등록： 제목 …")).toBe("register_incident_case"); // 전각 콜론
    // 방법 질문·콜론 없는 말은 등록으로 못 박지 않는다(screenguide·모델 몫)
    expect(도착("사례 등록하려면 어떻게 해?")).not.toBe("register_incident_case");
    expect(도착("사례 등록 화면 어디야?")).not.toBe("register_incident_case");
    expect(findAgentTool("register_incident_case")?.write, "쓰기가 아니면 이 시험이 헛돈다").toBe(true);
  });

  it("★ runAgentLoop: 도구는 고정·인자만 모델이 뽑아 결재판에 올린다 — 지시에 없는 필수값은 비워 되묻는다(buildApproval 잣대 그대로)", async () => {
    mockChat.mockResolvedValueOnce(JSON.stringify({
      title: "2024년 한빛물류 랜섬웨어", oneLiner: "초기 침투는 VPN 계정 탈취", plainExplain: "VPN 계정이 유출돼 공격자가 들어와 서버를 암호화했습니다.",
      year: "2024", industry: "물류", region: "국내", lesson: "VPN에 MFA", sourceUrl: "https://example.com/case-1", extra: "선언에 없는 칸",
    }));
    const r = await runAgentLoop(등록말);
    expect(r, "루프가 아무것도 안 돌려줬다 — LLM 판단으로 샌다").not.toBeNull();
    expect(r!.approval?.tool).toBe("register_incident_case");
    expect(mockChat, "인자 추출 한 번만 — 결정 프롬프트(도구 고르기)를 다시 돌리지 않는다").toHaveBeenCalledTimes(1);
    const 프롬프트 = (mockChat.mock.calls[0][0] as { message: string; agentId: string; responseSchema?: unknown }).message;
    expect(프롬프트).toContain("sourceUrl");
    expect(프롬프트).toContain(등록말);
    expect((mockChat.mock.calls[0][0] as { responseSchema?: unknown }).responseSchema).toBeDefined(); // 스키마 강제 — 키는 영문 param 이름
    const a = r!.approval!;
    // 지시에 그대로 있는 값은 살고(said), 모델이 제 말로 쓴 필수값(plainExplain)·지시에 없는 값(region)은 비워 되묻는다
    expect(a.args.sourceUrl).toBe("https://example.com/case-1");
    expect(a.args.year).toBe("2024");
    expect(a.args.extra, "선언에 없는 칸이 결재판에 새어 들어왔다").toBeUndefined();
    expect(a.missing).toContain("plainExplain");
    expect(a.missing).toContain("region");
    expect(a.missing).not.toContain("title");
    expect(a.missing).not.toContain("sourceUrl");
  });

  it("모델이 죽어도 결재판은 뜬다 — 빈 칸으로 되묻지, 조용히 새지 않는다(forced-write-approval 계약)", async () => {
    mockChat.mockRejectedValueOnce(new Error("모델 없음"));
    const r = await runAgentLoop(등록말);
    expect(r!.approval?.tool).toBe("register_incident_case");
    expect(r!.approval!.missing).toContain("title");
    expect(r!.approval!.missing).toContain("sourceUrl");
  });

  it("extractToolArgsByModel — 문자열로 맞추고, 배열은 쉼표로 잇고, 선언에 없는 칸은 버리고, JSON이 아니면 빈 인자", async () => {
    const tool = findAgentTool("register_incident_case")!;
    const v = await extractToolArgsByModel(tool, 등록말, { chat: async () => JSON.stringify({ title: "제목", year: 2024, cves: ["CVE-2024-0001", "CVE-2024-0002"], nope: "x", industry: "  " }) as never });
    expect(v).toEqual({ title: "제목", year: "2024", cves: "CVE-2024-0001, CVE-2024-0002" });
    expect(await extractToolArgsByModel(tool, 등록말, { chat: async () => "JSON 아님" as never })).toEqual({});
    expect(await extractToolArgsByModel(tool, 등록말, { chat: async () => { throw new Error("x"); } })).toEqual({});
  });

  it("「사례 삭제 ic-…」는 delete_incident_case(번호 소문자) — 번호가 없으면 못 박지 않는다(빈 결재판 방지)", () => {
    const f = forcedToolFor("사례 삭제 ic-0123456789abcdef", { role: "security_officer" });
    expect(f?.tool).toBe("delete_incident_case");
    expect(f?.args).toEqual({ id: "ic-0123456789abcdef" });
    expect(인자("ic-0123456789ABCDEF 히스토리에서 지워줘")).toEqual({ id: "ic-0123456789abcdef" });
    expect(도착("사례 삭제해줘")).not.toBe("delete_incident_case");
    expect(도착("취약점 사례 목록에서 지워줘")).not.toBe("delete_incident_case");
    expect(findAgentTool("delete_incident_case")?.write).toBe(true);
  });
});

describe("★ 앞 층이 채 가지 않는다 — 특수경로·화면안내·되묻기 판별자를 같은 문장으로 잰다", () => {
  const 조회들 = ["침해사고 히스토리 보여줘", "사고 사례 보여줘", "비슷한 사례 있어?", "CVE-2021-44228 비슷한 사례 있어?", "랜섬웨어 사고 사례 알려줘"];
  const 샘들 = ["해외 보안 유튜브 추천해줘", "보안 사고 소식 어디서 봐?", "사례의 샘 보여줘"];

  it("침해사고 초동 절차(특수경로)는 「어떻게·절차·대응」이 있을 때만 — 조회 어미는 비켜 준다", () => {
    for (const q of [...조회들, ...샘들]) expect(침해사고질문인가(q), q).toBe(false);
    expect(침해사고질문인가("침해사고 의심될 때 대응 절차 알려줘"), "초동 절차 자체는 살아 있어야 한다(과잉 교정 방지)").toBe(true);
  });

  it("자리 질문·방법 질문·화면 안내로 새지 않는다(칩 문장은 그 화면 위에서도)", () => {
    for (const q of [...조회들, ...샘들]) {
      expect(이름으로화면찾기(q), `${q} → 자리 안내로 샌다`).toBeNull();
      expect(방법질문화면찾기(q), `${q} → 방법 안내로 샌다`).toBeNull();
      expect(isHelpIntent(q), `${q} → 화면 안내로 샌다`).toBe(false);
    }
    // 화면 칩은 incidentcases.html 위에서 눌린다 — 그 화면의 구역 별칭(히스토리)이 이 문장을 안내로 채 가면 안 된다
    expect(isHelpIntent("침해사고 히스토리 보여줘", "incidentcases.html")).toBe(false);
  });

  it("목록 고르기·내 업무·범위 밖·너무 짧음 판별에도 안 걸린다", () => {
    for (const q of [...조회들, ...샘들]) {
      expect(isFindingListAsk(q), q).toBe(false);
      expect(isMyWorkAsk(q), q).toBe(false);
      expect(isOutOfScope(q), q).toBe(false);
      expect(isTooVague(q), q).toBe(false);
    }
  });
});

describe("규칙표(routes.ts)에 네 길이 다 적혀 있다 — 적지 않은 규칙은 아무도 모른다", () => {
  it("강제도구 층에 등록·삭제·샘·조회가 있다", () => {
    for (const tool of ["register_incident_case", "delete_incident_case", "incident_sources", "incident_cases"]) {
      const r = 길목록.find((x) => x.도착 === tool);
      expect(r, `${tool}이 routes.ts에 없다`).toBeTruthy();
      expect(r!.층).toBe("강제도구");
      expect(r!.왜.length).toBeGreaterThan(40);
    }
  });
});
