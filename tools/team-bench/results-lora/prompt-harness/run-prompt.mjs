// ★ 사본(2026-09-03 프롬프트 실험) — 원본 run.mjs은 손대지 않았다. 바뀐 곳: --models 옵션 · withSystem(모델 항목 system을 과제 system 앞에 합침) · m.warmup이면 워밍업 1회 버림.
// tools/team-bench/run.mjs — 후보 모델을 하나씩 옆 포트에 띄워 팀원 역할별 시험을 돌리고 표를 만든다.
//
// 어디서: gb10(검증 기계, 계획서 전-7). 운영 두뇌(8080)는 건드리지 않는다 — 시험은 8090에 띄웠다 내린다.
// 사용:  node run.mjs [--only id1,id2] [--port 8090] [--ctx 32768] [--out results]
//        models.json이 후보 목록의 단일 출처다(경로·thinking·추가 인자).
// 산출:  results/<model>.json(문항별 답·점수·속도) · results/summary.md(표) — 숫자는 전부 실측.
// 원칙:  채점은 tasks.mjs의 결정적 채점기만. 폴백·빈 답은 0점(폴백 문구는 FAIL 원칙).
//        서버가 못 뜨면 그 모델은 「적재 실패」로 표에 남긴다(조용히 빼지 않는다).

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TASKS, 한글비율, 한자수 } from "./tasks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ONLY = (opt("--only", "") || "").split(",").filter(Boolean);
const PORT = Number(opt("--port", 8090));
const CTX = Number(opt("--ctx", 32768));
const OUT = path.resolve(here, opt("--out", "results"));
const BIN = process.env.LLAMA_SERVER || path.join(process.env.HOME || "", "gijo-as/server/llama.cpp-next/build/bin/llama-server");
const READY_MS = Number(process.env.READY_MS || 900_000); // 큰 모델은 디스크에서 올라오는 데 몇 분 걸린다
const REQ_MS = Number(process.env.REQ_MS || 600_000);

fs.mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(here, opt("--models", "models.json")), "utf8"));
const models = manifest.filter((m) => !ONLY.length || ONLY.includes(m.id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (...a) => console.log(`[${now()}]`, ...a);

async function health() {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) }); return r.status === 200; } catch { return false; }
}

async function servedModel() {
  try { const j = await (await fetch(`http://127.0.0.1:${PORT}/v1/models`, { signal: AbortSignal.timeout(3000) })).json(); return String(j.data?.[0]?.id ?? ""); } catch { return ""; }
}

async function startServer(m) {
  const file = m.path.replace(/^~\//, (process.env.HOME || "") + "/");
  if (!fs.existsSync(file)) return { ok: false, why: `파일 없음 ${file}` };
  // ★ 포트가 이미 잡혀 있으면 **남의 모델을 재게 된다**(2026-09-03 실측: 「적재 0s」로 드러남). 절대 진행하지 않는다.
  if (await health()) return { ok: false, why: `포트 ${PORT} 이미 사용 중(서빙 중: ${await servedModel() || "?"}) — 다른 --port를 쓰거나 그 서버를 내려라` };
  const a = ["-m", file, "-ngl", "-1", "--ctx-size", String(m.ctx || CTX), "--parallel", "1", "--port", String(PORT), "--jinja", ...(m.thinking ? ["--reasoning", "off", "--reasoning-budget", "0"] : []), ...(m.extra || [])];
  const logPath = path.join(OUT, `${m.id}.server.log`);
  const outFd = fs.openSync(logPath, "w");
  const child = spawn(BIN, a, { stdio: ["ignore", outFd, outFd] });
  const t0 = Date.now();
  while (Date.now() - t0 < READY_MS) {
    if (child.exitCode !== null) return { ok: false, why: `서버 종료 code=${child.exitCode} (로그 ${logPath})`, child };
    if (await health()) {
      // 뜬 서버가 **이 모델**인지 확인한다 — 파일 이름이 /v1/models의 id에 들어 있어야 한다.
      const served = await servedModel();
      const base = path.basename(file);
      if (!served.includes(base)) return { ok: false, why: `서빙 모델 불일치: 기대 ${base} · 실제 ${served || "?"}`, child };
      return { ok: true, child, loadMs: Date.now() - t0 };
    }
    await sleep(2000);
  }
  return { ok: false, why: "준비 시간 초과", child };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const t0 = Date.now();
  while (child.exitCode === null && Date.now() - t0 < 20000) await sleep(500);
  if (child.exitCode === null) child.kill("SIGKILL");
}

// ★ 모델 항목의 system을 messages 맨 앞에 넣는다. 과제에 이미 system이 있으면(13과제 전부) 그 앞에 합쳐 **하나의 system**으로 — 둘을 두면 템플릿에 따라 둘째가 버려질 수 있다.
function withSystem(messages, m) {
  if (!m.system) return messages;
  const [first, ...rest] = messages;
  if (first?.role === "system") return [{ role: "system", content: [m.system, first.content].join(String.fromCharCode(10, 10)) }, ...rest];
  return [{ role: "system", content: m.system }, ...messages];
}

async function ask(task, m) {
  const body = { model: "local", messages: withSystem(task.messages, m), temperature: 0, max_tokens: task.id === "needle_16k" ? 300 : 900, cache_prompt: false };
  if (task.schema && !m.noSchema) body.response_format = { type: "json_schema", json_schema: { name: task.id, schema: task.schema } };
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(REQ_MS) });
  const j = await r.json();
  const ms = Date.now() - t0;
  const msg = j.choices?.[0]?.message || {};
  const content = String(msg.content ?? "");
  const t = j.timings || {};
  return { status: r.status, ms, content, reasoning: String(msg.reasoning_content ?? "").length, promptTokens: t.prompt_n ?? j.usage?.prompt_tokens, genTokens: t.predicted_n ?? j.usage?.completion_tokens, prefillTps: t.prompt_per_second, genTps: t.predicted_per_second, finish: j.choices?.[0]?.finish_reason, error: j.error };
}

