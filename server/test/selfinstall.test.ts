// 고객 self-install — 안전한 초기 관리자 + 설치 후 준비 진단(프리플라이트).
import { describe, it, expect } from "vitest";
import request from "supertest";
import { computeInitialAdmin } from "../src/auth/users";
import { runPreflight } from "../src/engine/preflight";
import { createApp } from "../src/app";

describe("computeInitialAdmin — 안전한 초기 계정", () => {
  it("개발/테스트는 기존 jyh/changeme 유지(하위호환)", () => {
    const a = computeInitialAdmin({} as NodeJS.ProcessEnv);
    expect(a.username).toBe("jyh");
    expect(a.password).toBe("changeme");
    expect(a.generated).toBe(false);
  });
  it("운영(production)에선 알려진 기본 비번을 쓰지 않고 랜덤 생성", () => {
    const a = computeInitialAdmin({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(a.username).toBe("admin");
    expect(a.password).not.toBe("changeme");
    expect(a.password.length).toBeGreaterThanOrEqual(12);
    expect(a.generated).toBe(true);
  });
  it("초기 비번 env 지정 시 그 값을 사용(랜덤 아님)", () => {
    const a = computeInitialAdmin({ GIJO_INITIAL_ADMIN_PASSWORD: "MyStrongP@ss1", GIJO_INITIAL_ADMIN_USERNAME: "sec" } as NodeJS.ProcessEnv);
    expect(a.username).toBe("sec");
    expect(a.password).toBe("MyStrongP@ss1");
    expect(a.generated).toBe(false);
  });
});

describe("runPreflight — 설치 후 준비 진단", () => {
  it("항목별 점검을 반환한다(Node·GPU·모델·JWT·기본계정·저장소)", async () => {
    const r = await runPreflight();
    const names = r.checks.map((c) => c.name);
    expect(names).toContain("Node.js");
    expect(names).toContain("JWT 시크릿");
    expect(names).toContain("기본 관리자 비밀번호");
    expect(typeof r.ready).toBe("boolean");
    // Node.js 체크는 이 런타임에서 pass여야 함
    expect(r.checks.find((c) => c.name === "Node.js")?.status).toBe("pass");
  });

  it("프리플라이트 엔드포인트는 관리자 인증을 요구한다", async () => {
    const app = createApp();
    const noauth = await request(app).get("/api/admin/preflight");
    expect(noauth.status).toBe(401);
  });
});
