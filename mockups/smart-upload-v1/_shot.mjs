import { createRequire } from "module"; import path from "path"; import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client","package.json"));
const { chromium } = req("playwright-core");
const dir = path.resolve("mockups","smart-upload-v1");
const b = await chromium.launch({ channel:"msedge", headless:true }).catch(()=>chromium.launch({headless:true}));
for (const [f,n] of [["A-modal","A"],["B-console-inline","B"],["C-popover","C"]]) {
  const p = await b.newPage({ viewport:{width:1080,height:620}, deviceScaleFactor:2 });
  await p.goto(pathToFileURL(path.join(dir,f+".html")).href,{waitUntil:"load"});
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(dir,"shot-"+n+".png"), fullPage:true });
  console.log("캡처",n); await p.close();
}
await b.close();
