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
// ── ③ 서버 답변이 지목한 화면 이름 — 지금 사이드바에 실제로 있는가 ─────────────
// 약속 점검 도구가 둘로 늘며 **분담 지도**를 여기 적는다(2026-08-06):
//   · guidance-check — 서버가 「"…해줘"라고 하세요」라고 적어 준 **명령 문구**가 결정적으로 걸리는가
//   · promise-check ①② — 화면이 적은 「누르면 …됩니다」 **동작 약속** + 콕 집은 버튼 이름
//   · promise-check ③(이 절) — 서버 답변이 「○○ 화면에서 하세요」라고 **화면 이름을 지목**한 것.
//     둘 다 안 보던 사각지대였다. 메뉴 이름은 개편(20→9, 3.5.0, 2026-08-05 정돈)을 여럿 거쳐
//     서버 문구만 낡기 쉽다 — 담당자가 없는 메뉴를 찾아 헤매게 된다.
//   · 여전히 아무도 안 보는 것(솔직히): LLM이 즉석에서 지어 말하는 화면 이름(코드가 아니라
//     모델 출력이라 소스 검사로는 못 잡는다 — 평가 게이트·회귀 하네스 몫).
const 엔진방 = path.join(뿌리, "server/src/engine");
const 라벨들 = [...fs.readFileSync(path.join(화면방, "nav.js"), "utf8").matchAll(/label: "([^"]+)"/g)]
  .map((m) => m[1].replace(/^[①-⑨]\s*/, "").replace(/\s*\(창\)$/, ""));
const 라벨정규 = 라벨들.map((l) => l.replace(/[\s·]/g, ""));
// ⚠ 판정은 **아는 이름 사전**으로만 한다(2026-08-06 1차 실행에서 배움). 처음엔 「화면에서」 앞
//   낱말을 전부 이름으로 봤더니 17건 중 절반이 문장 꼬리였다("보는 일은 화면에서", "자리를 비운
//   화면에서") — 산문을 실패로 만들면 오탐이 쌓여 아무도 안 보게 된다. 기계가 확신할 수 있는
//   것만 실패로 한다:
//   · 지금 라벨과 맞음 → ✓   · **옛 이름 사전**과 맞음 → ✗ 낡음(확실)   · 둘 다 아님 → 참고만
const 옛이름 = ["작업 기록", "인수인계", "기억·학습", "기억 학습", "레드팀", "AI 팀", "유지보수",
  "자산 통합 뷰", "내 업무", "기능안내", "문서보강", "사용량 요금"]
  .map((l) => l.replace(/[\s·]/g, ""));

function 지목화면찾기(글) {
  const 잡힘 = [];
  for (const m of 글.matchAll(/「?([가-힣A-Za-z·]+(?:\s[가-힣A-Za-z·]+)?)」?\s*(화면|메뉴|탭)에서/g)) {
    const 낱말 = m[1].trim().split(/\s+/);
    // 마지막 한두 낱말을 이름 후보로 — 어느 하나라도 사전과 맞으면 그 판정을 쓴다.
    const 후보들 = [낱말.slice(-2).join(" "), 낱말[낱말.length - 1]]
      .map((s) => s.replace(/[\s·]/g, "")).filter((s) => s.length >= 2);
    if (후보들.some((c) => 라벨정규.some((l) => l.includes(c) || c.includes(l)))) {
      잡힘.push({ 이름: 낱말.join(" "), 판정: "현재" });
    } else if (후보들.some((c) => 옛이름.some((l) => l.includes(c) || c.includes(l)))) {
      잡힘.push({ 이름: 낱말.join(" "), 판정: "낡음" });
    } else {
      잡힘.push({ 이름: 낱말.join(" "), 판정: "모름" });
    }
  }
  return 잡힘;
}

// ⚠ 검사기 자기 검증 — 오늘만 두 번, 통과해도 아무것도 안 지키는 검사를 만들 뻔했다.
//   아는 이름은 통과하고 지어낸 이름은 걸리는지, 돌기 전에 스스로 확인한다.
{
  const 검증 = 지목화면찾기("취약점 화면에서 확인하세요. 레드팀 화면에서 하세요. 알수없는말 화면에서.");
  const 기대 = ["현재", "낡음", "모름"];
  if (!(검증.length === 3 && 검증.every((r, i) => r.판정 === 기대[i]))) {
    console.log("\n✗ ③ 검사기 자기 검증 실패 — 이 검사를 믿으면 안 됩니다: " + JSON.stringify(검증));
    process.exitCode = 1;
  }
  if (라벨정규.length < 20) { console.log("\n✗ 사이드바 라벨을 못 읽었다(" + 라벨정규.length + "개) — 검사가 헛돈다"); process.exitCode = 1; }
}

const 낡은지목 = [], 모름지목 = [];
for (const f of fs.readdirSync(엔진방).filter((x) => x.endsWith(".ts"))) {
  const 코드 = 주석지우기(fs.readFileSync(path.join(엔진방, f), "utf8"));
  코드.split("\n").forEach((line, i) => {
    if (!/(화면|메뉴|탭)에서/.test(line)) return;
    // 옛 이름을 **역사 설명으로** 적은 줄은 정당하다("2026-07-28 AI 팀 화면에서 이 자리로 옮김").
    // 지금 위치를 가리키는 게 아니라 어디서 왔는지를 말하는 문장이다 — 실패로 잡지 않는다.
    const 역사 = /옮김|옮겼|합쳤|없앴|예전|옛/.test(line);
    for (const r of 지목화면찾기(line)) {
      if (r.판정 === "낡음" && !역사) 낡은지목.push({ 파일: f, 줄: i + 1, 이름: r.이름, 문구: line.trim().slice(0, 90) });
      else if (r.판정 === "모름" && !역사) 모름지목.push({ 파일: f, 줄: i + 1, 이름: r.이름 });
    }
  });
}
console.log("\n■ 서버 답변이 지목한 화면 이름 ↔ 지금 사이드바(" + 라벨정규.length + "개 라벨)");
if (낡은지목.length) {
  console.log(`  ✗ **옛 이름**을 아직 쓰는 곳 ${낡은지목.length}건 — 담당자가 없는 메뉴를 찾게 됩니다:`);
  for (const r of 낡은지목) console.log(`     ${r.파일}:${r.줄} — 「${r.이름}」 · ${r.문구}`);
  process.exitCode = 1;
} else {
  console.log("  ✓ 옛 화면 이름을 지금 위치처럼 말하는 곳이 없습니다.");
}
if (모름지목.length) {
  console.log(`  ○ 판정 못 한 문구 ${모름지목.length}건(산문일 가능성 — 실패 아님): ` +
    모름지목.slice(0, 6).map((r) => `${r.파일}:${r.줄}「${r.이름}」`).join(" · ") + (모름지목.length > 6 ? " …" : ""));
}

console.log("\n  ⚠ 이 도구는 **약속이 상황에 따라 거짓이 되는 경우**(값이 0건일 때 등)까지는 못 봅니다.");
console.log("     그건 viz.js처럼 그리는 쪽에서 막아야 합니다 — server/test/vizpromise.test.ts가 그것을 지킵니다.");
