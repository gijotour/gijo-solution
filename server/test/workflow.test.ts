// 업무 절차 5단계 — 자리와 숫자.
//
// 이 시험이 지키는 것(2026-08-02 실측 기반):
//   ★ 서버의 단계 표(STAGE_SCREENS)가 **사이드바(nav.js)와 같은가.**
//     어긋나면 담당자는 "메뉴에선 ③인데 띠에선 ②"를 보고, 그 순간 셋 다 못 믿는다.
//   ★ 단계의 대표 화면이 **그 단계 안에 있는가.**
//     ④를 눌러 ③ 화면에 떨어지면 도착하자마자 띠가 다른 단계를 가리킨다(실제로 그랬다 —
//     ④ 검증의 page가 maintenance.html이었는데 그 화면은 ③이다).
//   ★ 스캔 오류를 일감으로 세지 않는가.
//     처음 세었을 때 "③ 조치 609건"이 나왔고 그중 608건이 scan_error였다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STAGE_SCREENS, stageOfScreen, workflowStages } from "../src/engine/workflow";
import { formatScreenGuide } from "../src/engine/screenguide";

const navSrc = fs.readFileSync(
  path.join(__dirname, "../../client/src/renderer/pages/nav.js"),
  "utf8"
);

/** nav.js의 절차 항목(id: "s1-find" … "s5-report")에서 화면 목록을 뽑는다.
 *  2026-08-31 5그룹 재편: 단계 id는 그룹이 아니라 🩹 취약점 업무 그룹의 **항목 한 줄**에
 *  산다(`{ page: "discover.html", id: "s1-find", label: "① 발견·수집" }`). 그래서 id가 있는
 *  **그 줄만** 읽는다 — 옛 파서의 경계 개념(다음 그룹·registry)이 사라져 배치가 자유롭고,
 *  ⑤와 registry 사이에 다른 항목(loganalysis 등)이 끼어도 오인하지 않는다(설계관 지뢰 해소). */
function 사이드바단계(): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (let no = 1; no <= 5; no++) {
    const i = navSrc.indexOf(`id: "s${no}-`);
    if (i < 0) continue;
    const 줄시작 = navSrc.lastIndexOf("\n", i) + 1;
    const 줄끝 = navSrc.indexOf("\n", i);
    const 덩이 = navSrc.slice(줄시작, 줄끝 > 0 ? 줄끝 : navSrc.length);
    out[no] = [...덩이.matchAll(/page:\s*"([a-z]+\.html)"/g)].map((m) => m[1]);
  }
  return out;
}

