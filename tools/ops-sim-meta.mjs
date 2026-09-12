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
// 쓰임:  node tools/ops-sim-meta.mjs                    → 사람이 읽는 한 줄(ops-sim.meta.json)
//        node tools/ops-sim-meta.mjs --count             → 총문항 숫자만(스크립트가 받아쓸 때)
//        node tools/ops-sim-meta.mjs ops-sim-4100         → 다른 회차(--out과 같은 이름)의 meta를 읽는다
//        node tools/ops-sim-meta.mjs --out ops-sim-4100   → 위와 동일(둘 다 받는다)
// 종료코드: 0=읽었다 · 3=아직 한 회차도 안 끝나 meta가 없다(**실패가 아니다** — 모르는 것이다)
//
// ■ 왜 이름을 받게 했나 (2026-09-12 설계관 실측 ②)
//   야간 회귀 2차 패스(4100)가 ops-sim.mjs --out ops-sim-4100 으로 돌면서 이미
//   .tmp-reports/ops-sim-4100.meta.json을 스스로 쓰고 있는데, 이 파일이 경로를
//   ops-sim.meta.json으로 못박아 놔서 그 메타를 아무도 안 읽었다. 정본은 그대로
//   ops-sim.mjs가 매 회차 직접 쓰는 <이름>.meta.json이다 — 이 파일은 "어느 이름을
//   읽을지"만 인자로 늘렸을 뿐, 숫자를 또 다른 곳에 적지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 뿌리 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 인자 = process.argv.slice(2);
const outIdx = 인자.indexOf("--out");
const 이름 = (outIdx !== -1 && 인자[outIdx + 1])
  ? 인자[outIdx + 1]
  : (인자.find((a) => !a.startsWith("--")) || "ops-sim");
if (!/^[A-Za-z0-9._-]+$/.test(이름)) {
  console.error("✗ 회차 이름에 못 쓰는 글자가 있습니다: " + 이름 + " (영문·숫자·.-_만 — ops-sim.mjs --out과 같은 규칙)");
  process.exit(2);
}
const 메타파일 = path.join(뿌리, ".tmp-reports", `${이름}.meta.json`);
const 숫자만 = 인자.includes("--count");

let m = null;
try { m = JSON.parse(fs.readFileSync(메타파일, "utf8")); } catch { /* 없으면 아래에서 말한다 */ }

if (!m || typeof m.총문항 !== "number") {
  // ⚠ 「모른다」를 0으로 말하지 않는다 — 0은 「문항이 없다」로 읽히고, 그건 거짓이다.
  console.log(숫자만 ? "?" : `(${이름}.meta.json 없음 — 아직 한 회차도 안 끝났다. 문항 수를 모른다)`);
  process.exit(3);
}

// ■ 「잰 문항」·「건너뜀」도 함께 말한다 (2026-09-12 검토관 적발)
//   프로필이 생기면서 **기록(물어본 줄 수)과 실제로 잰 문항 수가 갈렸다** — 건너뛴 줄도 결과에
//   남기 때문이다. 그런데 사람이 매일 아침 먼저 보는 것은 밤 로그의 이 한 줄이라, 여기서 안
//   말하면 「총문항 205 · 기록 205 · 완주 예」만 남고 **8문항을 안 물었다는 사실이 그 자리에 없다**
//   (2026-09-06 「152 vs 162」가 패스 단위로 재발하는 꼴).
//   ⚠ meta에 그 칸이 없는 옛 회차는 **종전 꼴 그대로** 찍는다 — 없는 숫자를 0으로 지어내지 않는다.
const 건너뜀칸 =
  typeof m.잰문항 === "number" || typeof m.건너뜀 === "number"
    ? ` · 잰 문항 ${m.잰문항 ?? "?"} · 건너뜀 ${m.건너뜀 ?? 0}` +
      (m.건너뜀사유별 && Object.keys(m.건너뜀사유별).length
        ? `(${Object.entries(m.건너뜀사유별).map(([k, v]) => `${k} ${v}`).join(" · ")})`
        : "") +
      (m.프로필 ? ` · 프로필 ${m.프로필}` : "")
    : "";

console.log(
  숫자만
    ? String(m.총문항)
    : `총문항 ${m.총문항} · 기록 ${m.기록}${건너뜀칸} · 완주 ${m.완주 ? "예" : "아니오"} · 시각 ${m.시각}`
);
