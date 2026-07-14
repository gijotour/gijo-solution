import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

afterEach(() => {
  delete process.env.GIJO_CORS_ORIGINS;
});

describe("cors", () => {
  it("allows any origin when GIJO_CORS_ORIGINS is unset (default dev/single-desktop behavior)", async () => {
    delete process.env.GIJO_CORS_ORIGINS;
    const app = createApp();

    const res = await request(app).get("/api/health").set("Origin", "http://some-random-site.example");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("only reflects an origin present in GIJO_CORS_ORIGINS", async () => {
    process.env.GIJO_CORS_ORIGINS = "http://192.168.1.10:4000, http://192.168.1.11:4000";
    const app = createApp();

    const allowed = await request(app).get("/api/health").set("Origin", "http://192.168.1.10:4000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://192.168.1.10:4000");

    const blocked = await request(app).get("/api/health").set("Origin", "http://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
