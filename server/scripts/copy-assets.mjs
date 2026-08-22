// tsc는 .json을 dist로 안 옮긴다 — 코드가 런타임에 읽는 자료 파일을 손으로 옮긴다.
//
// ⚠ 2026-08-01: examquestions.json(시험 문항 목록)이 dist에 없어서, 운영에서는
//   src/ 경로 폴백에 기대고 있었다. src/를 안 올리는 배포로 바뀌면 조용히 꺼진다 —
//   그 필터가 꺼지면 게이트 문항이 학습에 섞이고, 그때부터 게이트 점수가 실력을 못 잰다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 서버 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 옮길것 = [
  "engine/examquestions.json",
  // SBOM 라이선스 점검이 쓸 정본 자료(2026-08-22 반입).
  //   · spdx-licenses.json — SPDX 정본 식별자 733종(CC0-1.0). 등급 판정의 원천.
  //   · cyclonedx-*.schema.json — 타사 SBOM을 읽을 때 필드 이름을 대조할 정본(Apache-2.0).
  //   ⚠ 지식 저장소(RAG)에 넣지 않는다 — 스키마 551조각이 다른 질문의 근거를 밀어낸다.
  //     읽을 글이 아니라 **판정기가 쓸 자료**다.
  "engine/licensedata/spdx-licenses.json",
  "engine/licensedata/cyclonedx-1.6.schema.json",
  "engine/licensedata/cyclonedx-1.7.schema.json",
];

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
