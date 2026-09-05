// 숫자 접지 관문 — **맨몸 숫자가 원천에 있나** (2026-09-06 · 계획서 전-4)
//
// ■ 무엇을 지키나
//   2026-09-06 사고: 「보안 교육 이수율은 82.3%입니다 · 작년 대비 12.5% 증가 · 36.4%」가
//   경고 하나 없이 나갔다. 세 숫자는 chat_logs 5,998행·운영 문서 전수에 **0건**이다.
//   인용 가드(guardCitations)는 **인용 표지가 붙은 것**만 보므로 이 꼴을 원리상 못 본다.
//
// ■ 이 시험이 재는 두 방향 (한쪽만 재면 반드시 다른 쪽이 무너진다)
//   ① 적발 — 사고 문장이 「없음」으로 잡히는가
//   ② 오탐 — **규정 숫자**(신고 72시간·보관 3년·과징금 3%)와 **세어 온 숫자**가 안 잡히는가.
//      오탐이 나면 참인 숫자에 「모델 추정치」 회색이 칠해진다 — 없던 거짓말이 새로 생긴다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 숫자가원천에있나, 실적수치뽑기, 실적수치제외_RE, guardCitations } from "../src/engine/citeguard";
import { 숫자무근거배너, 근거없음종류판정 } from "../src/engine/noevidence";

describe("★ 뽑기 — 무엇을 수치로 보나", () => {
  it("백분율을 뽑는다(사고 문장 그대로)", () => {
    const 답 = "보안 교육 이수율은 82.3%입니다. 작년 대비 12.5% 증가했고, 부서별 편차는 36.4%입니다.";
    expect(실적수치뽑기(답)).toEqual(["82.3", "12.5", "36.4"]);
  });

  it("기호 없는 「…율/률 + 맨수」도 뽑는다", () => {
    expect(실적수치뽑기("조치 완료율은 74로 집계됩니다.")).toEqual(["74"]);
  });

  it("★ 세는 숫자는 **안 뽑는다** — 도구가 세어 온 값에 회색을 칠하면 새 거짓말이 된다", () => {
    // 실전 답 152건 실측(2026-09-06)에서 「도구 없이 답했는데 건/명/개가 든 답」이 7건이고
    // 그 속살이 전부 대장 집계였다(취약점 202건·중복 문서 3798건 …). 그래서 셈은 후보가 아니다.
    expect(실적수치뽑기("활성 취약점 202건 중 조치 대기 18건, 담당자 5명입니다.")).toEqual([]);
    expect(실적수치뽑기("3가지 방법이 있고 7개 항목을 점검합니다.")).toEqual([]);
  });

  it("★ 식별자·날짜·판번호는 안 뽑는다 — 화면(chatparts)이 안 옅게 하는 것과 같은 목록", () => {
    const 답 = "CVE-2024-21762(CVSS 9.8)은 2026-09-05에 확인했고 TLS 1.3·ISO 27001과 무관합니다. 14:22:05 기준 5.83.0입니다.";
    expect(실적수치뽑기(답)).toEqual([]);
  });

  it("★ 제외 목록이 화면(chatparts.js 추정치제외_RE)과 **글자 그대로 같다**", () => {
    // .js와 .ts라 상수를 함께 쓸 수 없어 복제했다 — 어긋나면 배너와 회색이 딴말을 한다.
    const parts = fs.readFileSync(
      path.join(__dirname, "../../client/src/renderer/pages/chatparts.js"), "utf8");
    const m = /var 추정치제외_RE = (\/.+\/)([gimsuy]*);/.exec(parts);
    expect(m, "chatparts.js에서 추정치제외_RE를 못 찾았다 — 이름이 바뀌었으면 citeguard도 함께 볼 것").toBeTruthy();
    expect(`/${실적수치제외_RE.source}/`).toBe(m![1]);
    expect(실적수치제외_RE.flags.split("").sort().join("")).toBe(m![2].split("").sort().join(""));
  });
});

