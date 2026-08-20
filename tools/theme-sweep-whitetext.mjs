// tools/theme-sweep-whitetext.mjs — 화면 안 「박힌 흰 글자(color:#fff)」를
// var(--text-strong, #fff)로 바꾸는 스윕. (프로 흰 바탕 공사 4단계 — QA 결함 4호)
//
// ■ 왜 (2026-08-20 프로 QA, 사장님 실측):
//   흰 바탕(프로)에서 제목·수치·이름이 안 보였다 — 「누르기 전에 흰색 코드가 아직 많고
//   / 취약점 분류 빼고는 검정색으로 통일」. 뿌리는 화면 공통 틀의 color:#fff ~250곳
//   (.page-title/.app-title/.ph 계열이 25개 화면에 복붙됨). 손 수리는 두더지잡기라 스윕.
//
// ■ 무엇을 바꾸나:
//   color:#fff → color:var(--text-strong, #fff)
//   --text-strong은 pro-white.css(html.theme-light)만 정의(#1f1b14 잉크).
//   표준(다크)·라이트에는 그 토큰이 없어 **폴백 #fff — 한 픽셀도 안 변한다.**
//
// ■ 채움 위 흰 글자는 남긴다(파란 버튼·빨간 배지 등 — 흰 바탕에서도 채움은 색이라 흰 글자가 맞다):
//   같은 규칙 블록에 진한 배경(background: var(--blue|--red|…) 또는 원시 hex 배경)이 있으면
//   건너뛰고 「보류」로 센다. 원시 hex 배경은 밝기를 안 재고 무조건 보류(과치환 방지).
//
// ■ 안전장치(이스케이프 사고 6회의 교훈 — theme-sweep.mjs와 같은 관례):
//   ① <style> 블록 안만 본다(JS 문자열·인라인 style은 손 수리 몫 — 조용한 오치환 방지).
//   ② 규칙 블록({…}) 단위로 채움을 판정한다.
//   ③ 파일별 치환/보류 수를 보고하고, 끝에 잔존 color:#fff를 다시 세어 맞으면 0으로 끝난다.
//   ④ --write 없이는 아무것도 안 바꾼다(드라이런 기본).
//
// 사용:  node tools/theme-sweep-whitetext.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pages = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "src", "renderer", "pages");
const WRITE = process.argv.includes("--write");

