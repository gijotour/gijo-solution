// scandrafts.test.ts — 스캔·TI 팀원의 「부르는 문」 계약 (2026-09-03, 계획서 §7 2단계).
//
// 스캔: 보고서 등록 직후 정형 초안(요약·우선 조치·주의). 우선 조치는 보고서에 실제로 있는 항목만 — 지어낸 것은 버린다.
// TI: 규칙 매칭이 걸린 것이 있을 때만 해석 3줄. 실패는 빈 문자열(요약은 그대로 값이 있다).
// 둘 다 시험 환경엔 모델이 없으므로 chat을 주입한다 — 실패 경로가 협업 창에 남는지도 본다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "../src/db";
import {
  validateDraft, buildScanDraftPrompt, draftScanInterpretation, listScanDrafts, getScanDraft, registerScanDraft, formatScanDrafts, interpretThreats,
  cvesInFindings, buildCaseExplainPrompt, validateCaseNote, explainSimilarCases, explainSimilarCasesForImport, noteSimilarCasesWithoutDraft, IMPORT_CASE_CVE_CAP,
} from "../src/engine/scandrafts";
import { registerIncidentCase } from "../src/engine/incidentcases";
import { importVulnScan } from "../src/engine/vulnscan";
import { resetAssetsForTests } from "../src/engine/assets";
import { collaborationHistory, resetCollaborationForTests } from "../src/engine/collaboration";
const scan말풍선 = () => collaborationHistory(200).filter((e) => e.from === "scan").map((e) => e.message);
const 해설말풍선 = () => collaborationHistory(200).filter((e) => e.from === "normaltic").map((e) => e.message);
import { listTasks } from "../src/engine/tasks";
import { TARGETS, RESET_TARGETS } from "../src/engine/datacleanup";

const vulns = [
  { code: "IW-20", name: "서버 정보 노출", risk: "중", host: "cert.example.co.kr" },
  { code: "WEB-05", name: "디렉토리 인덱싱", risk: "상", host: "www.example.co.kr" },
  { code: "IW-25", name: "평문 전송", risk: "상", host: "cert.example.co.kr" },
];
const input = { source: "안전대부_웹취약점_보고서.pdf", hosts: 2, findings: 3, vulns };

beforeEach(() => { db.prepare("DELETE FROM scan_drafts").run(); db.prepare("DELETE FROM incident_cases").run(); });

describe("스캔 해석 초안 — 근거 검증", () => {
  it("보고서에 없는 코드·자산은 버리고, 있는 것만 최대 3건 남긴다", () => {
    const raw = JSON.stringify({
      summary: "평문 전송과 디렉토리 인덱싱이 상 위험으로 먼저 조치 대상입니다. 서버 정보 노출은 뒤따릅니다.",
      priorities: [
        { code: "IW-25", name: "평문 전송", host: "cert.example.co.kr", why: "인증 정보가 그대로 노출" },
        { code: "IW-99", name: "지어낸 취약점", host: "cert.example.co.kr", why: "없는 항목" },
        { code: "", name: "디렉토리 인덱싱", host: "www.example.co.kr", why: "코드 없이 이름+자산으로" },
        { code: "WEB-05", name: "디렉토리 인덱싱", host: "www.example.co.kr", why: "중복" },
        { code: "IW-20", name: "서버 정보 노출", host: "db.example.co.kr", why: "자산이 다르지만 코드가 맞다" },
      ],
      caveats: ["문서 명시 총계와 대조 필요", "", "비인증 점검"],
    });
    const v = validateDraft(raw, vulns)!;
    expect(v).not.toBeNull();
    expect(v.draft.priorities.map((p) => p.code)).toEqual(["IW-25", "WEB-05", "IW-20"]);
    expect(v.dropped).toBe(1); // IW-99만 버림(중복은 세지 않는다)
    expect(v.draft.caveats).toEqual(["문서 명시 총계와 대조 필요", "비인증 점검"]);
  });

  it("근거 있는 우선 조치가 하나도 없으면 초안이 아니다(null) · 코드펜스 JSON도 읽는다", () => {
    expect(validateDraft(JSON.stringify({ summary: "충분히 긴 요약 문장입니다.", priorities: [{ code: "X-1", name: "없음", host: "none", why: "" }], caveats: [] }), vulns)).toBeNull();
    expect(validateDraft("```json\n" + JSON.stringify({ summary: "충분히 긴 요약 문장입니다.", priorities: [{ code: "iw-20", name: "", host: "", why: "" }], caveats: [] }) + "\n```", vulns)?.draft.priorities[0].code).toBe("IW-20");
    expect(validateDraft("이건 JSON이 아니다", vulns)).toBeNull();
  });

  it("같은 코드가 여러 자산에 걸리면 모델이 말한 자산을 지목한다(코드가 먼저 이겨 다른 자산을 지목하던 결함)", () => {
    const 둘 = [{ code: "IW-20", name: "디렉토리 인덱싱", risk: "하", host: "cert.example.co.kr" }, { code: "IW-20", name: "디렉토리 인덱싱", risk: "하", host: "certify.example.co.kr" }];
    const v = validateDraft(JSON.stringify({ summary: "두 서버 모두 디렉토리 인덱싱이 열려 있어 먼저 닫아야 합니다.", priorities: [
      { code: "IW-20", name: "디렉토리 인덱싱", host: "cert.example.co.kr", why: "인증서 발급 서버라 먼저" },
      { code: "IW-20", name: "디렉토리 인덱싱", host: "certify.example.co.kr", why: "본인인증 서버" },
      { code: "IW-20", name: "디렉토리 인덱싱", host: "없는서버", why: "자산을 지어냄 → 코드로 교정" },
    ], caveats: [] }), 둘)!;
    expect(v.draft.priorities.map((p) => p.host)).toEqual(["cert.example.co.kr", "certify.example.co.kr"]); // 세 번째는 코드 교정 뒤 중복
    expect(v.draft.priorities[0].why).toBe("인증서 발급 서버라 먼저");
  });

  it("한자·중국어가 섞인 줄은 사람에게 내보내지 않는다 — 요약이면 초안 자체를 버린다", () => {
    expect(validateDraft(JSON.stringify({ summary: "平文传输 위험이 큽니다 즉시 조치가 필요합니다", priorities: [{ code: "IW-25", name: "평문 전송", host: "cert.example.co.kr", why: "" }], caveats: [] }), vulns)).toBeNull();
    const v = validateDraft(JSON.stringify({ summary: "평문 전송이 인증 구간에 있어 가장 급합니다.", priorities: [{ code: "IW-25", name: "평문 전송", host: "cert.example.co.kr", why: "认证信息泄露" }], caveats: ["확인 필요", "需要确认"] }), vulns)!;
    expect(v.draft.priorities[0].why).toBe("");
    expect(v.draft.caveats).toEqual(["확인 필요"]);
  });

  it("파서 name에 [코드]가 이미 붙어 있어도 코드를 두 번 찍지 않는다(프롬프트·화면·할 일 제목)", () => {
    const p = buildScanDraftPrompt({ ...input, vulns: [{ code: "IW-20", name: "[IW-20] 디렉토리 인덱싱", risk: "하", host: "h" }] });
    expect(p).toContain("[IW-20] 디렉토리 인덱싱 · 위험 하");
    expect(p).not.toContain("[IW-20] [IW-20]");
  });

  it("프롬프트는 항목을 40건까지만 싣고 나머지는 생략 수를 적는다", () => {
    const many = { ...input, vulns: Array.from({ length: 45 }, (_, i) => ({ code: `V-${i}`, name: `취약점 ${i}`, risk: "하", host: "h" })) };
    const p = buildScanDraftPrompt(many);
    expect(p).toContain("[V-39]");
    expect(p).not.toContain("[V-40]");
    expect(p).toContain("외 5건 생략");
  });
});

