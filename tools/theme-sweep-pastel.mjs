// tools/theme-sweep-pastel.mjs — 화면 안 「다크 전용 파스텔 글자색」을 토큰+폴백으로 바꾸는 스윕.
// (2026-08-21 사장님 QA 「전체적으로 아직 글자가 잘 안 보이는 데가 많네」 — 업무 넘기기에서
//  손수리한 부류가 20화면 180여 곳에 더 있어 기계로 쓸어낸다.)
//
// ■ 원리: theme-sweep-whitetext.mjs(#fff → var(--text-strong,#fff))와 같은 골격.
//   다크에서 쓰던 밝은 강조색(민트·연파랑·살몬…)을 같은 뜻의 토큰으로 바꾸되 **폴백에 원래
//   색을 남긴다** — 다크·표준에는 한 픽셀도 안 변하고, 프로 흰 바탕(pro-white)만 진한 색을 받는다.
//
// ■ 안전장치(치환 사고 6회의 교훈, whitetext와 동일):
//   ① <style> 블록 안만 본다 — JS 문자열·인라인 style은 손 수리 몫(보고에 잔존으로 센다).
//   ② 규칙 블록 단위로 「진한 채움 위 글자」는 건너뛴다(채움 위 밝은 글자는 두 테마 모두 옳다).
//   ③ 드라이런 기본(--write 없이는 안 바꾼다) · 파일별 치환/보류 수 보고.
//   ④ syslog.html·terminal.html 전체 제외 — 어두운 상자 고정 화면이라 파스텔이 **의도**다
//      (2026-08-21 같은 날 손수리로 확정). 여기 손대면 그 수리를 되돌리는 꼴이 된다.
//
// 사용:  node tools/theme-sweep-pastel.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pages = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "src", "renderer", "pages");
const WRITE = process.argv.includes("--write");

