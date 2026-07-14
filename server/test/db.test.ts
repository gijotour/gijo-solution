import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

// db.ts always runs under GIJO_DB_PATH=:memory: in this test suite (vitest.config.ts), which is
// correct for test isolation but never actually exercises file-backed durability. This test opens
// a real file directly (bypassing db.ts's module singleton) to prove that guarantee independently:
// data written by one process/connection is still there for the next one, which is the whole point
// of adding SQLite instead of the old in-memory Map/array state.
const TEST_DB_PATH = path.join("data", "test-persistence.sqlite");

function cleanup(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(TEST_DB_PATH + suffix, { force: true });
  }
}

afterEach(cleanup);

describe("SQLite file persistence", () => {
  it("data written by one connection is visible to a fresh connection to the same file", () => {
    cleanup();
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

    const first = new Database(TEST_DB_PATH);
    first.exec("CREATE TABLE t (id TEXT PRIMARY KEY, value TEXT)");
    first.prepare("INSERT INTO t (id, value) VALUES (?, ?)").run("k1", "v1");
    first.close();

    // simulates a server restart: a brand new connection, no shared in-process state
    const second = new Database(TEST_DB_PATH);
    const row = second.prepare("SELECT * FROM t WHERE id = ?").get("k1");
    second.close();

    expect(row).toEqual({ id: "k1", value: "v1" });
  });
});
