// 오래된 작업 세션을 파일로 옮기는 기능(2026-07-27 사용자 요청 "최근 100개만 보이고 파일로 저장").
// 가장 중요한 건 "파일에 다 쓴 것을 확인한 뒤에만 DB에서 지운다"는 순서다 — 뒤집히면 기록이 사라진다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-sess-"));
  process.env.GIJO_SESSION_ARCHIVE_DIR = dir;
});
afterEach(() => {
  delete process.env.GIJO_SESSION_ARCHIVE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function mod() {
  return await import("../src/engine/worksessions");
}

describe("작업 세션 파일 보관", () => {
  it("상한 이하면 아무것도 옮기지 않는다", async () => {
    const m = await mod();
    m.deleteAllSessions();
    m.createSession("하나");
    const r = m.archiveOldSessions(100);
    expect(r.archived).toBe(0);
    expect(r.file).toBeNull();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("상한을 넘으면 오래된 것부터 파일로 옮기고 최근 것만 남긴다", async () => {
    const m = await mod();
    m.deleteAllSessions();
    const made: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const s = m.createSession(`세션 ${i}`);
      m.appendTurn(s.id, "user", `내용 ${i}`);
      made.push(s.id);
      // updatedAt이 같은 밀리초에 몰리면 순서가 흔들린다 — 명시적으로 벌린다.
      await new Promise((r) => setTimeout(r, 5));
    }
    const r = m.archiveOldSessions(2);
    expect(r.archived).toBe(3);
    expect(r.remaining).toBe(2);

    // 남은 건 최근 2개
    const left = m.listSessions(100).map((s) => s.title);
    expect(left).toEqual(["세션 5", "세션 4"]);

    // 옮긴 3건은 파일에 대화까지 통째로 들어 있다
    const body = fs.readFileSync(r.file!, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(body).toHaveLength(3);
    expect(body.map((b) => b.title).sort()).toEqual(["세션 1", "세션 2", "세션 3"]);
    expect(body[0].turns[0].content).toMatch(/내용/);
  });

  it("파일을 못 쓰면 DB에서 지우지 않는다 — 기록이 사라지면 안 된다", async () => {
    const m = await mod();
    m.deleteAllSessions();
    for (let i = 1; i <= 4; i++) { m.createSession(`세션 ${i}`); await new Promise((r) => setTimeout(r, 5)); }
    // 보관 폴더 자리에 같은 이름의 파일을 둬서 mkdir을 실패시킨다.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, "폴더가 아니라 파일");
    expect(() => m.archiveOldSessions(1)).toThrow();
    expect(m.listSessions(100)).toHaveLength(4); // 하나도 안 지워졌다
    fs.rmSync(dir, { force: true });
    fs.mkdirSync(dir, { recursive: true });
  });

  // 2026-07-27 실사고: 세션을 지우면 감사 기록이 남고, 그 감사 기록이 다시 세션을 만들어
  // 목록이 줄지 않았다(제목이 "[실행] 작업 세션 삭제 — [실행] 작업 세션 삭제 — …"로 재귀).
  // 테스트 세션 2,100건을 지워도 총계가 824건 그대로였다.
  it("세션을 지워도 그 기록이 새 세션을 만들지 않는다", async () => {
    const m = await mod();
    const { recordAudit } = await import("../src/engine/audit");
    m.deleteAllSessions();
    const s = m.createSession("지울 것");
    expect(m.listSessions(100)).toHaveLength(1);

    m.deleteSession(s.id);
    // 삭제 라우트가 남기는 감사 기록과 같은 모양
    recordAudit({ kind: "write", action: "작업 세션 삭제", target: "지울 것", actor: "tester" });
    expect(m.listSessions(100)).toHaveLength(0); // 새 세션이 생기면 안 된다

    // 반대로 세션과 무관한 행위는 예전처럼 세션으로 남아야 한다(기능을 죽이지 않았는지)
    recordAudit({ kind: "write", action: "자산 등록", target: "web-01", actor: "tester" });
    expect(m.listSessions(100)).toHaveLength(1);
  });

  it("목록은 기본 상한까지만 준다", async () => {
    const m = await mod();
    m.deleteAllSessions();
    for (let i = 0; i < 7; i++) { m.createSession(`s${i}`); await new Promise((r) => setTimeout(r, 3)); }
    expect(m.listSessions(3)).toHaveLength(3);
    expect(m.listSessions(100)).toHaveLength(7);
  });
});
