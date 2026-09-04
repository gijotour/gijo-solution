#!/usr/bin/env node
// tools/ladder/make-cal-slice.mjs — 캘리브레이션용 **얇은 슬라이스**를 뽑는다.
//
// 무엇에 쓰나: 회전을 통째로 굽기 전에 10스텝만 돌려 「초/스텝 · 길이 초과 제외 수 · 메모리 여유」를
//   재는 캘리브레이션(`cal-run-v2.sh`)의 입력이다. 160행 · epochs 1 · batch1x누적16 = 정확히 10스텝.
//
// ★ 왜 도구가 되었나(2026-09-04): 이 식은 **회전 1이 손으로 뽑고 글로 안 남겼다.** 회전 2에서 같은
//   슬라이스를 다시 만들려다 못 만들어, gb10에 남아 있던 `raft-vuln-cal160.json`(160행)과 원본
//   `raft-vuln-v1.json`(1,297행)을 **후보 4개로 대조해** 되찾아야 했다(md5가 맞는 것이 하나뿐이었다).
//   되찾은 식을 다시 사람 손에 두면 회전 3에서 같은 일이 난다 — 그래서 도구로 못 박고 시험을 붙인다.
//
// 식: rows[⌊i×n/N⌋], i=0…N-1 (균등 간격).
//   ⚠ 앞 N행을 자르면 **승인 순서 쏠림**이 그대로 실린다(먼저 승인된 문답은 주제가 몰려 있다).
//     캘리브레이션은 「이 재료의 길이 분포에서 몇 초/스텝인가」를 재는 자리라, 표본이 전체를
//     닮아야 그 숫자가 본 회전에 그대로 쓰인다.
//
// 쓰는 법:
//   node tools/ladder/make-cal-slice.mjs <데이터셋.json> [--n 160] [--out <경로>]
//   node tools/ladder/make-cal-slice.mjs data/datasets/raft-vuln-v2.json --n 160
//     → data/datasets/raft-vuln-v2-cal160.json · 행수·md5·글자수 평균/p95를 찍는다(전체와 견줘서).
//
// ⚠ 이 도구는 **읽고 쓰기만** 한다 — 서버 창구를 부르지 않는다(학습 재료는 위생 창구를 이미 지났다).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/** 캘리브레이션 슬라이스 — 회전 1·2가 쓴 그 식 그대로. 순수 함수라 시험이 직접 부른다. */
export function 슬라이스(rows, N) {
  const n = rows.length;
  if (!Number.isInteger(N) || N < 1) throw new Error(`--n 은 1 이상의 정수여야 합니다(받은 값: ${N})`);
  if (!n) throw new Error("입력 행이 0개입니다");
  if (N > n) throw new Error(`--n(${N})이 원본 행수(${n})보다 많습니다 — 슬라이스가 원본보다 클 수는 없습니다`);
  const out = [];
  for (let i = 0; i < N; i++) out.push(rows[Math.floor((i * n) / N)]);
  return out;
}

/**
 * 파일에 적히는 **정확한 바이트**. md5로 두 기계를 견주는 자리라 이 꼴이 곧 계약이다.
 * ⚠ 2칸 들여쓰기 · **끝에 줄바꿈 없음** — 회전 1·2의 `raft-vuln-v2-cal160.json`
 *   (md5 4939415652d08bad37a73dab82995544)이 이 꼴이었다. 줄바꿈 하나만 붙어도 md5가 달라져
 *   「두 기계의 파일이 같은가」를 못 가린다.
 */
export const 직렬화 = (행들) => JSON.stringify(행들, null, 2);

export const md5 = (s) => crypto.createHash("md5").update(Buffer.from(s, "utf8")).digest("hex");

/** 기본 산출 경로 — 원본 옆에 `<이름>-cal<N>.json`. 회전 1·2가 쓴 이름 규칙 그대로다. */
export function 기본산출경로(입력, N) {
  const dir = path.dirname(입력);
  const base = path.basename(입력).replace(/\.json$/i, "");
  return path.join(dir, `${base}-cal${N}.json`);
}

