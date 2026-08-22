#!/usr/bin/env node
// decrypt-db.mjs — 운영 DB를 **암호화에서 평문으로** 되돌린다. `encrypt-db.mjs`의 짝.
//
// ■ 왜 있나 (2026-08-23 사장님 지시 「개발기간에는 DB 암호화는 해지하자」)
//   암호화된 DB는 `better-sqlite3`(평문판)로 못 연다 — `SQLITE_NOTADB: file is not a database`.
//   그래서 개발 중 **어떤 조사도 서버를 거쳐야만** 할 수 있다. 실제로 그 벽에 막혀
//   「이 문서의 등급이 왜 C인가」 같은 물음에 답을 못 했다(2026-08-23 실측).
//   ⚠ 켜는 쪽만 있고 되돌리는 쪽이 없던 것 자체가 결함이다 — 한 방향 전환은 되돌릴 수 없다.
//
// ⚠ 반드시 **서버를 멈춘 상태**에서. 절차는 되돌릴 수 있게 짰다:
//   ① 백업(암호화된 DB + 열쇠 파일) — 실패하면 여기서 복원
//   ② PRAGMA rekey='' 로 그 자리에서 평문화
//   ③ 열쇠 파일을 **지우지 않고 이름만 바꾼다**(.disabled) — 되돌릴 때 필요
//   ④ 평문으로 다시 열어 표·행 수를 대조 **검증** — 실패하면 백업으로 자동 복원
//
// ★ 다시 켜려면: 열쇠 파일 이름을 되돌리지 말고 `node scripts/encrypt-db.mjs`를 새로 돌린다
//   (새 열쇠를 만들어 봉인한다 — 옛 열쇠 파일은 그때 지워도 된다).
//
// 사용: cd server && node scripts/decrypt-db.mjs [--db data/gijo-as.sqlite]
import Database from "better-sqlite3-multiple-ciphers";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

const require2 = createRequire(import.meta.url);
let dbkey;
try { dbkey = require2("../dist/dbkey.js"); }
catch {
  console.error("dist/dbkey.js가 없습니다 — 먼저 빌드하세요: npm run build");
  process.exit(2);
}

const argIdx = process.argv.indexOf("--db");
const DB_PATH = argIdx > -1 ? process.argv[argIdx + 1] : path.join("data", "gijo-as.sqlite");

function fail(msg) { console.error("✗ " + msg); process.exit(1); }

if (!fs.existsSync(DB_PATH)) fail(`DB가 없습니다: ${DB_PATH}`);
if (!dbkey.hasKeyFile(DB_PATH)) fail(`열쇠 파일이 없습니다(${dbkey.keyFilePath(DB_PATH)}) — 이미 평문 DB로 보입니다.`);

const walPath = DB_PATH + "-wal";
if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
  console.log("⚠ -wal 파일에 내용이 있습니다. 서버가 완전히 멈췄는지 다시 확인하세요.");
}

// ── ① 백업 ──────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDb = `${DB_PATH}.encrypted-${stamp}.bak`;
const keyPath = dbkey.keyFilePath(DB_PATH);
const backupKey = `${keyPath}.${stamp}.bak`;
fs.copyFileSync(DB_PATH, backupDb);
fs.copyFileSync(keyPath, backupKey);
console.log(`① 백업: ${backupDb}`);
console.log(`        ${backupKey}`);

function 복원(이유) {
  try {
    fs.copyFileSync(backupDb, DB_PATH);
    if (!fs.existsSync(keyPath)) fs.copyFileSync(backupKey, keyPath);
    console.error(`✗ ${이유} — 백업에서 복원했습니다. DB는 **암호화된 그대로**입니다.`);
  } catch (e) {
    console.error(`✗✗ ${이유} — 게다가 복원도 실패했습니다: ${e.message}`);
    console.error(`   손으로 되돌리세요: ${backupDb} → ${DB_PATH}`);
  }
  process.exit(1);
}

