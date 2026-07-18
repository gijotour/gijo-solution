// 실제 sessions.html(v2, 시안 C) + 2컬럼 dashboard.html을 window.gijo 스텁으로 렌더해 캡처.
// pageerror를 수집해 요소 제거로 인한 JS 오류가 없는지 검증한다.
import { createRequire } from "module"; import path from "path"; import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client", "package.json"));
const { chromium } = req("playwright-core");
const pagesDir = path.resolve("client", "src", "renderer", "pages");
const outDir = path.resolve("mockups", "work-sessions-v2");

const ASSETS = [
  { id: "chatbot-01", name: "사내 상담 챗봇", assetType: "llm", service: "고객 상담(대외)", findings: [{ severity: "critical" }, { severity: "high" }, { severity: "high" }], components: [{ name: "Llama-3.2-3B" }], aibom: { model: { name: "Llama-3.2-3B" }, robustness: { score: 82 } }, lastScannedAt: Date.now() - 86400e3 },
  { id: "doc-ai", name: "문서 분류 AI", assetType: "llm", service: null, findings: [], components: [], aibom: {}, lastScannedAt: null },
  { id: "fraud-llm", name: "이상거래 탐지 LLM", assetType: "llm", service: "결제", findings: [{ severity: "medium" }], components: [], aibom: {}, lastScannedAt: Date.now() - 3 * 86400e3 },
  { id: "codereview-ai", name: "코드 리뷰 어시스턴트", assetType: "llm", service: null, findings: [], components: [], aibom: {}, lastScannedAt: null },
];
const PRI = { items: [
  { assetId: "chatbot-01", findingKey: "k1", status: "pending", assignee: null, dueDate: null, score: 99, finding: { finding_type: "Apache Log4j RCE (CVE-2021-44228)", severity: "critical", kev: true } },
  { assetId: "pay-api", findingKey: "k2", status: "pending", assignee: "이영희", dueDate: "2026-07-20", score: 80, finding: { finding_type: "OpenSSL 취약점", severity: "high" } },
  { assetId: "portal", findingKey: "k3", status: "pending", assignee: null, dueDate: null, score: 70, finding: { finding_type: "Struts2 RCE", severity: "high" } },
] };
const PRODUCTS = [
  { id: "p1", name: "AhnLab 방화벽", category: "방화벽", vendor: "AhnLab", model: "TrusGuard", assetName: "네트워크 경계", docs: [{}, {}] },
  { id: "p2", name: "Genian NAC", category: "NAC", vendor: "지니언스", model: "NAC v5", docs: [] },
  { id: "p3", name: "SecuwaySSL VPN", category: "VPN", vendor: "시큐아이", model: "-", docs: [{}] },
];
const TASKS = [
  { id: "t1", text: "Log4j 재스캔 결과 확인", done: false, priority: "P0", createdAt: Date.now() },
  { id: "t2", text: "방화벽 룰 정기 점검", done: false, priority: "P2", createdAt: Date.now() },
  { id: "t3", text: "주간 리포트 발송", done: false, priority: "P2", createdAt: Date.now() },
];
const SESSIONS = [
  { id: "s1", title: "사내 상담 챗봇 · 상태", status: "active", contextRef: "asset:chatbot-01", createdAt: Date.now() - 120e3, updatedAt: Date.now() - 60e3, turnCount: 1, lastPreview: "◆ 사내 상담 챗봇 (chatbot-01) 취약점 critical 1 · high 2 …", lastRole: "assistant" },
  { id: "s2", title: "오늘 급한 취약점 확인·배정", status: "active", createdAt: Date.now() - 3600e3, updatedAt: Date.now() - 3000e3, turnCount: 3, lastPreview: "Log4j 2.17+ 업그레이드 …", lastRole: "assistant" },
  { id: "s3", title: "방화벽 로그 브루트포스 분석", status: "done", createdAt: Date.now() - 90000e3, updatedAt: Date.now() - 86400e3, turnCount: 2, lastPreview: "203.0.113.5 SSH 무차별 대입 137회", lastRole: "assistant" },
];
const TURNS_S1 = [{ id: "tt1", sessionId: "s1", role: "assistant", tool: "상태", at: Date.now() - 60e3,
  content: "◆ 사내 상담 챗봇 (chatbot-01)\n취약점 critical 1 · high 2 · 최근 스캔 2026-07-17\nAI-BOM Llama-3.2-3B · 견고성 82점 · 서비스 고객 상담(대외)" }];

const stub = { ASSETS, PRI, PRODUCTS, TASKS, SESSIONS, TURNS_S1 };

const b = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));

async function cap(file, out, w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.addInitScript((data) => {
    const d = (v) => new Promise((r) => setTimeout(() => r(v), 3));
    const noop = () => {};
    const known = {
      isAuthenticated: () => true,
      me: () => d({ displayName: "정요한", username: "jyh", role: "admin" }),
      checkServerHealth: () => d({ ok: true }),
      getServerUrl: () => d("http://localhost:4000"),
      navigateTo: noop,
      listAssets: () => d(data.ASSETS),
      listActionPriorities: () => d(data.PRI),
      listSecurityProducts: () => d(data.PRODUCTS),
      listSecurityProductsGrouped: () => d([{ category: "방화벽", products: data.PRODUCTS }]),
      listTasks: () => d(data.TASKS),
      listDueMaintenance: () => d([]),
      listWorkSessions: () => d(data.SESSIONS),
      getWorkSession: (id) => d({ session: data.SESSIONS.find((s) => s.id === id), turns: id === "s1" ? data.TURNS_S1 : [] }),
      createWorkSession: (t, ref) => d({ id: "new", title: t || "새 세션", status: "active", contextRef: ref, createdAt: Date.now(), updatedAt: Date.now() }),
      addWorkSessionTurn: () => d({}),
      updateWorkSession: () => d({}),
      deleteWorkSession: () => d({ ok: true }),
      sendInstruction: () => d({ output: "ok" }),
      getLocalEngineStatus: () => d({ running: true, loaded: [{ modelId: "gijo-main-orchestrator", port: 8080, ready: true }] }),
      getGpuUsage: () => d({ available: true, utilization: 12, memUsedMb: 8000, memTotalMb: 16000, memPercent: 50 }),
      listDir: () => d({ root: "D:/", rootName: "D", path: "", items: [] }),
      listMemoryDocuments: () => d([]),
      getRoutineSuggestions: () => d([]),
      listAgents: () => d([{ id: "orchestrator", name: "Security Orchestrator", role: "지휘", status: "idle", defaultName: "Security Orchestrator" }]),
      listCollaborationHistory: () => d([]),
      listLlmActivity: () => d([]),
      onCollaborationEvent: noop, onLlmActivity: noop, onAssetUpdated: noop, onHfDownloadProgress: noop, onLogEvent: noop,
      listHfDownloadJobs: () => d([]),
    };
    window.gijo = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve([])) });
    window.gijoRealtime = { connect: () => {} };
  }, stub);
  await p.goto(pathToFileURL(path.join(pagesDir, file)).href, { waitUntil: "load" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(outDir, out), fullPage: false });
  console.log(`캡처: ${out}${errs.length ? "  ⚠ pageerror: " + errs.join(" | ") : "  (JS 오류 없음)"}`);
  await p.close();
}

await cap("sessions.html", "live-sessions-v2.png", 1320, 840);
await cap("dashboard.html", "live-dashboard-2col.png", 1320, 840);
await b.close();