describe("★ 대조 — 원천에 있나", () => {
  const 조각 = [
    "2026년 상반기 취약점 조치 완료율은 74.2%로 집계되었으며, 전분기 대비 3.1%p 상승했다.",
    "개인정보 유출 사고는 인지한 때부터 72시간 이내에 신고해야 하며, 접근기록은 3년간 보관한다.",
    "과징금은 전체 매출액의 3% 이하로 부과할 수 있다.",
  ];

  it("★ 옛 관문(인용 가드)은 이 사고를 **원리상 못 본다** — 그래서 이 파일이 생겼다", () => {
    const 사고답 = "보안 교육 이수율은 82.3%입니다. 작년 대비 12.5% 증가했고, 부서별 편차는 36.4%입니다.";
    const g = guardCitations(사고답, 조각);
    expect(g.removed, "인용 표지가 없으니 뗄 것이 없다 — 계수기에는 「지어낸 인용 0」으로 남는다").toEqual([]);
    expect(g.text).toBe(사고답);
    // 같은 답을 숫자 접지로 보면 세 숫자가 전부 원천에 없다.
    expect(숫자가원천에있나(사고답, 조각).없는것).toEqual(["82.3", "12.5", "36.4"]);
  });

  it("★ 사고 문장 2건 — 원천에 없으니 「없음」", () => {
    const r1 = 숫자가원천에있나("보안 교육 이수율은 82.3%입니다. 작년 대비 12.5% 증가했습니다.", 조각);
    expect(r1.판정).toBe("없음");
    expect(r1.없는것).toEqual(["82.3", "12.5"]);
    const r2 = 숫자가원천에있나("부서별 편차는 36.4% 수준으로 보입니다.", 조각);
    expect(r2.판정).toBe("없음");
  });

  it("★ 규정 숫자 3건 — 조각에 그대로 있으니 「있음」(오탐의 반대편)", () => {
    // 신고 72시간·보관 3년은 애초에 후보가 아니고(시간·년 단위), 과징금 3%는 후보인데 조각에 있다.
    expect(숫자가원천에있나("신고는 72시간 이내, 접근기록은 3년 보관입니다.", 조각).판정).toBe("해당없음");
    expect(숫자가원천에있나("과징금은 매출액의 3% 이하입니다.", 조각).판정).toBe("있음");
    expect(숫자가원천에있나("조치 완료율은 74.2%입니다.", 조각).판정).toBe("있음");
  });

  it("★ 표 꼴 원천도 대조된다 — 공백·자리수 쉼표를 지우고 본다", () => {
    const 표조각 = ["| 항목 | 값 |\n| 조치율 | 8 2 . 5 % |\n| 대상 | 1,200 |"];
    expect(숫자가원천에있나("조치율은 82.5%입니다.", 표조각).판정).toBe("있음");
  });

  it("★ 하나라도 있으면 「있음」 — 참인 숫자까지 회색이 되지 않게(문서화된 한계)", () => {
    // ⚠ 이것이 **지금 못 잡는 부류**다: 넷은 문서에 있고 하나만 지어낸 답. 화면은 표식 하나로
    //   답 전체를 옅게 그리므로, 여기서 「없음」을 내면 참인 숫자 넷이 추정치로 보인다.
    //   제대로 닫으려면 표식에 **범위**를 실어야 한다(noevidence.ts 복합 지시 공백과 같은 숙제).
    const r = 숫자가원천에있나("조치 완료율 74.2%이고 교육 이수율은 82.3%입니다.", 조각);
    expect(r.판정).toBe("있음");
    expect(r.없는것).toEqual(["82.3"]);
  });

  it("조각을 안 준 자리(RAG 미실행)에서는 판정하지 않는다 — 모르는 것을 단정하지 않는다", () => {
    expect(숫자가원천에있나("이수율은 82.3%입니다.", null).판정).toBe("해당없음");
    expect(숫자가원천에있나("이수율은 82.3%입니다.", undefined).판정).toBe("해당없음");
  });

  it("추가 원천(온톨로지·용어 정의·📎 첨부)도 함께 본다", () => {
    expect(숫자가원천에있나("가동률은 99.9%입니다.", [], ["SLA 목표 가동률 99.9% 이상"]).판정).toBe("있음");
  });
});

