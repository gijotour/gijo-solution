#!/usr/bin/env node
// 지식 문서가 **실제 질문에 걸리는지** 검사한다.
//
// 왜 만들었나(2026-08-09): 하루에 두 번 물렸다.
//   · 활용가이드에 남은 한 줄 때문에 AI가 없는 모델명을 기본 모델이라고 답했다.
//   · 유지보수 문서는 「방화벽」이라는 낱말이 한 번도 없어서, 담당자가 늘 하는 질문
//     (“방화벽 월간 정기점검 절차”)에 **상위 6건에도 못 들었다.** 대신 샘플 데모 파일이 1위였다.
// 둘 다 **문서가 멀쩡해 보이는데 안 걸리는** 경우다 — 문서를 눈으로 읽어서는 절대 못 잡는다.
//
// 어떻게 재나 — LLM을 쓰지 않는다. 검색만 부르고, 돌아온 조각이 **어느 파일에서 왔는지**
// 리포지토리의 문서 본문과 대조해 가른다. 같은 질문에 늘 같은 판정이 나와야 회귀로 쓸 수 있다.
//
// 쓰기: QA_USER=... QA_PASS=... node tools/doc-probe.mjs [--top 3]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const 뿌리 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.QA_BASE || "http://localhost:4000";
const 몇위까지 = Number(process.argv[process.argv.indexOf("--top") + 1]) || 3;
const 목록 = JSON.parse(fs.readFileSync(path.join(뿌리, "tools", "doc-probe.json"), "utf8"));

// ── 문서 본문을 읽어 두고, 조각이 어디서 왔는지 되찾는 데 쓴다 ────────────────
const 눌러쓰기 = (s) => String(s).replace(/\s+/g, "");
const 문서본문 = new Map();
for (const d of 목록.문서) {
  const p = path.join(뿌리, d.파일);
  if (!fs.existsSync(p)) { console.error(`⚠ 원천 없음: ${d.파일}`); continue; }
  문서본문.set(d.파일, 눌러쓰기(fs.readFileSync(p, "utf8")));
}

/** 조각 하나가 어느 파일에서 왔나 — 눈에 띄는 조각(공백 뺀 60자)을 본문에서 찾는다. */
function 어느문서(조각) {
  const 표본 = 눌러쓰기(조각).slice(0, 60);
  if (표본.length < 20) return null;
  for (const [파일, 본문] of 문서본문) if (본문.includes(표본)) return 파일;
  // 문서 중간이 잘렸을 수 있다 — 가운데 토막으로 한 번 더.
  const 가운데 = 눌러쓰기(조각).slice(30, 90);
  if (가운데.length >= 30) for (const [파일, 본문] of 문서본문) if (본문.includes(가운데)) return 파일;
  return null; // 카탈로그 밖(업로드 문서·벤더 매뉴얼 등)
}

async function 로그인() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.QA_USER, password: process.env.QA_PASS, force: true }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error("로그인 실패 — QA_USER/QA_PASS 확인");
  return j.accessToken;
}

const tok = await 로그인();
const H = { "Content-Type": "application/json", Authorization: "Bearer " + tok };

// 한 질문에 옳은 문서가 여럿일 수 있다(허용 목록). __카드__는 카탈로그 밖의 주제별 지식 카드 —
// 파일이 리포지토리에 없어 이름으로 못 가르므로 「카탈로그 밖이면 통과」로 읽는다.
const 결과 = [];
for (const d of 목록.문서) {
  for (const 항 of d.질문) {
    const q = typeof 항 === "string" ? 항 : 항.q;
    const 허용 = typeof 항 === "string" ? [d.파일] : 항.허용;
    let 조각들 = [];
    try {
      const r = await fetch(BASE + "/api/memory/query", { method: "POST", headers: H, body: JSON.stringify({ question: q, topK: 5 }) });
      const j = await r.json();
      조각들 = Array.isArray(j) ? j : (j.chunks ?? j.results ?? []);
    } catch (e) {
      결과.push({ 파일: d.파일, 질문: q, 순위: null, 오류: String(e.message ?? e) });
      continue;
    }
    const 출처 = 조각들.map((c) => 어느문서(typeof c === "string" ? c : (c.text ?? c.content ?? "")));
    const 맞나 = (x) => (x == null ? 허용.includes("__카드__") : 허용.includes(x));
    const 순위 = 출처.findIndex(맞나);
    결과.push({ 파일: d.파일, 질문: q, 순위: 순위 < 0 ? null : 순위 + 1, 상위: 출처.slice(0, 3), 허용 });
  }
}

const 통과 = 결과.filter((r) => r.순위 != null && r.순위 <= 몇위까지);
const 실패 = 결과.filter((r) => !(r.순위 != null && r.순위 <= 몇위까지));
const 일위 = 결과.filter((r) => r.순위 === 1);

const 줄 = [];
줄.push("# 지식 문서 적중 검사");
줄.push("");
줄.push(`잰 때: ${new Date().toLocaleString("ko-KR")} · 문서 ${목록.문서.length}편 · 질문 ${결과.length}개 · 기준 **${몇위까지}위 이내**`);
줄.push("");
줄.push(`- 1위 적중 **${일위.length}/${결과.length}**`);
줄.push(`- ${몇위까지}위 이내 **${통과.length}/${결과.length}**`);
줄.push(`- 못 걸림 **${실패.length}건**`);
줄.push("");
if (실패.length) {
  줄.push("## 못 걸린 질문 — 문서를 고칠까, 질문을 고칠까");
  줄.push("");
  줄.push("| 문서 | 질문 | 대신 걸린 것 |");
  줄.push("|---|---|---|");
  for (const r of 실패) {
    const 대신 = (r.상위 ?? []).map((x) => x ?? "(카탈로그 밖)").join(" · ") || (r.오류 ?? "-");
    줄.push(`| ${path.basename(r.파일)} | ${r.질문} | ${대신} |`);
  }
  줄.push("");
  줄.push("> **읽는 법** — 「대신 걸린 것」이 남의 문서면 *내 문서에 그 질문의 낱말이 없는 것*이다");
  줄.push("> (2026-08-09 실사고: 7항목이 「장비 공통」으로만 적혀 「방화벽」이 한 번도 안 나왔다).");
  줄.push("> 문서에 그 말을 **사실대로** 넣는 쪽이 검색 규칙을 손대는 것보다 오래 간다.");
  줄.push("");
}
줄.push("## 전체");
줄.push("");
줄.push("| 문서 | 질문 | 순위 |");
줄.push("|---|---|---:|");
for (const r of 결과) 줄.push(`| ${path.basename(r.파일)} | ${r.질문} | ${r.순위 ?? "—"} |`);

const 나가는곳 = path.join(뿌리, ".tmp-reports", "doc-probe.md");
fs.mkdirSync(path.dirname(나가는곳), { recursive: true });
fs.writeFileSync(나가는곳, 줄.join("\n"), "utf8");

console.log(`1위 ${일위.length}/${결과.length} · ${몇위까지}위 이내 ${통과.length}/${결과.length} · 못 걸림 ${실패.length}건`);
for (const r of 실패) console.log(`  ✗ ${path.basename(r.파일)} ← "${r.질문}"  대신: ${(r.상위 ?? []).map((x) => x ?? "(밖)").join(" · ")}`);
console.log(`리포트: ${path.relative(뿌리, 나가는곳)}`);
process.exit(실패.length ? 1 : 0);
