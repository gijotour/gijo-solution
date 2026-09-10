#!/usr/bin/env node
// tools/team-bench/crosscheck27b.mjs — 재료의 **사실 주장 행**을 두 번째 교사(27B)에게 되묻는다.
//
// ■ 왜 (계획서 §12.12 뿌리 ④): 회전 1~4의 재료는 **교사 한 종**(3bit 한 판)에서 나왔고 교차 검증이
//   0건이었다. 한 교사가 틀리면 그 틀림이 그대로 학습된다 — 그리고 학습된 사실 오류는 관문 ①(KEV)이
//   **한 종류만** 잡는다. 그래서 굽기 전에, 사실을 주장하는 행만 골라 다른 두뇌에게 되묻는다.
//
// ■ 무엇을 묻나 — 「이 답이 **이 근거로** 뒷받침되나」 하나뿐이다.
//   ⚠ 「이 답이 맞나」를 묻지 않는다. 그건 27B의 세계 지식을 정답으로 삼는 것이고, 그러면 우리가 하는
//     일은 사실 검증이 아니라 **교사 갈아타기**가 된다. 근거는 우리가 이미 가진 그 조각이다.
//   ⚠ 판정은 세 값뿐이다(일치·불일치·모름). 모름은 **버리지 않는다** — 애매한 것을 버리면 재료가
//     「27B가 확신하는 것」으로 좁아지고, 그 편향은 아무 데도 안 적힌다.
//
// ■ 어디서 도나: gb10의 **격리 포트**(기본 8300)에 띄운 27B. 교사 8080은 절대 건드리지 않는다
//   (원격 팀원 셋이 그것을 쓴다 — 낮에는 이 도구를 아예 돌리지 않는다).
//
// 쓰는 법:
//   node tools/team-bench/crosscheck27b.mjs --in <재료.json> --out <판정.json> \
//     [--final <거른재료.json>] [--port 8300] [--prompt-spec tools/team-bench/prompt-spec.json]
//     [--limit N] [--timeout-ms 120000]
// 나가는 코드: 0=끝 · 1=서버에 못 붙음 · 2=쓰는 법 틀림
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 빌더경로 = process.env.GIJO_RAFT_BUILDER || path.join(여기, "..", "build-raft-dataset.mjs");
const 재료경로 = process.env.GIJO_MATERIAL_R5 || path.join(여기, "material-r5.mjs");
const { 근거조각뽑기, 근거블록있나 } = await import(pathToFileURL(빌더경로).href);
const { 사실주장인가 } = await import(pathToFileURL(재료경로).href);

/** 검증기 프롬프트 — 근거 밖의 지식을 쓰지 말라고 못 박는다(교사 갈아타기 방지). */
export const 검증SYS = [
  "너는 사실 대조기다. 아래 「근거」와 「답」을 받고, 답이 하는 사실 주장이 근거로 뒷받침되는지만 판정한다.",
  "근거에 없는 세상 지식으로 판단하지 않는다. 근거가 말하지 않는 주장은 '모름'이다.",
  "반드시 아래 한 줄 JSON만 출력한다. 다른 말은 쓰지 않는다.",
  '{"판정":"일치|불일치|모름","이유":"한 문장"}',
].join("\n");

/** 답에서 판정을 캐낸다 — JSON이 아니면 **모름**이다(억지로 읽어 내면 조용히 틀린 판정이 섞인다). */
export function 판정읽기(text) {
  const s = String(text ?? "");
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return { 판정: "모름", 이유: "JSON을 못 찾음", 원문: s.slice(0, 200) };
  try {
    const j = JSON.parse(m[0]);
    const v = String(j.판정 ?? j.verdict ?? "").trim();
    if (!["일치", "불일치", "모름"].includes(v)) return { 판정: "모름", 이유: `모르는 판정값: ${v}`, 원문: s.slice(0, 200) };
    return { 판정: v, 이유: String(j.이유 ?? j.reason ?? "").slice(0, 300) };
  } catch (e) {
    return { 판정: "모름", 이유: "JSON 파싱 실패: " + String(e).slice(0, 100), 원문: s.slice(0, 200) };
  }
}

