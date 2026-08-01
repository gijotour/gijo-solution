// 전수 점검이 지목한 자리를 **하나씩 다시 눌러** 진짜인지 확인한다.
// ⚠ 전수 점검의 콘솔 오류는 배경 폴링이 섞일 수 있다(1.4초 창 안에 도착하면 그 클릭 탓이 된다).
//   여기서는 **어떤 요청이 몇 번으로 실패했는지**까지 잡아 근거를 남긴다.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const 대상 = [
  ["연동", "연결 확인"],
  ["연동", "연결 시험"],
  ["위협 인텔", "연결 시험"],
  ["인수인계", "✓ 인수인계 완료 처리 (감사 로그 기록)"],
  ["터미널 (CLI)", "🤖 명령 제안 받기"],
  ["기억·학습 (RAG)", "수집"],
  ["기억·학습 (RAG)", "Q&A 변환"],
  ["대시보드", "검색"],
  ["자산 목록", "탐지 결과 가져오기"],
  ["온톨로지", "M1045 Code Signing"],
];

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
if (/login\.html/.test(p.url())) {
  await p.fill("#username", "claude-deploy").catch(() => {});
  await p.fill("#password", process.env.GIJO_ADMIN_PASSWORD).catch(() => {});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(6000);
  const f = await p.$('button:has-text("강제"), button:has-text("계속")');
  if (f) { await f.click(); await p.waitForTimeout(4000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
p.on("dialog", (d) => d.dismiss().catch(() => {}));
await p.waitForTimeout(1500);

let 현재화면 = null;
for (const [화면, 글] of 대상) {
  if (현재화면 !== 화면) {
    await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
    await p.waitForTimeout(400);
    await p.evaluate((lab) => {
      const it = [...document.querySelectorAll("#gijoNav .gn-item")].find(
        (e) => (e.querySelector(".gn-label")?.textContent || "").trim() === lab);
      it?.querySelector(".gn-label").click();
    }, 화면);
    await p.waitForTimeout(7000);
    현재화면 = 화면;
  }

  const 실패 = [];
  const 요청 = [];
  const onResp = (r) => {
    if (!/\/api\//.test(r.url())) return;
    const u = r.url().replace(/^https?:\/\/[^/]+/, "");
    요청.push(r.status() + " " + u);
    if (r.status() >= 400) 실패.push(r.status() + " " + u);
  };
  p.on("response", onResp);

  const r = await p.evaluate((글) => {
    const f = document.querySelector("#screens iframe.on");
    const d = f && f.contentDocument;
    if (!d) return { 못봄: true };
    const els = [...d.querySelectorAll('button, [role="button"], .row-actions, .tb-mi, .chip, .g-go, [data-action]')]
      .filter((e) => e.offsetParent || e.getClientRects().length);
    const el = els.find((e) => (e.textContent || "").trim().slice(0, 30) === 글.slice(0, 30));
    if (!el) return { 못찾음: true, 있는것: els.slice(0, 5).map((e) => (e.textContent || "").trim().slice(0, 20)) };
    const 전 = d.body.innerHTML.length;
    const 전글 = (d.body.innerText || "").slice(0, 4000);
    el.click();
    return { 전, 전글, 태그: el.tagName + "." + (el.className || "").slice(0, 30) };
  }, 글);

  if (r.못봄 || r.못찾음) {
    p.off("response", onResp);
    console.log(`❔ ${화면} / ${글} — ${r.못찾음 ? "버튼을 못 찾음(그 화면 상태에서만 보이는 것일 수 있다)" : "프레임 못봄"}`);
    continue;
  }
  await p.waitForTimeout(3000);
  const 후 = await p.evaluate(() => {
    const f = document.querySelector("#screens iframe.on");
    const d = f && f.contentDocument;
    return d ? { len: d.body.innerHTML.length, 글: (d.body.innerText || "").slice(0, 4000) } : null;
  });
  p.off("response", onResp);

  const 바뀜 = 후 && 후.len !== r.전;
  const 글바뀜 = 후 && 후.글 !== r.전글;
  console.log(
    (실패.length ? "❌" : 바뀜 || 요청.length ? "✅" : "⚠") +
    ` ${화면} / ${글}`,
  );
  console.log(`    요소=${r.태그} · 요청 ${요청.length}건${실패.length ? " · 실패: " + 실패.join(", ") : ""} · DOM ${바뀜 ? "바뀜" : "그대로"} · 글자 ${글바뀜 ? "바뀜" : "그대로"}`);
  if (요청.length && !실패.length) console.log(`    보낸 것: ${요청.slice(0, 3).join(" | ")}`);
}
await b.close();
