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
// ■ 무엇을 재나 (셋 다 **먹이기 직전에** 잰다)
//   ① 등급 — grade 칸이 O인가 · 칸은 O인데 글에 등급 C 본문이 실렸나(--cwin 이 있어야 온전하다)
//   ② 인용 — 「[n]에 따르면 "X"」의 X가 **그 번호의 블록에 그대로** 있나(2026-09-10 신설)
//   ③ 겹침 — 재료가 시험지·표본 문항을 물고 있나(--holdout · --samples, 2026-09-10 신설)
//
// 쓰는 법:  node tools/team-bench/gradegate.mjs --in <dataset.json> [--cwin <cwin.json>]
//                                              [--holdout <시험지.json>] [--samples <표본문항.json>] [--json]
// 나가는 코드: 0=통과 · 1=빨강(먹이면 안 된다) · 2=쓰는 법 틀림 · 3=파일을 못 읽었다
//   ⚠ 3도 **통과가 아니다** — 못 잰 것을 통과로 세지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 빌더 = process.env.GIJO_MATERIAL_R5 || path.join(여기, "material-r5.mjs");
const 잣대 = await import(pathToFileURL(빌더).href);
const { 등급관문, 잣대지문 } = 잣대;
// ⚠ 잣대가 **낡은 사본**일 수 있다(gb10은 GIJO_MATERIAL_R5로 사본을 가리킬 수 있다). 없는 검사를
//   조용히 건너뛰면 그것이 곧 「못 잰 것을 통과로 세기」다 — 그래서 무엇을 못 쟀는지 말한다.
const 못재는것 = ["인용관문", "겹침관문"].filter((k) => typeof 잣대[k] !== "function");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const inP = opt("--in", ""), cwinP = opt("--cwin", "");
const holdP = opt("--holdout", ""), sampP = opt("--samples", "");
if (!inP) { console.error("쓰는 법: node tools/team-bench/gradegate.mjs --in <dataset.json> [--cwin <cwin.json>] [--holdout <시험지.json>] [--samples <표본문항.json>]"); process.exit(2); }

/**
 * 파일에서 행 배열을 꺼낸다 — **배열**이거나 **{ 행: [...] }** 꼴이다.
 * ★ 왜 두 꼴인가(2026-09-10 · 회전 5): 평가용 시험지는 파일 머리에 「회전 4 이전과 비교 불가」 같은
 *   경고를 이고 다녀야 한다. JSON에는 주석이 없으니 머리 칸을 둔 객체가 되고, 그 꼴을 학습기도
 *   이미 읽는다(server/scripts/finetune_qlora14b.py 평가파일읽기: `raw.get("행", raw)`).
 *   여기서 배열만 받으면 **학습기는 읽는 파일을 관문은 못 읽는** 어긋남이 생긴다 — 두 꼴을 같이 읽는다.
 */
export const 행꺼내기 = (raw) => (Array.isArray(raw) ? raw : (raw && Array.isArray(raw.행) ? raw.행 : raw));

let rows, 창집합 = null;
try { rows = 행꺼내기(JSON.parse(fs.readFileSync(inP, "utf8"))); } catch (e) { console.error(`✗ 재료를 못 읽었다: ${inP} — ${e.message}`); process.exit(3); }
if (cwinP) {
  try { 창집합 = new Set(JSON.parse(fs.readFileSync(cwinP, "utf8")).windows); }
  catch (e) { console.error(`✗ 창 집합을 못 읽었다: ${cwinP} — ${e.message}`); process.exit(3); }
} else {
  // ⚠ 창 없이 통과한 초록은 **반쪽**이다 — 칸만 본 것이라 「칸은 O인데 글이 C」를 원리상 못 본다.
  console.error("⚠ --cwin 없이 잰다 — grade 칸만 본다(글에 실린 C 본문은 못 본다)");
}
/**
 * 시험 문항 겹침 — 재료가 시험지·표본 문항을 물고 있으면 **먹이지 않는다**(2026-09-10 · 검토관 적발).
 * ★ 왜 여기인가: 빌더는 「먼저 떼고 남은 것으로 굽는다」로 이것을 지키지만, 그 차례를 안 지나는 경로
 *   — 구워진 파일을 집어 바로 먹이는 길, 옛 빌더가 다시 굽는 길 — 에는 아무 감시도 없었다.
 *   재료 파일(raft-vuln-v6)은 저장소에 안 들어오므로(data/ 무시) **시험으로는 원리상 못 본다.**
 *   재는 자리는 그 파일이 **실제로 있는 곳**, 즉 먹이기 직전의 이 관문이다.
 */
const 겹침들 = [];
for (const [이름, p] of [["시험지", holdP], ["표본 문항", sampP]]) {
  if (!p) continue;
  let 시험행;
  try { 시험행 = 행꺼내기(JSON.parse(fs.readFileSync(p, "utf8"))); }
  catch (e) { console.error(`✗ ${이름}을 못 읽었다: ${p} — ${e.message}`); process.exit(3); }
  if (typeof 잣대.겹침관문 !== "function") { console.error(`✗ 잣대에 겹침관문이 없다(낡은 사본: ${빌더}) — 못 잰 것은 통과가 아니다`); process.exit(3); }
  겹침들.push({ 이름, 파일: p, ...잣대.겹침관문(rows, Array.isArray(시험행) ? 시험행 : [], 이름) });
}

const r = 등급관문(rows, 창집합);
const 막힘 = [...r.사유, ...겹침들.flatMap((x) => x.사유)];
const 통과 = 막힘.length === 0;
const 요약 = { 파일: inP, 창집합: 창집합 ? 창집합.size : 0, 잣대: 잣대지문(), ...r, 겹침: 겹침들, 못잰검사: 못재는것, ok: 통과, 사유: 막힘 };
if (args.includes("--json")) console.log(JSON.stringify(요약, null, 2));
else {
  console.log(`등급 관문 — ${path.basename(inP)} · ${r.행}행 · 창집합 ${창집합 ? 창집합.size : "없음"} · 잣대 창${잣대지문().창길이}/걸음${잣대지문().창걸음}/적중${잣대지문().창최소적중}`);
  if (r.인용) console.log(`  인용 — ${r.인용.셈}건 중 제 번호의 블록에 그대로 있는 것 ${r.인용.맞음} · 남의 번호 ${r.인용.번호틀림} · 어디에도 없음 ${r.인용.없음}`);
  for (const g of 겹침들) console.log(`  겹침 — ${g.이름}(${path.basename(g.파일)}) 문항 ${g.시험문항}개 중 재료가 문 것 ${g.겹침}건`);
  if (못재는것.length) console.log(`  ⚠ 못 잰 검사: ${못재는것.join(", ")} — 잣대가 낡은 사본이다(${빌더}). **못 잰 것은 통과가 아니다**`);
  console.log(통과 ? "✅ 통과 — 먹여도 된다" : `❌ 빨강 — **먹이면 안 된다**: ${막힘.join(" / ")}`);
}
process.exit(통과 ? 0 : 1);
