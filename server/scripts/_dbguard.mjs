// scripts/_dbguard.mjs — 잠긴 DB를 일반 드라이버로 열려다 죽는 것을 **먼저** 막는다.
//
// 왜 필요한가(2026-08-09 Mac 세션 발견): DB 저장 암호화를 켠 뒤로, 일반 better-sqlite3로
// 열면 다음처럼 죽는다.
//     SqliteError: file is not a database
// 실제로는 **잠겨 있어서** 못 읽는 것인데 "형식이 틀렸다"는 말이 나온다. 그러면 파일이
// 깨졌나·경로가 틀렸나를 먼저 뒤지게 되고, 진짜 원인(암호화)에는 늦게 닿는다.
// 도구가 죽는 건 어쩔 수 없지만, **왜 죽는지는 정확히 말해야 한다.**
//
// 쓰는 법: DB를 열기 전에 한 줄.
//     import { 잠긴DB인가_확인 } from "./_dbguard.mjs";
//     잠긴DB인가_확인(SQLITE, "check-category-sync");
import * as fs from "node:fs";

/** 평문 SQLite 파일은 반드시 이 16바이트로 시작한다(공식 파일 포맷). */
const SQLITE_MAGIC = "SQLite format 3\0";

/** 이 파일이 암호화된 DB인가. 파일이 없으면 false(그건 다른 오류로 다뤄야 한다). */
export function isEncryptedDbFile(dbPath) {
  try {
    const fd = fs.openSync(dbPath, "r");
    try {
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      return buf.toString("latin1") !== SQLITE_MAGIC;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * 잠겨 있으면 **여기서 멈춘다.** 무엇을 해야 하는지까지 말하고 끝낸다 —
 * "안 됩니다"만 말하고 끊으면 도구가 죽는 것과 다를 게 없다.
 */
export function 잠긴DB인가_확인(dbPath, toolName = "이 도구") {
  if (!fs.existsSync(dbPath)) return; // 없는 건 이 관문의 일이 아니다
  if (!isEncryptedDbFile(dbPath)) return;

  console.error(`
✗ ${toolName}: DB가 **저장 암호화**되어 있어 직접 열 수 없습니다.
  ${dbPath}

  이 도구는 DB 파일을 일반 드라이버로 직접 읽습니다. 2026-07-30에 저장 암호화를 켠 뒤로
  그 방식이 막혔습니다(잠긴 것을 여는 열쇠가 서버 기계에 봉인돼 있습니다).

  대신 이렇게 하세요:
    · 같은 내용을 서버 API로 볼 수 있으면 그쪽을 쓰세요(제품이 이미 열어 둔 DB를 씁니다).
    · 꼭 직접 읽어야 하면 서버 폴더에서 제품의 db 모듈을 빌려 쓰세요:
        cd server && node -e 'const {db}=require("./dist/db.js"); /* 여기서 조회 */'
      (dist/db.js가 봉인 해제까지 끝내고 열어 줍니다 — 열쇠를 직접 다루지 마세요.)

  ⚠ 열쇠를 파일로 꺼내거나 복구 열쇠를 스크립트에 적어 두지 마세요. 그렇게 하는 순간
    "DB 파일이 새도 안 열린다"는 이 암호화의 목적이 사라집니다.
`.trim());
  process.exit(2);
}
