// 전문가(어댑터) 채택에 근거를 요구한다 — 승인 시안 mockups/내회사전문가 ③ (2026-09-02).
//
// ■ 왜 이 시험이 있나
//   예전에는 어댑터를 만들 때 note에 「평가 게이트 통과 후 채택하세요」라고 **적어 두기만** 하고,
//   채택 창구는 그 결과를 **요구하지 않았다.** 관리자가 아무 근거 없이 채택할 수 있었고,
//   검증 안 된 전문가가 그대로 실서비스 대화에 실린다 — 규칙은 있는데 지키는 것이 사람 몫이었다.
//   이 시험은 그 문이 **다시 열리면** 알린다.
//
// 계획서: 중-3(평가 게이트) 갈래 — 게이트를 통과해야 쓰인다는 약속을 코드가 강제하는 자리다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerAdapter, setAdapterAdopted, listAdapters } from "../src/engine/adapters";

// registerAdapter는 **파일이 실제로 있는지** 확인한다(빈 등록을 막는 장치다 — 좋은 검사라 우회하지 않는다).
// 그래서 시험도 진짜 파일을 하나 만들어 쓴다.
const 임시파일 = path.join(os.tmpdir(), "gijo-adoptgate-test.gguf");
fs.writeFileSync(임시파일, "x");
const 기본 = { baseModelId: "qwen3-14b", file: 임시파일, topic: "취약점" };
let 번호 = 0;
const 새어댑터 = () => {
  const id = `test-adapter-${++번호}`;
  registerAdapter({ id, ...기본, note: "미채택 — 게이트 통과 후 채택하세요" });
  return id;
};

describe("채택에는 근거가 필요하다", () => {
  it("★★ 게이트 결과가 없으면 짧은 한 마디로는 채택되지 않는다", () => {
    const id = 새어댑터();
    expect(() => setAdapterAdopted(id, true, "좋아 보임")).toThrow(/게이트|사유/);
  });

  it("★★ 게이트가 통과가 아니면 그대로는 채택되지 않는다", () => {
    const id = 새어댑터();
    expect(() => setAdapterAdopted(id, true, "괜찮음", { verdict: "채택 보류" })).toThrow(/보류|사유/);
  });

  it("★ 게이트를 통과했으면 채택된다 — 근거가 함께 남는다", () => {
    const id = 새어댑터();
    const r = setAdapterAdopted(id, true, "평가 게이트 통과", { verdict: "통과", axes: { routing: { passRate: 1 } } });
    expect(r.adopted, "통과했는데 채택이 안 됐다").toBe(true);
    expect(r.gate, "근거가 안 남았다 — 나중에 「왜 채택했나」를 되짚을 수 없다").toBeTruthy();
    const g = JSON.parse(r.gate!);
    expect(g.verdict).toBe("통과");
    expect(g.강행, "통과인데 강행으로 기록됐다").toBe(false);
  });

  it("★★ 강행은 **막지 않되 반드시 남는다** — 사유 20자 이상", () => {
    // 게이트를 못 돌리는 상황이 실제로 있다(급한 되돌림 등). 길을 아예 막으면 사람들이 우회로를
    // 만든다 — 대신 사유를 적게 하고 그것을 근거로 남긴다(학습 개시선 미달 강행과 같은 결).
    const id = 새어댑터();
    const 사유 = "게이트 장비 점검 중이라 못 돌렸고 담당자 A/B 육안 확인으로 대체함";
    const r = setAdapterAdopted(id, true, 사유);
    expect(r.adopted, "사유를 20자 이상 적었는데 채택이 안 됐다").toBe(true);
    const g = JSON.parse(r.gate!);
    expect(g.강행, "강행인데 그 사실이 안 남았다 — 나중에 구분이 안 된다").toBe(true);
    expect(g.verdict, "게이트가 없었다는 사실이 안 남았다").toContain("게이트 없음");
  });

  it("★★ 「통과」로 **시작만** 하는 값을 통과로 치지 않는다(gb10 1차 선별이 잡은 자리)", () => {
    // 처음엔 startsWith("통과")로 썼다 — 그러면 「통과하지 못함」이 통과가 된다.
    // 사람이 손으로 적어 보내는 값이라 이런 문자열이 실제로 올 수 있다.
    const id = 새어댑터();
    expect(() => setAdapterAdopted(id, true, "짧은 근거", { verdict: "통과하지 못함" })).toThrow(/보류|사유|통과/);
  });

  it("「통과(리포트 없음)」 꼴은 통과로 본다 — adopt.mjs가 실제로 그 값을 쓴다", () => {
    const id = 새어댑터();
    const r = setAdapterAdopted(id, true, "게이트 통과", { verdict: "통과(리포트 없음)" });
    expect(r.adopted).toBe(true);
    expect(JSON.parse(r.gate!).강행, "통과인데 강행으로 기록됐다").toBe(false);
  });

  it("해제는 근거를 요구하지 않는다 — 되돌리는 길을 막으면 안 된다", () => {
    const id = 새어댑터();
    setAdapterAdopted(id, true, "평가 게이트 통과", { verdict: "통과" });
    const r = setAdapterAdopted(id, false);
    expect(r.adopted, "채택을 해제하지 못한다 — 문제가 생겨도 못 되돌린다").toBe(false);
  });

  it("★ 채택된 것만 목록에서 채택으로 보인다(다른 어댑터에 안 번진다)", () => {
    const a = 새어댑터();
    const b = 새어댑터();
    setAdapterAdopted(a, true, "평가 게이트 통과", { verdict: "통과" });
    const 목록 = listAdapters();
    expect(목록.find((x) => x.id === a)?.adopted).toBe(true);
    expect(목록.find((x) => x.id === b)?.adopted, "손대지 않은 어댑터가 함께 채택됐다").toBe(false);
  });
});
