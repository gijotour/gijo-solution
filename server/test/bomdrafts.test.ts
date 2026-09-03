// bomdrafts.test.ts — 8번째 팀원 부품표(BOM)의 「부르는 문」 계약 + 팀원별 「맡은 메뉴」 단일 출처 (2026-09-03, 사장님 지시).
//
// 부르는 문 ① 타사 SBOM 검수(규칙) 직후 해석 초안 — 먼저 볼 부품은 검수 결과에 있는 부품만.
// 부르는 문 ② 라이선스 의무 설명 — 규칙 판정문은 항상, 팀원 설명은 시간 예산 안에서만.
// 맡은 메뉴 — 등록부(AGENT_DEFS.menus)가 단일 출처, 값은 screenguide가 아는 화면 파일명, 두 API에 같이 실린다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "../src/db";
import { validateBomDraft, buildBomDraftPrompt, draftBomInterpretation, listBomDrafts, formatBomDrafts, explainLicense, deleteBomDraftsForReview } from "../src/engine/bomdrafts";
import { collaborationHistory, resetCollaborationForTests } from "../src/engine/collaboration";
import { listAgents, getAgentById } from "../src/engine/agents";
import { getTeamComposition } from "../src/engine/teamview";
import { screenTips } from "../src/engine/screenguide";
import { TARGETS, RESET_TARGETS } from "../src/engine/datacleanup";

const parts = [
  { name: "openssl", version: "3.0.2", license: "Apache-2.0", tier: "고지만", 받게되는요구: "저작권 고지" },
  { name: "readline", version: "8.1", license: "GPL-3.0", tier: "전체소스공개", 받게되는요구: "링크한 프로그램 소스 공개" },
  { name: "ghostscript", version: "10.0", license: "AGPL-3.0", tier: "서비스도공개", 받게되는요구: "네트워크 서비스 소스 공개" },
];
const input = { reviewId: "rv1", source: "협력사_납품_SBOM.json", componentCount: 3, summary: { 서비스도공개: 1, 전체소스공개: 1, 고지만: 1 }, components: parts };
const bom말풍선 = () => collaborationHistory(200).filter((e) => e.from === "bom").map((e) => e.message);

beforeEach(() => { db.prepare("DELETE FROM bom_drafts").run(); });

describe("등록부 — 부품표(bom)는 8번째 팀원이고 전원에게 맡은 메뉴가 있다", () => {
  it("여덟 명, 부품이 맨 뒤, 약자 부품, 기본 idle", () => {
    expect(listAgents().map((a) => a.id)).toEqual(["orchestrator", "scan", "analysis", "report", "ti", "normaltic", "curator", "bom"]);
    const b = getAgentById("bom")!;
    expect(b.abbr).toBe("부품");
    expect(b.defaultStatus).toBe("idle");
    expect(b.role).toMatch(/부품표/);
  });

  it("맡은 메뉴는 screenguide가 아는 화면 파일명이고 제목이 따라온다 — 빈 팀원은 이유가 적혀 있다", () => {
    // 전용 화면이 없는 팀원은 이유와 함께 예외 — 빈 배열을 조용히 허용하지 않는다.
    const 예외: Record<string, string> = { normaltic: "복합 지시 파이프라인의 해설 단계로만 개입 — 전용 화면이 없다(정찰 2026-09-03)" };
    // screenTips는 모르는 화면에도 개요 제목을 준다 — 「비어 있지 않다」로는 아무것도 못 잡는다(항진식, 검토관 2026-09-03). 폴백 제목과 다른지 본다.
    const 폴백 = screenTips("__없는화면__.html").title;
    for (const a of listAgents()) {
      if (예외[a.id]) { expect(a.menus, `${a.id}: 예외인데 메뉴가 있다 — 예외를 지워라`).toEqual([]); continue; }
      expect(a.menus.length, `${a.id}: 맡은 메뉴가 없다`).toBeGreaterThan(0);
      for (const m of a.menus) {
        expect(m, `${a.id}: 화면 파일명 모양이 아니다`).toMatch(/^[a-z-]+\.html$/);
        expect(screenTips(m).title, `${a.id}: screenguide가 모르는 화면 ${m}`).not.toBe(폴백);
      }
      expect(a.menuTitles).toEqual(a.menus.map((m) => screenTips(m).title));
      // 허브와 그 안의 판을 둘 다 적으면 같은 곳이 칩 두 개로 보인다 — 허브 파일(discover·triage·fix·verify·reporting·aihub)은 안 적는다
      for (const m of a.menus) expect(["discover.html", "triage.html", "fix.html", "verify.html", "reporting.html", "aihub.html"], `${a.id}: 허브 ${m}는 판을 적어라`).not.toContain(m);
    }
    expect(getAgentById("bom")!.menus).toEqual(["supplychain.html", "sbom.html"]);
  });

  it("두 API(팀원 목록·팀 구성)가 같은 메뉴를 준다 — 화면마다 딴 그림이 되지 않게", () => {
    const t = getTeamComposition();
    expect(t.members.length).toBe(8);
    for (const m of t.members) {
      const a = getAgentById(m.id)!;
      expect(m.menus).toEqual(a.menus);
      expect(m.menuTitles).toEqual(a.menuTitles);
    }
  });
});

