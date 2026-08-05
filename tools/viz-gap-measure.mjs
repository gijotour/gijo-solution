// tools/viz-gap-measure.mjs — 「누르면 목록이 좁혀집니다」가 **실제로 보이는지** 실앱에서 잰다.
//
// 왜 만들었나 (2026-08-05)
// ────────────────────────
// 그림 띠에는 "누르면 목록이 좁혀집니다"라고 적혀 있다. 작업 내역 화면에서 실측해 보니 띠는
// y=100, 그 목록은 y=982 — **880px 떨어져** 있었다. 막대를 눌러도 좁혀진 목록이 한 화면에
// 안 보이니, 적어 둔 안내가 사실상 거짓이 된다. 눈으로는 잘 안 잡힌다(띠도 목록도 "있긴" 하다).
//
// ⚠ 첫 판은 **엉뚱한 것을 쟀다**. 「띠 아래 가장 가까운 표·리스트」를 목록으로 삼았더니
//   자산 화면에서 개수 뱃지(span#tabCountList, 높이 22px)를 목록으로 잡고 27px이라 초록을 줬다.
//   프록시를 재면 초록이 나와도 뜻이 없다 — 오늘 이 함정에 두 번 걸렸다(시험이 제품 아닌
//   시험을 재던 일). 그래서 **약속 자체를 잰다**:
//     ① 띠가 보이도록 스크롤한다(사용자가 막대를 누르는 순간의 상태)
//     ② 막대를 실제로 누른다
//     ③ 내용이 바뀐 자리를 찾는다 — 그게 이 화면이 말한 "목록"이다(추측이 아니라 관측)
//     ④ 그 자리가 **누른 그 화면 안에 보이는지** 판정한다
//
// 판정
//   ✓ 바뀐 자리가 화면 안에서 시작한다 — 누르면 결과가 바로 보인다.
//   △ 화면 밖이지만 300px 이내 — 조금만 내리면 보인다.
//   ✗ 300px 넘게 화면 밖 — 눌러도 결과를 못 본다. 띠 자리를 옮겨야 한다.
//
// ⚠ 접힌 구역은 접힌 채로 잰다 — 사용자가 그렇게 쓴다(2026-08-04 확립).
// ⚠ 콘솔 오류도 함께 모은다. 띠가 안 그려질 때 "데이터 0건"인지 **코드가 죽은 것**인지
//   가려야 한다 — products 화면에서 없는 함수를 불러 띠가 통째로 사라진 적이 있다(2026-08-05).

import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const 화면 = [
  "analysis.html", "approvals.html", "audit.html", "compliance.html", "hardening.html",
  "inventory.html", "maintenance.html", "memory.html", "products.html", "report.html",
  "sbom.html", "sessions.html", "syslog.html", "threat.html", "vulnscan.html",
];

// 기본 9223 — QA 전수조사가 쓰는 자리다(sweep·shell·download와 같은 앱을 본다).
// ⚠ 그 자리에 **설치본**(app.asar)이 떠 있으면 방금 고친 HTML이 없다. 고친 것을 재려면
//   개발 실행을 따로 띄우고 CDP_PORT=9224로 부른다. 어느 쪽을 쟀는지 아래에서 밝힌다.
const PORT = process.env.CDP_PORT || "9223";
const browser = await chromium.connectOverCDP("http://localhost:" + PORT);
const ctx = browser.contexts()[0];

const pages = ctx.pages();
const hub = pages.find((p) => p.url().includes("hub.html")) || pages.find((p) => !p.url().includes("office.html"));
if (!hub) { console.log("✗ 창을 못 찾음 — 클라가 떠 있고 로그인돼 있는지 확인"); process.exit(1); }

// 설치본을 재고 있는지 밝힌다 — 개발 중 고친 HTML이 없는 앱을 재고 "통과"라 말하면 거짓이 된다.
const 설치본 = hub.url().includes("app.asar");

const 오류들 = [];
hub.on("console", (m) => { if (m.type() === "error") 오류들.push(m.text().slice(0, 160)); });

