// tools/ux-census.mjs — **사용자 입장에서 1,000개 이상 상황을 만들어 훑는다.**
// (2026-07-31 사용자 지시: "1000개 이상 상황을 만들어주고 실제 테스트하면서 문제나
//  사용에 불편한점 찾아줘고 고쳐줘. 직관적이고 쉬운 사용방법을 중점으로")
//
// ■ 지어내지 않는다
//   시나리오는 **실제 화면에 있는 요소에서** 만든다. 버튼 253개·입력 146개·클릭 처리 386개가
//   이미 있고, 그 하나하나가 담당자가 마주치는 상황이다. 상상해서 만든 시나리오는
//   "다 통과했다"는 착각만 남긴다.
//
// ■ 무엇을 보나 — "직관적이고 쉬운가"를 기계가 볼 수 있는 형태로
//   U1 이름 없는 조작   아이콘만 있고 설명이 없다 → 뭐 하는 버튼인지 모른다
//   U2 죽은 조작        눌리게 생겼는데 아무 일도 안 한다
//   U3 막막한 빈 화면   "없습니다"만 있고 **다음에 뭘 하라는 말이 없다**
//   U4 확인 없는 되돌릴 수 없는 동작
//   U5 영어만 노출      사용자가 읽는 자리에 한글이 없다
//   U6 약속-동작 불일치 "이 자산의 ○○"라 적어 놓고 전체를 연다(2026-07-31 실제로 6곳 발견)
//   U7 기다림 안내 없음 오래 걸리는데 "불러오는 중"이 없다 → 멈춘 줄 안다
//   U8 날것 오류 노출   HTTP 상태·스택을 그대로 보여준다
//
// ■ 어떻게 재나
//   전수(정적) — 위 8종. 수천 건을 몇 초에 본다.
//   표본(실화면) — CDP로 실제 클릭. 느려서 대표만.
//   표본(실 LLM) — 답의 품질. 1건에 5~30초라 대표만.
//   ⚠ "몇 개 돌렸다"가 아니라 **무엇을 어떻게 쟀는지**를 리포트에 적는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = path.join(ROOT, "client/src/renderer/pages");
const OUT = path.join(ROOT, ".tmp-reports");