describe("★ 배선 — 배너를 붙이는 자리와 읽는 자리", () => {
  const llm = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");

  it("llm.ts가 **강함일 때만** 붙인다 — 자료없음·약한근거만은 제 배너가 이미 있다", () => {
    expect(llm).toMatch(/if \(ragResult && !ragResult\.자료없음 && !ragResult\.약한근거만 && reply\)/);
    expect(llm, "판정을 llm이 직접 하고 있다 — 잣대는 citeguard 한 곳").toContain("숫자가원천에있나(reply,");
  });

  it("배너 문구를 llm.ts에 다시 적지 않는다 — 주인은 noevidence.ts 하나", () => {
    expect(llm.includes("사내 자료에 없는 수치")).toBe(false);
  });

  it("붙은 배너를 표식 판정기가 읽는다 — 화면이 숫자를 옅게 그릴 수 있다", () => {
    expect(근거없음종류판정(`${숫자무근거배너}\n\n이수율은 82.3%입니다.`)).toBe("숫자무근거");
  });

  it("★ 배너 문구가 폴백 목록(FAIL_MARKS)과 안 겹친다 — 좋은 답에 실패 딱지가 붙지 않게", () => {
    const audit = fs.readFileSync(path.join(__dirname, "../../tools/drawer-audit.mjs"), "utf8");
    const 목록 = [...audit.slice(audit.indexOf("const FAIL_MARKS"), audit.indexOf("];", audit.indexOf("const FAIL_MARKS")))
      .matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(목록.length, "FAIL_MARKS를 못 읽었다").toBeGreaterThan(5);
    for (const 말 of 목록) expect(숫자무근거배너.includes(말), `배너에 폴백 문구가 들어 있다: ${말}`).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ **실전 답 기록**으로 오탐을 잰다 — 내가 고른 예문으로 재면 내 그물에 걸리는 것만 고른다.
//   (citeguard.test·tone-realanswers·noevidence-mark과 같은 재료를 같은 방식으로 쓴다.)
const 기록 = path.join(__dirname, "../../.tmp-reports/ops-sim.json");
const 답들: { q: string; out: string; 도구: string[] }[] = (() => {
  if (!fs.existsSync(기록)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(기록, "utf8"));
    return (Array.isArray(j) ? j : j.results || [])
      .map((x: any) => ({ q: String(x.q ?? ""), out: String(x.out ?? ""), 도구: x.도구 ?? [] }))
      .filter((x: { out: string }) => x.out.trim().length > 0);
  } catch { return []; }
})();

describe("★ 실전 답 기록 — 오탐(세어 온 숫자를 추정치라 부르기)이 0인가", () => {
  it.skipIf(답들.length < 50)("★ 도구 답에도 백분율이 있다 — 그래서 이 관문은 **경로로** 막는다", () => {
    // ⚠ 실측(2026-09-06): 도구가 돈 답 7건에서 백분율이 뽑힌다 —
    //     「우리 보안 점수 어때?」(0·100·48) · 「시스템 자가 진단 해줘」(73) · 「AI가 아낀 시간」(20) …
    //   전부 **코드가 계산한 값**이다. 여기에 「모델 추정치」 배너가 붙으면 없던 거짓말이 생긴다.
    // → 그래서 안전을 「뽑기가 안 걸린다」로 지키지 않는다(못 지킨다). **경로**로 지킨다:
    //   배너는 llm.ts의 RAG 자유 답(remember:true)에서만 붙고, 도구 답 합성은 remember를 꺼
    //   ragResult가 null이라 그 if 안에 못 들어온다. 위 「배선」 describe가 그 조건을 글자로 지킨다.
    //   이 시험은 **위험이 실재함**을 숫자로 남겨, 조건을 무심코 넓히는 사람이 대가를 먼저 읽게 한다.
    const 걸린것 = 답들.filter((a) => a.도구.length && 실적수치뽑기(a.out).length);
    console.log(`[숫자접지] 도구가 돈 답 중 백분율이 든 답 ${걸린것.length}건 — ` +
      걸린것.map((a) => `${a.q.slice(0, 16)}(${실적수치뽑기(a.out).join(",")})`).join(" · "));
    expect(걸린것.length, "재료가 바뀌었나 — 이 위험이 사라졌다면 위 주석도 함께 고칠 것").toBeGreaterThan(0);
  });

  it.skipIf(답들.length < 50)("전체 152건 중 후보가 뽑히는 답은 극소수다 — 관문이 닿는 범위를 숫자로 남긴다", () => {
    const 뽑힌 = 답들.filter((a) => 실적수치뽑기(a.out).length);
    // ⚠ 「0이어야 한다」가 아니다 — 백분율을 말한 답이 실제로 있다(그 답들이 이 관문의 대상이다).
    //   기록해 두는 이유는 다음 사람이 **범위를 넓힐 때 대가를 알고** 넓히도록 하려는 것이다.
    console.log(`[숫자접지] 실전 ${답들.length}건 중 후보 있는 답 ${뽑힌.length}건 — ` +
      뽑힌.map((a) => `${a.q.slice(0, 18)}(${실적수치뽑기(a.out).join(",")})`).join(" · "));
    expect(뽑힌.length).toBeLessThanOrEqual(Math.ceil(답들.length * 0.1));
  });
});
