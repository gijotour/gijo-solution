import { describe, it, expect, afterEach, vi } from "vitest";

// auth.ts's production-secret guard runs at module load time, so exercising it requires a fresh
// module instance per test (vi.resetModules() + dynamic import) rather than the static import
// every other test file uses.
describe("production JWT secret guard", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.GIJO_JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.GIJO_JWT_SECRET;
    else process.env.GIJO_JWT_SECRET = originalSecret;
    vi.resetModules();
  });

  it("refuses to load when NODE_ENV=production and GIJO_JWT_SECRET is unset (dev secret would be used)", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    delete process.env.GIJO_JWT_SECRET;

    await expect(import("../src/auth/auth")).rejects.toThrow(/GIJO_JWT_SECRET/);
  });

  it("loads fine when NODE_ENV=production and GIJO_JWT_SECRET is set", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.GIJO_JWT_SECRET = "a".repeat(64);

    await expect(import("../src/auth/auth")).resolves.toBeTruthy();
  });

  it("loads fine outside production even without GIJO_JWT_SECRET (dev default allowed)", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "test";
    delete process.env.GIJO_JWT_SECRET;

    await expect(import("../src/auth/auth")).resolves.toBeTruthy();
  });
});