// 제외는 theme-sweep.mjs와 같다: 라이트(자체 층·lite-app만 lite-green을 싣는다) ·
// 로그인/설치(별도 팔레트) · 팀 사무실(canvas — ctx.fillStyle은 var()를 조용히 무시한다).
const EXCLUDE = /^(lite-|login\.html$|setup\.html$|office\.html$)/;
// 진한 채움 판정 — 이 배경 위 흰 글자는 옳다(두 테마 모두).
// rgba(0,…)도 채움이다(검은 반투명 원 — 검토관 하6: docbox .shot .x가 잉크로 바뀌어 있었다).
const FILL = /background(?:-color)?\s*:\s*(var\(--(?:g-)?(?:blue|red|teal|amber|purple|green|navy)\b|#[0-9a-fA-F]{3,8}\b|linear-gradient|rgba\(\s*0\s*,)/;
const WHITE = /(?<![-\w])color\s*:\s*#fff\b(?!f)/g; // color:#fff만 — border-color·#fffa 등 제외
// 블록 판정이 원리상 못 보는 채움 — ① JS가 나중에 배경을 칠하는 선택자(.hm-cell = analysis
// 히트맵, 심각도색 inline) ② **부모 규칙이 채움**인 자식 선택자(.fchip.on b — 검토관 중4:
// 파란 칩 위 건수가 잉크로 바뀌어 안 읽혔다). 둘 다 흰 글자가 맞다.
const JS_FILL_SELECTOR = /\.hm-cell\b|\.fchip\.on b\b/;

const targets = [
  ...fs.readdirSync(pages).filter((f) => f.endsWith(".html") && !EXCLUDE.test(f)),
  "gijo-ui.css", // 공용 부품(버튼·칩·KPI) — 같은 병이 공용에도 있다(g-ct·g-kpi .kv 등)
];
let 총치환 = 0, 총보류 = 0;
const 보고 = [];
for (const f of targets) {
  const full = path.join(pages, f);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, "utf8");
  // CSS 본문 추출 — .css는 전체, .html은 <style> 블록만
  const spans = [];
  if (f.endsWith(".css")) spans.push([0, src.length]);
  else for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    spans.push([m.index + m[0].indexOf(">") + 1, m.index + m[0].length - "</style>".length]);
  if (!spans.length) continue;
  let out = src, n = 0, 보류 = 0;
  // 뒤에서부터 치환(앞 오프셋 보존)
  for (const [s, e] of spans.reverse()) {
    let css = out.slice(s, e);
    css = css.replace(WHITE, (hit, off, whole) => {
      // 이 지점을 품은 규칙 블록 {…} — 가장 가까운 여는 중괄호부터 닫는 중괄호까지
      const open = whole.lastIndexOf("{", off);
      const close = whole.indexOf("}", off);
      const block = open >= 0 && close >= 0 ? whole.slice(open, close) : "";
      const sel = open >= 0 ? whole.slice(whole.lastIndexOf("}", open) + 1, open) : "";
      if (FILL.test(block) || JS_FILL_SELECTOR.test(sel)) { 보류++; return hit; }
      n++;
      return "color:var(--text-strong, #fff)";
    });
    out = out.slice(0, s) + css + out.slice(e);
  }
  // ── 인라인 패스(검토관 2026-08-20 상3) — <style> 밖(마크업 style= 속성·JS cssText 문자열)에
  //    25곳이 남아 「잔존=보류」 초록이 거짓 안심이었다(검사 모집단=치환 모집단 함정).
  //    판정 단위는 **그 줄**: 같은 줄에 채움이 있으면 보류(한 줄에 두 요소가 섞이면 보수적으로
  //    남긴다), 없으면 치환. .html의 <style> 구간은 위에서 이미 처리됐으니 건너뛴다.
  if (!f.endsWith(".css")) {
    const styleSpans = [];
    for (const m of out.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)) styleSpans.push([m.index, m.index + m[0].length]);
    const 스타일안 = (i) => styleSpans.some(([s, e]) => i >= s && i < e);
    const lines = out.split("\n");
    let pos = 0;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (WHITE.test(line)) {
        WHITE.lastIndex = 0;
        if (!스타일안(pos)) {
          if (FILL.test(line) || JS_FILL_SELECTOR.test(line)) 보류 += (line.match(WHITE) || []).length;
          else { n += (line.match(WHITE) || []).length; lines[li] = line.replace(WHITE, "color:var(--text-strong, #fff)"); }
        }
      }
      WHITE.lastIndex = 0;
      pos += line.length + 1;
    }
    out = lines.join("\n");
  }
  if (!n && !보류) continue;
  총치환 += n; 총보류 += 보류;
  보고.push(`${f.padEnd(24)} 치환 ${String(n).padStart(3)} · 채움보류 ${보류}`);
  if (WRITE && n) fs.writeFileSync(full, out);
}
console.log(보고.join("\n"));
console.log(`\n합계: 치환 ${총치환} · 채움 위 보류 ${총보류} ${WRITE ? "(반영됨)" : "(드라이런 — --write로 반영)"}`);

// 소리 나는 검증 — 반영 후 잔존 = 보류 수와 정확히 같아야 한다(치환이 조용히 빠지면 여기서 잡힌다).
// ⚠ 검사 모집단은 **파일 전체**다 — <style> 안만 다시 세면 치환 모집단과 같아져 인라인 잔존이
//   초록 뒤에 숨는다(검토관 2026-08-20 상3이 정확히 그 함정을 잡았다).
if (WRITE) {
  let 잔존 = 0;
  for (const f of targets) {
    const full = path.join(pages, f);
    if (!fs.existsSync(full)) continue;
    잔존 += (fs.readFileSync(full, "utf8").match(WHITE) || []).length;
  }
  if (잔존 !== 총보류) {
    console.error(`✗ 검증 실패: 잔존 color:#fff ${잔존} ≠ 보류 ${총보류} — 치환이 샜다`);
    process.exit(1);
  }
  console.log(`✓ 검증: 잔존 ${잔존} = 채움 보류 ${총보류} (전부 의도된 자리, 파일 전체 계수)`);
}