describe("스캔 해석 초안 — 부르는 문 왕복(chat 주입)", () => {
  it("모델이 초안을 주면 저장되고 협업 창에 남으며, 채택하면 할 일이 된다(두 번 채택은 거부)", async () => {
    resetCollaborationForTests();
    const chat = async (a: { agentId: string; message: string }) => {
      expect(a.agentId).toBe("scan");
      expect(a.message).toContain("[IW-25]");
      return JSON.stringify({ summary: "평문 전송이 인증 구간에 있어 가장 급합니다. 인덱싱은 정보 노출로 이어집니다.", priorities: [{ code: "IW-25", name: "평문 전송", host: "cert.example.co.kr", why: "인증 정보 노출" }, { code: "IW-77", name: "지어냄", host: "x", why: "" }], caveats: ["비인증 점검"] });
    };
    const r = await draftScanInterpretation(input, { chat });
    expect(r).not.toBeNull();
    expect(r!.dropped).toBe(1);
    expect(scan말풍선().some((m) => /해석 초안 — 우선 조치 1건 \(근거 없는 1건 버림\)/.test(m))).toBe(true);
    const rows = listScanDrafts();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("draft");
    expect(formatScanDrafts(rows)).toContain("[IW-25] 평문 전송 @ cert.example.co.kr");
    // 채택 → 할 일
    const before = listTasks().length;
    const reg = registerScanDraft(rows[0].id.slice(0, 8), "jyh");
    expect(reg.taskIds.length).toBe(1);
    expect(reg.신규).toBe(1); // 새로 생긴 것만 「등록」으로 센다(createTask 중복 억제 때문에 taskIds.length가 곧 등록 수는 아니다)
    expect(reg.기존).toBe(0);
    expect(listTasks().length).toBe(before + 1);
    expect(listTasks().find((t) => t.id === reg.taskIds[0])!.text).toContain("[스캔 해석] cert.example.co.kr [IW-25] 평문 전송");
    expect(getScanDraft(rows[0].id)!.status).toBe("registered");
    expect(() => registerScanDraft(rows[0].id, "jyh")).toThrow(/이미 채택/);
    expect(formatScanDrafts(listScanDrafts())).toContain("채택됨(jyh, 할 일 1건)");
  });

  it("모델이 엉뚱한 것을 주거나 죽으면 저장하지 않고 협업 창에 사유가 남는다(조용히 삼키지 않는다)", async () => {
    resetCollaborationForTests();
    expect(await draftScanInterpretation(input, { chat: async () => JSON.stringify({ summary: "충분히 긴 요약입니다만", priorities: [{ code: "NOPE", name: "x", host: "y", why: "" }], caveats: [] }) })).toBeNull();
    expect(await draftScanInterpretation(input, { chat: async () => { throw new Error("모델 없음"); } })).toBeNull();
    expect(await draftScanInterpretation({ ...input, vulns: [] }, { chat: async () => "" })).toBeNull();
    const events = scan말풍선();
    expect(listScanDrafts().length).toBe(0);
    expect(events.filter((m) => /못 만듦/.test(m)).length).toBe(1);
    expect(events.filter((m) => /실패 — 모델 없음/.test(m)).length).toBe(1);
  });
});

/**
 * 클라 칩(console.js attachCaseChip)이 **실제로 쓰는** 판정 정규식을 화면 소스에서 읽어 온다 — [사례 N건 판정, 답 본문 CVE 줍기].
 * 계약을 시험에 베껴 적으면 화면이 바뀌어도 시험은 초록이라 칩이 조용히 사라진다(검토관 2026-09-03).
 */
