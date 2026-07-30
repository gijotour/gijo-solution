// tools/realdata-ingest-test.mjs — 인터넷 실데이터를 제품 파이프라인에 실제로 인입해 검증.
// 소스: DefectDojo 샘플 Nessus(.nessus/.xml), Tenable SC CSV, CISA KEV(json), loghub 실 로그(OpenSSH/Apache/Linux), CycloneDX SBOM.
// 대상 경로: ① 취약점 스캔 인입(/api/vulnscan/import 또는 upload/auto) ② 분석허브 로그/리포트 인입 ③ 업로드 자동분류.
// 로컬 데브 서버(4100)에서만 — 운영 DB 오염 방지. 끝에 요약표 출력.
import * as fs from "fs";
import * as path from "path";
const BASE = process.env.BASE || "http://127.0.0.1:4100";
const DIR = "C:/Users/user/AppData/Local/Temp/claude/D--Connect-AI/3c62e902-0e3a-4884-b2d8-f265c345cc6a/scratchpad/realdata";
const j = (r) => r.json();
const b64 = (p) => fs.readFileSync(path.join(DIR, p)).toString("base64");
const readText = (p) => fs.readFileSync(path.join(DIR, p), "utf8");

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "jyh", password: "changeme", force: true }),
}).then(j);
if (!login.accessToken) { console.log("로그인 실패", login); process.exit(1); }
const H = { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` };
const post = (p, body) => fetch(`${BASE}${p}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const get = (p) => fetch(`${BASE}${p}`, { headers: H }).then(j);

const rows = [];
const rec = (src, target, ok, detail) => { rows.push({ src, target, ok: ok ? "✓" : "✗", detail }); console.log(`${ok ? "✓" : "✗"} [${target}] ${src} — ${detail}`); };

// ── ① Nessus XML → 취약점 스캔 인입 (upload/auto 자동판별) ─────────────
{
  const r = await post("/api/upload/auto", { filename: "nessus_scan.nessus", content: b64("nessus_scan.nessus") });
  const v = r.body.vulnscan;
  rec("DefectDojo Nessus(.nessus)", "취약점 자동인입", r.status === 200 && r.body.routedTo === "vulnscan" && v?.findings > 0, `routed=${r.body.routedTo} 호스트 ${v?.hosts} · finding ${v?.findings}`);
}
{
  const r = await post("/api/upload/auto", { filename: "nessus_scan2.xml", content: b64("nessus_scan2.xml") });
  const v = r.body.vulnscan;
  rec("DefectDojo Nessus(.xml)", "취약점 자동인입", r.status === 200 && v?.findings > 0, `routed=${r.body.routedTo} 호스트 ${v?.hosts} · finding ${v?.findings}`);
}

// ── ② Tenable SC CSV → 취약점 CSV 직접 인입 ──────────────────────────
{
  const r = await post("/api/vulnscan/import", { content: readText("tenable_sc_vulns.csv"), format: "csv", source: "tenable_sc_vulns.csv" });
  rec("Tenable SC 취약점 CSV", "취약점 CSV인입", r.status === 200, `호스트 ${r.body.hosts ?? "?"} · finding ${r.body.findings ?? "?"}`);
}

// ── ③ CISA KEV(실제 악용 취약점 카탈로그) → 취약점 JSON 인입 시도 ───────
// KEV는 {vulnerabilities:[{cveID, vendorProject, product, ...}]} 구조 — host/name 키가 아니라 파서가 어떻게 받는지 관찰.
{
  const kev = JSON.parse(readText("cisa_kev.json"));
  const count = kev.vulnerabilities?.length ?? 0;
  const r = await post("/api/vulnscan/import", { content: readText("cisa_kev.json"), format: "json", source: "cisa_kev.json" });
  rec(`CISA KEV(${count} CVE)`, "취약점 JSON인입", r.status === 200, `finding ${r.body.findings ?? 0} (KEV는 host/name 구조 아님 — 인입 여부 관찰)`);
}

// ── ④ 실 보안 로그 3종 → 분석허브 로그 인입(결정적 패턴 탐지) ──────────
for (const [file, label] of [["openssh_auth.log", "OpenSSH 인증로그"], ["apache_error.log", "Apache 에러로그"], ["linux_syslog.log", "Linux syslog"]]) {
  const r = await post("/api/analysis-hub/ingest-log", { source: file, content: readText(file) });
  rec(`loghub ${label}`, "분석허브 로그", r.status === 200, `매칭 ${r.body.matchedLines}/${r.body.totalLines}줄 → 이벤트 ${r.body.created}건`);
}

// ── ⑤ CycloneDX SBOM → 장기기억(문서) 인입 ───────────────────────────
{
  const r = await post("/api/upload/auto", { filename: "keycloak_sbom_cyclonedx.json", content: b64("keycloak_sbom_cyclonedx.json") });
  rec("CycloneDX SBOM(keycloak)", "업로드 자동분류", r.status === 200, `routed=${r.body.routedTo} · ${r.body.reason?.slice(0, 50) ?? ""}`);
}

// ── ⑥ 상관: 분석허브 이벤트·취약점 우선순위 집계 확인 ──────────────────
const hub = await get("/api/analysis-hub/events");
const events = hub.events ?? hub ?? [];
rec("분석허브 종합", "이벤트 집계", Array.isArray(events) && events.length > 0, `총 이벤트 ${events.length}건 (로그·취약점 통합)`);
const pri = await get("/api/approvals/priorities?limit=5").catch(() => null);
const priItems = pri?.items ?? [];
rec("취약점 우선순위", "우선순위 산정", Array.isArray(priItems) && priItems.length > 0, `상위 ${priItems.length}건 (KEV/EPSS/VPR/심각도 순)`);

// ── ⑦ 실 LLM 분석 — 인입된 이벤트 하나를 AI 분석 ─────────────────────
if (Array.isArray(events) && events.length) {
  const target = events.find((e) => e.severity === "critical" || e.severity === "high") || events[0];
  const a = await post("/api/analysis-hub/analyze", { eventId: target.id });
  const sum = a.body.aiSummary || "";
  rec("AI 이벤트 분석", "실 LLM 분석", a.status === 200 && sum.length > 20, `${sum.slice(0, 70).replace(/\n/g, " ")}…`);
}

console.log("\n===== 실데이터 인입 테스트 요약 =====");
console.table(rows);
const fail = rows.filter((r) => r.ok === "✗").length;
console.log(fail === 0 ? "전부 통과" : `${fail}건 실패/관찰 필요`);
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: H, body: JSON.stringify({ refreshToken: login.refreshToken }) });