async function runModel(m) {
  log(`▶ ${m.id} (${m.path})`);
  const res = { id: m.id, path: m.path, license: m.license, startedAt: now(), tasks: {}, load: null, error: null };
  const s = await startServer(m);
  if (!s.ok) { res.error = s.why; log(`  ✗ 적재 실패: ${s.why}`); await stopServer(s.child); return res; }
  res.load = { ms: s.loadMs };
  log(`  적재 ${(s.loadMs / 1000).toFixed(0)}s`);
  if (m.warmup) { try { await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "local", messages: [{ role: "user", content: "안녕하세요" }], max_tokens: 32, cache_prompt: false }), signal: AbortSignal.timeout(120000) }); log("  워밍업 1회 버림"); } catch (e) { log("  워밍업 실패(무시): " + e.message); } }
  try {
    for (const task of TASKS) {
      if (m.skip?.includes(task.id)) { res.tasks[task.id] = { skipped: true }; continue; }
      let a;
      try { a = await ask(task, m); } catch (e) { a = { status: 0, error: String(e.message || e), content: "", ms: REQ_MS }; }
      let scored = { score: 0, detail: a.error ? `요청 실패 ${JSON.stringify(a.error).slice(0, 80)}` : "빈 답" };
      if (a.content) scored = task.score(a.content);
      const 답 = a.content;
      res.tasks[task.id] = { role: task.role, score: Number(scored.score.toFixed(3)), detail: scored.detail, ms: a.ms, promptTokens: a.promptTokens, genTokens: a.genTokens, prefillTps: a.prefillTps, genTps: a.genTps, finish: a.finish, 한글: Number(한글비율(답).toFixed(2)), 한자: 한자수(답), thinkLeak: /<think>/.test(답) || (a.reasoning > 0 && !답), answer: 답.slice(0, 1500) };
      log(`  ${task.id.padEnd(14)} ${scored.score.toFixed(2)}  ${scored.detail}  (${(a.ms / 1000).toFixed(1)}s · 프리필 ${a.prefillTps?.toFixed?.(0) ?? "-"} tok/s · 생성 ${a.genTps?.toFixed?.(1) ?? "-"} tok/s)`);
    }
  } finally {
    await stopServer(s.child);
  }
  res.finishedAt = now();
  return res;
}

function summarize(all) {
  const ids = TASKS.map((t) => t.id);
  const head = `| 모델 | 라이선스 | 적재 | ${ids.join(" | ")} | 평균 | 프리필 tok/s | 생성 tok/s | 한글 | 한자 |`;
  const sep = `|---|---|---|${ids.map(() => "---").join("|")}|---|---|---|---|---|`;
  const rows = all.map((r) => {
    if (r.error) return `| ${r.id} | ${r.license || "-"} | ✗ ${r.error.slice(0, 40)} | ${ids.map(() => "-").join(" | ")} | - | - | - | - | - |`;
    const t = r.tasks; const sc = ids.map((i) => t[i]?.skipped ? "건너뜀" : (t[i]?.score ?? 0).toFixed(2));
    const nums = ids.map((i) => t[i]?.score).filter((x) => typeof x === "number");
    const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : "-";
    const pf = ids.map((i) => t[i]?.prefillTps).filter(Boolean); const gt = ids.map((i) => t[i]?.genTps).filter(Boolean);
    const med = (xs) => xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(0) : "-";
    const ko = ids.map((i) => t[i]?.한글).filter((x) => typeof x === "number"); const han = ids.map((i) => t[i]?.한자 || 0).reduce((a, b) => a + b, 0);
    return `| ${r.id} | ${r.license || "-"} | ${(r.load.ms / 1000).toFixed(0)}s | ${sc.join(" | ")} | **${avg}** | ${med(pf)} | ${med(gt)} | ${ko.length ? (ko.reduce((a, b) => a + b, 0) / ko.length * 100).toFixed(0) + "%" : "-"} | ${han} |`;
  });
  const legend = TASKS.map((t) => `- **${t.id}**(${t.role}): ${t.설명}`).join("\n");
  return `# 팀원 역할별 모델 시험 — ${now()} (gb10, ctx ${CTX}, temperature 0, json_schema 강제)\n\n${head}\n${sep}\n${rows.join("\n")}\n\n${legend}\n\n점수는 0~1(결정적 채점기). 프리필/생성 tok/s는 llama.cpp timings 실측의 중앙값. 한글=답의 한글 비율 평균, 한자=답에 섞인 한자 글자 수 합.\n`;
}

// --summarize: 새로 재지 않고 results/*.json 전부를 모아 표를 다시 만든다(회차별 실행이 summary.md를 덮어쓰므로).
if (args.includes("--summarize")) {
  const rows = fs.readdirSync(OUT).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")));
  const order = new Map(manifest.map((m, i) => [m.id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  fs.writeFileSync(path.join(OUT, "summary.md"), summarize(rows));
  console.log(summarize(rows));
  process.exit(0);
}

const all = [];
for (const m of models) {
  const r = await runModel(m);
  all.push(r);
  fs.writeFileSync(path.join(OUT, `${m.id}.json`), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(OUT, "summary.md"), summarize(all));
}
log(`끝 — ${all.length}개 모델. 표: ${path.join(OUT, "summary.md")}`);
