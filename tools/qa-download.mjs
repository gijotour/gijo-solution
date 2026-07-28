#!/usr/bin/env node
// QA 계층 [download] — 파일 내려받기가 **실제로 파일을 만드는가** (2026-07-26 신설)
//
// ⚠ 왜 Playwright를 쓰지 않는가(이 파일의 존재 이유):
//   Playwright로 CDP에 붙으면 다운로드를 자기 쪽으로 가로챈다(Browser.setDownloadBehavior).
//   그러면 Electron은 state=completed와 저장 경로까지 보고하는데 **그 경로에 파일이 없다.**
//   실제로 이 착시 때문에 "다운로드 ✓"로 통과한 채 버그가 게시됐다(VEX·리포트 모두 안 받아졌다).
//   그래서 이 계층만은 순수 CDP(WebSocket)로 붙어 사용자 다운로드 폴더를 직접 확인한다.
//
// 사용: QA_PASS=... node tools/qa-download.mjs   (Electron CDP 9223 필요)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PW = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
const USER = process.env.QA_USER || "claude-deploy";
if (!PW) { console.error("QA_PASS/GIJO_ADMIN_PASSWORD 필요"); process.exit(2); }

const DL = path.join(os.homedir(), "Downloads");
let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + String(d).slice(0, 140) : ""}`); };

async function attach(match, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const ts = await (await fetch("http://127.0.0.1:9223/json")).json();
      const t = ts.find((x) => x.type === "page" && match.test(x.url));
      if (t) return t;
    } catch { /* 아직 안 뜸 */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}
function conn(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return {
    ws, send,
    ready: new Promise((r) => { ws.onopen = r; }),
    evalx: async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value,
  };
}

const cdpUp = await fetch("http://127.0.0.1:9223/json/version").then((r) => r.ok).catch(() => false);
if (!cdpUp) { console.log("[download] 스킵 — Electron(CDP 9223) 미기동"); process.exit(0); }

console.log("\n[download] 파일 받기가 실제로 저장되는가 (순수 CDP — Playwright 미사용)");
const before = new Set(fs.readdirSync(DL));

// ① 로그인(이미 로그인돼 있으면 건너뜀)
let t = await attach(/login\.html/, 3);
if (t) {
  const c = conn(t); await c.ready; await c.send("Runtime.enable");
  await c.evalx(`(() => {
    window.confirm = () => true;                 // 중복로그인 확인창에서 멈추지 않게
    document.getElementById('serverUrl').value = 'http://localhost:4000';
    document.getElementById('username').value = ${JSON.stringify(USER)};
    document.getElementById('password').value = ${JSON.stringify(PW)};
    const s = document.getElementById('savePw'); if (s && s.checked) s.click();
    document.getElementById('loginBtn').click();
    return 'ok';
  })()`);
  c.ws.close();
  await new Promise((r) => setTimeout(r, 8000));
}

// ② 조치·승인으로 이동
// ⚠ 앱이 어느 화면에 있든 스스로 되돌린다(2026-07-28). 예전엔 대시보드에 있을 때만 통과해서,
//    같은 전수조사 안의 sweep 계층(허브 화면을 요구)과 서로의 상태를 깨뜨렸다 — 한 번에 둘 다
//    통과할 수 없는 구조였다. 어느 계층이 먼저 돌든 상관없게 만든다.
t = await attach(/dashboard\.html|approvals\.html/, 3);
if (!t) {
  const any = await attach(/\.html/, 3);
  if (any) {
    const c = conn(any); await c.ready; await c.send("Runtime.enable");
    await c.evalx(`(location.href = 'dashboard.html'), 'go'`);
    c.ws.close();
    await new Promise((r) => setTimeout(r, 7000));
    t = await attach(/dashboard\.html|approvals\.html/);
  }
}
if (!t) { ok("앱 화면 도달", false, "대시보드를 찾지 못함"); process.exit(1); }
if (/dashboard\.html/.test(t.url)) {
  const c = conn(t); await c.ready; await c.send("Runtime.enable");
  await c.evalx(`window.gijo.navigateTo('approvals.html'), 'go'`);
  c.ws.close();
  await new Promise((r) => setTimeout(r, 7000));
  t = await attach(/approvals\.html/);
}
if (!t) { ok("조치·승인 화면 도달", false); process.exit(1); }

// ③ VEX 받기 → 파일이 진짜 생기는지
const c = conn(t); await c.ready; await c.send("Runtime.enable");
const hasBtn = await c.evalx(`Boolean(document.getElementById('btnVexExport'))`);
ok("VEX 받기 버튼 존재", Boolean(hasBtn));
if (hasBtn) {
  await c.evalx(`document.getElementById('btnVexExport').click(), 'clicked'`);
  // 저장 안내는 잠시 뒤 원래 칩으로 돌아간다 — 사라지기 전에 읽는다(늦게 읽어 실패한 이력 있음).
  await new Promise((r) => setTimeout(r, 4000));
  const shown = await c.evalx(`document.getElementById('vexChips').textContent.trim().slice(0,80)`);
  await new Promise((r) => setTimeout(r, 3000)); // 저장 완료까지 여유
  const made = fs.readdirSync(DL).filter((f) => !before.has(f) && /gijo-vex/.test(f));
  ok("다운로드 폴더에 파일이 실제로 생성", made.length > 0, made.join(", ") || "없음");
  if (made.length) {
    const p = path.join(DL, made[0]);
    let valid = false;
    try { const j = JSON.parse(fs.readFileSync(p, "utf8")); valid = j.bomFormat === "CycloneDX"; } catch { /* 형식 불량 */ }
    ok("내용이 올바른 VEX 문서", valid, `${(fs.statSync(p).size / 1024).toFixed(1)}KB`);
    ok("화면이 저장 위치를 알려준다", /저장됨/.test(shown || ""), shown);
    fs.unlinkSync(p); // 검증 산출물 회수
  }
}
c.ws.close();

console.log(fails ? `\n[download] ✗ 실패 ${fails}건` : "\n[download] ✓ 전부 통과");
process.exit(fails ? 1 : 0);
