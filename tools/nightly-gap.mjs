// tools/nightly-gap.mjs — 야간 회귀(152상황)가 **결석했는지** 센다.
//
// ■ 왜 (2026-08-31)
//   야간 회귀는 매일 03:00에 도는데, **08-25·08-26 두 밤을 건너뛰고도 아무도 몰랐다.**
//   로그가 20260824 다음 20260827로 뛰어 있는데 그것을 보는 눈이 없었기 때문이다.
//   같은 사고가 처음이 아니다 — nightly-ops-sim.ps1 머리 주석이 이미 「예전 예약이 세션과
//   함께 사라져 **이틀 결석**했다(마지막 08-12, 발견 08-14)」고 적어 두었다. 두 번째다.
//
// ■ 왜 감지가 어려운가
//   결석은 **아무 일도 안 일어나는 것**이라 스스로 알릴 수 없다. 그래서 두 곳에서 본다:
//   ① 다음 실행이 시작할 때 — 「지난번과 며칠 떴다」를 로그 첫 줄에 적는다.
//   ② 게시할 때 — 회귀 증거가 오래됐으면 게시를 막는다. **오래된 초록은 초록이 아니다.**
//
// ■ 판정
//   로그 파일 이름(ops-sim-nightly-YYYYMMDD.log)만 본다. 내용은 안 읽는다 —
//   「돌았는가」와 「통과했는가」는 다른 물음이고, 여기는 앞의 것만 맡는다.

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const 로그폴더 = (뿌리) => join(뿌리, ".tmp-reports");

/** 로그 파일들에서 회차 날짜(YYYYMMDD 숫자)를 오름차순으로 뽑는다. */
export function 회차들(뿌리 = process.cwd()) {
  const d = 로그폴더(뿌리);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .map((f) => /^ops-sim-nightly-(\d{8})\.log$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/** YYYYMMDD 숫자를 Date로(현지 자정). */
function 날짜로(n) {
  const s = String(n);
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

/** 두 회차 사이에 빠진 날 수. */
function 사이(a, b) {
  return Math.round((날짜로(b) - 날짜로(a)) / 86400000) - 1;
}

/**
 * 결석 현황.
 * @param 오늘 YYYYMMDD 숫자(안 주면 오늘). 시험이 고정값을 넣을 수 있게 인자로 받는다.
 */
export function 결석현황(뿌리 = process.cwd(), 오늘 = null) {
  const 회 = 회차들(뿌리);
  if (!회.length) return { 회차수: 0, 마지막: null, 빈날: null, 결석구간: [], 문장: "회차 기록이 없습니다 — 야간 루틴이 한 번도 안 돌았거나 로그 폴더가 비어 있습니다." };
  const 구간 = [];
  for (let i = 1; i < 회.length; i++) {
    const 뜬날 = 사이(회[i - 1], 회[i]);
    if (뜬날 > 0) 구간.push({ 앞: 회[i - 1], 뒤: 회[i], 뜬날 });
  }
  const 마지막 = 회[회.length - 1];
  const 기준 = 오늘 ?? Number(
    new Date().getFullYear().toString() +
    String(new Date().getMonth() + 1).padStart(2, "0") +
    String(new Date().getDate()).padStart(2, "0"),
  );
  const 빈날 = Math.max(0, 사이(마지막, 기준) + 1); // 마지막 회차 다음날부터 오늘까지
  const 문장 = 빈날 > 0
    ? `야간 회귀가 ${빈날}일째 안 돌았습니다 — 마지막 회차 ${마지막}.`
    : `야간 회귀 최신 회차 ${마지막} (오늘 기준 최신).`;
  return { 회차수: 회.length, 마지막, 빈날, 결석구간: 구간, 문장 };
}

// 직접 실행하면 사람이 읽는 꼴로 낸다.
if (process.argv[1] && process.argv[1].endsWith("nightly-gap.mjs")) {
  const r = 결석현황(process.cwd());
  console.log(`\n  🌙 야간 회귀 결석 점검 — 회차 ${r.회차수}개`);
  console.log(`  ${r.문장}`);
  if (r.결석구간.length) {
    console.log(`\n  지난 결석 ${r.결석구간.length}건:`);
    for (const g of r.결석구간) console.log(`     · ${g.앞} 다음이 ${g.뒤} — ${g.뜬날}일 결석`);
  } else {
    console.log("  ✓ 지난 회차 사이에 빠진 날이 없습니다.");
  }
  console.log("");
  // 오늘까지 이틀 넘게 안 돌았으면 실패로 알린다 — 하루는 시차·기계 꺼짐으로 흔하다.
  if (r.빈날 > 2) process.exitCode = 1;
}
