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

// 실측(2026-07-21): `toLocaleString("ko-KR")`을 옵션 없이 쓰면 Node 버전에 따라 오전/오후 대신
// 영어 AM/PM이 나온다(운영 Node 20 vs 이 개발머신 Node 24 — ICU/CLDR 버전 차이, dayPeriod를
// 명시하면 버전 무관하게 고정됨). 챗봇 응답·리포트 등 사용자 노출 문자열은 이 함수로 통일한다.
export function koDateTimeString(ms: number): string {
  return new Date(ms).toLocaleString("ko-KR", {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
    dayPeriod: "short",
  });
}
