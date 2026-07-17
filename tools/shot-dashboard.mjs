// tools/shot-dashboard.mjs — 현재 dashboard.html을 라이브 서버(:4000) 실데이터로 렌더해 스크린샷 + 자체완결 HTML 스냅샷 생성.
// gen-screenshots.mjs의 window.gijo 스텁 방식을 재사용. normaltic 표시 이름은 방금 변경한 "GIJO Security"로 덮어씀.
// 사용: node tools/shot-dashboard.mjs  (환경변수 GIJO_SHOT_BASE 기본 http://localhost:4000)

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const BASE = process.env.GIJO_SHOT_BASE ?? "http://localhost:4000";
const PAGES_DIR = path.join(ROOT, "client", "src", "renderer", "pages");
const OUT_DIR = path.join(ROOT, "mockups", "agent-dashboard");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "jyh", password: "changeme" }),
  }).then((r) => r.json());
  const token = login.accessToken;
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const g = async (p) => fetch(`${BASE}${p}`, auth).then((r) => r.json()).catch(() => null);

  let agents = (await g("/api/agents")) || [];
  // 표시 이름 변경 반영(라이브 서버는 아직 구 빌드라 "노말틱"을 서빙 → 스냅샷에선 새 이름으로).
  agents = agents.map((a) => (a.id === "normaltic" ? { ...a, name: "GIJO Security" } : a));

  const DATA = {
    me: login.user ?? { displayName: "정요한", username: "jyh", role: "admin" },
    kpi: await g("/api/kpi"),
    assets: await g("/api/assets"),
    agents,
    collaboration: await g("/api/collaboration/history"),
    llmActivity: await g("/api/llm-activity/history"),
    models: await g("/api/localengine/models"),
    engineStatus: await g("/api/localengine/status"),
    approvals: await g("/api/approvals"),
    priorities: await g("/api/approvals/priorities"),
    maintenanceDue: await g("/api/maintenance/due"),
  };

  function installStub(DATA) {
    const R = (v) => Promise.resolve(v);
    const noop = () => {};
    const gijo = {
      isAuthenticated: () => true,
      getServerUrl: () => "http://localhost:4000",
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route(/gijo\.ai/, (route) => route.abort());
  await ctx.addInitScript(`try{localStorage.setItem('gijo:onboarding:seen','1');}catch(e){}
    window.gijo = (${installStub.toString()})(${JSON.stringify(DATA)});
    window.gijoRealtime = { connect: () => {}, on: () => {}, off: () => {} };`);

  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(PAGES_DIR, "dashboard.html")).href, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1600);

  // PNG(육안 확인용) — 뷰포트 화면 + 풀페이지 둘 다.
  await page.screenshot({ path: path.join(OUT_DIR, "current-dashboard.png"), fullPage: false });
  await page.screenshot({ path: path.join(OUT_DIR, "current-dashboard-full.png"), fullPage: true });

  console.log("agents used:", JSON.stringify(DATA.agents.map((a) => a.name)));
  console.log("kpi:", JSON.stringify(DATA.kpi));
  console.log("assets:", (DATA.assets || []).length, "priorities:", (DATA.priorities || []).length);
  console.log("saved:", path.join(OUT_DIR, "current-dashboard.png"));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
