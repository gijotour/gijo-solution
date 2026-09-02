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
} from "../src/engine/scandrafts";
import { collaborationHistory, resetCollaborationForTests } from "../src/engine/collaboration";
const scan말풍선 = () => collaborationHistory(200).filter((e) => e.from === "scan").map((e) => e.message);
import { listTasks } from "../src/engine/tasks";
import { TARGETS, RESET_TARGETS } from "../src/engine/datacleanup";

const vulns = [
  { code: "IW-20", name: "서버 정보 노출", risk: "중", host: "cert.example.co.kr" },
  { code: "WEB-05", name: "디렉토리 인덱싱", risk: "상", host: "www.example.co.kr" },
  { code: "IW-25", name: "평문 전송", risk: "상", host: "cert.example.co.kr" },
];
const input = { source: "안전대부_웹취약점_보고서.pdf", hosts: 2, findings: 3, vulns };

beforeEach(() => { db.prepare("DELETE FROM scan_drafts").run(); });

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
});
