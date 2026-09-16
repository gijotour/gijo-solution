// 실 Electron E2E — 레드팀 대상선택 UI(A 드롭다운) + AI-BOM 자산 견고성 카드(C 자산 내장).
// 사전: AI-BOM 자산(modelRef 연결) 1건을 API로 생성 → 드롭다운·카드 양쪽에 나타나야 함.
import { createRequire } from "module";
import path from "path";
const req = createRequire(path.resolve("client", "package.json"));
const { _electron: electron } = req("playwright-core");

const BASE = "http://localhost:4000";
const MODEL = "bartowski__Qwen2.5-3B-Instruct-GGUF";
const ASSET_ID = "rt-ui-asset";

async function api(pathname, method, token, body) {
  const r = await fetch(BASE + pathname, { method: method || "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}

const token = (await api("/api/auth/login", "POST", null, { username: "jyh", password: "changeme" })).accessToken;
// 사전: modelRef 연결 자산 + 견고성 점수(점검 없이도 카드가 값 있는 상태로 보이게 직접 기록은 못하므로 미점검 상태로 시작)
await api("/api/assets", "POST", token, { id: ASSET_ID, name: "레드팀UI 챗봇", path: "n/a", assetType: "LLM 서비스" });
await api("/api/assets/" + ASSET_ID + "/aibom", "PUT", token, { aibom: { model: { modelRef: MODEL } } });

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

// ── Part 1: redteam.html 대상 드롭다운 ──
await step("redteam.html 이동 + 대상 드롭다운 로드", async () => {
  win.evaluate(() => window.gijo.navigateTo("redteam.html")).catch(()=>{});
  await win.waitForSelector("#targetSelect", { timeout: 20000 });
  await win.waitForFunction(() => document.querySelectorAll("#targetSelect option").length > 3, { timeout: 15000 });
});
await step("드롭다운에 로컬 모델 + AI-BOM 자산 포함", async () => {
  const opts = await win.$$eval("#targetSelect option", els => els.map(e => e.value));
  const hasModel = opts.some(v => v.startsWith("model:"));
  const hasAsset = opts.some(v => v === "asset:" + "rt-ui-asset");
  console.log("   옵션 수:", opts.length, "| 모델옵션:", hasModel, "| 자산옵션:", hasAsset);
  if(!hasModel) throw new Error("로컬 모델 옵션 없음");
  if(!hasAsset) throw new Error("AI-BOM 자산 옵션 없음");
});
await step("AI-BOM 자산 선택 시 기록 안내 노출", async () => {
  await win.selectOption("#targetSelect", "asset:rt-ui-asset");
  await win.waitForTimeout(400);
  const noteShown = await win.$eval("#targetNote", el => getComputedStyle(el).display !== "none");
  if(!noteShown) throw new Error("기록 안내 미표시");
});

// ── Part 2: sbom.html AI-BOM 견고성 카드 ──
await step("sbom.html 이동 + 자산 선택", async () => {
  win.evaluate(() => window.gijo.navigateTo("sbom.html")).catch(()=>{});
  await win.waitForSelector("#sbomRows", { timeout: 20000 });
  await win.waitForSelector('#sbomRows [data-select="rt-ui-asset"]', { timeout: 15000 });
  await win.click('#sbomRows [data-select="rt-ui-asset"]');
  await win.waitForSelector("#aibomRobustness", { timeout: 10000 });
});
await step("견고성 카드 표시(모델 셀렉트·점검 버튼)", async () => {
  await win.waitForTimeout(600);
  const hasSel = await win.$("#robModelSel");
  const hasBtn = await win.$("#robRunBtn");
  if(!hasSel || !hasBtn) throw new Error("견고성 카드 요소 누락");
  // 연결된 modelRef가 셀렉트 기본값으로 잡혔는지
  const selVal = await win.$eval("#robModelSel", el => el.value);
  console.log("   견고성 카드 modelRef 기본선택:", selVal);
  const bodyText = await win.textContent("#aibomRobustness");
  if(!bodyText.includes("AI 견고성")) throw new Error("카드 내용 누락");
});

await win.screenshot({ path: path.resolve("mockups","redteam-targets","e2e-live.png"), fullPage: true });
await app.close();
// 정리: 테스트 자산 삭제
await api("/api/assets/" + ASSET_ID, "DELETE", token);
console.log("\n=== 콘솔/페이지 에러:", errors.length ? errors : "없음", "===");
process.exit(errors.length ? 1 : 0);
