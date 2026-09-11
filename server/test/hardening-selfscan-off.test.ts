// 「이 서버 자신」 하드닝 점검 격리 — 2026-09-10 고객 QA 예행 ㉔ / 계획서 전-7
//
// 진입로 셋 중 self로 도는 둘(대화 도구·검증 화면 버튼)이 GIJO_NO_SELF_SCAN=1일 때
// 우리 호스트 자신을 점검하지 않는지, 준수율·항목 코드 같은 점검 결과 글자가 하나도
// 안 섞이는지를 못 박는다. 반대 방향(기본값=env 없음)도 함께 확인해 라이트 전제
// (자기 PC 점검이 제품 자체다)를 깨지 않았음을 남긴다.
// ★★ 2026-09-11 검토관 수리 — hardeningtargets.ts도 고쳤다(앞 판은 「손대지 않았다 — 이미
//   try/catch로 lastResult='fail'을 정직하게 남긴다」고 적었는데, **그 'fail'이 거짓이었다**).
//   차단 안내가 사람을 「+ 대상 등록」으로 보내는데 거기엔 「로컬(서버 자신)」 선택지가 있어,
//   그 대상을 만들면 ① 수동 점검이 500 ② 정기점검이 매 주기 「✕ 점검 실패」를 쌓았다 —
//   관리자가 끈 것을 제품이 고장 난 것으로 보이게 하는 거짓이다. 세 곳을 한 판정
//   (자기점검막힌대상인가)으로 묶어 등록 자체를 막고, 수동은 409, 스케줄은 건너뛴다.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

// ⚠⚠ **기본 갈래(env 없음)는 진짜 점검 명령을 시험 기계에서 돌리고 있었다** — 2026-09-11 검토관 적발.
//   runHardeningScanTool·POST /api/hardening/scan은 러너를 못 받는 창구라, 막히지 않으면
//   defaultRunnerFor → hostRunner → execFile("bash", ["-lc", …])로 기준 하나에 14개 명령을
//   **실제로 띄운다**(이 파일만 두 번 = 수십 회). 느려지고 기계에 따라 결과가 갈린다.
//   → 이 파일에서만 execFile을 빈 출력으로 갈아 끼운다. 제품 경로(창구→엔진→러너)는 그대로
//     다 지나가므로 **도달 잣대를 낮추지 않는다** — 밖으로 나가는 명령만 없앤다.
vi.mock("node:child_process", async (importOriginal) => {
  const 원본 = await importOriginal<typeof import("node:child_process")>();
  const 가짜 = (...인자: unknown[]) => {
    const 콜백 = 인자.find((a) => typeof a === "function") as ((e: unknown, o: string, r: string) => void) | undefined;
    콜백?.(null, "", "");
    return undefined;
  };
  return { ...원본, execFile: 가짜 as unknown as typeof 원본.execFile };
});

vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { runHardeningScan, 자기점검꺼짐, 자기점검차단안내, 로컬대상차단안내, type RunFn } from "../src/engine/hardeningscan";
import { runHardeningScanTool } from "../src/engine/agenttools/handlers";
import {
  createTarget, createSchedule, listSchedules, runDueSchedules, resetHardeningForTests,
} from "../src/engine/hardeningtargets";

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

  // ★★ 2026-09-11 검토관 — 차단 안내가 가리킨 「+ 대상 등록」이 **막다른 길**이면 안 된다.
  it("POST /api/hardening/targets — 로컬(서버 자신) 등록을 409로 막는다", async () => {
    const app = createApp();
    const token = await login(app);
    const res = await request(app)
      .post("/api/hardening/targets")
      .set("Authorization", `Bearer ${token}`)
      .send({ label: "이서버", host: "local", port: 22, authMethod: "local", standard: "kisa" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(로컬대상차단안내);
  });

  it("이미 있는 로컬 대상 — 수동 점검이 500이 아니라 409 + 안내다", async () => {
    resetHardeningForTests();
    // env를 끈 채로 만든다(등록 창구가 막기 전에 들어와 있던 대상을 흉내 낸다).
    delete process.env[ENV];
    const t = createTarget({ label: "옛로컬", host: "local", port: 22, authMethod: "local", standard: "kisa" });
    process.env[ENV] = "1";
    const app = createApp();
    const token = await login(app);
    const res = await request(app)
      .post(`/api/hardening/targets/${t.id}/scan`)
      .set("Authorization", `Bearer ${token}`)
      .send({ standard: "kisa" });
    expect(res.status, "throw가 그대로 새면 500이 된다 — 담당자는 원인을 알 길이 없다").toBe(409);
    expect(res.body.error).toBe(자기점검차단안내);
  });

  it("★★ 정기점검이 거짓 「점검 실패」를 쌓지 않는다 — 건너뛴다", async () => {
    resetHardeningForTests();
    delete process.env[ENV];
    const t = createTarget({ label: "옛로컬", host: "local", port: 22, authMethod: "local", standard: "kisa" });
    createSchedule(t.id, "kisa", 24);
    process.env[ENV] = "1";
    const 돈것 = await runDueSchedules(Date.now());
    expect(돈것, "막힌 대상은 돌지 않는다").toBe(0);
    const sch = listSchedules().find((s) => s.targetId === t.id)!;
    expect(sch.lastResult, "관리자가 끈 것을 「제품 고장」으로 적으면 거짓이다").not.toBe("fail");
    expect(sch.nextRunAt, "하드루프를 막으려면 다음 주기로 미뤄야 한다").toBeGreaterThan(Date.now());
  });

  it("★ 원격 대상 스케줄은 그대로 돈다 — 격리가 원격까지 죽이지 않는다", async () => {
    resetHardeningForTests();
    const t = createTarget({ label: "원격-fw", host: "10.9.9.9", port: 22, username: "a", authMethod: "key", secret: "/k", standard: "kisa" });
    createSchedule(t.id, "kisa", 24);
    const 돈것 = await runDueSchedules(Date.now(), () => mkRunner());
    expect(돈것).toBe(1);
    expect(listSchedules().find((s) => s.targetId === t.id)!.lastResult).toBe("success");
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
