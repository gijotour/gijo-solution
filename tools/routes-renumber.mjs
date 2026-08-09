// tools/routes-renumber.mjs — routes.ts의 `FORCED_INTENTS[N]` 번호를 **코드에 맞춰 다시 매긴다.**
//
// ■ 왜 필요한가 (2026-08-10 실사고)
//   강제 규칙 하나를 배열 **중간에** 넣었더니 그 뒤 규칙의 자리가 전부 1씩 밀렸다.
//   routes.ts는 규칙을 자리 번호로 가리키므로 **표 전체가 거짓**이 됐고,
//   route-explain은 엉뚱한 정규식을 읽어 「겹침 1건」이라는 거짓 경보까지 냈다.
//   시험(routes.test)이 잡아 주긴 했지만, 잡힌 뒤 **58줄을 손으로 세어 고치는 것**은
//   사람이 할 일이 아니다 — 세다가 또 틀린다.
//
// ■ 왜 「도구 이름으로 가리키기」가 아닌가
//   같은 도구를 쓰는 규칙이 **9종 중복**이다(today×2, list_assets×3 …).
//   이름만으로는 어느 줄인지 못 짚는다. 그래서 번호는 유지하되 **사람이 세지 않게** 한다.
//
// 사용:
//   node tools/routes-renumber.mjs          ← 어긋난 곳을 보여만 준다(고치지 않음)
//   node tools/routes-renumber.mjs --write  ← 실제로 번호를 고친다
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const 고침 = process.argv.includes("--write");

const agentloop = fs.readFileSync(path.join(뿌리, "server/src/engine/agentloop.ts"), "utf8");
const i = agentloop.indexOf("const FORCED_INTENTS");
if (i < 0) { console.error("✗ FORCED_INTENTS를 못 찾았습니다."); process.exit(2); }
const 코드도구 = [...agentloop.slice(i, agentloop.indexOf("\n];", i)).matchAll(/tool: "([a-z_]+)"/g)].map((m) => m[1]);

const routesPath = path.join(뿌리, "server/src/engine/routes.ts");
let routes = fs.readFileSync(routesPath, "utf8");

// ⚠ 표의 **줄 순서는 코드 순서와 무관하다**(사람이 읽기 좋게 층별로 묶어 적는다).
//   대응은 오직 **번호**로 한다 — 그래서 대조도 번호로 해야 한다.
//   (첫 판에서 「표 순서 = 코드 순서」로 가정했다가 멀쩡한 표를 18곳 어긋났다고 오판했다.)
const 줄들 = [...routes.matchAll(/판별: "FORCED_INTENTS\[(\d+)\]", 도착: "([a-z_]+)"/g)];
console.log(`코드 규칙 ${코드도구.length}개 · 표 줄 ${줄들.length}개`);

const 어긋남 = [];
for (const m of 줄들) {
  const 번호 = Number(m[1]);
  const 표도구 = m[2];
  const 실제 = 코드도구[번호];
  if (실제 === undefined) { 어긋남.push(`[${번호}] ${표도구} — 코드에 그런 자리가 없다(규칙이 줄었나?)`); continue; }
  if (실제 !== 표도구) 어긋남.push(`[${번호}] 표는 ${표도구}, 코드는 ${실제}`);
}
// 코드에 있는데 표에 없는 자리도 잡는다 — 「적지 않고 넣은 규칙」이 조용히 늘어난다.
const 표번호 = new Set(줄들.map((m) => Number(m[1])));
코드도구.forEach((t, n) => { if (!표번호.has(n)) 어긋남.push(`[${n}] ${t} — 표에 아예 없다(routes.ts에 적을 것)`); });

if (!어긋남.length) { console.log("✓ 표와 코드가 맞습니다."); process.exit(0); }
console.log(`\n어긋난 곳 ${어긋남.length}건:`);
어긋남.forEach((x) => console.log("  · " + x));

// ★ 고치기: **도구 이름이 유일한 것만** 자동으로 옮긴다.
//   중복 도구(today×2 등)는 어느 줄이 어느 규칙인지 기계가 알 수 없다 — 사람이 봐야 한다.
const 셈 = {};
코드도구.forEach((t) => { 셈[t] = (셈[t] ?? 0) + 1; });
let 결과 = routes;
let 고친수 = 0;
const 남은것 = [];
for (const m of 줄들) {
  const 표도구 = m[2];
  const 번호 = Number(m[1]);
  if (코드도구[번호] === 표도구) continue;
  if (셈[표도구] === 1) {
    결과 = 결과.replace(m[0], `판별: "FORCED_INTENTS[${코드도구.indexOf(표도구)}]", 도착: "${표도구}"`);
    고친수++;
  } else 남은것.push(`${표도구}(코드에 ${셈[표도구]}곳 — 어느 것인지 기계가 못 고른다)`);
}
if (남은것.length) console.log(`\n⚠ 자동으로 못 고치는 것 ${남은것.length}건: ${남은것.join(" · ")}`);
if (!고침) { console.log(`\n(고칠 수 있는 것 ${고친수}건 — 실제로 고치려면 --write)`); process.exit(1); }
fs.writeFileSync(routesPath, 결과);
console.log(`\n✓ ${고친수}건을 다시 매겼습니다.` + (남은것.length ? " 나머지는 직접 보세요." : ""));
process.exit(남은것.length ? 1 : 0);