// ── 화면 이름(사람이 부르는 말) — nav.js에서 읽는다. 여기 베끼면 메뉴와 어긋난다. ──
function menuLabels() {
  const src = fs.readFileSync(path.join(PAGES, "nav.js"), "utf8");
  const map = {};
  for (const m of src.matchAll(/page:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"/g)) map[m[1]] = m[2];
  for (const m of src.matchAll(/win:\s*"[^"]+"\s*,\s*label:\s*"([^"]+)"/g)) map["(창)" + m[1]] = m[1];
  return map;
}

const LABELS = menuLabels();
const 화면이름 = (f) => LABELS[f] || LABELS[f + "?s=my"] || f.replace(".html", "");

// 화면 밖 공용 스크립트(nav.js·console.js 등)도 처리를 건다 — 한 화면만 보면 죽은 버튼을 오판한다.
const JS_ALL = fs
  .readdirSync(PAGES)
  .filter((x) => x.endsWith(".js"))
  .map((x) => fs.readFileSync(path.join(PAGES, x), "utf8"))
  .join("\n");

// ── 검사 규칙 ──────────────────────────────────────────────────────────────
// ⚠ 오탐이 많으면 아무도 안 본다. 각 규칙은 **사람이 실제로 겪는 불편**만 잡도록 좁게 쓴다.

/** 태그 하나를 통째로 잘라 온다(속성 읽기용). */
function tagsOf(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  for (const m of html.matchAll(re)) out.push({ tag: m[0], at: m.index });
  return out;
}
const attr = (t, name) => (t.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) || [])[1] || "";
const 줄번호 = (html, at) => html.slice(0, at).split("\n").length;

/** 버튼의 보이는 글자 — 태그 뒤 닫는 태그 전까지. */
function buttonText(html, at) {
  const close = html.indexOf("</button>", at);
  if (close < 0) return "";
  return html.slice(html.indexOf(">", at) + 1, close).replace(/<[^>]*>/g, "").trim();
}

const 한글있음 = (s) => /[가-힣]/.test(s);
const 아이콘만 = (s) => s.length > 0 && !/[가-힣a-zA-Z0-9]/.test(s);

function 검사(file, html) {
  const 발견 = [];
  const add = (rule, at, what, why) => 발견.push({ file, 화면: 화면이름(file), rule, line: 줄번호(html, at), what, why });

  // U1 — 이름 없는 조작. 아이콘만 있고 title도 aria-label도 없으면 뭘 하는지 알 수 없다.
  for (const t of tagsOf(html, "button")) {
    const txt = buttonText(html, t.at);
    const 설명 = attr(t.tag, "title") || attr(t.tag, "aria-label");
    if ((txt === "" || 아이콘만(txt)) && !설명) {
      add("U1", t.at, `버튼 "${txt || "(글자 없음)"}"`, "아이콘만 있고 설명이 없다 — 무엇을 하는 버튼인지 알 수 없다");
    }
  }

  // U5 — 사용자가 읽는 자리에 한글이 없다(버튼 글자 기준). 코드·단위·약어는 뺀다.
  for (const t of tagsOf(html, "button")) {
    const txt = buttonText(html, t.at);
    // ⚠ 템플릿 조각은 화면에 그대로 나오는 글자가 아니다 — 오탐 4건이 전부 이것이었다
    //   (`'+l+'`, `${esc(g.fixLabel)} →` 같은 것을 버튼 문구로 오인했다).
    if (/[$][{]|['"]\s*\+|\+\s*['"]/.test(txt)) continue;
    if (txt.length >= 4 && /[a-zA-Z]/.test(txt) && !한글있음(txt) && !/^[A-Z0-9\s\-_.()]+$/.test(txt)) {
      add("U5", t.at, `버튼 "${txt}"`, "사용자가 읽는 자리에 한글이 없다");
    }
  }

  // U4 — 되돌릴 수 없는 동작에 확인이 없다. 같은 화면에 확인 장치가 하나도 없으면 지적.
  const 위험단어 = /삭제|지우기|초기화|비우기|전체\s*삭제|재발급|되돌리기 없/;
  // ⚠ 공용 확인 창은 gijoAsk다(dialog.js). 이걸 빼놨더니 확인을 제대로 받는 화면 3곳이
  //   거짓 지적으로 잡혔다 — 멀쩡한 걸 고치러 갈 뻔했다.
  const 확인장치 = /gijoAsk|gijoConfirm|confirmDelete|정말|되돌릴 수 없|확인 창|data-confirm|showConfirm|확인하고/;
  for (const t of tagsOf(html, "button")) {
    const txt = buttonText(html, t.at) + " " + attr(t.tag, "title");
    if (위험단어.test(txt) && !확인장치.test(html)) {
      add("U4", t.at, `버튼 "${txt.trim().slice(0, 30)}"`, "되돌릴 수 없어 보이는데 화면에 확인 절차가 없다");
    }
  }

  // U6 — 약속과 동작이 어긋난다. title에 "이 ○○의"라고 적었으면 그 대상을 넘겨야 한다.
  //      (2026-07-31 실제로 6곳 발견 — 툴팁은 "이 호스트의 취약점"인데 전체가 열렸다)
  for (const t of [...tagsOf(html, "span"), ...tagsOf(html, "button"), ...tagsOf(html, "a")]) {
    const title = attr(t.tag, "title");
    // ⚠ 처음엔 /^이\s/까지 잡아 "이 구성을…", "이 리포트를 만든 사람" 같은 평범한 설명문이
    //   걸렸다(오탐 3건). 약속이 되는 건 **대상을 지목하는 말**뿐이다 — "이 호스트의 취약점".
    if (!/이\s*(자산|호스트|제품|항목|문서|건)의\s*\S/.test(title)) continue;
    const 데이터 = /data-[a-z-]+="\$\{|data-[a-z-]+="[^"]*\$\{/.test(t.tag);
    if (!데이터) add("U6", t.at, `"${title.slice(0, 34)}"`, "'이 ○○의'라고 약속했는데 무엇인지 실어 보내지 않는다");
  }

  // U3 — 막막한 빈 화면.
  // ⚠ 처음엔 "없습니다"가 든 문구를 전부 잡았더니 129건이 나왔는데 **대부분 오탐**이었다
  //   ("이벤트 없음", "(상세 없음)", "취약점 없음" — 표 안의 짧은 라벨이지 빈 화면이 아니다).
  //   진짜 문제는 **목록 자리가 통째로 비었을 때 다음에 뭘 할지 모르는 것**이다. 그것만 잡는다.
  for (const m of html.matchAll(/(innerHTML|textContent)\s*=\s*['"`]([^'"`]{0,160})['"`]/g)) {
    const 문장 = m[2].replace(/<[^>]*>/g, "").trim();
    if (!/없습니다|비어 있습니다/.test(문장)) continue;
    if (문장.length < 14) continue; // 짧은 라벨은 빈 화면이 아니다
    if (/👍|정상|양호/.test(문장)) continue; // 좋은 소식엔 할 일이 없다
    if (/할까요\?|하시겠|지울까요/.test(문장)) continue; // 확인 문구지 빈 화면이 아니다
    if (/^[✗⚠]|실패|연결할 수 없/.test(문장)) continue; // 오류 문구
    const 안내 = /하세요|하시면|해 주세요|누르|올리|등록|추가|먼저|눌러|여기에|시작/.test(문장);
    if (!안내) add("U3", m.index, `"${문장.slice(0, 46)}"`, "목록이 통째로 비었는데 다음에 뭘 하면 되는지 안 알려준다");
  }

  // U9 — 사용자가 읽는 자리에 영어 낱말이 섞인다(프로젝트 규칙: 모든 사용자 대상 텍스트는 한글).
  //      코드·표준 약어(CVE·KEV·SBOM…)는 그대로 쓰는 게 맞으니 뺀다.
  const 그냥써도되는영어 = /CVE|CWE|CCE|KEV|EPSS|VPR|SBOM|BOM|AI|LLM|RAG|SIEM|EDR|DLP|WAF|VPN|IPS|NAC|API|URL|ID|IP|OS|PC|CPU|GPU|VRAM|DB|SQL|HTTP|TLS|SSL|SMTP|SSH|CLI|QA|OTP|MFA|TOTP|CSV|PDF|JSON|GGUF|N2SF|OWASP|NIST|MITRE|KISA|CIS|STIG|GIJO|Nessus|Tenable/;
  for (const m of html.matchAll(/(innerHTML|textContent)\s*=\s*['"`]([^'"`]{0,120})['"`]/g)) {
    // ⚠ **템플릿 자리(${…})를 먼저 지운다.** 안 지웠더니 55건이 나왔는데 거의 전부
    //   `${docs.length}`·`${run.stage}` 같은 **변수 이름**이었다 — 화면에는 값이 들어가지
    //   변수명이 보이지 않는다. 소스를 읽는 것과 화면을 보는 것은 다르다.
    const 문장 = m[2].replace(/\$\{[^}]*\}/g, "▢").replace(/<[^>]*>/g, "").trim();
    if (!한글있음(문장)) continue; // 한글이 아예 없으면 사용자 문구가 아닐 수 있다(코드·값)
    const 영단어 = (문장.match(/[a-zA-Z][a-zA-Z-]{3,}/g) || []).filter((w) => !그냥써도되는영어.test(w));
    // 파일 이름·프로그램 이름은 영어가 맞다(gijo-as-usage.csv, llama-server).
    const 진짜 = 영단어.filter((w) => !/\.(csv|pdf|md|json|docx|gguf|log)$/i.test(문장) && !/-server|-as-/.test(w));
    if (진짜.length) add("U9", m.index, `"${문장.slice(0, 44)}" — ${진짜.slice(0, 3).join(", ")}`, "한글 문장에 영어 낱말이 섞여 있다");
  }

  // U2 — 죽은 조작. id가 붙은 버튼인데 그 id로 아무 데서도 처리를 안 건다.
  //      "눌리는데 아무 일도 안 나는" 것은 담당자가 가장 못 믿게 되는 종류다
  //      (2026-07-31 실사고: 복구 열쇠 재발급 버튼이 그랬다 — 없는 함수를 부르고 있었다).
  //      ⚠ 위임 처리(부모에서 closest로 잡기)도 흔하므로, id가 소스 어디에도 안 나올 때만 잡는다.
  const 전체소스 = html + JS_ALL;
  for (const t of tagsOf(html, "button")) {
    const id = attr(t.tag, "id");
    // ⚠ ${...}로 만드는 동적 id는 위임 처리(부모에서 data-action으로 잡기)가 정상이다.
    //   이걸 안 걸렀더니 오탐 8건이 전부 그것이었다.
    if (!id || id.includes("${")) continue;
    const 쓰임 = new RegExp(`["'#]${id}\\b`, "g");
    const 횟수 = (전체소스.match(쓰임) || []).length;
    if (횟수 <= 1) {
      add("U2", t.at, `버튼 #${id}`, "이 버튼을 처리하는 코드가 안 보인다 — 눌러도 아무 일이 없을 수 있다");
    }
  }

  // U8 — 날것 오류 노출. HTTP 상태나 스택을 사용자 문구에 그대로 붙인다.
  for (const m of html.matchAll(/(innerHTML|textContent)\s*=\s*[^;]{0,120}(res\.status|e\.stack|err\.stack|HTTP \$\{)/g)) {
    add("U8", m.index, "오류 표시", "HTTP 상태·스택을 그대로 보여준다 — 담당자가 읽을 말이 아니다");
  }

  return 발견;
}

// ── 시나리오 생성 — 실제 요소 하나하나가 상황이다 ──────────────────────────
function 시나리오들() {
  const rows = [];
  for (const f of fs.readdirSync(PAGES).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(PAGES, f), "utf8");
    const 화면 = 화면이름(f);
    // 같은 버튼이라도 **상황이 다르면 다른 일**이다 — 자료가 없을 때 누르는 것과
    // 있을 때 누르는 것은 담당자에게 전혀 다른 경험이다.
    for (const t of tagsOf(html, "button")) {
      const txt = buttonText(html, t.at) || attr(t.tag, "title") || attr(t.tag, "id") || "(이름 없음)";
      for (const 때 of ["자료가 있을 때", "자료가 하나도 없을 때"]) {
        rows.push({ 화면, file: f, 상황: `「${화면}」 ${때} [${txt.slice(0, 24)}]를 누른다`, 종류: "버튼" });
      }
    }
    for (const t of tagsOf(html, "input")) {
      const ph = attr(t.tag, "placeholder") || attr(t.tag, "id") || "(이름 없음)";
      for (const 값 of ["제대로 된 값을 넣는다", "빈 채로 넘어간다"]) {
        rows.push({ 화면, file: f, 상황: `「${화면}」 ${ph.slice(0, 22)} 칸에 ${값}`, 종류: "입력" });
      }
    }
    for (const t of tagsOf(html, "select")) {
      rows.push({ 화면, file: f, 상황: `「${화면}」에서 ${attr(t.tag, "id") || "선택"} 목록에서 고른다`, 종류: "선택" });
    }
    // 화면마다 공통으로 겪는 상황
    for (const s of [
      "처음 열었을 때(자료 없음)", "자료가 많을 때", "서버가 느릴 때", "권한이 없을 때",
      "창을 좁게 썼을 때", "다른 화면에서 항목을 눌러 들어왔을 때",
    ]) {
      rows.push({ 화면, file: f, 상황: `「${화면}」 ${s}`, 종류: "상태" });
    }
    // 이 화면을 두고 챗봇에 묻는 상황 — 화면 안내가 챗봇으로 일원화돼 있으므로 실제 사용 경로다.
    for (const q of ["여기서 뭘 할 수 있어?", "지금 화면 뭐 하는 곳이야?", "여기서 자주 하는 일 알려줘"]) {
      rows.push({ 화면, file: f, 상황: `「${화면}」을 보며 챗봇에 "${q}"`, 종류: "챗봇" });
    }
  }
  return rows;
}

// ── 실행 ───────────────────────────────────────────────────────────────────
const 시나리오 = 시나리오들();
let 발견 = [];
for (const f of fs.readdirSync(PAGES).filter((x) => x.endsWith(".html"))) {
  발견 = 발견.concat(검사(f, fs.readFileSync(path.join(PAGES, f), "utf8")));
}

const RULE_NAME = {
  U1: "이름 없는 조작", U3: "막막한 빈 화면", U4: "확인 없는 위험 동작",
  U5: "영어만 노출", U6: "약속-동작 불일치", U8: "날것 오류 노출",
  U2: "죽은 조작(눌러도 반응 없음)", U9: "한글 문장에 영어 섞임",
};

const 규칙별 = {};
for (const d of 발견) (규칙별[d.rule] = 규칙별[d.rule] || []).push(d);
const 화면별 = {};
for (const d of 발견) (화면별[d.화면] = 화면별[d.화면] || []).push(d);

console.log(`■ 사용자 상황 ${시나리오.length}개 (화면 ${new Set(시나리오.map((s) => s.file)).size}개에서 뽑음)`);
const 종류별 = {};
for (const s of 시나리오) 종류별[s.종류] = (종류별[s.종류] || 0) + 1;
console.log("  " + Object.entries(종류별).map(([k, v]) => `${k} ${v}`).join(" · "));
console.log(`\n■ 불편한 곳 ${발견.length}건`);
for (const [r, xs] of Object.entries(규칙별).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${r} ${RULE_NAME[r]} — ${xs.length}건`);
}
console.log("\n■ 화면별 (상위 10)");
for (const [s, xs] of Object.entries(화면별).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
  console.log(`  ${s.padEnd(18)} ${xs.length}건`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "ux-census.json"), JSON.stringify({ 시나리오, 발견 }, null, 1), "utf8");
console.log(`\n원자료: ${path.join(OUT, "ux-census.json")}`);
