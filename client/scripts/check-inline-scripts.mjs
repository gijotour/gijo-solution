// 화면 HTML 안의 <script> 문법을 빌드 때 검사한다.
//
// ⚠ 왜 빌드에 넣는가(2026-08-01 실사고). app.html에서 코드를 잘라내며 **고아 `});`를 남겼고**,
//   그 한 줄이 셸 스크립트를 통째로 죽여 `window.gijoTabs`가 안 만들어졌다.
//   그러면 왼쪽 메뉴를 누를 때 "탭 열기"가 아니라 **앱을 통째로 갈아치우는** 길로 빠져,
//   열어 둔 탭과 대화창이 전부 사라진다. 게시본까지 그 상태로 나갈 뻔했다.
//
//   검사 도구는 이미 있었다 — **내가 자른 뒤에 안 돌렸을 뿐이다.**
//   `npm run build`는 tsc만 돌아서 HTML은 아무도 안 본다. 사람 기억에 기대면 또 빠뜨린다.
//   그래서 빌드가 대신 본다.
//
// ⚠ tsc는 HTML을 모른다. 이 검사가 유일한 관문이다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer", "pages");
const 파일 = fs.readdirSync(pages).filter((f) => f.endsWith(".html"));
const 나쁜 = [];
let 본블록 = 0;

for (const f of 파일) {
  const s = fs.readFileSync(path.join(pages, f), "utf8");
  // src= 없는(=본문이 든) script만 본다.
  for (const m of s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    본블록++;
    try {
      new Function(m[1]);
    } catch (e) {
      // 몇 번째 줄인지 알려 준다 — 파일이 길어 눈으로 못 찾는다.
      const 앞 = s.slice(0, m.index).split("\n").length;
      나쁜.push(`${f} (script 시작 ${앞}행 근처): ${e.message}`);
    }
  }
}

if (본블록 === 0) {
  console.error("[check-inline-scripts] 검사한 블록이 0개다 — 정규식이 헛돈다. 이 검사를 믿으면 안 된다.");
  process.exit(1);
}
if (나쁜.length) {
  console.error(`[check-inline-scripts] 화면 스크립트 문법 오류 ${나쁜.length}건:`);
  for (const x of 나쁜) console.error("  · " + x);
  process.exit(1);
}
console.log(`[check-inline-scripts] ${파일.length}개 화면 · script ${본블록}블록 문법 OK`);
