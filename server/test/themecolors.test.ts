// [배색 감시 — 2026-08-21 신설(검토관 A⑨ 「이 부류를 잡는 자동 감시가 0이다」)
//                2026-08-30 **명단 → 밝기 계산**으로 교체(검토관 배색 12건 + 설계관)]
//
// 부류: 다크 전용 밝은 글자색 하드코드. 프로 흰 바탕이 토큰을 잉크색으로 뒤집는 구조라,
// 밝은 색을 리터럴로 박으면 흰 테마에서 글씨가 사라진다 — 하루에 8화면에서 같은 병이 났다.
//
// ★ 왜 명단을 버렸나(2026-08-30): 옛 검사는 PASTELS 17색 **명단(denylist)**이라 **새 hex를
//   원리상 못 잡았다.** pro-white.css 주석이 그 사각을 스스로 적어 뒀고, 2026-08-30 검토관이
//   확정한 12건이 **전부 그 구멍**에서 났다(전수 스캔으로는 95곳). 명단은 「이번에 본 색」만
//   막고 다음 색은 통과시킨다 — 그래서 **색을 세지 않고 대비를 잰다**:
//     흰 바탕(#ffffff)에서 WCAG 대비 4.5:1 미만인 글자색은 잉크 장치를 지나야 한다.
//   문턱 4.5인 이유: 대상이 전부 배지·칩·본문(11~12.5px)이고 저장소 글자 하한이 11px이라
//   3:1(대형 텍스트) 조건에 드는 것이 하나도 없다(설계관 ⑤).
//
// 계약:
//   ① 밝은 글자색은 **토큰+폴백**(var(--red-ink, #f5928a) 꼴)으로만 쓴다.
//      스윕: node tools/theme-sweep-pastel.mjs --write (그래도 남는 것은 JS 문자열·인라인 = 손 수리)
//   ② 잉크 토큰은 **pro-white.css 한 곳에서만** 정의한다 — 화면 :root가 정의하면 다크에서
//      폴백이 죽어 색이 조용히 바뀐다(2026-08-21 A① 게시 차단급의 재발 방지).
//   ③ 예외는 「테마 무관 고정 어두운 상자」뿐 — 상자 파일 3종(syslog·terminal·audit)과
//      상자 선택자 줄(.terminal·.log-·.k-block), 같은 줄에 어두운 고정 배경이 있는 인라인,
//      설정의 DB 복구 열쇠 상자(「한 번만 보입니다」). ⚠ agent.html은 **파일 통째 제외를 풀었다**
//      (설계관 ①) — 그 파일 4곳 중 2곳만 진짜 상자(.terminal)였고 나머지 2곳은 실결함이었다.
//   ④ pro-white가 **선택자로 직접 덮은 자리**는 통과 — 소스만 보면 위반처럼 보이지만 화면은
//      멀쩡하다(설계관 ⑤ 오탐 경고: .gcp-qt·.dc-seg span.on·summary·.mv-tile.mv-sel 등).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PAGES = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");
const 제외파일 = /^(lite-|login\.html$|setup\.html$|office\.html$|pro-white\.css$|gijo-ui\.css$|lite-green\.css$)/;
const 상자파일 = new Set(["syslog.html", "terminal.html", "audit.html"]);
/** 「테마 무관 고정 어두운 상자」의 선택자 — 그 안은 **다크가 정답**이라 잉크로 바꾸면 글자가
 *  사라진다(2026-08-30 게시 관문이 [높음] 3건으로 잡은 부류). 예외마다 **이유를 적는다**:
 *   · .terminal / .log- / .k-block — 로그·터미널 고정 상자(2026-08-21 손수리로 확정)
 *   · .tb-menu   — 자산 목록 필터 드롭다운(background:#35342f). 그 파일 주석이 「토큰 금지」를 못박음
 *   · .gn-seg    — 메뉴 판 구분 토글(background:#1f1e1d)
 *   · .gtb-menu / .gtb-seg / .gtb-fr — 상단바 ⚙ 설정 패널(background:#35342f)과 그 안 조각
 *   · .shot .x   — 캡처 썸네일 위 ✕(같은 줄 background:rgba(0,0,0,.6))
 *   · 한 번만 보입니다 — 설정의 DB 복구 열쇠 상자(background:#000). 그 값은 다시 못 본다.
 */
