// tools/promise-check — **화면이 「누르면 …됩니다」라고 적어 둔 약속이 지켜지는가.**
//
//   node tools/promise-check.mjs         ← 전수 점검
//   node tools/promise-check.mjs --전부  ← 통과한 것까지 전부 보기
//
// 왜 만들었나 (2026-08-06)
// ───────────────────────
// 오늘 실제로 이런 결함을 잡았다: 막대 값이 전부 0이라 bars()가 「표시할 값이 없습니다」를
// 그리는데, 그 옆 안내는 "누르면 목록이 좁혀집니다"가 그대로 남아 있었다 —
// **누를 것이 하나도 없는데 누르라고 적혀 있었다.** 화면 4곳이 그랬다.
//
// 기존 guidance-check는 **「이렇게 물어보세요」라고 적어 준 명령 문구**만 본다.
// 「누르면 …됩니다」 같은 **동작 약속**은 아무도 안 보고 있었다. 그 사각지대를 메운다.
//
// ⚠ 이 도구가 하지 않는 일 — 솔직히 적어 둔다
//   · 약속과 그 대상 요소를 자동으로 잇지 못한다(문장 뜻을 알아야 하는 일이다).
//     그래서 **판정하지 않고 목록을 만든다.** 사람이 보고 판단할 수 있는 크기(수십 건)로
//     줄여 주는 것이 이 도구의 일이다. 자동 판정을 흉내 내면 초록불만 늘고 뜻이 없어진다.
//   · 대신 **기계가 확실히 아는 것**은 잡는다: 그 파일에 누를 자리(클릭 처리)가
//     아예 없는데 "누르면"이라 적힌 경우 — 이건 사람 판단 없이도 이상하다.
//
// ⚠ 주석은 약속이 아니다. 코드 설명에 적은 "누르면 …"까지 세면 목록이 배로 불어
//   아무도 안 보게 된다 — 실측 107건 중 절반 이상이 주석이었다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const 화면방 = path.join(뿌리, "client/src/renderer/pages");
const 전부보기 = process.argv.includes("--전부");

const 약속말 = /(누르면|클릭하면|선택하면|누르시면|클릭 시)/;

/** 주석을 지운다 — 사용자에게 보이지 않는 글은 약속이 아니다. */
function 주석지우기(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")) // HTML 주석(줄 수는 보존)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) // 블록 주석
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m) => m.replace(/\/\/[^\n]*/, (s) => " ".repeat(s.length)));
}

// ⚠ 공용 모듈이 그려 넣는 글자도 **그 화면의 글자**다(2026-08-06 실측). 「✕ 해제」는 viz.js가
//   그리는데 화면 파일만 보면 "없는 이름"으로 잡혀 오탐 5건이 났다. 화면에 실제로 붙는
//   공용 모듈을 함께 놓고 본다.
const 공용모듈 = ["viz.js", "nav.js", "fold.js", "titlebar.js", "console.js", "chatwidget.js"]
  .map((n) => { try { return fs.readFileSync(path.join(화면방, n), "utf8"); } catch { return ""; } })
  .join("\n");

