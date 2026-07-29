import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-backup-"));
process.env.GIJO_BACKUP_DIR = tmp;
process.env.GIJO_BACKUP_KEEP = "3";
process.env.GIJO_MEMORY_DB_PATH = path.join(tmp, "no-lance"); // 없음 → LanceDB 미포함 경로 확인

const { performBackup, backupOverdue } = await import("../src/engine/backup");

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

// [전중후 계획서 정렬: 후-1 GA 잔여 P0] 자가 진단이 잡은 실사고 고정(2026-07-29):
// setInterval만 걸어 두면 첫 백업이 24시간 뒤라, 그보다 자주 재시작되는 운영 서버에는
// 백업이 영원히 생기지 않는다 — 실제로 엿새 동안 스냅샷이 0개였다(폴더도 없었다).
describe("자동 백업 — 기동 직후 밀린 백업 확인", () => {
  it("스냅샷이 하나도 없으면 밀린 것으로 본다", () => {
    // 앞 시험들이 만든 스냅샷을 비운다 — 이 검사의 전제는 "한 번도 백업하지 않은 상태"다.
    for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".sqlite"))) fs.rmSync(path.join(tmp, f), { force: true });
    expect(backupOverdue()).toBe(true);
  });

  it("방금 백업했으면 밀리지 않은 것 — 재시작이 잦아도 백업 폭풍이 나지 않는다", async () => {
    await performBackup();
    expect(backupOverdue()).toBe(false);
  });
});
