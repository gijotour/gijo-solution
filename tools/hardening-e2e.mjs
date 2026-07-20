// tools/hardening-e2e.mjs — 운영 4000 서버 실 HTTP e2e: 하드닝 점검 엔드포인트를 실제 호출한다.
// 서버(WSL 리눅스)가 곧 점검 대상 — 자기 자신을 실 명령으로 스캔한 실측 리포트를 받는다.
// curl은 한글을 깨뜨리므로 Node fetch로 검증(프로젝트 규칙).
const BASE = process.env.GIJO_SERVER_URL || "http://127.0.0.1:4000";
const USER = process.env.GIJO_USER || "jyh";
const PWS = (process.env.GIJO_PW || "gijohn00,changeme,gijohn00!").split(",");

async function login() {
  for (const password of PWS) {
    // 중복로그인 방지가 있어 force로 세션을 확보(테스트용).
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USER, password, force: true }),
    });
    if (r.ok) { const j = await r.json(); return j.accessToken; }
  }
  throw new Error("로그인 실패 — 계정/비밀번호 확인 필요");
}

async function scan(token, standard) {
  const r = await fetch(`${BASE}/api/hardening/scan`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ standard, target: `운영 리눅스 장비 (WSL Ubuntu) — ${standard.toUpperCase()} 점검` }),
  });
  if (!r.ok) throw new Error(`scan ${standard} 실패: ${r.status} ${await r.text()}`);
  return r.json();
}

const token = await login();
console.log("로그인 성공 — 토큰 확보\n");
for (const std of ["kisa", "cis"]) {
  const { report, markdown } = await scan(token, std);
  console.log("#".repeat(74));
  console.log(markdown);
  console.log(`\n(구조 확인: ${report.items.length}항목 · 준수율 ${report.summary.rate}% · 취약 ${report.summary.fail} · ${report.durationMs}ms)\n`);
}
