// tools/hardening-remote-e2e.mjs — 원격 SSH 정기점검 파이프라인 실 e2e.
// 대상 등록 → 접속확인 → 수동 점검 → 스케줄 등록 → 실제 스케줄러가 자동 실행 → 이력 확인 → 정리.
// SSH 전송부는 유닛 검증(sshCommandFor)했고, 여기선 local 대상으로 전 파이프라인을 실 명령으로 e2e.
const BASE = "http://127.0.0.1:4000";
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const j = (r) => r.json();

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "jyh", password: "gijohn00", force: true }) });
  return (await j(r)).accessToken;
}
const H = (tok, body) => ({ method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, ...(body ? { body: JSON.stringify(body) } : {}) });

const tok = await login();
console.log("① 로그인 OK");

// 대상 등록(local = 서버 자신, 원격이면 host/ssh키만 바꾸면 됨)
const t = (await j(await fetch(`${BASE}/api/hardening/targets`, H(tok, { label: "운영 리눅스 어플라이언스 (self/local)", host: "local", authMethod: "local" })))).target;
console.log(`② 대상 등록 OK — ${t.id} (${t.label}) hasSecret=${t.hasSecret}`);

// 접속 확인
const probe = await j(await fetch(`${BASE}/api/hardening/targets/${t.id}/probe`, H(tok, {})));
console.log(`③ 접속 확인 — ok=${probe.ok} (${probe.detail})`);

// 수동 점검(실 명령)
const scan = await j(await fetch(`${BASE}/api/hardening/targets/${t.id}/scan`, H(tok, { standard: "kisa" })));
console.log(`④ 수동 점검(KISA) — 준수율 ${scan.report.summary.rate}% · 취약 ${scan.report.summary.fail} · ${scan.report.items.length}항목`);

// 스케줄 등록(nextRunAt=now → 다음 틱에 자동 실행). 짧게 보려고 interval 1h.
const sch = (await j(await fetch(`${BASE}/api/hardening/schedules`, H(tok, { targetId: t.id, standard: "cis", intervalHours: 1 })))).schedule;
console.log(`⑤ 정기점검 스케줄 등록 — ${sch.id} (CIS · 1시간마다) nextRunAt=${new Date(sch.nextRunAt).toLocaleTimeString("ko-KR")}`);

// 실제 스케줄러(60초 틱)가 자동 실행할 때까지 대기 — source=scheduled 이력이 뜨는지 폴링
console.log("⑥ 스케줄러 자동 실행 대기(최대 90초)…");
let scheduledRun = null;
for (let i = 0; i < 18; i++) {
  await sleep(5000);
  const runs = (await j(await fetch(`${BASE}/api/hardening/runs?targetId=${t.id}`, H(tok)))).runs;
  scheduledRun = runs.find((r) => r.source === "scheduled");
  if (scheduledRun) break;
  process.stdout.write(".");
}
console.log("");
if (scheduledRun) console.log(`   ✅ 스케줄러 자동 점검 확인 — ${scheduledRun.standard.toUpperCase()} 준수율 ${scheduledRun.rate}% · 취약 ${scheduledRun.fail} (source=scheduled)`);
else console.log("   ⚠ 90초 내 자동 실행 미확인(틱 주기 확인 필요)");

// 전체 이력
const allRuns = (await j(await fetch(`${BASE}/api/hardening/runs?targetId=${t.id}`, H(tok)))).runs;
console.log(`⑦ 점검 이력 ${allRuns.length}건: ${allRuns.map((r) => `${r.standard}/${r.source}/${r.rate}%`).join(", ")}`);

// 정리(테스트 대상·스케줄 삭제 — 운영에 테스트 스케줄이 남지 않게)
await fetch(`${BASE}/api/hardening/schedules/${sch.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
await fetch(`${BASE}/api/hardening/targets/${t.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
console.log("⑧ 정리 완료 — 테스트 대상·스케줄 삭제(이력은 감사용 보존)");
