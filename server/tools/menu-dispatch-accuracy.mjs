// tools/menu-dispatch-accuracy.mjs — 메뉴별 챗봇 명령 라우팅 정확도 측정.
//
// 실제 운영 디스패처(/api/dispatch)에 카탈로그(menu-scenarios.mjs)의 명령을 화면별로 보내
// 선택된 도구/액션이 기대와 맞는지 측정한다. "비슷한 명령"이 같은 기능으로 라우팅되는지 수치로 본다.
// 실행(WSL 운영서버에서): node tools/menu-dispatch-accuracy.mjs
//   BASE 기본 http://localhost:4000 · 계정 GIJO_BENCH_USER/PASS(기본 jyh/gijohn00)

import { CATALOG } from "./menu-scenarios.mjs";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE = process.env.GIJO_BASE ?? "http://localhost:4000";
const USER = process.env.GIJO_BENCH_USER ?? "jyh";
const PASS = process.env.GIJO_BENCH_PASS ?? "gijohn00";
const REPORT_OUT = process.env.GIJO_REPORT_OUT ?? path.join("tools", "bench-results", "menu-dispatch-report.md");

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS, force: true }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error("로그인 실패: " + JSON.stringify(j));
  return j.accessToken;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dispatchOnce(token, text, screen) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(`${BASE}/api/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, screen }),
      signal: ctrl.signal,
    });
    return await r.json();
  } finally { clearTimeout(t); }
}

// 연결 실패(서버 재시작 등 일시 장애)에는 재로그인 후 재시도해 측정이 오염되지 않게 한다.
async function dispatch(tokenRef, text, screen) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await dispatchOnce(tokenRef.token, text, screen); }
    catch (e) {
      if (attempt === 2) throw e;
      await sleep(6000);
      try { tokenRef.token = await login(); } catch { /* 다음 시도에서 재시도 */ }
    }
  }
}

function selected(res) {
  // 읽기 도구는 실행돼 toolCalls에, 쓰기 도구는 결재판(approval)으로 반환된다(운영 데이터 안전).
  // 둘 다에서 도구 이름을 읽는다.
  const tool = res?.toolCalls?.[0]?.tool ?? res?.approval?.tool;
  const action = res?.route?.action;
  return { tool, action };
}
function ok(expect, got) {
  if (expect.tool && got.tool && expect.tool.includes(got.tool)) return true;
  if (expect.action && got.action && expect.action.includes(got.action)) return true;
  return false;
}

async function main() {
  console.log(`# 메뉴별 디스패치 정확도 — ${new Date().toLocaleString("sv-SE")}  (${BASE})`);
  const tokenRef = { token: await login() };
  let total = 0, pass = 0;
  const perMenu = [];
  const fails = [];
  for (const m of CATALOG) {
    let mt = 0, mp = 0;
    for (const s of m.scenarios) {
      for (const cmd of s.commands) {
        total++; mt++;
        let got = { tool: undefined, action: undefined }, err;
        try { got = selected(await dispatch(tokenRef, cmd, m.screen)); }
        catch (e) { err = String(e.message || e); }
        const good = !err && ok(s.expect, got);
        if (good) { pass++; mp++; }
        else fails.push({ menu: m.menu, cmd, want: [...(s.expect.tool ?? []), ...(s.expect.action ?? [])].join("/"), got: err ? `ERR ${err}` : `${got.tool ?? "-"}/${got.action ?? "-"}` });
        process.stdout.write(good ? "." : "x");
      }
    }
    perMenu.push({ menu: m.menu, mp, mt });
  }
  // ── 리포트(마크다운) 작성 + 파일 저장 ──
  const pct = Math.round((pass / total) * 100);
  const R = [];
  R.push(`# GIJO AS 챗봇 메뉴별 라우팅 정확도 리포트`);
  R.push(`\n- 측정 시각: ${new Date().toLocaleString("sv-SE")}`);
  R.push(`- 대상 서버: ${BASE}`);
  R.push(`- **총계: ${pass}/${total} (${pct}%)** — 비슷한 표현 변형이 같은 기능으로 라우팅된 비율`);
  R.push(`\n## 메뉴별 정확도\n`);
  R.push(`| 상태 | 메뉴 | 정확도 |`);
  R.push(`|---|---|---|`);
  for (const p of perMenu) {
    const mark = p.mp === p.mt ? "✅" : (p.mp === 0 ? "❌" : "⚠️");
    R.push(`| ${mark} | ${p.menu} | ${p.mp}/${p.mt} (${Math.round((p.mp / p.mt) * 100)}%) |`);
  }
  if (fails.length) {
    R.push(`\n## 오라우팅 — 개선 후보 (${fails.length}건)\n`);
    R.push(`| 메뉴 | 명령 | 기대 | 실제 |`);
    R.push(`|---|---|---|---|`);
    for (const f of fails) R.push(`| ${f.menu} | "${f.cmd}" | \`${f.want}\` | \`${f.got}\` |`);
  } else {
    R.push(`\n## 오라우팅 없음 — 전 시나리오 변형이 정확히 라우팅됨 🎉`);
  }
  R.push(`\n---\n*카탈로그: server/tools/menu-scenarios.mjs · 재측정: node tools/menu-dispatch-accuracy.mjs*`);
  const md = R.join("\n") + "\n";

  console.log("\n\n" + md);
  try {
    fs.mkdirSync(path.dirname(REPORT_OUT), { recursive: true });
    fs.writeFileSync(REPORT_OUT, md);
    console.log(`\n📄 리포트 저장: ${REPORT_OUT}`);
  } catch (e) { console.error("리포트 저장 실패:", e); }
}
main().catch((e) => { console.error("측정 실패:", e); process.exit(1); });
