// tools/orchestrator-bench.mjs — 메인 오케스트레이터 LLM 후보 실측 벤치
// 목적: "한글 지시 → 도구 선택 JSON" 정확도·속도를 실제 llama-server에서 측정해 메인 모델을 정한다.
// 사용: node tools/orchestrator-bench.mjs --only <candidateId>   (server/ 에서 실행)
//       --url http://localhost:8080/v1 을 주면 스폰 없이 그 서버를 측정한다.
// 출력: 표준출력 표 + tools/bench-results/<candidateId>.json
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const LLAMA_SERVER = path.join("llama.cpp", "build", "bin", "Release", "llama-server.exe");
const BENCH_PORT = 8090;
const RESULTS_DIR = path.join("tools", "bench-results");

// ── 후보 ────────────────────────────────────────────────────────────────
const CANDIDATES = {
  "merged-lily-gijo": { url: "http://localhost:8080/v1", label: "merged-lily-gijo (Llama 7.2B 합성, 현행)" },
  "gijo-main-orchestrator": { model: "gijo-main-orchestrator", label: "gijo-main-orchestrator (Qwen2.5 7.6B 머지, 제품 기본)" },
  "gijo-orchestrator-ko": { model: "gijo-orchestrator-ko", label: "gijo-orchestrator-ko (Qwen2.5 7.6B 머지 ko)" },
  "hermes-3": { model: "NousResearch__Hermes-3-Llama-3.1-8B-GGUF", label: "Hermes-3 Llama-3.1 8B (function calling 특화)" },
  "qwen25-coder-14b": { model: "Qwen__Qwen2.5-Coder-14B-Instruct-GGUF", label: "Qwen2.5 Coder 14B (구조화 출력 강점)" },
};

// ── 도구 정의(Phase 1 자산 메뉴 계획과 동일한 형태) ──────────────────────
const TOOLS_DESC = [
  "- list_assets(): 등록된 AI 자산 전체 목록을 조회한다 (개수·이름·유형 포함)",
  '- get_asset(assetId): 자산 1개의 상세와 발견된 취약점(finding)을 조회한다. 예: {"assetId":"ai-secbot-01"}',
  '- list_vuln_priorities(limit): 오늘 조치해야 할 취약점 우선순위 상위 N개(KEV·EPSS·VPR 순). 예: {"limit":"5"}',
  '- register_asset(name, path): 새 AI 자산을 등록한다. 예: {"name":"챗봇","path":"models/chat.gguf"}',
  "- generate_report(): 현재 자산·취약점 현황으로 내부 보고서를 생성한다",
].join("\n");

const SYSTEM_PROMPT = [
  "너는 GIJO AS 보안 플랫폼의 오케스트레이터다. 사용자 지시를 읽고 아래 도구 중 하나를 골라 호출하거나, 도구가 필요 없으면 직접 답한다.",
  "",
  "사용 가능한 도구:",
  TOOLS_DESC,
  "",
  "규칙:",
  '- 반드시 JSON 객체 하나만 출력한다: {"action":"tool","tool":"도구이름","args":{...}} 또는 {"action":"final","answer":"직접 답변"}',
  "- 지시와 맞는 도구가 없으면 action=final로 답한다. 도구 이름을 지어내지 않는다.",
  "- args 값은 모두 문자열로 쓴다.",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["tool", "final"] },
    tool: { type: "string" },
    args: { type: "object", additionalProperties: { type: "string" } },
    answer: { type: "string" },
  },
  required: ["action"],
};

// ── 테스트 케이스 (기대: tool 이름 + 필수 args 부분일치 / final) ─────────
const CASES = [
  { id: "A", text: "등록된 자산 몇 개야?", expect: { tool: "list_assets" } },
  { id: "B", text: "ai-secbot-01 상세 보여줘", expect: { tool: "get_asset", args: { assetId: "ai-secbot-01" } } },
  { id: "C", text: "오늘 뭐부터 조치해야 해? 상위 5개만", expect: { tool: "list_vuln_priorities", args: { limit: "5" } } },
  { id: "D", text: "새 자산 등록해줘. 이름은 사내챗봇이고 경로는 models/chatbot.gguf 야", expect: { tool: "register_asset", args: { name: "사내챗봇", path: "models/chatbot.gguf" } } },
  { id: "E", text: "고마워, 수고했어!", expect: { final: true } },
  { id: "F", text: "fraud-detect-llm 에 취약점 뭐 나왔는지 알려줘", expect: { tool: "get_asset", args: { assetId: "fraud-detect-llm" } } },
  { id: "G", text: "경영진 볼 보고서 하나 뽑아줘", expect: { tool: "generate_report" } },
  { id: "H", text: "우리가 관리하는 AI 자산 전체 목록 보여줘", expect: { tool: "list_assets" } },
  { id: "I", text: "취약점 우선순위 top 3 알려줘", expect: { tool: "list_vuln_priorities", args: { limit: "3" } } },
  { id: "J", text: "다크웹에서 우리 회사 계정 유출됐는지 확인해줘", expect: { final: true } }, // 해당 도구 없음 — 절제 판단
];

