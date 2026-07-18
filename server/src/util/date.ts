// util/date.ts — "오늘" 날짜를 로컬(KST) 달력 기준 YYYY-MM-DD로 계산하는 공용 유틸.
//
// 실측(2026-07-19): 여러 엔진(approvals·briefing·kpi·maintenance·report·serviceimpact)이 각자
// `new Date().toISOString().slice(0, 10)`로 "오늘"을 구했다. toISOString()은 UTC 기준이라
// 자정~오전 8시59분(KST, UTC+9) 사이에는 "오늘"이 어제로 계산된다 — SLA 기한초과 판정이 실제보다
// 하루 늦게 잡히고(과소집계), 일일 브리핑 날짜도 하루 밀려 나온다. 로컬 연/월/일로 계산해 고친다.
export function todayLocal(now: Date = new Date()): string {
  return dateOnlyLocal(now);
}

export function dateOnlyLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysLocal(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function plusDaysLocal(n: number, now: Date = new Date()): string {
  return dateOnlyLocal(addDaysLocal(now, n));
}
