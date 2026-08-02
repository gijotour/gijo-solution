// 자가 진단이 **모델이 죽은 것을 보는가.**
//
// 왜 필요했나: observability.ts 머리말은 잡겠다고 적어 둔 사고를 셋 열거한다 —
//   지식베이스가 통째로 빔 · 임베딩 500으로 조용한 인입 실패 · WSL2 GPU 유휴 정지로 모델 멈춤.
//   그런데 정작 **모델·임베딩을 보는 항목이 없었다**(2026-08-02 발견).
//   주석은 약속하는데 코드가 안 지키는 자리 — 기능 QA로는 안 잡힌다(화면이 초록으로 뜨니까).
//
// ★ 핵심은 "안 떠 있음"이 아니라 **"떠 있는데 응답 준비가 안 됨"**이다.
//   채팅 모델은 필요할 때 올리는 구조라 유휴 중 비어 있는 것이 정상이다. 진짜 고장은
//   프로세스는 살아 있는데 못 받는 상태이고, 실측된 GPU 유휴 정지가 그 모양이었다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const 상태 = vi.hoisted(() => ({
  v: {
    running: true, port: 8080, modelId: "m1",
    loaded: [{ modelId: "m1", port: 8080, ready: true }],
    embedding: { running: true, port: 8081, modelId: "bge-m3" },
  } as Record<string, unknown>,
}));

vi.mock("../src/engine/localengine", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getLocalEngineStatus: vi.fn(() => 상태.v),
}));

const { systemHealth } = await import("../src/engine/observability");
const 항목 = (id: string) => systemHealth().checks.find((c) => c.id === id);

beforeEach(() => {
  상태.v = {
    running: true, port: 8080, modelId: "m1",
    loaded: [{ modelId: "m1", port: 8080, ready: true }],
    embedding: { running: true, port: 8081, modelId: "bge-m3" },
  };
});

describe("자가 진단 — AI 모델", () => {
  it("정상이면 ok", () => {
    expect(항목("model")!.level).toBe("ok");
  });

  it("★ 떠 있는데 응답 준비가 안 되면 fail — GPU 유휴 정지가 이 모양이다", () => {
    상태.v.loaded = [{ modelId: "m1", port: 8080, ready: false }];
    const c = 항목("model")!;
    expect(c.level, "떠 있으니 괜찮다고 보면 담당자는 멈춘 줄 모른다").toBe("fail");
    expect(c.action, "무엇을 하면 되는지 없으면 알려 준 의미가 없다").toBeTruthy();
    expect(c.detail).toContain("m1");
  });

  it("상주 모델이 없으면 warn — 고장이 아니라 필요할 때 올라온다", () => {
    상태.v.loaded = [];
    const c = 항목("model")!;
    expect(c.level, "쉬고 있는 것을 고장으로 부르면 경고가 흔해져 진짜를 놓친다").toBe("warn");
    expect(c.action).toBeTruthy();
  });

  it("상태를 못 재면 unknown — 정상으로 세지 않는다", () => {
    상태.v = null as unknown as Record<string, unknown>;
    expect(항목("model")!.level).toBe("unknown");
  });
});

describe("자가 진단 — 임베딩", () => {
  it("정상이면 ok", () => {
    expect(항목("embedding")!.level).toBe("ok");
  });

  it("안 떠 있으면 fail — 문서 인입·검색이 조용히 실패한다", () => {
    상태.v.embedding = { running: false, port: 8081, modelId: null };
    const c = 항목("embedding")!;
    expect(c.level, "채팅 모델과 달리 임베딩은 항상 떠 있어야 한다").toBe("fail");
    expect(c.detail).toContain("문서");
  });
});

describe("전체 판정", () => {
  it("모델이 fail이면 전체도 fail — 정상 항목에 묻히지 않는다", () => {
    상태.v.loaded = [{ modelId: "m1", port: 8080, ready: false }];
    const h = systemHealth();
    expect(h.level).toBe("fail");
    expect(h.headline, "무엇을 봐야 하는지 이름이 나와야 한다").toContain("AI 모델");
  });
});
