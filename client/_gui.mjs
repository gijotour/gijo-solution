import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const p = b.contexts()[0].pages()[0];
p.on("dialog",(d)=>d.accept().catch(()=>{}));
// 로그인
if (await p.evaluate(()=>!!document.querySelector("#username,input[name=username]"))) {
  await p.evaluate((pw)=>{
    const u=document.querySelector("#username,input[name=username]"), q=document.querySelector("#password,input[type=password]");
    u.value="claude-deploy"; q.value=pw;
    u.dispatchEvent(new Event("input",{bubbles:true})); q.dispatchEvent(new Event("input",{bubbles:true}));
    (document.querySelector("#loginBtn,button[type=submit],.login-btn")||{click(){}}).click();
  },process.env.GIJO_ADMIN_PASSWORD);  // 평문 금지 — 환경변수에서 읽는다(CLAUDE.md · repo에 비번 기록 금지)
  await p.waitForTimeout(6000);
}
console.log("화면:", p.url().split("/").pop());
// 승인카드 실렌더 — 실제 업로드 결과 모양의 객체로 카드를 그려 시각 확인(함수·CSS 실검증)
const errs=[]; p.on("pageerror",e=>errs.push(String(e).slice(0,100)));
await p.evaluate(()=>{
  const row1 = window.clAppend("event", { icon:"📥", name:"스마트 업로드", message:"검증용" });
  window.renderApprovalCard(row1.querySelector(".cm"), "FW-2000_운영_매뉴얼.pdf",
    { routedTo:"memory", reason:"사용자 지정: 문서", category:"장비운영", memory:{ chunks:34, docClass:"매뉴얼", category:"장비운영" } });
  const row2 = window.clAppend("event", { icon:"📥", name:"스마트 업로드", message:"검증용" });
  window.renderApprovalCard(row2.querySelector(".cm"), "회의메모.txt",
    { routedTo:"memory", reason:"사용자 지정: 문서", category:"일반", memory:{ chunks:2, category:"일반" } });
});
await p.waitForTimeout(500);
const check = await p.evaluate(()=>({
  badges: document.querySelectorAll(".cl-cat-badge").length,
  low: document.querySelectorAll(".cl-cat-badge.low").length,
  fixBtn: document.querySelectorAll(".cl-cat-fix").length,
  ask: document.querySelectorAll(".cl-cat-ask").length,
  opts: document.querySelectorAll(".cl-cat-ask .cl-cat-opt").length,
}));
console.log(`배지 ${check.badges}(확신낮음 ${check.low}) · 수정버튼 ${check.fixBtn} · 되물음 ${check.ask}(옵션 ${check.opts}) · JS에러 ${errs.length}`);
const okAll = check.badges===2 && check.low===1 && check.fixBtn===1 && check.ask===1 && check.opts===5 && errs.length===0;
console.log(okAll ? "✓ 승인카드 GUI 검증 통과" : "✗ 검증 실패 "+errs.join("|"));
await p.screenshot({ path:"D:/Connect AI/mockups/rag-approval-card/live-dashboard.png" });
