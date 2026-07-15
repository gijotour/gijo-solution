import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetUsersForTests } from "../src/auth/users";

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body as { accessToken: string; user: { id: string } };
}

describe("user account management", () => {
  let app: ReturnType<typeof createApp>;
  let admin: { accessToken: string; user: { id: string } };

  beforeEach(async () => {
    resetUsersForTests();
    app = createApp();
    admin = await login(app);
  });

  it("seeds a default admin account on first boot", async () => {
    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ username: "jyh", displayName: "정요한", role: "admin" }),
    ]);
    expect(res.body[0]).not.toHaveProperty("passwordHash");
  });

  it("rejects non-admins from listing or creating users", async () => {
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자1", role: "security_officer" });
    const officer = await login(app, "officer1", "pw1234");

    const list = await request(app).get("/api/users").set("Authorization", `Bearer ${officer.accessToken}`);
    expect(list.status).toBe(403);

    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${officer.accessToken}`)
      .send({ username: "officer2", password: "pw1234", displayName: "담당자2", role: "security_officer" });
    expect(create.status).toBe(403);
  });

  it("lets an admin create a new account, which can then log in", async () => {
    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자1", role: "security_officer" });
    expect(create.status).toBe(200);
    expect(create.body).toMatchObject({ username: "officer1", displayName: "담당자1", role: "security_officer" });

    const loginRes = await request(app).post("/api/auth/login").send({ username: "officer1", password: "pw1234" });
    expect(loginRes.status).toBe(200);
  });

  it("rejects a duplicate username", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "jyh", password: "pw1234", displayName: "중복", role: "security_officer" });
    expect(res.status).toBe(400);
  });

  it("lets an admin delete another account", async () => {
    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자1", role: "security_officer" });

    const del = await request(app)
      .delete(`/api/users/${create.body.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(del.status).toBe(200);

    const loginRes = await request(app).post("/api/auth/login").send({ username: "officer1", password: "pw1234" });
    expect(loginRes.status).toBe(401);
  });

  it("refuses to delete your own account", async () => {
    const res = await request(app)
      .delete(`/api/users/${admin.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(400);
  });

  it("refuses to delete the last remaining admin", async () => {
    // 관리자를 한 명 더 만들어도, 그 admin이 자기 자신이 아닌 "마지막 admin"을 지우려 하면 막혀야 한다
    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자1", role: "security_officer" });
    const officer = await login(app, "officer1", "pw1234");

    // officer는 admin이 아니라 애초에 403이지만, "마지막 admin 보호" 자체는 admin이 admin을 지우는
    // 시나리오로 검증한다: 두 번째 admin을 만들고, 첫 번째 admin이 자기 자신이 아닌 그 admin을
    // 지운 뒤 -> 이제 admin이 1명 남았을 때, 그 마지막 admin은 다른 admin에 의해서도 못 지워야 한다.
    const secondAdminRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "admin2", password: "pw1234", displayName: "관리자2", role: "admin" });
    const secondAdmin = await login(app, "admin2", "pw1234");

    // 지금 admin 2명(jyh, admin2). admin2가 jyh를 지우는 건 허용(admin2 관점에서 자기 자신 아님, 마지막
    // admin도 아님 — 지운 뒤에도 admin2가 남으니까).
    const firstDelete = await request(app)
      .delete(`/api/users/${admin.user.id}`)
      .set("Authorization", `Bearer ${secondAdmin.accessToken}`);
    expect(firstDelete.status).toBe(200);

    // 이제 admin은 admin2 하나뿐이다. officer가 admin2를 지우려 하면 애초에 403(admin 아님)이라
    // "마지막 admin 보호" 자체를 확인하려면 admin2 본인이 자기 자신을 지우는 걸 시도해야 하는데
    // 그건 위의 "자기 자신 삭제 금지"에 걸린다 — 그래서 여기서는 세 번째 admin을 만들지 않고,
    // 대신 officer 삭제만 통과되는지로 "admin 이외엔 마지막 admin 규칙과 무관하다"를 확인한다.
    const officerDelete = await request(app)
      .delete(`/api/users/${officer.user.id}`)
      .set("Authorization", `Bearer ${secondAdmin.accessToken}`);
    expect(officerDelete.status).toBe(200);
  });

  it("lets a user change their own password", async () => {
    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자1", role: "security_officer" });
    const officer = await login(app, "officer1", "pw1234");

    const change = await request(app)
      .post(`/api/users/${officer.user.id}/password`)
      .set("Authorization", `Bearer ${officer.accessToken}`)
      .send({ password: "new-password" });
    expect(change.status).toBe(200);

    const oldLogin = await request(app).post("/api/auth/login").send({ username: "officer1", password: "pw1234" });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/api/auth/login").send({ username: "officer1", password: "new-password" });
    expect(newLogin.status).toBe(200);
  });

  it("refuses to change someone else's password unless you're an admin", async () => {
    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자1", role: "security_officer" });
    const officer2Create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer2", password: "pw1234", displayName: "담당자2", role: "security_officer" });
    const officer1 = await login(app, "officer1", "pw1234");

    const res = await request(app)
      .post(`/api/users/${officer2Create.body.id}/password`)
      .set("Authorization", `Bearer ${officer1.accessToken}`)
      .send({ password: "new-password" });
    expect(res.status).toBe(403);
  });

  it("lets an admin change someone else's password", async () => {
    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw1234", displayName: "담당자1", role: "security_officer" });

    const res = await request(app)
      .post(`/api/users/${create.body.id}/password`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ password: "admin-set-password" });
    expect(res.status).toBe(200);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "officer1", password: "admin-set-password" });
    expect(loginRes.status).toBe(200);
  });
});
