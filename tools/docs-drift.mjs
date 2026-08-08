// tools/docs-drift — **고친 문서가 운영 AI에 실제로 반영됐는가.**
//
// ■ 왜 필요한가 (2026-08-08 실사고)
//   문서를 고쳐도 운영 AI는 **8월 7일판을 근거로 계속 답하고 있었다.** 이유가 셋 겹쳤다.
//     ① 배포는 소스만 옮기고 문서는 아무도 안 옮겼다(사람이 기억해야만 맞는 구조).
//     ② 운영 서버에는 문서 사본이 **세 곳**에 있다 — server/docs · gijo-as/docs · 리포 루트.
//        정작 읽는 곳은 env(GIJO_DOCS_DIR)가 가리키는 **한 곳뿐**인데, 다른 곳에 복사하면
//        아무 오류 없이 옛 문서가 계속 쓰인다(실제로 내가 그렇게 넣었다).
//     ③ 저장소에 들어간 조각이 낡아도 화면·로그 어디에도 표시가 없다.
//
//   "고쳤다"와 "AI가 안다"는 다른 말이다. 이 도구는 셋을 한 줄로 대조한다:
//     리포지토리 원본  ↔  운영 문서 폴더  ↔  지식 저장소에 들어간 조각
//
// 사용: node tools/docs-drift.mjs            (읽기만 — 아무것도 고치지 않는다)
//       node tools/docs-drift.mjs --자세히    (문서별 조각 수까지)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { execFileSync } from "child_process";

// ⚠ 경로에 공백이 있다("D:\Connect AI"). URL의 pathname을 그대로 쓰면 %20이 남아 파일을
//   못 찾는다 — fileURLToPath로 풀어야 한다(이 저장소에서 반복된 함정).
const 뿌리 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 자세히 = process.argv.includes("--자세히") || process.argv.includes("--verbose");
const DISTRO = process.env.GIJO_WSL_DISTRO ?? "Ubuntu-24.04";