const 결과 = [];
for (const 파일 of 화면) {
  오류들.length = 0;
  await hub.evaluate((f) => window.gijo.navigateTo(f), 파일).catch(() => {});
  await sleep(1200);

  // hub는 iframe 컨테이너 — **렌더된 프레임**을 골라야 한다(스테일 중복 프레임 주의).
  // ⚠ "마지막 프레임"으로 고르면 안 된다(2026-08-05 실측). 같은 주소의 숨은 프레임이 남아 있으면
  //   그쪽을 잡는데, 숨은 프레임은 모든 요소 높이가 0이라 "띠가 비어 있음"·"바뀌는 자리 없음"으로
  //   나온다 — 데이터가 0건인 것으로 **오독**하게 된다. 실제로 그려진(높이 있는) 프레임을 고른다.
  const frames = hub.frames().filter((f) => f.url().includes(파일));
  let frame = null;
  for (const f of frames) {
    const 보임 = await f.evaluate(() => document.body.getBoundingClientRect().height > 0).catch(() => false);
    if (보임) frame = f;
  }
  if (!frame) { 결과.push({ 파일, 상태: frames.length ? "프레임이 전부 숨겨져 있음" : "프레임 없음" }); continue; }

  // ⚠ **다 그려질 때까지 기다린다**(2026-08-05 실측). 고정 2.8초로 쟀더니 통합 관제·시스템 로그·
  //   조치·승인 세 화면이 "띠가 비어 있음"으로 나왔다 — 데이터가 0건인 줄 알았는데 그냥 아직
  //   안 그려진 것이었다(9초 뒤엔 막대 3·1·4개가 멀쩡히 있었다). 서버에서 수천 건을 받아
  //   그리는 화면이라 느리다. 못 기다리고 잰 숫자로 "0건"이라 결론지으면 오진이다.
  await frame.waitForFunction(
    () => { const s = document.getElementById("vizStrip"); return !s || s.innerHTML.length > 0; },
    null, { timeout: 14000 },
  ).catch(() => {});
  await sleep(600);

  const 잰값 = await frame.evaluate(async () => {
    const sleep2 = (ms) => new Promise((s) => setTimeout(s, ms));
    const strip = document.getElementById("vizStrip");
    if (!strip) return { 상태: "띠 없음" };
    const bars = [...strip.querySelectorAll(".gviz-bar")];
    if (!strip.getBoundingClientRect().height) {
      return { 상태: "띠가 비어 있음", 안내: (strip.textContent || "").trim().slice(0, 40) };
    }
    if (!bars.length) return { 상태: "누를 막대가 없음(도넛만 있는 화면일 수 있음)" };

    // ① 띠가 보이도록 스크롤 — 사용자가 막대를 누르는 그 순간의 화면 상태를 만든다.
    strip.scrollIntoView({ block: "start" });
    await sleep2(250);
    const 화면아래 = window.scrollY + window.innerHeight;

    // ② 누르기 전 상태를 기억 — id 있는 컨테이너의 내용 길이를 찍어 둔다.
    //   ⚠ **띠 장치 자신은 뺀다**(2차 실측에서 걸림). 막대를 누르면 바로 아래 필터 줄(#vizFilter)이
    //     "「긴급」만 보는 중"으로 바뀌는데, 그게 늘 가장 위에서 바뀌는 자리라 어느 화면을 재도
    //     초록이 나왔다. 필터 줄이 보이는 건 당연하고, 우리가 알고 싶은 건 **목록**이 보이느냐다.
    //   ⚠ 개수 뱃지(「12/40건」)도 마찬가지 — 높이가 한 줄뿐인 것은 목록으로 치지 않는다.
    //   ⚠ 사이드바(#gijoNav)도 뺀다 — 막대를 누르면 배지 숫자가 따라 바뀌어 "바뀐 자리"에 걸리는데,
    //     화면 맨 위에 있어 늘 1등으로 잡힌다(통합 관제에서 걸렸다). 목록이 아니다.
    const 장치 = new Set(["vizStrip", "vizFilter", "gijoNav"]);
    const 후보 = [...document.querySelectorAll("[id]")]
      .filter((el) => !strip.contains(el) && !장치.has(el.id))
      .filter((el) => el.getBoundingClientRect().height >= 60);
    const 전 = new Map(후보.map((el) => [el, el.innerHTML.length]));

    // ③ **실제로 좁혀지는** 막대를 고른다. 막대가 하나뿐이면 그건 전건이라, 눌러도 목록이
    //    그대로다 — 결함이 아니라 데이터가 한 갈래뿐인 것이다(작업 내역이 전부 「완료」인 경우).
    //    그런 화면을 "눌러도 바뀌는 자리가 없음"이라 적으면 멀쩡한 화면을 결함으로 오독한다.
    //    ⚠ 값 읽기 — viz는 1만 이상을 「12.5k」로 줄여 쓴다(짧은수). 숫자만 뽑으면 125가 되어
    //      100배 틀린다. 줄임표를 되돌려 읽는다.
    const 값 = (b) => {
      const t = String((b.querySelector(".v") || {}).textContent || "0").replace(/,/g, "").trim();
      const m = t.match(/^([\d.]+)k$/i);
      return m ? Math.round(parseFloat(m[1]) * 1000) : (parseFloat(t) || 0);
    };
    const 총합 = bars.reduce((n, b) => n + 값(b), 0);
    const 좁혀지는 = bars.filter((b) => 값(b) > 0 && 값(b) < 총합);
    if (!좁혀지는.length) {
      return {
        상태: "막대가 한 갈래뿐 — 눌러도 좁혀질 게 없음(정상)",
        막대수: bars.length,
        // 판정 근거를 남긴다 — 값을 잘못 읽어 「정상」이 되면 전 화면이 조용히 초록이 된다.
        막대값: bars.map((b) => ((b.querySelector(".l") || {}).textContent || "?") + "=" + 값(b)).slice(0, 6),
      };
    }
    const 누를것 = 좁혀지는[0];
    const 막대이름 = (누를것.querySelector(".l") || {}).textContent || "";
    누를것.click();
    await sleep2(900);

    // ④ 바뀐 자리 중 **가장 위**를 결과 자리로 본다. 자식을 품은 부모도 같이 바뀌므로,
    //    다른 바뀐 것을 포함하지 않는 가장 안쪽 것만 남긴다(부모를 잡으면 위치가 위로 새 버린다).
    let 바뀐 = 후보.filter((el) => 전.get(el) !== el.innerHTML.length && el.getBoundingClientRect().height > 0);
    바뀐 = 바뀐.filter((el) => !바뀐.some((o) => o !== el && el.contains(o)));
    if (!바뀐.length) return { 상태: "눌러도 바뀌는 자리가 없음", 막대: 막대이름 };

    바뀐.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const el = 바뀐[0];
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    return {
      상태: "잼",
      막대: 막대이름,
      결과자리: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
      높이: Math.round(r.height),
      넘침: Math.round(top - 화면아래),   // 음수면 화면 안, 양수면 그만큼 화면 밖
      바뀐수: 바뀐.length,
      // 무엇을 목록으로 봤는지 사람이 검산할 수 있게 바뀐 자리를 전부 적는다 — 자동 판정만
      // 믿다가 개수 뱃지·필터 줄을 목록으로 잡은 적이 두 번 있다(2026-08-05).
      바뀐목록: 바뀐.slice(0, 5).map((x) => (x.id ? "#" + x.id : x.tagName.toLowerCase()) + "(" + Math.round(x.getBoundingClientRect().height) + ")"),
    };
  }).catch((e) => ({ 상태: "측정 중 오류: " + String(e.message).slice(0, 60) }));

  결과.push({ 파일, ...잰값, 콘솔오류: 오류들.slice(0, 2) });
}