describe("부품표 해석 초안 — 근거 검증", () => {
  it("검수 결과에 없는 부품은 버리고, 버전을 지어내면 이름으로 교정한다", () => {
    const v = validateBomDraft(JSON.stringify({
      summary: "AGPL 부품이 있어 서비스 소스 공개 요구를 받을 수 있는 부품표입니다. 먼저 ghostscript를 확인하세요.",
      priorities: [
        { name: "ghostscript", version: "10.0", license: "AGPL-3.0", why: "네트워크 서비스 소스 공개" },
        { name: "readline", version: "9.9", license: "GPL-3.0", why: "버전을 지어냈지만 이름으로 교정" },
        { name: "libfoo", version: "1.0", license: "MIT", why: "없는 부품" },
      ],
      caveats: ["공급사에 라이선스 원문 확인", "需要确认"],
    }), parts)!;
    expect(v.draft.priorities.map((p) => `${p.name}@${p.version}`)).toEqual(["ghostscript@10.0", "readline@8.1"]);
    expect(v.dropped).toBe(1);
    expect(v.draft.caveats).toEqual(["공급사에 라이선스 원문 확인"]);
    expect(validateBomDraft(JSON.stringify({ summary: "충분히 긴 요약 문장입니다.", priorities: [{ name: "없음", version: "", license: "", why: "" }], caveats: [] }), parts)).toBeNull();
  });

  it("모델이 「이름@버전」·「이름 (라이선스)」로 합쳐 써도 부품을 찾는다(격리 실측에서 첫 초안이 버려진 원인)", () => {
    const v = validateBomDraft(JSON.stringify({ summary: "AGPL 부품이 있어 서비스 소스 공개를 요구받을 수 있습니다.", priorities: [
      { name: "ghostscript@10.0", version: "", license: "AGPL-3.0", why: "서비스 소스 공개" },
      { name: "readline (GPL-3.0)", version: "8.1", license: "GPL-3.0", why: "링크 소스 공개" },
    ], caveats: [] }), parts)!;
    expect(v).not.toBeNull();
    expect(v.draft.priorities.map((p) => `${p.name}@${p.version}`)).toEqual(["ghostscript@10.0", "readline@8.1"]);
    expect(v.dropped).toBe(0);
  });

  it("판본 없는 「AGPL」·「GPL」은 licenserisk 자유표기 한 곳이 읽어 확인필요가 붙는다 — 부품 팀원은 별칭 표를 갖지 않는다", async () => {
    const prev = process.env.GIJO_BOM_EXPLAIN; process.env.GIJO_BOM_EXPLAIN = "0";
    try {
      const s = await explainLicense("AGPL");
      expect(s).toMatch(/AGPL — 등급 「서비스도공개」 \(확인 필요\)/);
      expect(s).toContain("AGPL-3.0-only로 읽었습니다");
      const g = await explainLicense("GPL 쓰면 소스 공개 의무가 있나요?"); // 문장이 들어와도 라이선스 이름만 뽑는다
      expect(g).toMatch(/GPL — 등급 「전체소스공개」 \(확인 필요\)/);
      expect(await explainLicense("MIT")).toMatch(/MIT — 등급 「고지만」/);
      expect(await explainLicense("MIT")).not.toContain("확인 필요");
      expect(await explainLicense("라이선스요")).toContain("이름을 적어 주세요");
    } finally { if (prev === undefined) delete process.env.GIJO_BOM_EXPLAIN; else process.env.GIJO_BOM_EXPLAIN = prev; }
    // 소스 감시 — bomdrafts는 자기 판본 표를 갖지 않는다(같은 물음에 두 답이 나던 원인)
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "bomdrafts.ts"), "utf8");
    expect(src).not.toMatch(/흔한판본|판본풀이/);
  });

  it("@scope 부품은 이름의 일부이고, 짧은 이름·둘 이상 걸리는 접두는 버린다(다른 부품으로 조용히 치환 금지)", () => {
    const comps = [
      { name: "@babel/core", version: "7.0.0", license: "MIT", tier: "고지만", 받게되는요구: "고지" },
      { name: "openssl", version: "3.0.2", license: "Apache-2.0", tier: "고지만", 받게되는요구: "고지" },
      { name: "log4j-api", version: "2.17", license: "Apache-2.0", tier: "고지만", 받게되는요구: "고지" },
      { name: "log4j-core", version: "2.17", license: "Apache-2.0", tier: "고지만", 받게되는요구: "고지" },
      { name: "openssl-libssl", version: "3.0.2", license: "Apache-2.0", tier: "고지만", 받게되는요구: "고지" },
    ];
    const v = validateBomDraft(JSON.stringify({ summary: "스코프 부품과 접두가 겹치는 부품을 골라 검증합니다.", priorities: [
      { name: "@babel/core@7.0.0", version: "", license: "MIT", why: "스코프 이름" },
      { name: "ssl", version: "", license: "", why: "너무 짧은 이름 → 버림" },
      { name: "log4j", version: "", license: "", why: "api·core 둘 다 걸림 → 버림" },
      { name: "libssl", version: "", license: "", why: "openssl-libssl 하나만 접미로 걸림 → 교정" },
    ], caveats: [] }), comps)!;
    expect(v.draft.priorities.map((p) => p.name)).toEqual(["@babel/core", "openssl-libssl"]);
    expect(v.dropped).toBe(2);
  });

  it("프롬프트는 무거운 등급을 앞에 놓고 등급 이름을 규칙 원문 그대로 쓴다", () => {
    const p = buildBomDraftPrompt(input);
    expect(p.indexOf("ghostscript")).toBeLessThan(p.indexOf("openssl"));
    expect(p).toContain("등급 서비스도공개");
    expect(p).toContain("법적 판단을 내리지 마라");
  });

  it("왕복 — 초안이 저장되고 협업 창에 부품 팀원 이름으로 남는다 · 실패는 저장 없이 사유만", async () => {
    resetCollaborationForTests();
    const r = await draftBomInterpretation(input, { chat: async (a) => { expect(a.agentId).toBe("bom"); expect(a.message).toContain("ghostscript@10.0"); return JSON.stringify({ summary: "AGPL 부품 하나가 서비스 소스 공개를 요구합니다. 먼저 대체 여부를 보세요.", priorities: [{ name: "ghostscript", version: "10.0", license: "AGPL-3.0", why: "서비스 소스 공개" }], caveats: [] }); } });
    expect(r).not.toBeNull();
    const rows = listBomDrafts();
    expect(rows.length).toBe(1);
    expect(formatBomDrafts(rows)).toContain("ghostscript@10.0 (AGPL-3.0)");
    expect(bom말풍선().some((m) => /부품표 해석 초안 — 먼저 볼 부품 1건/.test(m))).toBe(true);
    expect(await draftBomInterpretation(input, { chat: async () => { throw new Error("모델 없음"); } })).toBeNull();
    expect(listBomDrafts().length).toBe(1);
    expect(bom말풍선().some((m) => /초안 실패 — 모델 없음/.test(m))).toBe(true);
    // 검증 실패 사유가 협업 창에도 남는다(서버 로그에만 있으면 담당자는 「맞지 않음」만 본다)
    expect(await draftBomInterpretation(input, { chat: async () => JSON.stringify({ summary: "충분히 긴 요약 문장입니다만", priorities: [{ name: "없는부품", version: "", license: "", why: "" }], caveats: [] }) })).toBeNull();
    expect(bom말풍선().some((m) => /못 만듦 — 우선 부품 1건 중 검수 부품과 맞는 것 0/.test(m))).toBe(true);
    // 검수를 지우면 초안도 함께(sbomreview.검수삭제가 부른다)
    expect(deleteBomDraftsForReview("rv1")).toBe(1);
    expect(listBomDrafts().length).toBe(0);
  });
});

