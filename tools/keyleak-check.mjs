#!/usr/bin/env node
// 개인키가 새기 쉬운 자리에 있는지 **기계가 잡는다**.
//
// 왜 만들었나: 2026-08-09 **하루에 두 번** 발행 개인키가 대화창에 첨부돼 나갔다
// (gijo-2026 → gijo-2026b). 두 번 다 "규칙 1번: 대화창에 올리지 않는다"가 이미
// 문서에 적혀 있었다. **규칙으로는 안 막혔다** — 사람이 「파일 첨부」를 「대화창 업로드」와
// 같은 일로 느끼지 않기 때문이다.
//
// 그래서 사람의 주의력이 아니라 **파일 위치**를 본다. 개인키가 있어도 되는 곳은 한 곳뿐이고,
// 나머지 자리에 나타나면 새기 직전이라고 본다.
//   · 저장소 안              — 커밋되면 그날로 끝이다
//   · 다운로드 폴더          — 첨부·공유의 출발점
//   · 클라우드 동기화 폴더   — 두면 그 순간 올라간다
//
// 사용: node tools/keyleak-check.mjs          (통과=0 · 발견=1)
//       node tools/keyleak-check.mjs --quiet   (발견된 것만 출력)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const QUIET = process.argv.includes("--quiet");
const 홈 = os.homedir();

/** 개인키가 **있어도 되는** 유일한 자리. 여기 있는 건 정상이다. */
const 허용 = [path.resolve("D:\\GIJO-AS-signing"), path.resolve(홈, "GIJO-AS-signing")];

/** 새기 쉬운 자리 — 여기서 발견되면 알린다. */
const 감시자리 = [
  { path: path.resolve("."), 이름: "저장소", 왜: "커밋되면 되돌릴 수 없습니다" },
  { path: path.join(홈, "Downloads"), 이름: "다운로드 폴더", 왜: "첨부·공유의 출발점입니다" },
  { path: path.join(홈, "Desktop"), 이름: "바탕화면", 왜: "실수로 끌어다 붙이기 쉽습니다" },
  { path: "G:\\내 드라이브", 이름: "구글 드라이브(동기화)", 왜: "두는 순간 클라우드로 올라갑니다" },
  { path: path.join(홈, "OneDrive"), 이름: "OneDrive(동기화)", 왜: "두는 순간 클라우드로 올라갑니다" },
  { path: path.join(홈, "Library", "CloudStorage"), 이름: "macOS 클라우드 동기화", 왜: "두는 순간 올라갑니다" },
];

/** 개인키로 보이는 파일 이름. 확장자만이 아니라 **내용 머리**까지 본다(이름을 바꿔 둬도 잡게). */
const 이름패턴 = /\.(pem|key|p8|p12|pfx)$/i;
const 건너뛸폴더 = /^(node_modules|\.git|dist|build|release|models|\.tmp-reports|server-dist|out)$/;

function 개인키인가(파일) {
  try {
    const fd = fs.openSync(파일, "r");
    try {
      const buf = Buffer.alloc(64);
      const n = fs.readSync(fd, buf, 0, 64, 0);
      return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(buf.toString("latin1", 0, n));
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

const 허용된자리인가 = (p) => 허용.some((a) => path.resolve(p).toLowerCase().startsWith(a.toLowerCase()));

function 훑기(dir, 결과, depth = 0) {
  if (depth > 6) return; // 너무 깊이 들어가면 느리다 — 새기 쉬운 자리는 대개 얕다
  let 목록;
  try { 목록 = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of 목록) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (건너뛸폴더.test(e.name)) continue;
      훑기(full, 결과, depth + 1);
    } else if (이름패턴.test(e.name) && !허용된자리인가(full) && 개인키인가(full)) {
      결과.push(full);
    }
  }
}

let 발견 = 0;
for (const 자리 of 감시자리) {
  if (!fs.existsSync(자리.path)) continue;
  const 결과 = [];
  훑기(자리.path, 결과);
  if (결과.length) {
    발견 += 결과.length;
    console.log(`\n✗ ${자리.이름} 에 개인키 ${결과.length}개 — ${자리.왜}`);
    결과.forEach((f) => console.log(`    ${f}`));
  } else if (!QUIET) {
    console.log(`✓ ${자리.이름} — 없음`);
  }
}

if (발견) {
  console.log(`\n━━ 개인키 ${발견}개가 새기 쉬운 자리에 있습니다 ━━`);
  console.log("  옮길 곳: D:\\GIJO-AS-signing (또는 오프라인 매체)");
  console.log("  ⚠ 이미 첨부·공유한 적이 있으면 **키를 갈아야 합니다** — 옮기는 것만으론 안 됩니다.");
  console.log("     node tools/knowledge-bundle/keygen.mjs --key-id <새이름>");
  process.exit(1);
}
if (!QUIET) console.log("\n✓ 개인키가 새기 쉬운 자리에 없습니다.");
process.exit(0);
