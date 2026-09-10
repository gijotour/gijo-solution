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
