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
//   로그 파일 이름만 본다. 내용은 안 읽는다 — 「돌았는가」와 「통과했는가」는 다른 물음이고,
//   여기는 앞의 것만 맡는다.
//
// ■ 두 패스를 따로 센다 (2026-09-12 설계관 실측 ①)
//   nightly-ops-sim.ps1이 2026-09-11 밤부터 1차(운영 4000, ops-sim-nightly-YYYYMMDD.log)에
//   이어 2차(고객 QA 4100, ops-sim-4100-nightly-YYYYMMDD.log)를 돌린다. 옛 정규식
//   `^ops-sim-nightly-(\d{8})\.log$`은 "ops-sim-4100-nightly-..." 앞의 "-4100"이 끼면서 통째로
//   안 걸려 **2차 패스는 결석 감시 밖**이었다 — 몇 주를 쉬어도 아무도 몰랐을 것이다. 아래에서
//   패스별로 따로 세되, 4100 패스는 **첫 회차(2026-09-12) 이전을 결석으로 안 친다** — 회차가
//   하나도 없으면 「기록이 없다」로만 말하고(빈날=null), 게시 관문도 그 상태를 결석으로 안 막는다
//   (실제 파일에 있는 가장 이른 날짜가 자연히 그 기준이 된다 — 있지도 않던 시절을 셀 도리가 없다).

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const 로그폴더 = (뿌리) => join(뿌리, ".tmp-reports");

// 패스별 로그 이름 규칙 — 4100 패스는 "-4100"이 끼고, 4000(운영)은 그게 없다.
// 하나의 정규식으로 읽되(캡처① = "-4100" 유무, 캡처② = 날짜) 패스별로 걸러 낸다.
const 회차파일_RE = /^ops-sim(-4100)?-nightly-(\d{8})\.log$/;
const 알려진패스 = ["4000", "4100"];

/** 로그 파일들에서 회차 날짜(YYYYMMDD 숫자)를 오름차순으로 뽑는다. 패스: "4000"(운영, 기본) | "4100"(고객 QA). */
export function 회차들(뿌리 = process.cwd(), 패스 = "4000") {
  const d = 로그폴더(뿌리);
  if (!existsSync(d)) return [];
  const is4100 = 패스 === "4100";
  return readdirSync(d)
    .map((f) => 회차파일_RE.exec(f))
    .filter((m) => m && Boolean(m[1]) === is4100)
    .map((m) => Number(m[2]))
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
 * @param 패스 "4000"(운영, 기본) | "4100"(고객 QA) — 회차 파일을 어느 패스로 셀지.
 */
export function 결석현황(뿌리 = process.cwd(), 오늘 = null, 패스 = "4000") {
  const 회 = 회차들(뿌리, 패스);
  if (!회.length) {
    const 이름 = 패스 === "4100" ? "고객 QA(4100)" : "운영(4000)";
    // ⚠ 회차가 아예 없는 것은 "결석"이 아니라 "아직 시작 전"이다 — 4100 패스는 2026-09-12
    //   첫 회차라 그 이전엔 로그가 없는 게 정상이고, 빈날을 null로 두어 게시 관문이 이 상태를
    //   결석으로 오판해 막지 않게 한다(막을 근거가 되는 "지난 회차"가 아예 없다).
    return { 회차수: 0, 마지막: null, 빈날: null, 결석구간: [], 문장: `${이름} 회차 기록이 없습니다 — 야간 루틴이 한 번도 안 돌았거나 로그 폴더가 비어 있습니다.` };
  }
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

// 직접 실행하면 사람이 읽는 꼴로 낸다 — 2026-09-12부터 **두 패스를 각각** 보고한다.
if (process.argv[1] && process.argv[1].endsWith("nightly-gap.mjs")) {
  let 위험 = false;
  for (const 패스 of 알려진패스) {
    const r = 결석현황(process.cwd(), null, 패스);
    const 라벨 = 패스 === "4100" ? "2차·고객 QA 4100" : "1차·운영 4000";
    console.log(`\n  🌙 야간 회귀 결석 점검 [${라벨}] — 회차 ${r.회차수}개`);
    console.log(`  ${r.문장}`);
    if (r.결석구간.length) {
      console.log(`\n  지난 결석 ${r.결석구간.length}건:`);
      for (const g of r.결석구간) console.log(`     · ${g.앞} 다음이 ${g.뒤} — ${g.뜬날}일 결석`);
    } else if (r.회차수) {
      console.log("  ✓ 지난 회차 사이에 빠진 날이 없습니다.");
    }
    // 오늘까지 이틀 넘게 안 돌았으면 실패로 알린다 — 하루는 시차·기계 꺼짐으로 흔하다.
    // 빈날이 null(아직 한 번도 안 돈 패스)이면 결석이 아니라 "시작 전"이라 안 건다.
    if (r.빈날 !== null && r.빈날 > 2) 위험 = true;
  }
  console.log("");
  if (위험) process.exitCode = 1;
}
