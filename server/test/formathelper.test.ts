// formathelper.test.ts — 서식 전용 보조 모델(2026-09-03, 사장님 「전부 승인」 3항 + 설계관 갈래 A).
//
// 계약: ① 팀원 배정이 아니라 **호출별** 모델이다 — 스키마 강제 서식·추출 호출(스캔 초안·보안제품 정형 초안)만 받는다.
//       ② 보고 팀원의 판단 호출(report.ts 경영진 요약)에는 절대 안 붙는다(경계를 코드가 지킨다).
//       ③ 없는 모델은 배정할 수 없고, 파일이 사라지면 읽을 때 무시한다. 배정·해제는 감사에 남는다.
import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getFormatHelperModel, setFormatHelperModel } from "../src/engine/agents";
import { draftScanInterpretation } from "../src/engine/scandrafts";
import { classifyModelLicense } from "../src/engine/modellicense";
import { modelFilePath } from "../src/engine/localengine";
import { db } from "../src/db";

const ENGINE = path.join(__dirname, "..", "src", "engine");
const read = (f: string) => fs.readFileSync(path.join(ENGINE, f), "utf8");
// 엔진은 모델 폴더를 모듈 적재 때 잡는다(GIJO_MODELS_DIR) — 시험 본문에서 env를 바꿔도 늦다. 엔진이 실제로 보는 경로에 스텁을 둔다.
const MID = "mykor__Midm-2.0-Mini-Instruct-gguf-시험스텁";
const 스텁 = modelFilePath(MID);
const 스텁놓기 = () => { fs.mkdirSync(path.dirname(스텁), { recursive: true }); fs.writeFileSync(스텁, "stub"); };

beforeAll(() => 스텁놓기());
afterAll(() => { setFormatHelperModel(null, "jyh"); fs.rmSync(path.dirname(스텁), { recursive: true, force: true }); });

describe("서식 전용 보조 모델 — 배정·해제·감사", () => {
  it("배치된 모델만 배정되고, 해제하면 null, 둘 다 감사에 남는다", () => {
    setFormatHelperModel(null, "jyh");
    expect(getFormatHelperModel()).toBeNull();
    expect(() => setFormatHelperModel("없는-모델", "jyh")).toThrow(/배치되지 않은 모델/);
    setFormatHelperModel(MID, "jyh");
    expect(getFormatHelperModel()).toBe(MID);
    const rows = db.prepare("SELECT action, actor, target, detail FROM audit_log WHERE target = 'format-helper' ORDER BY at DESC LIMIT 2").all() as { action: string; actor: string; detail: string }[];
    expect(rows[0].action).toBe("서식 전용 보조 모델 배정");
    expect(rows[0].actor).toBe("jyh");
    expect(rows[0].detail).toBe(MID);
    setFormatHelperModel(null, "jyh");
    expect(getFormatHelperModel()).toBeNull();
  });

  it("파일이 사라지면 읽을 때 무시한다(배정 값이 남아도 서식 호출은 팀원 경로로)", () => {
    setFormatHelperModel(MID, "jyh");
    fs.rmSync(path.dirname(스텁), { recursive: true, force: true });
    expect(getFormatHelperModel()).toBeNull();
    setFormatHelperModel(null, "jyh");
    스텁놓기();
  });
});

describe("서식 전용 보조 모델 — 어느 호출이 받나(경계)", () => {
  it("스캔 초안 호출은 보조 모델이 있으면 modelOverride로 받는다(팀원은 그대로 scan)", async () => {
    db.prepare("DELETE FROM scan_drafts").run();
    setFormatHelperModel(MID, "jyh");
    let seen: { agentId?: string; modelOverride?: string } = {};
    const input = { source: "표본.txt", hosts: 1, findings: 1, vulns: [{ code: "IW-20", name: "디렉토리 인덱싱", risk: "하", host: "h1" }] };
    const r = await draftScanInterpretation(input, { chat: async (a) => { seen = a; return JSON.stringify({ summary: "디렉토리 인덱싱을 먼저 닫아야 하는 상태입니다.", priorities: [{ code: "IW-20", name: "디렉토리 인덱싱", host: "h1", why: "노출" }], caveats: [] }); } });
    expect(r).not.toBeNull();
    expect(seen.agentId).toBe("scan");
    expect(seen.modelOverride).toBe(MID);
    setFormatHelperModel(null, "jyh");
    await draftScanInterpretation(input, { chat: async (a) => { seen = a; return JSON.stringify({ summary: "디렉토리 인덱싱을 먼저 닫아야 하는 상태입니다.", priorities: [{ code: "IW-20", name: "디렉토리 인덱싱", host: "h1", why: "노출" }], caveats: [] }); } });
    expect(seen.modelOverride).toBeUndefined();
  });

  it("소스 감시 — 서식 호출 두 곳만 modelOverride를 넘기고, 판단 호출(보고 팀원 요약·TI 해석)은 넘기지 않는다", () => {
    expect(read("scandrafts.ts")).toMatch(/agentId: "scan"[^\n]*modelOverride: 보조/);
    expect(read("securityproducts.ts")).toMatch(/agentId: "curator",[\s\S]{0,400}modelOverride: 보조/);
    // 경계: 보고 팀원의 유일한 LLM 문(경영진 요약)과 TI 해석에는 없다
    const rep = read("report.ts");
    const 요약 = rep.slice(rep.indexOf('agentId: "report"') - 200, rep.indexOf('agentId: "report"') + 1200);
    expect(요약).not.toContain("modelOverride");
    const sd = read("scandrafts.ts");
    const ti = sd.slice(sd.indexOf("export async function interpretThreats("));
    expect(ti).not.toContain("modelOverride");
    // 배관: llm.ts가 override면 ensureModelServed로 가고 어댑터(LoRA)는 붙이지 않는다
    const llm = read("llm.ts");
    expect(llm).toMatch(/args\.modelOverride \? m\.ensureModelServed\(args\.modelOverride\) : m\.ensureAgentModel\(args\.agentId\)/);
    expect(llm).toMatch(/const loraExtras = args\.modelOverride\s*\?\s*\(\{\} as Record<string, unknown>\)/);
    // 창구: 조회는 로그인, 배정은 admin
    const ag = read("agents.ts");
    expect(ag).toMatch(/app\.get\("\/api\/agents\/format-helper", authMiddleware/);
    expect(ag).toMatch(/app\.post\("\/api\/agents\/format-helper", authMiddleware, adminMiddleware/);
  });

  it("라이선스 관문이 Mi:dm을 MIT(허용)로 안다 — 안 그러면 「법무 검토 필요」로 뜬다", () => {
    const l = classifyModelLicense(MID);
    expect(l.tier).toBe("permissive");
    expect(l.bundleSafe).toBe(true);
    expect(l.license).toMatch(/MIT/);
  });
});
