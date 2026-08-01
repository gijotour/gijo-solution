// tsc는 .json을 dist로 안 옮긴다 — 코드가 런타임에 읽는 자료 파일을 손으로 옮긴다.
//
// ⚠ 2026-08-01: examquestions.json(시험 문항 목록)이 dist에 없어서, 운영에서는
//   src/ 경로 폴백에 기대고 있었다. src/를 안 올리는 배포로 바뀌면 조용히 꺼진다 —
//   그 필터가 꺼지면 게이트 문항이 학습에 섞이고, 그때부터 게이트 점수가 실력을 못 잰다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 서버 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 옮길것 = ["engine/examquestions.json"];

for (const rel of 옮길것) {
  const from = path.join(서버, "src", rel);
  const to = path.join(서버, "dist", rel);
  if (!fs.existsSync(from)) {
    console.error(`[copy-assets] 원본이 없다: src/${rel}`);
    process.exit(1); // 조용히 넘어가지 않는다 — 없으면 런타임에 기능이 꺼진다
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`[copy-assets] ${rel}`);
}