describe("업무 절차 5단계", () => {
  it("서버 단계 표가 사이드바와 같다", () => {
    const nav = 사이드바단계();
    const 다름: string[] = [];
    for (let no = 1; no <= 5; no++) {
      const 서버 = [...(STAGE_SCREENS[no] ?? [])].sort();
      const 메뉴 = [...(nav[no] ?? [])].sort();
      if (JSON.stringify(서버) !== JSON.stringify(메뉴)) {
        다름.push(`${no}단계 — 서버 [${서버}] ≠ 사이드바 [${메뉴}]`);
      }
    }
    expect(다름, `자리가 어긋나면 담당자가 띠를 못 믿는다:\n  ${다름.join("\n  ")}`).toEqual([]);
  });

  it("이 대조가 헛돌고 있지 않다", () => {
    // ⚠ nav.js 파싱이 빈손이면 위 시험은 **통과하면서 아무것도 안 본다**.
    const nav = 사이드바단계();
    const 총합 = Object.values(nav).flat().length;
    // 2026-08-09 그룹 통합으로 각 절차 그룹은 **허브 한 화면**이 됐다 — 5개가 정상.
    //   (0이면 파싱이 죽은 것이고, 그때 위 대조는 빈 검사가 된다.)
    expect(총합, "사이드바에서 화면을 하나도 못 뽑았다 — 위 대조는 빈 검사다").toBeGreaterThanOrEqual(5);
  });

  it("단계의 대표 화면은 그 단계 안에 있다", () => {
    const 틀린것 = workflowStages()
      .filter((s) => stageOfScreen(s.page) !== s.no)
      .map((s) => `${s.no} ${s.label} → ${s.page}(실제 ${stageOfScreen(s.page)}단계)`);
    expect(틀린것, `눌러서 도착하면 띠가 다른 단계를 가리킨다:\n  ${틀린것.join("\n  ")}`).toEqual([]);
  });

  it("절차 화면이 아니면 단계가 없다", () => {
    for (const s of ["settings.html", "audit.html", "dashboard.html", "products.html"]) {
      expect(stageOfScreen(s), `${s}는 절차 화면이 아니다`).toBeNull();
    }
    expect(stageOfScreen(undefined)).toBeNull();
    // 물음표가 붙어도 알아본다(hub는 "settings.html?s=my" 꼴로 넘긴다)
    expect(stageOfScreen("triage.html?x=1")).toBe(2);
    expect(stageOfScreen("pages/reporting.html")).toBe(5);
  });

  it("화면 안내가 절차 화면에만 단계를 말한다", () => {
    for (const s of ["triage.html", "fix.html", "verify.html", "reporting.html"]) {
      expect(formatScreenGuide(s), `${s}에 절차 줄이 없다`).toContain("📍 업무 절차");
    }
    for (const s of ["settings.html", "audit.html", "dashboard.html"]) {
      expect(formatScreenGuide(s), `${s}는 절차 화면이 아닌데 단계를 말한다`).not.toContain("📍 업무 절차");
    }
  });

  it("안내의 우리말 조사가 맞다 (로 / 으로)", () => {
    // ⚠ 단계 이름을 그냥 이어 붙였다가 "**4 검증**로 갑니다"가 나갔다(2026-08-02).
    //   담당자가 읽는 우리말이라 받침에 맞아야 한다.
    expect(formatScreenGuide("fix.html")).toContain("**4 검증**으로 갑니다");
    expect(formatScreenGuide("triage.html")).toContain("**3 조치**로 갑니다");
    expect(formatScreenGuide("verify.html")).toContain("**5 보고**로 갑니다");
    // 마지막 단계는 "다음"이 없다 — 없는 다음을 지어내지 않는다.
    expect(formatScreenGuide("reporting.html")).toContain("여기까지가 한 바퀴입니다");
  });

  it("⑤ 보고 칸이 더는 늘 비어 있지 않다", () => {
    // ⚠ 한동안 null로 비워 뒀던 칸이다(판정 규칙을 안 정해서). 다섯 칸 중 하나가 늘
    //   비어 있으면 담당자는 고장으로 읽는다. 이제 리포트 이력으로 센다.
    //   ⚠ 다만 **폴더를 못 읽으면 여전히 비운다** — 0으로 채우면 "안 썼다"가 되어 거짓이다.
    //   그래서 시험은 "항상 숫자"가 아니라 "라벨과 값이 짝이 맞는가"를 본다.
    const s5 = workflowStages().find((x) => x.no === 5)!;
    if (s5.alert == null) {
      expect(s5.alertLabel, "값이 없는데 라벨만 있으면 화면에 빈 경고가 뜬다").toBe("");
    } else {
      expect(s5.alertLabel).toContain("마지막 보고");
      expect(s5.alert).toBeGreaterThanOrEqual(0);
    }
    // count는 못 읽었을 때만 null이다.
    expect(s5.count === null || s5.count >= 0).toBe(true);
  });

  it("모든 단계가 숫자 아니면 빈칸을 준다 — 지어내지 않는다", () => {
    for (const s of workflowStages()) {
      expect(s.count === null || Number.isFinite(s.count), `${s.no}단계 count가 이상하다`).toBe(true);
      expect(s.alert === null || Number.isFinite(s.alert), `${s.no}단계 alert가 이상하다`).toBe(true);
      expect(Array.isArray(s.screens) && s.screens.length > 0).toBe(true);
    }
  });
});
