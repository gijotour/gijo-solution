// tools/evalgate/adopt.mjs — 모델 채택 절차(계획서 중-4 "게이트 통과분만 배포").
//
// 하는 일: 후보 모델을 배정 → 평가 게이트 3축 실행 → **통과하면 채택, 보류면 원래대로 되돌린다.**
// 어느 쪽이든 모델 채택 원장에 근거(축별 점수·견고성·문항셋 지문·커밋)를 남긴다.
//
// 왜 스크립트인가: 사람이 손으로 하면 순서를 빼먹는다 — 특히 "보류인데 되돌리지 않기".
// 게이트를 만들어 두고 돌리지 않는 것이 가장 흔한 실패 방식이라, 절차 자체를 한 줄로 만든다.
//
// 사용:
//   GIJO_ADMIN_USER=<admin계정> GIJO_ADMIN_PASSWORD=<비번> \
//     node tools/evalgate/adopt.mjs <에이전트id> <모델id> [--note "합성 모델 v2 후보"]
//   예: node tools/evalgate/adopt.mjs orchestrator merged-lily-gijo-loop-ai-securityllm
//   되돌리려면 모델 자리에 global 을 준다(전역 기본으로 복귀).
//
// ⚠ 이 절차는 **운영 서버의 모델을 실제로 바꿔 가며** 15분쯤 돌린다. 그동안 담당자의 답변 품질이
//   후보 모델의 것이 된다 — 사용자가 없는 시간에 돌리고, 실행 중에는 그 계정을 쓰지 말 것.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const base = (process.env.GIJO_SERVER_URL || "http://localhost:4000").replace(/\/+$/, "");
const user = process.env.GIJO_ADMIN_USER;
const password = process.env.GIJO_ADMIN_PASSWORD;
const [agentId, modelArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const noteIdx = process.argv.indexOf("--note");
const note = noteIdx >= 0 ? process.argv[noteIdx + 1] : undefined;

if (!user || !password || !agentId || !modelArg) {
  console.error("사용: GIJO_ADMIN_USER=... GIJO_ADMIN_PASSWORD=... node tools/evalgate/adopt.mjs <에이전트id> <모델id|global> [--note 설명]");
  process.exit(2);
}
const candidate = modelArg === "global" ? null : modelArg;

async function login() {
  const j = await (await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password, force: true }),
  })).json();
  if (!j.accessToken) { console.error("로그인 실패:", JSON.stringify(j)); process.exit(2); }
  return { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken };
}

async function api(H, method, pathname, body) {
  const r = await fetch(base + pathname, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathname} → ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const H = await login();

// ── 1) 지금 배정 확인 ────────────────────────────────────────────────
const agents = await api(H, "GET", "/api/agents");
const agent = agents.find((a) => a.id === agentId);
if (!agent) { console.error(`존재하지 않는 에이전트: ${agentId}`); process.exit(2); }
const before = agent.modelId ?? null;
console.log(`대상: ${agentId} — 현재 ${before ?? "(전역 기본)"} → 후보 ${candidate ?? "(전역 기본)"}`);
if (before === candidate) { console.error("이미 그 모델입니다 — 바꿀 것이 없습니다."); process.exit(2); }

// ── 2) 후보 배정 ────────────────────────────────────────────────────
await api(H, "POST", `/api/agents/${encodeURIComponent(agentId)}/model`, { modelId: candidate });
console.log("후보 모델 배정 완료 — 평가 게이트를 실행합니다(10~20분).");

// ── 3) 게이트 실행 ──────────────────────────────────────────────────
// 별도 프로세스로 돌린다 — 게이트는 자기 로그인·자기 판정을 갖는다(여기서 흉내 내지 않는다).
const gate = spawnSync(process.execPath, [path.join(here, "run.mjs")], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: "inherit",
});
// 종료코드 0만으로는 부족하다 — 게이트는 "기준선 없음"(첫 실행)에도 0을 낸다.
// 그걸 채택으로 기록하면 **기준선과 대조한 적 없는 채택**이 원장에 "✅ 게이트 통과"로 남는다
// (검토 지적 2026-07-29). 리포트의 판정이 '통과'일 때만 채택으로 본다.
const gateVerdict = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, ".tmp-reports", "evalgate-report.json"), "utf8")).verdict;
  } catch { return null; }
})();
const passed = gate.status === 0 && gateVerdict === "통과";
if (gate.status === 0 && gateVerdict !== "통과") {
  console.log(`\n판정이 "${gateVerdict ?? "확인 불가"}"입니다 — 기준선과 대조된 통과가 아니라 채택하지 않습니다.`);
  console.log("   기준선이 없거나 문항셋이 바뀐 상태라면, 먼저 `node tools/evalgate/run.mjs --accept-baseline`으로 기준선을 확정하세요.");
}

