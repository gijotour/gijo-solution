// util/walgate.ts — 「지금 이 데이터베이스를 **나 혼자** 쓰고 있나」를 재는 자.
//
// ■ 왜 생겼나(2026-09-10 고객 QA 인스턴스 실사고): scripts/encrypt-db.mjs가 「⚠ -wal 파일에
//   내용이 있습니다」라고 **경고만 하고 그대로 전환**했다. 서버가 아직 살아 있었고, 스크립트가
//   WAL을 본 파일로 합친 뒤에도 서버가 계속 썼다 — 그 뒤에 쓴 것은 rekey 대상에 못 들어가
//   docsbundle 상태 2행이 통째로 흘렀다(다음 기동에서 문서 2건이 다시 인입됐다).
//   되돌리기 어려운 도구라, 애매하면 **막는다**.
//
// ■ ⚠ 「WAL을 합쳐 보고 다시 재기」로는 못 가른다(2026-09-10 실측):
//     상대 연결이 놀고 있으면 wal_checkpoint(TRUNCATE)가 **성공한다**(busy=0, -wal 0바이트).
//     즉 서버가 떠 있는데도 「깨끗함」으로 읽힌다 — 사고가 정확히 그 모양이었다.
//   확실한 판정은 **배타 잠금을 실제로 잡아 보는 것**이다. 같은 실측에서:
//     ① 다른 연결이 열려만 있어도  → SQLITE_BUSY   ② 다른 연결이 쓰는 중 → SQLITE_BUSY
//     ③ 아무도 없을 때만          → 성공
//   그래서 판정의 마지막은 늘 ③이다. 잡아 본 잠금은 곧바로 되돌리고 연결도 닫는다(아무것도 안 바꾼다).
import Database from "better-sqlite3-multiple-ciphers";
import * as fs from "fs";

export interface 잠금검사 {
  ok: boolean;
  /** 사람이 그대로 읽는 한 줄 — 터미널 없는 올인원 고객도 이 글을 본다. */
  이유: string;
}

/**
 * 이 DB 파일을 지금 다른 프로그램이 쓰고 있지 않은지 확인한다.
 * @returns ok=true면 전환을 진행해도 된다. false면 **멈춰야 한다**(이유를 그대로 보여줄 것).
 */
export function 데이터베이스가조용한가(dbPath: string): 잠금검사 {
  const 멈추라 = "먼저 GIJO AS 서버를 완전히 멈춘 뒤 다시 실행하세요.";
  let d: InstanceType<typeof Database> | null = null;
  try {
    d = new Database(dbPath);
    // 오래 기다리지 않는다(기본 5초 → 0.3초). 여기서 바라는 답은 「지금 나 혼자냐」 하나이고,
    // 붙잡혀 있으면 기다릴 게 아니라 **서버를 멈추라고 말해야** 한다.
    d.pragma("busy_timeout = 300");

    // ① WAL을 본 파일로 합친다. busy가 0이 아니면 **그 순간 쓰고 있는 쪽**이 있다.
    const rows = d.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy?: number }> | undefined;
    const busy = Array.isArray(rows) ? Number(rows[0]?.busy ?? 0) : 0;
    if (busy) return { ok: false, 이유: `다른 프로그램이 데이터베이스에 쓰고 있습니다. ${멈추라}` };

    // ② 합쳤는데도 -wal에 내용이 남았다 — 합치는 사이에도 쓰고 있다는 뜻이다.
    const wal = dbPath + "-wal";
    const 남은 = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
    if (남은 > 0) return { ok: false, 이유: `아직 기록 중인 내용이 남아 있습니다. ${멈추라}` };

    // ③ ★ 진짜 판정 — 배타 잠금을 잡아 본다(위 머리말의 실측). 잡히면 나 혼자다.
    d.pragma("locking_mode=EXCLUSIVE");
    d.exec("BEGIN IMMEDIATE");
    d.exec("ROLLBACK");
    return { ok: true, 이유: "데이터베이스를 쓰는 다른 프로그램이 없습니다." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ⚠ 못 쟀으면 **통과시키지 않는다.** 이 도구는 되돌리기 어렵다 — 모호하면 막는다.
    return { ok: false, 이유: `데이터베이스가 다른 프로그램에 붙잡혀 있습니다(${msg}). ${멈추라}` };
  } finally {
    try { d?.close(); } catch { /* 이미 닫혔으면 그만이다 */ }
  }
}
