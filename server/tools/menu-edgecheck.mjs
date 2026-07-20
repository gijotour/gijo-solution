// tools/menu-edgecheck.mjs — 오라우팅 엣지 케이스를 N회 반복 측정(7B 라우팅 변동성 감안).
// 1회 측정으로는 실제 오라우팅과 변동성을 구분 못 한다(교훈). 각 케이스를 RUNS회 돌려 통과율을 본다.
// 실행: node tools/menu-edgecheck.mjs   (RUNS 기본 3, GIJO_EDGE_RUNS로 조절)

const BASE = process.env.GIJO_BASE ?? "http://localhost:4000";
const RUNS = Number(process.env.GIJO_EDGE_RUNS ?? 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { screen: "vulnscan.html", cmd: "지금 열린 취약점 뭐 있어?", tool: ["finding_status"], action: ["analyze"] },
  { screen: "vulnscan.html", cmd: "가장 급한 취약점 담당자랑 기한 배정해줘", tool: ["assign_finding", "assign_owner"] },
  { screen: "sbom.html", cmd: "자산별 구성요소 정리해줘", tool: ["aibom_status"] },
  { screen: "report.html", cmd: "주간 보안 리포트 작성해줘", action: ["report"] },
  { screen: "dashboard.html", cmd: "오늘 브리핑 해줘", tool: ["briefing", "today"] },
];

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "jyh", password: "gijohn00", force: true }) });
  const j = await r.json(); if (!j.accessToken) throw new Error("login fail"); return j.accessToken;
}
async function dispatch(ref, text, screen) {
  for (let a = 0; a < 3; a++) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 90000);
    try { const r = await fetch(`${BASE}/api/dispatch`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ref.token}` }, body: JSON.stringify({ text, screen }), signal: ctrl.signal }); return await r.json(); }
    catch (e) { if (a === 2) return { _err: String(e.message || e) }; await sleep(6000); try { ref.token = await login(); } catch {} }
    finally { clearTimeout(t); }
  }
}
const got = (res) => ({ tool: res?.toolCalls?.[0]?.tool ?? res?.approval?.tool, action: res?.route?.action });
const ok = (c, g) => (c.tool && g.tool && c.tool.includes(g.tool)) || (c.action && g.action && c.action.includes(g.action));

const ref = { token: await login() };
console.log(`# 오라우팅 엣지 케이스 ${RUNS}회 반복 측정 — ${new Date().toLocaleString("sv-SE")}\n`);
for (const c of CASES) {
  const want = [...(c.tool ?? []), ...(c.action ?? [])].join("/");
  const results = [];
  let pass = 0;
  for (let i = 0; i < RUNS; i++) {
    const g = got(await dispatch(ref, c.cmd, c.screen));
    const good = ok(c, g); if (good) pass++;
    results.push(`${g.tool ?? "-"}/${g.action ?? "-"}${good ? "✓" : "✗"}`);
  }
  const mark = pass === RUNS ? "✅" : pass === 0 ? "❌" : "⚠️";
  console.log(`${mark} [${pass}/${RUNS}] "${c.cmd}"  기대=${want}  →  ${results.join(", ")}`);
}
