// tools/learn-candidate-review.mjs — 학습 후보를 **사람이 판단할 수 있는 표**로 정리한다.
// (2026-07-31 사용자 지시 "1 2 3 4 6 진행" 중 ③)
//
// 왜 필요한가: 후보함에 60건이 승인 대기로 쌓여 있는데 아무도 안 눌렀다. 한 건씩 읽어
// 판단하기엔 양이 많고, 무엇이 중복이고 무엇이 시험 흔적인지 화면에서는 안 보인다.
//
// ⚠ **승인은 하지 않는다.** 무엇을 학습에 넣을지는 담당자 판단이다.
//    이 도구는 "무엇이 있고 무엇을 빼야 하는지"만 보여 준다.
//
// 사용:
//   node tools/learn-candidate-review.mjs               # 운영에서 받아 정리
//   node tools/learn-candidate-review.mjs <덤프.json>   # 받아 둔 파일로 정리(서버 불필요)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const 덤프 = process.argv[2];

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");

async function 후보받기() {
  if (덤프) return JSON.parse(fs.readFileSync(덤프, "utf8"));
  const user = process.env.QA_USER || "claude-deploy";
  const pass = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD || "";
  const lr = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: pass, force: true }),
  });
  if (!lr.ok) throw new Error(`로그인 실패 ${lr.status}`);
  const { accessToken } = await lr.json();
  const r = await fetch(BASE + "/api/learnloop/candidates?days=60&limit=500", {
    headers: { authorization: "Bearer " + accessToken },
  });
  return r.json();
}

/** 시험 문항 목록 — 이걸 학습시키면 그 시험이 자기가 가르친 걸 채점하게 된다. */
function 시험문항() {
  const load = (p) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
      const arr = Array.isArray(d) ? d : (d.cases || d.items || []);
      return arr.map((x) => norm(x.question || x.q || x.input || x.prompt || "")).filter(Boolean);
    } catch { return []; }
  };
  return {
    게이트: [...load("tools/evalgate/cases/routing.json"), ...load("tools/evalgate/cases/safety.json"), ...load("tools/evalgate/cases/korean.json")],
    회귀: load("tools/regress/cases.json"),
  };
}