const 칩판정 = (): [RegExp, RegExp] => {
  const js = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "console.js"), "utf8");
  const i = js.indexOf("function attachCaseChip(");
  expect(i, "console.js에서 attachCaseChip을 못 찾았다 — 칩이 사라졌거나 이름이 바뀌었다").toBeGreaterThan(0);
  const 몸통 = js.slice(i, js.indexOf("var b = document.createElement", i));
  const 리터럴 = [...몸통.matchAll(/\.match\((\/.+?\/[gimsuy]*)\)/g)].map((m) => m[1]);
  expect(리터럴.length, `attachCaseChip의 판정 정규식을 못 읽었다(꼴이 바뀌었다): ${몸통.slice(0, 200)}`).toBeGreaterThanOrEqual(2);
  const 만들기 = (lit: string) => new RegExp(lit.slice(1, lit.lastIndexOf("/")), lit.slice(lit.lastIndexOf("/") + 1));
  return [만들기(리터럴[0]), 만들기(리터럴[1])];
};

describe("📚 비슷한 침해사고 사례 — 해설(normaltic) 팀원의 부르는 문 ②(2026-09-03)", () => {
  const 사례 = {
    title: "Log4Shell 대규모 악용", oneLiner: "Log4j 원격코드실행으로 전 세계 서버가 뚫렸다", plainExplain: "로그를 남기는 부품(Log4j)의 구멍으로 남이 우리 서버에서 명령을 실행할 수 있었습니다. 패치가 늦은 곳부터 당했습니다.",
    year: 2021, industry: "소프트웨어", region: "해외", cves: "CVE-2021-44228, CVE-2021-45046", products: "Apache Log4j", lesson: "부품 목록(SBOM)이 있어야 어디에 Log4j가 있는지 하루 안에 찾는다", sourceUrl: "https://www.cisa.gov/news-events/alerts/2021/12/10/apache-log4j-vulnerability-guidance", sourceName: "CISA",
  };
  const 보고서 = { source: "웹취약점_보고서.pdf", hosts: 1, findings: 1, vulns: [{ code: "WEB-01", name: "SQL 인젝션", risk: "상", host: "www.example.co.kr" }] }; // CVE 없는 보고서 — 자동 훅은 침묵
  const 초안chat = async () => JSON.stringify({ summary: "SQL 인젝션이 인증 구간에 있어 가장 급합니다. 입력 검증부터 손봐야 합니다.", priorities: [{ code: "WEB-01", name: "SQL 인젝션", host: "www.example.co.kr", why: "인증 우회" }], caveats: [] });
  const 걸리는항목 = [{ code: "CVE-2021-44228", name: "[CVE-2021-44228] Apache Log4j RCE" }];

  it("보고서 항목에서 CVE만 뽑는다(hybridsearch CODE_RE 재사용 — 대문자, IW-20 같은 다른 코드는 안 뽑힌다)", () => {
    expect(cvesInFindings([{ code: "IW-20", name: "[cve-2021-44228] log4j" }, { code: "WEB-05", name: "디렉토리 인덱싱" }])).toEqual(["CVE-2021-44228"]);
    expect(cvesInFindings([{ code: "IW-20", name: "서버 정보 노출" }])).toEqual([]);
  });

  it("후보가 0이면 침묵한다 — 호출도 저장도 말풍선도 없다", async () => {
    resetCollaborationForTests();
    const r = await draftScanInterpretation(보고서, { chat: 초안chat });
    let called = 0;
    expect(await explainSimilarCases({ draftId: r!.id, findings: 보고서.vulns }, { chat: async () => { called += 1; return ""; } })).toBeNull(); // CVE 없음
    expect(await explainSimilarCases({ draftId: r!.id, findings: 걸리는항목 }, { chat: async () => { called += 1; return ""; } })).toBeNull(); // CVE는 있는데 사례 표에 없음
    expect(called).toBe(0);
    expect(해설말풍선()).toEqual([]);
    expect(getScanDraft(r!.id)!.caseIds).toEqual([]);
    expect(getScanDraft(r!.id)!.caseNote).toBeNull();
  });

  it("후보가 있으면 모델 부연을 붙이되, 후보 밖 사례·CVE를 쓰면 부연을 버리고 제목 줄만 남긴다 · 죽어도 제목 줄은 저장된다", async () => {
    const prev = process.env.GIJO_CASE_EXPLAIN; process.env.GIJO_CASE_EXPLAIN = "1";
    try {
      const c = registerIncidentCase(사례, "정요한");
      resetCollaborationForTests();
      const r = await draftScanInterpretation(보고서, { chat: 초안chat });
      // ① 검증 통과 — 후보 제목을 그대로 쓴 부연
      const ok = await explainSimilarCases({ draftId: r!.id, findings: 걸리는항목 }, { chat: async (a) => {
        expect(a.agentId).toBe("normaltic");
        expect(a.responseSchema).toBeDefined(); // 스키마 강제 — normaltic 엄격 그라운딩(사내 자료 없으면 안 묻는다)을 비켜 후보만 재료로 쓴다
        expect(a.message).toContain("Log4Shell 대규모 악용");
        return JSON.stringify({ note: "이 CVE는 2021년 Log4Shell 사고에서 실제로 쓰였습니다. 부품 목록이 없던 곳이 패치가 늦어 당했으니 우리도 SBOM부터 확인하세요.", cases: ["Log4Shell 대규모 악용"] });
      } });
      expect(ok).toEqual({ caseIds: [c.id], caseNote: expect.stringMatching(/^🤖 이 CVE는 2021년 .* · CVE-2021-44228$/), ai: true });
      const row = getScanDraft(r!.id)!;
      expect(row.caseIds).toEqual([c.id]);
      expect(row.caseNote).toMatch(/^🤖 /);
      // 「📚 비슷한 사례 N건」은 클라 칩(console.js attachCaseChip)의 판정 문구 — 본문에 CVE 표기가 있어야 칩이 그 CVE로 좁혀 연다.
      //   ⚠ 판정 정규식을 여기 **베껴 적지 않는다**(검토관 2026-09-03: 베낀 계약은 화면이 바뀌어도 시험이 초록이다) — 화면 소스에서 읽어 그대로 쓴다.
      const 글 = formatScanDrafts([row]);
      expect(글).toContain("📚 비슷한 사례 1건 — 🤖 이 CVE는");
      const [사례판정, CVE판정] = 칩판정();
      const 걸림 = 글.match(사례판정);
      expect(걸림, `클라 칩이 이 답에 안 붙는다 — 서버 문구와 화면 판정이 갈렸다:\n${글}`).toBeTruthy();
      expect(Number(걸림![1]), "칩이 읽는 N과 실제 사례 수가 다르다").toBe(row.caseIds.length);
      expect(글.match(CVE판정), "칩이 히스토리를 좁혀 열 CVE를 본문에서 못 줍는다").toContain("CVE-2021-44228");
      expect(해설말풍선().some((m) => /^📚 비슷한 사례 1건 — Log4Shell 대규모 악용\(2021\)/.test(m))).toBe(true);
      // ② 검증 실패 — 후보에 없는 사례 제목 / 지어낸 CVE / 한자 → 부연 버림, 제목 줄만
      for (const bad of [
        JSON.stringify({ note: "2017년 워너크라이 사고와 같은 유형입니다 — 패치가 늦은 곳부터 당했습니다.", cases: ["워너크라이 대유행"] }),
        JSON.stringify({ note: "CVE-2014-0160 하트블리드처럼 널리 퍼진 구멍이었습니다. 부품 목록부터 확인하세요.", cases: ["Log4Shell 대규모 악용"] }),
        JSON.stringify({ note: "漏洞 악용 사고입니다 지금 확인하세요 열 글자 넘게", cases: ["Log4Shell 대규모 악용"] }),
        "JSON 아님",
      ]) {
        resetCollaborationForTests();
        const v = await explainSimilarCases({ draftId: r!.id, findings: 걸리는항목 }, { chat: async () => bad });
        expect(v).toEqual({ caseIds: [c.id], caseNote: "Log4Shell 대규모 악용(2021) · CVE-2021-44228", ai: false });
        expect(getScanDraft(r!.id)!.caseNote).toBe("Log4Shell 대규모 악용(2021) · CVE-2021-44228");
        expect(해설말풍선().some((m) => /못 만듦/.test(m)), `사유 없이 삼켰다: ${bad.slice(0, 40)}`).toBe(true);
      }
      // ③ 모델이 죽어도 규칙이 찾은 사실(caseIds·제목 줄)은 남는다
      resetCollaborationForTests();
      expect((await explainSimilarCases({ draftId: r!.id, findings: 걸리는항목 }, { chat: async () => { throw new Error("모델 없음"); } }))!.ai).toBe(false);
      expect(해설말풍선().some((m) => /실패 — 모델 없음/.test(m))).toBe(true);
      // ④ 시간 예산 — 늦으면 제목 줄만
      const prevMs = process.env.GIJO_CASE_EXPLAIN_MS; process.env.GIJO_CASE_EXPLAIN_MS = "500";
      try {
        const 늦음 = await explainSimilarCases({ draftId: r!.id, findings: 걸리는항목 }, { chat: () => new Promise((res) => setTimeout(() => res(JSON.stringify({ note: "늦게 온 부연입니다 열 글자 넘게 씁니다", cases: ["Log4Shell 대규모 악용"] })), 1500)) });
        expect(늦음!.ai).toBe(false);
      } finally { if (prevMs === undefined) delete process.env.GIJO_CASE_EXPLAIN_MS; else process.env.GIJO_CASE_EXPLAIN_MS = prevMs; }
    } finally { if (prev === undefined) delete process.env.GIJO_CASE_EXPLAIN; else process.env.GIJO_CASE_EXPLAIN = prev; }
  });

  it("★ 초안이 실패해도 규칙 대조는 돈다 — 모델 없이 제목 줄 말풍선(붙일 초안이 없으니 저장은 없다)", async () => {
    // 웹보고서 경로의 사례는 **초안 성공에 묶여** 있었다 — 모델이 죽으면 규칙이 찾은 사실까지 사라졌다(검토관 2026-09-03).
    registerIncidentCase(사례, "정요한");
    const 보고서2 = { source: "웹취약점_보고서.pdf", hosts: 1, findings: 1, vulns: [{ code: "CVE-2021-44228", name: "Apache Log4j RCE", risk: "상", host: "www.example.co.kr" }] };
    resetCollaborationForTests();
    expect(await draftScanInterpretation(보고서2, { chat: async () => { throw new Error("모델 없음"); } })).toBeNull();
    expect(listScanDrafts(), "초안은 저장되지 않는다").toEqual([]);
    const 말 = 해설말풍선();
    expect(말).toHaveLength(1);
    expect(말[0]).toMatch(/^📚 비슷한 사례 1건 — 웹취약점_보고서\.pdf 해석 초안은 못 만들었지만/);
    expect(말[0]).toContain("Log4Shell 대규모 악용(2021) · CVE-2021-44228");
    // 검증 실패(모델이 엉뚱한 초안을 줌) 경로도 같다
    resetCollaborationForTests();
    expect(await draftScanInterpretation(보고서2, { chat: async () => JSON.stringify({ summary: "충분히 긴 요약입니다만", priorities: [{ code: "NOPE", name: "x", host: "y", why: "" }], caveats: [] }) })).toBeNull();
    expect(해설말풍선().some((m) => /해석 초안은 못 만들었지만/.test(m))).toBe(true);
    // 후보가 없으면 여기서도 침묵한다
    resetCollaborationForTests();
    expect(noteSimilarCasesWithoutDraft({ source: "x.pdf", findings: [{ code: "IW-20", name: "서버 정보 노출" }] })).toBeNull();
    expect(해설말풍선()).toEqual([]);
  });

  it("꼬리 CVE는 **후보에 걸린 것만** 상한(IMPORT_CASE_CVE_CAP)까지 — 보고서 전체 CVE를 붓지 않는다(반입 훅과 같은 잣대)", async () => {
    const 일곱 = ["CVE-2030-0001", "CVE-2030-0002", "CVE-2030-0003", "CVE-2030-0004", "CVE-2030-0005", "CVE-2030-0006", "CVE-2030-0007"];
    registerIncidentCase({ ...사례, title: "CVE 많은 사례", sourceUrl: "https://example.com/many", cves: 일곱.join(", ") }, "정요한");
    const r = await draftScanInterpretation(보고서, { chat: 초안chat });
    const findings = [...일곱, "CVE-2031-9999"].map((c, i) => ({ code: c, name: `[${c}] 항목 ${i}` }));
    const v = (await explainSimilarCases({ draftId: r!.id, findings }))!;
    const 꼬리 = v.caseNote.split(" · ").slice(-1)[0].split(", ");
    expect(꼬리, `꼬리 CVE 수가 상한을 넘었다: ${v.caseNote}`).toHaveLength(IMPORT_CASE_CVE_CAP);
    expect(꼬리.every((c) => 일곱.includes(c)), `후보에 없는 CVE가 꼬리에 붙었다: ${꼬리.join(", ")}`).toBe(true);
  });

  it("어떤 경우에도 던지지 않는다 — void로 부르는 약속이 거부되면 아무도 못 받는다(반입 훅과 같은 계약)", async () => {
    resetCollaborationForTests();
    await expect(explainSimilarCases({ draftId: "없는초안", findings: null as unknown as { code: string; name: string }[] })).resolves.toBeNull();
    expect(해설말풍선().some((m) => /비슷한 사례 붙이기 실패/.test(m)), "사유 없이 삼켰다").toBe(true);
  });

  it("GIJO_CASE_EXPLAIN=0(시험 기본)이면 모델을 부르지 않고 제목 줄만 저장한다", async () => {
    const c = registerIncidentCase(사례, "정요한");
    const r = await draftScanInterpretation(보고서, { chat: 초안chat });
    let called = 0;
    const v = await explainSimilarCases({ draftId: r!.id, findings: 걸리는항목 }, { chat: async () => { called += 1; return ""; } });
    expect(called).toBe(0);
    expect(v).toEqual({ caseIds: [c.id], caseNote: "Log4Shell 대규모 악용(2021) · CVE-2021-44228", ai: false });
    expect(validateCaseNote(JSON.stringify({ note: "충분히 긴 우리말 부연 문장입니다.", cases: ["log4shell 대규모 악용"] }), [c], ["CVE-2021-44228"])!.matched).toEqual([c]); // 제목 대조는 공백·대소문자 무시
    expect(buildCaseExplainPrompt(["CVE-2021-44228"], [c])).toContain("교훈: 부품 목록(SBOM)");
  });
});

