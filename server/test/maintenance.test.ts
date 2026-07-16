import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetMaintenanceForTests, buildDueMaintenanceEmail } from "../src/engine/maintenance";
import type { MaintenanceItem } from "../src/engine/maintenance";
import { resetUsersForTests } from "../src/auth/users";
import { resetSmtpConfigForTests } from "../src/engine/email";

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
    resetSmtpConfigForTests();
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

  it("records a status-change history timeline (created -> reported -> approved) in order", async () => {
    const item = await createItem({ title: "이력 점검", intervalDays: 90 });
    await request(app).post(`/api/maintenance/${item.id}/report`).set(auth(adminToken)).send({ note: "점검 결과 메모" });
    await request(app).post(`/api/maintenance/${item.id}/approve`).set(auth(adminToken));

    const hist = await request(app).get(`/api/maintenance/${item.id}/history`).set(auth(adminToken));
    expect(hist.status).toBe(200);
    expect(hist.body.map((e: { event: string }) => e.event)).toEqual(["created", "reported", "approved"]);
    // 이벤트는 시간순(at ASC)으로 정렬돼야 한다
    const times = hist.body.map((e: { at: number }) => e.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // 보고 이벤트에 메모와 수행자가 실린다
    const reported = hist.body.find((e: { event: string }) => e.event === "reported");
    expect(reported.note).toBe("점검 결과 메모");
    expect(reported.actor).toBe("정요한");
  });

  it("allows re-reporting after rejection and captures the whole cycle in history", async () => {
    const item = await createItem();
    await request(app).post(`/api/maintenance/${item.id}/report`).set(auth(adminToken)).send({ note: "1차 점검" });
    await request(app).post(`/api/maintenance/${item.id}/reject`).set(auth(adminToken)).send({ reason: "범위 부족" });

    // 반려된 항목을 다시 보고할 수 있어야 한다(재점검)
    const reReport = await request(app).post(`/api/maintenance/${item.id}/report`).set(auth(adminToken)).send({ note: "2차 재점검" });
    expect(reReport.status).toBe(200);
    expect(reReport.body.status).toBe("reported");
    // 재보고 시 이전 반려 검토 기록은 지워진다("최신" 필드가 새 보고를 가리킴)
    expect(reReport.body.reviewNote).toBeUndefined();

    const approved = await request(app).post(`/api/maintenance/${item.id}/approve`).set(auth(adminToken));
    expect(approved.body.status).toBe("approved");

    const hist = await request(app).get(`/api/maintenance/${item.id}/history`).set(auth(adminToken));
    expect(hist.body.map((e: { event: string }) => e.event)).toEqual([
      "created",
      "reported",
      "rejected",
      "reported",
      "approved",
    ]);
  });

  it("history is empty for an unknown id and requires auth", async () => {
    const empty = await request(app).get("/api/maintenance/no-such-id/history").set(auth(adminToken));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
    expect((await request(app).get("/api/maintenance/x/history")).status).toBe(401);
  });

  it("links an inspection to an AI asset and resolves the asset name", async () => {
    // 자산 하나 등록
    await request(app)
      .post("/api/assets")
      .set(auth(adminToken))
      .send({ id: "asset-x1", name: "테스트 AI 자산", path: "/srv/ai/x1", assetType: "LLM 서비스", owner: "보안팀" });

    const created = await request(app)
      .post("/api/maintenance")
      .set(auth(adminToken))
      .send({ title: "가드레일 점검", productName: "챗봇", scheduleDate: "2026-01-01", assetId: "asset-x1" });
    expect(created.status).toBe(200);
    expect(created.body.assetId).toBe("asset-x1");
    expect(created.body.assetName).toBe("테스트 AI 자산"); // 읽을 때 자산명이 채워진다

    // 자산별 점검 목록
    const byAsset = await request(app).get("/api/assets/asset-x1/maintenance").set(auth(adminToken));
    expect(byAsset.status).toBe(200);
    expect(byAsset.body).toHaveLength(1);
    expect(byAsset.body[0].id).toBe(created.body.id);

    // 연결 안 한 점검은 그 자산 목록에 안 뜬다
    await request(app)
      .post("/api/maintenance")
      .set(auth(adminToken))
      .send({ title: "미연결", productName: "FW-01", scheduleDate: "2026-01-01" });
    const stillOne = await request(app).get("/api/assets/asset-x1/maintenance").set(auth(adminToken));
    expect(stillOne.body).toHaveLength(1);
  });

  it("creating without assetId leaves it unset", async () => {
    const res = await request(app)
      .post("/api/maintenance")
      .set(auth(adminToken))
      .send({ title: "미연결 점검", productName: "IPS-02", scheduleDate: "2026-01-01" });
    expect(res.body.assetId).toBeUndefined();
    expect(res.body.assetName).toBeUndefined();
  });

  it("byAsset for an unknown asset is empty and requires auth", async () => {
    const empty = await request(app).get("/api/assets/no-such-asset/maintenance").set(auth(adminToken));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
    expect((await request(app).get("/api/assets/x/maintenance")).status).toBe(401);
  });

  it("buildDueMaintenanceEmail summarizes due items with overdue days", () => {
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const items = [
      { id: "1", title: "방화벽 점검", productName: "FW-01", scheduleDate: today, status: "scheduled", createdAt: 0, updatedAt: 0 },
      { id: "2", title: "IPS 점검", productName: "IPS-02", scheduleDate: past, status: "scheduled", createdAt: 0, updatedAt: 0 },
    ] as MaintenanceItem[];
    const { subject, text } = buildDueMaintenanceEmail(items);
    expect(subject).toContain("2건");
    expect(text).toContain("오늘 마감");
    expect(text).toContain("3일 지연");
    expect(text).toContain("방화벽 점검");
  });

  it("notify requires recipients (400) and reports no send when nothing is due", async () => {
    // 수신자 없음 → 400
    expect((await request(app).post("/api/maintenance/notify").set(auth(adminToken)).send({ to: [] })).status).toBe(400);

    // 시드 데이터에는 지연 건이 있으나 여기선 reset 상태 — 예정(미래)만 만들어 지연 0건으로.
    await createItem({ title: "미래 점검", scheduleDate: "2099-01-01" });
    // SMTP 미설정이지만 지연 0건이면 발송 자체를 안 하므로 sent:false로 정상 반환
    const res = await request(app).post("/api/maintenance/notify").set(auth(adminToken)).send({ to: ["ops@example.com"] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: false, count: 0 });
  });

  it("notify persists recipients and 500s cleanly when SMTP is unconfigured but items are due", async () => {
    await createItem({ title: "지연 점검", scheduleDate: new Date().toISOString().slice(0, 10) });
    // SMTP 미설정 + 지연 있음 → 발송 시도하다 500(asyncRoute 격리), 서버는 계속 응답.
    const res = await request(app).post("/api/maintenance/notify").set(auth(adminToken)).send({ to: ["ops@example.com", "sec@example.com"] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/SMTP 설정이 없습니다/);
    expect((await request(app).get("/api/health")).status).toBe(200);

    // 수신자는 발송 전에 저장됐다 → 다음 조회 때 미리 채워진다.
    const cfg = await request(app).get("/api/maintenance/notify").set(auth(adminToken));
    expect(cfg.body.recipients).toEqual(["ops@example.com", "sec@example.com"]);
    expect(cfg.body.dueCount).toBeGreaterThanOrEqual(1);
  });

  it("notify requires auth", async () => {
    expect((await request(app).get("/api/maintenance/notify")).status).toBe(401);
    expect((await request(app).post("/api/maintenance/notify")).status).toBe(401);
  });

  it("requires auth", async () => {
    expect((await request(app).get("/api/maintenance")).status).toBe(401);
    expect((await request(app).post("/api/maintenance")).status).toBe(401);
  });
});
