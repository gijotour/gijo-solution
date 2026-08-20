// tools/theme-sweep.mjs — 화면 안 「박힌 색」을 토큰 참조(var(--…))로 바꾸는 스윕.
//
// ■ 왜(프로 흰 바탕 공사 1단계, 2026-08-20 사장님 「남은 일 전부 추천안으로」):
//   화면 41개가 같은 팔레트를 :root에 복붙하고도 **본문 규칙에는 원시 hex를 다시 박아** 놓아
//   (실측: 애드혹 ~150곳), 테마 층(pro-white.css)이 토큰을 바꿔도 그 자리는 다크로 남는다.
//   이 스윕은 값을 바꾸지 않는다 — 같은 값을 가리키는 **참조로 통일**한다(다크 외관 무변).
//
// ■ 안전장치(조용한 미적용·과치환 방지 — 이스케이프 사고 5회의 교훈):
//   ① 파일의 첫 :root 블록은 보호한다(토큰 정의 자체를 var()로 바꾸면 순환).
//   ② 그 파일의 :root가 **정의한 토큰만** 치환한다(없는 var를 참조하면 화면이 깨진다).
//   ③ 치환 수를 파일별로 보고하고, 끝에 잔존 원시색을 다시 세어 알린다.
//   ④ --write 없이는 아무것도 안 바꾼다(드라이런 기본).
//
// 사용:  node tools/theme-sweep.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pages = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "src", "renderer", "pages");
const WRITE = process.argv.includes("--write");

// 다크 팔레트 원시값 → 토큰 이름(그 파일 :root가 정의할 때만 적용)
const MAP = [
  ["#262624", "--bg"],
  ["#30302e", "--panel"],
  ["#1f1e1d", "--panel-2"],
  ["#e9e7e2", "--text"],
  ["#b3ada4", "--muted"],
  ["#a49d95", "--muted-2"],
  ["#3b82f6", "--blue"],
  ["#5fa1ff", "--blue-light"],
  ["#1eb980", "--teal"],
  ["#e2483d", "--red"],
  ["#f0a020", "--amber"],
  ["#8b7cf0", "--purple"],
];
// 제외: 라이트(자체 연초록 층) · 로그인/설치(별도 팔레트 --navy) · 팀 사무실(⚠ canvas —
// ctx.fillStyle은 var()를 못 먹고 **조용히 무시**되어 직전 색으로 그려진다. 실제로 스윕이
// 말풍선 글자를 지웠다 — 검토관 2026-08-20 배색 상3. 캔버스 색은 토큰화 대상이 아니다.)
const EXCLUDE = /^(lite-|login\.html$|setup\.html$|office\.html$)/;

const files = fs.readdirSync(pages).filter((f) => f.endsWith(".html") && !EXCLUDE.test(f));
let 총치환 = 0;
const 보고 = [];
for (const f of files) {
  const full = path.join(pages, f);
  const src = fs.readFileSync(full, "utf8");
  // 첫 :root 블록 보호 — 정의부.
  const m = src.match(/:root\s*{[^}]*}/);
  const rootBlock = m ? m[0] : "";
  const 정의됨 = new Set(MAP.filter(([, v]) => rootBlock.includes(v + ":")).map(([, v]) => v));
  if (!정의됨.size) continue;
  const head = m ? src.slice(0, m.index + rootBlock.length) : "";
  let body = m ? src.slice(m.index + rootBlock.length) : src;
  let n = 0;
  for (const [hex, v] of MAP) {
    if (!정의됨.has(v)) continue;
    const re = new RegExp(hex.replace("#", "#") + "\\b", "gi");
    const c = (body.match(re) || []).length;
    if (!c) continue;
    body = body.replace(re, `var(${v})`);
    n += c;
  }
  if (!n) continue;
  총치환 += n;
  보고.push(`${f}: ${n}곳`);
  if (WRITE) fs.writeFileSync(full, head + body);
}
console.log(보고.join("\n") || "(치환 대상 없음)");
console.log(`\n${WRITE ? "치환 완료" : "드라이런"} — 총 ${총치환}곳 · 대상 ${보고.length}파일`);
if (WRITE) {
  // 잔존 원시색(정의부 밖) 재검 — 남았으면 그 파일 :root에 그 토큰이 없다는 뜻(다음 단계 수동 몫)
  let 잔존 = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(pages, f), "utf8");
    const m = src.match(/:root\s*{[^}]*}/);
    const body = m ? src.slice(m.index + m[0].length) : src;
    for (const [hex] of MAP) 잔존 += (body.match(new RegExp(hex + "\\b", "gi")) || []).length;
  }
  console.log(`잔존 원시색(정의부 밖): ${잔존}곳 — 0이 아니면 해당 파일 :root에 토큰이 없는 것(수동 몫)`);
}
