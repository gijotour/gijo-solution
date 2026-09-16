// 임시 — 「행동 기록 읽어주는 거울」 시제품. git 로그만 읽는다(아무것도 안 바꾼다).
import { execSync } from "node:child_process";

const 원본 = execSync(
  'git log --all --author=gijotour --date=iso-strict --pretty=format:"%H|%ad|%s"',
  { cwd: "D:/Connect AI", maxBuffer: 64 * 1024 * 1024 }
).toString();

const 커밋 = 원본.split("\n").filter(Boolean).map((l) => {
  const [h, d, ...s] = l.split("|");
  return { h, t: new Date(d), s: s.join("|") };
}).filter((c) => !Number.isNaN(c.t.getTime())).sort((a, b) => a.t - b.t);

if (!커밋.length) { console.log("커밋을 못 읽었다"); process.exit(0); }

const 첫 = 커밋[0].t, 끝 = 커밋[커밋.length - 1].t;
const 일수 = Math.max(1, Math.round((끝 - 첫) / 86400000));
console.log(`■ 표본: 커밋 ${커밋.length}건 · ${첫.toISOString().slice(0,10)} ~ ${끝.toISOString().slice(0,10)} (${일수}일)\n`);

// ── ① 시각 분포 ─────────────────────────────────────────────
const 시간별 = new Array(24).fill(0);
for (const c of 커밋) 시간별[c.t.getHours()]++;
const 최대 = Math.max(...시간별);
console.log("■ 하루 중 언제 일하나 (커밋 시각)");
for (let h = 0; h < 24; h++) {
  const 칸 = "█".repeat(Math.round((시간별[h] / 최대) * 32));
  const 표 = h >= 23 || h < 6 ? " ← 밤·새벽" : "";
  console.log(`  ${String(h).padStart(2, "0")}시 ${String(시간별[h]).padStart(4)} ${칸}${표}`);
}
const 밤 = 시간별.reduce((s, n, h) => s + (h >= 23 || h < 6 ? n : 0), 0);
console.log(`  → 밤 11시~새벽 6시: **${((밤 / 커밋.length) * 100).toFixed(1)}%** (${밤}건)\n`);

// ── ② 요일 ──────────────────────────────────────────────────
const 요일이름 = ["일", "월", "화", "수", "목", "금", "토"];
const 요일별 = new Array(7).fill(0);
for (const c of 커밋) 요일별[c.t.getDay()]++;
const 주말 = 요일별[0] + 요일별[6];
console.log("■ 요일");
console.log("  " + 요일별.map((n, i) => `${요일이름[i]} ${n}`).join(" · "));
console.log(`  → 주말 비율: **${((주말 / 커밋.length) * 100).toFixed(1)}%**\n`);

// ── ③ 연속 작업(세션) — 커밋 간격 3시간 이상이면 끊긴 것으로 본다 ──
const 간격MS = 3 * 3600 * 1000;
const 세션 = [];
let 현재 = [커밋[0]];
for (let i = 1; i < 커밋.length; i++) {
  if (커밋[i].t - 커밋[i - 1].t > 간격MS) { 세션.push(현재); 현재 = [커밋[i]]; }
  else 현재.push(커밋[i]);
}
세션.push(현재);
const 길이 = 세션.map((s) => (s[s.length - 1].t - s[0].t) / 3600000);
const 긴것 = [...세션].map((s, i) => ({ i, h: 길이[i], d: s[0].t })).sort((a, b) => b.h - a.h).slice(0, 5);
console.log("■ 한 번 앉으면 얼마나 (커밋 간격 3시간 이상이면 끊긴 것으로 셈)");
console.log(`  세션 ${세션.length}회 · 평균 ${(길이.reduce((a, b) => a + b, 0) / 세션.length).toFixed(1)}시간`);
console.log(`  6시간 넘긴 세션: ${길이.filter((h) => h >= 6).length}회 · 10시간 넘긴 세션: **${길이.filter((h) => h >= 10).length}회**`);
console.log("  가장 긴 다섯:");
for (const g of 긴것) console.log(`    ${g.d.toISOString().slice(0, 10)}  ${g.h.toFixed(1)}시간`);
console.log("");

// ── ④ 최근 30일 밀도 ────────────────────────────────────────
const 이제 = 커밋[커밋.length - 1].t;
const 최근30 = 커밋.filter((c) => 이제 - c.t <= 30 * 86400000);
const 최근30일자 = new Set(최근30.map((c) => c.t.toISOString().slice(0, 10)));
console.log("■ 최근 30일");
console.log(`  커밋 ${최근30.length}건 · 일한 날 ${최근30일자.size}/30일 · 쉰 날 **${30 - 최근30일자.size}일**`);
const 최근밤 = 최근30.filter((c) => c.t.getHours() >= 23 || c.t.getHours() < 6).length;
console.log(`  그중 밤·새벽 ${최근밤}건 (${((최근밤 / Math.max(최근30.length, 1)) * 100).toFixed(1)}%)\n`);

// ── ⑤ 일하는 결 — 커밋 메시지 ────────────────────────────────
const 길이들 = 커밋.map((c) => c.s.length);
const 되돌림 = 커밋.filter((c) => /revert|되돌리|롤백|원복/i.test(c.s)).length;
const 수리 = 커밋.filter((c) => /수리|고침|고친|fix|버그|결함/i.test(c.s)).length;
console.log("■ 일하는 결");
console.log(`  커밋 제목 평균 ${Math.round(길이들.reduce((a, b) => a + b, 0) / 길이들.length)}자 (보통 저장소는 40~60자)`);
console.log(`  「수리·결함」이 제목에 든 커밋: ${수리}건 (${((수리 / 커밋.length) * 100).toFixed(1)}%)`);
console.log(`  되돌림·롤백: ${되돌림}건 (${((되돌림 / 커밋.length) * 100).toFixed(1)}%)`);