// ── 전환 전 재고: 표 이름과 행 수를 적어 둔다(뒤에서 대조) ──────────────────
function 재고(열기) {
  const d = 열기();
  const names = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const counts = {};
  for (const n of names) {
    try { counts[n] = d.prepare(`SELECT COUNT(*) AS n FROM "${n}"`).get().n; } catch { counts[n] = -1; }
  }
  d.close();
  return { names, counts };
}

const dek = dbkey.unsealWithMachine(DB_PATH);
if (!dek) 복원("열쇠의 기계 봉인을 풀지 못했습니다");

const 열쇠hex = dbkey.toSqlcipherKey(dek);
const 암호화로열기 = () => {
  const d = new Database(DB_PATH);
  d.pragma("cipher='sqlcipher'");
  d.pragma(`key="x'${열쇠hex}'"`);
  return d;
};

let 전;
try { 전 = 재고(암호화로열기); } catch (e) { 복원(`암호화 DB를 못 열었습니다: ${e.message}`); }
console.log(`   전환 전: 표 ${전.names.length}개`);

// ── ② 그 자리에서 평문화 ────────────────────────────────────────────────────
try {
  const d = 암호화로열기();
  d.pragma("rekey=''");   // 빈 열쇠 = 평문
  d.close();
  console.log("② 평문화 완료(PRAGMA rekey='')");
} catch (e) {
  복원(`평문화에 실패했습니다: ${e.message}`);
}

// ── ③ 열쇠 파일은 **지우지 않고** 이름만 바꾼다 ─────────────────────────────
//    지우면 되돌릴 때 무엇이 있었는지도 모른다. 서버는 파일 이름으로 암호화 여부를 판단하므로
//    이름만 바꿔도 평문으로 뜬다.
const 비활성 = `${keyPath}.disabled-${stamp}`;
try {
  fs.renameSync(keyPath, 비활성);
  console.log(`③ 열쇠 파일 비활성: ${비활성} (지우지 않았습니다)`);
} catch (e) {
  복원(`열쇠 파일 이름을 못 바꿨습니다: ${e.message}`);
}

// ── ④ 평문으로 다시 열어 대조 검증 ──────────────────────────────────────────
try {
  const 후 = 재고(() => new Database(DB_PATH));
  const 빠진표 = 전.names.filter((n) => !후.names.includes(n));
  const 어긋난행 = 전.names.filter((n) => 후.counts[n] !== undefined && 후.counts[n] !== 전.counts[n]);
  if (빠진표.length) throw new Error(`표가 사라졌습니다: ${빠진표.join(", ")}`);
  if (어긋난행.length) throw new Error(`행 수가 어긋납니다: ${어긋난행.map((n) => `${n}(${전.counts[n]}→${후.counts[n]})`).join(", ")}`);
  console.log(`④ 검증 통과 — 표 ${후.names.length}개, 행 수 전부 일치`);
} catch (e) {
  // 열쇠 이름을 되돌리고 DB도 복원한다.
  try { if (fs.existsSync(비활성)) fs.renameSync(비활성, keyPath); } catch { /* 복원에서 다시 만든다 */ }
  복원(`평문 검증에 실패했습니다: ${e.message}`);
}

console.log("");
console.log("✓ DB 암호화를 **해지**했습니다 — 개발 기간 한정 조치입니다.");
console.log("");
console.log("⚠ 지금부터 이 DB는 **파일을 가져가면 그대로 읽힙니다.**");
console.log("   · 고객 설치본·파일럿에는 이 상태로 나가면 안 됩니다.");
console.log("   · 다시 켜기: cd server && node scripts/decrypt-db.mjs 없이 `node scripts/encrypt-db.mjs`");
console.log(`   · 되돌리기(옛 열쇠로): ${비활성} → ${keyPath} 로 이름 되돌리고 백업 DB(${backupDb})를 제자리로`);
console.log("");
console.log("서버를 다시 켜고 자가 진단에서 「저장 암호화: 꺼짐」이 뜨는지 확인하세요.");