describe("라이선스 의무 설명 — 규칙 판정문은 항상, 팀원 설명은 예산 안에서만", () => {
  it("판정·요구·근거·면책이 먼저 나가고, 설명은 목록 안 사실만 풀어 쓴다", async () => {
    const prev = process.env.GIJO_BOM_EXPLAIN; process.env.GIJO_BOM_EXPLAIN = "1";
    try {
      const s = await explainLicense("AGPL-3.0", { chat: async (a) => { expect(a.agentId).toBe("bom"); return JSON.stringify({ explanation: "이 부품을 서비스에 넣으면 서비스 이용자에게도 소스를 공개해야 합니다. 대체 부품을 먼저 찾아보세요.", first_step: "대체 부품 후보 조사" }); } });
      expect(s).toMatch(/AGPL-3\.0 — 등급 「/);
      expect(s).toContain("요구:");
      expect(s).toContain("🤖 부품 팀원 설명:");
      expect(s).toContain("먼저 할 일: 대체 부품 후보 조사");
      expect(s).toMatch(/면책|법률 자문|법무/);
      // 모델이 죽어도 판정문은 나간다
      const s2 = await explainLicense("MIT", { chat: async () => { throw new Error("x"); } });
      expect(s2).toMatch(/MIT — 등급 「/);
      expect(s2).not.toContain("부품 팀원 설명");
      // 한자가 섞이면 설명만 빠진다
      const s3 = await explainLicense("GPL-3.0", { chat: async () => JSON.stringify({ explanation: "源代码 공개 의무가 생깁니다 서비스 전체에 해당합니다", first_step: "" }) });
      expect(s3).not.toContain("부품 팀원 설명");
      // 시간 예산
      const prevMs = process.env.GIJO_BOM_EXPLAIN_MS; process.env.GIJO_BOM_EXPLAIN_MS = "500";
      try {
        const s4 = await explainLicense("Apache-2.0", { chat: () => new Promise((r) => setTimeout(() => r(JSON.stringify({ explanation: "늦게 온 설명입니다 열 글자 넘게 씁니다", first_step: "" })), 1500)) });
        expect(s4).not.toContain("부품 팀원 설명");
      } finally { if (prevMs === undefined) delete process.env.GIJO_BOM_EXPLAIN_MS; else process.env.GIJO_BOM_EXPLAIN_MS = prevMs; }
    } finally { if (prev === undefined) delete process.env.GIJO_BOM_EXPLAIN; else process.env.GIJO_BOM_EXPLAIN = prev; }
  });
  it("GIJO_BOM_EXPLAIN=0 이면 모델을 부르지 않는다(시험 환경 기본)", async () => {
    const prev = process.env.GIJO_BOM_EXPLAIN; process.env.GIJO_BOM_EXPLAIN = "0";
    try { let called = 0; const s = await explainLicense("MIT", { chat: async () => { called += 1; return ""; } }); expect(called).toBe(0); expect(s).toMatch(/MIT — 등급 「/); }
    finally { if (prev === undefined) delete process.env.GIJO_BOM_EXPLAIN; else process.env.GIJO_BOM_EXPLAIN = prev; }
  });
});

