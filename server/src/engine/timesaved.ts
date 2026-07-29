// engine/timesaved.ts — "AI가 아낀 시간" (계획서 중-2).
//
// 무엇을 하나: 작업 원장(worklog.ts)에 실제로 쌓인 자동화 처리 건수에 **작업 종류별 기준시간**을
// 곱해 "담당자가 손으로 했다면 걸렸을 시간"을 낸다. 임원 보고(report.ts)에 자동으로 실린다.
//
// 이 기능의 위험은 기술이 아니라 **신뢰**다. 보안 구매자는 부풀린 ROI를 가장 먼저 알아챈다
// (계획서 전-6 정직 경계). 그래서 다음을 코드 수준에서 강제한다:
//   1) 근거 없는 숫자 금지 — 모든 기준시간에 출처(source)가 붙는다. 타입이 요구하므로 뺄 수 없다.
//   2) 가정을 숨기지 않는다 — 응답·화면·보고서에 "무엇에 몇 분을 곱했는지"를 항상 함께 낸다.
//   3) 조직이 고칠 수 있다 — 기준시간은 app_state에 저장되며 담당자가 자기 조직 값으로 바꾼다.
//      바꾼 값은 "우리 조직 설정"으로 표시된다(제품이 정한 값과 구분).
//   4) 적게 세는 쪽 — 매핑에 없는 도구, 사람이 결재한 변경, 시험·QA 실행은 세지 않는다(worklog).
//   5) 없는 기간은 없다고 말한다 — 원장이 시작된 시점 이전은 "데이터 없음"으로 답한다.
import type { Express, Request } from "express";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";
import { WORK_KINDS, WorkKind, countWorkByKind, workLedgerStart } from "./worklog";

const STATE_KEY = "timeSaved:minutes"; // JSON Record<WorkKind, number> — 조직이 바꾼 값만 담는다

/**
 * 작업 종류별 기준시간(분) — "담당자가 손으로 하면 대략 이만큼"의 보수적 추정.
 *
 * 방식의 근거(조사 2026-07-29): "선언된 기준시간 × 처리 건수"는 보안 자동화 업계의 공통 관행이다.
 *   · Splunk SOAR — 액션당 기본 4분(고객이 변경) × 액션 수
 *   · Swimlane — 작업당 기본 3분(고객이 변경) × 실행 횟수
 *   · Cortex XSOAR — 인시던트 유형별 Manual_effort(분)를 관리자가 등록
 * 셋 다 **실측이 아니라 선언된 가정**이고, 고객이 바꿀 수 있게 열어 둔다. 우리도 같은 방식이다.
 *
 * ⚠ 그런데 조사에서 확인된 더 중요한 사실: "취약점 1건 분류에 몇 분" 같은 **세부 작업 단위의
 *   1차 벤치마크는 업계에 없다**. 도는 수치(경보 1건 15~40분 등)는 전부 벤더 블로그의 재인용이라
 *   출처를 대면 오히려 근거 없는 숫자를 베끼는 꼴이 된다. 그래서 여기 값은 전부 **자체 추정**으로
 *   적고, 있는 척하지 않는다. 조직이 자기 값으로 바꾸는 것이 정답이다.
 */
export interface MinuteBaseline {
  minutes: number;
  source: string; // 이 숫자가 어디서 왔는지 — 화면·보고서에 그대로 보여준다
}

export const DEFAULT_BASELINES: Record<WorkKind, MinuteBaseline> = {
  question_answered: { minutes: 10, source: "자체 추정 — 사내 문서를 찾아 읽고 정리하는 데 걸리는 시간(보수적)" },
  status_compiled: { minutes: 5, source: "자체 추정 — 화면 두세 곳을 열어 숫자를 모으는 시간" },
  finding_triaged: { minutes: 15, source: "자체 추정 — 취약점 목록을 놓고 심각도·악용가능성·자산 중요도를 따져 순서를 정하는 시간" },
  remediation_guided: { minutes: 20, source: "자체 추정 — 조치 방법을 자료에서 찾아 절차로 정리하는 시간" },
  report_generated: { minutes: 120, source: "자체 추정 — 데이터 수집·표 작성·문장 다듬기를 포함한 보고서 1건" },
  hardening_scanned: { minutes: 45, source: "자체 추정 — 점검 항목마다 명령을 실행하고 결과를 표로 옮기는 시간" },
  document_ingested: { minutes: 15, source: "자체 추정 — 문서를 읽고 분류해 정리하는 시간" },
  action_checked: { minutes: 20, source: "자체 추정 — 규정 문서에서 해당 조항을 찾아 대조하는 시간" },
  verification_run: { minutes: 30, source: "자체 추정 — 조치했는지 장비에 다시 접속해 확인하는 시간" },
};

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

