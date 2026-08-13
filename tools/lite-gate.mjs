// tools/lite-gate.mjs — **라이트 문항셋(lite-routing.json)을 실제로 돌린다.**
//
// ■ 왜 따로 두나
//   공용 게이트(tools/evalgate/run.mjs)는 축이 네 개로 박혀 있고(routing·safety·korean·negative)
//   라이트 문항은 그중 어디에도 안 맞는다 — **도구가 13개인 서버**에서만 뜻이 있기 때문이다.
//   공용 러너에 축을 더하면 그건 공용 파일 수정이고, 라이트 때문에 본 제품 게이트를 바꾸는 건
//   순서가 거꾸로다(화면 설명 합류점을 보류한 것과 같은 이유).
//   → 라이트는 **자기 러너**를 갖는다. 채점 규칙은 공용과 같게 맞춘다(expect/forbid/signals).
//
// ■ ⚠ 라이트 서버에 붙어야 뜻이 있다
//   `node dist/lite/index.js`로 뜬 서버여야 도구가 13개다. 본 서버(78개)에 돌리면
//   「없어야 할 도구」가 잡혀 무더기로 실패한다 — 그건 제품 결함이 아니라 **겨눈 대상이 틀린 것**이다.
//   그래서 시작할 때 도구 수를 세고, 13개가 아니면 **중단한다**(오늘 배운 「측정 전 세 줄」 ②).
//
// 사용:
//   GIJO_ADMIN_USER=<계정> GIJO_ADMIN_PASSWORD=<비번> node tools/lite-gate.mjs
//   [--limit N] [--only <문항id 일부>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const B = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const U = process.env.GIJO_ADMIN_USER;
const P = process.env.GIJO_ADMIN_PASSWORD;
if (!U || !P) { console.error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 가 필요합니다."); process.exit(2); }

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;
const only = opt("--only");

const 문항셋 = JSON.parse(fs.readFileSync(path.join(here, "evalgate", "cases", "lite-routing.json"), "utf8"));
let cases = 문항셋.cases.filter((c) => (only ? String(c.id).includes(only) : true)).slice(0, limit);

// ── 로그인 ─ 토큰은 15분이라 문항마다 새로 받는다(오늘 겪은 401 함정) ──────────
async function 토큰() {
  const j = await (await fetch(B + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: U, password: P, force: true }),
  })).json();
  if (!j.accessToken) { console.error("로그인 실패:", JSON.stringify(j).slice(0, 120)); process.exit(2); }
  return j.accessToken;
}
const H = async () => ({ authorization: "Bearer " + (await 토큰()), "content-type": "application/json" });

// ── ② 겨눈 대상이 맞는가 — 라이트 서버인가 ────────────────────────────────
const 라이트도구 = JSON.parse(fs.readFileSync(path.join(here, "..", "server", "src", "lite", "lite-tools.json"), "utf8"))
  .tools.map((t) => t.id);
const st = await (await fetch(B + "/api/localengine/status", { headers: await H() })).json();
const 적재 = (st.loaded ?? []).filter((l) => l.ready).map((l) => l.modelId);
console.log(`서버 ${B} · 적재 ${적재.join(" · ") || "없음"}`);

// 도구 수는 dispatch 한 번으로는 못 센다 — 서버가 라이트 진입점으로 떴는지는 로그로만 확실하다.
// 대신 **없어야 할 도구**를 하나 찔러 본다: today는 라이트에 없다.
{
  const r = await fetch(B + "/api/dispatch", { method: "POST", headers: await H(),
    body: JSON.stringify({ text: "오늘 뭐부터 조치해야 해?", qa: true }), signal: AbortSignal.timeout(300_000) });
  const d = await r.json();
  const 도구들 = (d.toolCalls ?? []).map((t) => t.tool);
  if (도구들.includes("today")) {
    console.error("★ `today`가 실행됐다 — **본 서버에 붙었다.** 라이트 진입점으로 띄운 뒤 다시 돌려라:");
    console.error("   cd server && node dist/lite/index.js");
    process.exit(2);
  }
  console.log("라이트 확인 ✓ — `today`가 안 잡힌다(도구 " + 라이트도구.length + "개 구성)\n");
}

