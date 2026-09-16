// 제품 확인 문서용 — 실제 앱의 주요 화면을 로그인 후 순회하며 스크린샷.
import { createRequire } from "module";
import path from "path";
import fs from "fs";
const req = createRequire(path.resolve("client", "package.json"));
const { _electron: electron } = req("playwright-core");
const outDir = path.resolve("mockups", "product-doc");
fs.mkdirSync(outDir, { recursive: true });

const app = await electron.launch({ args: ["."], cwd: path.resolve("client") });
let win = await app.firstWindow();
await win.waitForSelector("#username", { timeout: 20000 });
await win.fill("#username", "jyh"); await win.fill("#password", "changeme"); await win.click("#loginBtn");
await win.waitForFunction(() => !location.pathname.endsWith("login.html"), { timeout: 20000 });

const pages = [
  ["dashboard.html", "shot-dashboard", "#gijoNav"],
  ["analysis.html", "shot-analysis", "#riskList"],
  ["vulnscan.html", "shot-vulnscan", "#gijoNav"],
  ["sbom.html", "shot-aibom", "#sbomRows"],
  ["ontology.html", "shot-ontology", "#gijoNav"],
  ["redteam.html", "shot-redteam", "#targetSelect"],
  ["threat.html", "shot-threat", "#gijoNav"],
  ["agent.html", "shot-agent", "#gijoNav"],
];
for (const [page, name, waitSel] of pages) {
  try {
    win.evaluate((p) => window.gijo.navigateTo(p), page).catch(() => {});
    await win.waitForSelector(waitSel, { timeout: 15000 });
    await win.waitForTimeout(1800);
    await win.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true });
    console.log("캡처:", name);
  } catch (e) { console.log("실패:", name, e.message); }
}
await app.close();
