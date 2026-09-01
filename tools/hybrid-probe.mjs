// tools/hybrid-probe.mjs — 하이브리드 LLM 1주차 실측 하네스 (설계서 §7 게이트)
//
// 무엇을 재나:
//   --speed    로컬 모델 생성 속도(tok/s) — 게이트: ≥ 30
//   --extract  발췌 정확도 20문항 — 게이트: 정답 줄 포함 ≥ 18/20
//   --check    문항의 앵커가 실제 파일에 존재하는지(하네스 자가 검증 — 낡은 문항은 시험이 아니다)
//
// 왜 앵커 문자열인가: 줄번호를 박으면 파일이 한 줄만 바뀌어도 전 문항이 낡는다.
//   실행 시점에 앵커를 grep해 정답 줄번호를 얻으므로 문항이 코드를 따라간다.
//
// 왜 「과포착」을 따로 재나: 모델이 파일의 절반을 발췌하면 정답이야 들어가지만
//   Claude 입력 절감이라는 목적이 죽는다. 통과 판정과 별개로 발췌 폭을 기록해
//   30%를 넘으면 표시한다 — 통과 불가능한 시험만큼 통과 무의미한 시험도 가짜다.
//
// 실행(gb10): . ~/gijo-env.sh && node tools/hybrid-probe.mjs --extract --url http://localhost:8100
//
// ⚠ 서버는 --parallel 1로 띄울 것 (2026-08-27 실측): --parallel 2면 ctx가 슬롯당 반으로
//   갈라져(65536→32768) 2,000줄급 파일 6개(36K~59K tok)가 전부 400으로 죽었다 —
//   모델 오답이 아니라 판정 환경 문제였다(14/20이 그렇게 나왔고, 답한 14문항은 14/14 정답).
//   이건 측정 잡음이 아니라 **파이프라인 요건**이다: local-digest 구현 때
//   「파일 토큰 > 슬롯 ctx면 겹침 분할 후 범위 병합」이 필수라는 실측 근거.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const URL_ = opt("--url", "http://localhost:8100");
// ⚠ new URL().pathname은 공백을 %20으로 남긴다(「D:\Connect AI」가 실제로 밟았다) — fileURLToPath가 정석.
const ROOT = opt("--root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const QFILE = path.join(ROOT, "tools", "hybrid-probe-questions.json");

function 줄번호붙임(src) {
  return src.split("\n").map((l, i) => `${i + 1}\t${l}`).join("\n");
}

function 정답줄(src, anchor) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(anchor)) hits.push(i + 1);
  return hits;
}

