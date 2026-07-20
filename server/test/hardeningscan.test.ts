// 보안장비 하드닝 점검(국내 CCE/KISA + CIS) — 판정 로직과 라우트를 검증.
// 실 셸에 의존하지 않도록 가짜 runner를 주입해 각 항목의 양호/취약 판정을 결정적으로 확인한다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { runHardeningScan, listChecklists, scanSummaryText, formatHardeningReport, type RunFn } from "../src/engine/hardeningscan";

// 명령 문자열을 정규식으로 매칭해 미리 정한 출력을 돌려주는 가짜 장비 CLI.
function mkRunner(map: Array<[RegExp, string]>): RunFn {
  return async (cmd: string) => {
    for (const [re, out] of map) if (re.test(cmd)) return { code: 0, out, err: "" };
    return { code: 0, out: "", err: "" };
  };
}

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("hardeningscan — 판정 로직", () => {
  it("KISA(국내 CCE): 취약한 장비의 항목별 판정이 정확하다", async () => {
    const weak = mkRunner([
      [/test -f \/etc\/ssh\/sshd_config/, "n"], // sshd 미설치 → U-01 NA
      [/pam_pwquality|pam_cracklib/, ""], // U-02 복잡성 미설정 → FAIL
      [/pam_faillock|pam_tally2/, ""], // U-03 잠금 미설정 → FAIL
      [/stat -c .* \/etc\/passwd/, "root 644"], // U-07 PASS
      [/stat -c .* \/etc\/shadow/, "root 640"], // U-08 PASS
      [/\$3==0/, "root "], // U-44 UID0=root뿐 → PASS
      [/PASS_MIN_LEN/, ""], [/pwquality\.conf/, ""], // U-46 → FAIL
      [/PASS_MAX_DAYS/, "99999"], // U-47 → FAIL
      [/PASS_MIN_DAYS/, "0"], // U-48 → FAIL
      [/UMASK/, "022"], // U-56 → PASS
      [/is-active rsyslog/, "active"], // U-72 → PASS
    ]);
    const r = await runHardeningScan({ standard: "kisa", run: weak });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by["U-01"].status).toBe("NA");
    expect(by["U-02"].status).toBe("FAIL");
    expect(by["U-03"].status).toBe("FAIL");
    expect(by["U-07"].status).toBe("PASS");
    expect(by["U-08"].status).toBe("PASS");
    expect(by["U-44"].status).toBe("PASS");
    expect(by["U-46"].status).toBe("FAIL");
    expect(by["U-47"].status).toBe("FAIL");
    expect(by["U-47"].evidence).toContain("99999");
    expect(by["U-48"].status).toBe("FAIL");
    expect(by["U-72"].status).toBe("PASS");
    // 채점대상 = 전체 - NA(U-01). 취약이 4건 이상이면 종합 판정은 미흡.
    expect(r.summary.na).toBe(1);
    expect(r.summary.fail).toBeGreaterThanOrEqual(4);
    expect(r.summary.verdict).toContain("미흡");
  });

  it("KISA(국내 CCE): root 외 UID 0 계정이 있으면 U-44 취약", async () => {
    const r = await runHardeningScan({
      standard: "kisa",
      run: mkRunner([[/\$3==0/, "root backdoor"], [/PASS_MAX_DAYS/, "90"], [/PASS_MIN_DAYS/, "1"]]),
    });
    const u44 = r.items.find((i) => i.id === "U-44")!;
    expect(u44.status).toBe("FAIL");
    expect(u44.evidence).toContain("backdoor");
  });

  it("CIS: 하드닝된 장비는 준수율 100%, 종합 양호", async () => {
    const hardened = mkRunner([
      [/PASS_MAX_DAYS/, "30"], // ACCT-01 PASS
      [/ufw status/, "Status: active"], // FW-01 PASS
      [/test -f \/etc\/ssh\/sshd_config/, "n"], // SSH-01 NA
      [/is-active rsyslog/, "active"], // LOG-01 PASS
      [/NTPSynchronized/, "yes"], // TIME-01 PASS
      [/ss -tlnH/, "22 443"], // SVC-01 PASS
      [/dpkg -l unattended-upgrades/, "installed"], // UPD-01 PASS
    ]);
    const r = await runHardeningScan({ standard: "cis", run: hardened });
    expect(r.summary.fail).toBe(0);
    expect(r.summary.na).toBe(1); // SSH-01
    expect(r.summary.rate).toBe(100);
    expect(r.summary.verdict).toContain("양호");
    // 리포트·요약 텍스트에 핵심 문구 포함
    expect(scanSummaryText(r)).toContain("준수율 100%");
    expect(formatHardeningReport(r)).toContain("보안장비 하드닝 점검 리포트");
  });

  it("CIS: 방화벽 미적용이면 FW-01 취약", async () => {
    const r = await runHardeningScan({
      standard: "cis",
      run: mkRunner([[/ufw status/, "NO_UFW"], [/nft list ruleset/, "0"], [/PASS_MAX_DAYS/, "30"]]),
    });
    expect(r.items.find((i) => i.id === "FW-01")!.status).toBe("FAIL");
  });

  it("체크리스트 메타: kisa 11항목·cis 7항목", () => {
    const lists = listChecklists();
    const kisa = lists.find((l) => l.id === "kisa")!;
    const cis = lists.find((l) => l.id === "cis")!;
    expect(kisa.count).toBe(11);
    expect(cis.count).toBe(7);
    expect(kisa.items[0].id).toBe("U-01");
  });
});

describe("hardeningscan — 라우트", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });

  it("GET /api/hardening/checklists — 인증 필요, 2개 기준 반환", async () => {
    expect((await request(app).get("/api/hardening/checklists")).status).toBe(401);
    const res = await request(app).get("/api/hardening/checklists").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.standards).toHaveLength(2);
  });

  it("POST /api/hardening/scan — 잘못된 standard는 400", async () => {
    const res = await request(app)
      .post("/api/hardening/scan")
      .set("Authorization", `Bearer ${token}`)
      .send({ standard: "hacker" });
    expect(res.status).toBe(400);
  });

  it("POST /api/hardening/scan — 인증 없이는 401", async () => {
    const res = await request(app).post("/api/hardening/scan").send({ standard: "kisa" });
    expect(res.status).toBe(401);
  });
});
