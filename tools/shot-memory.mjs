// tools/shot-memory.mjs — memory.html(AI 기억·학습)을 라이브 서버(:4000) 실데이터로 렌더해 스크린샷.
// 올린 문서 관리(장기기억 목록/상세/삭제) 섹션 확인용. 실 /api/memory/documents + 조각을 주입.

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const BASE = process.env.GIJO_SHOT_BASE ?? "http://localhost:4000";
const PAGES_DIR = path.join(ROOT, "client", "src", "renderer", "pages");
const OUT_DIR = path.join(ROOT, "mockups", "docmanage");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "jyh", password: "changeme" }),
  }).then((r) => r.json());
  const auth = { headers: { Authorization: `Bearer ${login.accessToken}`, "Content-Type": "application/json" } };
  const documents = await fetch(`${BASE}/api/memory/documents`, { headers: auth.headers }).then((r) => r.json());
  const top = documents[0];
  const chunks = top
    ? await fetch(`${BASE}/api/memory/document/chunks`, { method: "POST", headers: auth.headers, body: JSON.stringify({ documentId: top.documentId, limit: 5 }) }).then((r) => r.json())
    : [];
  const agents = await fetch(`${BASE}/api/agents`, { headers: auth.headers }).then((r) => r.json());

  const DATA = { me: login.user, documents, chunks, topId: top && top.documentId, agents };

  function installStub(DATA) {
    const R = (v) => Promise.resolve(v);
    const noop = () => {};
    const gijo = {
      isAuthenticated: () => true,
      getServerUrl: () => "http://localhost:4000",
      checkServerHealth: () => R({ ok: true }),
      me: () => R(DATA.me),
      navigateTo: noop,
      listAgents: () => R(DATA.agents),
      listMemoryDocuments: () => R(DATA.documents),
      memoryDocumentChunks: (id) => R(id === DATA.topId ? DATA.chunks : []),
      deleteMemoryDocument: () => R({ deletedChunks: 0, deletedFile: false }),
      listDir: () => R({ items: [] }),
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.route(/gijo\.ai/, (route) => route.abort());
  await ctx.addInitScript(`window.gijo = (${installStub.toString()})(${JSON.stringify(DATA)});
    window.gijoRealtime = { connect: () => {}, on: () => {}, off: () => {} };`);
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(PAGES_DIR, "memory.html")).href, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1500);
  // 관리 패널로 스크롤해서 잘 보이게.
  await page.evaluate(() => document.getElementById("dmList")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, "impl-memory.png"), fullPage: false });
  console.log("documents:", documents.length, "| top:", top && top.documentId, "| chunks:", chunks.length);
  console.log("saved:", path.join(OUT_DIR, "impl-memory.png"));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
