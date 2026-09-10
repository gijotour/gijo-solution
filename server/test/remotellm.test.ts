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

/** 그 파일이 원격 게터 모듈을 **실제로 무는가** — 주석에 이름만 적힌 것은 안 센다. */
function 원격게터를문다(src: string): boolean {
  return /(?:from|import\()\s*["'][^"']*remotellm/.test(src);
}

/** 주석을 뗀 **코드만** 남긴다 — 설명으로 적어 둔 `STATE_KEY="remote_llm"`을 결함으로 세면 안 된다. */
const 주석뗀것 = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * 그 파일이 원격 주소에 **스스로 손을 뻗는가**. 두 갈래를 본다 — 뻗으면 어떻게 뻗는지를 돌려준다.
 *   ① 게터 모듈을 문다(import).
 *   ② 게터를 건너뛰고 저장값(app_state STATE_KEY="remote_llm")을 **직접 읽는다**.
 * ⚠ **이것으로도 못 잡는 것**(2026-09-10 검토관 적발 — 첫 판은 ①만 보고 「전수」라 적었다):
 *   주소를 딴 이름으로 옮겨 적은 사본 · `src/engine/` **밖의** 도우미 · env로 주소를 따로 받는 곁가지.
 *   그래서 이름을 「engine 안, 두 갈래」로 적는다 — 그물 이름이 그물보다 넓으면 안 잡힌 것을 잡혔다고 믿는다.
 *   행동으로 재는 그물은 따로 있다: `searchrewrite.test.ts`가 실제 fetch URL을 잰다.
 */
function 원격주소에손을뻗는가(src: string): string {
  const 코드 = 주석뗀것(src);
  if (원격게터를문다(코드)) return "게터 import";
  if (/["']remote_llm["']/.test(코드)) return "저장값 직접 읽기";
  return "";
}

describe("★ 배선 — 게터가 실제로 채팅 경로에 물려 있다 (소스 감시)", () => {
  // 함수만 있고 안 부르면 「설계는 됐고 쓰인 적 없다」다 — 이 저장소의 반복 유형.
  it("llm.ts가 원격 게터를 ensureAgentModel **앞에서** 본다", () => {
    const src = fs.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
    // 2026-08-16: 게터가 remoteLlmTarget(baseUrl+headers)로 바뀌었다 — 토큰을 헤더로 보내려고.
    expect(src, "원격 게터를 안 부른다").toMatch(/remoteLlmTarget\(\)/);
    // 원격이 있으면 로컬 로드를 아예 안 거쳐야 한다 — ?? 로 가른 자리.
    // ★ 2026-09-10: 오른쪽이 `로컬주소()` 함수로 뽑혔다. **원격 폴백이 같은 방법으로 이 PC 주소를
    //   얻어야 하기 때문**이다(두 벌로 적으면 폴백만 modelOverride 규칙을 빼먹는다). 재는 것은
    //   그대로 「?? 로 갈라 원격이면 로컬 로드를 안 거친다」이므로 **두 조각으로** 못 박는다 —
    //   ① 가르는 자리 ② 그 함수가 정말 localengine 로더인가(빈 함수로 바꿔치기하면 빨강).
    expect(src, "원격이 로컬 로드를 우회하지 않는다").toMatch(/원격 \?\? \(await 로컬주소\(\)\)/);
    expect(src, "로컬주소()가 localengine 로더가 아니다 — ?? 오른쪽이 껍데기면 검사가 헛돈다")
      .toMatch(/const 로컬주소 = async \(\): Promise<string> => await import\("\.\/localengine\.js"\)/);
    // 토큰 헤더가 실제로 fetch에 붙는다(토큰 인증의 배선).
    expect(src, "원격 토큰 헤더가 fetch에 안 붙는다").toMatch(/\.\.\.원격헤더/);
  });
  // ★ 2026-09-10 뒤집혔다. 예전 이 자리엔 「searchrewrite.ts도 같은 게터를 본다」가 있었다 —
  //   그게 결함이었다. 재작성은 `chat()`을 안 거쳐 **팀원별 두뇌 위치를 못 보고** 전역만 따랐다:
  //   아무도 원격을 고르지 않은 경로까지 보이지 않는 왕복을 치르므로, 두 겹 관문(① 전역 ON
  //   ② 팀원 opt-in)의 뜻이 곁가지 하나 때문에 무너진다. 그래서 재작성은 언제나 로컬로 못 박았다.
  //   ⚠ 다만 그 파일이 「5.4초→57초」의 **범인**이라는 첫 설명은 틀렸다 — 상한이 1.5초다
  //     (`searchrewrite.ts` 머리말 ★, 짝 시험 「★ 상한」이 행동으로 잰다). 더 그럴듯한 원인은
  //     총괄이 전역만 켜도 원격으로 가던 자리였고 `llm.ts resolveRemoteTarget` ⓪에서 막았다
  //     (`agentlocation.test.ts`의 행동 시험이 그것을 지킨다).
  it("★ chat()을 안 거치고 원격 주소에 손을 뻗는 도우미가 없다 (engine 안, 두 갈래)", () => {
    // 파일 목록을 손으로 적지 않는다 — 새로 생기는 곁가지를 잡는 것이 이 검사의 전부다.
    // 원격을 쓰고 싶은 도우미는 llm.ts의 chat()을 거치게 한다(거기 관문이 있다).
    const 문것: string[] = [];
    const 훑기 = (d: URL, prefix = "") => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) 훑기(new URL(e.name + "/", d), prefix + e.name + "/");
        else if (e.name.endsWith(".ts") && e.name !== "remotellm.ts" && e.name !== "llm.ts") {
          const 어떻게 = 원격주소에손을뻗는가(fs.readFileSync(new URL(e.name, d), "utf8"));
          if (어떻게) 문것.push(`${prefix}${e.name}(${어떻게})`);
        }
      }
    };
    훑기(new URL("../src/engine/", import.meta.url));
    expect(
      문것.join(", "),
      "이 파일들이 원격 주소에 직접 손을 뻗는다 — 팀원 두뇌 위치를 못 본 채 전역만 따라간다",
    ).toBe("");
    // ⚠ 헛돎 방지 ①: 정작 llm.ts가 안 물고 있으면 이 검사는 아무것도 안 지킨다.
    const llm = fs.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
    expect(원격게터를문다(llm), "llm.ts가 원격 게터를 안 문다 — 이 검사의 근거가 바뀐 것이다").toBe(true);
    // ⚠ 헛돎 방지 ②(반증): 두 갈래가 **정말** 빨강을 내는지, 그리고 주석은 안 세는지 만들어 본다.
    expect(원격주소에손을뻗는가(`const t = await import("./remotellm.js").then((m) => m.remoteLlmTarget());`)).toBe("게터 import");
    expect(원격주소에손을뻗는가(`const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get("remote_llm");`)).toBe("저장값 직접 읽기");
    expect(
      원격주소에손을뻗는가(`// 주소·on/off는 전역 하나다(remotellm.ts STATE_KEY="remote_llm")`),
      "설명으로 적힌 것을 결함으로 셌다 — 이러면 못 고칠 빨강이 나 감시를 꺼 버리게 된다",
    ).toBe("");
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
