import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetTasksForTests, createTask, listTasks, completeTask } from "../src/engine/tasks";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("tasks (오늘 확인할 항목)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    resetTasksForTests();
    app = createApp();
    token = await login(app);
  });

  async function addTask(text: string) {
    const res = await request(app).post("/api/tasks").set(auth()).send({ text });
    return res.body.id as string;
  }

  it("adds and lists a task (not done by default)", async () => {
    await addTask("방화벽 룰 점검");
    const list = await request(app).get("/api/tasks").set(auth());
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ text: "방화벽 룰 점검", done: false });
  });

  it("toggles a task done and back to open", async () => {
    const id = await addTask("로그 백업 확인");
    const done = await request(app).post(`/api/tasks/${id}/toggle`).set(auth()).send({ done: true });
    expect(done.body.find((t: { id: string }) => t.id === id).done).toBe(true);

    const reopen = await request(app).post(`/api/tasks/${id}/toggle`).set(auth()).send({ done: false });
    expect(reopen.body.find((t: { id: string }) => t.id === id).done).toBe(false);
  });

  it("deletes a task", async () => {
    const id1 = await addTask("계정 권한 검토");
    const id2 = await addTask("패치 적용");
    const afterDelete = await request(app).delete(`/api/tasks/${id1}`).set(auth());
    expect(afterDelete.body).toHaveLength(1);
    expect(afterDelete.body[0].id).toBe(id2);

    const list = await request(app).get("/api/tasks").set(auth());
    expect(list.body.map((t: { id: string }) => t.id)).toEqual([id2]);
  });

  it("complete endpoint still marks done (dispatcher 경로 호환)", async () => {
    const id = await addTask("취약점 스캔");
    const res = await request(app).post(`/api/tasks/${id}/complete`).set(auth());
    expect(res.body.find((t: { id: string }) => t.id === id).done).toBe(true);
  });

  it("stores SLA(dueAt)/assignee/ref when creating a remediation task", async () => {
    const due = Date.now() + 7 * 86400000;
    const res = await request(app)
      .post("/api/tasks")
      .set(auth())
      .send({ text: "[조치] Log4Shell — oracle.local", priority: "P0", dueAt: due, assignee: "김보안", ref: "vuln:192.168.219.98" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ priority: "P0", dueAt: due, assignee: "김보안", ref: "vuln:192.168.219.98" });

    const list = await request(app).get("/api/tasks").set(auth());
    expect(list.body[0]).toMatchObject({ dueAt: due, assignee: "김보안", ref: "vuln:192.168.219.98" });
  });

  it("rejects empty text and ignores an invalid priority", async () => {
    expect((await request(app).post("/api/tasks").set(auth()).send({ text: "  " })).status).toBe(400);
    const ok = await request(app).post("/api/tasks").set(auth()).send({ text: "일반 할일", priority: "P9" });
    expect(ok.body.priority).toBe("P2"); // 잘못된 우선순위는 기본값
  });

  it("requires auth", async () => {
    expect((await request(app).get("/api/tasks")).status).toBe(401);
    expect((await request(app).delete("/api/tasks/x")).status).toBe(401);
  });

  // 실사고(2026-07-28): 지시 한 건마다 디스패처가 만드는 '실행 기록'이 같은 표에 들어가는데
  // 화면의 "오늘 할 일"이 그것까지 보여 줬다. 운영 DB에 1,688건이 쌓여 "대한민국 수도가
  // 어디야?" 같은 챗봇 질문이 할 일로 보였고, 정작 할 일이 그 밑에 파묻혔다.
  // 구분자는 agentId — 디스패처만 채우고 사람이 만드는 할 일에는 없다.
  it("에이전트 실행 기록은 '오늘 할 일'에 안 섞인다 (agentId로 가른다)", async () => {
    await addTask("방화벽 룰 점검");                                    // 사람이 적은 할 일
    createTask({ text: "대한민국 수도가 어디야?", agentId: "orchestrator" }); // 지시 실행 기록

    // 화면이 받는 목록 — 사람 할 일만
    const list = await request(app).get("/api/tasks").set(auth());
    expect(list.body).toHaveLength(1);
    expect(list.body[0].text).toBe("방화벽 룰 점검");

    // 기록 자체는 지워지지 않는다 — 필요한 쪽은 켜서 본다
    expect(listTasks({ includeAgentRuns: true })).toHaveLength(2);
  });

  // 디스패처는 completeTask가 돌려준 목록에서 방금 만든 자기 기록을 되찾아 응답에 싣는다.
  // 여기서 걸러 버리면 못 찾아 "완료 안 됨"으로 응답한다 — 그래서 이 함수만 전부 돌려준다.
  it("completeTask는 실행 기록도 돌려준다 (디스패처가 자기 건을 되찾는다)", async () => {
    const run = createTask({ text: "지시 실행", agentId: "orchestrator" });
    const updated = completeTask(run.id);
    const found = updated.find((t) => t.id === run.id);
    expect(found).toBeDefined();
    expect(found!.done).toBe(true);
  });
});
