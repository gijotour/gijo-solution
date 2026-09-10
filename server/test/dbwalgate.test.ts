// 저장 암호화 전환은 **서버가 멈춘 뒤에만** — 경고가 아니라 중단이어야 한다.
//
// ■ 실사고(2026-09-10 고객 QA ⓑ 인스턴스): scripts/encrypt-db.mjs가 「⚠ -wal 파일에 내용이
//   있습니다」라고 적고 **그대로 전환**했다. 서버가 살아 있었고, 스크립트가 WAL을 본 파일로
//   합친 뒤에도 서버가 계속 썼다 — 그 뒤에 쓴 것은 rekey 대상 밖이라 docsbundle 상태 2행이
//   흘렀고, 다음 기동에서 문서 2건이 다시 인입됐다.
//
// ■ ⚠ 「WAL을 합쳐 보고 크기를 다시 재기」로는 못 가른다. 아래 첫 시험이 그 사실을 실제로 못박는다:
//   상대 연결이 놀고 있으면 체크포인트가 **성공**한다(busy=0 · -wal 0바이트). 그래서 판정의
//   마지막은 **배타 잠금을 실제로 잡아 보는 것**이다.
//
// ⚠ 진짜 파일·진짜 pragma로 잰다(dbencrypt.test와 같은 방식). 폴백 문구를 정상으로 세지 않는다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { 데이터베이스가조용한가 } from "../src/util/walgate";

let tmp: string;
let dbPath: string;

function 운영처럼만들기(): InstanceType<typeof Database> {
  const d = new Database(dbPath);
  d.pragma("journal_mode = WAL"); // 운영과 같은 조건
  d.exec("CREATE TABLE docsbundle (id INTEGER PRIMARY KEY, hash TEXT)");
  const ins = d.prepare("INSERT INTO docsbundle (hash) VALUES (?)");
  d.transaction(() => { for (let i = 0; i < 200; i++) ins.run("h" + i); })();
  return d;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-wal-"));
  dbPath = path.join(tmp, "gijo-as.sqlite");
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("전환 관문 — 「나 혼자 쓰고 있나」", () => {
  it("★ 서버가 열어만 두고 놀고 있어도 **막는다** — 그날 흘린 2행이 이 자리에서 났다", () => {
    const 서버 = 운영처럼만들기(); // 열어 두고 아무것도 안 한다(= 유휴 중인 운영 서버)
    try {
      const r = 데이터베이스가조용한가(dbPath);
      expect(r.ok, "체크포인트만 보면 여기가 「깨끗함」으로 통과한다 — 그게 사고의 모양이었다").toBe(false);
      expect(r.이유).toContain("서버");
    } finally {
      서버.close();
    }
  });

  it("⚠ 위 상황에서 체크포인트는 성공한다 — 그래서 「-wal 다시 재기」가 잣대가 못 된다(반증)", () => {
    const 서버 = 운영처럼만들기();
    try {
      const d = new Database(dbPath);
      const rows = d.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy?: number }>;
      d.close();
      const wal = dbPath + "-wal";
      expect(Number(rows[0]?.busy ?? 0), "놀고 있는 연결은 체크포인트를 안 막는다").toBe(0);
      expect(fs.existsSync(wal) ? fs.statSync(wal).size : 0, "합친 뒤라 0바이트다 — 여기서 통과시키면 사고가 난다").toBe(0);
    } finally {
      서버.close();
    }
  });

  it("다른 연결이 **쓰는 중**이면 막는다", () => {
    const 서버 = 운영처럼만들기();
    서버.exec("BEGIN IMMEDIATE");
    서버.prepare("INSERT INTO docsbundle (hash) VALUES (?)").run("전환 중에 쓴 행");
    try {
      const r = 데이터베이스가조용한가(dbPath);
      expect(r.ok).toBe(false);
      expect(r.이유).toContain("멈춘");
    } finally {
      서버.exec("ROLLBACK");
      서버.close();
    }
  });

  it("★ 서버를 닫으면 통과한다 — 관문이 과하면 올인원 고객이 암호화를 영영 못 켠다", () => {
    const 서버 = 운영처럼만들기();
    서버.close(); // 올인원 「암호화 켜기」 단추의 정상 경로(서버를 죽이고 3초 뒤)
    const r = 데이터베이스가조용한가(dbPath);
    expect(r.ok, "이 자리가 막히면 고객은 암호화를 켤 길이 없다").toBe(true);
    expect(r.이유).toBeTruthy();
  });

  it("서버가 닫힌 뒤 -wal에 내용이 남아 있어도 통과한다 — 합쳐서 살릴 수 있는 상태다", () => {
    const 서버 = 운영처럼만들기();
    서버.prepare("INSERT INTO docsbundle (hash) VALUES (?)").run("종료 직전에 쓴 행");
    서버.close();
    const r = 데이터베이스가조용한가(dbPath);
    expect(r.ok).toBe(true);
  });

  it("아무것도 못 재면 통과시키지 않는다 — 되돌리기 어려운 도구라 모호하면 막는다", () => {
    const r = 데이터베이스가조용한가(path.join(tmp, "없는-폴더", "없는.sqlite"));
    expect(r.ok).toBe(false);
  });
});