// ⚠ `.log-`를 통째로 빼면 안 된다(2026-08-30 게시 관문 [중]) — learnloop의 학습 로그 **목록**
//   (.log-list·.log-item·.log-q…) 9줄이 상자도 아닌데 감시 밖으로 빠졌다. 진짜 상자만 적는다.
const 상자선택자 = /\.terminal\b|\.log-console|\.log-box\b|\.k-block|\.tb-menu|\.tb-mi\b|\.gn-seg|\.gtb-menu|\.gtb-seg|\.gtb-fr|\.shot\s+\.x|한 번만 보입니다/;
const 상자줄 = /background:\s*#(000|0[0-9a-f]|1[0-9a-f]|2[0-9a-f]|3[0-9a-f])/i;
// 채움(진한 배경) 위 글자 — 두 테마 모두 밝은 글자가 옳다(pro-white --fill-contrast 관례)
const 채움 = /background(?:-color)?\s*:\s*(var\(--(?:g-)?(?:blue|red|teal|amber|purple|green|navy)\b|#[0-9a-fA-F]{3,6}\b|linear-gradient)/;
// 다크 팔레트 리터럴(--text/--muted/--muted-2와 같은 값) — theme-sweep.mjs 계보의 별도 부류.
// 여기서 함께 잡으면 두 스윕이 서로의 결과를 되돌린다(2026-08-21 audit 상자 사고와 같은 꼴).
const 구조색 = new Set(["#e9e7e2", "#b3ada4", "#a49d95"]);
/** JS 대입 예외 — **이유를 반드시 적는다**(이유 없는 예외는 미룸이지 결정이 아니다). */
const JS예외 = new Map([
  // ⚠ 열쇠가 줄 번호라 nav.js 윗부분을 고치면 밀린다(2026-08-31 5그룹 재편에서 697→665로
  //   실제로 밀렸다). 실패 메시지의 줄 번호를 보고 여기만 따라 옮기면 된다 — 예외 대상
  //   자체(wBadge 흰 글자)는 그대로다.
  // 2026-09-02 여정 수리(F4-07 이름 통일)가 nav.js 윗부분을 고쳐 688 → 689로 밀렸다.
  ["nav.js:689", "기한 지난 업무 배지 — 바로 위에서 같은 요소에 background=var(--red,#e2483d)를 깔아 흰 글자가 옳다(채움)"],
]);

function 광도(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** 흰 바탕(#ffffff) 대비 — pro-white의 --panel이 흰색이라 이것이 최악 조건이다. */
const 대비 = (hex: string) => Math.round((1.05 / (광도(hex) + 0.05)) * 100) / 100;
const 정규 = (s: string) => s.replace(/\s+/g, " ").trim();

/** pro-white가 color를 직접 지정한 선택자 목록(계약 ④). 전체 일치로만 인정한다 —
 *  조각 일치로 하면 `b`·`body` 같은 조각이 아무 줄에나 걸려 감시가 통째로 무력해진다. */
function 덮개목록(): Set<string> {
  const pw = fs.readFileSync(path.join(PAGES, "pro-white.css"), "utf-8");
  const out = new Set<string>();
  for (const m of pw.matchAll(/((?:html\.theme-light[^{]*?))\{([^}]*)\}/g)) {
    if (!/(?<![-\w])color\s*:/.test(m[2])) continue;
    m[1].split(",").forEach((s) => {
      const sel = 정규(s.replace(/html\.theme-light/g, ""));
      if (sel) out.add(sel);
    });
  }
  return out;
}

// 헛돌이 계측(2026-08-30 게시 관문 [중]) — 실제로 대비를 **판정한 색의 수**.
// 위 검사들은 잣대(대비 함수·덮개 목록)만 봤지 스캐너가 무엇을 읽었는지는 한 줄도 안 봤다.
// 제외 규칙이 넓어져 모집단이 0이 되면 「위반 0」이 거짓 초록이 된다.
let 판정수 = 0;
function 위반들(): string[] {
  const 덮개 = 덮개목록();
  판정수 = 0;
  const out: string[] = [];
  for (const f of fs.readdirSync(PAGES)) {
    if (!/\.(html|js)$/.test(f) || 제외파일.test(f) || 상자파일.has(f)) continue;
    const 줄들 = fs.readFileSync(path.join(PAGES, f), "utf-8").split(/\r?\n/);
    줄들.forEach((l, i) => {
      if (상자줄.test(l) || 채움.test(l) || 상자선택자.test(l)) return;
      // 바로 앞 3줄에 고정 어두운 배경이 있으면 **같은 상자를 그리는 이웃 줄**이다(설정의 DB
      // 복구 열쇠처럼 배경과 글자가 다른 줄에 나뉜 자리). 선택자 목록만으로는 그 부류를 못 가른다.
      if (줄들.slice(Math.max(0, i - 3), i).some((p) => 상자줄.test(p))) return;
      const b = l.indexOf("{");
      if (b > 0) {
        const 선택자들 = 정규(l.slice(0, b).replace(/^[^.#a-zA-Z*:]*/, "")).split(",").map(정규);
        if (선택자들.some((s) => 덮개.has(s))) return; // 계약 ④
      }
      for (const m of l.matchAll(/(?<![-\w])color\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) {
        const raw = m[1];
        const hex = raw.toLowerCase() === "#fff" ? "#ffffff" : raw.toLowerCase();
        if (구조색.has(hex) || hex.length !== 7) continue;
        if (new RegExp("var\\(--[\\w-]+,\\s*" + raw + "\\)", "i").test(l)) continue; // 장치를 지났다
        판정수++;
        const r = 대비(hex);
        if (r >= 4.5) continue;
        out.push(`${f}:${i + 1} ${raw} (흰 바탕 ${r}:1)`);
      }
      // ★ JS가 **대입**하는 색(2026-08-30 실화면 실측이 드러낸 구멍) — CSS 선언이 아니라
      //   위 검사가 원리상 못 봤다. 실측에서 「고위험 1.32:1」·「202 2.12:1」이 이 무늬였다.
      //   무늬 둘: `el.style.color = "#hex"` · 색 사전 `color: "#hex"`(style 문자열로 소비된다).
      if (JS예외.has(`${f}:${i + 1}`)) return;
      for (const re of [/\.style\.color\s*=\s*[^;\n]*?["'`](#[0-9a-fA-F]{3,6})\b/g,
                        /(?<![-\w])color\s*:\s*["'`](#[0-9a-fA-F]{3,6})\b/g]) {
        re.lastIndex = 0;
        let m2: RegExpExecArray | null;
        while ((m2 = re.exec(l))) {
          const raw = m2[1];
          const hex = raw.toLowerCase() === "#fff" ? "#ffffff" : raw.toLowerCase();
          if (구조색.has(hex) || hex.length !== 7) continue;
          const r = 대비(hex);
          if (r >= 4.5) continue;
          out.push(`${f}:${i + 1} ${raw} (JS 대입, 흰 바탕 ${r}:1)`);
        }
      }
    });
  }
  return out;
}

describe("배색 감시 — 밝은 글자색은 잉크 토큰으로(대비 계산)", () => {
  it("★ 흰 테마에서 사라질 글자색이 0이다 — 색 명단이 아니라 대비로 잰다", () => {
    const v = 위반들();
    expect(v, "흰 바탕에서 4.5:1 미만이라 프로에서 안 보인다 — node tools/theme-sweep-pastel.mjs --write 로 " +
      "토큰화하거나(JS 문자열·인라인은 손 수리), 고정 어두운 상자 안이면 같은 줄에 어두운 배경을 두고 " +
      "파일 주석 규칙을 따르라:\n  " + v.join("\n  ")).toEqual([]);
  });

  // ★★ 반대 방향(2026-08-30 게시 관문이 [높음] 3건으로 잡은 부류) ─────────────────
  //
  // 위 검사는 「밝은 리터럴이 흰 테마에서 사라지는 것」만 본다. 그런데 스윕이 **고정 어두운
  // 상자 안**까지 토큰으로 바꾸면 정반대 사고가 난다 — 라이트에서 잉크(거의 검정)로 뒤집혀
  // 검은 상자 위에서 글자가 사라진다. 실제로 났다:
  //   · settings DB 복구 열쇠(background:#000 상자) 8.2:1 → 3.2:1 — 그 값은 **한 번만 보이고
  //     어디에도 저장되지 않는다.** 잘못 옮겨 적으면 기계 교체 때 DB를 못 연다.
  //   · inventory 필터 드롭다운(.tb-menu #35342f) 선택 항목 1.4:1 — 지금 무슨 필터인지 안 보인다.
  // 위 검사는 `var(토큰, 폴백)` 꼴이면 **무조건 통과**시키므로 이 부류를 원리상 못 본다.
  it("★★ 고정 어두운 상자 안에서는 잉크 토큰을 쓰지 않는다 — 라이트에서 글자가 사라진다", () => {
    const 어두운배경 = /background(?:-color)?\s*:\s*#(000|0[0-9a-f]|1[0-9a-f]|2[0-9a-f]|3[0-9a-f])[0-9a-f]{0,4}\b/i;
    const 잉크토큰 = /var\(--(text-strong|red-ink|teal-ink|amber-ink|blue-ink|purple-ink|muted-ink)\s*,/;
    const 위반: string[] = [];
    for (const f of fs.readdirSync(PAGES)) {
      if (!/\.(html|js)$/.test(f) || 제외파일.test(f)) continue;
      fs.readFileSync(path.join(PAGES, f), "utf-8").split(/\r?\n/).forEach((l, i) => {
        // 같은 줄에 고정 어두운 배경과 잉크 토큰이 함께 있으면 그 자리는 라이트에서 무너진다.
        if (어두운배경.test(l) && 잉크토큰.test(l)) 위반.push(`${f}:${i + 1}`);
      });
    }
    expect(위반, "고정 어두운 배경 위에 잉크 토큰을 얹었다 — 라이트 테마에서 검은 상자 위 검은 글자가 된다. " +
      "그 상자 안은 **다크가 정답**이므로 리터럴(#fff·#1eb980 등)로 두어라:\n  " + 위반.join("\n  ")).toEqual([]);
  });

  it("감시가 헛돌지 않는다 — 잣대가 실제로 무언가를 판정하고 있다", () => {
    // 통과가 「검사가 0건을 읽어서」인지 「진짜 0건이라서」인지 가른다(이 저장소의 거짓 초록 계보).
    expect(대비("#f5928a"), "밝은 살몬은 흰 바탕에서 4.5 미만이어야 한다").toBeLessThan(4.5);
    expect(대비("#b3241a"), "잉크 빨강은 통과해야 한다").toBeGreaterThanOrEqual(4.5);
    expect(덮개목록().size, "pro-white 덮개 선택자를 못 뽑았다 — 계약 ④가 헛돈다").toBeGreaterThanOrEqual(20);
    // ★ **모집단을 잰다** — 잣대만 보면 「스캐너가 아무것도 안 읽어서 0건」인 경우를 못 가른다.
    위반들();
    expect(판정수, "대비를 실제로 판정한 색이 없다 — 제외 규칙이 모집단을 통째로 지웠다(거짓 초록)").toBeGreaterThanOrEqual(3);
  });

  it("잉크 토큰은 pro-white 한 곳에서만 정의된다 — 화면이 정의하면 다크 폴백이 죽는다", () => {
    const 잉크 = ["--red-ink", "--teal-ink", "--amber-ink", "--blue-ink", "--purple-ink", "--muted-ink", "--text-strong"];
    const pw = fs.readFileSync(path.join(PAGES, "pro-white.css"), "utf-8");
    for (const t of 잉크) expect(pw, `${t}가 pro-white에 없다 — 이 장치가 빠지면 흰 테마가 폴백 원색으로 남는다`).toContain(`${t}:`);
    for (const f of fs.readdirSync(PAGES)) {
      if (!/\.(html|js)$/.test(f)) continue;
      const src = fs.readFileSync(path.join(PAGES, f), "utf-8");
      for (const t of 잉크) {
        expect(src.includes(`${t}:`) && !src.includes(`var(${t}`), `${f}가 ${t}를 정의한다 — 금지(다크 폴백이 죽는다)`).toBe(false);
      }
    }
  });

  it("어두운 상자 수리 핀 — 상자 안 대표 색이 고정색으로 남아 있다(스윕이 도로 토큰화하면 실패)", () => {
    const audit = fs.readFileSync(path.join(PAGES, "audit.html"), "utf-8");
    expect(audit).toContain(".aud .act{color:#e9e7e2");
    expect(audit).toContain(".k-block{background:rgba(226,72,61,.16);color:#f5928a;}");
    const syslog = fs.readFileSync(path.join(PAGES, "syslog.html"), "utf-8");
    expect(syslog).toContain(".log-console{background:#1a1a19;color:#e9e7e2");
    // agent.html은 2026-08-30에 파일 통째 제외를 풀었다 — 진짜 상자(.terminal)만 줄 단위로 남는다.
    const agent = fs.readFileSync(path.join(PAGES, "agent.html"), "utf-8");
    expect(agent, "agent의 진짜 상자(.terminal)가 사라졌다 — 줄 단위 예외의 근거가 없어진다").toContain(".terminal{");
  });
});

// ══ 좁은 폭 계약 감시 (2026-08-31 사장님 「대화창 최대일 때 글씨가 안 깨지게」) ══════════
//
// 왜 여기인가: 이 파일은 이미 **화면 CSS를 줄 단위로 읽는** 감시다(배색). 좁은 폭 계약도
// 같은 종류(전 화면 공용 CSS 규칙 + 화면별 반응형)라 잣대를 한 곳에 둔다.
//
// ⚠ 실측기(tools/narrow-probe.mjs)는 **앱을 띄워야** 도는 수동 도구라 게시마다 26화면을
//   돌리면 무겁다. 그래서 기계로 남기는 것은 두 겹이다:
//     ① 여기(소스) — 공용 계약 3줄과 수리한 화면의 반응형이 사라지지 않았는가
//     ② 게시 관문 — 실제 판폭에서 대표 화면이 안 깨지는가(publish-gate-ui 「좁은 폭」 검사)
//   기준(판폭 420px 깨짐 0건/26화면, 2026-08-31 실측)이 문서가 아니라 기계로 남게.
describe("좁은 폭 계약 — 대화창 최대(판 420px)에서 글씨가 안 깨진다", () => {
  it("공용 계약 3줄이 gijo-ui.css에 살아 있다 — 이 파일이 전 화면에 주입된다", () => {
    const css = fs.readFileSync(path.join(PAGES, "gijo-ui.css"), "utf-8");
    expect(css, "한글 어절 중간 꺾임 금지(keep-all)가 사라졌다 — 「저/장」 부류가 돌아온다")
      .toMatch(/body\.g-ui\s*\{[^}]*word-break:\s*keep-all/);
    expect(css, "단추 한 줄 계약(nowrap)이 사라졌다").toMatch(/\.g-ui button[^{]*\{[^}]*white-space:\s*nowrap/);
    expect(css, "문장형 칩 예외(.wrap-ok)가 사라졌다 — 예외가 없으면 긴 안내 단추가 잘린다")
      .toMatch(/\.wrap-ok[^{]*\{[^}]*white-space:\s*normal/);
    const nav = fs.readFileSync(path.join(PAGES, "nav.js"), "utf-8");
    expect(nav, "공용 CSS 주입이 끊겼다 — 계약이 어느 화면에도 안 닿는다").toContain("gijo-ui.css");
  });

  it("좁은 폭에서 접히는 화면 4곳의 반응형이 남아 있다(2026-08-31 수리분)", () => {
    // 화면은 iframe이라 뷰포트=판 폭 — 미디어쿼리가 곧 판 폭 반응이다.
    const 대상: [string, RegExp, string][] = [
      ["inventory.html", /@media\s*\(max-width:\s*720px\)[\s\S]{0,400}\.mv-stage\{[^}]*flex-direction:\s*column/, "🗺 지도: 사이드 320px 고정이 지도를 28px로 눌러 글자가 세로로 뭉갰다"],
      ["aihub.html", /@media\s*\(max-width:\s*720px\)[\s\S]{0,300}\.gh-strip\{grid-template-columns:repeat\(2,1fr\)/, "요약 띠 4열 고정이 카드당 ~95px가 돼 「올린 문서 120」이 꺾였다"],
      ["records.html", /@media\s*\(max-width:\s*720px\)[\s\S]{0,300}\.gh-strip\{grid-template-columns:repeat\(2,1fr\)/, "aihub와 같은 4열 띠 — 같은 수리"],
      ["handover.html", /@media\s*\(max-width:\s*720px\)[\s\S]{0,300}\.chk\{grid-template-columns:1fr/, "점검표 2열이 109px 기둥이 돼 문장이 세로로 뭉갰다"],
    ];
    for (const [파일, re, 왜] of 대상) {
      const s = fs.readFileSync(path.join(PAGES, 파일), "utf-8");
      expect(s, `${파일} — 좁은 폭 반응형이 사라졌다: ${왜}`).toMatch(re);
    }
  });

  it("실측기가 저장소에 있고 합격선을 말한다 — 수동 도구라도 사라지면 기준이 사라진다", () => {
    const probe = fs.readFileSync(path.join(PAGES, "..", "..", "..", "..", "tools", "narrow-probe.mjs"), "utf-8");
    expect(probe, "판폭 기본값(420)이 사라졌다").toMatch(/옵션\("width", "420"\)/);
    // 판정 5종이 다 있는지 — 순서는 코드마다 다를 수 있어 **낱개로** 본다(순서 강제는 헛됨).
    for (const 종류 of ["넘침", "버튼꺾임", "화면밖", "겹침", "세로뭉개짐"]) {
      expect(probe, `실측기 판정 「${종류}」가 사라졌다 — 기준 5종이 줄면 「깨짐 0」의 뜻이 얕아진다`)
        .toContain(`종류: "${종류}"`);
    }
  });
});