// ── 보고 ──────────────────────────────────────────────────────────────────
console.log("\n■ 「누르면 목록이 좁혀집니다」 실측 — 누른 결과가 그 화면에 보이는가\n");
console.log("  " + "화면".padEnd(19) + "누른 막대".padEnd(13) + "결과 자리".padEnd(20) + "판정");
let 빨강 = 0, 노랑 = 0, 못잼 = 0;
for (const r of 결과) {
  if (r.상태 !== "잼") {
    못잼++;
    console.log("  " + r.파일.padEnd(19) + "?".padEnd(13) + "".padEnd(20) + "— " + r.상태 + (r.안내 ? ` 「${r.안내}」` : ""));
    if (r.막대값) console.log("       막대: " + r.막대값.join(" · "));
    if (r.콘솔오류 && r.콘솔오류.length) console.log("       ⚠ 콘솔오류: " + r.콘솔오류.join(" / "));
    continue;
  }
  const p = r.넘침 <= 0 ? "✓ 화면 안" : r.넘침 <= 300 ? `△ ${r.넘침}px 밖` : `✗ ${r.넘침}px 밖`;
  if (r.넘침 > 300) 빨강++; else if (r.넘침 > 0) 노랑++;
  console.log("  " + r.파일.padEnd(19) + String(r.막대).slice(0, 11).padEnd(13) + (r.결과자리 + "(" + r.높이 + ")").padEnd(20) + p);
  if (r.바뀐수 > 1) console.log("       같이 바뀐 자리: " + r.바뀐목록.join(" "));
}
console.log("");
console.log(`  (CDP ${PORT} · ${설치본 ? "설치본(app.asar) — 방금 고친 HTML은 없을 수 있습니다" : "개발 실행"})`);
console.log("  " + (빨강 ? `✗ 결과가 화면 밖인 화면 ${빨강}개 — 띠를 목록 위로 옮겨야 합니다.` : "✓ 화면 밖으로 나간 곳 없음"));
if (노랑) console.log(`  △ 조금 넘치는 곳 ${노랑}개`);
if (못잼) console.log(`  ? 못 잰 곳 ${못잼}개 — 위 사유를 하나씩 확인할 것(0건인지, 코드가 죽은 것인지).`);
// ⚠ QA 전수조사가 잡을 수 있게 **0이 아닌 값으로 끝낸다**. 화면에만 ✗를 찍고 조용히 0으로
//   끝나면 점검에 넣어도 늘 통과로 보인다 — 감시가 헛도는 대표 꼴이다.
if (빨강) process.exitCode = 1;
await browser.close();
