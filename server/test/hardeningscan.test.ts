// 보안장비 하드닝 점검(국내 CCE/KISA + CIS) — 판정 로직과 라우트를 검증.
// 실 셸에 의존하지 않도록 가짜 runner를 주입해 각 항목의 양호/취약 판정을 결정적으로 확인한다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
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

  it("체크리스트 메타: kisa 15·cis 7·kisa_pc 8·kisa_net 6 항목", () => {
    const lists = listChecklists();
    const by = Object.fromEntries(lists.map((l) => [l.id, l]));
    expect(by["kisa"].count).toBe(15);
    expect(by["cis"].count).toBe(7);
    expect(by["kisa_pc"].count).toBe(8);
    expect(by["kisa_net"].count).toBe(6);
    expect(by["kisa"].items[0].id).toBe("U-01");
  });
});

// ── 1단계 신규 리눅스 항목(U-19·U-21·U-54·U-61 — 제어 C-계열 대응) ─────────
describe("hardeningscan — KISA 신규 항목(C-계열 대응)", () => {
  it("취약: r계열·FTP 포트 리스닝 + TMOUT 미설정이면 FAIL", async () => {
    const weak = mkRunner([
      [/:79\$/, ""], // U-19 finger 없음 → PASS
      [/\(512\|513\|514\)/, "0.0.0.0:513 "], // U-21 rlogin 리스닝 → FAIL
      [/TMOUT=/, ""], // U-54 미설정 → FAIL
      [/\(21\|23\)/, "0.0.0.0:21 0.0.0.0:23 "], // U-61 ftp+telnet → FAIL
    ]);
    const r = await runHardeningScan({ standard: "kisa", run: weak });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by["U-19"].status).toBe("PASS");
    expect(by["U-21"].status).toBe("FAIL");
    expect(by["U-21"].evidence).toContain("513");
    expect(by["U-54"].status).toBe("FAIL");
    expect(by["U-61"].status).toBe("FAIL");
    expect(by["U-61"].evidence).toContain("21");
  });

  it("양호: TMOUT=600 이하이면 U-54 PASS, 초과·0이면 FAIL", async () => {
    const at = async (v: string) => {
      const r = await runHardeningScan({ standard: "kisa", run: mkRunner([[/TMOUT=/, `export TMOUT=${v}`]]) });
      return r.items.find((i) => i.id === "U-54")!.status;
    };
    expect(await at("600")).toBe("PASS");
    expect(await at("300")).toBe("PASS");
    expect(await at("7200")).toBe("FAIL");
    expect(await at("0")).toBe("FAIL"); // 0=비활성
  });
});

// ── 2단계 Windows PC 표준(kisa_pc) — net accounts 한/영 파싱 포함 ──────────
const NET_ACCOUNTS_KO = [
  "암호 변경 금지 기간(일):                                    0",
  "최대 암호 사용 기간(일):                                    42",
  "최소 암호 길이:                                             10",
  "잠금 임계값:                                                5",
].join("\r\n");
const NET_ACCOUNTS_EN_WEAK = [
  "Minimum password age (days):                          0",
  "Maximum password age (days):                          Unlimited",
  "Minimum password length:                              0",
  "Lockout threshold:                                    Never",
].join("\r\n");

