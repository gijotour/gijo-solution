#!/usr/bin/env node
// tools/team-bench/gradegate.mjs — 학습에 **먹이기 직전** 재료를 다시 재는 관문.
//
// ■ 왜 이 파일이 생겼나 (2026-09-10 · 검토관 적발)
//   등급 관문이 **빌더 안에만** 있었다. 그래서 빌더가 안 도는 경로 — 밤 예약 작업처럼 이미 구운
//   파일을 집어 학습기에 바로 먹이는 길 — 에는 관문이 한 번도 안 걸렸다. 실제로 그날 밤 경로는
//   창걸음 10이던 옛 도구가 구운 v5(글에 C 본문 105행)를 그대로 bf16 스모크에 넣게 되어 있었다.
//   **이 회전이 막으려던 바로 그 일**(C가 가중치로 들어가는 것)이 스모크에서 일어날 참이었다.
//
//   교훈은 익숙한 것이다 — 만드는 쪽에만 관문을 두면, 만들지 않고 **쓰기만** 하는 경로가 샌다.
//   그래서 관문을 **먹이는 자리**에도 둔다. 잣대는 그대로 material-r5.mjs 하나다(여기서 새로 안 적는다).
//
// 쓰는 법:  node tools/team-bench/gradegate.mjs --in <dataset.json> [--cwin <cwin.json>] [--json]
// 나가는 코드: 0=통과 · 1=빨강(먹이면 안 된다) · 2=쓰는 법 틀림 · 3=파일을 못 읽었다
//   ⚠ 3도 **통과가 아니다** — 못 잰 것을 통과로 세지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 빌더 = process.env.GIJO_MATERIAL_R5 || path.join(여기, "material-r5.mjs");
const { 등급관문, 잣대지문 } = await import(pathToFileURL(빌더).href);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const inP = opt("--in", ""), cwinP = opt("--cwin", "");
if (!inP) { console.error("쓰는 법: node tools/team-bench/gradegate.mjs --in <dataset.json> [--cwin <cwin.json>]"); process.exit(2); }

let rows, 창집합 = null;
try { rows = JSON.parse(fs.readFileSync(inP, "utf8")); } catch (e) { console.error(`✗ 재료를 못 읽었다: ${inP} — ${e.message}`); process.exit(3); }
if (cwinP) {
  try { 창집합 = new Set(JSON.parse(fs.readFileSync(cwinP, "utf8")).windows); }
  catch (e) { console.error(`✗ 창 집합을 못 읽었다: ${cwinP} — ${e.message}`); process.exit(3); }
} else {
  // ⚠ 창 없이 통과한 초록은 **반쪽**이다 — 칸만 본 것이라 「칸은 O인데 글이 C」를 원리상 못 본다.
  console.error("⚠ --cwin 없이 잰다 — grade 칸만 본다(글에 실린 C 본문은 못 본다)");
}
const r = 등급관문(rows, 창집합);
const 요약 = { 파일: inP, 창집합: 창집합 ? 창집합.size : 0, 잣대: 잣대지문(), ...r };
if (args.includes("--json")) console.log(JSON.stringify(요약, null, 2));
else {
  console.log(`등급 관문 — ${path.basename(inP)} · ${r.행}행 · 창집합 ${창집합 ? 창집합.size : "없음"} · 잣대 창${잣대지문().창길이}/걸음${잣대지문().창걸음}/적중${잣대지문().창최소적중}`);
  console.log(r.ok ? "✅ 통과 — 먹여도 된다" : `❌ 빨강 — **먹이면 안 된다**: ${r.사유.join(" / ")}`);
}
process.exit(r.ok ? 0 : 1);
