// tools/gen-screenshots.mjs — 실제 제품 HTML/CSS를 실측 데이터로 렌더링해 화면 스크린샷 생성.
// Node에서 라이브 서버의 응답을 미리 받아(백데이터) window.gijo 스텁에 주입 → msedge로 렌더 → PNG.
// 목업이 아니라 "실제 페이지 + 실제 데이터"다. (제품소개 자료용)
//
// 사용법: ① 서버를 GIJO_SERVER_PORT=4068(격리 DB 권장)로 기동  ② `node tools/gen-screenshots.mjs`
// playwright-core는 client/node_modules에서 로드하고, 시스템 Edge(채널 msedge)를 구동한다.

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
// playwright-core는 client 또는 server 워크스페이스 중 설치된 쪽 기준으로 require 한다(이식성).
function requirePlaywright() {
  for (const ws of ["client", "server"]) {
    try {
      return createRequire(pathToFileURL(path.join(ROOT, ws, "package.json")))("playwright-core");
    } catch (e) { /* 다음 워크스페이스 시도 */ }
  }
  // 선언은 client/package.json devDependencies에 있다(^1.61.1, 2026-08-09 확정).
  // 여기까지 왔다면 선언은 있는데 **설치가 안 된** 것이다 — 안내도 그렇게 적는다.
  // (선언 자체가 사라지면 server/test/toolsdeps.test.ts 가 먼저 빨간불을 낸다)
  throw new Error(
    "playwright-core를 client/server 어느 node_modules에서도 찾지 못했습니다.\n" +
      "  client/package.json에 선언은 있습니다(devDependencies) — 설치가 안 된 상태입니다.\n" +
      "  받으려면: cd client && npm i"
  );
}
const { chromium } = requirePlaywright();

