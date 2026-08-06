#!/usr/bin/env node
// tools/slow-report.mjs — 느린 답 원장에서 **반복 등장 질문**을 뽑는다(다음 즉답화 후보).
//
// 왜: 강제 라우팅은 실측된 느린 질문에서 나왔다(30초→0.2초 사례 다수). 원장이 자동으로
// 쌓이니, "어떤 질문이 반복해서 느린가"를 이 한 줄로 물을 수 있어야 다음 후보가 보인다.
// 사용: QA_USER=... QA_PASS=... node tools/slow-report.mjs
const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const USER = process.env.QA_USER || process.env.GIJO_ADMIN_USER;
const PASS = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
if (!USER || !PASS) { console.error("QA_USER/QA_PASS 필요"); process.exit(2); }

const L = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS, force: true }),
}).then((r) => r.json());
const j = await fetch(`${BASE}/api/slow-answers`, { headers: { Authorization: `Bearer ${L.accessToken}` } }).then((r) => r.json());

console.log(`■ 느린 답 원장 (${j.thresholdMs / 1000}초 초과, 14일 보관) — 총 ${j.total}건, 질문 ${j.groups.length}종`);
if (!j.groups.length) { console.log("  비어 있음 — 담당자를 기다리게 한 답이 없었습니다."); process.exit(0); }
console.log("  회수 | 최대 | 마지막     | 질문");
for (const g of j.groups.slice(0, 15)) {
  const d = new Date(g.lastAt).toISOString().slice(5, 10);
  console.log(`  ${String(g.count).padStart(3)}회 | ${String(Math.round(g.maxMs / 1000)).padStart(3)}초 | ${d} | ${g.question.slice(0, 60)}`);
}
console.log("\n▸ 2회 이상 반복이면 즉답화(강제 라우팅) 후보 — 원인 추적은 route-explain으로.");
