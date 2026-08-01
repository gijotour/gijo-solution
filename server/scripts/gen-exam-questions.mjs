// 시험 문항(회귀 하네스·평가 게이트 질문) 목록을 **서버 안으로** 굽는다.
//
// ⚠ 왜 필요한가(2026-08-01 검토에서 잡힘). 위생은 tools/ 아래 시험지 파일을 읽어
//   "이 질문은 학습에 넣지 말라"를 판단한다. 그런데 **운영 배포는 server/src만 동기화**해서
//   운영에는 tools/가 없다 → 목록이 언제나 비고, 게이트 문항이 그대로 학습된다.
//   그러면 모델이 시험지를 외운 채 시험을 보게 되고, 그때부터 게이트 점수가 실력을 못 잰다.
//   게이트는 중-3의 핵심이고 중-4가 그 위에 얹혀 있으니, 무너지면 그 위 판단이 전부 무의미하다.
//
// 쓰는 법: node server/scripts/gen-exam-questions.mjs
//   → server/src/engine/examquestions.json 갱신. 시험지를 늘리면 다시 돌린다.
//   (server/test/examquestions.test.ts가 최신인지 대조하므로 잊으면 시험이 잡는다.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 뿌리 = path.resolve(여기, "..", "..");

export const 시험지파일 = [
  "tools/regress/cases.json",
  "tools/evalgate/cases/routing.json",
  "tools/evalgate/cases/safety.json",
  "tools/evalgate/cases/korean.json",
];

/** 질문을 대조용으로 다듬는다 — 위생 쪽 정규화와 **같은 규칙**이라야 한다. */
export const 정규화 = (s) => String(s ?? "").replace(/\s+/g, "").replace(/[?!.,·…]/g, "");

export function 시험문항모으기(base = 뿌리) {
  const out = new Set();
  for (const rel of 시험지파일) {
    const p = path.join(base, rel);
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const rows = Array.isArray(raw) ? raw : (raw.cases ?? []);
    for (const c of rows) {
      const q = c?.q ?? c?.question;
      if (q) out.add(정규화(q));
    }
  }
  return [...out].sort();
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("gen-exam-questions.mjs")) {
  const 목록 = 시험문항모으기();
  const 나갈곳 = path.join(뿌리, "server", "src", "engine", "examquestions.json");
  fs.writeFileSync(나갈곳, JSON.stringify({ 만든날: new Date().toISOString().slice(0, 10), 문항: 목록 }, null, 2), "utf8");
  console.log(`시험 문항 ${목록.length}개 → ${path.relative(뿌리, 나갈곳)}`);
}
