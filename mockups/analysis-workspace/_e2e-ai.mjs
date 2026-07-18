// 실 Electron E2E — 분석 화면의 신규 기능: 이벤트 LLM 분석 + 조치 생성(작업 등록).
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
await step("로그인 + 분석 화면", async () => {
  await win.fill("#username", "jyh"); await win.fill("#password", "changeme"); await win.click("#loginBtn");
  await win.waitForFunction(() => !location.pathname.endsWith("login.html"), { timeout: 20000 });
  win.evaluate(() => window.gijo.navigateTo("analysis.html")).catch(()=>{});
  await win.waitForSelector("#riskList", { timeout: 20000 });
});
await step("포트스캔 로그 인입 + 로그 필터로 선택", async () => {
  await win.evaluate(async () => {
    const fw = Array.from({length:20},(_,i)=>"Jul 18 fw kernel: DENY SRC=45.33.0.77 DST=10.0.0.5 DPT="+(2000+i)).join("\n");
    await window.gijo.analysisIngest("ufw-e2e.log", fw);
  });
  await win.click("#refreshBtn");
  await win.waitForTimeout(1500);
  await win.click('#filters .fchip[data-src="log"]');
  await win.waitForTimeout(400);
  await win.click("#riskList .risk-row"); // 로그 필터 상위 = 포트스캔
  await win.waitForTimeout(300);
  const body = await win.textContent("#anaBody");
  if(!body.includes("소스:")) throw new Error("상세 미표시");
});
await step("🤖 AI 분석 버튼 → LLM 요약 표시", async () => {
  await win.click("#aiBtn");
  await win.waitForFunction(() => {
    const b = document.querySelector("#aiBox");
    return b && b.textContent.includes("AI 분석") && !b.textContent.includes("분석 중");
  }, { timeout: 120000 });
  const box = await win.textContent("#aiBox");
  console.log("   AI 분석 일부:", box.replace(/\s+/g," ").slice(0, 80) + "…");
});
await step("▶ 조치 생성 → 작업 등록", async () => {
  const before = (await win.evaluate(() => window.gijo.listTasks())).length;
  await win.click("#mkTask");
  await win.waitForTimeout(800);
  const after = (await win.evaluate(() => window.gijo.listTasks()));
  const added = after.length - before;
  const hasOurs = after.some(t => (t.text||"").includes("포트 스캔") || (t.text||"").includes("45.33.0.77"));
  console.log("   작업 증가:", added, "| 우리 작업 포함:", hasOurs);
  if(added < 1) throw new Error("작업이 등록되지 않음");
});

await win.screenshot({ path: path.resolve("mockups","analysis-workspace","e2e-ai.png"), fullPage: true });
await app.close();
console.log("\n=== 콘솔/페이지 에러:", errors.length ? errors : "없음", "===");
process.exit(errors.length ? 1 : 0);
