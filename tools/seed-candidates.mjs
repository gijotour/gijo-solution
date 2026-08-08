#!/usr/bin/env node
// 사내 지식 문서에서 **학습 재료 후보(문답)**를 뽑는다 — 사람이 검수할 목록을 만드는 도구.
//
// 왜 만들었나(2026-08-09): 후보함이 0건이었다. 주제별 전문가 어댑터의 개시선은 300건인데
// 실사용 대화만으로는 언제 찰지 알 수 없다. 그렇다고 아무거나 담으면 [[학습 재료 위생]]이 무너진다.
//
// 원칙 셋 — 어기면 이 도구를 만든 이유가 사라진다.
//   1) **LLM을 쓰지 않는다.** 문서의 소제목을 물음으로, 그 아래 본문을 답으로 뒤집을 뿐이다.
//      같은 문서에서 늘 같은 후보가 나와야 "지난주에 왜 이게 후보였지"를 답할 수 있다.
//      (모델이 문답을 지어내면 그 지어낸 것을 다시 모델이 배운다 — 자기 꼬리를 먹는 학습.)
//   2) **자동으로 승인하지 않는다.** 산출은 검수용 파일 하나다. 담당자가 보고 고르기 전에는
//      어디에도 들어가지 않는다.
//   3) **제품 위생 규칙을 그대로 통과시킨다.** 시점 데이터·문서 본문 복사·너무 짧은 답은
//      여기서도 걸린다(datasethygiene의 판별과 같은 기준을 코드로 옮겨 적지 않고 규칙만 맞춘다).
//
// 쓰기: node tools/seed-candidates.mjs [--out .tmp-reports/seed-candidates.md]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const 뿌리 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 나가는곳 =
  process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : path.join(뿌리, ".tmp-reports", "seed-candidates.md");

// 어느 문서에서 뽑나 — **고객에게 나가는 지식 문서만**. 개발 문서·계획서는 넣지 않는다.
const 원천 = [
  { 파일: "knowledge/GIJO_지식_보안장비_유지보수절차.md", 주제: "장비운영" },
  { 파일: "knowledge/GIJO_지식_보안장비_로그체계.md", 주제: "장비운영" },
  { 파일: "knowledge/GIJO_지식_장비_콘솔_메뉴맵.md", 주제: "장비운영" },
  { 파일: "knowledge/GIJO_지식_장비_릴리즈노트_장애처리노트.md", 주제: "장비운영" },
  { 파일: "knowledge/GIJO_지식_취약점_식별체계.md", 주제: "취약점" },
  { 파일: "knowledge/GIJO_지식_보안거버넌스_표준.md", 주제: "사내규정" },
  { 파일: "GIJO_AS_취약점관리_지침.md", 주제: "취약점" },
  { 파일: "GIJO_AS_보안제품관리_지침.md", 주제: "장비운영" },
];

// ── 위생 (server/src/engine/datasethygiene.ts와 같은 기준) ──────────────────
const 시점데이터 = (a) =>
  /\d{4}-\d{2}-\d{2}/.test(a) || (a.match(/\d+\s*건/g) ?? []).length >= 3 || /\b(?:vuln|asset|prod|cti):[\w.-]+/.test(a);
const 답길이 = (a) => a.length >= 80 && a.length <= 1200;

/** 소제목을 사람이 물을 법한 말로 뒤집는다. 규칙이지 창작이 아니다. */
function 물음으로(제목, 주제) {
  let t = 제목
    .replace(/^#+\s*/, "")
    .replace(/^\d+(\.\d+)*\.?\s*/, "")           // "2.1. " 같은 번호 제거
    // ⚠ 대시를 먼저 자른다. 단 **양옆이 띄어쓰기인 대시**만 — 안 그러면 "PAN-OS" 한가운데를
    //   잘라 "Palo Alto (팔로알토, PAN가 뭐야?" 같은 말이 나온다(첫 실행에서 실제로 나왔다).
    .replace(/\s+[—–-]\s+.*$/, "")                // 대시 뒤 부연 제거
    .replace(/\s*\([^)]*\)\s*$/, "")              // 끝의 괄호 부연 제거
    .trim();
  if (!t) return null;
  // 이미 물음이면 그대로. 물음표가 없어도 **묻는 말꼴**이면 물음이다
  //   (「거버넌스란 무엇인가」에 "가 뭐야?"를 붙여 "무엇인가가 뭐야?"가 나왔다 — 첫 실행 실측).
  if (/[?？]$/.test(t)) return t;
  if (/(무엇인가|무엇입니까|인가|는가|나요|까)$/.test(t)) return t + "?";
  // "…절차/체크리스트/기준/원칙/방법"류는 "알려줘", 그 밖은 "뭐야?"
  if (/(절차|체크리스트|기준|원칙|방법|가이드|정책|규칙|단계|흐름)$/.test(t)) return `${t} 알려줘`;
  return `${t}${이나가(t)} 뭐야?`;
}

