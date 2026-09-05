#!/usr/bin/env node
// tools/ops-sim-meta.mjs — 야간 회귀 하네스의 **문항 수를 말해 주는 한 곳**. (계획서: 중-7 운영 게이트)
//
// ■ 왜 만들었나 (2026-09-06)
//   작업 스케줄러 이름과 tools/nightly-ops-sim.ps1 머리말이 「152상황」이었는데 **실제는 162문항**
//   이었다(.tmp-reports/ops-sim.meta.json 총문항=162, 2026-09-05 회차). 하네스에 문항을 더할 때마다
//   이름·주석·문서를 같이 고쳐야 하는데 아무도 안 고친다 — 그 사이 GA 판정표·연대기·제안자료까지
//   152로 굳어 **바깥에 내보내는 숫자가 틀린 채** 돌아다녔다.
//   ★ 「같은 것을 여러 곳에 적으면 어긋난다」의 전형이라, 숫자를 적는 자리를 없앤다.
//     정본은 하네스가 매 회차 직접 쓰는 ops-sim.meta.json 하나다(tools/ops-sim.mjs의 「총문항」).
//
// ■ 왜 파일로 뺐나 — ps1의 `node -e "…"`가 **한글을 못 넘긴다**(2026-09-06 실측)
//   Windows PowerShell 5.1은 네이티브 명령 인자를 ANSI 코드페이지로 넘겨서
//   `m.총문항`이 `m.珥앸Ц`으로 깨지고, 큰따옴표는 아예 사라진다(실측 둘 다 재현).
//   그래서 인자로 넘기지 않고 **UTF-8 파일로 둔다.** 이 저장소가 반복해 밟은 자리다.
//
// 쓰임:  node tools/ops-sim-meta.mjs          → 사람이 읽는 한 줄
//        node tools/ops-sim-meta.mjs --count  → 총문항 숫자만(스크립트가 받아쓸 때)
// 종료코드: 0=읽었다 · 3=아직 한 회차도 안 끝나 meta가 없다(**실패가 아니다** — 모르는 것이다)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 뿌리 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 메타파일 = path.join(뿌리, ".tmp-reports", "ops-sim.meta.json");
const 숫자만 = process.argv.includes("--count");

let m = null;
try { m = JSON.parse(fs.readFileSync(메타파일, "utf8")); } catch { /* 없으면 아래에서 말한다 */ }

if (!m || typeof m.총문항 !== "number") {
  // ⚠ 「모른다」를 0으로 말하지 않는다 — 0은 「문항이 없다」로 읽히고, 그건 거짓이다.
  console.log(숫자만 ? "?" : "(ops-sim.meta.json 없음 — 아직 한 회차도 안 끝났다. 문항 수를 모른다)");
  process.exit(3);
}

console.log(
  숫자만
    ? String(m.총문항)
    : `총문항 ${m.총문항} · 기록 ${m.기록} · 완주 ${m.완주 ? "예" : "아니오"} · 시각 ${m.시각}`
);
