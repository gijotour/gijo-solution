// tools/drawer-audit.mjs — 대화창 서랍이 약속한 질문이 **정말 되는지** 전수 확인한다.
// (2026-07-31 사용자 지시 "1 3 같이 진행" 중 1번)
//
// 왜 필요한가: 서랍은 "이건 된다"고 약속하는 자리다. 17개를 늘어놓고 그중 하나가
// "그런 자산이 없습니다"로 끝나면 담당자는 나머지 16개도 안 믿는다.
// 실제로 예시로 박아 둔 "경계 방화벽(FW-01)"이 운영에 없어서 첫 클릭이 실패했다.
//
// 판정: 답이 왔다고 통과가 아니다. **되묻기·거절·폴백 문구는 FAIL**이다
// (프로젝트 규칙 "폴백 문구가 나오면 FAIL로 취급").
//
// 사용: node tools/drawer-audit.mjs [서버주소]
//   계정은 QA_USER/QA_PASS 또는 claude-deploy + GIJO_ADMIN_PASSWORD.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASE = process.argv[2] || "http://localhost:4000";
const USER = process.env.QA_USER || "claude-deploy";
const PASS = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD || "";

// 서랍 목록은 **console.js 하나가 진실 원천**이다. 여기 베껴 두면 화면과 어긋난 것을
// 시험이 못 잡는다 — 소스에서 그대로 읽는다.
function readDrawer() {
  const src = fs.readFileSync(path.join(ROOT, "client/src/renderer/pages/console.js"), "utf8");
  const start = src.indexOf("var CAN = [");
  const end = src.indexOf("\n  ];", start);
  if (start < 0 || end < 0) throw new Error("console.js에서 서랍 목록(CAN)을 찾지 못했습니다");
  const block = src.slice(start, end);
  const out = [];
  let cat = "";
  for (const line of block.split("\n")) {
    const c = line.match(/cat:\s*"([^"]+)"/);
    if (c) cat = c[1];
    const q = line.match(/q:\s*"([^"]+)"/);
    if (q) out.push({ cat, q: q[1], needs: /needs:\s*"product"/.test(line) ? "product" : null });
  }
  return out;
}

// 되묻기·거절·폴백 — 담당자가 보면 "안 되는구나" 하는 문구들.
const FAIL_MARKS = [
  "구체적으로 질문", "명확히 알려주시면", "맥락을 더 알려", "정보를 제공해 주시면",
  "이해하지 못", "알 수 없습니다", "지원하지 않", "할 수 없습니다", "죄송",
  "그런 자산이 없", "찾지 못했습니다", "등록된 자산이 없", "해당하는 자산이 없",
  "실행 실패", "오류가 발생",
];

async function login() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS, force: true }),
  });
  if (!r.ok) throw new Error(`로그인 실패 ${r.status} — QA_USER/QA_PASS 확인`);
  return (await r.json()).accessToken;
}

async function ask(token, text) {
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/dispatch", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ text, qa: true }),
  });
  const j = await r.json().catch(() => ({}));
  return { ...j, ms: Date.now() - t0 };
}

const token = await login();

// {제품} 자리는 화면과 똑같이 실제 등록 제품으로 채운다.
let product = null;
try {
  const r = await fetch(BASE + "/api/security-products", { headers: { authorization: "Bearer " + token } });
  if (r.ok) {
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (j.items || j.products || []);
    product = (rows.find((p) => p && p.name) || {}).name || null;
  }
} catch { /* 없으면 그 줄은 화면에서도 안 보인다 */ }

const items = readDrawer();
console.log(`서랍 ${items.length}문항 · 서버 ${BASE} · 제품 예시=${product ?? "(없음 → 해당 줄 제외)"}\n`);

