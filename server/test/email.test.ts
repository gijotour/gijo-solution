import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.token as string;
}

describe("email", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const originalSmtpHost = process.env.GIJO_SMTP_HOST;

  beforeEach(async () => {
    delete process.env.GIJO_SMTP_HOST;
    app = createApp();
    token = await login(app);
  });

  afterEach(() => {
    if (originalSmtpHost === undefined) delete process.env.GIJO_SMTP_HOST;
    else process.env.GIJO_SMTP_HOST = originalSmtpHost;
  });

  it("fails cleanly (500, not a crash) when no SMTP server is configured", async () => {
    const res = await request(app)
      .post("/api/email/sendReport")
      .set("Authorization", `Bearer ${token}`)
      .send({ to: ["ops@example.com"], subject: "test", attachmentPath: "reports/x.docx" });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/GIJO_SMTP_HOST/);

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });
});
