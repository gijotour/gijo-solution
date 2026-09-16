// 실 Electron E2E — 이벤트 생애주기: 샘플 이벤트 선택 → 완료 처리 → 목록 흐림·활성위험 감소.
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
  await win.fill("#username","jyh"); await win.fill("#password","changeme"); await win.click("#loginBtn");
  await win.waitForFunction(() => !location.pathname.endsWith("login.html"), { timeout: 20000 });
  win.evaluate(() => window.gijo.navigateTo("analysis.html")).catch(()=>{});
  await win.waitForSelector("#riskList .risk-row", { timeout: 25000 });
});

const sumActive = async () => { const m = (await win.textContent("#tPri")).match(/P0 (\d+) . P1 (\d+) . P2 (\d+)/); return Number(m[1])+Number(m[2])+Number(m[3]); };
let before;
await step("첫 활성 이벤트 선택 + 상태 버튼 표시", async () => {
  before = await sumActive();
  await win.click("#riskList .risk-row"); // 최상위(활성 = P0)
  await win.waitForTimeout(300);
  const has = await win.$('[data-st="done"]');
  if(!has) throw new Error("상태 버튼 없음");
  console.log("   시작 활성위험(P0+P1+P2):", before);
});

await step("완료 처리 → 상태 반영·활성 위험 1 감소", async () => {
  await win.click('[data-st="done"]');
  await win.waitForTimeout(1500);
  const anaBody = await win.textContent("#anaBody");
  if(!anaBody.includes("처리 상태") || !anaBody.includes("완료")) throw new Error("상태 완료 미반영");
  const after = await sumActive();
  console.log("   완료 후 활성위험:", after, "(감소:", before - after, ")");
  if(after !== before - 1) throw new Error(`활성 위험이 정확히 1 줄지 않음 (${before}→${after})`);
});

await win.screenshot({ path: path.resolve("mockups","analysis-workspace","e2e-lifecycle.png"), fullPage: true });
await app.close();
console.log("\n=== 콘솔/페이지 에러:", errors.length ? errors : "없음", "===");
process.exit(errors.length ? 1 : 0);