// 게이트가 남긴 리포트를 근거로 싣는다(직접 계산하지 않는다 — 판정의 단일 출처는 게이트다).
let gateReport = null;
try {
  gateReport = JSON.parse(fs.readFileSync(path.join(repoRoot, ".tmp-reports", "evalgate-report.json"), "utf8"));
} catch { /* 리포트를 못 읽어도 판정(종료코드)은 유효하다 */ }
const evidence = gateReport
  ? { verdict: gateReport.verdict, axes: gateReport.axes, robustness: gateReport.robustness, effective: gateReport.effective, meta: gateReport.meta }
  : { verdict: passed ? "통과(리포트 없음)" : "채택 보류(리포트 없음)" };

// ── 4) 판정에 따라 채택 또는 되돌림 ─────────────────────────────────
const H2 = await login(); // 게이트가 15분+ 걸려 토큰이 만료됐을 수 있다
if (passed) {
  await api(H2, "POST", "/api/model-adoptions", {
    agentId, fromModel: before, toModel: candidate, verdict: "pass", gate: evidence,
    note: note ?? "평가 게이트 통과 후 채택",
  });
  console.log(`\n✅ 채택 — ${agentId}에 ${candidate ?? "(전역 기본)"}을 그대로 둡니다. 근거는 모델 채택 원장에 남았습니다.`);
  process.exit(0);
}

await api(H2, "POST", `/api/agents/${encodeURIComponent(agentId)}/model`, { modelId: before });

// ⚠ [2026-07-30 실사고] 배정만 되돌리면 부족하다. 엔진의 "마지막 사용 모델"(app_state.lastModelId)이
//   여전히 후보를 가리켜, **서버가 재시작되면 탈락한 모델로 조용히 되돌아간다** — 실제로 재시작 후
//   운영이 느린 합성 모델로 떠 있었다. 후보가 물고 있던 VRAM도 그대로였다.
//   그래서 엔진을 통째로 내리고 원래 모델만 다시 올린다(마지막 사용 모델 기록도 이때 바로잡힌다).
try {
  console.log("엔진 정리 — 후보 모델을 내리고 원래 모델을 다시 올립니다");
  await api(H2, "POST", "/api/localengine/stop", {});
  const restoreId = before ?? (await api(H2, "GET", "/api/localengine/models")).find((m) => m.id)?.id;
  if (restoreId) await api(H2, "POST", "/api/localengine/start", { modelId: restoreId });
  // 되돌린 뒤 **실제로 답이 나오는지** 확인한다 — "원복했다"는 말만 남기고 챗봇이 죽어 있으면
  // 그게 더 나쁘다(조용한 고장).
  const probe = await api(H2, "POST", "/api/dispatch", { text: "SQL 인젝션이 뭐야?", qa: true });
  const alive = !/모델이 아직 준비되지 않았습니다/.test(String(probe.output ?? ""));
  console.log(alive ? "   확인: 챗봇이 정상 응답합니다" : "   ⚠ 경고: 되돌렸는데 챗봇이 응답하지 않습니다 — 엔진 상태를 확인하세요");
} catch (e) {
  console.error(`   ⚠ 엔진 정리 실패: ${e.message} — 수동으로 설정 > 서버·AI에서 모델을 다시 올리세요`);
}
await api(H2, "POST", "/api/model-adoptions", {
  agentId, fromModel: before, toModel: candidate, verdict: "hold", gate: evidence,
  note: note ?? "평가 게이트 보류 — 원래 모델로 되돌림",
});
console.log(`\n⛔ 채택 보류 — ${agentId}를 ${before ?? "(전역 기본)"}으로 되돌렸습니다.`);
console.log("   .tmp-reports/evalgate-report.md 의 실패 문항을 읽고 원인을 가리세요(후보 모델 문제인지, 문항이 낡은 것인지).");
process.exit(1);
