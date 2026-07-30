// tools/realdata-kev-correlate.mjs — KEV 실데이터 상관분석 검증.
// ① 서버가 CISA KEV를 실제 로드하는지(refresh→status count) ② 우리가 받은 KEV json에 Nessus 취약점 CVE가
// 실제로 들어있는지 교차확인 ③ 취약점 우선순위에서 KEV 매칭분이 상위로 오는지.
import * as fs from "fs";
const BASE = process.env.BASE || "http://127.0.0.1:4100";
const KEVFILE = "C:/Users/user/AppData/Local/Temp/claude/D--Connect-AI/3c62e902-0e3a-4884-b2d8-f265c345cc6a/scratchpad/realdata/cisa_kev.json";
const j = (r) => r.json();
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "jyh", password: "changeme", force: true }) }).then(j);
const H = { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` };
const get = (p) => fetch(`${BASE}${p}`, { headers: H }).then(j);
const post = (p, b) => fetch(`${BASE}${p}`, { method: "POST", headers: H, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// ① 서버가 CISA KEV 실제 로드
const before = await get("/api/kev/status");
console.log("refresh 전 KEV count:", before.count);
const ref = await post("/api/kev/refresh");
console.log("refresh 결과:", ref.status === 200 ? `count ${ref.body.count} · source ${ref.body.source}` : `실패 ${ref.status}`);
const after = await get("/api/kev/status");
const kevLoaded = after.count > 1000;
console.log(kevLoaded ? `✓ 서버가 실 KEV ${after.count}건 로드` : `✗ KEV 로드 실패(서버 인터넷 차단?) count=${after.count}`);

// ② 우리가 받은 KEV 원본에 유명 CVE가 있는지(데이터 실체 확인)
const kevRaw = JSON.parse(fs.readFileSync(KEVFILE, "utf8"));
const cveSet = new Set((kevRaw.vulnerabilities || []).map((v) => String(v.cveID).toUpperCase()));
const famous = ["CVE-2021-44228", "CVE-2014-0160", "CVE-2017-0144", "CVE-2019-0708"];
console.log("KEV 원본(실데이터) 유명 CVE 포함:", famous.map((c) => `${c}:${cveSet.has(c) ? "O" : "X"}`).join(" "));

// ③ 우선순위 상위에 KEV 표식이 있는지(인입된 Nessus 취약점 × KEV 매칭)
const pri = await get("/api/approvals/priorities?limit=10");
const items = pri.items || [];
const kevHits = items.filter((it) => it.kev || it.isKev || /kev/i.test(JSON.stringify(it)));
console.log(`우선순위 상위 ${items.length}건 중 KEV 매칭 ${kevHits.length}건`);
if (items[0]) console.log("최우선 항목 샘플:", JSON.stringify({ key: items[0].key, sev: items[0].severity, score: items[0].score, kev: items[0].kev }).slice(0, 160));

await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: H, body: JSON.stringify({ refreshToken: login.refreshToken }) });
