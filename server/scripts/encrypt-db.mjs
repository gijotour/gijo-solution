#!/usr/bin/env node
// encrypt-db.mjs — 운영 DB를 평문에서 암호화로 전환한다. (계획서 후-1 저장 암호화)
//
// ⚠ 반드시 **서버를 멈춘 상태**에서 실행할 것. 절차는 되돌릴 수 있게 설계했다:
//   ① 전환 전 백업을 만든다 (실패 시 여기서 복원)
//   ② 열쇠를 이 기계에서 생성해 봉인 저장한다 (공급사는 열쇠를 모른다)
//   ③ PRAGMA rekey로 그 자리에서 암호화한다
//   ④ 암호화된 DB를 다시 열어 표·행 수를 대조 **검증**한다 — 실패하면 백업으로 자동 복원
//   ⑤ 복구 열쇠를 딱 한 번 보여준다 — 종이에 적어 금고에 보관하라고 안내
//
// 사용: cd server && node scripts/encrypt-db.mjs [--db data/gijo-as.sqlite]
import Database from "better-sqlite3-multiple-ciphers";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

const require2 = createRequire(import.meta.url);
// dist가 있으면 dist를, 없으면 tsx 없이도 돌게 컴파일 산출물을 요구한다.
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
if (dbkey.hasKeyFile(DB_PATH)) fail(`열쇠 파일이 이미 있습니다(${dbkey.keyFilePath(DB_PATH)}) — 이미 암호화된 DB로 보입니다.`);

// 서버가 살아 있으면 WAL에 쓰는 중일 수 있다 — -wal 파일 크기로 흔적을 본다(완전한 감지는 아님).
const walPath = DB_PATH + "-wal";
if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
  console.log("⚠ -wal 파일에 내용이 있습니다. 서버가 완전히 멈췄는지 다시 확인하세요.");
}

// ── ① 전환 전 백업 ──────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupPath = `${DB_PATH}.pre-encrypt-${stamp}`;
{
  const d = new Database(DB_PATH);
  d.pragma("wal_checkpoint(TRUNCATE)"); // WAL 내용을 본 파일로 합친다
  d.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  d.close();
}
console.log(`① 전환 전 백업 완료: ${backupPath}`);

// 전환 전 표·행 수를 잰다 — 전환 후 대조할 기준값.
function countAll(dbh) {
  const tables = dbh.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const out = {};
  for (const t of tables) out[t.name] = dbh.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c;
  return out;
}
let before;
{
  const d = new Database(DB_PATH);
  before = countAll(d);
  d.close();
}
const 표수 = Object.keys(before).length;
const 행수 = Object.values(before).reduce((a, b) => a + b, 0);
console.log(`   기준값: 표 ${표수}개 · 행 ${행수.toLocaleString()}건`);

// ── ② 열쇠 생성(이 기계에서) ────────────────────────────────────────────────
const { dek, recoveryKey } = dbkey.createKeyFile(DB_PATH);
console.log(`② 열쇠 생성·봉인 완료: ${dbkey.keyFilePath(DB_PATH)}`);
const strength = dbkey.fingerprintStrength();
if (!strength.strong) {
  console.log(`   ⚠ 기계 고유 식별자를 ${strength.sources}개만 모았습니다 — 기계 묶임이 약할 수 있습니다.`);
}

// ── ③ 그 자리에서 암호화 ────────────────────────────────────────────────────
try {
  const d = new Database(DB_PATH);
  d.pragma("journal_mode=DELETE"); // rekey는 저널이 단순한 상태에서 하는 것이 안전하다
  d.pragma("cipher='sqlcipher'");
  d.pragma(`rekey="x'${dbkey.toSqlcipherKey(dek)}'"`);
  d.close();
  console.log("③ 암호화 전환 완료");
} catch (e) {
  fs.copyFileSync(backupPath, DB_PATH);
  dbkey.hasKeyFile(DB_PATH) && fs.rmSync(dbkey.keyFilePath(DB_PATH));
  fail(`전환 실패 — 백업으로 복원했습니다. 원인: ${e.message}`);
}

// ── ④ 검증 — 열쇠로 열어 기준값과 대조. 실패하면 복원 ───────────────────────
try {
  const raw = fs.readFileSync(DB_PATH);
  if (raw.subarray(0, 15).toString("latin1") === "SQLite format 3") throw new Error("파일 머리가 여전히 평문 SQLite입니다");

  const d = new Database(DB_PATH);
  d.pragma("cipher='sqlcipher'");
  d.pragma(`key="x'${dbkey.toSqlcipherKey(dek)}'"`);
  const after = countAll(d);
  d.pragma("journal_mode=WAL"); // 운영 모드로 되돌린다
  d.close();

  const diffs = [];
  for (const [t, n] of Object.entries(before)) if (after[t] !== n) diffs.push(`${t}: ${n}→${after[t] ?? "없음"}`);
  if (Object.keys(after).length !== 표수) diffs.push(`표 개수 ${표수}→${Object.keys(after).length}`);
  if (diffs.length) throw new Error("행 수 불일치: " + diffs.join(", "));
  console.log(`④ 검증 통과 — 표 ${표수}개 · 행 ${행수.toLocaleString()}건 전부 일치, 열쇠 없이는 열리지 않음`);
} catch (e) {
  fs.copyFileSync(backupPath, DB_PATH);
  fs.rmSync(dbkey.keyFilePath(DB_PATH), { force: true });
  fail(`검증 실패 — 백업으로 복원하고 열쇠 파일을 지웠습니다. 원인: ${e.message}`);
}

// ── ⑤ 복구 열쇠 1회 표시 ────────────────────────────────────────────────────
console.log("\n" + "─".repeat(64));
console.log("⑤ 아래 복구 열쇠를 **종이에 적어 금고에 보관**하세요. 다시 볼 수 없습니다.");
console.log("   서버 기계를 교체·재설치하면 이 열쇠로만 DB를 열 수 있습니다.");
console.log("");
console.log("      " + recoveryKey);
console.log("");
console.log("   잃어버리면: 기계가 그대로일 땐 문제없지만, 기계가 바뀌면 DB를 열 수 없습니다.");
console.log("   재발급: 서버 가동 중 설정 > 관리자에서 가능(관리자 권한).");
console.log("─".repeat(64));
console.log(`\n완료. 서버를 다시 시작하세요. 전환 전 백업(${path.basename(backupPath)})은 확인 후 직접 지우세요 — 평문이므로 오래 두면 안 됩니다.`);
dek.fill(0);
