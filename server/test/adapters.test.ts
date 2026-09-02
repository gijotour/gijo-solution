// test/adapters.test.ts — 전문가 LoRA 어댑터 등록부·배정·서빙 배선 (AI팀 재설계 1단계, 2026-08-08)
//
// 계약: ① 등록≠채택 — 게이트 근거 없는 채택 금지 ② 채택분만 배정 가능 ③ 오케스트레이터 배정 금지
// ④ 어댑터가 없으면 서빙 요청이 기존과 완전히 같다(무영향) ⑤ 스폰·요청 배선이 실제로 불린다(소스 감시 —
// 함수를 만들어도 호출부가 안 부르는 사고가 9곳 실측된 프로젝트라, 배선 자체를 시험이 붙든다).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  registerAdapter,
  listAdapters,
  getAdapter,
  setAdapterAdopted,
  deleteAdapter,
  adoptedAdaptersFor,
} from "../src/engine/adapters";
import { setAgentAdapter, getAgentAdapter } from "../src/engine/agents";

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `gijo-adapter-test-${Date.now()}.gguf`);
  fs.writeFileSync(tmpFile, "dummy");
});

afterEach(() => {
  for (const a of listAdapters()) deleteAdapter(a.id);
  for (const agent of ["scan", "analysis", "report", "ti", "normaltic"]) setAgentAdapter(agent, null);
  fs.rmSync(tmpFile, { force: true });
});

const 등록 = (id = "vuln-expert-v1", topic: string | null = "취약점") =>
  registerAdapter({ id, topic, baseModelId: "qwen3-14b", file: tmpFile });

describe("어댑터 등록부", () => {
  it("등록하면 미채택 상태로 목록에 온다 — 등록은 채택이 아니다", () => {
    등록();
    const [a] = listAdapters();
    expect(a.id).toBe("vuln-expert-v1");
    expect(a.adopted).toBe(false);
    expect(a.baseModelId).toBe("qwen3-14b");
  });

  it("없는 파일·중복 id·잘못된 id는 거부한다", () => {
    expect(() => registerAdapter({ id: "x-v1", baseModelId: "b", file: "없는/경로.gguf" })).toThrow(/파일이 없습니다/);
    등록();
    expect(() => 등록()).toThrow(/이미 등록/);
    expect(() => registerAdapter({ id: "한글금지", baseModelId: "b", file: tmpFile })).toThrow(/영문 소문자/);
  });

  it("채택에는 근거(note)가 필수다 — 게이트 결과 없는 채택 금지", () => {
    등록();
    expect(() => setAdapterAdopted("vuln-expert-v1", true)).toThrow(/근거/);
    const adopted = setAdapterAdopted("vuln-expert-v1", true, "게이트 2026-08-08 routing 66/66 · A/B 10문 통과");
    expect(adopted.adopted).toBe(true);
    expect(adopted.note).toContain("게이트");
  });

  it("adoptedAdaptersFor는 베이스가 같고 채택된 것만, 파일이 사라진 것은 빼고 준다", () => {
    등록("vuln-expert-v1");
    등록("ops-expert-v1", "장비운영");
    registerAdapter({ id: "other-base-v1", baseModelId: "다른모델", file: tmpFile });
    // ⚠ 2026-09-02: 채택에 **구조화된 게이트 결과**가 필요해졌다(승인 시안 내회사전문가 ③).
    //   예전엔 「게이트 통과」 다섯 글자로 채택됐다 — 그것이 근거 없이 채택되던 구멍이었다.
    setAdapterAdopted("vuln-expert-v1", true, "평가 게이트 통과", { verdict: "통과" });
    setAdapterAdopted("other-base-v1", true, "평가 게이트 통과", { verdict: "통과" });
    const 서빙 = adoptedAdaptersFor("qwen3-14b");
    expect(서빙.map((a) => a.id)).toEqual(["vuln-expert-v1"]); // ops는 미채택, other는 베이스 다름
    fs.rmSync(tmpFile); // 파일 소실 시나리오 — 스폰 인자에 죽은 경로가 들어가면 모델 전체가 안 뜬다
    expect(adoptedAdaptersFor("qwen3-14b")).toEqual([]);
  });
});

describe("팀원 어댑터 배정", () => {
  it("채택된 어댑터만 배정할 수 있다", () => {
    등록();
    expect(() => setAgentAdapter("scan", "vuln-expert-v1")).toThrow(/채택되지 않은/);
    // ⚠ 2026-09-02: 채택에 **구조화된 게이트 결과**가 필요해졌다(승인 시안 내회사전문가 ③).
    //   예전엔 「게이트 통과」 다섯 글자로 채택됐다 — 그것이 근거 없이 채택되던 구멍이었다.
    setAdapterAdopted("vuln-expert-v1", true, "평가 게이트 통과", { verdict: "통과" });
    setAgentAdapter("scan", "vuln-expert-v1");
    expect(getAgentAdapter("scan")).toBe("vuln-expert-v1");
    setAgentAdapter("scan", null);
    expect(getAgentAdapter("scan")).toBeNull();
  });

  it("총괄(orchestrator)에는 배정할 수 없다 — 라우팅 결정성 보호", () => {
    등록();
    // ⚠ 2026-09-02: 채택에 **구조화된 게이트 결과**가 필요해졌다(승인 시안 내회사전문가 ③).
    //   예전엔 「게이트 통과」 다섯 글자로 채택됐다 — 그것이 근거 없이 채택되던 구멍이었다.
    setAdapterAdopted("vuln-expert-v1", true, "평가 게이트 통과", { verdict: "통과" });
    expect(() => setAgentAdapter("orchestrator", "vuln-expert-v1")).toThrow(/결정성/);
  });

  it("없는 에이전트·없는 어댑터는 거부한다", () => {
    expect(() => setAgentAdapter("유령", "x")).toThrow(/존재하지 않는 에이전트/);
    expect(() => setAgentAdapter("scan", "유령어댑터")).toThrow(/등록되지 않은/);
  });
});

describe("서빙 배선 소스 감시 — 함수만 만들고 안 부르는 함정 방지", () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", "src", "engine", f), "utf8");

  it("localengine 스폰이 채택 어댑터를 --lora-init-without-apply로 얹는다", () => {
    const s = src("localengine.ts");
    expect(s).toContain("adoptedAdaptersFor(modelId)");
    expect(s).toContain("--lora-init-without-apply");
    // 적재 순서 인덱스를 보존해야 요청별 선택(id=index)이 올바른 어댑터를 가리킨다
    expect(s).toMatch(/adapters:\s*어댑터들\.map/);
  });

  it("요청 경로(llm.ts)가 agentRequestExtras를 본문에 편다 — 재시도 요청 포함", () => {
    const s = src("llm.ts");
    expect(s).toContain("agentRequestExtras(args.agentId)");
    expect((s.match(/\.\.\.loraExtras/g) ?? []).length).toBeGreaterThanOrEqual(2); // 본요청+한글 재시도
  });

  it("캐시 오염 방어가 코드에 있다 — 어댑터 실린 모델은 cache_prompt:false", () => {
    const s = src("localengine.ts");
    expect(s).toContain("cache_prompt: false");
    expect(s).toContain("26207"); // 근거 이슈 번호 — 왜 끄는지 다음 사람이 알게
  });
});