// llama.cpp OAI 호환 창구. response_format json_schema를 먼저 시도하고,
// 그 판이 안 받으면 /completion + json_schema(문법 강제)로 폴백한다.
async function 채팅(prompt, schema, nPredict) {
  const body = {
    model: "local",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: nPredict ?? 512,
  };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "out", strict: true, schema } };
  let r = await fetch(URL_ + "/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (r.ok) {
    const j = await r.json();
    return { text: j.choices?.[0]?.message?.content ?? "", usage: j.usage, timings: j.timings };
  }
  // 폴백 — ChatML 수동 조립 + native /completion (json_schema 필드)
  const p2 = `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
  const b2 = { prompt: p2, temperature: 0, n_predict: nPredict ?? 512, cache_prompt: false };
  if (schema) b2.json_schema = schema;
  r = await fetch(URL_ + "/completion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b2) });
  if (!r.ok) throw new Error(`둘 다 실패: ${r.status} ${await r.text().then((t) => t.slice(0, 200))}`);
  const j = await r.json();
  return { text: j.content ?? "", usage: null, timings: j.timings };
}

const RANGE_SCHEMA = {
  type: "object",
  properties: {
    ranges: {
      type: "array",
      items: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
      minItems: 1, maxItems: 8,
    },
  },
  required: ["ranges"],
};

async function 속도() {
  console.log(`── 속도 측정 (${URL_}) ──`);
  await 채팅("워밍업. 1+1은?", null, 16).catch((e) => { throw new Error("서버 응답 없음: " + e.message); });
  const r = await 채팅(
    "보안 취약점 관리 절차를 담당자 관점에서 800자 내외 한국어로 설명해라. 발견·분류·조치·검증·보고 단계를 포함하라.",
    null, 700
  );
  const t = r.timings;
  if (t) {
    console.log(`프리필  ${Math.round(t.prompt_per_second ?? 0)} tok/s (${t.prompt_n}tok)`);
    console.log(`생성    ${(t.predicted_per_second ?? 0).toFixed(1)} tok/s (${t.predicted_n}tok)`);
    console.log(`게이트(생성 ≥ 30): ${((t.predicted_per_second ?? 0) >= 30) ? "✅ 통과" : "❌ 미달"}`);
  } else {
    console.log("⚠ timings 없음 — 응답 길이", r.text.length, "자. 서버를 native로 확인 필요");
  }
}

async function 발췌(문항들) {
  console.log(`── 발췌 정확도 ${문항들.length}문항 (${URL_}) ──`);
  let 통과 = 0, 과포착 = 0;
  const rows = [];
  for (const q of 문항들) {
    const file = path.join(ROOT, q.file);
    const src = fs.readFileSync(file, "utf8");
    const 총줄 = src.split("\n").length;
    const 정답 = 정답줄(src, q.anchor);
    if (정답.length === 0) { rows.push([q.file, "⚠ 앵커 소실", "-", "-"]); continue; }
    const prompt =
      `아래는 줄번호가 붙은 소스 파일이다(총 ${총줄}줄). 질문에 답하는 데 필요한 부분의 **줄 범위**만 골라라.\n` +
      `내용을 요약하거나 다시 쓰지 마라 — 줄 범위 선택만 한다. 범위는 최소한으로.\n\n` +
      `질문: ${q.question}\n\n파일 ${q.file}:\n${줄번호붙임(src)}`;
    const t0 = Date.now();
    let ok = false, 폭 = 0, 오류 = "";
    try {
      const r = await 채팅(prompt, RANGE_SCHEMA, 256);
      const out = JSON.parse(r.text);
      const ranges = out.ranges || [];
      폭 = ranges.reduce((a, [s, e]) => a + Math.max(0, e - s + 1), 0);
      ok = 정답.some((ln) => ranges.some(([s, e]) => ln >= s && ln <= e));
    } catch (e) { 오류 = String(e.message).slice(0, 60); }
    const 초 = ((Date.now() - t0) / 1000).toFixed(1);
    const 넓나 = 폭 > 총줄 * 0.3;
    if (ok) 통과++;
    if (넓나) 과포착++;
    rows.push([q.file.split("/").pop(), ok ? "✅" : "❌" + (오류 ? " " + 오류 : ""), `${폭}/${총줄}줄${넓나 ? " ⚠넓음" : ""}`, 초 + "s"]);
    console.log(`  ${rows[rows.length - 1].join("  ")}`);
  }
  console.log(`\n결과: ${통과}/${문항들.length} 통과 · 과포착 ${과포착}건`);
  console.log(`게이트(≥ ${Math.ceil(문항들.length * 0.9)}): ${통과 >= Math.ceil(문항들.length * 0.9) ? "✅ 통과" : "❌ 미달"}`);
}

function 앵커검증(문항들) {
  console.log(`── 앵커 자가 검증 ${문항들.length}문항 ──`);
  let bad = 0;
  for (const q of 문항들) {
    const file = path.join(ROOT, q.file);
    if (!fs.existsSync(file)) { console.log(`  ❌ 파일 없음: ${q.file}`); bad++; continue; }
    const hits = 정답줄(fs.readFileSync(file, "utf8"), q.anchor);
    if (hits.length === 0) { console.log(`  ❌ 앵커 소실: ${q.file} 「${q.anchor}」`); bad++; }
    else if (hits.length > 5) { console.log(`  ⚠ 앵커 과다(${hits.length}곳 — 정답이 흐려진다): ${q.file}`); }
    else console.log(`  ✅ ${q.file} → ${hits.join(",")}줄`);
  }
  console.log(bad === 0 ? "\n전 문항 유효 ✅" : `\n⚠ ${bad}문항 수리 필요`);
  process.exitCode = bad === 0 ? 0 : 1;
}

const 문항들 = JSON.parse(fs.readFileSync(QFILE, "utf8"));
if (args.includes("--check")) 앵커검증(문항들);
else if (args.includes("--speed")) await 속도();
else if (args.includes("--extract")) { await 속도(); console.log(""); await 발췌(문항들); }
else console.log("사용: node tools/hybrid-probe.mjs --check | --speed | --extract [--url http://localhost:8100]");