/** 조직이 바꾼 기준시간(있으면). 없으면 빈 객체. */
export function customBaselines(): Partial<Record<WorkKind, number>> {
  const row = getStateStmt.get(STATE_KEY) as { value: string } | undefined;
  if (!row) return {};
  try { return JSON.parse(row.value) as Partial<Record<WorkKind, number>>; } catch { return {}; }
}

export function setBaseline(kind: WorkKind, minutes: number, actor?: string): void {
  if (!(kind in DEFAULT_BASELINES)) throw new Error(`알 수 없는 작업 종류: ${kind}`);
  // 0분이면 "이 작업은 절감으로 세지 않는다"는 뜻 — 조직이 동의하지 않는 항목을 끌 수 있어야 한다.
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 600) throw new Error("기준시간은 0~600분 사이여야 합니다");
  const cur = customBaselines();
  cur[kind] = Math.round(minutes);
  setStateStmt.run(STATE_KEY, JSON.stringify(cur));
  recordAudit({
    kind: "config",
    actor: actor ?? null,
    action: "절감 기준시간 변경",
    target: WORK_KINDS[kind],
    detail: `${DEFAULT_BASELINES[kind].minutes}분(기본) → ${Math.round(minutes)}분`,
    result: "ok",
  });
}

export interface TimeSavedRow {
  kind: WorkKind;
  label: string;
  count: number;
  minutesEach: number;
  minutes: number;
  source: string;
  custom: boolean; // 조직이 바꾼 값인가
}

/**
 * 보수 조정 비율 — 산정한 절감을 20% 깎아서 보고한다.
 * 근거(조사 2026-07-29): Forrester TEI는 편익에 risk adjustment를 적용해 보수화하며,
 * 실제 사례로 Island 스터디 10%·Microsoft Zero Trust 스터디 20% 하향이 있다.
 * 왜 필요한가: 기준시간은 선언된 가정이고, 실제와 어긋날 수 있다(METR 2025 실측 — 개발자들이
 * "20% 빨라졌다"고 느낀 작업이 실제로는 19% 느렸다). 큰 숫자는 신뢰를 얻는 게 아니라 잃는다.
 */
export const RISK_ADJUSTMENT = 0.2;

export interface TimeSavedReport {
  days: number;
  from: number;
  to: number;
  /** 원장이 이 기간 전체를 덮는가. false면 "이만큼만 쌓여 있다"는 뜻이라 숫자를 과장해 읽으면 안 된다. */
  coversWholePeriod: boolean;
  ledgerStart: number | null;
  rows: TimeSavedRow[];
  totalMinutes: number;
  totalHours: number; // 보수 조정 전 산정값
  /** 보고에 쓰는 값 — 보수 조정(20%)을 적용한 하한. "약 A~B시간"의 A. */
  adjustedHours: number;
  riskAdjustment: number;
  /** 화면·보고서에 그대로 붙는 가정 설명 — 이걸 빼고 숫자만 내보내지 않는다. */
  assumptions: string[];
  note: string;
}

/**
 * 분을 사람이 읽는 길이로. 1시간 미만은 분으로 적는다 —
 * 15분을 "0시간"이라고 쓰면 일한 것이 없어 보인다(2026-07-29 실서버 확인).
 */
