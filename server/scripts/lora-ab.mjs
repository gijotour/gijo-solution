// scripts/lora-ab.mjs — LoRA 어댑터 A/B 실측(맨몸 비교 — 제품 경로가 아니라 모델 직접).
//
// [2026-08-08] 채택은 측정이 정한다 — 과거 파인튜닝이 held-out에서 오히려 하락해 폐기한
// 전례(오케스트레이터 8/8→7/8)가 있다. 같은 방식으로: **학습에 안 쓴 질문**을 베이스와
// 베이스+어댑터에 똑같이 물어 답을 나란히 저장한다. 판정은 자동 점수가 아니라 **사람이 읽는다**
// (페르소나 검증 교훈: 자동검사만 믿지 말 것). 자동으로 재는 것은 두 가지뿐 — 한국어 비율·길이.
//
// 실행: node scripts/lora-ab.mjs --lora data/lora/vuln-r16-gguf/adapter.gguf [--port 8090]
// ⚠ 운영 llama-server 풀을 내리고 돌릴 것(VRAM 16GB 필요) — 학습 파이프라인과 같은 제약.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LORA = arg("--lora", "");
const PORT = Number(arg("--port", "8090"));
const BIN = arg("--bin", path.resolve("..", "llama.cpp", "build", "bin", "llama-server"));
const MODEL = arg("--model", path.resolve("models", "qwen3-14b", "qwen3-14b.gguf"));

// held-out — 학습 재료(설명·절차형 실로그)와 겹치지 않게 새로 쓴 취약점 실무 질문 10개.
const 문항 = [
  "CVSS 점수와 EPSS 점수는 뭐가 다르고, 조치 우선순위를 정할 때 어느 쪽을 먼저 봐야 해?",
  "KEV 목록에 오른 취약점이 우리 자산에서 나오면 왜 최우선으로 조치해야 하는지 설명해줘",
  "Log4Shell(CVE-2021-44228)이 왜 위험한지, 패치 말고 임시로 막을 방법까지 알려줘",
  "스캐너가 같은 취약점을 두 자산에서 찾았는데 한쪽만 조치하면 되는 경우가 있어?",
  "오탐(false positive)으로 판정하기 전에 확인해야 할 것들을 순서대로 알려줘",
  "취약점 조치가 끝났다는 걸 어떻게 검증해? 재스캔 말고 다른 방법도 있어?",
  "웹 서버에서 SQL 인젝션 취약점이 나왔을 때 개발팀에 뭐라고 요청해야 해?",
  "EOL(지원 종료)된 소프트웨어의 취약점은 패치가 안 나오는데 어떻게 관리해?",
  "취약점 스캔 주기를 정할 때 고려할 기준을 알려줘",
  "보상통제(compensating control)로 취약점을 닫는 게 인정되는 조건이 뭐야?",
];

function 서버(loraPath) {
  const a = ["-m", MODEL, "-ngl", "-1", "--ctx-size", "8192", "--port", String(PORT), "--reasoning", "off", "--reasoning-budget", "0"];
  if (loraPath) a.push("--lora", loraPath);
  const p = spawn(BIN, a, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err += String(d); });
  p.on("exit", (c) => { if (c) console.error("llama-server 종료", c, err.slice(-400)); });
  return p;
}

async function 준비대기() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("llama-server가 240초 안에 안 떴습니다");
}

async function 묻기(q) {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "당신은 GIJO AS의 취약점 전문 보안 분석가다. 사내 근거를 우선하고, 모르는 것은 모른다고 말하며, 한국어로 정확하고 간결하게 답한다." },
        { role: "user", content: q },
      ],
      temperature: 0.3, max_tokens: 500,
    }),
  });
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? "").trim();
}

const 한국어비율 = (s) => { const t = s.replace(/\s/g, ""); return t ? Math.round(((t.match(/[가-힣]/g) ?? []).length / t.length) * 100) : 0; };

async function 한판(이름, loraPath) {
  console.log(`\n■ ${이름} 기동…`);
  const p = 서버(loraPath);
  try {
    await 준비대기();
    const out = [];
    for (let i = 0; i < 문항.length; i++) {
      const t0 = Date.now();
      const a = await 묻기(문항[i]);
      out.push({ q: 문항[i], a, ms: Date.now() - t0, ko: 한국어비율(a), len: a.length });
      console.log(`  [${i + 1}/${문항.length}] ${((Date.now() - t0) / 1000).toFixed(1)}s · 한글 ${out[i].ko}% · ${a.length}자`);
    }
    return out;
  } finally { p.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 4000)); }
}

const base = await 한판("베이스(qwen3-14b)", null);
const tuned = LORA ? await 한판("베이스+LoRA", LORA) : null;

const md = ["# LoRA A/B — 맨몸 held-out 10문 (판정은 사람이 읽는다)", "",
  `측정: ${new Date().toISOString()} · 모델 ${path.basename(MODEL)} · 어댑터 ${LORA || "(없음)"}`, ""];
for (let i = 0; i < 문항.length; i++) {
  md.push(`## ${i + 1}. ${문항[i]}`, "", `### A 베이스 (${base[i].ko}% 한글 · ${base[i].len}자 · ${(base[i].ms / 1000).toFixed(1)}s)`, "", base[i].a, "");
  if (tuned) md.push(`### B 베이스+LoRA (${tuned[i].ko}% 한글 · ${tuned[i].len}자 · ${(tuned[i].ms / 1000).toFixed(1)}s)`, "", tuned[i].a, "");
}
const localOut = "/tmp/lora-ab.md";
fs.writeFileSync(localOut, md.join("\n"), "utf8");
console.log(`\n결과 저장: ${localOut}${tuned ? "" : " (베이스만 — --lora 를 주면 B가 붙습니다)"}`);