// ── 실행 ────────────────────────────────────────────────────────────────
async function waitReady(base, timeoutMs = 240_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await fetch(base.replace(/\/v1$/, "") + "/health").then((r) => r.ok).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function askOnce(base, text) {
  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local",
      temperature: 0,
      max_tokens: 300,
      json_schema: RESPONSE_SCHEMA,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { error: `HTTP ${res.status}`, ms };
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "";
  try {
    return { parsed: JSON.parse(raw), raw, ms };
  } catch {
    return { error: "JSON 파싱 실패", raw, ms };
  }
}

function scoreCase(c, r) {
  if (r.error) return { jsonOk: false, toolOk: false, argsOk: false };
  const p = r.parsed;
  const jsonOk = true;
  if (c.expect.final) {
    const toolOk = p.action === "final";
    return { jsonOk, toolOk, argsOk: toolOk };
  }
  const toolOk = p.action === "tool" && p.tool === c.expect.tool;
  let argsOk = toolOk;
  if (toolOk && c.expect.args) {
    for (const [k, v] of Object.entries(c.expect.args)) {
      const got = p.args?.[k];
      if (String(got ?? "").trim() !== v) argsOk = false;
    }
  }
  return { jsonOk, toolOk, argsOk };
}

async function benchCandidate(id) {
  const cand = CANDIDATES[id];
  if (!cand) throw new Error(`후보 없음: ${id} (가능: ${Object.keys(CANDIDATES).join(", ")})`);
  let proc = null;
  let base = cand.url;
  if (!base) {
    const modelPath = path.join("models", cand.model, `${cand.model}.gguf`);
    if (!fs.existsSync(modelPath)) throw new Error(`모델 파일 없음: ${modelPath}`);
    console.log(`[스폰] ${modelPath} → :${BENCH_PORT}`);
    proc = spawn(LLAMA_SERVER, ["-m", modelPath, "-ngl", "-1", "--ctx-size", "4096", "--port", String(BENCH_PORT)], { stdio: "ignore" });
    base = `http://localhost:${BENCH_PORT}/v1`;
  }
  try {
    if (!(await waitReady(base))) throw new Error("모델 로드 시간 초과");
    const rows = [];
    for (const c of CASES) {
      const r = await askOnce(base, c.text);
      const s = scoreCase(c, r);
      rows.push({ case: c.id, text: c.text, ...s, ms: r.ms, got: r.parsed ?? r.error, raw: r.raw?.slice(0, 200) });
      const mark = s.argsOk ? "✅" : s.toolOk ? "🟡" : "❌";
      console.log(`  ${c.id} ${mark} ${r.ms}ms  →`, JSON.stringify(r.parsed ?? r.error).slice(0, 140));
    }
    const n = rows.length;
    const summary = {
      candidate: id,
      label: cand.label,
      jsonOk: rows.filter((r) => r.jsonOk).length + "/" + n,
      toolOk: rows.filter((r) => r.toolOk).length + "/" + n,
      argsOk: rows.filter((r) => r.argsOk).length + "/" + n,
      avgMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / n),
    };
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, `${id}.json`), JSON.stringify({ summary, rows }, null, 2));
    console.log("\n[요약]", JSON.stringify(summary));
    return summary;
  } finally {
    if (proc) {
      proc.kill();
      // llama-server가 VRAM을 되돌려줄 시간을 준다(다음 후보 스폰 전 충돌 방지).
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
if (!only) {
  console.error("사용법: node tools/orchestrator-bench.mjs --only <id>");
  console.error("후보:", Object.keys(CANDIDATES).join(", "));
  process.exit(1);
}
benchCandidate(only).catch((e) => {
  console.error("[실패]", e.message);
  process.exit(1);
});
