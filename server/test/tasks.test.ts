import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetTasksForTests } from "../src/engine/tasks";

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

  it("requires auth", async () => {
    expect((await request(app).get("/api/tasks")).status).toBe(401);
    expect((await request(app).delete("/api/tasks/x")).status).toBe(401);
  });
});
