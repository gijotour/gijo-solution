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
import * as os from "node:os";
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

/** /proc/meminfo의 MemAvailable(MB) — 「지금 실제로 더 쓸 수 있는 양」. 못 읽으면 null. */
function memAvailableMb() {
  try {
    const m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(fs.readFileSync("/proc/meminfo", "utf-8"));
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
}

// ⚠ 통합메모리 기계(NVIDIA GB10·DGX Spark·Jetson)는 nvidia-smi가 GPU 메모리를 **[N/A]** 로 준다.
//   예전엔 그것을 parseInt로 읽어 NaN을 얻고도 null을 안 돌려줬다 → 티어 판정이 「❌ 미지원 환경」을
//   찍고, 모델 스킵 판단(여유 VRAM 비교)이 NaN 비교가 돼 조용히 무너졌다(2026-08-11 GB10에서 확인).
//   제품 쪽 단일 출처는 server/src/util/unifiedmem.ts다. 이 파일은 .mjs라 그 모듈을 import할 수
//   없어 같은 판정을 한 번 더 적는다 — **둘이 어긋나지 않게** server/test/unifiedmem.test.ts가
//   이 파일을 감시한다. 고칠 때는 두 곳을 같이 고칠 것.
function gpu() {
  let name = null, total = NaN, used = NaN, free = NaN;
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"], { encoding: "utf-8" });
    const parts = out.trim().split("\n")[0].split(",");
    name = (parts[0] ?? "").trim();
    [total, used, free] = parts.slice(1).map((s) => parseInt(s.trim(), 10));
  } catch { return null; } // nvidia-smi 자체가 없다 = GPU 없음
  if (!name) return null;
  if (Number.isFinite(total) && total > 0) return { name, total, used, free, unified: false };
  // 통합메모리: GPU 전용 메모리가 없다 — 시스템 메모리로 센다(모델도 여기 올라간다).
  const totalMb = Math.round(os.totalmem() / 1048576);
  const freeMb = memAvailableMb() ?? Math.round(os.freemem() / 1048576);
  return { name, total: totalMb, used: Math.max(0, totalMb - freeMb), free: freeMb, unified: true };
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

// GIJO AS VRAM 티어 판정 — GIJO_AS_VRAM_티어_구동_가이드라인.md의 표를 코드로 옮긴 것.
// 총 VRAM 기준: <16GB → Lite(단일 LLM·16K) · 16~28GB → Standard(2개·32K) · ≥28GB → Pro(3개·32K).
function tierJudgment(g) {
  if (!g) return null;
  const totalGb = g.total / 1024;
  if (totalGb < 16) {
    return {
      name: "🟦 AS Lite (12GB급)", models: "보안 LLM 1개 + RAG 임베딩(bge-m3)", ctx: "16K(여유 우선 시 8K)",
      env: ["GIJO_MAX_LOADED_MODELS=1", "GIJO_LOCAL_LLM_CTX_SIZE=16384", "GIJO_MODEL_VRAM_OVERHEAD_MB=3500"],
      note: "실측 근거: 7B Q5 @16K ≈ 6~7GB + 임베딩 ≈ 2GB → 총 8~9GB. 두 번째 LLM 상주는 불가(스왑 교대만).",
    };
  }
  if (totalGb < 28) {
    return {
      name: "🟩 AS Standard (24GB급)", models: "보안 LLM 2개(지휘+전문가) + RAG 임베딩", ctx: "32K",
      env: ["GIJO_MAX_LOADED_MODELS=2", "GIJO_LOCAL_LLM_CTX_SIZE=32768 (기본값 그대로)"],
      note: "실측 근거: 7B급 2개 @32K ≈ 14GB + 임베딩 ≈ 2GB → 총 16GB(여유 8GB). 운영 검증 구성.",
    };
  }
  return {
    name: "🟪 AS Pro (30GB+급)", models: "보안 LLM 3개(지휘+전문가+특화) + RAG 임베딩", ctx: "32K(3번째는 Q4·16K 권장)",
    env: ["GIJO_MAX_LOADED_MODELS=3", "GIJO_LOCAL_LLM_CTX_SIZE=32768"],
    note: "3번째 모델까지 ≈ 27~29GB — 32GB에서 3번째는 Q4·16K로 낮춰 여유 5GB 확보 권장.",
  };
}

function printTier(g) {
  const t = tierJudgment(g);
  if (!t) {
    console.log(`## GIJO AS 티어 판정 (이 장비 기준)`);
    console.log(`- **판정: ❌ 미지원 환경** — NVIDIA GPU(nvidia-smi)가 감지되지 않음`);
    console.log(`- 제품 요건: **NVIDIA CUDA GPU, VRAM 12GB 이상** (llama-server CUDA 빌드 + nvidia-smi VRAM 예산 관리)`);
    console.log(`- Mac(Apple Silicon)·AMD·CPU-only는 현재 제품 빌드·검증 범위 밖 — 상세는 VRAM 티어 가이드라인 "지원 환경 요건" 참조`);
    console.log("");
    return;
  }
  console.log(`## GIJO AS 티어 판정 (이 장비 기준)`);
  if (g.unified) {
    // 「총 VRAM」이라 부르면 거짓이다 — CPU와 나눠 쓰는 메모리다.
    console.log(`- **판정: ${t.name}** — ${g.name} · 통합메모리 ${(g.total / 1024).toFixed(1)}GB(CPU와 공유)`);
    console.log(`- ⚠ 티어 표는 **32GB급까지만** 정의돼 있다 — 이보다 큰 통합메모리에서 몇 개까지 상주 가능한지는 실측 후 판단할 것(표를 넓히는 것은 제품 결정).`);
  } else {
    console.log(`- **판정: ${t.name}** — 총 VRAM ${(g.total / 1024).toFixed(1)}GB`);
  }
  console.log(`- 권장 구성: ${t.models} · 컨텍스트 ${t.ctx}`);
  console.log(`- 설치 설정(환경변수):`);
  for (const e of t.env) console.log(`  \`${e}\``);
  console.log(`- ${t.note}`);
  console.log(`- 상세: GIJO_AS_VRAM_티어_구동_가이드라인.md · 판매 라인업: GIJO_AS_제품_라인업_판매가이드.md`);
  console.log("");
}

async function main() {
  const g = gpu();
  console.log(`# 모델 실측 벤치마크 (${new Date().toLocaleString("ko-KR")})`);
  console.log(`- GPU: ${g ? `${g.name} · total ${g.total}MB · used ${g.used}MB · free ${g.free}MB${g.unified ? " (통합메모리 — 시스템 메모리로 실측)" : ""}` : "nvidia-smi 없음"} · ctx=${CTX} · gen=${GEN_TOKENS}tok`);
  console.log("");
  printTier(g);

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
