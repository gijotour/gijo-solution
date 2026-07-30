// 명령 진행 상태 — 정직 원칙과 격리 경계를 확인한다.
//
// 지키려는 계약:
//  · 진행 문맥이 없으면 reportProgress는 완전 무동작 (내부 호출·QA·테스트가 오염되지 않는다)
//  · 처리가 끝나면 즉시 지워진다 (다음 지시와 섞이지 않는다)
//  · 남의 진행은 조회되지 않는다 — 존재 여부조차 알려주지 않는다
//  · 진행 기록 실패가 본 작업을 깨뜨리지 않는다
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import {
  runWithProgress, reportProgress, reportBigStep, getProgress, resetProgressForTests, isValidProgressId,
} from "../src/engine/progress";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";

beforeEach(() => resetProgressForTests());

describe("진행 상태 코어", () => {
  it("runWithProgress 안에서 단계가 기록되고, 끝나면 즉시 사라진다", async () => {
    const states: (ReturnType<typeof getProgress> | null)[] = [];
    await runWithProgress("test-id-12345678", "user-1", async () => {
      states.push(getProgress("test-id-12345678", "user-1")); // 시작 직후 — understand
      reportProgress("tools", "취약점 검색 실행 중");
      states.push(getProgress("test-id-12345678", "user-1"));
      reportProgress("write", "답을 쓰고 있습니다");
      states.push(getProgress("test-id-12345678", "user-1"));
    });
    expect(states[0]?.stage).toBe("understand");
    expect(states[1]?.stage).toBe("tools");
    expect(states[1]?.detail).toBe("취약점 검색 실행 중");
    expect(states[2]?.stage).toBe("write");
    // 끝났으면 없다 — 클라는 응답을 받았으니 폴링을 멈추고, 남은 항목은 다음 지시와 섞일 뿐이다.
    expect(getProgress("test-id-12345678", "user-1")).toBeNull();
  });

  it("진행 문맥 밖에서는 reportProgress가 완전 무동작이다", () => {
    expect(() => reportProgress("tools", "어디에도 기록되지 않는다")).not.toThrow();
    expect(getProgress("test-id-12345678", "user-1")).toBeNull();
  });

  it("남의 진행은 존재 여부조차 알려주지 않는다", async () => {
    await runWithProgress("test-id-12345678", "user-1", async () => {
      expect(getProgress("test-id-12345678", "다른사람")).toBeNull(); // 남 — 없다고 답한다
      expect(getProgress("test-id-12345678", "user-1")?.stage).toBe("understand"); // 본인 — 보인다
    });
  });

  it("큰 단계(오케스트레이션)는 이후 보고에도 유지된다", async () => {
    await runWithProgress("test-id-12345678", "user-1", async () => {
      reportBigStep(2, 3, "critical 취약점 배정");
      reportProgress("tools", "담당자 배정 실행 중");
      const s = getProgress("test-id-12345678", "user-1");
      expect(s?.bigStep).toEqual({ index: 2, total: 3, label: "critical 취약점 배정" });
      expect(s?.detail).toBe("담당자 배정 실행 중");
    });
  });

  it("본 작업의 예외는 그대로 전파되고, 진행 항목은 정리된다", async () => {
    await expect(
      runWithProgress("test-id-12345678", "user-1", async () => {
        throw new Error("본 작업 실패");
      })
    ).rejects.toThrow("본 작업 실패");
    expect(getProgress("test-id-12345678", "user-1")).toBeNull();
  });

  it("progressId 형식을 좁게 받는다 — 아무 문자열이나 키로 쓰지 않는다", () => {
    expect(isValidProgressId("0f1e2d3c-4b5a-6789-abcd-ef0123456789")).toBe(true);
    expect(isValidProgressId("짧다")).toBe(false);
    expect(isValidProgressId("has spaces here")).toBe(false);
    expect(isValidProgressId(123)).toBe(false);
    expect(isValidProgressId("a".repeat(65))).toBe(false);
  });
});

describe("진행 조회 API", () => {
  async function login(app: ReturnType<typeof createApp>) {
    const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    return res.body.accessToken as string;
  }

  it("로그인 필요, id 형식 오류는 400, 없는 진행은 running:false", async () => {
    const app = createApp();
    await request(app).get("/api/dispatch/progress?id=test-id-12345678").expect(401);

    const token = await login(app);
    await request(app).get("/api/dispatch/progress?id=x").set("Authorization", `Bearer ${token}`).expect(400);
    const r = await request(app)
      .get("/api/dispatch/progress?id=test-id-12345678")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(r.body).toEqual({ running: false });
  });
});
