// tools/knowledge-bundle/import.mjs — 지식 번들을 운영 서버에 반입한다. (계획서 후-3 2단계)
//
// 폐쇄망이라 파일로 받은 번들을 담당자가 직접 넣는다. 서버가 서명을 검증하고,
// **맞지 않으면 거부한다**(경고가 아니라 거부). 거부 사유는 그대로 보여준다.
//
// 사용: node tools/knowledge-bundle/import.mjs --file release\gijo-knowledge-2026.10-1.gijobundle
//   환경변수: GIJO_SERVER_URL(기본 http://localhost:4000), QA_USER/QA_PASS(admin)
import fs from "node:fs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const BASE = process.env.GIJO_SERVER_URL ?? "http://localhost:4000";
const file = arg("--file");

if (!file) { console.error("✗ --file 이 필요합니다"); process.exit(2); }
if (!fs.existsSync(file)) { console.error(`✗ 파일이 없습니다: ${file}`); process.exit(2); }

const r0 = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: process.env.QA_USER ?? "claude-deploy", password: process.env.QA_PASS, force: true }),
});
if (!r0.ok) { console.error(`✗ 로그인 실패 ${r0.status}`); process.exit(2); }
const token = (await r0.json()).accessToken;

const buf = fs.readFileSync(file);
console.log(`반입 중 — ${file} (${Math.round(buf.length / 1024)}KB)`);

const r = await fetch(`${BASE}/api/knowledge-bundle/import`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
  body: buf,
});
const j = await r.json().catch(() => ({}));

if (!r.ok || !j.ok) {
  console.error(`\n✗ 반입 거부 — ${j.reason ?? `HTTP ${r.status}`}`);
  console.error("  서명이 맞지 않거나 내용이 변조된 번들입니다. 받은 경로를 확인하세요.");
  process.exit(1);
}
console.log(`\n✓ 반입 완료 — ${j.version}`);
console.log(`  지식 신규 ${j.triplesAdded}건 · 문서 ${j.docsWritten}건`);
console.log("  (이미 있던 지식은 건너뜁니다 — 두 번 넣어도 중복이 안 쌓입니다)");
