import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-backup-"));
process.env.GIJO_BACKUP_DIR = tmp;
process.env.GIJO_BACKUP_KEEP = "3";
process.env.GIJO_MEMORY_DB_PATH = path.join(tmp, "no-lance"); // 없음 → LanceDB 미포함 경로 확인
// ⚠ 인입 뿌리도 **이 시험만의 임시 폴더**로 가른다(2026-09-10 검토관 적발 — 전체 시험 1회차 간헐 실패).
//   performBackup은 `<GIJO_INGEST_ROOT>/docs`를 통째로 복사하는데, 기본값은 시험 전체가 함께 쓰는
//   `data/test-tmp/ingest`다(vitest.config.ts). 다른 시험 파일이 그 폴더에 파일을 쓰는 중에 복사가
//   걸리면 `fs.promises.cp`가 ENOENT로 죽는다 — 이 파일과 아무 상관 없는 이유로 관문이 빨개진다.
process.env.GIJO_INGEST_ROOT = path.join(tmp, "ingest");

const { performBackup, backupOverdue, verifyBackupSnapshot } = await import("../src/engine/backup");

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

// [후-1 GA 잔여 P0] **"백업이 있다"와 "그 백업으로 복구된다"는 다른 말이다.**
// 여기까지 제품은 파일 존재와 만든 시각만 봤다 — 0바이트여도, 잘려도, 계정 표가 비어도
// "백업 정상"으로 통과했다. 재해가 난 뒤에 처음 알게 되는 종류의 결함이라 평소에 확인한다.
describe("복원 가능성 검증", () => {
  function clearSnaps(): void {
    for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
  }

  it("정상 스냅샷은 통과하고 필수 표 행 수를 알려준다", async () => {
    clearSnaps();
    const made = await performBackup();
    const v = verifyBackupSnapshot();
    expect(v.file).toBe(made.file);
    expect(v.integrity).toBe("ok");
    expect(v.tables.users).toBeGreaterThan(0); // 계정이 있어야 복원 후 로그인이 된다
    expect(v.schemaLatest).toBeTruthy();
    expect(v.restoreSteps.length).toBeGreaterThan(3); // 절차를 함께 준다(가이드를 못 찾아도 보이게)
  });

  it("스냅샷이 없으면 정직하게 문제로 보고한다(정상으로 세지 않는다)", () => {
    clearSnaps();
    const v = verifyBackupSnapshot();
    expect(v.ok).toBe(false);
    expect(v.file).toBeNull();
    expect(v.problems.join(" ")).toMatch(/없습니다/);
  });

  it("0바이트 스냅샷을 정상으로 세지 않는다", () => {
    clearSnaps();
    fs.writeFileSync(path.join(tmp, "gijo-as-2026-01-01T00-00-00-000Z.sqlite"), "");
    const v = verifyBackupSnapshot();
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("0바이트"))).toBe(true);
  });

  it("⚠ 손상된 스냅샷을 잡는다 — 이게 이 검증의 존재 이유다", () => {
    clearSnaps();
    // SQLite 헤더만 그럴듯하고 내용은 쓰레기인 파일(잘린 백업의 전형).
    const broken = Buffer.concat([Buffer.from("SQLite format 3\0", "binary"), Buffer.alloc(200, 0x7a)]);
    fs.writeFileSync(path.join(tmp, "gijo-as-2026-01-02T00-00-00-000Z.sqlite"), broken);
    const v = verifyBackupSnapshot();
    expect(v.ok).toBe(false);
    // 손상 자체를 잡거나(integrity), 최소한 필수 표가 없다고 잡아야 한다.
    expect(v.problems.length).toBeGreaterThan(0);
    expect(v.integrity === "ok").toBe(false);
  });

  it("짝 지식베이스(.lancedb)가 빠지면 문제로 알린다 — 복원해도 지식 검색이 빈 상태가 된다", async () => {
    clearSnaps();
    await performBackup(); // 이 시험 환경은 LanceDB 폴더가 없다(GIJO_MEMORY_DB_PATH=no-lance)
    const v = verifyBackupSnapshot();
    expect(v.lanceIncluded).toBe(false);
    expect(v.problems.some((p) => p.includes("지식베이스"))).toBe(true);
    expect(v.ok).toBe(false);
  });

  // ⚠ 백업 폴더는 재해복구의 마지막 자리다 — 검증이 거기에 무엇도 쓰면 안 된다.
  //   처음 구현은 스냅샷을 readonly로 직접 열었는데, WAL 모드 DB는 그래도 곁에 -shm/-wal을
  //   만든다(2026-07-30 운영 실측에서 발견). 크기·mtime만 보는 시험은 이걸 놓쳤다.
  it("검증은 백업 폴더에 파일 하나도 만들지 않는다(-wal·-shm 포함)", async () => {
    clearSnaps();
    const made = await performBackup();
    const p = path.join(tmp, made.file);
    const before = fs.statSync(p);
    const filesBefore = fs.readdirSync(tmp).sort();

    verifyBackupSnapshot();
    verifyBackupSnapshot();

    const after = fs.statSync(p);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    // 목록이 **정확히 같아야** 한다 — 부수 파일이 하나도 늘지 않았다는 뜻이다.
    expect(fs.readdirSync(tmp).sort()).toEqual(filesBefore);
  });

  it("복구를 막지 않는 것은 problems가 아니라 notes로 낸다 — 늘 노랑이면 아무도 안 본다", async () => {
    clearSnaps();
    await performBackup();
    const v = verifyBackupSnapshot();
    // 이 시험 환경은 LanceDB가 없어 problems에 그 항목이 있다. 스키마는 지금 코드와 같다.
    // ⚠ notes를 빈 배열로 못박지 않는다(2026-08-21 정정) — D 계열 수리가 「세션 아카이브
    //   없음 — 정상」 note를 추가했는데, 그것이 정확히 이 시험의 취지(정상은 problems가
    //   아니라 notes로)다. 잣대는 「복구를 막지 않는 항목이 problems에 없다」이다.
    expect(v.schemaMatchesNow).toBe(true);
    expect(Array.isArray(v.notes)).toBe(true);
    expect(v.problems.join("\n")).not.toContain("정상입니다");
    for (const n of v.notes) expect(n).toMatch(/정상|확인하지 못했/); // notes에는 비차단 항목만
  });
});
