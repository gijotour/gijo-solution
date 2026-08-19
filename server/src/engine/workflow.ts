// engine/workflow.ts — 업무 절차 5단계의 「지금 몇 건인가」.
//
// 왜 서버인가(2026-08-02, 메뉴를 업무 절차로 재구성하며 신설):
//   화면마다 제 나름대로 세면 같은 단계인데 화면마다 숫자가 달라진다 — 담당자는 그 순간
//   숫자를 못 믿게 되고, 절차 띠는 장식이 된다. **세는 자리를 하나로** 둔다.
//
// ⚠ 숫자는 **규칙으로 계산**한다. LLM에 묻지 않는다 — 담당자가 이 숫자로 보고를 쓴다.
// ⚠ 못 구하는 값은 **비운다(null)**. 0으로 채우면 "없다"는 뜻이 되어 거짓이 된다.
//    화면은 null을 받으면 그 칸을 비워 둔다(지어내지 않는다).
// ⚠ 스캔 실패(scan_error)는 취약점이 아니다 — isRealVulnerability로 거른 뒤 센다.
//    이걸 빼먹어 "미조치 602건"이 뜬 적이 있다(실사고 2026-08-01, 실제 일감은 3건이었다).
import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { listAssets } from "./assets";
import { isRealVulnerability } from "./agenttools";
import { listFindingReviews } from "./approvals";
import { listTargets, listRuns } from "./hardeningtargets";
import { reportActivity } from "./report";

/**
 * 화면 → 절차 단계. **여기가 단 하나의 출처다.**
 *
 * 처음엔 절차 띠(client/workflowrail.js)가 제 지도를 들고 있었다. 그러면 사이드바(nav.js)와
 * 어긋나는 순간 담당자는 "메뉴에선 ③인데 띠에선 ②"를 보게 되고, 그 뒤로는 어느 쪽도 못 믿는다.
 * 숫자를 서버에서 한 번만 세는 것과 같은 이유로 **자리도 서버에서 한 번만 정한다**.
 * 띠도 화면 안내(screenguide)도 이 표를 받아 쓴다.
 *
 * ⚠ nav.js의 5개 절차 그룹과 **같아야 한다** — workflow.test.ts가 대조해 막는다.
 */
export const STAGE_SCREENS: Record<number, string[]> = {
  // 발견·수집은 허브 한 화면으로 통합됐다(2026-08-09) — 사이드바가 discover 하나이므로
  // 표도 하나다(감시 시험: 서버 표 = 사이드바). 개별 화면은 허브 무대 안에서만 열리고
  // 직접 주소는 nav.js가 허브로 흡수하므로 여기 남길 필요가 없다.
  1: ["discover.html"],
  2: ["triage.html"],
  3: ["fix.html"],
  4: ["verify.html"],
  5: ["reporting.html"],
};

/** 이 화면이 몇 단계인가. 절차 화면이 아니면 null(띠도 안 그리고 안내도 안 붙인다). */
export function stageOfScreen(screen?: string): number | null {
  if (!screen) return null;
  const key = screen.split(/[\\/]/).pop()?.split("?")[0] ?? "";
  for (const [no, list] of Object.entries(STAGE_SCREENS)) {
    if (list.includes(key)) return Number(no);
  }
  return null;
}

export interface WorkflowStage {
  no: number;
  key: string;
  label: string;
  /** 이 단계의 대표 숫자. 못 구하면 null — 화면은 빈칸으로 그린다. */
  count: number | null;
  /** 눈길을 끌어야 하는 값(지연·KEV 등). 0이면 화면이 죽여서 그린다. */
  alert: number | null;
  alertLabel: string;
  /** 이 단계에서 먼저 열 화면 */
  page: string;
  /** 이 단계에 속한 화면 전부. 띠가 "지금 여기"를 이걸로 판단한다(제 지도를 안 든다). */
  screens: string[];
}