const 결과 = [];
for (const f of fs.readdirSync(화면방).filter((x) => /\.(html|js)$/.test(x))) {
  const 원본 = fs.readFileSync(path.join(화면방, f), "utf8");
  const 코드 = 주석지우기(원본);
  // 그 파일이 무언가를 누를 수 있게 만들고 있는가 — 확실히 아는 신호만 센다.
  const 누를자리 =
    (코드.match(/addEventListener\(\s*["']click["']/g) || []).length +
    (코드.match(/\bonclick\s*=/g) || []).length +
    (코드.match(/\bon\w*Pick\b|\bonPick\b/g) || []).length;

  코드.split("\n").forEach((line, i) => {
    if (!약속말.test(line)) return;
    const 문구 = (line.match(/[^\s"'`>][^"'`<]{0,60}(누르면|클릭하면|선택하면|누르시면|클릭 시)[^"'`<]{0,50}/) || [line.trim()])[0].trim();
    // ★ **이름을 콕 집은 약속**은 기계가 확실히 검사할 수 있다(2026-08-06 신설).
    //   "[학습 시작]을 누르면 …"처럼 버튼 이름을 적어 두고 그 버튼이 화면에 없으면,
    //   담당자는 있지도 않은 것을 찾아 헤맨다 — 빈 화면 안내에 특히 잘 생기는 일이다
    //   (아무것도 없을 때 보여 주는 글이라 평소 눈에 안 띈다).
    const 지목 = [...문구.matchAll(/[[「]\s*([^\]」]{2,20})\s*[\]」]/g)].map((m) => m[1].trim());
    //   ⚠ **약속 문장 자신을 빼고 센다.** 처음엔 `코드.includes(이름)`으로만 봤는데,
    //     이름이 그 문장 안에 들어 있으니 언제나 "있다"가 나왔다 — 가짜 약속을 일부러
    //     넣어 봤더니 그대로 통과했다(2026-08-06). 검사가 통과해도 아무것도 안 지키고 있었다.
    //     그래서 **두 번 이상 나오는지**를 본다: 한 번뿐이면 그 문장 말고는 화면에 없다는 뜻이다.
    const 없는이름 = 지목.filter((이름) =>
      코드.split(이름).length - 1 <= 1 && !공용모듈.includes(이름));
    결과.push({ 파일: f, 줄: i + 1, 문구: 문구.slice(0, 90), 누를자리, 지목, 없는이름 });
  });
}

// viz.js는 약속을 **거두는 쪽**이다(누를 게 없으면 문구를 지운다) — 따로 표시한다.
const 공용 = 결과.filter((r) => r.파일 === "viz.js");
const 화면 = 결과.filter((r) => r.파일 !== "viz.js");
const 수상 = 화면.filter((r) => r.누를자리 === 0);

console.log("\n■ 화면이 적어 둔 「누르면 …」 약속 — 주석 뺀 실제 문구\n");
const 파일별 = new Map();
for (const r of 화면) { if (!파일별.has(r.파일)) 파일별.set(r.파일, []); 파일별.get(r.파일).push(r); }
for (const [f, rows] of [...파일별].sort((a, b) => b[1].length - a[1].length)) {
  const 표시 = 전부보기 ? rows : rows.slice(0, 3);
  console.log(`  ${f} — ${rows.length}건 (누를 자리 ${rows[0].누를자리}곳)`);
  for (const r of 표시) console.log(`     ${String(r.줄).padStart(4)}: ${r.문구}`);
  if (!전부보기 && rows.length > 표시.length) console.log(`     … 그 외 ${rows.length - 표시.length}건(--전부로 보기)`);
}

const 이름틀림 = 화면.filter((r) => r.없는이름.length);
const 지목한것 = 화면.filter((r) => r.지목.length);
console.log(`\n  화면 약속 ${화면.length}건 / ${파일별.size}개 화면 · 공용 모듈(viz.js) ${공용.length}건`);
console.log(`  그중 버튼 이름을 콕 집은 약속 ${지목한것.length}건 — 이름이 화면에 실제로 있는지 대조했습니다.`);
if (이름틀림.length) {
  console.log(`\n  ✗ 적어 둔 이름이 그 화면에 **없습니다** ${이름틀림.length}건 — 담당자가 없는 것을 찾게 됩니다:`);
  for (const r of 이름틀림) console.log(`     ${r.파일}:${r.줄} — 「${r.없는이름.join("·")}」 · ${r.문구}`);
  process.exitCode = 1;
}
if (수상.length) {
  console.log(`\n  ✗ 누를 자리가 **하나도 없는데** 「누르면」이라 적은 화면 ${수상.length}건:`);
  for (const r of 수상) console.log(`     ${r.파일}:${r.줄} — ${r.문구}`);
  process.exitCode = 1;
} else {
  console.log("  ✓ 「누르면」이라 적힌 화면은 전부 누를 자리를 갖고 있습니다.");
}
console.log("\n  ⚠ 이 도구는 **약속이 상황에 따라 거짓이 되는 경우**(값이 0건일 때 등)까지는 못 봅니다.");
console.log("     그건 viz.js처럼 그리는 쪽에서 막아야 합니다 — server/test/vizpromise.test.ts가 그것을 지킵니다.");
