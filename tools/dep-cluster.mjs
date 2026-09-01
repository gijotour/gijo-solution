// tools/dep-cluster.mjs — 서버 의존 덩어리(순환) 재는 자 (2026-09-01 신설)
//
// ■ 왜 두나
//   2026-08-23에 「61개 파일이 한 덩어리 · 그것을 붙든 되먹임 화살 12개」라고 쟀는데, 그 숫자가
//   scratchpad 스크립트에만 있어서 **그 뒤로 아무도 다시 못 쟀다.** 그 사이 화살 절반이 끊겼는데
//   기록은 「12개 착수 전」에 멈춰 있었다 — 안 재면 고친 것도 모른다.
//   CLAUDE.md의 「차이를 드러내는 기계를 둔다」가 이것이다.
//
// ■ ★★ 값·타입·동적을 반드시 가른다
//   `import type`은 컴파일하면 **사라진다** — 순환이 아니다. 이걸 안 가르면 2026-08-23 v1이
//   낸 「순환 129개」 같은 **틀린 숫자**가 나온다. 여기서 순환에 드는 것은 값 + 동적뿐이다.
//
// ■ ★ 주석을 먼저 걷어낸다
//   이 저장소는 주석에 「그전: await import("./dispatcher.js")」처럼 **옛 코드를 인용해 두는
//   습관**이 있다(왜 끊었는지 남기려고). 그걸 세면 **이미 끊은 화살이 살아있음으로 나온다.**
//   2026-09-01에 실제로 그랬다 — 재는 도구가 틀리면 고칠 것을 잘못 고른다.
//
// 쓰는 법:
//   node tools/dep-cluster.mjs            — 덩어리 요약
//   node tools/dep-cluster.mjs --edges    — 가장 큰 덩어리를 붙든 되먹임 화살까지
import fs from "node:fs";
import path from "node:path";

const 뿌리 = "server/src";
const B = String.fromCharCode(92);
const NL = String.fromCharCode(10);

/**
 * 주석만 걷어낸다 — **따옴표 안은 건드리지 않는다.**
 *
 * ⚠⚠ 처음엔 정규식으로 대충 지웠다(`(^|[^:])//.*$`). URL의 `://`만 피하면 될 줄 알았는데,
 *   `"a//b"` 같은 **문자열 속 //**부터 뒤를 통째로 잘라 먹었다. 실측(2026-09-01):
 *   그 방식은 서버 200개 파일에서 화살 **21개**를 놓쳤다 — knowledgebundle.ts는 17개 전부.
 *   재는 도구가 틀리면 고칠 것을 잘못 고른다. 그래서 **글자를 하나씩 따라가며** 판정한다.
 *   (같은 파일 안에서 이 병을 두 번 겪었다 — 처음엔 주석 속 옛 코드를 세어 이미 끊은
 *    화살을 「살아있음」이라 했고, 두 번째가 이것이다.)
 */
const 주석빼기 = (원문) => {
  let out = "", i = 0;
  const n = 원문.length;
  let 따옴 = null, 블록 = false, 줄 = false;
  while (i < n) {
    const c = 원문[i], d = 원문[i + 1];
    if (블록) { if (c === "*" && d === "/") { 블록 = false; i += 2; continue; } if (c === NL) out += c; i++; continue; }
    if (줄) { if (c === NL) { 줄 = false; out += c; } i++; continue; }
    if (따옴) {
      if (c === B) { out += c + (원문[i + 1] ?? ""); i += 2; continue; } // 이스케이프는 통째로 넘긴다
      if (c === 따옴) 따옴 = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { 따옴 = c; out += c; i++; continue; }
    if (c === "/" && d === "*") { 블록 = true; i += 2; continue; }
    if (c === "/" && d === "/") { 줄 = true; i += 2; continue; }
    out += c; i++;
  }
  return out;
};

// from "..." / await import("...") / require("...") — 값과 동적만. `import type`은 뺀다.
const 값RE = new RegExp("^" + B + "s*import" + B + "s+(?!type[" + B + "s{])[" + B + "s" + B + "S]*?from" + B + "s*[\"']([^\"']+)[\"']", "gm");
const 부작용RE = new RegExp("^" + B + "s*import" + B + "s*[\"']([^\"']+)[\"']", "gm");
const 동적RE = new RegExp("(?:await" + B + "s+import|require)" + B + "s*" + B + "(" + B + "s*[\"']([^\"']+)[\"']", "g");
// ⚠ **배럴 재수출(`export … from "./x"`)도 화살이다**(2026-09-01 완결성 비평 [상]).
//   `export { a } from "./b"`는 런타임에 b를 **실제로 불러온다** — import와 똑같은 의존이다.
//   빠뜨리면 그 파일이 아무것도 안 무는 것처럼 보여 **덩어리가 실제보다 작게 나온다.**
//   ⚠ `export type { … } from`은 뺀다 — 타입은 컴파일하면 사라진다(값/타입 가르기 원칙 그대로).
const 재수출RE = new RegExp("^" + B + "s*export" + B + "s+(?!type[" + B + "s{])[" + B + "s" + B + "S]*?from" + B + "s*[\"']([^\"']+)[\"']", "gm");

function 파일들(d, 모음 = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) 파일들(p, 모음);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) 모음.push(p.split(path.sep).join("/"));
  }
  return 모음;
}

