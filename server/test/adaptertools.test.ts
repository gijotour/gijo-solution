// test/adaptertools.test.ts — 전문가 어댑터 대화창 도구 3종 (재설계 화면 연결, 2026-08-08)
//
// 계약: ① 화면 안내("채택·배정은 대화창에서")가 실제로 통한다 — 강제 라우팅이 결정적으로 잇는다
// ② 채택엔 근거 필수(없으면 실행 대신 안내) ③ 인자를 못 뽑으면 강제하지 않는다(빈 인자 결재판 방지)
// ④ admin 아닌 사용자에게 adopt는 숨겨진다 ⑤ 네트워크 어댑터 같은 딴 뜻은 안 삼킨다.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { forcedToolFor } from "../src/engine/agentloop";
import { runAdapterStatus, runAdapterAdopt, runAdapterAssign } from "../src/engine/agenttools/handlers";
import { registerAdapter, listAdapters, deleteAdapter, setAdapterAdopted } from "../src/engine/adapters";
import { setAgentAdapter, getAgentAdapter } from "../src/engine/agents";

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `gijo-adaptertool-${Date.now()}.gguf`);
  fs.writeFileSync(tmpFile, "dummy");
});

afterEach(() => {
  for (const a of listAdapters()) deleteAdapter(a.id);
  for (const ag of ["scan", "analysis", "report", "ti", "normaltic", "curator"]) setAgentAdapter(ag, null);
  fs.rmSync(tmpFile, { force: true });
});

describe("강제 라우팅 — 어댑터 지시", () => {
  const admin = { role: "admin" as const };

  it("「xxx.gguf 어댑터 반입해줘」가 import_adapter로 결정적으로 간다(파일·분야 추출)", () => {
    const r = forcedToolFor("site-b-expert.gguf 어댑터 취약점 분야로 반입해줘", admin);
    expect(r?.tool).toBe("import_adapter");
    expect(r?.args.file).toBe("site-b-expert.gguf");
    expect(r?.args.topic).toBe("취약점");
  });

  it("반입인데 파일명이 없으면 강제하지 않는다 — 빈 인자 결재판을 만들지 않는다", () => {
    const r = forcedToolFor("어댑터 반입해줘", admin);
    expect(r?.tool).not.toBe("import_adapter");
  });

  it("「채택, 근거:」 지시가 adopt_adapter로 결정적으로 간다(근거까지 추출)", () => {
    const r = forcedToolFor("sec-expert-vuln-v2 어댑터 채택, 근거: 게이트 routing 66/66 통과", admin);
    expect(r?.tool).toBe("adopt_adapter");
    expect(r?.args.adapter).toBe("sec-expert-vuln-v2");
    expect(r?.args.mode).toBe("채택");
    expect(r?.args.note).toContain("66/66");
  });

  it("「채택 해제」는 mode=해제", () => {
    const r = forcedToolFor("sec-expert-vuln-v2 어댑터 채택 해제해줘", admin);
    expect(r?.tool).toBe("adopt_adapter");
    expect(r?.args.mode).toBe("해제");
  });

  it("어댑터 이름을 못 뽑으면 강제하지 않는다 — 빈 인자 결재판 방지", () => {
    const r = forcedToolFor("어댑터 채택해줘", admin);
    expect(r?.tool).not.toBe("adopt_adapter");
  });

  it("배정 지시가 assign_adapter로 간다(팀원·어댑터 추출)", () => {
    const r = forcedToolFor("스캔 팀원에 sec-expert-vuln-v2 어댑터 배정해줘", admin);
    expect(r?.tool).toBe("assign_adapter");
    expect(r?.args.agent).toBe("스캔");
    expect(r?.args.adapter).toBe("sec-expert-vuln-v2");
  });

  it("현황 질문이 adapter_status로 간다 — 담당자 권한도 조회는 된다", () => {
    expect(forcedToolFor("어댑터 현황 알려줘", admin)?.tool).toBe("adapter_status");
    expect(forcedToolFor("전문가 어댑터 뭐 있어?", { role: "security_officer" as const })?.tool).toBe("adapter_status");
  });

  it("admin 아닌 사용자의 채택 지시는 adopt로 강제되지 않는다(권한 필터)", () => {
    const r = forcedToolFor("sec-expert-vuln-v2 어댑터 채택해줘", { role: "security_officer" as const });
    expect(r?.tool).not.toBe("adopt_adapter");
  });

  it("네트워크 어댑터는 딴 뜻 — 안 삼킨다", () => {
    const r = forcedToolFor("네트워크 어댑터 상태 알려줘", admin);
    expect(r?.tool).not.toBe("adapter_status");
  });
});

describe("핸들러 계약", () => {
  const 등록 = () => registerAdapter({ id: "vuln-x-v1", topic: "취약점", baseModelId: "qwen3-14b", file: tmpFile });

  it("채택은 근거 없이는 실행되지 않고 안내를 돌려준다", async () => {
    등록();
    const out = await runAdapterAdopt({ adapter: "vuln-x-v1", mode: "채택", note: "" });
    expect(out).toContain("근거");
    expect(listAdapters()[0].adopted).toBe(false); // 실행 안 됨
  });

  it("근거와 함께면 채택되고 재기동 필요를 정직하게 말한다", async () => {
    등록();
    // ⚠ 2026-09-02: 챗봇으로 채택할 때도 근거가 필요하다. 챗봇은 게이트를 직접 못 돌리므로
    //   **사람이 적는 강행 사유**(20자 이상)가 근거가 된다 — 도구 설명의 예시와 같은 결이다.
    const out = await runAdapterAdopt({ adapter: "vuln-x-v1", mode: "채택", note: "게이트 routing 66/66 · A/B 10문 통과 확인함" });
    expect(out).toContain("채택했습니다");
    expect(out).toContain("다시 올릴 때부터"); // 서빙 반영 시점 정직 고지
    expect(listAdapters()[0].adopted).toBe(true);
  });

  it("배정은 채택분만 — 총괄 금지 메시지가 그대로 전달된다", async () => {
    등록();
    const miss = await runAdapterAssign({ agent: "스캔", adapter: "vuln-x-v1" });
    expect(miss).toContain("채택되지 않은"); // agents가 거부
    setAdapterAdopted("vuln-x-v1", true, "평가 게이트 통과", { verdict: "통과" });
    const ok = await runAdapterAssign({ agent: "스캔", adapter: "vuln-x-v1" });
    expect(ok).toContain("배정했습니다");
    expect(getAgentAdapter("scan")).toBe("vuln-x-v1");
    const orch = await runAdapterAssign({ agent: "총괄", adapter: "vuln-x-v1" });
    expect(orch).toContain("결정성");
  });

  it("현황은 등록부·배정·주제 진척·다음 걸음 안내를 한 번에 준다", async () => {
    등록();
    const out = await runAdapterStatus();
    expect(out).toContain("vuln-x-v1");
    expect(out).toContain("미채택");
    expect(out).toContain("주제 재료");
    expect(out).toContain("채택:"); // 안내한 말 — 실제 지시 예시
  });
});
