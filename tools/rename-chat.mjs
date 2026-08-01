// tools/rename-chat.mjs — 대화 관련 용어 통일 (사용자 지시 2026-08-01)
//
// 문제: 같은 것을 「챗봇」「대화창」「지휘소」「명령창」「컴포저」로 부르고 있었다(5종).
//   담당자가 "챗봇 어디 있어요?"라고 물으면 우리도 어느 것을 가리키는지 애매했다.
//
// ★ 핵심은 단순 치환이 아니다 — 「챗봇」이 **두 가지를 뭉뚱그리고** 있었다:
//     ① 묻는 **자리**  → 「대화창」
//     ② 답하는 **주체** → 「AI」 (지휘소는 이미 "AI 팀"이라 부른다)
//   갈라 놓지 않으면 "대화창이 근거로 쓰는 데이터" 같은 이상한 문장이 남는다.
//
// 그리고 「챗봇」이라 부르는 순간 담당자는 **물어보기만 하고 시키지 않는다.**
// 이건 묻고 답하는 봇이 아니라 지시를 받아 일을 하는 자리다(결재판·체크칸·가서 하기가 증거).
//
// ⚠ 코드 이름(console·chatwidget·gcw-·csIn)은 **안 바꾼다** — 사용자에게 안 보이고,
//   바꾸면 위험만 크다. 바꾸는 것은 **사람이 읽는 문장**뿐이다.
//
// 사용: node tools/rename-chat.mjs [--apply]   (기본은 미리보기)
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();

// 순서가 중요하다 — 긴 것부터 바꿔야 짧은 규칙이 먼저 먹어 이상해지지 않는다.
const 규칙 = [
  // ── 주체(답하는 이) → AI ─────────────────────────────────────────
  [/챗봇이 /g, "AI가 "],
  [/챗봇이,/g, "AI가,"],
  [/챗봇 답변/g, "AI 답변"],
  [/챗봇의 답/g, "AI의 답"],
  [/챗봇은 /g, "AI는 "],
  // ── 자리(묻는 곳) → 대화창 ───────────────────────────────────────
  [/이 화면 챗봇/g, "화면 안내"],   // screenguide의 옛 이름 — 지금은 화면 설명 기능이다
  [/챗봇에게/g, "대화창에"],
  [/챗봇에 물어/g, "대화창에 물어"],
  [/챗봇에서/g, "대화창에서"],
  [/챗봇으로/g, "대화창으로"],
  [/챗봇을 /g, "대화창을 "],
  [/챗봇에/g, "대화창에"],
  [/챗봇·/g, "대화창·"],
  [/·챗봇/g, "·대화창"],
  [/챗봇 /g, "대화창 "],
  [/챗봇/g, "대화창"],
  // ── 다른 이름들도 하나로 ─────────────────────────────────────────
  [/명령창/g, "대화창"],
  [/컴포저/g, "대화창"],
];

// 사람이 읽는 문장만 고친다. 코드 식별자·클래스·주석의 사고 이력은 건드리지 않는다.
// (주석까지 바꾸면 "왜 그렇게 됐나"의 기록이 흐려진다.)
function 사람글만(line) {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("<!--")) return false;
  return true;
}

const 대상 = [
  "server/src/engine/screenguide.ts",
  "server/src/engine/howto.ts",
  ...fs.readdirSync(path.join(ROOT, "client/src/renderer/pages"))
    .filter((f) => /\.(html|js)$/.test(f))
    .map((f) => "client/src/renderer/pages/" + f),
];

let 파일수 = 0;
let 줄수 = 0;
const 미리보기 = [];

for (const rel of 대상) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const 원본 = fs.readFileSync(p, "utf8");
  const lines = 원본.split("\n");
  let 바뀜 = false;
  const out = lines.map((line) => {
    if (!사람글만(line)) return line;
    let n = line;
    for (const [re, to] of 규칙) n = n.replace(re, to);
    if (n !== line) {
      바뀜 = true;
      줄수++;
      if (미리보기.length < 12) 미리보기.push(`${rel}\n  - ${line.trim().slice(0, 100)}\n  + ${n.trim().slice(0, 100)}`);
    }
    return n;
  });
  if (바뀜) {
    파일수++;
    if (APPLY) fs.writeFileSync(p, out.join("\n"), "utf8");
  }
}

console.log(`${APPLY ? "■ 적용" : "■ 미리보기(적용하려면 --apply)"} — 파일 ${파일수}개 · 줄 ${줄수}개`);
console.log("");
미리보기.forEach((x) => console.log(x + "\n"));