describe("TI 해석 — 규칙 매칭이 있을 때만, 목록에 있는 자산만", () => {
  const items = [{ type: "credential-leak", target: "example.co.kr", severity: "critical", assets: ["web-01", "db-01"] }];
  it("해석은 붙고 우선 자산은 목록 안의 것만 남는다", async () => {
    const prev = process.env.GIJO_TI_INTERPRET; process.env.GIJO_TI_INTERPRET = "1";
    try {
      const s = await interpretThreats(items, { chat: async (a) => { expect(a.agentId).toBe("ti"); expect(a.message).toContain("[심각]"); return JSON.stringify({ interpretation: "유출된 자격증명이 web-01 로그인에 재사용될 수 있어 지금 문제입니다.", first_assets: ["web-01", "없는자산", "db-01"] }); } });
      expect(s).toContain("🤖 TI 해석:"); // 표식 사전(tone.ts)의 안내 기호 — 말투 감시가 아는 기호만
      expect(s).toContain("먼저 볼 자산: web-01, db-01");
      expect(await interpretThreats([], { chat: async () => "x" })).toBe("");
      expect(await interpretThreats(items, { chat: async () => { throw new Error("x"); } })).toBe("");
      expect(await interpretThreats(items, { chat: async () => "JSON 아님" })).toBe("");
      // 한자·중국어가 섞인 해석은 사람에게 내보내지 않는다(json_schema 경로는 한자 차단이 꺼져 있다)
      expect(await interpretThreats(items, { chat: async () => JSON.stringify({ interpretation: "凭证泄露 web-01 로그인 위험이 있습니다 지금 확인하세요", first_assets: [] }) })).toBe("");
      // 시간 예산 — threats는 즉답 도구다. 모델이 늦으면 규칙 답만 즉시 나간다
      const prevMs = process.env.GIJO_TI_INTERPRET_MS; process.env.GIJO_TI_INTERPRET_MS = "500";
      try {
        const 늦음 = await interpretThreats(items, { chat: () => new Promise((r) => setTimeout(() => r(JSON.stringify({ interpretation: "늦게 온 해석입니다 열 글자 넘게", first_assets: [] })), 1500)) });
        expect(늦음).toBe("");
      } finally { if (prevMs === undefined) delete process.env.GIJO_TI_INTERPRET_MS; else process.env.GIJO_TI_INTERPRET_MS = prevMs; }
    } finally { if (prev === undefined) delete process.env.GIJO_TI_INTERPRET; else process.env.GIJO_TI_INTERPRET = prev; }
  });
  it("GIJO_TI_INTERPRET=0 이면 모델을 부르지 않는다(시험 환경 기본)", async () => {
    const prev = process.env.GIJO_TI_INTERPRET; process.env.GIJO_TI_INTERPRET = "0";
    try {
      let called = 0;
      expect(await interpretThreats(items, { chat: async () => { called += 1; return ""; } })).toBe("");
      expect(called).toBe(0);
    } finally { if (prev === undefined) delete process.env.GIJO_TI_INTERPRET; else process.env.GIJO_TI_INTERPRET = prev; }
  });
});