export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}분`;
  // 반올림 규칙은 하나뿐이어야 한다 — 소수 첫째 자리 고정.
  // (시안 검토 2026-07-29: 10시간 이상만 정수로 자르면 같은 합계가 화면에서 "19시간"과
  //  "18.6시간" 두 가지로 보인다. 숫자가 스스로 어긋나면 그 숫자를 믿지 않게 된다.)
  return `${Math.round((minutes / 60) * 10) / 10}시간`;
}

export function timeSavedReport(days = 30): TimeSavedReport {
  const to = Date.now();
  const from = to - days * 86400000;
  const counts = countWorkByKind(from, to);
  const custom = customBaselines();
  const rows: TimeSavedRow[] = [];
  for (const kind of Object.keys(DEFAULT_BASELINES) as WorkKind[]) {
    const count = counts[kind] ?? 0;
    if (count === 0) continue; // 안 한 일은 줄에 없다 — 0건짜리 항목이 늘어서면 보고서가 부풀어 보인다
    const minutesEach = custom[kind] ?? DEFAULT_BASELINES[kind].minutes;
    rows.push({
      kind,
      label: WORK_KINDS[kind],
      count,
      minutesEach,
      minutes: count * minutesEach,
      source: custom[kind] != null ? "우리 조직 설정값" : DEFAULT_BASELINES[kind].source,
      custom: custom[kind] != null,
    });
  }
  rows.sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const ledgerStart = workLedgerStart();
  const coversWholePeriod = ledgerStart != null && ledgerStart <= from;

  const assumptions = rows.map((r) => `${r.label} ${r.count}건 × ${r.minutesEach}분 = ${fmtDuration(r.minutes)} (${r.source})`);
  const note = [
    "이 수치는 실제로 처리된 건수에 조직이 정한 기준시간을 곱한 **추정**입니다 — 측정값이 아닙니다.",
    `불확실성을 감안해 산정값에서 ${Math.round(RISK_ADJUSTMENT * 100)}%를 깎아 보고합니다(보수 조정).`,
    "‘시간을 아꼈다’는 일을 얼마나 처리했는지이지 조직이 더 안전해졌다는 뜻이 아닙니다 — 위험 감소는 조치율·기한 준수율로 따로 보세요.",
    "사람이 결재해 실행한 변경(자산 등록·상태 변경 등)은 사람의 판단이라 절감으로 세지 않습니다.",
    ledgerStart == null
      ? "아직 집계할 자동화 기록이 없습니다."
      : coversWholePeriod
        ? ""
        : `기록은 ${new Date(ledgerStart).toLocaleDateString("ko-KR")}부터 쌓였습니다 — 그 이전 기간은 포함되지 않았습니다.`,
  ].filter(Boolean).join(" ");

  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  return {
    days, from, to, coversWholePeriod, ledgerStart, rows, totalMinutes, totalHours,
    adjustedHours: Math.round(totalHours * (1 - RISK_ADJUSTMENT) * 10) / 10,
    riskAdjustment: RISK_ADJUSTMENT,
    assumptions, note,
  };
}

/** 보고서·챗봇용 한국어 요약. 숫자만 내보내지 않고 가정과 한계를 함께 낸다. */
export function timeSavedText(days = 30): string {
  const r = timeSavedReport(days);
  if (r.rows.length === 0) {
    return [
      `최근 ${days}일 동안 시간으로 환산할 자동화 처리 기록이 없습니다.`,
      r.ledgerStart == null ? "(기록은 이 기능이 배포된 뒤부터 쌓입니다.)" : "",
    ].filter(Boolean).join("\n");
  }
  const lines = [
    // 보수 조정한 하한을 앞세우고 산정값을 범위로 함께 적는다 — 큰 숫자 하나보다 방어 가능한 범위가 믿음을 산다.
    `최근 ${days}일 — AI가 대신 처리한 일 ${r.rows.reduce((s, x) => s + x.count, 0)}건 · 사람이 했다면 약 ${fmtDuration(r.totalMinutes * (1 - RISK_ADJUSTMENT))}~${fmtDuration(r.totalMinutes)}`,
    "",
    "내역(건수 × 기준시간):",
    ...r.rows.map((x) => `  · ${x.label} ${x.count}건 × ${x.minutesEach}분 = ${fmtDuration(x.minutes)}${x.custom ? " (우리 조직 설정)" : ""}`),
    "",
    `※ ${r.note}`,
  ];
  return lines.join("\n");
}

export function registerTimeSavedRoutes(app: Express): void {
  app.get("/api/time-saved", authMiddleware, (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    res.json({ ...timeSavedReport(days), baselines: DEFAULT_BASELINES, custom: customBaselines() });
  });
  // 기준시간 변경은 admin — 조직 전체의 보고 숫자가 바뀌는 설정이다.
  app.post("/api/time-saved/baseline", authMiddleware, adminMiddleware, (req, res) => {
    const { kind, minutes } = req.body as { kind?: WorkKind; minutes?: number };
    if (!kind) { res.status(400).json({ error: "kind가 필요합니다" }); return; }
    try {
      setBaseline(kind, Number(minutes), (req as Request & { user?: GijoUser }).user?.displayName);
      res.json(timeSavedReport(30));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
