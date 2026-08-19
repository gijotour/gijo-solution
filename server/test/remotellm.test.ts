// 원격 LLM(BridgeAI 1단계) — **VPN 전용 경계가 실제로 막는가** (2026-08-13 · 사장님 결정)
//
// ■ 무엇을 지키나
//   「설정에서 원격 GPU 주소를 넣으면 채팅이 그리로 간다」 — 단, **VPN 안의 주소만**.
//   공인 IP·공개 도메인·호스트명은 거부하고, 에어갭이면 기능 자체를 막는다.
//   경계가 문구로만 있으면 광고와 같다 — 코드가 막는 것을 여기서 못박는다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { db } from "../src/db";
import { remoteLlmConfig, remoteLlmBaseUrl, remoteUrlProblem } from "../src/engine/remotellm";
import { isVpnRangeIp } from "../src/engine/airgap";

const put = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const del = db.prepare("DELETE FROM app_state WHERE key = ?");

beforeEach(() => { del.run("remote_llm"); delete process.env.GIJO_AIRGAP; });

describe("isVpnRangeIp — VPN 대역 판정 (airgap.ts 한 곳)", () => {
  it("사설·CGNAT 대역은 통과한다", () => {
    for (const h of ["10.8.0.12", "172.16.0.1", "192.168.219.66", "100.64.0.1", "100.127.255.254", "127.0.0.1"]) {
      expect(isVpnRangeIp(h), h).toBe(true);
    }
  });
  it("★ 공인 IP·공개 도메인·호스트명은 거부한다 — 이름은 어디로든 풀릴 수 있다", () => {
    for (const h of ["8.8.8.8", "100.63.255.255", "100.128.0.0", "api.openai.com", "gpu.internal", "203.0.113.7"]) {
      expect(isVpnRangeIp(h), h).toBe(false);
    }
  });
});

describe("remoteUrlProblem — 저장 관문", () => {
  it("VPN 안 /v1 주소는 통과", () => {
    expect(remoteUrlProblem("http://10.8.0.12:8080/v1")).toBeNull();
    expect(remoteUrlProblem("https://100.64.10.2:8443/v1")).toBeNull();
  });
  it("★ 공인·이름·형식 오류는 사람이 읽을 사유로 거부", () => {
    expect(remoteUrlProblem("http://api.openai.com/v1")).toContain("사설 대역 주소만");
    expect(remoteUrlProblem("http://8.8.8.8/v1")).toContain("사설 대역 주소만");
    expect(remoteUrlProblem("ftp://10.8.0.12/v1")).toContain("http(s)");
    expect(remoteUrlProblem("이건 주소가 아님")).toContain("형식");
  });
});

