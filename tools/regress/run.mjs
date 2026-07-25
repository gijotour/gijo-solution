// tools/regress/run.mjs — 디스패치 답변 회귀 하네스.
// 실 서버(/api/dispatch)에 고정 질문셋(cases.json)을 던져, 검증된 사실 패턴(expect/forbid)과
// 신호 필드(dataHits·internalMiss)를 결정적으로 대조한다. 모델·프롬프트·RAG를 바꾼 뒤 반드시 돌려
// "테스트 통과인데 실사용자에게 오답이 나가는" 회귀(2026-07-21 실사고)를 막는다.
//
// 사용: GIJO_ADMIN_USER=<계정> GIJO_ADMIN_PASSWORD=<비번> [GIJO_SERVER_URL=http://localhost:4000] \
//        node tools/regress/run.mjs
// 종료코드: 0=전부 통과, 1=실패 있음(케이스별 사유 출력). LLM 비결정성이 있으므로 낙제 케이스는
// 표현이 아니라 "사실"이 틀렸는지 출력을 읽고 판단할 것(폴백 문구는 FAIL).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.GIJO_SERVER_URL || "http://localhost:4000").replace(/\/+$/, "");
const user = process.env.GIJO_ADMIN_USER;
const password = process.env.GIJO_ADMIN_PASSWORD;
if (!user || !password) {
  console.error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 환경변수가 필요합니다.");
  process.exit(1);
}

const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases.json");
const { cases } = JSON.parse(await fs.readFile(casesPath, "utf8"));

const login = await (await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: user, password, force: true }),
})).json();
if (!login.accessToken) {
  console.error("로그인 실패:", JSON.stringify(login));
  process.exit(1);
}

// 폴백·오류 문구가 나오면 내용 검사 전에 FAIL 처리한다(폴백 문구는 FAIL 원칙).
const FALLBACK_RE = /모델이 아직 준비|실행 실패|지연되고 있습니다|요청이 차단/;

async function dispatch(text) {
  const t0 = Date.now();
  const r = await fetch(base + "/api/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + login.accessToken },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json();
  return { ms: Date.now() - t0, output: j.output || "", dataHits: j.dataHits, internalMiss: j.internalMiss };
}

// 한 케이스를 1회 실행해 {ok, why, out, ms}를 돌려준다.
async function runCase(c) {
  const why = [];
  const r = await dispatch(c.q);
  if (FALLBACK_RE.test(r.output)) why.push("폴백/오류 문구");
  for (const p of c.expect ?? []) if (!new RegExp(p, "i").test(r.output)) why.push(`누락: /${p}/`);
  for (const p of c.forbid ?? []) if (new RegExp(p, "i").test(r.output)) why.push(`금지 포함: /${p}/`);
  for (const [k, v] of Object.entries(c.signals ?? {})) if (r[k] !== v) why.push(`신호 ${k}=${r[k]} (기대 ${v})`);
  return { ok: why.length === 0, why, out: r.output, ms: r.ms };
}

let fail = 0, flaky = 0;
const t0 = Date.now();
for (const c of cases) {
  try {
    let r = await runCase(c);
    if (!r.ok) {
      // LLM 샘플링 비결정성으로 1회성 이탈이 있다(실측 2026-07-25: kisa-u01 1/4회 이탈).
      // 1회 재시도해 통과하면 FLAKY로 표기 — 통과로 치되 눈에 띄게 남겨 반복되면 조사한다.
      const retry = await runCase(c);
      if (retry.ok) {
        flaky++;
        console.log(`~ ${c.id} [${(retry.ms / 1000).toFixed(1)}s] — FLAKY(1차 실패→재시도 통과: ${r.why.join(", ")})`);
        continue;
      }
      r = retry;
    }
    console.log(`${r.ok ? "✓" : "✗"} ${c.id} [${(r.ms / 1000).toFixed(1)}s]${r.why.length ? " — " + r.why.join(", ") : ""}`);
    if (!r.ok) {
      console.log(`    출력: ${r.out.replace(/\s+/g, " ").slice(0, 200)}`);
      fail++;
    }
  } catch (e) {
    fail++;
    console.log(`✗ ${c.id} — 요청 실패: ${e.name || e.message}`);
  }
}
console.log(`\n결과: ${cases.length - fail}/${cases.length} 통과${flaky ? ` (FLAKY ${flaky})` : ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
process.exit(fail ? 1 : 0);
