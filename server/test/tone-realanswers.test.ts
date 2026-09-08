// 말투 감시 ↔ **실제로 담당자에게 나간 답 전체** 대조.
//
// 왜 따로 두는가: tone.test.ts의 오탐 시험은 내가 골라 넣은 14건이다 — 내가 고른 표본으로 재면
//   내 그물에 안 걸리는 것만 고르게 된다. 여기서는 **실전 147상황이 남긴 답을 통째로** 넣는다.
//
// ⚠ 오탐이 놓침만큼 나쁘다. 정상 답을 위반으로 몰면 담당자는 답을 못 받는다.
//   그래서 이 시험의 기준은 **오탐 0**이다 — 하나라도 걸리면 감시를 고친다(제품이 아니라).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 말투위반 } from "../src/engine/tone";
// 건너뛸 사유 문구는 **한 곳**에 산다 — 파일마다 따로 적으면 어긋난다(2026-09-08).
import { 건너뛸사유 } from "../../tools/opssim-evidence.mjs";

const 기록 = path.join(__dirname, "../../.tmp-reports/ops-sim.json");

const 답들: { q: string; out: string }[] = (() => {
  if (!fs.existsSync(기록)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(기록, "utf8"));
    return (Array.isArray(j) ? j : j.results || [])
      .map((x: any) => ({ q: String(x.q ?? ""), out: String(x.out ?? "") }))
      .filter((x: any) => x.out.trim().length > 0);
  } catch {
    return [];   // 시뮬레이션이 쓰는 중이면 반쪽 JSON일 수 있다
  }
})();

// 실전 기록은 추적하지 않는 산출물이라 **없는 기계도 있고**, 시뮬레이션이 도는 중이면
// **쓰다 만 상태**다(실측: 147건짜리 파일이 11건까지 쓰인 순간에 걸렸다).
// 반쪽 기록으로는 "오탐 0"을 증명할 수 없다 — 그럴 땐 통과시키지 말고 **건너뛴다**.
// ⚠ 건너뜀은 화면에 skipped로 보인다. 조용히 통과시키는 것과 다르다.
const 잴수있음 = 답들.length >= 50;

// ⏭ **왜 건너뛰는지를 로그에 찍는다**(2026-09-08). skipped 한 글자만 보이면 다음 사람은
//   고장으로 읽고 재료를 옮기려 든다 — 그런데 gb10 사본에서 재료가 없는 것은 **일부러다**
//   (이 기록에 등급 C 사내 문답 조각이 평문으로 담겨 원격으로 안 내보낸다). 그 사실을 여기서 말한다.
const 사유 = 건너뛸사유(fs.existsSync(기록), 답들.length);
if (사유) console.log(`⏭ 말투 감시 — 실전 답 대조를 건너뜁니다 · ${사유}`);

describe.skipIf(!잴수있음)(`★ 말투 감시 — 실전 답변 ${답들.length}건으로 오탐 0`, () => {

  it("실전 답 전체가 말투 규범을 통과한다", () => {
    const 걸린것 = 답들
      .map((a) => ({ ...a, v: 말투위반(a.out) }))
      .filter((a) => a.v.length > 0);

    const 보고 = 걸린것
      .map((a) => `  「${a.q.slice(0, 30)}」\n    걸림: ${a.v.map((x) => x.이름).join(", ")}\n    답: ${a.out.replace(/\n/g, " ⏎ ").slice(0, 160)}`)
      .join("\n");

    // 걸린 것이 **오탐인지 진짜 위반인지**는 사람이 본다. 시험은 "봐야 할 것이 생겼다"만 알린다.
    expect(걸린것.length, `실전 답 ${답들.length}건 중 ${걸린것.length}건이 걸렸다 — 오탐인지 먼저 보라:\n${보고}`).toBe(0);
  });

  it("이 시험이 헛돌고 있지 않다", () => {
    // 기록 파일이 있는데 답이 몇 건 안 되면 위 시험은 아무것도 안 재고 통과한다.
    expect(답들.length, "실전 기록은 있는데 답을 못 읽었다").toBeGreaterThanOrEqual(50);
    // 그물이 살아 있는지도 확인한다 — 규범을 어긴 답은 반드시 걸려야 한다.
    expect(말투위반("취약점 현황을 정리해 드리겠습니다.").length).toBeGreaterThan(0);
  });
});
