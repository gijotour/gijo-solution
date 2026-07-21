// 원격 SSH 정기점검 — 대상 레지스트리·SSH 러너 인자·스케줄러·이력·악화 알림을 검증.
// 실 셸/원격에 의존하지 않도록 결정적 러너를 주입한다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { targetRunner, sshCommandFor, type HardeningTarget, type RunFn } from "../src/engine/hardeningscan";
import {
  createTarget, createSchedule, runDueSchedules, listRuns, listSchedules, resetHardeningForTests,
} from "../src/engine/hardeningtargets";
import { listAudit } from "../src/engine/audit";

// 취약/양호를 골라 내는 결정적 러너. fail 개수를 조절해 악화 알림을 검증한다.
function fakeRunner(passMode: "weak" | "strong"): RunFn {
  return async (cmd: string) => {
    const map: Array<[RegExp, string]> = [
      [/test -f \/etc\/ssh\/sshd_config/, "n"],
      [/\$3==0/, "root "],
      [/UMASK/, "022"],
      [/is-active rsyslog/, "active"],
      [/stat -c .* \/etc\/passwd/, "root 644"],
      [/stat -c .* \/etc\/shadow/, "root 640"],
      [/PASS_MAX_DAYS/, passMode === "weak" ? "99999" : "90"],
      [/PASS_MIN_DAYS/, passMode === "weak" ? "0" : "1"],
      [/pam_pwquality|pam_cracklib/, passMode === "weak" ? "" : "password requisite pam_pwquality.so minlen=10"],
      [/pam_faillock|pam_tally2/, passMode === "weak" ? "" : "auth required pam_faillock.so deny=5"],
      [/PASS_MIN_LEN/, passMode === "weak" ? "" : "10"],
    ];
    for (const [re, out] of map) if (re.test(cmd)) return { code: 0, out, err: "" };
    return { code: 0, out: "", err: "" };
  };
}

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("hardeningtargets — SSH 러너 인자", () => {
  it("local 대상은 SSH를 쓰지 않는다(호스트 직접)", () => {
    const t: HardeningTarget = { id: "x", label: "self", host: "local", port: 22, authMethod: "local" };
    expect(sshCommandFor(t, "echo hi")).toBeNull();
    expect(typeof targetRunner(t)).toBe("function");
  });
  it("key 인증은 ssh -i 키경로로 원격 실행하도록 구성된다", () => {
    const t: HardeningTarget = { id: "x", label: "fw", host: "10.0.0.5", port: 2222, username: "admin", authMethod: "key", secret: "/keys/id_ed25519" };
    const { file, args } = sshCommandFor(t, "echo hi")!;
    expect(file).toBe("ssh");
    expect(args).toContain("-i");
    expect(args).toContain("/keys/id_ed25519");
    expect(args).toContain("admin@10.0.0.5");
    expect(args).toContain("-p"); expect(args).toContain("2222");
    expect(args[args.length - 1]).toBe("echo hi");
  });
  it("password 인증은 sshpass로 감싸고 명령을 마지막 인자로 둔다", () => {
    const t: HardeningTarget = { id: "y", label: "fw2", host: "h", port: 22, username: "u", authMethod: "password", secret: "pw" };
    const { file, args } = sshCommandFor(t, "id")!;
    expect(file).toBe("sshpass");
    expect(args.slice(0, 3)).toEqual(["-p", "pw", "ssh"]);
    expect(args[args.length - 1]).toBe("id");
  });
});