/** 5단계 현황. 세는 규칙은 여기 한 곳에만 둔다. */
export function workflowStages(): WorkflowStage[] {
  const assets = listAssets();

  // ① 발견 — 우리가 아는 자산과 오늘 새로 들어온 것.
  const 오늘 = new Date().toISOString().slice(0, 10);
  const 오늘신규 = assets.filter((a) => String(a.lastScannedAt ?? "").slice(0, 10) === 오늘).length;

  // ② 우선순위 — **실제 취약점만** 센다. KEV는 "지금 악용 중"이라 따로 띄운다.
  let 취약 = 0, kev = 0;
  for (const a of assets) {
    for (const f of a.findings ?? []) {
      if (!isRealVulnerability(f)) continue;
      취약++;
      if ((f as { kev?: boolean }).kev) kev++;
    }
  }

  // ③ 조치 — 검토대장에서 진행 중인 것과 담당자가 없는 것.
  // ⚠ **스캔 오류를 일감으로 세지 않는다.** 처음엔 검토대장을 그대로 세어 "조치 609건"이
  //   나왔는데, 그중 602건이 scan_error였다(실측 2026-08-02). 담당자가 그 숫자를 보면
  //   밀린 일이 609건인 줄 알고 절망하지만 **실제 일감은 몇 건뿐**이다.
  //   같은 함정을 2026-08-01에 이미 겪었다("검토 대기 602건") — 두 번 밟지 않는다.
  // ⚠ 기본 상태가 "pending"이라 **아직 손 안 댄 것까지 진행 중으로 세면 안 된다** —
  //   ③ 조치는 "지금 굴러가는 일"이어야 하므로 in_progress만 센다.
  let 진행 = 0, 미배정 = 0;
  try {
    for (const r of listFindingReviews()) {
      if (!isRealVulnerability(r.finding)) continue;   // 스캔 오류는 취약점이 아니다
      if (r.status === "in_progress") 진행++;
      if (!r.assignee && r.status !== "approved" && r.status !== "rejected" && r.status !== "accepted") 미배정++; // 수용 건 제외 — approvals.ts와 같은 규칙(중3)
    }
  } catch { /* 대장을 못 읽어도 나머지 단계는 보여준다 */ }

  // ④ 검증 — 고친 것이 실제로 닫혔는지 다시 확인한 결과.
  //
  // ⚠ 처음엔 여기에 **점검서 승인 대기(유지보수)** 숫자를 넣었다. 그런데 그 일을 하는 화면은
  //   「정기 점검」이고 그 화면은 사이드바에서 **③ 조치**다. 그러면 띠에서 ④를 눌러 ③ 화면에
  //   떨어지고, 도착하자마자 띠가 "지금 ③"이라고 말한다 — 담당자는 그 순간 띠를 못 믿는다.
  //   단계의 숫자는 **그 단계의 화면에서 나온 것**이어야 한다. 그래서 보안설정 점검에서 센다.
  let 미확인: number | null = null, 실패항목: number | null = null;
  try {
    const targets = listTargets();
    const runs = listRuns(undefined, 500);
    const 점검한대상 = new Set(runs.map((r) => r.targetId));
    // 「아직 확인 안 된 것」 = 등록해 놓고 한 번도 점검을 안 돌린 대상.
    미확인 = targets.filter((t) => !점검한대상.has(t.id)).length;
    // 대상마다 **가장 최근** 결과의 실패 수를 더한다(옛 결과까지 더하면 고친 것이 계속 세어진다).
    const 최근: Record<string, number> = {};
    for (const r of runs) if (!(r.targetId in 최근)) 최근[r.targetId] = r.fail;   // listRuns는 최신순
    실패항목 = Object.values(최근).reduce((a, b) => a + b, 0);
  } catch { /* 못 구하면 비워 둔다 — 0으로 채우면 "없다"가 되어 거짓이다 */ }

  // ⑤ 보고 — 리포트 폴더를 읽는다. 못 읽으면 null이고, 그때는 칸을 비운다.
  const 보고 = reportActivity();

  // ⚠ page는 **STAGE_SCREENS의 그 단계 안에 있는 화면**이어야 한다 — 아니면 띠에서 눌러
  //   도착한 순간 띠가 다른 단계를 가리킨다. workflow.test.ts가 대조해 막는다.
  return [
    { no: 1, key: "find", label: "발견·수집", count: assets.length, alert: 오늘신규, alertLabel: "오늘 신규", page: "discover.html", screens: STAGE_SCREENS[1] },
    { no: 2, key: "triage", label: "우선순위", count: 취약, alert: kev, alertLabel: "실제 악용(KEV)", page: "triage.html", screens: STAGE_SCREENS[2] },
    { no: 3, key: "fix", label: "조치", count: 진행, alert: 미배정, alertLabel: "미배정", page: "fix.html", screens: STAGE_SCREENS[3] },
    { no: 4, key: "verify", label: "검증", count: 실패항목, alert: 미확인, alertLabel: "미점검 대상", page: "verify.html", screens: STAGE_SCREENS[4] },
    // ⑤ 보고 — 이번 주 쓴 보고서 수와 마지막 보고 후 지난 날수(2026-08-02 규칙 확정).
    //    ⚠ 한동안 비워 뒀던 칸이다. 다섯 칸 중 하나가 늘 비어 있으면 담당자는 고장으로 읽는다.
    //    ⚠ 못 읽으면 여전히 **비운다** — 0으로 채우면 "안 썼다"가 되어 거짓이다.
    { no: 5, key: "report", label: "보고", count: 보고?.thisWeek ?? null, alert: 보고?.daysSinceLast ?? null, alertLabel: 보고?.daysSinceLast == null ? "" : "마지막 보고 후(일)", page: "reporting.html", screens: STAGE_SCREENS[5] },
  ];
}

export function registerWorkflowRoutes(app: Express): void {
  app.get("/api/workflow/stages", authMiddleware, (_req, res) => {
    res.json({ stages: workflowStages() });
  });
}