describe("hardeningscan — kisa_pc (Windows PC)", () => {
  it("한국어 Windows: 정책 양호 판정", async () => {
    const r = await runHardeningScan({
      standard: "kisa_pc",
      run: mkRunner([
        [/^net accounts$/, NET_ACCOUNTS_KO],
        [/net share/, " IPC$        원격 IPC\r\n"],
        [/sc query RemoteRegistry/, "        STATE              : 1  STOPPED"],
        [/RecoveryConsole/, ""], // 키 없음 → PASS (mkRunner code=0이지만 out 빈값 → PASS 분기)
        [/findstr/, ""],
        [/Get-CimInstance/, "C: NTFS\r\nD: NTFS"],
      ]),
    });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by["PC-01"].status).toBe("PASS"); // 42일 ≤ 90
    expect(by["PC-02a"].status).toBe("PASS"); // 10자 ≥ 8
    expect(by["PC-02b"].status).toBe("PASS"); // 임계값 5
    expect(by["PC-03"].status).toBe("PASS");
    expect(by["PC-04"].status).toBe("WARN"); // IPC$만
    expect(by["PC-05"].status).toBe("PASS");
    expect(by["PC-06"].status).toBe("PASS");
    expect(by["PC-07"].status).toBe("PASS");
    expect(r.summary.fail).toBe(0);
  });

  it("영어 Windows(취약): 무제한 암호·잠금 미설정·기본 공유·메신저 검출", async () => {
    const r = await runHardeningScan({
      standard: "kisa_pc",
      run: mkRunner([
        [/^net accounts$/, NET_ACCOUNTS_EN_WEAK],
        [/net share/, " C$           C:\\        기본 공유\r\n ADMIN$       C:\\Windows  원격 관리\r\n IPC$\r\n"],
        [/sc query RemoteRegistry/, "        STATE              : 4  RUNNING"],
        [/RecoveryConsole/, "    SecurityLevel    REG_DWORD    0x1"],
        [/findstr/, "    DisplayName    REG_SZ    KakaoTalk\r\n    DisplayName    REG_SZ    Telegram Desktop"],
        [/Get-CimInstance/, "C: NTFS\r\nE: FAT32"],
      ]),
    });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by["PC-01"].status).toBe("FAIL"); // Unlimited
    expect(by["PC-02a"].status).toBe("FAIL"); // 0자
    expect(by["PC-02b"].status).toBe("FAIL"); // Never
    expect(by["PC-03"].status).toBe("FAIL"); // SecurityLevel=1
    expect(by["PC-04"].status).toBe("FAIL");
    expect(by["PC-04"].evidence).toMatch(/C\$|ADMIN\$/);
    expect(by["PC-05"].status).toBe("FAIL"); // RUNNING
    expect(by["PC-06"].status).toBe("WARN");
    expect(by["PC-06"].evidence).toContain("KakaoTalk");
    expect(by["PC-07"].status).toBe("FAIL");
    expect(by["PC-07"].evidence).toContain("FAT32");
    expect(r.summary.verdict).toContain("미흡");
  });
});

// ── 3단계 네트워크 장비 표준(kisa_net) — Cisco show run 목 출력 검증 ────────
describe("hardeningscan — kisa_net (네트워크 장비)", () => {
  it("하드닝된 Cisco 설정: 전 항목 PASS", async () => {
    const r = await runHardeningScan({
      standard: "kisa_net",
      run: mkRunner([
        [/include proxy-arp/, " no ip proxy-arp"],
        [/include unreachables\|redirects/, " no ip unreachables\n no ip redirects"],
        [/include identd/, ""],
        [/include domain/, "no ip domain-lookup"],
        [/include pad/, "no service pad"],
        [/include mask-reply/, ""],
      ]),
    });
    expect(r.summary.fail).toBe(0);
    expect(r.summary.warn).toBe(0);
    expect(r.summary.rate).toBe(100);
  });

  it("기본 설정 그대로인 장비: domain-lookup FAIL, proxy-arp·pad WARN", async () => {
    const r = await runHardeningScan({
      standard: "kisa_net",
      run: mkRunner([[/include/, ""]]), // 모든 show 출력 빈값 = 명시 설정 없음
    });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by["N-33"].status).toBe("WARN"); // 기본 활성
    expect(by["N-34"].status).toBe("WARN");
    expect(by["N-35"].status).toBe("PASS"); // 기본 비활성
    expect(by["N-36"].status).toBe("FAIL"); // 기본 활성 — 명시 차단 필요
    expect(by["N-37"].status).toBe("WARN");
    expect(by["N-38"].status).toBe("PASS");
  });

  it("활성 설정이 명시된 취약 장비: identd·mask-reply·pad FAIL", async () => {
    const r = await runHardeningScan({
      standard: "kisa_net",
      run: mkRunner([
        [/include proxy-arp/, " ip proxy-arp"],
        [/include identd/, "ip identd"],
        [/include pad/, "service pad"],
        [/include mask-reply/, " ip mask-reply"],
        [/include domain/, "no ip domain lookup"], // 구형 표기(공백)도 인정
      ]),
    });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by["N-33"].status).toBe("FAIL");
    expect(by["N-35"].status).toBe("FAIL");
    expect(by["N-36"].status).toBe("PASS");
    expect(by["N-37"].status).toBe("FAIL");
    expect(by["N-38"].status).toBe("FAIL");
  });

  it("SSH 접속 불가(응답 없음): 전 항목 WARN — 오탐 없이 확인필요 처리", async () => {
    const dead: RunFn = async () => ({ code: 255, out: "", err: "Connection timed out" });
    const r = await runHardeningScan({ standard: "kisa_net", run: dead });
    expect(r.items.every((i) => i.status === "WARN")).toBe(true);
    expect(r.items[0].evidence).toContain("SSH");
  });
});

describe("hardeningscan — 라우트", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });

  it("GET /api/hardening/checklists — 인증 필요, 4개 기준 반환", async () => {
    expect((await request(app).get("/api/hardening/checklists")).status).toBe(401);
    const res = await request(app).get("/api/hardening/checklists").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.standards).toHaveLength(4);
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
