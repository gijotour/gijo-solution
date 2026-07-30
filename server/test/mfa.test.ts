// 2차 인증 흐름 — **우회 경로를 막았는가**가 이 시험의 목적이다.
// 기능이 되는지(6자리 넣으면 들어간다)는 쉬운 절반이고, 어려운 절반은
// "코드를 안 넣고 들어갈 길이 남아 있지 않은가"다. 아래 시험들은 그 길을 하나씩 닫는다.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAuthForTests } from "../src/auth/auth";
import {
  resetMfaForTests, startEnrollment, confirmEnrollment, mfaStatus, isMfaEnabled,
  setMfaRequiredForAdmin, accountsBlockedByPolicy, consumeRecoveryCode, issueRecoveryCodes,
} from "../src/auth/mfa";
import { totpCode } from "../src/auth/totp";
import { findUserByUsername } from "../src/auth/users";

const app = createApp();
const USER = "jyh";
const PASS = "changeme";

function userId(): string {
  const u = findUserByUsername(USER);
  if (!u) throw new Error("시드 계정이 없다");
  return u.id;
}

/**
 * 등록을 끝까지 마치고 비밀키를 돌려준다(시험 준비용).
 * 확인에는 **직전 칸(30초 전)의 숫자**를 쓴다 — 지금 칸의 숫자로 등록하면 그 숫자는 소진되어
 * 곧바로 잇는 로그인 시험이 "재사용"으로 막힌다(제품이 옳게 동작한 것이지 결함이 아니다).
 */
function enrollNow(): string {
  const started = startEnrollment(userId(), USER);
  if ("error" in started) throw new Error("등록 시작 실패");
  const r = confirmEnrollment(userId(), totpCode(started.secret, Date.now() - 30_000));
  if (!r.ok) throw new Error("등록 확인 실패: " + r.reason);
  return started.secret;
}

beforeEach(() => {
  resetAuthForTests();
  resetMfaForTests();
});

describe("등록", () => {
  it("등록을 시작해도 로그인은 그대로 된다 — 확인 전엔 코드를 요구하지 않는다", async () => {
    startEnrollment(userId(), USER);
    expect(mfaStatus(userId())).toMatchObject({ enabled: false, enrolling: true });
    const res = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.mfaRequired).toBeUndefined();
  });

  it("확인이 끝나면 켜지고 복구 코드 10개가 한 번 나온다", () => {
    const started = startEnrollment(userId(), USER);
    if ("error" in started) throw new Error("시작 실패");
    const r = confirmEnrollment(userId(), totpCode(started.secret));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recoveryCodes.length).toBe(10);
    expect(mfaStatus(userId())).toMatchObject({ enabled: true, recoveryRemaining: 10 });
  });

  it("틀린 코드로는 켜지지 않는다", () => {
    startEnrollment(userId(), USER);
    expect(confirmEnrollment(userId(), "000000").ok).toBe(false);
    expect(isMfaEnabled(userId())).toBe(false);
  });

  it("이미 켜져 있으면 새 등록을 시작하지 않는다 — 실수로 기존 등록을 날리지 않게", () => {
    enrollNow();
    expect(startEnrollment(userId(), USER)).toEqual({ error: "already_enabled" });
  });

  it("등록 API가 QR과 직접 입력용 키를 함께 내려준다(QR을 못 그려도 등록 가능해야 한다)", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const res = await request(app).post("/api/auth/mfa/start").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.uri).toContain("otpauth://totp/");
    expect(res.body.secretDisplay).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/);
    expect(res.body.qrSvg).toContain("<svg");
    // QR은 이 서버에서 그린다 — 외부로 무엇을 가져오는 표시가 있으면 폐쇄망에서 깨진다.
    expect(res.body.qrSvg).not.toMatch(/(src|xlink:href)=/);
  });
});

