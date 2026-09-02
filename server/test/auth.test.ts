import { describe, it, expect } from "vitest";
import * as jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAuthForTests } from "../src/auth/auth";

describe("auth", () => {
  const app = createApp();

  it("logs in with valid credentials and returns an access + refresh token pair", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.displayName).toBe("정요한");
  });

  // ⚠ 담당자가 「몇 번 남았는지」를 모른 채 갑자기 잠기던 문제(F8-09, 여정 점검 2026-09-01).
  //   숫자(임계·잠금 길이)는 **서버가 문장으로 만들어** 내려보낸다 — 화면이 제 숫자를 갖지 않게.
  it("비밀번호를 틀리면 남은 횟수와 잠금 시간을 알려 준다", async () => {
    // 잠금 열쇠는 (IP + 아이디)라, 다른 시험과 안 섞이도록 이 시험만 쓰는 아이디를 쓴다.
    const 아이디 = "f809-없는사람";
    let 남은: number | null = null;
    let 문장 = "";
    for (let i = 0; i < 6; i++) {
      const r = await request(app).post("/api/auth/login").send({ username: 아이디, password: "wrong" });
      if (r.status !== 401) break;   // 임계를 낮게 둔 환경이면 도중에 429가 된다
      expect(typeof r.body.remaining, "남은 횟수를 안 준다").toBe("number");
      남은 = r.body.remaining as number;
      문장 = String(r.body.message ?? "");
    }
    expect(남은, "401을 한 번도 못 받았다").not.toBeNull();
    expect(남은 as number, "틀릴수록 남은 횟수가 줄지 않는다").toBeLessThanOrEqual(5);
    // 5회 이하로 줄면 「N회 더 틀리면 N분」을 사람 말로 말한다(0이면 「N분 동안 잠겼습니다」).
    expect(문장, "남은 횟수·잠금 시간을 말하지 않는다").toMatch(/\d+회 더 틀리면 \d+분|\d+분 동안 잠겼습니다/);
    // 영문 날것을 담당자에게 보내지 않는다.
    expect(문장, "영문 사유가 그대로 나간다").not.toMatch(/invalid credentials/i);
  });

  it("rejects invalid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "wrong" });
    expect(res.status).toBe(401);
  });

  // 실사고(2026-07-29): /api/auth/me가 user 객체를 통째로 돌려줘 **passwordHash(bcrypt)가
  // 클라이언트로 나갔다**. 내 계정 해시라 해도 나갈 이유가 없다 — 렌더러 메모리·로그·오류
  // 리포트에 묻어 나가면 오프라인 크래킹 대상이 된다. 보안 제품이 자기 비밀을 흘리면 안 된다.
  it("내 정보에 비밀번호 해시가 절대 실리지 않는다", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme", force: true });
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("jyh");
    expect(me.body.passwordHash).toBeUndefined();
    // 필드 이름이 바뀌어도 잡히게 — 응답 어디에도 bcrypt 해시 모양이 있으면 안 된다.
    expect(JSON.stringify(me.body)).not.toMatch(/\$2[aby]\$\d{2}\$/);
  });

  it("rejects protected routes without a token", async () => {
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed/tampered access token", async () => {
    const res = await request(app).get("/api/agents").set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });

  it("rejects an expired access token", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    const expired = jwt.sign({ sub: login.body.user.id }, "gijo-as-dev-secret-change-me", { expiresIn: -1 });
    const res = await request(app).get("/api/agents").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("allows protected routes with a valid access token", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });

    const res = await request(app).get("/api/agents").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(7); // Security Orchestrator·Scan·Analyze·Report·TI + GIJO Agent(id=normaltic, 그라운딩) + Curator Agent(사서, 2026-09-03)
  });

  it("exchanges a refresh token for a new token pair and rotates the old refresh token out", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });

    const refreshRes = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).not.toBe(login.body.refreshToken);

    // reusing the now-rotated-out refresh token must fail
    const reuse = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it("rejects an unknown or missing refresh token", async () => {
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken: "not-a-real-refresh-token" });
    expect(res.status).toBe(401);
  });

  it("revokes the refresh token on logout (refresh no longer works after logout)", async () => {
    resetAuthForTests();
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });

    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ refreshToken: login.body.refreshToken });

    const refreshRes = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshRes.status).toBe(401);

    // access tokens are stateless JWTs by design (9.4절) — the still-unexpired access token
    // issued before logout keeps working until it naturally expires; only the refresh token
    // (which controls whether *new* access tokens can be minted) is revoked immediately.
    const stillWorks = await request(app).get("/api/agents").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(stillWorks.status).toBe(200);
  });

  it("blocks a second login for the same account while a session is already active", async () => {
    const first = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_logged_in");

    // 옛 세션은 여전히 살아 있다 — 차단됐을 뿐 대체되지 않았다.
    const refreshRes = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    expect(refreshRes.status).toBe(200);
  });

  it("force login revokes the old session and the old refresh token stops working", async () => {
    const first = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme", force: true });
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);

    const oldRefresh = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken });
    expect(oldRefresh.status).toBe(409);
    expect(oldRefresh.body.error).toBe("session_superseded");

    const newRefresh = await request(app).post("/api/auth/refresh").send({ refreshToken: second.body.refreshToken });
    expect(newRefresh.status).toBe(200);
  });

  // 접속 중 세션 목록(팀 사무실 "외부 콘솔 접속자") — 로그인 필요, 활동 시각 갱신, 로그아웃 시 사라짐.
  it("lists active sessions with presence metadata and drops them on logout", async () => {
    resetAuthForTests();
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    expect(login.status).toBe(200);

    // 미인증 접근은 거부
    const anon = await request(app).get("/api/auth/sessions");
    expect(anon.status).toBe(401);

    const res = await request(app).get("/api/auth/sessions").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].username).toBe("jyh");
    expect(res.body[0].role).toBe("admin");
    expect(res.body[0].since).toBeGreaterThan(0);
    expect(res.body[0].lastSeenAt).toBeGreaterThanOrEqual(res.body[0].since);
    expect(res.body[0]).not.toHaveProperty("passwordHash"); // 해시 등 민감값 미노출

    // 인증 요청이 있을 때마다 lastSeenAt이 앞으로 간다(presence 판정 근거)
    const before = res.body[0].lastSeenAt;
    await new Promise((r) => setTimeout(r, 15));
    await request(app).get("/api/agents").set("Authorization", `Bearer ${login.body.accessToken}`);
    const after = await request(app).get("/api/auth/sessions").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(after.body[0].lastSeenAt).toBeGreaterThan(before);

    // 로그아웃하면 세션 목록에서 사라진다 (자기 세션 반납 → 목록은 빈 배열)
    await request(app).post("/api/auth/logout")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ refreshToken: login.body.refreshToken });
    const gone = await request(app).get("/api/auth/sessions").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(gone.status).toBe(200); // access token은 자연 만료 전까지 유효(무상태 JWT)
    expect(gone.body.length).toBe(0);
  });
});
