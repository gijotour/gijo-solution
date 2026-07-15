import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetMaintenanceForTests } from "../src/engine/maintenance";
import { resetUsersForTests } from "../src/auth/users";

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body.accessToken as string;
}

describe("maintenance (유지보수 일정 · 점검서 · 승인)", () => {
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    resetMaintenanceForTests();
    resetUsersForTests();
    app = createApp();
    adminToken = await login(app);
  });

  async function createItem(overrides: Partial<{ title: string; productName: string; scheduleDate: string; intervalDays: number }> = {}) {
    const res = await request(app)
      .post("/api/maintenance")
      .set(auth(adminToken))
      .send({ title: "방화벽 정책 점검", productName: "FW-01", scheduleDate: "2026-01-01", ...overrides });
    return res.body as { id: string; status: string };
  }

  it("creates a scheduled item and lists it", async () => {
    const item = await createItem();
    expect(item.status).toBe("scheduled");
    const list = await request(app).get("/api/maintenance").set(auth(adminToken));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(item.id);
  });

  it("rejects creation missing required fields", async () => {
    const res = await request(app).post("/api/maintenance").set(auth(adminToken)).send({ title: "제목만" });
    expect(res.status).toBe(400);
  });

  it("full lifecycle: report -> approve, and auto-creates the next cycle when intervalDays is set", async () => {
    const item = await createItem({ scheduleDate: "2026-01-01", intervalDays: 90 });

    const reported = await request(app)
      .post(`/api/maintenance/${item.id}/report`)
      .set(auth(adminToken))
      .send({ note: "점검 완료, 이상 없음" });
    expect(reported.body.status).toBe("reported");
    expect(reported.body.reportedBy).toBe("정요한"); // 시드 admin 계정의 displayName

    const approved = await request(app).post(`/api/maintenance/${item.id}/approve`).set(auth(adminToken));
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.reviewedBy).toBe("정요한");

    // 반복주기(90일)가 있으므로 다음 회차가 자동으로 예정 등록돼야 한다
    const list = (await request(app).get("/api/maintenance").set(auth(adminToken))).body as {
      id: string;
      status: string;
      scheduleDate: string;
    }[];
    expect(list).toHaveLength(2);
    const next = list.find((x) => x.id !== item.id)!;
    expect(next.status).toBe("scheduled");
    expect(next.scheduleDate).toBe("2026-04-01");
  });

  it("rejects with a reason and does not schedule a next cycle", async () => {
    const item = await createItem({ intervalDays: 30 });
    await request(app).post(`/api/maintenance/${item.id}/report`).set(auth(adminToken)).send({ note: "점검함" });

    const rejected = await request(app)
      .post(`/api/maintenance/${item.id}/reject`)
      .set(auth(adminToken))
      .send({ reason: "점검 범위 부족 — 재점검 필요" });
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.reviewNote).toBe("점검 범위 부족 — 재점검 필요");

    const list = await request(app).get("/api/maintenance").set(auth(adminToken));
    expect(list.body).toHaveLength(1); // 반려는 다음 회차를 만들지 않는다
  });

  it("only an admin can approve/reject — a security_officer gets 403", async () => {
    await request(app)
      .post("/api/users")
      .set(auth(adminToken))
      .send({ username: "officer1", password: "pw1234", displayName: "김담당", role: "security_officer" });
    const officerToken = await login(app, "officer1", "pw1234");

    const item = await createItem();
    await request(app).post(`/api/maintenance/${item.id}/report`).set(auth(officerToken)).send({ note: "점검함" });

    const approveAttempt = await request(app).post(`/api/maintenance/${item.id}/approve`).set(auth(officerToken));
    expect(approveAttempt.status).toBe(403);

    const rejectAttempt = await request(app).post(`/api/maintenance/${item.id}/reject`).set(auth(officerToken)).send({ reason: "x" });
    expect(rejectAttempt.status).toBe(403);
  });

  it("rejects reporting/approving out of order", async () => {
    const item = await createItem();
    // 아직 scheduled인데 승인부터 시도
    const approveTooSoon = await request(app).post(`/api/maintenance/${item.id}/approve`).set(auth(adminToken));
    expect(approveTooSoon.status).toBe(400);

    await request(app).post(`/api/maintenance/${item.id}/report`).set(auth(adminToken)).send({ note: "점검함" });
    // 이미 reported인데 다시 report 시도
    const doubleReport = await request(app).post(`/api/maintenance/${item.id}/report`).set(auth(adminToken)).send({ note: "또 점검함" });
    expect(doubleReport.status).toBe(400);
  });

  it("GET /due only returns scheduled items due today or earlier", async () => {
    await createItem({ title: "오늘 마감", scheduleDate: new Date().toISOString().slice(0, 10) });
    await createItem({ title: "먼 미래", scheduleDate: "2099-01-01" });
    const reportedItem = await createItem({ title: "이미 보고됨", scheduleDate: "2020-01-01" });
    await request(app).post(`/api/maintenance/${reportedItem.id}/report`).set(auth(adminToken)).send({ note: "완료" });

    const due = await request(app).get("/api/maintenance/due").set(auth(adminToken));
    expect(due.body).toHaveLength(1);
    expect(due.body[0].title).toBe("오늘 마감");
  });

  it("requires auth", async () => {
    expect((await request(app).get("/api/maintenance")).status).toBe(401);
    expect((await request(app).post("/api/maintenance")).status).toBe(401);
  });
});