describe("remoteLlmBaseUrl — 채팅이 실제로 볼 게터", () => {
  it("꺼져 있으면 null(로컬 경로 그대로)", () => {
    expect(remoteLlmBaseUrl()).toBeNull();
  });
  it("켜져 있으면 그 주소", () => {
    put.run("remote_llm", JSON.stringify({ enabled: true, url: "http://10.8.0.12:8080/v1", lastCheck: null }));
    expect(remoteLlmBaseUrl()).toBe("http://10.8.0.12:8080/v1");
  });
  it("★ 저장 뒤 에어갭을 켜도 막힌다 — 저장 시에만 검사하면 이 틈이 샌다", () => {
    put.run("remote_llm", JSON.stringify({ enabled: true, url: "http://10.8.0.12:8080/v1", lastCheck: null }));
    process.env.GIJO_AIRGAP = "1";
    try {
      expect(remoteLlmBaseUrl()).toBeNull();
    } finally {
      delete process.env.GIJO_AIRGAP;
    }
  });
  // ★★ 사용 시점 재검증(2026-08-19 검토 지적) — 저장 관문을 안 거치고 들어온 값
  //    (DB 복원·다른 설치본 이식·규칙이 조여진 뒤의 옛 값)이 실제 전송으로 새면 안 된다.
  it("★★ DB에 심은 공인 IP 주소는 enabled여도 게터가 null을 준다", () => {
    put.run("remote_llm", JSON.stringify({ enabled: true, url: "http://8.8.8.8:8080/v1", lastCheck: null }));
    expect(remoteLlmBaseUrl()).toBeNull();
  });
  it("★★ 호스트명 주소도 마찬가지 — 이름은 어디로든 풀릴 수 있다", () => {
    put.run("remote_llm", JSON.stringify({ enabled: true, url: "http://gpu.example.com/v1", lastCheck: null }));
    expect(remoteLlmBaseUrl()).toBeNull();
  });
  it("★ 차단은 작업 기록에 남는다 — 조용히 로컬로 떨어지기만 하면 아무도 모른다", async () => {
    const { listAudit } = await import("../src/engine/audit");
    // 매번 다른 주소로 — 게터가 주소당 첫 1회만 기록하므로(도배 방지) 이 시험은 새 주소를 쓴다.
    const 주소 = `http://8.8.4.${Math.floor(Math.random() * 250) + 1}:9/v1`;
    put.run("remote_llm", JSON.stringify({ enabled: true, url: 주소, lastCheck: null }));
    expect(remoteLlmBaseUrl()).toBeNull();
    const 기록 = listAudit({ limit: 20 }).filter((a) => a.action.includes("원격 GPU 주소가 규칙에 안 맞아 차단"));
    expect(기록.length, "차단이 감사에 안 남았다").toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(기록[0]), "감사에 토큰 쿼리가 실리면 안 된다").not.toContain("token=");
  });
  it("정상 사설 대역은 그대로 통과 — 재검증이 정상 사용을 깨면 안 된다", () => {
    put.run("remote_llm", JSON.stringify({ enabled: true, url: "http://100.64.10.2:8080/v1", lastCheck: null }));
    expect(remoteLlmBaseUrl()).toBe("http://100.64.10.2:8080/v1");
  });

  it("깨진 저장값은 조용히 꺼짐으로 — 설정 하나가 채팅 전체를 죽이면 안 된다", () => {
    put.run("remote_llm", "{이건 JSON이 아님");
    expect(remoteLlmConfig().enabled).toBe(false);
    expect(remoteLlmBaseUrl()).toBeNull();
  });
});

describe("★ 배선 — 게터가 실제로 채팅·재작성 경로에 물려 있다 (소스 감시)", () => {
  // 함수만 있고 안 부르면 「설계는 됐고 쓰인 적 없다」다 — 이 저장소의 반복 유형.
  it("llm.ts가 원격 게터를 ensureAgentModel **앞에서** 본다", () => {
    const src = fs.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
    // 2026-08-16: 게터가 remoteLlmTarget(baseUrl+headers)로 바뀌었다 — 토큰을 헤더로 보내려고.
    expect(src, "원격 게터를 안 부른다").toMatch(/remoteLlmTarget\(\)/);
    // 원격이 있으면 로컬 로드를 아예 안 거쳐야 한다 — ?? 로 가른 자리.
    expect(src, "원격이 로컬 로드를 우회하지 않는다").toMatch(/원격 \?\? \(await import\("\.\/localengine\.js"\)/);
    // 토큰 헤더가 실제로 fetch에 붙는다(토큰 인증의 배선).
    expect(src, "원격 토큰 헤더가 fetch에 안 붙는다").toMatch(/\.\.\.원격헤더/);
  });
  it("searchrewrite.ts도 같은 게터를 본다 — 채팅만 원격이면 재작성이 로컬을 찾다 죽는다", () => {
    const src = fs.readFileSync(new URL("../src/engine/searchrewrite.ts", import.meta.url), "utf8");
    expect(src).toMatch(/remoteLlmTarget/);
    expect(src, "통로가 아직 상수다").toMatch(/async function 통로\(\)/);
  });
  it("라우트 3개가 등록돼 있다(app.ts)", () => {
    const src = fs.readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    expect(src).toContain("registerRemoteLlmRoutes(app)");
    const rl = fs.readFileSync(new URL("../src/engine/remotellm.ts", import.meta.url), "utf8");
    expect(rl).toContain('"/api/llm/remote"');
    expect(rl).toContain('"/api/llm/remote/test"');
    // admin 전용 — 채팅이 어디로 가는지를 바꾸는 설정이다.
    expect((rl.match(/adminMiddleware/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
