import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-backup-"));
process.env.GIJO_BACKUP_DIR = tmp;
process.env.GIJO_BACKUP_KEEP = "3";
process.env.GIJO_MEMORY_DB_PATH = path.join(tmp, "no-lance"); // 없음 → LanceDB 미포함 경로 확인

const { performBackup } = await import("../src/engine/backup");

describe("자동 백업 + 보관정책", () => {
  it("백업을 만들고 최근 KEEP개만 남긴다", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await performBackup();
      expect(r.file).toMatch(/^gijo-as-.*\.sqlite$/);
      expect(r.sizeBytes).toBeGreaterThan(0);
      await new Promise((res) => setTimeout(res, 15)); // 타임스탬프 구분
    }
    const snaps = fs.readdirSync(tmp).filter((f) => f.endsWith(".sqlite"));
    expect(snaps.length).toBe(3); // KEEP=3
  });

  it("LanceDB 폴더가 없으면 lanceIncluded=false", async () => {
    const r = await performBackup();
    expect(r.lanceIncluded).toBe(false);
  });
});
