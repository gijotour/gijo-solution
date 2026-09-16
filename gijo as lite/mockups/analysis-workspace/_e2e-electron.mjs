// 실제 Electron E2E — 보안 분석(통합 관제) 화면: 로그인 → 페이지 → 통합 위험 리스트 →
// 드롭존 인입(자동판별) → 항목 선택 상세 → 상관분석. preload+apiClient+서버 전 구간.
import { createRequire } from "module";
import path from "path";
const req = createRequire(path.resolve("client", "package.json"));
const { _electron: electron } = req("playwright-core");

const app = await electron.launch({ args: ["."], cwd: path.resolve("client") });
const errors = [];
let win = await app.firstWindow();
win.on("pageerror", (e) => errors.push("pageerror: " + e.message));
win.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

async function step(name, fn){ try{ await fn(); console.log("✓", name); }catch(e){ console.log("✗", name, "—", e.message); errors.push(name+": "+e.message); } }

await win.waitForSelector("#username", { timeout: 20000 });
await step("로그인", async () => {
  await win.fill("#username", "jyh"); await win.fill("#password", "changeme"); await win.click("#loginBtn");
  await win.waitForFunction(() => !location.pathname.endsWith("login.html"), { timeout: 20000 });
});
await step("analysis.html 이동", async () => {
  win.evaluate(() => window.gijo.navigateTo("analysis.html")).catch(()=>{});
  await win.waitForSelector("#riskList .risk-row", { timeout: 25000 }); // 실서버 데이터 렌더
});
await step("요약 타일 실서버 로드", async () => {
  const overall = (await win.textContent("#tOverall")).trim();
  const vuln = (await win.textContent("#tVuln")).trim();
  const rows = await win.$$eval("#riskList .risk-row", els => els.length);
  console.log("   종합위험:", overall, "| 취약점:", vuln, "| 위험행:", rows);
  if(!["높음","보통","낮음"].includes(overall)) throw new Error("overall="+overall);
});
await step("드롭존 인입(자동판별) — 브루트포스 로그", async () => {
  const created = await win.evaluate(async () => {
    const log = Array.from({length:15}, ()=>"Jul 18 sshd[1]: Failed password for root from 198.51.100.7 port 22 ssh2").join("\n");
    const r = await window.gijo.analysisIngest("auth.log", log);
    return { routedTo: r.routedTo, created: r.created };
  });
  console.log("   인입 결과:", JSON.stringify(created));
  if(created.routedTo !== "log") throw new Error("routedTo="+created.routedTo);
  if(created.created < 1) throw new Error("이벤트 미생성");
});
await step("새로고침 후 로그 이벤트 반영", async () => {
  await win.click("#refreshBtn");
  await win.waitForFunction(() => {
    const chip = document.querySelector('#filters .fchip[data-src="log"]'); return true;
  }, { timeout: 5000 });
  await win.waitForTimeout(1500);
  const logCount = Number((await win.textContent("#tLog")).trim());
  console.log("   보안로그 타일:", logCount);
  if(logCount < 1) throw new Error("로그 이벤트 미반영");
});
await step("항목 선택 → 상세 분석 표시", async () => {
  await win.click("#riskList .risk-row");
  await win.waitForTimeout(300);
  const body = await win.textContent("#anaBody");
  if(!body.includes("소스:") || !body.includes("우선순위")) throw new Error("상세 미표시");
});
await step("상관분석 패널(교차 위험)", async () => {
  const visible = await win.$eval("#corrPanel", el => getComputedStyle(el).display !== "none").catch(()=>false);
  console.log("   상관분석 패널 표시:", visible);
});

await win.screenshot({ path: path.resolve("mockups","analysis-workspace","e2e-live.png"), fullPage: true });
await app.close();
console.log("\n=== 콘솔/페이지 에러:", errors.length ? errors : "없음", "===");
process.exit(errors.length ? 1 : 0);
