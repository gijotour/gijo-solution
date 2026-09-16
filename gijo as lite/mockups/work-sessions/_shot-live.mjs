// 실제 client/src/renderer/pages/sessions.html을 window.gijo 스텁으로 렌더해 캡처한다.
// (목업이 아니라 실제 페이지의 CSS·구조·렌더 로직을 눈으로 검증)
import { createRequire } from "module"; import path from "path"; import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client", "package.json"));
const { chromium } = req("playwright-core");
const page = pathToFileURL(path.resolve("client", "src", "renderer", "pages", "sessions.html")).href;

const SESSIONS = [
  { id: "s1", title: "오늘 급한 취약점 확인·배정", status: "active", createdAt: Date.now() - 3600e3, updatedAt: Date.now() - 60e3, turnCount: 6, lastPreview: "1. Log4j 2.17+ 업그레이드 2. 임시완화 formatMsgNoLookups …", lastRole: "assistant" },
  { id: "s2", title: "방화벽 로그 브루트포스 분석", status: "done", createdAt: Date.now() - 90000e3, updatedAt: Date.now() - 86400e3, turnCount: 2, lastPreview: "203.0.113.5에서 SSH 무차별 대입 137회 — 차단 권고", lastRole: "assistant" },
  { id: "s3", title: "주간 취약점 재점검", status: "done", createdAt: Date.now() - 200000e3, updatedAt: Date.now() - 172800e3, turnCount: 1, lastPreview: "제일 위험한 3건: Log4j, OpenSSL, Struts2", lastRole: "assistant" },
  { id: "s4", title: "사내 챗봇 AI 견고성 점검", status: "ignored", createdAt: Date.now() - 300000e3, updatedAt: Date.now() - 259200e3, turnCount: 2, lastPreview: "레드팀 14 페이로드 중 2건 우회 — 가드레일 block 권고", lastRole: "assistant" },
];
const TURNS = {
  s1: [
    { id: "t1", sessionId: "s1", role: "user", content: "오늘 제일 급한 취약점 뭐야?", at: 0 },
    { id: "t2", sessionId: "s1", role: "assistant", tool: "today", content: "[critical] Apache Log4j < 2.15.0 RCE (CVE-2021-44228) @ 사내 상담 챗봇. KEV 등재 — 최우선입니다.", at: 0 },
    { id: "t3", sessionId: "s1", role: "user", content: "web01 Log4j 담당 정요한으로 배정해줘", at: 0 },
    { id: "t4", sessionId: "s1", role: "assistant", tool: "결재판", content: "담당자·기한 배정을 준비했습니다. 값 확인 후 대시보드 결재판에서 승인하세요.", at: 0 },
    { id: "t5", sessionId: "s1", role: "user", content: "이 취약점 조치 절차 알려줘", at: 0 },
    { id: "t6", sessionId: "s1", role: "assistant", tool: "remediation", content: "1. Log4j 2.17+ 업그레이드 2. 임시완화 formatMsgNoLookups=true 3. 인증 후 재스캔으로 해결 검증", at: 0 },
  ],
};
const ASSETS = [
  { id: "chatbot-01", name: "사내 상담 챗봇", findings: [{ severity: "critical" }] },
  { id: "doc-ai", name: "문서 분류 AI", findings: [] },
];
const GROUPS = [{ category: "방화벽", products: [{ id: "p1" }, { id: "p2" }] }, { category: "EDR", products: [{ id: "p3" }] }];

const stub = { SESSIONS, TURNS, ASSETS, GROUPS };

const b = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await p.addInitScript((data) => {
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 5));
  window.gijo = {
    isAuthenticated: () => true,
    me: () => delay({ displayName: "정요한", username: "jyh", role: "admin" }),
    checkServerHealth: () => delay({ ok: true }),
    navigateTo: () => {},
    listAssets: () => delay(data.ASSETS),
    listSecurityProductsGrouped: () => delay(data.GROUPS),
    listWorkSessions: () => delay(data.SESSIONS),
    getWorkSession: (id) => delay({ session: data.SESSIONS.find((s) => s.id === id), turns: data.TURNS[id] || [] }),
    createWorkSession: () => delay({ id: "new", title: "새 세션", status: "active", createdAt: Date.now(), updatedAt: Date.now() }),
    updateWorkSession: () => delay({}),
    deleteWorkSession: () => delay({ ok: true }),
    sendInstruction: () => delay({ output: "ok" }),
  };
}, stub);
await p.goto(page, { waitUntil: "load" });
await p.waitForTimeout(700);
await p.screenshot({ path: path.resolve("mockups", "work-sessions", "live-sessions.png"), fullPage: false });
console.log("캡처: live-sessions.png");
await b.close();