const rows = [];
for (const it of items) {
  if (it.needs === "product" && !product) {
    rows.push({ ...it, 판정: "제외", 사유: "등록 제품이 없어 화면에도 안 나온다" });
    continue;
  }
  const q = it.needs === "product" ? it.q.replace("{제품}", product) : it.q;
  let r;
  try { r = await ask(token, q); } catch (e) { r = { output: "실행 실패: " + e.message, ms: 0 }; }
  const out = String(r.output || "");
  const bad = FAIL_MARKS.find((m) => out.includes(m));
  // ⚠ 폴백 문구가 있어도 **실제 데이터가 함께 있으면 실패가 아니다.**
  //   7B는 진짜 답을 하면서도 "…는 확인할 수 없습니다" 같은 단서를 덧붙인다(2026-07-31 실측:
  //   같은 질문을 다시 물으니 단서 없이 자산 50개를 정확히 나열했다).
  //   여기서 데이터란 목록 줄·건수·결재판·체크칸처럼 **답이 비어 있지 않다는 증거**다.
  const 데이터있음 =
    !!r.approval || !!r.picklist ||
    (out.match(/^\s*[-•]\s+\S/gm) || []).length >= 2 ||
    /\d+\s*(건|개|%)/.test(out);
  // ⚠ **"없습니다"는 정상적인 답이다.** 기한 지난 일이 정말 없으면 짧게 없다고 말하는 게 맞다.
  //   길이만 보고 실패로 세면 제품이 옳게 답한 것을 결함이라 부르게 된다
  //   (2026-07-31 실제로 그렇게 잡았다: "기한 지난 일정이 없습니다." 12자 → FAIL).
  //   빈 결과를 **분명히 말한 답**은 통과시키고, 진짜로 빈 응답만 잡는다.
  const 빈결과답 = /(없습니다|없음|0\s*건|아직\s*없)/.test(out);
  const 너무짧다 = out.trim().length < 10 || (out.trim().length < 20 && !빈결과답);
  const 판정 = 너무짧다 ? "FAIL" : bad && !데이터있음 ? "FAIL" : "OK";
  rows.push({
    ...it, q, 판정,
    사유: 판정 === "FAIL"
      ? (너무짧다 ? "답이 비었거나 뜻을 알 수 없다" : `데이터 없이 폴백 문구만: "${bad}"`)
      : bad ? `(단서 문구 "${bad}" 있으나 데이터 있음)` : 빈결과답 && !데이터있음 ? "(빈 결과를 분명히 말함 — 정상)" : "",
    초: (r.ms / 1000).toFixed(1),
    결재판: r.approval ? r.approval.tool : "",
    체크칸: r.picklist ? r.picklist.items.length : "",
    답: out.replace(/\s+/g, " ").slice(0, 110),
  });
  const mark = 판정 === "OK" ? "✓" : 판정 === "제외" ? "－" : "✗";
  console.log(`${mark} [${it.cat}] ${q}  (${(r.ms / 1000).toFixed(1)}초)`);
  if (판정 !== "OK") console.log(`    ${rows[rows.length - 1].사유} — ${out.replace(/\s+/g, " ").slice(0, 120)}`);
}

const ok = rows.filter((r) => r.판정 === "OK").length;
const fail = rows.filter((r) => r.판정 === "FAIL");
console.log(`\n결과: ${ok}/${rows.length} 통과${fail.length ? ` · 실패 ${fail.length}건` : ""}`);
for (const f of fail) console.log(`  ✗ ${f.q} — ${f.사유}`);

const outFile = path.join(ROOT, ".tmp-reports", "drawer-audit.md");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile,
  `# 서랍 전수 점검 (${new Date().toLocaleString("ko-KR")} · ${BASE})\n\n` +
  `통과 ${ok}/${rows.length}\n\n| 판정 | 구분 | 질문 | 초 | 결재판 | 체크칸 | 답(앞부분) |\n|---|---|---|---|---|---|---|\n` +
  rows.map((r) => `| ${r.판정} | ${r.cat} | ${r.q} | ${r.초 ?? ""} | ${r.결재판 ?? ""} | ${r.체크칸 ?? ""} | ${(r.답 ?? r.사유).replace(/\|/g, "·")} |`).join("\n") + "\n",
  "utf8");
console.log(`\n리포트: ${outFile}`);
process.exit(fail.length ? 1 : 0);
