// 🧠 **원격 두뇌가 죽었을 때** — 이 PC로 되돌리고, 그 사실을 숨기지 않는다 (2026-09-10)
//
// ■ 무엇이 있었나(코드로 확인한 사실): 원격이 안 닿으면 답이 **통째로 없었다.** chat()의 두 갈래가
//   「⚠ AI 모델이 아직 준비되지 않았습니다 … 설정에서 사내 GPU 서버 주소를 입력」이라는 안내를
//   돌려주는데, 원격을 **이미 넣어 둔** 사람에게 그건 틀린 처방이다. 이 PC에는 모델이 멀쩡히 떠
//   있는데도 아무 답이 안 나갔다 — 원격을 켜 두면 오히려 약해지는 기능이었다.
//
// ■ 무엇을 못 박나 (넷 다 하나라도 빠지면 「몰래 강등」이 된다)
//   ① 원격이 죽으면 **이 PC로 한 번 되돌려 답한다**
//   ② 답 끝에 **그 사실을 한 줄로 밝힌다**(사람이 읽는다)
//   ③ 실패를 **상태에 남긴다**(화면이 「지금 닿지 않습니다」를 말할 수 있게)
//   ④ 응답 표식이 **local·fallback**이라 말한다(하네스가 읽는다)
//
// ⚠ 이 시험은 **행동으로** 잰다 — 소스 문자열 대조는 「갈래가 있다」까지만 말하고
//   「원격이 죽었을 때 답이 나오는가」는 못 잰다(agentlocation.test가 같은 교훈으로 고쳐진 자리다).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "../src/db";
import { chat, resetChatHistoryForTests } from "../src/engine/llm";
import { remoteLlmConfig, 원격실패기록, 원격성공기록 } from "../src/engine/remotellm";
import { 새두뇌표식수거, 두뇌표식을수거하며, 두뇌표식실어보내기, 두뇌표식보고 } from "../src/engine/brainmark";
import { setAgentLocation } from "../src/engine/agents";

const 원격주소 = "http://10.8.0.12:8080/v1";
const 폴백안내 = "🧠 원격 두뇌가 닿지 않아 이 PC 두뇌로 답했습니다.";

const put = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const del = db.prepare("DELETE FROM app_state WHERE key = ?");

const 전역켜기 = (url = 원격주소 + "?token=시험토큰") =>
  put.run("remote_llm", JSON.stringify({ enabled: true, url, lastCheck: null, lastModel: null, lastFailAt: null, failReason: null }));

/** 원격 URL로 온 요청은 실패시키고, 그 밖(이 PC)은 답하게 하는 fetch 목. */
function 원격은죽고로컬은산다(옵션: { 로컬답?: string; 원격실패?: "연결" | "시간초과" | number } = {}) {
  const 목 = vi.fn(async (url: unknown, _init?: unknown) => {
    if (String(url).startsWith(원격주소)) {
      if (옵션.원격실패 === "시간초과") {
        const e = new Error("timed out");
        e.name = "TimeoutError";
        throw e;
      }
      if (typeof 옵션.원격실패 === "number") {
        return { ok: false, status: 옵션.원격실패, statusText: "Bad", text: async () => "원격 거절 본문" };
      }
      throw new Error("fetch failed"); // 연결 실패(WireGuard 끊김·gb10 꺼짐)
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: 옵션.로컬답 ?? "이 PC가 만든 답입니다." } }], model: "qwen3-14b" }) };
  });
  vi.stubGlobal("fetch", 목);
  return 목;
}

/** 표식 그릇을 놓고 chat을 돌린다 — /api/dispatch가 하는 것과 같은 무늬. */
async function 표식과함께(fn: () => Promise<string>) {
  const 그릇 = 새두뇌표식수거();
  const 답 = await 두뇌표식을수거하며(그릇, fn);
  return { 답, 표식: 그릇.값 };
}

beforeEach(() => {
  resetChatHistoryForTests();
  del.run("remote_llm");
  db.prepare("DELETE FROM app_state WHERE key LIKE 'agentLocation:%'").run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  del.run("remote_llm");
});

