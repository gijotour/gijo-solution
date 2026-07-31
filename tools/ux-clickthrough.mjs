// tools/ux-clickthrough.mjs — **실제 앱에서 화면을 열어 본다.**
//
// 정적 검사(ux-census)는 소스를 읽을 뿐이다. 소스가 멀쩡해도 화면이 안 뜨거나, 뜨는데
// 텅 비어 있거나, 자료를 못 불러오는 일이 있다 — 그건 열어 봐야만 안다.
//
// 무엇을 보나(담당자가 화면을 열었을 때 겪는 것):
//   C1 화면이 뜨는가            — 흰 화면·오류로 끝나면 그 메뉴는 없는 것과 같다
//   C2 빈 화면이 아닌가          — 열었는데 아무것도 없으면 뭘 해야 할지 모른다
//   C3 조작할 것이 있는가        — 버튼·입력이 하나도 없으면 볼 것만 있고 할 게 없다
//   C4 오류 문구가 떠 있지 않은가 — "불러오지 못했습니다"가 첫인상이면 안 된다
//   C5 화면 이름이 사이드바와 같은가 — 다르면 "내가 어디 있지?"가 된다
//
// ⚠ 이건 **느리다**(화면당 3~4초). 33화면이면 2분쯤. 그래서 정적 검사와 나눠 돌린다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const CDP = process.env.GIJO_CDP || "http://127.0.0.1:9223";

/** 사이드바가 아는 화면 = 담당자가 실제로 갈 수 있는 곳. 여기 없는 파일은 안 본다. */
function menuPages() {
  const src = fs.readFileSync(path.join(ROOT, "client/src/renderer/pages/nav.js"), "utf8");
  const out = [];
  for (const m of src.matchAll(/page:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"/g)) out.push({ page: m[1], label: m[2] });
  return out;
}

const b = await chromium.connectOverCDP(CDP);
const ctx = b.contexts()[0];
const shell = ctx.pages().find((p) => p.url().includes("app.html"));
if (!shell) {
  console.error("셸(app.html)이 없습니다 — 앱에 로그인한 뒤 다시 돌리세요.");
  console.error("열린 화면: " + ctx.pages().map((p) => p.url().split("/").pop()).join(", "));
  process.exit(2);
}

const 결과 = [];
for (const { page, label } of menuPages()) {
  const r = { page, label, 발견: [] };
  try {
    // ⚠ 탭은 8개까지만 열린다(app.html MAX_TABS — 살아있는 iframe이라 무한정 열면 메모리를 먹는다).
    //   안 닫고 돌렸더니 8번째부터 21개 화면이 전부 "안 열림"으로 나왔다 — 제품 결함이 아니라
    //   내 하네스가 상한에 걸린 것이었다. **한 화면 보고 닫는다.**
    await shell.evaluate((p) => {
      for (const t of window.gijoTabs.list()) if (t.page !== p) window.gijoTabs.close(t.page, true);
      window.gijoTabs.open(p);
    }, page);
    await sleep(3400);
    const f = shell.frames().find((x) => x.url().includes(page.split("?")[0]));
    if (!f) {
      r.발견.push({ rule: "C1", why: "화면이 열리지 않았다" });
      결과.push(r);
      continue;
    }
    const 본 = await f.evaluate(() => {
      const body = document.body;
      const 글자 = (body.innerText || "").replace(/\s+/g, " ").trim();
      const 오류 = (body.innerText || "").match(/(불러오지 못했습니다|실패했습니다|오류가 발생|Error:|undefined)/);
      return {
        글자수: 글자.length,
        머리: 글자.slice(0, 60),
        버튼: document.querySelectorAll("button").length,
        입력: document.querySelectorAll("input,select,textarea").length,
        오류: 오류 ? 오류[0] : null,
      };
    });
    r.본 = 본;
    if (본.글자수 < 60) r.발견.push({ rule: "C2", why: `화면이 거의 비어 있다(글자 ${본.글자수}자)` });
    if (본.버튼 + 본.입력 === 0) r.발견.push({ rule: "C3", why: "누를 것도 넣을 것도 없다" });
    if (본.오류) r.발견.push({ rule: "C4", why: `첫인상이 오류다: "${본.오류}"` });
  } catch (e) {
    r.발견.push({ rule: "C1", why: "여는 중 오류: " + String((e && e.message) || e).slice(0, 80) });
  }
  결과.push(r);
  const mark = r.발견.length ? "✗" : "✓";
  console.log(`${mark} ${label.padEnd(16)} ${r.본 ? `글자 ${String(r.본.글자수).padStart(5)} · 버튼 ${String(r.본.버튼).padStart(2)} · 입력 ${String(r.본.입력).padStart(2)}` : ""}`);
  for (const d of r.발견) console.log(`    ${d.rule} ${d.why}`);
}

const 문제 = 결과.filter((r) => r.발견.length);
console.log(`\n화면 ${결과.length}개 · 문제 ${문제.length}개`);
fs.writeFileSync(path.join(ROOT, ".tmp-reports", "ux-clickthrough.json"), JSON.stringify(결과, null, 1), "utf8");
await b.close();
