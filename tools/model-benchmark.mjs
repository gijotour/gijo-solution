// tools/model-benchmark.mjs — VRAM 티어 가이드용 모델 실측 벤치마크.
//
// 측정 항목(모델별): 파일 크기 · 로드 시간 · VRAM 증가분(실측 nvidia-smi) · 첫 토큰 지연 · 생성 속도(tok/s)
// 안전장치: 시작 전 여유 VRAM을 실측해 (파일크기 + 오버헤드 추정)이 안 들어가면 스킵한다(운영 GPU 보호).
//
// 사용:
//   node tools/model-benchmark.mjs                     # models/ 아래 전 모델 대상(들어가는 것만)
//   node tools/model-benchmark.mjs --models a,b --ctx 8192
//   node tools/model-benchmark.mjs --probe 8080=gijo-main-orchestrator,8082=merged-lily
//     → 이미 떠 있는 llama-server(운영 상주분)의 추론 속도만 측정(로드 없음·VRAM 영향 없음)
//
// 결과는 markdown 표로 stdout 출력 — 그대로 가이드 문서에 붙일 수 있다.

import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS_DIR = path.join(ROOT, "server", "models");
const LLAMA_BIN = path.join(ROOT, "server", "llama.cpp", "build", "bin", process.platform === "win32" ? "Release/llama-server.exe" : "llama-server");
const BENCH_PORT = 8299;
// 로드에 필요한 여유 추정 = 파일크기 + KV/런타임 오버헤드(ctx 비례 대략치)
const overheadMb = (ctx) => Math.round(1500 + (ctx / 32768) * 3500);

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const CTX = Number(arg("ctx", 8192));
const PROMPT = arg("prompt", "보안 담당자를 위해 KEV 등재 취약점의 조치 우선순위 원칙을 3줄로 설명해줘.");
const GEN_TOKENS = Number(arg("tokens", 160));

function gpu() {
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"], { encoding: "utf-8" });
    const [total, used, free] = out.trim().split("\n")[0].split(",").map((s) => parseInt(s.trim(), 10));
    return { total, used, free };
  } catch { return null; }
}

function listModels() {
  if (!fs.existsSync(MODELS_DIR)) return [];
  return fs.readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, file: path.join(MODELS_DIR, d.name, `${d.name}.gguf`) }))
    .filter((m) => fs.existsSync(m.file))
    .map((m) => ({ ...m, sizeMb: Math.round(fs.statSync(m.file).size / 1048576) }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(port, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) { const j = await r.json().catch(() => ({})); if (j.status !== "loading model") return Date.now() - t0; }
    } catch {}
    await sleep(500);
  }
  throw new Error("로드 타임아웃");
}

// 완성 API로 첫 토큰 지연·생성 속도 측정(스트리밍).
async function inferBench(port) {
  const t0 = Date.now();
  let firstTokMs = null, tokens = 0;
  const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: PROMPT }], max_tokens: GEN_TOKENS, stream: true, temperature: 0 }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { tokens++; if (firstTokMs === null) firstTokMs = Date.now() - t0; }
      } catch {}
    }
  }
  const totalMs = Date.now() - t0;
  const genMs = totalMs - (firstTokMs ?? 0);
  return { firstTokMs: firstTokMs ?? totalMs, tokPerSec: tokens > 1 && genMs > 0 ? +(tokens / (genMs / 1000)).toFixed(1) : null, tokens };
}

async function benchLoad(model) {
  const before = gpu();
  if (before && before.free < model.sizeMb + overheadMb(CTX)) {
    return { ...model, skipped: `여유 VRAM 부족 (free ${before.free}MB < 필요 ~${model.sizeMb + overheadMb(CTX)}MB)` };
  }
  const proc = spawn(LLAMA_BIN, ["-m", model.file, "-ngl", "-1", "--ctx-size", String(CTX), "--port", String(BENCH_PORT)], { stdio: "ignore" });
  try {
    const loadMs = await waitReady(BENCH_PORT);
    await sleep(1500); // VRAM 안정화
    const after = gpu();
    const vramMb = before && after ? after.used - before.used : null;
    const inf = await inferBench(BENCH_PORT);
    return { ...model, loadMs, vramMb, ...inf };
  } catch (e) {
    return { ...model, skipped: String(e.message || e) };
  } finally {
    proc.kill();
    await sleep(3000); // VRAM 반납 대기
  }
}

function row(cells) { return `| ${cells.join(" | ")} |`; }

async function main() {
  const g = gpu();
  console.log(`# 모델 실측 벤치마크 (${new Date().toLocaleString("ko-KR")})`);
  console.log(`- GPU: ${g ? `total ${g.total}MB · used ${g.used}MB · free ${g.free}MB` : "nvidia-smi 없음"} · ctx=${CTX} · gen=${GEN_TOKENS}tok`);
  console.log("");

  // --probe: 이미 떠 있는 서버(운영 상주 모델) 추론만 측정
  const probe = arg("probe", "");
  if (probe) {
    console.log(`## 상주 모델 프로브(로드 없음)`);
    console.log(row(["모델", "포트", "첫 토큰", "생성 속도"]));
    console.log(row(["---", "---", "---", "---"]));
    for (const spec of probe.split(",")) {
      const [port, name] = spec.split("=");
      try {
        const inf = await inferBench(Number(port));
        console.log(row([name || `:${port}`, port, `${inf.firstTokMs}ms`, inf.tokPerSec ? `${inf.tokPerSec} tok/s` : "-"]));
      } catch (e) {
        console.log(row([name || `:${port}`, port, `측정 실패: ${e.message}`, "-"]));
      }
    }
    console.log("");
  }

  const only = arg("models", "");
  let models = listModels();
  if (only) { const want = new Set(only.split(",")); models = models.filter((m) => want.has(m.id)); }
  if (!models.length) { console.log("(로드 벤치 대상 모델 없음)"); return; }

  console.log(`## 로드 벤치마크`);
  console.log(row(["모델", "파일", "로드", "VRAM 증가", "첫 토큰", "생성 속도"]));
  console.log(row(["---", "---", "---", "---", "---", "---"]));
  for (const m of models) {
    const r = await benchLoad(m);
    if (r.skipped) { console.log(row([m.id, `${(m.sizeMb / 1024).toFixed(1)}GB`, `⏭ ${r.skipped}`, "-", "-", "-"])); continue; }
    console.log(row([m.id, `${(m.sizeMb / 1024).toFixed(1)}GB`, `${(r.loadMs / 1000).toFixed(1)}s`, r.vramMb ? `${(r.vramMb / 1024).toFixed(1)}GB` : "-", `${r.firstTokMs}ms`, r.tokPerSec ? `${r.tokPerSec} tok/s` : "-"]));
  }
}

main().catch((e) => { console.error("실패:", e.message || e); process.exit(1); });
