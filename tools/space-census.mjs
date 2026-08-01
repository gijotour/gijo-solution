// tools/space-census.mjs — 화면 칸 낭비·설명글 전수 조사 (2026-08-02)
//
// 무엇을 세나
//   ① 화면 안 설명글(.panel-sub·.page-sub) — 챗봇 안내(screenguide)에 같은 내용이 있는지 대조
//   ② 세로를 먹는 자리 — 큰 카드 줄, 넓은 입력 줄
// ⚠ 지우기 전에 **챗봇이 대신 말해 주는지** 확인하는 것이 목적이다. 없는데 지우면 정보가 사라진다.
import fs from "node:fs";
import path from "path";

const 화면들 = "client/src/renderer/pages";
const guide = fs.readFileSync("server/src/engine/screenguide.ts", "utf-8");

const 결과 = [];
for (const f of fs.readdirSync(화면들).filter((x) => x.endsWith(".html"))) {
  const s = fs.readFileSync(path.join(화면들, f), "utf-8");
  const 안내있음 = guide.includes(`"${f}"`);
  const subs = [...s.matchAll(/<div class="(?:panel-sub|page-sub)"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter((t) => t && !/^\d+$/.test(t));
  // 이 화면의 안내 블록만 잘라 그 안에서 찾는다(다른 화면 안내에 걸리면 오판).
  const i = guide.indexOf(`"${f}"`);
  const 블록 = i >= 0 ? guide.slice(i, guide.indexOf("\n  },", i) + 5) : "";
  const 덮임 = subs.filter((t) => {
    const 핵심 = t.replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 12);
    return 핵심.length >= 6 && 블록.replace(/[^가-힣A-Za-z0-9]/g, "").includes(핵심);
  });
  const 카드줄 = (s.match(/data-gijo-summary/g) || []).length;
  결과.push({ 화면: f, 안내: 안내있음, 설명: subs.length, 덮임: 덮임.length, 카드줄, 미덮임: subs.filter((t) => !덮임.includes(t)) });
}

결과.sort((a, b) => b.설명 - a.설명);
console.log("화면                 안내  설명  챗봇에있음  덮이지않음");
let 총설명 = 0, 총미덮임 = 0;
for (const r of 결과) {
  if (!r.설명) continue;
  총설명 += r.설명; 총미덮임 += r.미덮임.length;
  console.log(
    r.화면.replace(".html", "").padEnd(20),
    (r.안내 ? "○" : "✗").padEnd(5),
    String(r.설명).padEnd(5),
    String(r.덮임).padEnd(11),
    String(r.미덮임.length)
  );
}
console.log(`\n합계 — 설명글 ${총설명}개 · 챗봇이 이미 말해 주는 것 ${총설명 - 총미덮임}개 · 아직 없는 것 ${총미덮임}개`);
console.log("\n[챗봇에 없는 설명 — 옮기려면 안내부터 써야 하는 것]");
for (const r of 결과) for (const t of r.미덮임) console.log(`  ${r.화면.replace(".html", "")} | ${t.slice(0, 78)}`);