describe("★ 전환 스크립트가 그 관문을 실제로 문다", () => {
  const 스크립트 = fs.readFileSync(path.join(__dirname, "..", "scripts", "encrypt-db.mjs"), "utf8");

  it("관문을 부르고, 실패하면 **멈춘다**(경고만 하고 진행하지 않는다)", () => {
    expect(스크립트).toContain("데이터베이스가조용한가");
    expect(스크립트, "판정을 받고 그냥 지나가면 고친 게 없다").toMatch(/if \(!.*\.ok\) fail\(/);
  });

  it("반증 — 「경고만 하고 계속 간다」던 옛 문구는 사라졌다", () => {
    expect(스크립트).not.toContain("서버가 완전히 멈췄는지 다시 확인하세요.\");");
  });

  it("관문은 **백업보다 앞**이다 — 아무것도 안 바꾼 상태에서 멈춰야 되돌릴 것이 없다", () => {
    expect(스크립트.indexOf("데이터베이스가조용한가")).toBeLessThan(스크립트.indexOf("① 전환 전 백업 완료"));
  });

  it("판정 도구는 dist로 나간다 — .mjs를 새로 만들면 고객 설치본에서 통째로 죽는 계보가 있다", () => {
    expect(스크립트, "src/util/*.ts는 dist/가 통째로 복사돼 출하 목록에 손댈 일이 없다").toContain("dist/util/walgate.js");
    expect(fs.existsSync(path.join(__dirname, "..", "src", "util", "walgate.ts"))).toBe(true);
  });
});

// ── 2026-09-10 검토관 적발 짝 시험 ────────────────────────────────────────────
// ① 짝 도구(암호화 끄기)에도 같은 관문이 물려 있나 ② 암호화된 DB를 **열쇠 없이** 재면 어떻게 되나
//   ③ 관문이 「아무것도 안 바꾼다」던 말이 사실이 아니었다는 것(정직 기록).

describe("암호화된 DB — 열쇠를 들고 재야 한다", () => {
  /** 임시 DB를 sqlcipher로 봉인한다 — 순서는 제품(scripts/encrypt-db.mjs)과 같게 맞춘다. */
  function 암호화해두기(열쇠hex: string): void {
    const d = 운영처럼만들기();
    d.pragma("journal_mode=DELETE"); // WAL에서는 rekey를 못 한다(제품도 이 순서다)
    d.pragma("cipher='sqlcipher'");
    d.pragma(`rekey="x'${열쇠hex}'"`);
    d.close();
    // 운영과 같은 조건으로 되돌린다 — 관문이 보는 것은 WAL 모드의 DB다.
    const e = new Database(dbPath);
    e.pragma("cipher='sqlcipher'");
    e.pragma(`key="x'${열쇠hex}'"`);
    e.pragma("journal_mode=WAL");
    e.close();
  }
  const 열쇠 = "ab".repeat(32); // 64바이트 hex(32바이트 열쇠)

  it("★ 열쇠 없이 재면 늘 막힌다 — 그대로 갖다 쓰면 고객이 암호화를 영영 못 끈다", () => {
    암호화해두기(열쇠);
    const r = 데이터베이스가조용한가(dbPath);
    expect(r.ok).toBe(false);
    expect(r.이유, "「서버를 멈추세요」는 아무리 멈춰도 안 되는 안내다 — 열쇠 이야기를 해야 한다").toContain("열쇠");
  });

  it("열쇠를 주면 아무도 안 쓰고 있을 때 통과한다", () => {
    암호화해두기(열쇠);
    const r = 데이터베이스가조용한가(dbPath, 열쇠);
    expect(r.ok, "암호화 끄기가 이 자리에서 막히면 §14 되돌리기가 통째로 죽는다").toBe(true);
  });

  it("열쇠를 줘도 다른 연결이 쥐고 있으면 막는다 — 관문이 헐거워지지 않았다", () => {
    암호화해두기(열쇠);
    const 서버 = new Database(dbPath);
    서버.pragma("cipher='sqlcipher'");
    서버.pragma(`key="x'${열쇠}'"`);
    서버.prepare("SELECT COUNT(*) AS n FROM docsbundle").get();
    try {
      const r = 데이터베이스가조용한가(dbPath, 열쇠);
      expect(r.ok).toBe(false);
      expect(r.이유).toContain("멈춘");
    } finally {
      서버.close();
    }
  });
});

describe("★ 짝 도구(암호화 끄기)도 같은 관문을 문다", () => {
  const 스크립트 = fs.readFileSync(path.join(__dirname, "..", "scripts", "decrypt-db.mjs"), "utf8");

  it("관문을 부르고, 실패하면 멈춘다", () => {
    expect(스크립트, "켜는 쪽만 관문으로 바꾸면 되돌리는 쪽에서 같은 사고가 난다").toContain("데이터베이스가조용한가");
    expect(스크립트).toMatch(/if \(!.*\.ok\) fail\(/);
  });

  it("열쇠를 들고 잰다 — 안 그러면 암호화 DB에서 관문이 늘 막는다", () => {
    expect(스크립트).toMatch(/데이터베이스가조용한가\(DB_PATH,\s*열쇠hex\)/);
  });

  it("관문은 **백업보다 앞**이다 — 아직 되돌릴 것이 없는 자리에서 멈춘다", () => {
    expect(스크립트.indexOf("데이터베이스가조용한가")).toBeLessThan(스크립트.indexOf("const backupDb ="));
  });

  it("반증 — 「경고만 하고 계속 간다」던 옛 줄은 사라졌다", () => {
    expect(스크립트).not.toContain("⚠ -wal 파일에 내용이 있습니다");
  });
});

describe("정직 — 관문이 파일을 손대는 것은 사실이다", () => {
  it("막고 멈춘 뒤에도 WAL은 본 파일로 합쳐져 있다(무손실) — 「아무것도 안 바꾼다」는 말은 틀렸다", () => {
    const 서버 = 운영처럼만들기();
    서버.prepare("INSERT INTO docsbundle (hash) VALUES (?)").run("관문 앞에서 쓴 행");
    try {
      const 전 = fs.existsSync(dbPath + "-wal") ? fs.statSync(dbPath + "-wal").size : 0;
      expect(전, "전제: 관문을 부르기 전에는 -wal에 내용이 있다").toBeGreaterThan(0);
      const r = 데이터베이스가조용한가(dbPath);
      expect(r.ok).toBe(false); // 서버가 살아 있으니 막는 것이 맞다
      const 후 = fs.existsSync(dbPath + "-wal") ? fs.statSync(dbPath + "-wal").size : 0;
      expect(후, "머리말이 이 사실을 적어 둬야 한다 — 무손실이지만 무변경은 아니다").toBeLessThan(전);
    } finally {
      서버.close();
    }
  });

  it("머리말·주석이 그 사실을 적고 있다(약속과 코드의 일치)", () => {
    const gate = fs.readFileSync(path.join(__dirname, "..", "src", "util", "walgate.ts"), "utf8");
    expect(gate).not.toContain("연결도 닫는다(아무것도 안 바꾼다)");
    expect(gate).toContain("무손실");
  });
});

// ── 관문이 **정상 경로**를 막지 않는가 ────────────────────────────────────────
// 올인원 「암호화 켜기」 단추는 앱이 서버를 죽이고 이 스크립트를 부른다. 그런데 서버의 정상 종료는
// 최대 15초까지 간다(index.ts SHUTDOWN_DEADLINE_MS · 모델마다 10초). 예전처럼 3초만 세고 부르면
// 아직 살아 있는 서버 때문에 관문이 막고, 고객은 **따로 멈출 서버가 없는데** 「서버를 멈추세요」를 본다 —
// 2026-08-09에 이 단추를 만든 까닭이 바로 그 「따를 수 없는 안내」였다(2026-09-10 검토관 적발).
// ⚠ 여기서 재는 것은 **앱 코드의 계약**이다. 실기(설치본)에서 눌러 본 확인은 아직 없다.
describe("★ 올인원 단추 — 서버가 끝난 것을 확인하고 부른다", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "main.ts"), "utf8");
  const 단추 = main.slice(main.indexOf("dbcrypt:enable"), main.indexOf("dbcrypt:enable") + 4200);

  it("고정 3초 세기가 아니라 종료 신호(exit)를 기다린다", () => {
    expect(단추, "3초는 서버의 자기 기한(15초)보다 짧다").toMatch(/once\("exit"/);
    expect(단추).not.toMatch(/setTimeout\(r, 3000\)/);
  });

  it("그래도 안 죽으면 상한을 두고 진행한다 — 영영 안 끝나는 단추를 만들지 않는다", () => {
    expect(단추).toMatch(/setTimeout\([\s\S]{0,200}20_000\)/);
    expect(단추).toContain("SIGKILL");
  });

  it("서버는 성공이든 실패든 다시 뜬다 — 여기서 안 띄우면 앱이 먹통이 된다(종전 계약)", () => {
    expect(단추).toContain("maybeStartBundledServer()");
  });
});