const BASE = process.env.GIJO_SHOT_BASE ?? "http://localhost:4068";
const PAGES_DIR = path.join(ROOT, "client", "src", "renderer", "pages");
// 덱 모드(GIJO_SHOT_DECK=1): 슬라이드 삽입용. fullPage는 세로가 수천~수만 px이라 슬라이드에 못 넣으므로
// 뷰포트 크기(16:10)로만 찍고 screenshots/deck/에 따로 둔다. 기본(풀페이지)은 매뉴얼용이라 그대로 유지.
const DECK = process.env.GIJO_SHOT_DECK === "1";
const OUT_DIR = DECK ? path.join(ROOT, "screenshots", "deck") : path.join(ROOT, "screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  // 라이브 운영서버(실데이터)로 찍을 때는 실계정 비번을 GIJO_SHOT_USER/GIJO_SHOT_PASSWORD로 준다.
  // 중복 로그인 방지가 켜져 있으면 force로 밀어낸다(현재 앱 세션은 끊길 수 있음).
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.GIJO_SHOT_USER ?? "jyh",
      password: process.env.GIJO_SHOT_PASSWORD ?? "changeme",
      force: true,
    }),
  }).then((r) => r.json());
  const token = login.accessToken;
  // 로그인이 실패하면 이후 모든 g()가 오류 **객체**를 돌려주고, 그 객체를 배열처럼 돌다
  // "not iterable"로 죽는다(2026-08-06 실측 — 원인이 로그인인데 증상이 데이터라 헷갈린다).
  // 여기서 먼저 정직하게 세운다.
  if (!token) {
    console.error(`로그인 실패 — ${JSON.stringify(login).slice(0, 200)}\n  (계정: ${process.env.GIJO_SHOT_USER ?? "jyh"} · 서버: ${BASE})`);
    process.exit(2);
  }
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const g = async (p) => fetch(`${BASE}${p}`, auth).then((r) => r.json()).catch(() => null);

  // 화면들이 로드 시 부르는 GET 응답을 미리 수집(백데이터).
  const maintenance = await g("/api/maintenance");
  const histById = {};
  for (const m of Array.isArray(maintenance) ? maintenance : []) histById[m.id] = await g(`/api/maintenance/${m.id}/history`);

  const DATA = {
    me: login.user ?? { displayName: "정요한", username: "jyh", role: "admin" },
    serverUrl: BASE,
    kpi: await g("/api/kpi"),
    ctiMatches: await g("/api/cti/asset-matches"),
    ctiFeeds: await g("/api/cti/feeds"),
    ctiFindings: await g("/api/cti/findings"),
    serviceImpact: await g("/api/service-impact"),
    assets: await g("/api/assets"),
    maintenance,
    maintenanceDue: await g("/api/maintenance/due"),
    maintenanceNotify: await g("/api/maintenance/notify"),
    histById,
    agents: await g("/api/agents"),
    agentRecs: await g("/api/modeldex/agent-recommendations"),
    models: await g("/api/localengine/models"),
    engineStatus: await g("/api/localengine/status"),
    compliance: await g("/api/compliance"),
    approvals: await g("/api/approvals"),
    tasks: await g("/api/tasks"),
    collaboration: await g("/api/collaboration/history"),
    llmActivity: await g("/api/llm-activity/history"),
    llmGuide: await g("/api/llmguide"),
    modelDex: await g("/api/modeldex"),
    learnloopConfig: await g("/api/learnloop/config"),
    learnloopPreflight: await g("/api/learnloop/preflight"),
    learnloopLogs: await g("/api/learnloop/logs"),
    learnloopRuns: await g("/api/learnloop/runs"),
    hfJobs: await g("/api/hfmodels/jobs"),
    smtp: await g("/api/email/config"),
    usage: await g("/api/usage/summary"),
    users: await g("/api/users"),
    securityProductsGrouped: await g("/api/security-products/grouped"),
    productCategories: await g("/api/security-products/categories"),
    securityProducts: await g("/api/security-products"),
    gpuUsage: await g("/api/localengine/gpu"),
    routineSuggestions: await g("/api/tasks/routine-suggestions"),
    actionPriorities: await g("/api/approvals/priorities?limit=10"),
    memoryDocuments: await g("/api/memory/documents"),
    analysisHub: await g("/api/analysis-hub/events"),
    ontology: await g("/api/ontology/triples"),
    guardrailStatus: await g("/api/guardrail/status"),
    guardrailLog: await g("/api/guardrail/log?limit=50"),
    redteamLast: await g("/api/redteam/last"),
    redteamTargets: await g("/api/redteam/targets"),
    logs: await g("/api/logs"),
    // 매뉴얼 v3.3.3 갱신분 — 신규 화면(팀 사무실·인수인계·작업기록·원격 정기점검) 백데이터.
    today: await g("/api/today?brief=0"),
    activeSessions: await g("/api/auth/sessions"),
    audit: await g("/api/audit?limit=200"),
    hardeningTargets: await g("/api/hardening/targets"),
    hardeningSchedules: await g("/api/hardening/schedules"),
    hardeningRuns: await g("/api/hardening/runs"),
    // ★ 2026-08-04 새로 찍는 화면(작업 세션·리포트)의 백데이터.
    //   ⚠ 데이터를 안 채우면 **빈 화면이 찍힌다.** 빈 화면을 제안 자료에 넣는 것은
    //     없느니만 못하다 — 고객은 "이 기능은 아무것도 없나 보다"로 읽는다.
    //   ⚠ 경로는 **apiClient.ts에서 확인한 것**을 쓴다. 처음엔 이름만 보고
    //     `/api/work-sessions/patterns`·`/api/reports`로 적었는데 둘 다 없는 주소였다
    //     (앞의 것은 `:id` 라우트에 걸려 "세션 없음"이 온다 — 조용히 빈 화면이 된다).
    workSessions: await g("/api/work-sessions"),
    sessionPatterns: await g("/api/session-patterns?days=30"),
    reportHistory: await g("/api/report/history"),
    // ★ 2026-08-08 추가 기능 화면(제품 소개자료·보안 로그 분석).
    //   ⚠ 여기 안 적으면 아래 Proxy가 빈 배열을 돌려줘 **조용히 빈 화면**이 찍힌다.
    //     실제로 그렇게 찍어 봤다 — 「등록된 소개자료가 없습니다」가 자료에 들어갈 뻔했다.
    productIntros: await g("/api/product-intro"),
    logFiles: await g("/api/loganalysis/files"),
    analysisEvents: await g("/api/analysis/events"),
  };

  // 브라우저에 주입할 window.gijo 스텁(읽기=주입 데이터 반환, 쓰기/구독=no-op). 페이지 스크립트보다 먼저 실행.
  function installStub(DATA) {
    const R = (v) => Promise.resolve(v);
    const noop = () => {};
    const gijo = {
      isAuthenticated: () => true,
      getServerUrl: () => DATA.serverUrl,
      checkServerHealth: () => R({ ok: true }),
      me: () => R(DATA.me),
      navigateTo: noop,
      // 읽기(화면이 로드 시 호출)
      getSecurityKpi: () => R(DATA.kpi),
      getCtiAssetMatches: () => R(DATA.ctiMatches),
      listCtiFeeds: () => R(DATA.ctiFeeds),
      listCtiFindings: () => R(DATA.ctiFindings),
      getServiceImpact: () => R(DATA.serviceImpact),
      listAssets: () => R(DATA.assets),
      getAsset: (id) => R((DATA.assets || []).find((a) => a.id === id)),
      listMaintenance: () => R(DATA.maintenance),
      listDueMaintenance: () => R(DATA.maintenanceDue),
      getMaintenanceNotify: () => R(DATA.maintenanceNotify),
      getMaintenanceHistory: (id) => R(DATA.histById[id] || []),
      listAgents: () => R(DATA.agents),
      getAgentRecommendations: () => R(DATA.agentRecs),
      listModels: () => R(DATA.models),
      getLocalEngineStatus: () => R(DATA.engineStatus),
      listCompliance: () => R(DATA.compliance),
      listApprovals: () => R(DATA.approvals),
      listTasks: () => R(DATA.tasks),
      listCollaborationHistory: () => R(DATA.collaboration),
      listLlmActivity: () => R(DATA.llmActivity),
      listLlmGuide: () => R(DATA.llmGuide),
      listModelDex: () => R(DATA.modelDex),
      listLogs: () => R(DATA.logs || []),
      getGpuUsage: () => R(DATA.gpuUsage),
      getRoutineSuggestions: () => R(DATA.routineSuggestions || []),
      listActionPriorities: () => R(DATA.actionPriorities),
      listMemoryDocuments: () => R(DATA.memoryDocuments || []),
      analysisEvents: () => R(DATA.analysisHub),
      listOntology: () => R(DATA.ontology || []),
      guardrailStatus: () => R(DATA.guardrailStatus),
      guardrailLog: () => R(DATA.guardrailLog || []),
      lastRedTeam: () => R(DATA.redteamLast),
      redteamTargets: () => R(DATA.redteamTargets),
      listUsers: () => R(DATA.users || []),
      getUsageSummary: () => R(DATA.usage),
      getSmtpConfig: () => R(DATA.smtp),
      getLearnloopConfig: () => R(DATA.learnloopConfig),
      getLearnloopPreflight: () => R(DATA.learnloopPreflight),
      listLearnloopLogs: () => R(DATA.learnloopLogs),
      listLearnloopRuns: () => R(DATA.learnloopRuns),
      listHfDownloadJobs: () => R(DATA.hfJobs || []),
      listDir: () => R({ root: "GIJO", rootName: "GIJO", path: "", items: [] }),
      listSecurityProductsGrouped: () => R(DATA.securityProductsGrouped),
      getProductCategories: () => R(DATA.productCategories),
      listSecurityProducts: () => R(DATA.securityProducts),
      // 신규 화면용 — 팀 사무실·인수인계·작업기록·원격 정기점검.
      getToday: () => R(DATA.today),
      listActiveSessions: () => R(DATA.activeSessions || []),
      listAudit: () => R(DATA.audit),
      hardeningTargets: { list: () => R(DATA.hardeningTargets) },
      hardeningSchedules: { list: () => R(DATA.hardeningSchedules) },
      hardeningRuns: () => R(DATA.hardeningRuns),
      // ★ 2026-08-04 새로 찍는 화면(작업 세션·리포트).
      //   ⚠ 아래 Proxy가 모르는 함수에 **빈 배열**을 돌려주므로, 안 적으면 화면이 깨지지 않고
      //     **조용히 비어 보인다.** 빈 화면을 제안 자료에 넣으면 "이 기능은 아무것도 없나 보다"가 된다.
      // ⚠ 이건 **동기 함수**다(Promise가 아니다). Proxy 기본값(Promise)이 걸리면
      //   `info.remainingMs`가 undefined가 되어 상단에 「⏳ 세션 NaN:NaN」이 찍힌다
      //   — 제안 자료에 그 글자가 들어갈 뻔했다(2026-08-04).
      sessionActivity: () => ({ remainingMs: 27 * 60 * 1000, monitorMode: false }),
      listWorkSessions: () => R(DATA.workSessions || []),
      sessionPatterns: () => R(DATA.sessionPatterns || {}),
      listReportHistory: () => R(DATA.reportHistory || []),
      listProductIntros: () => R(DATA.productIntros || { items: [] }),
      logAnalysisFiles: () => R(DATA.logFiles || { files: [] }),
      analysisEvents: () => R(DATA.analysisEvents || { events: [] }),
      logAnalysisGuide: () => R({ steps: [] }),
      onCollaborationEvent: noop,
      // 터미널 화면 — 실제 로컬 셸 스폰 없이 빈 상태(대기 화면)만 보여준다.
      terminal: {
        start: () => R({ shell: "PowerShell", cwd: "C:\\Users\\user" }),
        exec: () => R({ blocked: false, output: "" }),
        onData: noop,
      },
    };
    // 이벤트 구독 + 나머지 모든 메서드는 no-op(스크린샷은 사용자 조작이 없으므로 안전).
    return new Proxy(gijo, {
      get(t, k) {
        if (k in t) return t[k];
        if (typeof k === "string" && k.startsWith("on")) return noop;
        return () => Promise.resolve([]);
      },
    });
  }

  const shots = [
    { page: "kpi.html", name: "01-보안KPI대시보드" },
    { page: "threat.html", name: "02-CTI위협-자산매칭" },
    { page: "inventory.html", name: "03-AI자산-서비스영향도" },
    { page: "maintenance.html", name: "04-정기점검-승인거버넌스" },
    { page: "approvals.html", name: "05-승인워크플로우" },
    { page: "learnloop.html", name: "06-학습루프" },
    { page: "agent.html", name: "08-에이전트AI" },
    { page: "compliance.html", name: "09-컴플라이언스" },
    { page: "sbom.html", name: "10-AI-BOM-SBOM" },
    { page: "vulnscan.html", name: "11-취약자산관리-생애주기" },
    { page: "products.html", name: "12-보안제품관리-매뉴얼" },
    // 전 메뉴 커버(제품소개 자료용) — 위 12장에 없던 나머지 화면.
    { page: "dashboard.html", name: "13-메인대시보드-지휘콘솔" },
    { page: "analysis.html", name: "14-통합관제-보안분석" },
    // 2026-08-09 그룹 통합 — 사이드바 다섯 절차는 각각 허브 한 화면이다(한눈에 띠 + 무대).
    //   자료에는 담당자가 실제로 여는 이 화면이 들어가야 한다.
    { page: "discover.html", name: "20-발견수집-허브" },
    { page: "triage.html", name: "21-우선순위-허브" },
    { page: "fix.html", name: "22-조치-허브" },
    { page: "verify.html", name: "23-검증-허브" },
    { page: "reporting.html", name: "24-보고-허브" },
    { page: "aihub.html", name: "25-AI-허브" },
    { page: "records.html", name: "26-기록-허브" },
    { page: "loganalysis.html", name: "27-보안로그분석" },
    { page: "intro.html", name: "28-제품소개자료" },
    { page: "lawlookup.html", name: "29-법령판례" },
    { page: "redteam.html", name: "15-레드팀-가드레일" },
    { page: "memory.html", name: "17-기억학습-문서관리" },
    { page: "merge.html", name: "18-LLM합성-모델머지" },
    // ★ 2026-08-04: logs.html은 **없어졌다**(2026-08-02에 syslog.html로 떼어냄).
    //   nav.js는 옛 주소를 새 화면으로 보내 주지만, 이 도구는 파일을 직접 열어서 못 찾는다.
    //   mcp.html도 2026-07-28에 설정으로 흡수돼 사라졌다 — 목록에서 뺀다.
    //   ⚠ 이 목록은 **손으로 관리한다** — 화면이 생기거나 없어지면 여기도 고쳐야 한다.
    //     아래 시험(shotlist)이 실제 파일과 대조해 낡으면 잡는다.
    { page: "syslog.html", name: "20-시스템로그" },
    { page: "settings.html", name: "21-설정-사용자관리" },
    // 매뉴얼 v3.3.3 갱신분 — 이전엔 없던 화면.
    { page: "office.html", name: "22-팀사무실" },
    { page: "handover.html", name: "23-인수인계" },
    { page: "audit.html", name: "24-작업기록-감사" },
    { page: "hardening.html", name: "25-원격정기점검" },
    { page: "terminal.html", name: "27-터미널CLI" },
    // ★ 2026-08-04 파트너 지적 대응(전-1·전-7): 제안·시연 자료에 **실제 화면**을 넣기로 했다.
    //   파트너 회사는 EDR이 설치를 막아 제품을 못 띄웠고, 그래서 글자로만 판단했다.
    //   업무 절차 재편(2026-08-02) 뒤 생긴 화면들이 빠져 있어 자료가 지금 제품과 달라진다.
    { page: "sessions.html", name: "28-작업세션" },
    { page: "report.html", name: "29-리포트" },
  ];

  // GIJO_SHOT_ONLY="05,06" — 일부 화면만 다시 찍고 싶을 때(파일명 접두 번호로 필터). 없으면 전체.
  const only = (process.env.GIJO_SHOT_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const shotList = only.length ? shots.filter((s) => only.some((p) => s.name.startsWith(p))) : shots;

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  // 외부 로고(gijo.ai) 요청은 오프라인이라 차단해 렌더 지연 방지.
  await ctx.route(/gijo\.ai/, (route) => route.abort());
  // 온보딩 오버레이는 대시보드 최초 진입 시 자동으로 뜨며 화면을 가린다 — '이미 봤음'으로 표시해 억제.
  await ctx.addInitScript(`try { localStorage.setItem("gijo:onboarding:seen", "1"); } catch (e) {}
    (${installStub.toString()})(${JSON.stringify(DATA)});
    window.gijo = (${installStub.toString()})(${JSON.stringify(DATA)});
    window.gijoRealtime = { connect: () => {} };`);

  for (const s of shotList) {
    const page = await ctx.newPage();
    try {
      // 탭 주소(settings.html?s=ai)도 찍는다 — 파일 경로와 질의문자열을 나눠 붙여야 한다
      // (통째로 pathToFileURL에 넣으면 "?"까지 파일명이 되어 ERR_FILE_NOT_FOUND, 2026-08-06 실측).
      const [파일, 질의] = s.page.split("?");
      const 주소 = pathToFileURL(path.join(PAGES_DIR, 파일)).href + (질의 ? `?${질의}` : "");
      await page.goto(주소, { waitUntil: "load", timeout: 15000 });
      // 헤더 로고는 gijo.ai에서 받아오는데 오프라인이라 차단된다 → 깨진 이미지 아이콘이 남으므로 숨긴다.
      // (옆에 "GIJO AS" 텍스트가 이미 있어 로고가 빠져도 헤더가 비지 않는다.)
      await page.addStyleTag({ content: 'img[src*="gijo.ai"]{display:none!important}' });
      await page.waitForTimeout(1200); // 렌더/데이터 반영 대기
      // 승인(마스터·디테일) 화면은 첫 finding을 자동 선택해 우측 상세(담당 배정·검증·타임라인)까지 담는다.
      if (s.page === "approvals.html") {
        await page.evaluate(() => document.querySelector("#rvList .rv-row")?.click());
        await page.waitForTimeout(500);
      }
      // ⚠ 설정 화면을 탭 주소로 찍어 보았으나(2026-08-06) 접힌 구역 구조라 한 장에 안 담기고,
      //   이 캡처 환경은 GPU를 못 봐 "NVIDIA GPU 없음"이 찍힌다 — 고객 자료에 사실과 다른
      //   문구를 넣지 않으려고 촬영을 접었다. 소개덱도 그 장을 뺐다(gen-intro-deck.mjs).
      const outFile = path.join(OUT_DIR, `${s.name}.png`);
      if (DECK) {
        await page.screenshot({ path: outFile }); // 뷰포트만(16:10)
      } else {
        // 매뉴얼용 풀페이지. 다만 데이터가 많은 목록 화면(승인·위협 등)은 세로가 수만 px까지 치솟아
        // 매뉴얼에 못 쓴다 — 정상 화면 최대치(~2900px)보다 넉넉한 상한에서 상단만 캡처한다.
        // (clip은 fullPage 없이 뷰포트로 잘려 무용지물이라, 뷰포트 높이를 상한으로 키워 상단을 담는다.)
        const MANUAL_MAX_H = 3200; // CSS px
        const contentH = await page.evaluate(() => document.documentElement.scrollHeight);
        if (contentH > MANUAL_MAX_H) {
          await page.setViewportSize({ width: 1440, height: MANUAL_MAX_H });
          await page.waitForTimeout(200); // 뷰포트 변경 후 재배치 대기
          await page.screenshot({ path: outFile });
        } else {
          await page.screenshot({ path: outFile, fullPage: true });
        }
      }
      console.log("✓", s.name);
    } catch (e) {
      console.log("✗", s.name, String(e.message).split("\n")[0]);
    }
    await page.close();
  }
  await browser.close();
  console.log("\n스크린샷 폴더:", OUT_DIR);
}
main().catch((e) => { console.error(e); process.exit(1); });