// ── 채점 (공용 게이트와 같은 규칙) ──────────────────────────────────────
function 채점(c, r) {
  const why = [];
  const out = String(r.output ?? "");
  const s = c.signals ?? {};

  // ⚠ `사내지식`은 **도구가 아니라 꼬리표**다(agentloop.ts `사내지식꼬리표`) — RAG를 썼다는 표시다.
  //   첫 실측(2026-08-12)에서 이걸 「샌 도구」로 잡아 실패 13건 중 5건이 **내 러너의 오탐**이었다.
  //   toolCalls에 들어온다고 다 도구가 아니다 — registry에서 이름을 확인해야 한다.
  const 꼬리표 = new Set(["사내지식"]);
  const 도구들 = (r.toolCalls ?? []).map((t) => t.tool).filter((t) => !꼬리표.has(t));

  for (const p of c.expect ?? []) if (!new RegExp(p, "i").test(out)) why.push(`누락: /${p}/`);
  for (const p of c.forbid ?? []) if (new RegExp(p, "i").test(out)) why.push(`금지 포함: /${p}/`);
  if (s.tool && !도구들.includes(s.tool)) why.push(`도구 미실행: ${s.tool} (실행: ${도구들.join(",") || "없음"})`);
  if (s.noTool && 도구들.length) why.push(`도구 실행됨: ${도구들.join(",")} (기대: 없음)`);
  // 라이트 고유 — 목록에 없는 도구가 잡히면 **허용목록이 안 걸린 것**이다.
  const 샌것 = 도구들.filter((t) => !라이트도구.includes(t));
  if (샌것.length) why.push(`★ 라이트에 없는 도구가 실행됨: ${샌것.join(",")}`);
  return why;
}

// ── 실행 ────────────────────────────────────────────────────────────
const 결과 = [];
let i = 0;
for (const c of cases) {
  i++;
  const t0 = Date.now();
  let r = {};
  try {
    const res = await fetch(B + "/api/dispatch", { method: "POST", headers: await H(),
      body: JSON.stringify({ text: c.q, qa: true }), signal: AbortSignal.timeout(300_000) });
    r = await res.json();
  } catch (e) { r = { output: "", _err: String(e?.message ?? e) }; }
  const 초 = ((Date.now() - t0) / 1000).toFixed(1);
  const why = r._err ? [`호출 실패: ${r._err}`] : 채점(c, r);
  결과.push({ id: c.id, ok: !why.length, why, 초 });
  console.log(`${why.length ? "✗" : "✓"} ${String(c.id).padEnd(24)} ${초.padStart(6)}초  ${c.q.slice(0, 34)}`);
  if (why.length) for (const w of why) console.log(`     ${w}`);
}

// ⚠ **점수 옆에 모델 이름을 반드시 붙인다.** 2026-08-13에 「32/33」을 qwen3-14b로 재 놓고
//   출하 모델(gijo-main-orchestrator 7.6B) 점수처럼 말할 뻔했다 — 다시 재니 29/33이었다.
//   같은 문항셋도 모델이 다르면 다른 물건을 잰 것이다(오늘의 「겨눈 대상」 교훈의 세 번째 판).
const 잰모델 = 적재.join(" · ") || "(적재 없음 — 이 값은 의심하라)";
const 통과 = 결과.filter((x) => x.ok).length;
console.log(`\n━━ 라이트 문항 ${통과}/${결과.length} 통과 · 모델 ${잰모델} ━━`);
if (통과 < 결과.length) {
  console.log("\n실패한 것:");
  for (const x of 결과.filter((y) => !y.ok)) console.log(`  ${x.id} — ${x.why.join(" · ")}`);
}
// ③ 잰 건수가 기대와 같은가 — 0건·미달이면 통과가 아니라 중단이다.
if (!결과.length) { console.error("★ 잰 문항이 0건이다 — 통과가 아니라 중단이다."); process.exit(2); }
process.exit(통과 === 결과.length ? 0 : 1);
