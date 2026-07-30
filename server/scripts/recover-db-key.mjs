#!/usr/bin/env node
// recover-db-key.mjs — 서버 기계가 바뀌어 DB가 안 열릴 때, 종이에 보관한 복구 열쇠로 되살린다.
// 성공하면 **이 기계에 다시 봉인**되어 다음 재시작부터는 자동으로 열린다.
//
// 사용: cd server && node scripts/recover-db-key.mjs [--db data/gijo-as.sqlite]
//   (복구 열쇠는 명령 인자가 아니라 프롬프트로 받는다 — 셸 히스토리에 남기지 않기 위해)
import * as path from "path";
import * as readline from "readline";
import { createRequire } from "module";

const require2 = createRequire(import.meta.url);
let dbkey;
try { dbkey = require2("../dist/dbkey.js"); }
catch { console.error("dist/dbkey.js가 없습니다 — 먼저 빌드하세요: npm run build"); process.exit(2); }

const argIdx = process.argv.indexOf("--db");
const DB_PATH = argIdx > -1 ? process.argv[argIdx + 1] : path.join("data", "gijo-as.sqlite");

if (!dbkey.hasKeyFile(DB_PATH)) {
  console.error(`열쇠 파일이 없습니다(${dbkey.keyFilePath(DB_PATH)}) — 이 DB는 암호화되지 않았거나 열쇠 파일이 유실됐습니다.`);
  console.error("열쇠 파일 자체가 유실됐다면 복구 열쇠로도 열 수 없습니다 — 백업에서 복원하세요.");
  process.exit(1);
}

// 기계 봉인이 이미 풀리면 복구가 필요 없다.
if (dbkey.unsealWithMachine(DB_PATH)) {
  console.log("이 기계의 봉인이 정상입니다 — 복구가 필요 없습니다. 서버를 그대로 시작하세요.");
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("종이에 보관한 복구 열쇠를 입력하세요: ", (answer) => {
  rl.close();
  const dek = dbkey.unsealWithRecovery(DB_PATH, answer);
  if (!dek) {
    console.error("✗ 복구 열쇠가 맞지 않습니다. 대소문자·하이픈은 무시되니 글자만 정확히 확인하세요.");
    process.exit(1);
  }
  dek.fill(0);
  console.log("✓ 복구 성공 — 이 기계에 다시 봉인했습니다. 이제 서버를 시작하면 자동으로 열립니다.");
});
