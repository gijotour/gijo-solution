import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetSmtpConfigForTests } from "../src/engine/email";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("email", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetSmtpConfigForTests();
    app = createApp();
    token = await login(app);
  });

  it("fails cleanly (500, not a crash) when no SMTP server is configured", async () => {
    const res = await request(app)
      .post("/api/email/sendReport")
      .set("Authorization", `Bearer ${token}`)
      .send({ to: ["ops@example.com"], subject: "test", attachmentPath: "reports/x.docx" });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/SMTP 설정이 없습니다/);

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });

  it("GET /api/email/config returns null before anything is configured", async () => {
    const res = await request(app).get("/api/email/config").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("saves SMTP config and never returns the password back", async () => {
    const res = await request(app)
      .post("/api/email/config")
      .set("Authorization", `Bearer ${token}`)
      .send({ host: "smtp.example.com", port: 587, secure: false, user: "gijo@example.com", password: "sk-super-secret", fromAddress: "gijo-as@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "gijo@example.com",
      hasPassword: true,
      fromAddress: "gijo-as@example.com",
    });

    const getRes = await request(app).get("/api/email/config").set("Authorization", `Bearer ${token}`);
    expect(getRes.body.hasPassword).toBe(true);
    expect(getRes.body).not.toHaveProperty("password");
  });

  it("keeps the existing password when re-saving other fields without a new one", async () => {
    await request(app)
      .post("/api/email/config")
      .set("Authorization", `Bearer ${token}`)
      .send({ host: "smtp.example.com", port: 587, secure: false, user: "gijo@example.com", password: "sk-super-secret", fromAddress: "gijo-as@example.com" });

    const res = await request(app)
      .post("/api/email/config")
      .set("Authorization", `Bearer ${token}`)
      .send({ host: "smtp2.example.com", port: 465, secure: true, user: "gijo@example.com", fromAddress: "gijo-as@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.host).toBe("smtp2.example.com");
    expect(res.body.hasPassword).toBe(true); // 비밀번호를 안 보냈으니 기존 값 유지
  });
});
