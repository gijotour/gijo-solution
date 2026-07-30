// 저장 암호화(at-rest) — 전환·백업·복원의 계약을 실제 파일로 확인한다.
//
// 여기서 지키려는 것:
//  · 암호화한 파일에는 평문(한글 포함)이 **바이트 수준으로** 남지 않는다
//    (⚠ latin1 문자열 비교는 한글을 놓친다 — 오늘 PoC에서 직접 틀렸던 부분)
//  · VACUUM INTO 백업은 평문 DB에서도, 암호화 DB에서도 동작한다 — 그리고
//    암호화 DB의 백업본은 **암호화된 채로** 나온다 (백업이 평문 구멍이 되면 안 된다)
//  · 열쇠 없이·틀린 열쇠로는 열리지 않는다
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createKeyFile, unsealWithMachine, toSqlcipherKey } from "../src/dbkey";

let tmp: string;
const 비밀 = "취약점-CVE-2026-9999-내부자산-웹서버01";
const 평문노출 = (p: string) => fs.readFileSync(p).includes(Buffer.from(비밀, "utf8"));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-enc-"));
  delete process.env.GIJO_DB_KEY_PATH;
});
afterEach(() => {
  delete process.env.GIJO_DB_KEY_PATH;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function 평문DB만들기(p: string): void {
  const d = new Database(p);
  d.pragma("journal_mode = WAL"); // 운영과 같은 조건
  d.exec("CREATE TABLE findings (id INTEGER PRIMARY KEY, note TEXT)");
  const ins = d.prepare("INSERT INTO findings (note) VALUES (?)");
  d.transaction(() => { ins.run(비밀); for (let i = 0; i < 500; i++) ins.run("행 " + i); })();
  d.close();
}

function 전환(p: string, keyHex: string): void {
  // encrypt-db.mjs와 같은 절차 — 저널 단순화 후 rekey
  const d = new Database(p);
  d.pragma("journal_mode=DELETE");
  d.pragma("cipher='sqlcipher'");
  d.pragma(`rekey="x'${keyHex}'"`);
  d.close();
}

function 열기(p: string, keyHex: string): InstanceType<typeof Database> {
  const d = new Database(p);
  d.pragma("cipher='sqlcipher'");
  d.pragma(`key="x'${keyHex}'"`);
  return d;
}

describe("평문 → 암호화 전환", () => {
  it("전환 후 파일에 평문이 남지 않고, SQLite 헤더도 사라진다", () => {
    const p = path.join(tmp, "db.sqlite");
    평문DB만들기(p);
    expect(평문노출(p)).toBe(true); // 전환 전 — 지금 운영의 위험

    const dbPath = path.join(tmp, "data", "gijo-as.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.renameSync(p, dbPath);
    const { dek } = createKeyFile(dbPath);
    전환(dbPath, toSqlcipherKey(dek));

    expect(평문노출(dbPath)).toBe(false);
    expect(fs.readFileSync(dbPath).subarray(0, 15).toString("latin1")).not.toBe("SQLite format 3");
  });

  it("전환 후 데이터가 전부 그대로다 — 행 수와 내용까지", () => {
    const dbPath = path.join(tmp, "data", "gijo-as.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    평문DB만들기(dbPath);
    const { dek } = createKeyFile(dbPath);
    전환(dbPath, toSqlcipherKey(dek));

    const d = 열기(dbPath, toSqlcipherKey(dek));
    expect((d.prepare("SELECT COUNT(*) c FROM findings").get() as { c: number }).c).toBe(501);
    expect((d.prepare("SELECT note FROM findings WHERE id=1").get() as { note: string }).note).toBe(비밀);
    d.close();
  });

  it("열쇠 없이도, 틀린 열쇠로도 열리지 않는다", () => {
    const dbPath = path.join(tmp, "data", "gijo-as.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    평문DB만들기(dbPath);
    const { dek } = createKeyFile(dbPath);
    전환(dbPath, toSqlcipherKey(dek));

    const 없이 = new Database(dbPath);
    expect(() => 없이.prepare("SELECT COUNT(*) c FROM findings").get()).toThrow(/not a database/);
    없이.close();

    const 틀림 = 열기(dbPath, "b".repeat(64));
    expect(() => 틀림.prepare("SELECT COUNT(*) c FROM findings").get()).toThrow(/not a database/);
    틀림.close();
  });

  it("기계 봉인에서 푼 열쇠로 다시 열 수 있다 — 서버 재시작 경로", () => {
    const dbPath = path.join(tmp, "data", "gijo-as.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    평문DB만들기(dbPath);
    const { dek } = createKeyFile(dbPath);
    전환(dbPath, toSqlcipherKey(dek));

    // db.ts 기동 경로 그대로: 파일에서 봉인 풀기 → key pragma
    const unsealed = unsealWithMachine(dbPath);
    expect(unsealed).not.toBeNull();
    const d = 열기(dbPath, toSqlcipherKey(unsealed!));
    expect((d.prepare("SELECT COUNT(*) c FROM findings").get() as { c: number }).c).toBe(501);
    d.close();
  });
});

describe("VACUUM INTO 백업 — 암호화·평문 공용 경로", () => {
  it("평문 DB에서 동작한다 (암호화 안 켠 기존 고객)", () => {
    const p = path.join(tmp, "plain.sqlite");
    평문DB만들기(p);
    const d = new Database(p);
    const out = path.join(tmp, "bk-plain.sqlite");
    d.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    d.close();
    const r = new Database(out);
    expect((r.prepare("SELECT COUNT(*) c FROM findings").get() as { c: number }).c).toBe(501);
    r.close();
  });

  it("암호화 DB의 백업본은 암호화된 채로 나온다 — 백업이 평문 구멍이 되지 않는다", () => {
    const dbPath = path.join(tmp, "data", "gijo-as.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    평문DB만들기(dbPath);
    const { dek } = createKeyFile(dbPath);
    전환(dbPath, toSqlcipherKey(dek));

    const d = 열기(dbPath, toSqlcipherKey(dek));
    const out = path.join(tmp, "bk-enc.sqlite");
    d.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    d.close();

    expect(평문노출(out)).toBe(false); // 핵심 — 백업본에 평문이 없다
    const r = 열기(out, toSqlcipherKey(dek));
    expect((r.prepare("SELECT COUNT(*) c FROM findings").get() as { c: number }).c).toBe(501);
    r.close();
  });

  it("경로에 작은따옴표가 있어도 안전하다 — VACUUM INTO는 문자열 연결이라 이스케이프 필수", () => {
    const p = path.join(tmp, "plain2.sqlite");
    평문DB만들기(p);
    const d = new Database(p);
    const out = path.join(tmp, "bk'quote.sqlite"); // 백업 폴더명을 담당자가 바꿀 수 있다
    d.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    d.close();
    expect(fs.existsSync(out)).toBe(true);
  });
});