describe("★ 원격이 죽으면 이 PC로 되돌린다", () => {
  it("헛돎 방지 — 전역 원격이 정말 켜진 상태를 만든다", async () => {
    // 이 줄이 없으면 아래 「원격으로 갔다」들이 그저 전역이 꺼져 있어서일 수 있다(거짓 초록).
    전역켜기();
    const 목 = 원격은죽고로컬은산다();
    await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(String(목.mock.calls[0]?.[0]), "첫 요청이 원격으로 안 갔다 — 이 묶음이 통째로 헛돈다").toContain("10.8.0.12");
  });

  it("① 연결 실패 → 이 PC 두뇌가 답한다 (종전엔 답이 통째로 없었다)", async () => {
    전역켜기();
    const 목 = 원격은죽고로컬은산다({ 로컬답: "우선순위는 KEV 등재 여부부터 봅니다." });
    const { 답, 표식 } = await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));

    expect(답, "원격이 죽었는데 안내 문구만 돌아왔다 — 폴백이 안 돈다").toContain("KEV 등재 여부");
    expect(답, "⚠ 안내(모델 미준비)로 떨어졌다").not.toContain("AI 모델이 아직 준비되지 않았습니다");
    expect(목.mock.calls.length, "두 번 보내야 한다(원격 → 이 PC)").toBe(2);
    expect(String(목.mock.calls[1]?.[0]), "되돌린 요청이 이 PC로 안 갔다").not.toContain("10.8.0.12");
    // ② 표식
    expect(표식?.location).toBe("local");
    expect(표식?.fallback, "폴백인데 fallback이 false다 — 하네스가 강등을 못 본다").toBe(true);
  });

  it("② 답 끝에 그 사실을 한 줄로 밝힌다 — 몰래 강등하지 않는다", async () => {
    전역켜기();
    원격은죽고로컬은산다();
    const { 답 } = await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(답, "폴백을 사람에게 안 밝힌다").toContain(폴백안내);
    // ⚠ **끝**에 붙어야 한다 — 앞머리에 두면 배너 판정(startsWith)이 죽는다(llm.ts 그 자리 주석).
    expect(답.trimEnd().endsWith(폴백안내), "안내가 답 끝이 아니다 — 배너 판정을 가로챈다").toBe(true);
  });

  it("③ 실패를 상태에 남긴다 — 화면이 「지금 닿지 않습니다」를 말할 수 있게", async () => {
    전역켜기();
    원격은죽고로컬은산다();
    expect(remoteLlmConfig().lastFailAt, "이 시험의 전제는 「자국 없음」이다").toBeNull();
    await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    const c = remoteLlmConfig();
    expect(typeof c.lastFailAt, "실패가 기록되지 않는다 — 원격이 며칠 죽어도 화면은 초록이다").toBe("number");
    expect(c.failReason ?? "", "사유가 비어 있다").toContain("닿지 못했습니다");
    // ⚠ 실패가 원격을 **끄지는 않는다** — 잠깐 끊긴 VPN 한 번에 설정이 뒤집히면 안 된다.
    expect(c.enabled, "실패 한 번에 설정이 꺼졌다").toBe(true);
  });

  it("시간 초과도 같은 길로 간다 — 원격 전용 상한이 사유에 적힌다", async () => {
    전역켜기();
    원격은죽고로컬은산다({ 원격실패: "시간초과" });
    const { 답, 표식 } = await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(답).toContain(폴백안내);
    expect(표식?.fallback).toBe(true);
    expect(remoteLlmConfig().failReason ?? "", "시간 초과 사유가 안 남았다").toContain("초 안에 오지 않았습니다");
  });

  it("원격이 거절(HTTP 401·500)해도 되돌린다 — 「닿았지만 답 못 받음」도 같은 사실이다", async () => {
    전역켜기();
    원격은죽고로컬은산다({ 원격실패: 401 });
    const { 답, 표식 } = await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(답).toContain(폴백안내);
    expect(표식?.location).toBe("local");
    expect(remoteLlmConfig().failReason ?? "").toContain("401");
  });

  it("★ 되돌린 요청에 원격 접속 토큰을 안 싣는다 — 이 PC로 남의 자격증명이 새면 안 된다", async () => {
    전역켜기();
    const 목 = 원격은죽고로컬은산다();
    await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    const 첫헤더 = (목.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers ?? {};
    const 둘째헤더 = (목.mock.calls[1]?.[1] as { headers?: Record<string, string> })?.headers ?? {};
    expect(첫헤더["x-gijo-serve-token"], "원격에 토큰이 안 갔다 — 전제가 깨졌다").toBe("시험토큰");
    expect(둘째헤더["x-gijo-serve-token"], "되돌린 이 PC 요청에 원격 토큰이 그대로 실렸다").toBeUndefined();
  });

  it("폴백은 **한 번만** — 이 PC까지 죽으면 종전 안내 그대로다(문구는 측정 도구가 본다)", async () => {
    전역켜기();
    const 목 = vi.fn(async () => { throw new Error("fetch failed"); });
    vi.stubGlobal("fetch", 목);
    const { 답, 표식 } = await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(목.mock.calls.length, "두 번을 넘겼다 — 담당자가 기다리는 시간이 배로 는다").toBe(2);
    // ⚠ 이 문구는 regress FALLBACK_RE·drawer-audit이 보는 글자다 — 바꾸면 나쁜 답이 통과한다.
    expect(답).toContain("AI 모델이 아직 준비되지 않았습니다");
    expect(표식?.location, "실패한 답에도 표식은 남아야 한다").toBe("local");
    expect(표식?.fallback).toBe(true);
  });
});

