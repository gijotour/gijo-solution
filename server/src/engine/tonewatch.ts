// engine/tonewatch.ts — 담당자에게 **실제로 나간 답**이 말투 규범을 지켰는지 기록한다.
//
// 왜 필요한가: 지금까지 말투 감시는 **시험에서만** 돌았다. 시험은 내가 넣은 답만 본다 —
//   내일 새로 쓰는 답, 모델이 다시 쓴 답, 아직 안 가 본 화면의 답은 아무도 안 본다.
//   실전 147건으로 **오탐 0**을 확인했으니(2026-08-03) 이제 실제 답에 대고 잴 수 있다.
//
// ⚠⚠ **막지 않는다. 기록만 한다.**
//   오탐 하나로 답이 통째로 막히면 담당자는 아무것도 못 받는다 — 놓치는 것보다 나쁘다.
//   여기서 하는 일은 "봐야 할 것이 생겼다"를 남기는 것뿐이고, 막을지는 **한 주 지켜본 뒤**
//   사람이 정한다. 자동으로 막는 쪽으로 넘어가지 않는다.
//
// ⚠ 기록은 **서버 메모리 안에만** 둔다. 답 원문에는 자산 이름·취약점이 들어 있어
//   파일로 남기면 그 자체가 유출 경로가 된다. 재시작하면 사라지는 것이 맞다.

import { 말투위반 } from "./tone";

export interface 말투기록 {
  때: number;
  물음: string;      // 앞부분만 — 무엇을 묻다 그랬는지 알 정도로만
  어긴것: string[];  // 규범 항목 이름
  답조각: string;    // 어디가 걸렸는지 보이는 만큼만
}

const 보관상한 = 200;   // 최근 것만 — 무한히 쌓아 메모리를 먹지 않는다
const 기록: 말투기록[] = [];
let 잰답수 = 0;

/**
 * 나가는 답 하나를 잰다. **돌려주는 값이 없다** — 이 함수는 답을 바꾸지 않는다.
 *
 * ⚠ 여기서 예외가 나면 답이 안 나간다. 감시가 제품을 죽이는 것은 말이 안 되므로 통째로 감싼다.
 */
export function 말투재기(물음: string, 답: string): void {
  try {
    const t = String(답 ?? "");
    if (!t.trim()) return;
    잰답수++;
    const v = 말투위반(t);
    if (!v.length) return;
    const 조각 = 걸린조각(t, v[0].이름);
    기록.push({
      때: Date.now(),
      물음: String(물음 ?? "").slice(0, 40),
      어긴것: v.map((x) => x.이름),
      답조각: 조각,
    });
    if (기록.length > 보관상한) 기록.splice(0, 기록.length - 보관상한);
  } catch {
    /* 감시가 답을 막으면 안 된다 */
  }
}

/** 걸린 자리가 보이게 앞뒤를 조금 붙여 잘라 준다. 못 찾으면 첫머리를 준다. */
function 걸린조각(답: string, 이름: string): string {
  const 한줄 = (s: string) => s.replace(/\s+/g, " ").trim();
  // 기호 위반은 이름에 그 기호가 들어 있다 — 그 자리를 보여 준다.
  const 기호 = /[^\s]$/.test(이름) ? 이름.split(" ").pop() ?? "" : "";
  if (기호 && 답.includes(기호)) {
    const i = 답.indexOf(기호);
    return 한줄(답.slice(Math.max(0, i - 30), i + 40));
  }
  return 한줄(답.slice(0, 70));
}

export function 말투현황(): { 잰답: number; 위반: number; 최근: 말투기록[]; 항목별: { 이름: string; 건수: number }[] } {
  const 셈 = new Map<string, number>();
  for (const r of 기록) for (const n of r.어긴것) 셈.set(n, (셈.get(n) ?? 0) + 1);
  return {
    잰답: 잰답수,
    위반: 기록.length,
    최근: 기록.slice(-10).reverse(),
    항목별: [...셈.entries()].map(([이름, 건수]) => ({ 이름, 건수 })).sort((a, b) => b.건수 - a.건수),
  };
}

/** 자가 진단 한 줄. **막지 않는 감시라는 것을 문구에 분명히 적는다** — 안 그러면 왜 안 막냐고 묻게 된다. */
export function 말투현황줄(): string | null {
  if (잰답수 === 0) return null;
  const s = 말투현황();
  if (s.위반 === 0) return `말투 규범 — 최근 답 ${s.잰답}건 모두 지킴`;
  const 앞 = s.항목별.slice(0, 3).map((x) => `${x.이름} ${x.건수}`).join(" · ");
  return `말투 규범 — 최근 답 ${s.잰답}건 중 ${s.위반}건이 규범을 벗어났습니다 (${앞}). 답은 막지 않고 기록만 합니다.`;
}

/** 시험용 — 기록을 비운다. */
export function resetToneWatchForTests(): void {
  기록.length = 0;
  잰답수 = 0;
}
