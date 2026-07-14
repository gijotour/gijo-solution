import { _electron as electron } from "playwright-core";
import * as path from "node:path";

const CLIENT_DIR = "D:\\Connect AI\\client";

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

async function main() {
  const app = await electron.launch({
    executablePath: path.join(CLIENT_DIR, "node_modules/electron/dist/electron.exe"),
    args: [CLIENT_DIR],
    timeout: 30_000,
  });

  const page = await app.firstWindow();
  page.on("console", (msg) => log("[page console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => log("[page error]", err.message));
  await page.waitForSelector("#loginBtn", { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.fill("#username", "jyh");
  await page.fill("#password", "changeme");
  await page.click("#loginBtn");
  await page.waitForFunction(() => location.href.includes("dashboard.html"), null, { timeout: 15_000 });

  await page.click("#settingsBtn");
  await page.waitForFunction(() => location.href.includes("settings.html"), null, { timeout: 15_000 });
  await page.waitForFunction(() => document.getElementById("logConsole").childElementCount > 0, null, { timeout: 10_000 });
  const initialCount = await page.evaluate(() => document.getElementById("logConsole").childElementCount);
  const firstLine = await page.evaluate(() => document.getElementById("logConsole").firstChild.textContent);
  log("initial log history loaded, lines:", initialCount, "first:", firstLine);

  // trigger a scan via raw API (outside the page) — dispatcher.ts's catch block calls console.error
  // on the missing modelscan_wrapper.py, which logs.ts should capture and broadcast live.
  const loginRes = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "jyh", password: "changeme" }),
  });
  const { accessToken } = await loginRes.json();
  await fetch("http://localhost:4000/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id: "log-verify-asset", name: "log-verify-asset", path: "models/x.gguf" }),
  });
  await fetch("http://localhost:4000/api/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text: "log-verify-asset 스캔해줘" }),
  });

  await page.waitForFunction(
    (before) => document.getElementById("logConsole").childElementCount > before,
    initialCount,
    { timeout: 10_000 }
  );
  const newCount = await page.evaluate(() => document.getElementById("logConsole").childElementCount);
  const lastLine = await page.evaluate(() => document.getElementById("logConsole").lastChild.textContent);
  log("SUCCESS: live log line appeared with zero manual refresh. lines:", initialCount, "->", newCount, "last:", lastLine);

  await app.close();
}

main().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exit(1);
});
