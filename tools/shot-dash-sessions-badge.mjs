// 일회성 검증 스크립트 — 대시보드 "작업 세션" 헤더의 등록 버튼→진행중 배지 변경 확인.
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const BASE = "http://127.0.0.1:4100";
const PAGES_DIR = path.join(ROOT, "client", "src", "renderer", "pages");
const OUT_DIR = path.join(ROOT, ".tmp-reports");

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "jyh", password: "changeme", force: true }),
  }).then((r) => r.json());
  const token = login.accessToken;
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const g = async (p) => fetch(`${BASE}${p}`, auth).then((r) => r.json()).catch(() => null);

  const DATA = {
    me: login.user ?? { displayName: "정요한", username: "jyh", role: "admin" },
    kpi: await g("/api/kpi"),
    assets: (await g("/api/assets")) || [],
    agents: (await g("/api/agents")) || [],
    collaboration: (await g("/api/collaboration/history")) || [],
    llmActivity: (await g("/api/llm-activity/history")) || [],
    models: (await g("/api/localengine/models")) || [],
    engineStatus: await g("/api/localengine/status"),
    approvals: (await g("/api/approvals")) || [],
    priorities: (await g("/api/approvals/priorities")) || [],
    maintenanceDue: (await g("/api/maintenance/due")) || [],
    sessions: (await g("/api/work-sessions")) || [],
  };

  function installStub(DATA) {
    const R = (v) => Promise.resolve(v);
    const noop = () => {};
    const gijo = {
      isAuthenticated: () => true,
      getServerUrl: () => "http://127.0.0.1:4100",
      checkServerHealth: () => R({ ok: true }),
      me: () => R(DATA.me),
      navigateTo: noop,
      getSecurityKpi: () => R(DATA.kpi),
      listAssets: () => R(DATA.assets),
      getAsset: (id) => R((DATA.assets || []).find((a) => a.id === id)),
      listAgents: () => R(DATA.agents),
      listModels: () => R(DATA.models),
      getLocalEngineStatus: () => R(DATA.engineStatus),
      listApprovals: () => R(DATA.approvals),
      listActionPriorities: () => R(DATA.priorities),
      listDueMaintenance: () => R(DATA.maintenanceDue),
      listCollaborationHistory: () => R(DATA.collaboration),
      listLlmActivity: () => R(DATA.llmActivity),
      listDir: () => R({ root: "GIJO", rootName: "GIJO", path: "", items: [] }),
      queryMemory: () => R([]),
      listLogs: () => R([]),
      listWorkSessions: () => R(DATA.sessions),
    };
    return new Proxy(gijo, {
      get(t, k) {
        if (k in t) return t[k];
        if (typeof k === "string" && k.startsWith("on")) return noop;
        return () => Promise.resolve([]);
      },
    });
  }

  const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
  await ctx.route(/gijo\.ai/, (route) => route.abort());
  await ctx.addInitScript(`try{localStorage.setItem('gijo:onboarding:seen','1');}catch(e){}
    window.gijo = (${installStub.toString()})(${JSON.stringify(DATA)});
    window.gijoRealtime = { connect: () => {}, on: () => {}, off: () => {} };`);

  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(PAGES_DIR, "dashboard.html")).href, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1200);
  // 오른쪽 "작업 세션" 아코디언을 펼쳐서 배지+목록이 함께 보이게.
  await page.click("[data-acc='sessions']").catch(() => {});
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(OUT_DIR, "dash-sessions-badge.png"), fullPage: false });
  console.log("sessions data:", JSON.stringify(DATA.sessions.map((s) => ({ title: s.title, status: s.status }))));
  console.log("saved:", path.join(OUT_DIR, "dash-sessions-badge.png"));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