describe("로그인 2단계", () => {
  it("켜져 있으면 비밀번호만으로는 토큰을 주지 않는다 — 중간 토큰만 준다", async () => {
    enrollNow();
    const res = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.mfaToken).toBeTruthy();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it("중간 토큰으로는 어떤 API도 못 부른다 — 이게 뚫리면 2차 인증이 장식이 된다", async () => {
    enrollNow();
    const first = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${first.body.mfaToken}`);
    expect(me.status).toBe(401);
    expect(me.body.error).toBe("mfa_incomplete");
    const assets = await request(app).get("/api/assets").set("Authorization", `Bearer ${first.body.mfaToken}`);
    expect(assets.status).toBe(401);
  });

  it("맞는 6자리를 넣으면 정상 토큰이 나온다", async () => {
    const secret = enrollNow();
    const first = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const res = await request(app).post("/api/auth/login/mfa").send({ mfaToken: first.body.mfaToken, code: totpCode(secret) });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(USER);
  });

  it("같은 숫자를 두 번 쓰지 못한다(재사용 차단)", async () => {
    const secret = enrollNow();
    const code = totpCode(secret);
    const a = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    expect((await request(app).post("/api/auth/login/mfa").send({ mfaToken: a.body.mfaToken, code })).status).toBe(200);
    const b = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const again = await request(app).post("/api/auth/login/mfa").send({ mfaToken: b.body.mfaToken, code });
    expect(again.status).toBe(401);
    expect(again.body.message).toContain("이미 쓴 숫자");
  });

  it("등록에 쓴 숫자로는 바로 로그인하지 못한다 — 다음 숫자를 기다려야 한다", async () => {
    // 등록 확인과 로그인이 같은 30초 안에 일어나면 같은 숫자다. 재사용 차단이 옳게 작동하는지.
    const started = startEnrollment(userId(), USER);
    if ("error" in started) throw new Error("시작 실패");
    const code = totpCode(started.secret);
    expect(confirmEnrollment(userId(), code).ok).toBe(true);
    const a = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const res = await request(app).post("/api/auth/login/mfa").send({ mfaToken: a.body.mfaToken, code });
    expect(res.status).toBe(401);
    expect(res.body.message).toContain("이미 쓴 숫자");
  });

  it("중간 토큰이 없거나 위조면 거부한다", async () => {
    enrollNow();
    for (const bad of [undefined, "", "not-a-jwt", "a.b.c"]) {
      const res = await request(app).post("/api/auth/login/mfa").send({ mfaToken: bad, code: "123456" });
      expect(res.status).toBe(401);
    }
  });

  it("정상 access token을 중간 토큰 자리에 넣어도 통하지 않는다(용도 확인)", async () => {
    // 2차 인증을 안 켠 계정으로 정상 토큰을 얻은 뒤, 그걸로 2단계를 건너뛰려는 시도.
    const login = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const res = await request(app).post("/api/auth/login/mfa").send({ mfaToken: login.body.accessToken, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("mfa_token_invalid");
  });

  it("코드 실패가 쌓이면 잠긴다 — 6자리 추측을 무한히 못 하게(NIST SP 800-63B 필수 요건)", async () => {
    enrollNow();
    let last: number | undefined;
    for (let i = 0; i < 12; i++) {
      const s = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
      if (!s.body.mfaToken) { last = s.status; break; }
      const r = await request(app).post("/api/auth/login/mfa").send({ mfaToken: s.body.mfaToken, code: "000000" });
      last = r.status;
      if (r.status === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe("복구 코드", () => {
  it("복구 코드로 로그인되고 그 코드는 한 번만 통한다", async () => {
    const started = startEnrollment(userId(), USER);
    if ("error" in started) throw new Error("시작 실패");
    const conf = confirmEnrollment(userId(), totpCode(started.secret));
    if (!conf.ok) throw new Error("확인 실패");
    const code = conf.recoveryCodes[0];

    const a = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const ok = await request(app).post("/api/auth/login/mfa").send({ mfaToken: a.body.mfaToken, recoveryCode: code });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.recoveryRemaining).toBe(9);

    const b = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const again = await request(app).post("/api/auth/login/mfa").send({ mfaToken: b.body.mfaToken, recoveryCode: code });
    expect(again.status).toBe(401);
  });

  it("하이픈·소문자로 넣어도 같은 코드로 본다 — 종이에서 옮겨 적는 값이라", () => {
    const started = startEnrollment(userId(), USER);
    if ("error" in started) throw new Error("시작 실패");
    const conf = confirmEnrollment(userId(), totpCode(started.secret));
    if (!conf.ok) throw new Error("확인 실패");
    const c = conf.recoveryCodes[0];
    expect(consumeRecoveryCode(userId(), c.toLowerCase().replace("-", " ")).ok).toBe(true);
  });

  it("2차 인증이 꺼진 계정의 복구 코드는 통하지 않는다", () => {
    issueRecoveryCodes(userId()); // 켜지 않은 채 코드만 있는 상태
    expect(consumeRecoveryCode(userId(), "AAAA-BBBB").ok).toBe(false);
  });

  it("재발급하면 옛 코드는 전부 무효가 된다", () => {
    const started = startEnrollment(userId(), USER);
    if ("error" in started) throw new Error("시작 실패");
    const conf = confirmEnrollment(userId(), totpCode(started.secret));
    if (!conf.ok) throw new Error("확인 실패");
    const old = conf.recoveryCodes[0];
    issueRecoveryCodes(userId());
    expect(consumeRecoveryCode(userId(), old).ok).toBe(false);
    expect(mfaStatus(userId()).recoveryRemaining).toBe(10);
  });
});

describe("끄기 · 관리자 해제", () => {
  it("끄려면 비밀번호를 다시 받아야 한다 — 자리를 비운 화면에서 몰래 꺼지면 안 된다", async () => {
    const secret = enrollNow();
    const a = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const s = await request(app).post("/api/auth/login/mfa").send({ mfaToken: a.body.mfaToken, code: totpCode(secret) });
    const auth = `Bearer ${s.body.accessToken}`;

    const noPass = await request(app).post("/api/auth/mfa/disable").set("Authorization", auth).send({});
    expect(noPass.status).toBe(401);
    expect(isMfaEnabled(userId())).toBe(true);

    const wrong = await request(app).post("/api/auth/mfa/disable").set("Authorization", auth).send({ password: "틀린비번" });
    expect(wrong.status).toBe(401);
    expect(isMfaEnabled(userId())).toBe(true);

    const right = await request(app).post("/api/auth/mfa/disable").set("Authorization", auth).send({ password: PASS });
    expect(right.status).toBe(200);
    expect(isMfaEnabled(userId())).toBe(false);
  });

  it("관리자 해제는 감사 로그에 남는다 — 누가 누구의 방어선을 풀었는지 추적", async () => {
    const secret = enrollNow();
    const a = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const s = await request(app).post("/api/auth/login/mfa").send({ mfaToken: a.body.mfaToken, code: totpCode(secret) });
    const auth = `Bearer ${s.body.accessToken}`;

    const res = await request(app).post(`/api/users/${userId()}/mfa/reset`).set("Authorization", auth).send({});
    expect(res.status).toBe(200);
    expect(isMfaEnabled(userId())).toBe(false);

    const audit = await request(app).get("/api/audit?limit=20").set("Authorization", auth);
    expect(audit.status).toBe(200);
    const rows = audit.body.entries as { action: string; target: string | null }[];
    const hit = rows.find((r) => r.action.includes("2차 인증 관리자 해제"));
    expect(hit, "관리자 해제가 감사 로그에 없다").toBeTruthy();
    expect(hit?.target).toBe(USER); // 누구의 것을 풀었는지가 남아야 추적이 된다
  });

  it("2차 인증이 없는 계정을 해제하려 하면 409로 정직하게 알린다(성공했다고 하지 않는다)", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const res = await request(app).post(`/api/users/${userId()}/mfa/reset`)
      .set("Authorization", `Bearer ${login.body.accessToken}`).send({});
    expect(res.status).toBe(409);
  });
});

describe("관리자 필수 정책", () => {
  it("켜면 막히는 계정을 미리 알려준다 — 자동화까지 막히므로 켜기 전에 보여줘야 한다", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const auth = `Bearer ${login.body.accessToken}`;
    const before = await request(app).get("/api/auth/mfa/policy").set("Authorization", auth);
    expect(before.status).toBe(200);
    expect(before.body.requireForAdmin).toBe(false);
    // 2차 인증을 안 켠 admin이 목록에 있어야 한다(시드 계정 jyh가 admin).
    expect(before.body.blocked.some((b: { username: string }) => b.username === USER)).toBe(true);
  });

  it("정책이 켜지면 등록 안 한 관리자는 '등록만 가능한' 세션을 받는다", async () => {
    setMfaRequiredForAdmin(true);
    const res = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    expect(res.status).toBe(200);
    expect(res.body.enrollRequired).toBe(true);
    const auth = `Bearer ${res.body.accessToken}`;

    // 등록 경로는 열려 있다 — 안 열려 있으면 등록할 방법이 없어진다(로그인해야 등록, 등록해야 로그인).
    expect((await request(app).get("/api/auth/mfa/status").set("Authorization", auth)).status).toBe(200);
    expect((await request(app).post("/api/auth/mfa/start").set("Authorization", auth)).status).toBe(200);
    // 그 밖의 기능은 막힌다.
    const blocked = await request(app).get("/api/assets").set("Authorization", auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("mfa_enrollment_required");
  });

  it("⚠ refresh로 제한이 풀리지 않는다 — 이어받지 않으면 정책이 무의미해진다", async () => {
    setMfaRequiredForAdmin(true);
    const login = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    const blocked = await request(app).get("/api/assets").set("Authorization", `Bearer ${refreshed.body.accessToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("mfa_enrollment_required");
  });

  it("등록을 끝내면 그 자리에서 정상 세션으로 올라간다 — 다시 로그인하게 하지 않는다", async () => {
    setMfaRequiredForAdmin(true);
    const login = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const auth = `Bearer ${login.body.accessToken}`;
    const started = await request(app).post("/api/auth/mfa/start").set("Authorization", auth);
    expect(started.status).toBe(200);
    const secret = started.body.secretDisplay.replace(/ /g, "");
    const conf = await request(app).post("/api/auth/mfa/confirm").set("Authorization", auth).send({ code: totpCode(secret) });
    expect(conf.status).toBe(200);
    expect(conf.body.recoveryCodes.length).toBe(10);
    expect(conf.body.accessToken).toBeTruthy(); // 승격된 새 토큰
    const ok = await request(app).get("/api/assets").set("Authorization", `Bearer ${conf.body.accessToken}`);
    expect(ok.status).toBe(200);
  });

  it("정책이 켜져 있으면 관리자가 스스로 끌 수 없다 — 정책을 우회하는 구멍", async () => {
    const secret = enrollNow();
    const a = await request(app).post("/api/auth/login").send({ username: USER, password: PASS, force: true });
    const s = await request(app).post("/api/auth/login/mfa").send({ mfaToken: a.body.mfaToken, code: totpCode(secret) });
    setMfaRequiredForAdmin(true);
    const res = await request(app).post("/api/auth/mfa/disable")
      .set("Authorization", `Bearer ${s.body.accessToken}`).send({ password: PASS });
    expect(res.status).toBe(403);
    expect(isMfaEnabled(userId())).toBe(true);
  });

  it("등록을 마치면 정책상 막히는 계정 목록에서 빠진다", () => {
    expect(accountsBlockedByPolicy().some((b) => b.username === USER)).toBe(true);
    enrollNow();
    expect(accountsBlockedByPolicy().some((b) => b.username === USER)).toBe(false);
  });
});