describe("배선 — 문이 실제로 이어져 있다(소스 감시)", () => {
  const E = path.join(__dirname, "..", "src", "engine");
  it("웹취약점 보고서 경로가 등록 직후 스캔 초안을 부르고, threats 도구가 TI 해석을 붙인다", () => {
    const au = fs.readFileSync(path.join(E, "autoupload.ts"), "utf8");
    const i = au.indexOf("async function tryWebReport");
    const body = au.slice(i, au.indexOf("\n}\n", i));
    expect(body).toContain("void draftScanInterpretation(");
    const h = fs.readFileSync(path.join(E, "agenttools", "handlers.ts"), "utf8");
    const t = h.slice(h.indexOf("export async function runThreats("), h.indexOf("export async function runRemediation("));
    expect(t).toContain("await interpretThreats(");
  });
  it("대화창 도구 scan_drafts·register_scan_draft가 등록돼 있고, 채택은 결재판(write)이며 실행자를 싣는다", () => {
    const reg = fs.readFileSync(path.join(E, "agenttools", "registry.ts"), "utf8");
    expect(reg).toMatch(/name: "scan_drafts",[\s\S]{0,200}write: false/);
    expect(reg).toMatch(/name: "register_scan_draft",[\s\S]{0,200}write: true/);
    // 채택자 = 결재판을 승인한 사람(viewerctx) — null 고정이면 화면이 「채택됨(?)」이고 감사 actor가 빈다(검토관 2026-09-03)
    const block = reg.slice(reg.indexOf('name: "register_scan_draft"'), reg.indexOf('name: "threats"'));
    expect(block).toMatch(/currentViewer\(\)/);
    expect(block).toMatch(/registerScanDraft\(String\(args\.id \?\? ""\), \(v\?\.userId \? findUserById/);
    // 결재판이 「무엇을」 승인하는지 보인다 — effect가 초안 이름을 쓴다
    expect(block).toMatch(/effect: \(args\) => \{[\s\S]*getScanDraft\(String\(args\.id/);
    // threats 즉답 도구의 TI 해석은 시간 예산 안에서만 — 안내 줄은 잘림 밖
    const h = fs.readFileSync(path.join(E, "agenttools", "handlers.ts"), "utf8");
    const t = h.slice(h.indexOf("export async function runThreats("), h.indexOf("export async function runRemediation("));
    expect(t).toContain("const 심각도말 = cti심각도한글;");
    expect(t).toMatch(/const 본문 = \[[\s\S]*\]\.join\("\\n"\)\.slice\(0, 2400\);\s*return `\$\{본문\}\\n\\n\$\{표식\.다음\}/);
  });
  it("scan_drafts는 업무 데이터다 — 정리 대장과 실사용 전환 리셋에 들어 있다", () => {
    expect(TARGETS.scan_drafts?.tables).toEqual(["scan_drafts"]);
    expect([...RESET_TARGETS]).toContain("scan_drafts");
  });
  it("초안이 생긴 직후 📚 비슷한 사례 훅을 void로 부르고, 실패 경로에서도 규칙 대조는 돈다(2026-09-03)", () => {
    const src = fs.readFileSync(path.join(E, "scandrafts.ts"), "utf8");
    const i = src.indexOf("export async function draftScanInterpretation(");
    const body = src.slice(i, src.indexOf("\n}\n", i));
    expect(body).toContain("void explainSimilarCases({ draftId: id, findings: input.vulns })");
    // 훅이 insert 뒤에 온다 — 앞에 오면 없는 초안에 caseNote를 쓴다
    expect(body.indexOf("insertStmt.run(")).toBeLessThan(body.indexOf("void explainSimilarCases("));
    // 실패 두 갈래(검증 실패·모델 죽음) 모두에서 규칙 대조를 부른다 — 한쪽만 부르면 그 길에서만 사례가 사라진다
    expect((body.match(/noteSimilarCasesWithoutDraft\(\{ source: input\.source, findings: input\.vulns \}\)/g) ?? []).length, "초안 실패 갈래 둘 다에서 규칙 대조를 불러야 한다").toBe(2);
    // CVE 뽑기는 hybridsearch 한 곳 — 새 CVE 정규식을 여기 짓지 않는다
    expect(src).not.toMatch(/\/CVE-\\d/);
    expect(src).toContain('from "./hybridsearch"');
  });

  it("스캔 초안 조회 API는 두지 않는다 — 부르는 클라가 0곳이었다(검토관 2026-09-03)", () => {
    const src = fs.readFileSync(path.join(E, "scandrafts.ts"), "utf8");
    expect(src, "부르는 사람 없는 창구가 되살아났다").not.toContain('app.get("/api/scan-drafts"');
    expect(src).not.toContain("registerScanDraftRoutes");
    expect(fs.readFileSync(path.join(E, "..", "app.ts"), "utf8")).not.toContain("registerScanDraftRoutes");
    // 없앤 근거를 시험이 다시 잰다 — 클라가 이 창구를 부르기 시작하면 API를 되살리고 이 시험을 갱신해야 한다
    const 클라 = path.join(__dirname, "..", "..", "client", "src");
    const 부르는곳 = (fs.readdirSync(클라, { recursive: true }) as string[])
      .filter((f) => /\.(ts|js|html)$/.test(f))
      .filter((f) => fs.readFileSync(path.join(클라, f), "utf8").includes("scan-drafts"));
    expect(부르는곳, "클라가 이 창구를 부른다 — API를 되살릴 것").toEqual([]);
  });
});

// ── 📚 반입 훅 — 해설 팀원의 부르는 문 ③(2026-09-03 갈래 1 통합) ─────────────────────────────────────
// 운영 실측: 취약점 288건 중 CVE 있음 201건(70%)이고 CVE는 Nessus/CSV/JSON 반입에서 온다. 초안 훅(위)은 웹취약점 보고서
// 경로에서만 불려 CVE가 드문 길만 덮고 있었다 — 네 등록 경로가 전부 지나는 importVulnScan 끝에서 한 번 더 부른다.
describe("📚 반입 훅 — explainSimilarCasesForImport(저장 없음·말풍선 하나·후보 0이면 침묵)", () => {
  const 사례 = {
    title: "Log4Shell 대규모 악용", oneLiner: "Log4j 원격코드실행으로 전 세계 서버가 뚫렸다", plainExplain: "로그를 남기는 부품(Log4j)의 구멍으로 남이 우리 서버에서 명령을 실행할 수 있었습니다. 패치가 늦은 곳부터 당했습니다.",
    year: 2021, industry: "소프트웨어", region: "해외", cves: "CVE-2021-44228, CVE-2021-45046", products: "Apache Log4j", lesson: "부품 목록(SBOM)이 있어야 어디에 Log4j가 있는지 하루 안에 찾는다", sourceUrl: "https://www.cisa.gov/news-events/alerts/2021/12/10/apache-log4j-vulnerability-guidance", sourceName: "CISA",
  };
  // vulnscan이 넘기는 꼴 — code=finding.key(플러그인 id), name=항목명 + 그 묶음의 CVE
  const 새항목 = [{ code: "12345", name: "Apache Log4j RCE CVE-2021-44228" }];

  it("후보가 0이면 침묵 — 호출도 말풍선도 없다(CVE 없음 · CVE는 있는데 표에 없음)", async () => {
    resetCollaborationForTests();
    let called = 0;
    const chat = async () => { called += 1; return ""; };
    expect(await explainSimilarCasesForImport({ source: "nessus.csv", findings: [{ code: "1", name: "SMB signing not required" }] }, { chat })).toBeNull();
    expect(await explainSimilarCasesForImport({ source: "nessus.csv", findings: 새항목 }, { chat })).toBeNull();
    expect(called).toBe(0);
    expect(해설말풍선()).toEqual([]);
  });

  it("후보가 있으면 말풍선 하나·저장은 없다(초안이 없다) · 꼬리표 CVE는 후보에 걸린 것만 · 시험 기본(모델 끔)이면 제목 줄", async () => {
    const c = registerIncidentCase(사례, "정요한");
    resetCollaborationForTests();
    let called = 0;
    const v = await explainSimilarCasesForImport({ source: "nessus.csv", findings: [...새항목, { code: "2", name: "OpenSSL 취약점 CVE-2024-0001" }] }, { chat: async () => { called += 1; return ""; } });
    expect(called).toBe(0); // GIJO_CASE_EXPLAIN=0(vitest.config)
    expect(v).toEqual({ caseIds: [c.id], caseNote: "Log4Shell 대규모 악용(2021) · CVE-2021-44228", ai: false }); // CVE-2024-0001은 후보에 없어 꼬리에 안 붙는다
    const 말 = 해설말풍선();
    expect(말).toHaveLength(1);
    expect(말[0]).toMatch(/^📚 비슷한 사례 1건 — nessus\.csv 반입에서 CVE 있는 새 취약점 2건 중 CVE-2021-44228: Log4Shell 대규모 악용\(2021\)$/);
    expect(listScanDrafts(5), "반입 훅이 초안을 만들거나 저장하면 안 된다").toEqual([]);
  });

  it("모델을 켜면 부연이 붙고, 후보 밖 사례를 쓰면 제목 줄만 — 초안 훅과 **같은 문**을 나눠 쓴다(같은 잣대)", async () => {
    const prev = process.env.GIJO_CASE_EXPLAIN; process.env.GIJO_CASE_EXPLAIN = "1";
    try {
      const c = registerIncidentCase(사례, "정요한");
      resetCollaborationForTests();
      const ok = await explainSimilarCasesForImport({ source: "nessus.csv", findings: 새항목 }, { chat: async (a) => {
        expect(a.agentId).toBe("normaltic");
        expect(a.responseSchema).toBeDefined();
        expect(a.message).toContain("CVE: CVE-2021-44228");
        expect(a.message).toContain("Log4Shell 대규모 악용");
        return JSON.stringify({ note: "이 CVE는 2021년 Log4Shell 사고에서 실제로 쓰였습니다. 부품 목록부터 확인하세요.", cases: ["Log4Shell 대규모 악용"] });
      } });
      expect(ok).toEqual({ caseIds: [c.id], caseNote: expect.stringMatching(/^🤖 이 CVE는 2021년 .* · CVE-2021-44228$/), ai: true });
      expect(해설말풍선().some((m) => /^📚 비슷한 사례 1건 — nessus\.csv 반입.*🤖 이 CVE는 2021년/.test(m))).toBe(true);
      resetCollaborationForTests();
      const bad = await explainSimilarCasesForImport({ source: "nessus.csv", findings: 새항목 }, { chat: async () => JSON.stringify({ note: "2017년 워너크라이 사고와 같은 유형입니다 — 패치가 늦은 곳부터 당했습니다.", cases: ["워너크라이 대유행"] }) });
      expect(bad).toEqual({ caseIds: [c.id], caseNote: "Log4Shell 대규모 악용(2021) · CVE-2021-44228", ai: false });
      expect(해설말풍선().some((m) => /못 만듦/.test(m)), "사유 없이 삼켰다").toBe(true);
      // 죽어도 던지지 않는다 — void 호출이라 거부된 약속은 아무도 못 받는다
      resetCollaborationForTests();
      expect((await explainSimilarCasesForImport({ source: "nessus.csv", findings: 새항목 }, { chat: async () => { throw new Error("모델 없음"); } }))!.ai).toBe(false);
      expect(해설말풍선().some((m) => /실패 — 모델 없음/.test(m))).toBe(true);
    } finally { if (prev === undefined) delete process.env.GIJO_CASE_EXPLAIN; else process.env.GIJO_CASE_EXPLAIN = prev; }
  });
});

describe("배선 — 네 반입 경로가 전부 지나는 importVulnScan 끝에서 반입 훅을 부른다(2026-09-03)", () => {
  const 사례 = {
    title: "Log4Shell 대규모 악용", oneLiner: "Log4j 원격코드실행으로 전 세계 서버가 뚫렸다", plainExplain: "로그를 남기는 부품(Log4j)의 구멍으로 남이 우리 서버에서 명령을 실행할 수 있었습니다. 패치가 늦은 곳부터 당했습니다.",
    year: 2021, industry: "소프트웨어", region: "해외", cves: "CVE-2021-44228, CVE-2021-45046", products: "Apache Log4j", lesson: "부품 목록(SBOM)이 있어야 어디에 Log4j가 있는지 하루 안에 찾는다", sourceUrl: "https://www.cisa.gov/news-events/alerts/2021/12/10/apache-log4j-vulnerability-guidance", sourceName: "CISA",
  };
  const 사례말풍선 = () => 해설말풍선().filter((m) => m.startsWith("📚 비슷한 사례"));
  const 잠깐 = () => new Promise((r) => setTimeout(r, 40)); // 훅은 void — 반입을 기다리게 하지 않으므로 한 틱 뒤에 본다

  it("★ Nessus CSV 반입: 반입 한 번 = 말풍선 하나(호스트·finding이 여럿이어도) · 재스캔(active)에서는 되풀이하지 않는다 · 새 CVE만 다시 말한다", async () => {
    resetAssetsForTests();
    registerIncidentCase(사례, "정요한");
    resetCollaborationForTests();
    const csv = "Plugin ID,CVE,Risk,Host,Name\n100,CVE-2021-44228,Critical,10.0.0.5,Log4j RCE\n200,CVE-2021-44228,Critical,10.0.0.6,Log4j RCE\n";
    importVulnScan(csv, "csv", "nessus.csv");
    await 잠깐();
    expect(사례말풍선()).toHaveLength(1);
    expect(사례말풍선()[0]).toContain("nessus.csv 반입에서 CVE 있는 새 취약점 2건 중 CVE-2021-44228");
    // 재스캔 — 둘 다 active. 같은 사례를 다시 말하면 담당자는 매 반입마다 같은 말풍선을 본다
    resetCollaborationForTests();
    importVulnScan(csv, "csv", "nessus.csv");
    await 잠깐();
    expect(해설말풍선()).toEqual([]);
    // 새 CVE(같은 사례의 다른 CVE)가 하나 붙으면 그것만 — 이미 말한 CVE-2021-44228은 꼬리에 없다
    importVulnScan(csv + "300,CVE-2021-45046,High,10.0.0.5,Log4j 2.15\n", "csv", "nessus.csv");
    await 잠깐();
    expect(사례말풍선()).toHaveLength(1);
    expect(사례말풍선()[0]).toContain("새 취약점 1건 중 CVE-2021-45046");
    expect(사례말풍선()[0]).not.toContain("CVE-2021-44228");
  });

  it("후보가 없는 반입은 침묵한다 — CVE가 없거나 표에 없으면 말풍선도 없다", async () => {
    resetAssetsForTests();
    registerIncidentCase(사례, "정요한");
    resetCollaborationForTests();
    importVulnScan("Host,Name,Risk,CVE\n10.0.0.9,OpenSSL 취약점,High,CVE-2024-0001\n10.0.0.9,SMB signing,Medium,\n", "csv", "other.csv");
    await 잠깐();
    expect(해설말풍선()).toEqual([]);
  });

  it("소스 감시: 훅은 등록·메타 갱신·finding 기록이 끝난 뒤 한 번, 웹보고서(webreport)는 건너뛴다 — 초안 훅이 caseNote 저장 계약을 진다(이중 발화 금지)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "vulnscan.ts"), "utf8");
    const i = src.indexOf("export function importVulnScan(");
    const body = src.slice(i, src.indexOf("\n}\n", i));
    expect(body).toContain('if (format !== "webreport" && 새CVE항목.length) void explainSimilarCasesForImport({ source: sourceLabel, findings: 새CVE항목 });');
    // 훅이 호스트 루프의 recordFindings 뒤에 온다 — 앞에 오면 아직 등록 안 된 것을 말한다
    expect(body.lastIndexOf("recordFindings(")).toBeLessThan(body.indexOf("void explainSimilarCasesForImport("));
    // 재료는 state==="new"만 — 재스캔마다 같은 사례를 되풀이하지 않는다
    expect(body).toContain('if (f.state !== "new") continue;');
    // 웹보고서 경로는 초안 훅이 맡는다 — 그 훅은 그대로 살아 있어야 한다(둘 다 없어지면 웹보고서에서 사례가 안 붙는다)
    const au = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "autoupload.ts"), "utf8");
    expect(au.slice(au.indexOf("async function tryWebReport"))).toContain("void draftScanInterpretation(");
  });
});