describe("hardeningtargets — 스케줄러·이력·알림", () => {
  beforeEach(() => resetHardeningForTests());

  it("만기 스케줄을 실행하고 이력을 남기며 다음 주기로 미룬다", async () => {
    const t = createTarget({ label: "원격 방화벽", host: "10.0.0.9", port: 22, username: "admin", authMethod: "key", secret: "/k" });
    const sch = createSchedule(t.id, "kisa", 24); // nextRunAt=now → 즉시 만기
    const ran = await runDueSchedules(Date.now(), () => fakeRunner("weak"));
    expect(ran).toBe(1);
    const runs = listRuns(t.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe("scheduled");
    expect(runs[0].fail).toBeGreaterThanOrEqual(4); // weak → 다수 취약
    // 다음 실행 시각이 미래로 밀렸다(하드 루프 방지).
    const after = listSchedules().find((s) => s.id === sch.id)!;
    expect(after.nextRunAt).toBeGreaterThan(Date.now());
    expect(after.lastFail).toBe(runs[0].fail);
  });

  it("직전보다 취약이 늘면 '악화 감지' 감사가 남는다", async () => {
    const t = createTarget({ label: "웹서버", host: "10.0.0.10", port: 22, authMethod: "local" });
    createSchedule(t.id, "kisa", 1);
    // 1회차: 양호(strong) → 취약 적음
    await runDueSchedules(Date.now(), () => fakeRunner("strong"));
    // 2회차: 취약(weak)으로 악화 — nextRunAt를 과거로 되돌려 다시 만기시킨다
    const { db } = await import("../src/db");
    db.prepare("UPDATE hardening_schedules SET nextRunAt = 0 WHERE targetId = ?").run(t.id);
    await runDueSchedules(Date.now(), () => fakeRunner("weak"));
    const alerts = listAudit({ limit: 100 }).filter((a) => a.action.includes("악화"));
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0].result).toBe("error");
  });

  it("비활성 스케줄은 실행하지 않는다", async () => {
    const t = createTarget({ label: "off", host: "local", port: 22, authMethod: "local" });
    const sch = createSchedule(t.id, "cis", 12);
    const { db } = await import("../src/db");
    db.prepare("UPDATE hardening_schedules SET enabled = 0 WHERE id = ?").run(sch.id);
    const ran = await runDueSchedules(Date.now(), () => fakeRunner("strong"));
    expect(ran).toBe(0);
    expect(listRuns(t.id)).toHaveLength(0);
  });
});

describe("hardeningtargets — 라우트", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    resetHardeningForTests();
    app = createApp();
    token = await login(app);
  });

  it("대상 등록 시 secret은 응답에 노출되지 않는다(hasSecret만)", async () => {
    const res = await request(app).post("/api/hardening/targets").set("Authorization", `Bearer ${token}`)
      .send({ label: "방화벽A", host: "10.0.0.5", port: 22, username: "admin", authMethod: "password", secret: "s3cr3t" });
    expect(res.status).toBe(200);
    expect(res.body.target.hasSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("s3cr3t");
  });

  it("잘못된 authMethod는 400", async () => {
    const res = await request(app).post("/api/hardening/targets").set("Authorization", `Bearer ${token}`)
      .send({ label: "x", host: "h", authMethod: "telnet" });
    expect(res.status).toBe(400);
  });

  it("대상 등록 시 점검 기준(장비 유형)을 저장하고 응답에 노출한다", async () => {
    const res = await request(app).post("/api/hardening/targets").set("Authorization", `Bearer ${token}`)
      .send({ label: "코어 스위치", host: "10.0.0.9", authMethod: "key", secret: "/keys/id", standard: "kisa_net" });
    expect(res.status).toBe(200);
    expect(res.body.target.standard).toBe("kisa_net");
    // 목록 재조회에도 유지
    const list = await request(app).get("/api/hardening/targets").set("Authorization", `Bearer ${token}`);
    expect(list.body.targets.find((t: { id: string }) => t.id === res.body.target.id).standard).toBe("kisa_net");
  });

  it("기준 미지정 등록은 kisa(리눅스)로 기본 저장된다", async () => {
    const res = await request(app).post("/api/hardening/targets").set("Authorization", `Bearer ${token}`)
      .send({ label: "리눅스 서버", host: "10.0.0.10", authMethod: "key", secret: "/keys/id" });
    expect(res.body.target.standard).toBe("kisa");
  });

  it("잘못된 standard 값은 400", async () => {
    const res = await request(app).post("/api/hardening/targets").set("Authorization", `Bearer ${token}`)
      .send({ label: "x", host: "h", authMethod: "key", standard: "windows11" });
    expect(res.status).toBe(400);
  });

  it("스케줄 등록에는 유효한 targetId가 필요하다", async () => {
    const bad = await request(app).post("/api/hardening/schedules").set("Authorization", `Bearer ${token}`)
      .send({ targetId: "nope", standard: "kisa", intervalHours: 24 });
    expect(bad.status).toBe(400);
    const t = await request(app).post("/api/hardening/targets").set("Authorization", `Bearer ${token}`)
      .send({ label: "srv", host: "local", authMethod: "local" });
    const ok = await request(app).post("/api/hardening/schedules").set("Authorization", `Bearer ${token}`)
      .send({ targetId: t.body.target.id, standard: "kisa", intervalHours: 6 });
    expect(ok.status).toBe(200);
    expect(ok.body.schedule.intervalHours).toBe(6);
  });

  it("인증 없이는 대상 목록을 볼 수 없다", async () => {
    expect((await request(app).get("/api/hardening/targets")).status).toBe(401);
  });
});
