// 원격 GPU를 **내주는 쪽** — 경계가 실제로 막는가 (2026-08-14)
//
// ■ 무엇을 지키나
//   이 PC의 GPU를 VPN 안의 다른 GIJO에게 내주는 창구다. 잘못 열리면 **인증 없는 추론 서버**가
//   망에 서는 것이라, 경계 셋을 코드가 지키는지 못박는다:
//     ① 기본 꺼짐  ② VPN·사설 대역에서 온 요청만  ③ 에어갭이면 켜져 있어도 막힘
//   ⚠ X-Forwarded-For를 믿지 않는 것도 여기서 지킨다 — 헤더는 보내는 쪽이 지어낼 수 있어,
//     믿으면 공인 IP가 사설인 척할 수 있다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { db } from "../src/db";
import { llmServeConfig, llmServeOn, requesterAllowed } from "../src/engine/llmserve";

const put = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const del = db.prepare("DELETE FROM app_state WHERE key = ?");

beforeEach(() => { del.run("llm_serve"); delete process.env.GIJO_AIRGAP; });

/** 소켓 주소만 가진 최소 Request 흉내 — requesterAllowed가 보는 것이 그것뿐임을 함께 못박는다. */
function 요청(remoteAddress: string, headers: Record<string, string> = {}): Request {
  return { socket: { remoteAddress }, headers } as unknown as Request;
}

describe("기본은 꺼짐 — 켠 적 없으면 안 내준다", () => {
  it("설정이 없으면 꺼짐", () => {
    expect(llmServeConfig().enabled).toBe(false);
    expect(llmServeOn()).toBe(false);
  });
  it("켜면 켜짐", () => {
    put.run("llm_serve", JSON.stringify({ enabled: true, lastServedAt: null }));
    expect(llmServeOn()).toBe(true);
  });
  it("★ 저장 뒤 에어갭을 켜면 막힌다 — 저장 시에만 보면 이 틈이 샌다", () => {
    put.run("llm_serve", JSON.stringify({ enabled: true, lastServedAt: null }));
    process.env.GIJO_AIRGAP = "1";
    try { expect(llmServeOn()).toBe(false); } finally { delete process.env.GIJO_AIRGAP; }
  });
  it("깨진 저장값은 조용히 꺼짐으로 — 설정 하나가 서버를 죽이면 안 된다", () => {
    put.run("llm_serve", "{JSON 아님");
    expect(llmServeConfig().enabled).toBe(false);
  });
});

describe("누가 붙을 수 있나 — VPN·사설 대역만", () => {
  it("사설·CGNAT·루프백은 통과", () => {
    for (const h of ["10.8.0.11", "192.168.0.5", "172.20.1.9", "100.64.3.2", "127.0.0.1", "::1", "::ffff:10.8.0.11"]) {
      expect(requesterAllowed(요청(h)), h).toBe(true);
    }
  });
  it("★ 공인 IP는 거절", () => {
    for (const h of ["8.8.8.8", "203.0.113.7", "100.128.0.1", "::ffff:8.8.8.8"]) {
      expect(requesterAllowed(요청(h)), h).toBe(false);
    }
  });
  it("★ X-Forwarded-For로 사설인 척해도 안 통한다 — 헤더는 지어낼 수 있다", () => {
    expect(requesterAllowed(요청("8.8.8.8", { "x-forwarded-for": "10.8.0.11" }))).toBe(false);
    expect(requesterAllowed(요청("203.0.113.7", { "x-real-ip": "192.168.0.2" }))).toBe(false);
  });
  it("주소를 못 읽으면 거절한다(모르면 막는다 — airgap의 default-deny와 같은 자세)", () => {
    expect(requesterAllowed(요청(""))).toBe(false);
  });
});

describe("★ 배선 — 창구가 실제로 열려 있고, 열린 중계기가 아니다 (소스 감시)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/engine/llmserve.ts"), "utf8");
  const appSrc = fs.readFileSync(path.join(__dirname, "../src/app.ts"), "utf8");

  it("app.ts가 라우트를 등록한다 — 안 부르면 설계만 있고 쓰인 적 없는 것이 된다", () => {
    expect(appSrc).toMatch(/registerLlmServeRoutes\(app\)/);
  });
  it("붙는 쪽이 기대하는 두 경로가 있다(/models · /chat/completions)", () => {
    expect(src).toMatch(/\/api\/llm\/serve\/v1\/models/);
    expect(src).toMatch(/\/api\/llm\/serve\/v1\/chat\/completions/);
  });
  it("★ 두 경로 모두 같은 관문을 지난다 — 하나라도 빠지면 그게 구멍이다", () => {
    // 관문(req, res) 호출이 두 번(경로 수만큼) 나와야 한다.
    const 호출 = src.match(/if \(!관문\(req, res\)\) return;/g) ?? [];
    expect(호출.length, "관문을 안 거치는 경로가 있다").toBe(2);
  });
  it("★ 임의 URL로 넘기지 않는다 — 요청 본문의 주소를 프록시 대상으로 쓰면 열린 중계기가 된다", () => {
    // 프록시 대상은 localBaseUrl()이 준 것만이어야 한다.
    expect(src).toMatch(/const base = await localBaseUrl\(\)/);
    expect(src, "요청에서 받은 값을 fetch 대상으로 쓰고 있다").not.toMatch(/fetch\(\s*(?:`\$\{)?req\.(body|query|params)/);
  });
  it("VPN 판정은 airgap.ts 한 곳을 쓴다 — 새 판정기를 만들지 않는다", () => {
    expect(src).toMatch(/import \{[^}]*isVpnRangeIp[^}]*\} from "\.\/airgap"/);
  });
});
