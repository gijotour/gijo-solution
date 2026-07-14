import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // in-memory SQLite for tests (db.ts) — no data/gijo-as.sqlite file left behind, and each
    // test worker gets its own isolated DB just like the old in-memory Map/array state did.
    // Fixed dummy key so cryptopack.ts never touches data/encryption.key during tests.
    env: { GIJO_DB_PATH: ":memory:", GIJO_ENCRYPTION_KEY: "0".repeat(64) },
  },
});