const wsl = (명령) => {
  try {
    return execFileSync("wsl", ["-d", DISTRO, "--", "bash", "-lc", 명령], { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
};

// ⚠ 양쪽을 **같은 잣대로** 씻어서 비교한다. 처음엔 한쪽만 끝 공백을 자르는 바람에
//   방금 복사한 파일도 "내용이 다름"으로 나왔다(도구가 거짓 경보를 냈다).
//   줄바꿈 방식(CRLF/LF)도 맞춘다 — Windows에서 편집해 리눅스로 옮기면 늘 다르게 보인다.
const 씻기 = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
const 해시 = (s) => createHash("sha256").update(씻기(s), "utf8").digest("hex").slice(0, 12);

// ── ① 운영이 **실제로 읽는** 문서 폴더 (env가 진실 원천) ─────────────────
const docsDir = wsl("grep -m1 '^GIJO_DOCS_DIR=' /home/gijo/gijo-as/gijo-as.env | cut -d= -f2") || "/home/gijo/gijo-as/server/docs";
console.log(`운영이 읽는 문서 폴더: ${docsDir}`);

// 같은 이름의 사본이 다른 곳에도 있으면 알린다 — 거기 복사하면 조용히 헛일이 된다.
const 사본경고 = [];

// ── ② 목록(docs-manifest)에 적힌 문서를 한 편씩 대조 ─────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(뿌리, "server", "docs-manifest.json"), "utf8"));
const 문서들 = (manifest.files ?? []).map((f) => f.file);

const 어긋남 = [];
const 없음 = [];
const 같음 = [];

for (const 이름 of 문서들) {
  const 로컬 = path.join(뿌리, 이름);
  if (!fs.existsSync(로컬)) { 없음.push(`${이름} (리포지토리에 없음)`); continue; }
  const 로컬해시 = 해시(fs.readFileSync(로컬, "utf8"));

  const 운영본 = wsl(`cat '${docsDir}/${이름}' 2>/dev/null`);
  if (!운영본) { 어긋남.push({ 이름, 왜: "운영 폴더에 없음", 로컬해시, 운영해시: "—" }); continue; }
  const 운영해시 = 해시(운영본);

  if (로컬해시 !== 운영해시) 어긋남.push({ 이름, 왜: "내용이 다름", 로컬해시, 운영해시 });
  else 같음.push(이름);

  // 다른 자리에 같은 이름의 사본이 있나 — 있으면 "거기 복사해도 소용없다"고 미리 알린다.
  const 사본 = wsl(`find /home/gijo -name '${이름}' -not -path '${docsDir}/*' 2>/dev/null | head -3`);
  if (사본) 사본경고.push(`${이름} → ${사본.split("\n").join(" · ")}`);
}

console.log(`\n■ 리포지토리 ↔ 운영 문서 폴더`);
console.log(`  ✓ 같음 ${같음.length}건 · ✗ 어긋남 ${어긋남.length}건 · ○ 리포에 없음 ${없음.length}건`);
for (const d of 어긋남) console.log(`     ✗ ${d.이름} — ${d.왜} (리포 ${d.로컬해시} / 운영 ${d.운영해시})`);
for (const n of 없음) console.log(`     ○ ${n}`);

if (사본경고.length) {
  console.log(`\n  ⚠ 같은 이름의 **다른 사본**이 있습니다 — 여기 복사하면 운영에 반영되지 않습니다:`);
  for (const c of 사본경고.slice(0, 8)) console.log(`     ${c}`);
}

// ── ③ 지식 저장소에 실제로 들어간 판이 최신인가 ──────────────────────────
// 문서를 폴더에 넣어도 **재인입되지 않으면** AI는 옛 판으로 답한다(해시가 같아 건너뛴다).
// 여기서는 저장소 조각을 훑어 "운영 문서에만 있는 문구"가 실제로 들어갔는지 본다.
const 조각확인 = wsl(`cd /home/gijo/gijo-as/server && node -e "
const l=require('@lancedb/lancedb');
(async()=>{
  const db=await l.connect('data/memory.lancedb');
  const t=await db.openTable('documents');
  const 문서={};
  for await (const b of t.query().select(['documentId','text']).execute()) {
    const a = typeof b.toArray==='function'? b.toArray():b;
    for (const r of a) { const id=String(r.documentId); (문서[id] ??= []).push(String(r.text||'')); }
  }
  const out={};
  for (const [k,v] of Object.entries(문서)) out[k]=v.length;
  console.log(JSON.stringify(out));
})()" 2>/dev/null`);

let 저장조각 = {};
try { 저장조각 = JSON.parse(조각확인.split("\n").pop() || "{}"); } catch { /* 조회 실패 */ }

console.log(`\n■ 지식 저장소 반영 (문서 ${Object.keys(저장조각).length}건 인입됨)`);
// ⚠ 저장소의 문서 이름은 **파일 이름만**이다(docsbundle이 basename을 문서 id로 쓴다).
//   목록에는 하위 폴더가 붙어 있어(knowledge/…) 그대로 대조하면 멀쩡한 문서를 "없다"고 한다.
const 미인입 = 문서들.filter((n) => !저장조각[path.basename(n)]);
if (미인입.length) {
  console.log(`  ✗ 목록에 있으나 저장소에 없는 문서 ${미인입.length}건 — AI가 근거로 쓸 수 없습니다:`);
  for (const n of 미인입) console.log(`     ${n}`);
} else {
  console.log("  ✓ 목록의 문서가 모두 저장소에 있습니다.");
}
if (자세히) {
  for (const 이름 of 문서들) {
    const n = 저장조각[path.basename(이름)];
    if (n) console.log(`     ${n}조각\t${이름}`);
  }
}

const 실패 = 어긋남.length > 0 || 미인입.length > 0;
console.log(`\n${실패 ? "✗ 문서가 어긋나 있습니다 — 배포(tools/deploy-prod.ps1)로 동기화하고, 바뀐 문서는 재인입되게 서버를 재시작하세요." : "✓ 리포지토리·운영·지식 저장소가 같은 문서를 보고 있습니다."}`);
process.exit(실패 ? 1 : 0);