// audit·agent도 제외(2026-08-21 색 지도) — 고정 어두운 상자(.log-box·.terminal) 안을 고정색으로
// 수리했는데, 그 고정색(#f5928a·#5fa1ff 등)이 MAP에 있어 재실행하면 도로 토큰이 되어 수리가 풀린다.
const EXCLUDE = /^(lite-|login\.html$|setup\.html$|office\.html$|syslog\.html$|terminal\.html$|audit\.html$|agent\.html$)/;
const FILL = /background(?:-color)?\s*:\s*(var\(--(?:g-)?(?:blue|red|teal|amber|purple|green|navy)\b|#[0-9a-fA-F]{3,8}\b|linear-gradient|rgba\(\s*0\s*,)/;

// 색 → 토큰 사전. 값(폴백)은 **원래 색 그대로** — 다크 화면은 변하지 않는다.
// 뜻 기준: 민트/초록=teal · 연파랑(버튼·링크)=blue-light · 연파랑(본문 강조)=text/text-strong ·
// 살몬=red · 호박=amber · 보라=purple. pro-white가 각 토큰의 잉크색을 정의한다.
const MAP = [
  // ⚠ 빨강 계열은 --red가 아니라 **--red-ink**다(2026-08-21 검토관 ① 게시 차단급).
  //   화면 :root가 --red:#e2483d(테두리용)를 정의해 폴백이 무시되고, 다크 글자 66곳이
  //   어두워졌다. --red-ink는 pro-white 한 곳만 정의 → 다크=폴백 원색, 흰 테마=잉크.
  ["#f5928a", "var(--red-ink, #f5928a)"],
  ["#ffd7d8", "var(--red-ink, #ffd7d8)"],
  // 중간 등급 파스텔(검토관 ⑤ — 高·低만 잉크가 되고 中만 사라지던 반쪽). --amber·--blue-light는
  // 다크 값(#f0a020·#5fa1ff)이 이미 전역 글자색 관례라 그대로 써도 다크 회귀가 없다.
  ["#f7c777", "var(--amber, #f7c777)"],
  ["#ffe9c4", "var(--amber, #ffe9c4)"],
  ["#8fb8ff", "var(--blue-light, #8fb8ff)"],
  ["#6fdcb5", "var(--teal, #6fdcb5)"],
  ["#5fe0aa", "var(--teal, #5fe0aa)"],
  ["#7ab0ff", "var(--blue-light, #7ab0ff)"],
  ["#5fa1ff", "var(--blue-light, #5fa1ff)"],
  ["#cfe0ff", "var(--blue-light, #cfe0ff)"],
  ["#dfe6ff", "var(--text-strong, #dfe6ff)"],
  ["#cfd6ea", "var(--text, #cfd6ea)"],
  ["#cfe8d6", "var(--text, #cfe8d6)"],
  ["#f0a020", "var(--amber, #f0a020)"],
  ["#8b7cf0", "var(--purple, #8b7cf0)"],
];

const targets = [
  ...fs.readdirSync(pages).filter((f) => f.endsWith(".html") && !EXCLUDE.test(f)),
  "gijo-ui.css",
];
let 총치환 = 0, 총보류 = 0, 총잔존JS = 0;
const 보고 = [];
for (const f of targets) {
  const fp = path.join(pages, f);
  let src = fs.readFileSync(fp, "utf-8");
  let 치환 = 0, 보류 = 0;
  const isCss = f.endsWith(".css");
  // <style> 블록(또는 css 파일 전체)만 손댄다.
  const 블록들 = isCss ? [[0, src.length]] : [];
  if (!isCss) {
    const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let m;
    while ((m = re.exec(src))) 블록들.push([m.index, m.index + m[0].length]);
  }
  let out = "";
  let cursor = 0;
  for (const [s, e] of 블록들) {
    out += src.slice(cursor, s);
    let css = src.slice(s, e);
    // 규칙 블록 단위로 순회 — 채움 있는 블록은 통째로 보류.
    css = css.replace(/[^{}]+\{[^{}]*\}/g, (rule) => {
      if (FILL.test(rule)) {
        for (const [hex] of MAP) if (rule.includes("color:" + hex) || rule.includes("color: " + hex)) 보류++;
        return rule;
      }
      let r = rule;
      for (const [hex, tok] of MAP) {
        // color: 선언만 — border-color·background 등은 놔둔다(글자 가독성 스윕이다).
        const cre = new RegExp("(?<![-\\w])color\\s*:\\s*" + hex + "\\b", "gi");
        r = r.replace(cre, (mm) => { 치환++; return mm.replace(new RegExp(hex, "i"), tok); });
      }
      return r;
    });
    out += css;
    cursor = e;
  }
  out += src.slice(cursor);
  // JS 문자열·인라인 잔존(사각지대) 집계 — 바꾸지 않고 세기만 한다.
  let 잔존 = 0;
  for (const [hex] of MAP) {
    const all = (src.match(new RegExp("color\\s*:\\s*" + hex, "gi")) || []).length;
    const styled = (out.match(new RegExp("color\\s*:\\s*" + hex, "gi")) || []).length;
    잔존 += styled; // 치환 후에도 남은 것(보류 + 블록 밖)
  }
  if (치환 || 보류 || 잔존) 보고.push(`${f.padEnd(24)} 치환 ${치환} · 채움보류 ${보류} · 잔존 ${잔존}`);
  총치환 += 치환; 총보류 += 보류; 총잔존JS += 잔존;
  if (WRITE && 치환) fs.writeFileSync(fp, out);
}
for (const l of 보고) console.log((WRITE ? "[써짐] " : "[드라이런] ") + l);
console.log(`\n합계: 치환 ${총치환} · 채움 위 보류 ${총보류} · 잔존(채움보류+스타일 밖) ${총잔존JS}`);
if (!WRITE) console.log("실제 반영: node tools/theme-sweep-pastel.mjs --write");
