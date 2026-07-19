import { describe, it, expect, vi, afterEach } from "vitest";
import { getScreenContext, fallbackActionForScreen } from "../src/engine/screencontext";

describe("화면 컨텍스트", () => {
  it("페이지 파일명으로 화면을 찾는다", () => {
    expect(getScreenContext("vulnscan.html")?.label).toBe("취약점");
    expect(getScreenContext("report.html")?.label).toBe("내부 리포트");
  });

  it("경로가 붙어 와도 파일명만 떼어 인식한다", () => {
    expect(getScreenContext("pages/vulnscan.html")?.label).toBe("취약점");
    expect(getScreenContext("/app/src/renderer/pages/vulnscan.html")?.label).toBe("취약점");
  });

  it("모르는 화면·빈 값은 undefined (추측하지 않는다)", () => {
    expect(getScreenContext(undefined)).toBeUndefined();
    expect(getScreenContext("")).toBeUndefined();
    expect(getScreenContext("nonexistent.html")).toBeUndefined();
  });

  it("오케스트레이션 대상 화면만 기본 액션을 갖는다", () => {
    expect(fallbackActionForScreen("vulnscan.html")).toBe("analyze");
    expect(fallbackActionForScreen("inventory.html")).toBe("scan");
    expect(fallbackActionForScreen("report.html")).toBe("report");
    // 설정·로그는 지시 대상이 아니므로 추측하면 안 된다
    expect(fallbackActionForScreen("settings.html")).toBeUndefined();
    expect(fallbackActionForScreen("logs.html")).toBeUndefined();
    expect(fallbackActionForScreen("billing.html")).toBeUndefined();
  });

});

describe("화면 컨텍스트 라우팅 (routeIntent 폴백)", () => {
  afterEach(() => vi.unstubAllGlobals());

  // LLM 분류기를 죽여 정규식 폴백 경로를 강제한다 — 화면 신호가 여기서 쓰인다.
  function stubLlmDown() {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("LLM 없음")));
  }

  it("동사 없는 지시를 화면으로 해석한다 — 예전엔 전부 일반 대화로 떨어졌다", async () => {
    stubLlmDown();
    const { routeIntent } = await import("../src/engine/intent");

    const onVuln = await routeIntent("이거 정리해줘", "vulnscan.html");
    expect(onVuln.action).toBe("analyze");
    expect(onVuln.agentId).toBe("analysis");

    const onInventory = await routeIntent("이거 정리해줘", "inventory.html");
    expect(onInventory.action).toBe("scan");
  });

  it("화면을 모르면 종전대로 일반 대화", async () => {
    stubLlmDown();
    const { routeIntent } = await import("../src/engine/intent");
    const r = await routeIntent("이거 정리해줘");
    expect(r.action).toBe("chat");
  });

  it("지시문의 명시적 동사가 화면보다 우선한다", async () => {
    stubLlmDown();
    const { routeIntent } = await import("../src/engine/intent");
    // 취약점 화면(기본 analyze)이지만 "리포트"라고 했으면 리포트다
    const r = await routeIntent("리포트 뽑아줘", "vulnscan.html");
    expect(r.action).toBe("report");
  });

  it("오케스트레이션 대상 아닌 화면에서는 추측하지 않는다", async () => {
    stubLlmDown();
    const { routeIntent } = await import("../src/engine/intent");
    const r = await routeIntent("이거 정리해줘", "settings.html");
    expect(r.action).toBe("chat");
  });

  // 동사가 있으면 분류기 판단을 따른다 — 화면이 덮어쓰면 "리포트 뽑아줘"가 화면마다 다른 일을 한다.
  it("동사가 있으면 분류기 판단을 화면이 덮어쓰지 않는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"report","targetAssetId":null}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { routeIntent } = await import("../src/engine/intent");
    // 취약점 화면(기본 analyze)이지만 "리포트"라는 동사가 있고 분류기도 report라 했으므로 report
    const r = await routeIntent("리포트 뽑아줘", "vulnscan.html");
    expect(r.action).toBe("report");
  });

  // 같은 문장이 실행마다 다른 일을 하면 안 된다 — 동사 없는 지시는 화면이 결정적으로 정한다.
  it("동사 없는 지시는 분류기가 뭐라 하든 화면이 정한다(재현성)", async () => {
    // 분류기가 analyze라고 답해도, 자산 화면이면 scan이어야 한다
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"analyze","targetAssetId":null}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { routeIntent } = await import("../src/engine/intent");
    const r = await routeIntent("이거 정리해줘", "inventory.html");
    expect(r.action).toBe("scan");
  });

  it("분류기가 chat이라 답하면 화면 기본값으로 보정한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"chat","targetAssetId":null}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { routeIntent } = await import("../src/engine/intent");
    const r = await routeIntent("이거 정리해줘", "vulnscan.html");
    expect(r.action).toBe("analyze");
    expect(r.agentId).toBe("analysis");
  });
});