/** 받침이 있으면 「이」, 없으면 「가」. 안 보면 "요약가 뭐야?" 같은 말이 나온다(첫 실행에서 실제로 나왔다). */
function 이나가(말) {
  const 끝 = 말.trim().slice(-1);
  const c = 끝.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return "가"; // 한글이 아니면(영문·숫자) 기본값
  return (c - 0xac00) % 28 === 0 ? "가" : "이";
}

const 결과 = [];
const 버린것 = {};
const 버림 = (why) => { 버린것[why] = (버린것[why] ?? 0) + 1; };

for (const { 파일, 주제 } of 원천) {
  const p = path.join(뿌리, 파일);
  if (!fs.existsSync(p)) { 버림(`원천 없음(${파일})`); continue; }
  const 본문 = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  // ## 또는 ### 단위로 자른다 — 소제목 하나가 물음 하나다.
  const 조각 = 본문.split(/\n(?=#{2,3}\s)/);
  for (const 덩이 of 조각) {
    const m = 덩이.match(/^(#{2,3})\s*(.+)$/m);
    if (!m) continue;
    const 물음 = 물음으로(m[2], 주제);
    if (!물음) continue;
    // 답 = 소제목 아래 본문. 표·코드블록은 그대로 두되, 이미지·링크 껍데기는 지운다.
    let 답 = 덩이
      .replace(/^#{2,3}\s*.+$/m, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!답길이(답)) { 버림(답.length < 80 ? "답이 너무 짧음" : "답이 너무 김"); continue; }
    if (시점데이터(답)) { 버림("시점 데이터(그날의 숫자)"); continue; }
    if (/^\|/.test(답) && 답.split("\n").every((l) => !l.trim() || l.trim().startsWith("|"))) {
      버림("표만 있음(문장이 없음)"); continue;
    }
    결과.push({ 주제, 출처: 파일, 물음, 답 });
  }
}

// 같은 물음이 두 문서에 있으면 뒤엣것을 버린다.
const 본것 = new Set();
const 최종 = 결과.filter((r) => {
  const k = r.물음.replace(/\s+/g, "");
  if (본것.has(k)) { 버림("중복 물음"); return false; }
  본것.add(k);
  return true;
});

const 주제별 = {};
for (const r of 최종) 주제별[r.주제] = (주제별[r.주제] ?? 0) + 1;

const 줄 = [];
줄.push("# 학습 재료 시드 — 검수용 목록");
줄.push("");
줄.push(`뽑은 때: ${new Date().toLocaleString("ko-KR")} · 원천 ${원천.length}편 · **후보 ${최종.length}건**`);
줄.push("");
줄.push("> 이 목록은 **아직 아무 데도 들어가지 않았습니다.** 담당자가 골라야 학습 재료가 됩니다.");
줄.push("> 코드가 문서의 소제목을 물음으로, 그 아래 본문을 답으로 뒤집었을 뿐 — AI가 지어낸 문장이 아닙니다.");
줄.push("");
줄.push("## 주제별");
줄.push("");
줄.push("| 주제 | 후보 | 개시선(300)까지 |");
줄.push("|---|---:|---:|");
for (const [t, n] of Object.entries(주제별).sort((a, b) => b[1] - a[1])) {
  줄.push(`| ${t} | ${n} | ${Math.max(0, 300 - n)} |`);
}
줄.push("");
줄.push("## 걸러낸 것");
줄.push("");
if (Object.keys(버린것).length === 0) 줄.push("(없음)");
else for (const [why, n] of Object.entries(버린것).sort((a, b) => b[1] - a[1])) 줄.push(`- ${why} — ${n}건`);
줄.push("");
줄.push("---");
줄.push("");
for (const [i, r] of 최종.entries()) {
  줄.push(`### ${i + 1}. [${r.주제}] ${r.물음}`);
  줄.push("");
  줄.push(`*출처: ${r.출처}*`);
  줄.push("");
  줄.push(r.답.length > 700 ? r.답.slice(0, 700) + "\n\n…(이하 생략 — 실제 후보에는 전문이 들어갑니다)" : r.답);
  줄.push("");
}

fs.mkdirSync(path.dirname(나가는곳), { recursive: true });
fs.writeFileSync(나가는곳, 줄.join("\n"), "utf8");
// 기계가 읽을 판(승인 시 실제로 넣을 때 쓴다) — 사람이 읽는 md와 같은 내용이다.
fs.writeFileSync(나가는곳.replace(/\.md$/, ".json"), JSON.stringify(최종, null, 1), "utf8");

console.log(`후보 ${최종.length}건 — ${Object.entries(주제별).map(([t, n]) => `${t} ${n}`).join(" · ")}`);
console.log(`걸러냄: ${Object.entries(버린것).map(([w, n]) => `${w} ${n}`).join(" · ") || "없음"}`);
console.log(`검수용: ${path.relative(뿌리, 나가는곳)} (+ .json)`);