describe("배선 — 문이 실제로 이어져 있다(소스 감시)", () => {
  const E = path.join(__dirname, "..", "src", "engine");
  it("타사 SBOM 반입 갈래가 검수 직후 부품 초안을 void로 부르고, 도구 두 개가 등록돼 있다", () => {
    const au = fs.readFileSync(path.join(E, "autoupload.ts"), "utf8");
    const i = au.indexOf('if (type === "sbom") {');
    const body = au.slice(i, au.indexOf('if (type === "securitylog"', i));
    expect(body).toContain("draftBomInterpretation(");
    expect(body).toMatch(/void /);
    const reg = fs.readFileSync(path.join(E, "agenttools", "registry.ts"), "utf8");
    expect(reg).toMatch(/name: "bom_drafts",[\s\S]{0,200}write: false/);
    expect(reg).toMatch(/name: "license_explain",[\s\S]{0,200}write: false/);
  });
  it("bom_drafts는 업무 데이터다 — 정리 대장과 실사용 전환 리셋에 들어 있다", () => {
    expect(TARGETS.bom_drafts?.tables).toEqual(["bom_drafts"]);
    expect([...RESET_TARGETS]).toContain("bom_drafts");
  });
  it("등급 이름을 새 코드가 다시 적지 않는다 — 판정·요구·면책은 licenserisk 한 곳(프롬프트 정렬 순서 한 곳만 예외)", () => {
    const src = fs.readFileSync(path.join(E, "bomdrafts.ts"), "utf8");
    expect(src).toContain('from "./licenserisk"');
    expect(src).not.toMatch(/받게되는요구:\s*"[^"]{4,}"/); // 요구 문장을 직접 짓지 않는다
  });
});