const 목록 = 파일들(뿌리);
const 있나 = new Set(목록);
const 풀기 = (에서, 경로) => {
  if (!경로.startsWith(".")) return null; // 바깥 꾸러미는 우리 순환이 아니다
  const 밑 = path.posix.normalize(path.posix.join(path.posix.dirname(에서), 경로)).replace(/[.]js$/, "");
  for (const c of [밑 + ".ts", 밑 + "/index.ts"]) if (있나.has(c)) return c;
  return null;
};

const 화살 = new Map(); // 파일 -> Set(파일)
for (const f of 목록) {
  const s = 주석빼기(fs.readFileSync(f, "utf8"));
  const 밖 = new Set();
  for (const re of [값RE, 부작용RE, 동적RE, 재수출RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const t = 풀기(f, m[1]);
      if (t && t !== f) 밖.add(t);
    }
  }
  화살.set(f, 밖);
}

// Tarjan — 강한연결요소(서로 오갈 수 있는 파일 뭉치) 찾기
const idx = new Map(), low = new Map(), 위 = [], 위에있나 = new Set();
const 덩어리들 = [];
let 번호 = 0;
function 파고들기(v) {
  idx.set(v, 번호); low.set(v, 번호); 번호++;
  위.push(v); 위에있나.add(v);
  for (const w of 화살.get(v) ?? []) {
    if (!idx.has(w)) { 파고들기(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (위에있나.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
  }
  if (low.get(v) === idx.get(v)) {
    const 뭉치 = [];
    for (;;) { const w = 위.pop(); 위에있나.delete(w); 뭉치.push(w); if (w === v) break; }
    if (뭉치.length > 1) 덩어리들.push(뭉치);
  }
}
for (const f of 목록) if (!idx.has(f)) 파고들기(f);

덩어리들.sort((a, b) => b.length - a.length);
console.log(`서버 파일 ${목록.length}개 · 화살 ${[...화살.values()].reduce((n, s) => n + s.size, 0)}개`);
console.log(`서로 오갈 수 있는 덩어리 ${덩어리들.length}개` + (덩어리들.length ? ` — 크기: ${덩어리들.map((c) => c.length).join(", ")}` : " (없음)"));

if (!덩어리들.length) process.exit(0);
// ⚠ **전부 보여 준다.** 가장 큰 것만 찍으면 나머지가 없는 것처럼 읽힌다 —
//   숨긴 덩어리는 아무도 안 고친다(말없는 잘라내기와 같은 병).
덩어리들.forEach((c, i) => {
  console.log(`${NL}덩어리 ${i + 1} — ${c.length}개 파일:`);
  console.log(c.map((f) => "  " + f.replace(뿌리 + "/", "")).sort().join(NL));
});
const 큰것 = 덩어리들[0];

if (process.argv.includes("--edges")) {
  // 되먹임 화살 — 이 하나를 끊으면 덩어리가 쪼개지는 화살을 찾는다(한 개씩 빼 보고 다시 센다).
  const 안 = new Set(큰것);
  const 후보 = [];
  for (const a of 큰것) for (const b of 화살.get(a) ?? []) if (안.has(b)) 후보.push([a, b]);
  console.log(`${NL}덩어리 안 화살 ${후보.length}개 — 하나씩 끊어 보는 중...`);
  const 결과 = [];
  for (const [a, b] of 후보) {
    const 원래 = 화살.get(a);
    화살.set(a, new Set([...원래].filter((x) => x !== b)));
    idx.clear(); low.clear(); 위.length = 0; 위에있나.clear(); 덩어리들.length = 0; 번호 = 0;
    for (const f of 목록) if (!idx.has(f)) 파고들기(f);
    const 새크기 = Math.max(0, ...덩어리들.map((c) => c.length));
    화살.set(a, 원래);
    if (새크기 < 큰것.length) 결과.push({ a, b, 새크기 });
  }
  결과.sort((x, y) => x.새크기 - y.새크기);
  if (!결과.length) console.log("한 개만 끊어서는 안 쪼개진다 — 여러 개를 같이 끊어야 한다.");
  else {
    console.log(`${NL}끊으면 덩어리가 줄어드는 화살 ${결과.length}개:`);
    for (const r of 결과) {
      console.log(`  ${r.a.replace(뿌리 + "/", "")} -> ${r.b.replace(뿌리 + "/", "")}   ${큰것.length} -> ${r.새크기}`);
    }
  }
}