/** 질문이 아닌 것 — 학습에 들어가면 모델이 이상한 입력 형식을 배운다. */
const 질문아님 = [
  { 표시: "맥락 덩어리", 검사: (q) => q.startsWith("이전 대화 맥락") },
  { 표시: "화면이 만든 지시", 검사: (q) => /^고른 \d+건을|^#고른건/.test(q) },
];

/**
 * 이제 **모델이 답하지 않는** 질문인가 — 규칙(결정적 경로)이 답하는 것들.
 * 학습에 넣어도 모델은 그 질문을 다시 볼 일이 없다. 넣을수록 다른 것을 배울 자리만 줄어든다.
 * (2026-07-31에 가서 하기·취약점 목록이 결정적 경로가 되면서 생긴 구분)
 */
async function 결정적경로판별() {
  // ⚠ 윈도 절대경로(D:\…)를 그대로 import 하면 실패한다 — file:// URL이어야 한다.
  //   처음에 그냥 넘겨 놓고 catch로 삼켰더니 **아무것도 못 거르면서 조용히 통과**했다.
  //   못 읽었으면 못 읽었다고 말한다 — 조용한 실패가 제일 나쁘다.
  const 불러오기 = async (rel) => {
    try {
      return await import(pathToFileURL(path.join(ROOT, rel)).href);
    } catch (e) {
      console.warn(`  ⚠ ${rel} 을 못 읽었습니다(${e.message.slice(0, 60)}) — 규칙이 답하는 질문 구분을 건너뜁니다.`);
      return null;
    }
  };
  const howto = await 불러오기("server/dist/engine/howto.js");
  const picklist = await 불러오기("server/dist/engine/picklist.js");
  const screenguide = await 불러오기("server/dist/engine/screenguide.js");
  return (q) => {
    if (howto?.findHowTo?.(q)) return "가서 하기(규칙이 답함)";
    if (picklist?.isFindingListAsk?.(q)) return "취약점 목록(규칙이 답함)";
    if (screenguide?.isHelpIntent?.(q)) return "화면 안내(규칙이 답함)";
    return null;
  };
}

const 규칙이답함 = await 결정적경로판별();
const j = await 후보받기();
const 후보 = j.candidates || [];
const { 게이트, 회귀 } = 시험문항();

// 같은 질문끼리 묶는다 — 44번 반복된 것을 44줄로 보여 주면 판단이 불가능하다.
const 묶음 = new Map();
for (const c of 후보) {
  const k = norm(c.question);
  if (!묶음.has(k)) 묶음.set(k, { q: k, 건수: 0, 최고점: 0, 예시답: "", ids: [] });
  const g = 묶음.get(k);
  g.건수 += 1;
  g.최고점 = Math.max(g.최고점, c.score ?? 0);
  g.ids.push(c.id);
  if (!g.예시답 || (c.answer || "").length > g.예시답.length) g.예시답 = c.answer || "";
}

const rows = [...묶음.values()].map((g) => {
  const 아님 = 질문아님.find((x) => x.검사(g.q));
  let 권고 = "검토", 사유 = "";
  if (아님) { 권고 = "제외"; 사유 = 아님.표시; }
  else if (게이트.includes(g.q)) { 권고 = "제외"; 사유 = "평가 게이트 문항"; }
  else if (회귀.includes(g.q)) { 권고 = "제외"; 사유 = "회귀 하네스 문항"; }
  else if (규칙이답함(g.q)) { 권고 = "제외"; 사유 = 규칙이답함(g.q) + " — 모델이 볼 일이 없다"; }
  else if (g.건수 >= 5) { 권고 = "1건만"; 사유 = `같은 질문 ${g.건수}회 — 다 넣으면 이것만 잘하는 모델이 된다`; }
  return { ...g, 권고, 사유 };
}).sort((a, b) => b.건수 - a.건수);

const 통계 = { 전체: 후보.length, 고유: rows.length };
for (const r of rows) 통계[r.권고] = (통계[r.권고] ?? 0) + 1;

console.log(`학습 후보 ${통계.전체}건 → 서로 다른 질문 ${통계.고유}개`);
console.log(`권고: 검토 ${통계.검토 ?? 0} · 1건만 ${통계["1건만"] ?? 0} · 제외 ${통계.제외 ?? 0}\n`);
for (const r of rows) {
  const mark = r.권고 === "제외" ? "✗" : r.권고 === "1건만" ? "△" : "○";
  console.log(`${mark} [${r.권고}] ${String(r.건수).padStart(3)}회 · ${r.q.slice(0, 60)}${r.사유 ? `  — ${r.사유}` : ""}`);
}

const out = path.join(ROOT, ".tmp-reports", "learn-candidate-review.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out,
  `# 학습 후보 검토표 (${new Date().toLocaleString("ko-KR")})\n\n` +
  `후보 ${통계.전체}건 · 서로 다른 질문 **${통계.고유}개**\n\n` +
  `> ⚠ 승인은 담당자가 합니다. 이 표는 무엇이 있고 무엇을 빼야 하는지만 보여 줍니다.\n\n` +
  `| 권고 | 반복 | 질문 | 사유 |\n|---|---|---|---|\n` +
  rows.map((r) => `| ${r.권고} | ${r.건수}회 | ${r.q.replace(/\|/g, "·").slice(0, 90)} | ${r.사유} |`).join("\n") +
  `\n\n## 권고의 뜻\n\n` +
  `- **○ 검토** — 실무 질문으로 보입니다. 답이 맞는지 읽고 판단하세요.\n` +
  `- **△ 1건만** — 같은 질문이 여러 번입니다. 가장 좋은 답 하나만 넣으세요(다 넣으면 그 질문만 잘하는 모델이 됩니다).\n` +
  `- **✗ 제외** — 시험 문항이거나 사람이 한 질문이 아닙니다.\n`,
  "utf8");
console.log(`\n검토표: ${out}`);
