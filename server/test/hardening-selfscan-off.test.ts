// 「이 서버 자신」 하드닝 점검 격리 — 2026-09-10 고객 QA 예행 ㉔ / 계획서 전-7
//
// 진입로 셋 중 self로 도는 둘(대화 도구·검증 화면 버튼)이 GIJO_NO_SELF_SCAN=1일 때
// 우리 호스트 자신을 점검하지 않는지, 준수율·항목 코드 같은 점검 결과 글자가 하나도
// 안 섞이는지를 못 박는다. 반대 방향(기본값=env 없음)도 함께 확인해 라이트 전제
// (자기 PC 점검이 제품 자체다)를 깨지 않았음을 남긴다.
// hardeningtargets.ts(runScanForTarget·runDueSchedules)는 손대지 않았다 — 이미 try/catch로
// lastResult='fail'을 정직하게 남긴다(이 파일이 시험하지 않는 이유).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { runHardeningScan, 자기점검꺼짐, 자기점검차단안내, type RunFn } from "../src/engine/hardeningscan";
import { runHardeningScanTool } from "../src/engine/agenttools/handlers";

function mkRunner(map: Array<[RegExp, string]> = []): RunFn {
  return async (cmd: string) => {
    for (const [re, out] of map) if (re.test(cmd)) return { code: 0, out, err: "" };
    return { code: 0, out: "", err: "" };
  };
}

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

const ENV = "GIJO_NO_SELF_SCAN";
const 원래값 = process.env[ENV];
afterEach(() => {
  if (원래값 === undefined) delete process.env[ENV];
  else process.env[ENV] = 원래값;
});

describe("자기점검꺼짐() — env 판정 한 곳", () => {
  it("GIJO_NO_SELF_SCAN=1일 때만 참", () => {
    delete process.env[ENV];
    expect(자기점검꺼짐()).toBe(false);
    process.env[ENV] = "1";
    expect(자기점검꺼짐()).toBe(true);
    process.env[ENV] = "true"; // "1" 아닌 값은 거짓 — 느슨하게 켜지면 라이트가 조용히 깨진다
    expect(자기점검꺼짐()).toBe(false);
  });
});

describe("켜짐 — self는 막히고 remote는 그대로 돈다", () => {
  beforeEach(() => { process.env[ENV] = "1"; });

  it("runHardeningScan({ranOn 생략=self}) — 던진다", async () => {
    await expect(runHardeningScan({ standard: "kisa", run: mkRunner() })).rejects.toThrow(자기점검차단안내);
  });
  it("runHardeningScan({ranOn:'self'}) — 던진다", async () => {
    await expect(runHardeningScan({ standard: "kisa", run: mkRunner(), ranOn: "self" })).rejects.toThrow(자기점검차단안내);
  });
  it("runHardeningScan({ranOn:'remote'}) — 등록 대상 점검은 막지 않는다", async () => {
    const r = await runHardeningScan({ standard: "kisa", run: mkRunner(), ranOn: "remote", target: "fw-01" });
    expect(r.ranOn).toBe("remote");
  });

  it("runHardeningScanTool — 안내 문구를 돌려주고 점검 결과 글자가 하나도 안 섞인다", async () => {
    const out = await runHardeningScanTool({ standard: "kisa" });
    expect(out).toBe(자기점검차단안내);
    // ⚠ "이 서버 자신"은 여기 안 넣는다 — 안내 문구 자체가 "이 서버 자신 점검을 하지
    //   않습니다"라고 정직하게 말하므로 이 낱말은 있는 게 맞다. 여기서 재는 것은
    //   **점검을 실제로 돌렸을 때만 나오는** 결과 글자다(준수율·항목 코드·판정어).
    for (const 새면안될것 of ["준수율", "U-0", "양호", "취약"]) {
      expect(out.includes(새면안될것), `안내에 점검 결과 글자가 섞였다: ${새면안될것}`).toBe(false);
    }
  });

  it("POST /api/hardening/scan — 409 + 같은 안내, 점검을 실행하지 않는다", async () => {
    const app = createApp();
    const token = await login(app);
    const res = await request(app)
      .post("/api/hardening/scan")
      .set("Authorization", `Bearer ${token}`)
      .send({ standard: "kisa" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(자기점검차단안내);
  });
});

describe("기본(env 없음) — 종전대로 self 점검이 돈다(라이트 전제 보호, 반대 방향 못 박기)", () => {
  beforeEach(() => { delete process.env[ENV]; });

  it("runHardeningScan — 던지지 않고 리포트를 낸다", async () => {
    const r = await runHardeningScan({ standard: "kisa", run: mkRunner() });
    expect(r.ranOn).toBe("self");
    expect(r.summary).toBeTruthy();
  });

  it("runHardeningScanTool — 안내 문구가 아니라 실제 점검 요약을 낸다", async () => {
    const out = await runHardeningScanTool({ standard: "kisa" });
    expect(out).not.toBe(자기점검차단안내);
    expect(out).toContain("점검한 곳");
  });

  it("POST /api/hardening/scan — 409가 아니다(잘못된 standard 400 케이스와 구분)", async () => {
    const app = createApp();
    const token = await login(app);
    const res = await request(app)
      .post("/api/hardening/scan")
      .set("Authorization", `Bearer ${token}`)
      .send({ standard: "kisa" });
    expect(res.status).not.toBe(409);
  });
});
