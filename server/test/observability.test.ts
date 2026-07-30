// 자가 진단 (계획서 후-1 "GA 잔여 P0 — 관측성").
// [전중후 계획서 정렬] 지키는 것: 조용한 고장을 드러낸다 · 모르는 것을 정상으로 세지 않는다 ·
// 경고에는 무엇을 하면 되는지가 함께 온다(행동 없는 경고는 불안만 준다).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { db } from "../src/db";
import { systemHealth, systemHealthText } from "../src/engine/observability";

let tmp: string;
const origBackupDir = process.env.GIJO_BACKUP_DIR;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-obs-"));
  process.env.GIJO_BACKUP_DIR = path.join(tmp, "backups");
  db.exec("DELETE FROM audit_log");
});

afterEach(() => {
  if (origBackupDir === undefined) delete process.env.GIJO_BACKUP_DIR;
  else process.env.GIJO_BACKUP_DIR = origBackupDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ⚠ 예전에는 `fs.writeFileSync(f, "x")`로 백업을 흉내냈다. 그때는 검사가 파일 존재·시각만
//   봤으니 통했지만, **한 글자 파일은 복구 가능한 백업이 아니다** — 이제 자가 진단이 스냅샷을
//   실제로 열어 보므로(2026-07-30) 진짜 스냅샷을 만들어야 시험이 재려던 것을 잰다.
//   가짜 fixture에 맞춰 제품 검사를 무르게 하는 것이 아니라, fixture를 현실로 맞춘다.
async function makeBackup(ageHours: number) {
  const dir = path.join(tmp, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const base = `gijo-as-snap-${ageHours}`;
  const f = path.join(dir, `${base}.sqlite`);
  await db.backup(f); // 실제 SQLite 스냅샷(무결성·필수 표가 들어 있다)
  // 짝 지식베이스 폴더 — 없으면 "복원 시 지식 검색이 빈 상태"로 경고가 뜬다.
  const lance = path.join(dir, `${base}.lancedb`);
  fs.mkdirSync(lance, { recursive: true });
  fs.writeFileSync(path.join(lance, "data.lance"), "vector-store-stub");
  const t = Date.now() - ageHours * 3600000;
  fs.utimesSync(f, t / 1000, t / 1000);
}

describe("자가 진단", () => {
  it("백업이 없으면 실패로 잡고 무엇을 하면 되는지 알려준다", () => {
    const h = systemHealth();
    const b = h.checks.find((c) => c.id === "backup")!;
    expect(b.level).toBe("fail");
    expect(b.action).toBeTruthy(); // 행동 없는 경고는 불안만 준다
    expect(h.level).toBe("fail");
  });

  it("최근 백업이 있으면 정상", async () => {
    await makeBackup(2);
    expect(systemHealth().checks.find((c) => c.id === "backup")!.level).toBe("ok");
  });

  it("백업이 이틀 넘게 안 돌면 경고, 사흘 넘으면 실패 — 자동 백업이 멈춘 것을 잡는다", async () => {
    await makeBackup(60);
    expect(systemHealth().checks.find((c) => c.id === "backup")!.level).toBe("warn");
    fs.rmSync(path.join(tmp, "backups"), { recursive: true, force: true });
    await makeBackup(80);
    expect(systemHealth().checks.find((c) => c.id === "backup")!.level).toBe("fail");
  });

  it("전체 판정은 가장 나쁜 항목을 따른다 — 문제 하나가 정상 넷에 묻히지 않는다", async () => {
    await makeBackup(2); // 백업은 정상
    const h = systemHealth();
    // 지식베이스·DB 등 다른 항목 중 하나라도 나쁘면 전체가 그 등급이어야 한다
    const worst = h.checks.some((c) => c.level === "fail") ? "fail"
      : h.checks.some((c) => c.level === "warn") ? "warn"
        : h.checks.some((c) => c.level === "unknown") ? "unknown" : "ok";
    expect(h.level).toBe(worst);
  });

  it("24시간 내 오류가 있으면 드러낸다 — 차단은 오류가 아니다", async () => {
    await makeBackup(2);
    const ins = db.prepare("INSERT INTO audit_log (id, at, kind, actor, action, target, detail, result) VALUES (?,?,?,?,?,?,?,?)");
    ins.run("e1", Date.now(), "write", "t", "실패한 작업", null, null, "error");
    ins.run("b1", Date.now(), "config", "t", "권한 차단", null, null, "blocked");
    const e = systemHealth().checks.find((c) => c.id === "errors")!;
    expect(e.level).toBe("warn");
    expect(e.detail).toContain("오류 1건");
    expect(e.action).toBeTruthy();
  });

  it("요약문은 결론과 조치 안내를 함께 낸다", () => {
    const t = systemHealthText();
    expect(t).toContain("자가 진단");
    expect(t).toContain("백업");
    expect(t).toMatch(/→ /); // 문제 항목엔 조치 안내가 붙는다
  });
});