/** 글자수 분포 — 「슬라이스가 전체를 대표하는가」를 사람이 눈으로 보는 자리. */
export function 글자수분포(행들) {
  const 길이들 = 행들
    .map((r) => String(r?.system ?? "").length + String(r?.question ?? "").length + String(r?.answer ?? "").length)
    .sort((a, b) => a - b);
  // ⚠ 분위 자리는 **회전 2 보고서가 쓴 그 관례**(floor(q×N))로 맞춘다 — 관례를 바꾸면 같은 파일의
  //   p95가 4102와 4099로 갈려, 나중에 읽는 사람이 「어느 쪽이 맞나」를 헤맨다.
  const p = (q) => (길이들.length ? 길이들[Math.min(길이들.length - 1, Math.floor(q * 길이들.length))] : 0);
  return {
    평균: 길이들.length ? Math.round(길이들.reduce((s, x) => s + x, 0) / 길이들.length) : 0,
    p95: p(0.95),
    최대: 길이들[길이들.length - 1] ?? 0,
  };
}

// ── 직접 실행 ───────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  // 값을 받는 인자(--n·--out)의 **값 자리**를 건너뛰고 남는 첫 낱말이 입력 파일이다.
  //   (`--n 160` 의 160을 파일 이름으로 집는 실수를 안 하려고 손으로 센다.)
  const 값받는인자 = new Set(["--n", "--out"]);
  let 입력 = "";
  for (let i = 0; i < args.length; i++) {
    if (값받는인자.has(args[i])) { i += 1; continue; }
    if (args[i].startsWith("--")) continue;
    입력 = args[i];
    break;
  }

  if (!입력) {
    console.error("쓰는 법: node tools/ladder/make-cal-slice.mjs <데이터셋.json> [--n 160] [--out <경로>]");
    process.exit(2);
  }
  const N = Number(opt("--n", 160));
  if (!fs.existsSync(입력)) { console.error(`입력 파일이 없습니다: ${입력}`); process.exit(2); }

  let 원본;
  try { 원본 = JSON.parse(fs.readFileSync(입력, "utf8")); }
  catch (e) { console.error(`JSON을 읽지 못했습니다(${입력}): ${e.message}`); process.exit(2); }
  // ⚠ 최상위가 **행 배열**인 꼴만 받는다(빌더·긴형식 생성기가 내는 꼴). {rows:[…]}를 슬쩍 받아 주면
  //   딴 꼴의 파일도 통과해 md5 계약이 흐려진다 — 모르는 꼴은 여기서 죽는다.
  if (!Array.isArray(원본)) { console.error(`최상위가 행 배열이 아닙니다(${입력}) — 학습 재료 파일이 맞습니까?`); process.exit(2); }

  let 뽑은;
  try { 뽑은 = 슬라이스(원본, N); }
  catch (e) { console.error(String(e.message)); process.exit(2); }

  const 산출 = String(opt("--out", 기본산출경로(입력, N)));
  const 글 = 직렬화(뽑은);
  fs.mkdirSync(path.dirname(path.resolve(산출)), { recursive: true });
  fs.writeFileSync(산출, 글, "utf8");

  const 전 = 글자수분포(원본), 후 = 글자수분포(뽑은);
  console.log(`[cal-slice] ${입력} ${원본.length}행 → ${산출} ${뽑은.length}행`);
  console.log(`[cal-slice] md5 ${md5(글)}  (${Buffer.byteLength(글, "utf8")} 바이트)`);
  console.log(`[cal-slice] 글자수 슬라이스 평균 ${후.평균} / p95 ${후.p95} / 최대 ${후.최대}` +
    `  ←→ 전체 평균 ${전.평균} / p95 ${전.p95} / 최대 ${전.최대}  (닮았는지 눈으로 볼 것)`);
  console.log(`[cal-slice] 식: rows[⌊i×${원본.length}/${N}⌋], i=0…${N - 1} (균등 간격 — 앞 ${N}행을 자르면 승인 순서 쏠림이 실린다)`);
}