describe("★ 두뇌 표식 — 누가 답했나", () => {
  it("원격이 정상이면 remote라 말한다 (안내는 안 붙는다)", async () => {
    전역켜기();
    const 목 = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "원격이 만든 답입니다." } }], model: "qwen3.8-flash-next" }) }));
    vi.stubGlobal("fetch", 목);
    const { 답, 표식 } = await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(표식?.location, "원격으로 갔는데 local이라 말한다").toBe("remote");
    expect(표식?.fallback).toBe(false);
    expect(표식?.model).toBe("qwen3.8-flash-next");
    expect(답, "정상 원격 답에 폴백 안내가 붙었다").not.toContain(폴백안내);
  });

  it("★ 총괄은 전역이 켜져 있어도 언제나 이 PC (llm.ts ⓪ — 표식으로도 잰다)", async () => {
    전역켜기();
    const 목 = 원격은죽고로컬은산다();
    const { 표식 } = await 표식과함께(() => chat({ agentId: "orchestrator", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(표식?.location, "총괄이 원격으로 갔다").toBe("local");
    expect(표식?.fallback, "총괄은 애초에 원격을 안 타므로 폴백일 수 없다").toBe(false);
    expect(목.mock.calls.length, "총괄인데 두 번 보냈다 — 원격을 한 번 시도했다는 뜻이다").toBe(1);
  });

  it("local로 둔 팀원도 전역이 켜져 있어도 이 PC", async () => {
    전역켜기();
    setAgentLocation("report", "local");
    원격은죽고로컬은산다();
    const { 표식 } = await 표식과함께(() => chat({ agentId: "report", message: "취약점 조치 우선순위를 알려줘", trusted: true }));
    expect(표식?.location).toBe("local");
    expect(표식?.fallback).toBe(false);
  });

  it("★ 결정 호출(도구 고르는 JSON)은 「답한 두뇌」가 아니다 — 담기지 않는다", async () => {
    // ⚠ 이게 없으면 표식이 **언제나 local**이 된다: 한 요청의 첫 chat()은 답이 아니라 총괄의
    //   분류기이고 총괄은 언제나 이 PC다(citesource가 겪은 함정의 대칭 — 그쪽 머리말 ★★★).
    전역켜기();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tool":"none"}' } }], model: "qwen3-14b" }) })));
    const { 표식 } = await 표식과함께(() =>
      chat({ agentId: "orchestrator", message: "자산 등록해줘", trusted: true, responseSchema: { type: "object" } as never })
    );
    expect(표식, "결정 호출이 표식을 가로챘다 — 답한 두뇌가 영영 안 담긴다").toBeUndefined();
  });

  it("답을 만든 chat이 여러 번이면 **첫 것**을 담고 횟수를 센다", () => {
    const 그릇 = 새두뇌표식수거();
    두뇌표식을수거하며(그릇, () => {
      두뇌표식보고({ location: "remote", fallback: false, model: "큰두뇌", 결정호출: false });
      두뇌표식보고({ location: "local", fallback: false, model: "작은두뇌", 결정호출: false });
    });
    expect(그릇.값?.location).toBe("remote");
    expect(그릇.값?.보고횟수, "여러 번 돈 사실을 안 센다 — 표식이 답 전체의 두뇌인 척한다").toBe(2);
  });

  it("★ 모델 이름은 qa에만 — 사람 응답에는 위치만 나간다", () => {
    const 값 = { location: "remote" as const, fallback: false, model: "qwen3.8-flash-next", 보고횟수: 1 };
    expect(두뇌표식실어보내기(값, false)).toEqual({ location: "remote", fallback: false });
    expect(두뇌표식실어보내기(값, true)).toEqual({ location: "remote", fallback: false, model: "qwen3.8-flash-next" });
    // 보고횟수는 안 싣는다 — 소비자 없는 값을 응답 계약에 넣지 않는다.
    expect(Object.keys(두뇌표식실어보내기(값, true))).not.toContain("보고횟수");
  });

  it("수거 중이 아니면 조용히 아무 일도 안 한다 — 그릇 없는 경로가 안 깨진다", () => {
    expect(() => 두뇌표식보고({ location: "local", fallback: false, model: null, 결정호출: false })).not.toThrow();
  });
});

describe("원격 실패 자국 — 남기고, 지우고, 주소가 바뀌면 무효", () => {
  it("성공하면 자국을 지운다 — 회복을 못 알아보면 그것도 거짓 표시다", () => {
    전역켜기();
    원격실패기록("원격 주소에 닿지 못했습니다(연결 실패)");
    expect(remoteLlmConfig().lastFailAt).toBeTypeOf("number");
    원격성공기록();
    expect(remoteLlmConfig().lastFailAt, "다시 답했는데 화면은 계속 「끊김」이다").toBeNull();
    expect(remoteLlmConfig().failReason).toBeNull();
  });

  it("주소를 바꾸면 옛 주소의 실패는 무효다 — 새 주소가 멀쩡한데 「끊김」이면 안 된다", () => {
    전역켜기();
    원격실패기록("원격 주소에 닿지 못했습니다(연결 실패)");
    전역켜기("http://10.8.0.99:8080/v1"); // 다른 주소로 갈아 끼운다
    expect(remoteLlmConfig().lastFailAt, "옛 주소의 실패가 새 주소에 그대로 붙었다").toBeNull();
  });

  it("주소가 없으면 적을 대상이 없다 — 빈 상태에 자국을 만들지 않는다", () => {
    del.run("remote_llm");
    원격실패기록("아무 사유");
    expect(remoteLlmConfig().lastFailAt).toBeNull();
  });
});