/** 되물을 대상인가 — 사실 주장이 있고 **근거 조각이 있는** 행만. 근거가 없으면 대조할 것이 없다. */
export function 대상인가(row, 머리말) {
  if (!사실주장인가(row)) return false;
  return 근거블록있나(row?.system, 머리말) && 근거조각뽑기(row?.system, 머리말).length > 0;
}

export function 물음만들기(row, 머리말) {
  const 조각들 = 근거조각뽑기(row?.system, 머리말);
  return [
    "[근거]",
    ...조각들.map((c, i) => `(${i + 1}) ${c}`),
    "",
    "[답]",
    String(row?.answer ?? ""),
  ].join("\n");
}

async function 물어보기(base, system, user, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(base + "/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({
        model: "local",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0, max_tokens: 220, cache_prompt: false,
        // ⚠ 생각 모드를 끈다 — 켜 두면 27B가 생각만 쏟아 내고 **답이 0자**로 오는 실측이 있다.
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    const j = await r.json();
    return String(j?.choices?.[0]?.message?.content ?? "");
  } finally { clearTimeout(t); }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("crosscheck27b.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const inP = opt("--in", ""), outP = opt("--out", "");
  if (!inP || !outP) {
    console.error("쓰는 법: node tools/team-bench/crosscheck27b.mjs --in <재료.json> --out <판정.json> [--final <거른재료.json>] [--port 8300] [--limit N]");
    process.exit(2);
  }
  const base = `http://127.0.0.1:${opt("--port", "8300")}`;
  const 머리말 = JSON.parse(fs.readFileSync(opt("--prompt-spec", path.join(여기, "prompt-spec.json")), "utf8")).ragHeader;
  const rows = JSON.parse(fs.readFileSync(inP, "utf8"));
  const timeoutMs = Number(opt("--timeout-ms", "120000"));

  try {
    const h = await fetch(base + "/health", { signal: AbortSignal.timeout(10000) });
    if (!h.ok) throw new Error("health " + h.status);
  } catch (e) {
    console.error(`✗ 27B 창구(${base})에 못 붙었다: ${String(e).slice(0, 120)}`);
    process.exit(1);
  }

  const 대상 = [];
  rows.forEach((r, i) => { if (대상인가(r, 머리말)) 대상.push(i); });
  const 한도 = Number(opt("--limit", "0"));
  const 볼것 = 한도 > 0 ? 대상.slice(0, 한도) : 대상;
  console.log(`행 ${rows.length} · 사실 주장 + 근거 있는 행 ${대상.length} · 이번에 되물을 행 ${볼것.length}`);

  const 판정들 = [];
  const 셈 = { 일치: 0, 불일치: 0, 모름: 0 };
  for (let n = 0; n < 볼것.length; n++) {
    const i = 볼것[n];
    const t0 = Date.now();
    let 답 = "";
    try { 답 = await 물어보기(base, 검증SYS, 물음만들기(rows[i], 머리말), timeoutMs); }
    catch (e) { 답 = ""; }
    const v = 답 ? 판정읽기(답) : { 판정: "모름", 이유: "답이 비었다(시간 초과이거나 창구가 막혔다)" };
    셈[v.판정] += 1;
    판정들.push({ i, ...v, ms: Date.now() - t0 });
    console.log(`${n + 1}/${볼것.length} 행#${i} ${v.판정} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const 버릴자리 = new Set(판정들.filter((v) => v.판정 === "불일치").map((v) => v.i));
  fs.writeFileSync(outP, JSON.stringify({
    잰때: new Date().toISOString(), 입력: inP, 행: rows.length,
    대상: 대상.length, 되물음: 볼것.length, 셈, 버림: 버릴자리.size, 판정들,
  }, null, 2));
  console.log(`판정 파일: ${outP} · 일치 ${셈.일치} · 불일치 ${셈.불일치} · 모름 ${셈.모름}`);

  const finalP = opt("--final", "");
  if (finalP) {
    // ⚠ 「모름」은 안 버린다 — 애매한 것을 버리면 재료가 「27B가 확신하는 것」으로 좁아진다.
    const 남김 = rows.filter((_, i) => !버릴자리.has(i));
    fs.writeFileSync(finalP, JSON.stringify(남김, null, 2));
    console.log(`거른 재료: ${finalP} (${rows.length} → ${남김.length}행 · 버림 ${버릴자리.size})`);
  }
}
