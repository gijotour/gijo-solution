// engine/sla.ts — 조치(취약점 연결 조치 티켓)의 SLA 판정 단일 출처. **잎 모듈(import 0줄)**.
//
// ■ 왜 잎 모듈인가 (2026-09-12 설계관 지시서·검토관 발견 항목 「report.ts SLA 산식 중복」)
//   kpi.ts:15가 report.ts(maintenanceSummary)를 import한다 — 그래서 report.ts가 kpi.ts를
//   다시 import하면 순환이 된다. 이 순환 때문에 「기한을 안 넘긴 건」을 세는 산식이
//   kpi.ts remediationMetrics()와 report.ts collectVulnReportData() 두 곳에 글자까지 같게
//   따로 적혀 있었다. sla.ts는 어느 쪽도 import하지 않는 잎이라 kpi.ts·report.ts 둘 다
//   걸림 없이 부를 수 있다(선례: tone.ts 준수율집계전단서 — 같은 이유로 tone.ts에 있다).
//
// ⚠ 이 파일은 tasks.ts를 import하지 않는다 — tasks.ts는 express·auth·db·datacleanup·
//   workguide를 끌고 와 잎이 깨진다. 대신 구조적 타입(RemediationTaskLike)을 인자로
//   받는다(선례: report.ts maintenanceSummary(items), approvals.ts isOverdueReview(r)).
//   server/test/sla.test.ts 소스 감시가 이 파일의 **의존 0줄**을 못 박는다 — 정적 import뿐
//   아니라 재수출(`export … from`)·동적 `import()`·`require()`까지 센다(2026-09-12 검토관 [하]:
//   `^import`만 보면 그 셋이 그대로 통과했다). 무엇이든 끌어오면 그 시험이 먼저 빨개진다.
//
// ⚠ 표본 0(조치대상이 하나도 없음)일 때 slaCompliance는 100을 준다 — 이것은 「만점」이
//   아니라 「잴 것이 없다」는 뜻이다. 그 단서 문구는 여기가 아니라 tone.ts
//   준수율집계전단서()가 낸다(잎 모듈이 둘로 갈라지는 게 아니라, 판정=sla.ts·문구=tone.ts로
//   역할이 나뉜 것 — 둘 다 import 0줄이라 서로 몰라도 된다).
//   ⚠ 다만 **보고서 산식 근거 문장**의 표본 0 갈래(SLA미집계설명)는 여기 있다 — 산식을 말하는
//   문장과 짝이라 같은 자리에 둬야 호출부가 가드를 빠뜨려도 「÷ 0 × 100」이 안 나간다
//   (2026-09-12 검토관 [하]: 가드가 호출부 ternary에만 있어 세 번째 소비자가 생기면 되살아난다).

/** remediationSla가 요구하는 최소 형태 — TaskItem(tasks.ts)의 구조적 부분집합. */
export interface RemediationTaskLike {
  ref?: string;
  done: boolean;
  dueAt?: number;
  completedAt?: number; // 완료 처리 시각(ms). tasks.ts의 completeStmt·setDoneStmt가 done=true로
  // 바꿀 때 항상 함께 채운다(2026-07-22 마이그레이션 이후 두 쓰기 경로뿐 — 실측: grep으로
  // done을 바꾸는 UPDATE문이 그 둘뿐임을 확인). SLA①(기한을 넘겨 완료한 조치는 미준수)의
  // 판정에 쓴다.
}

/** t가 취약점에서 등록된 조치 항목(SLA 추적 대상)인가. */
export function 조치대상인가(t: RemediationTaskLike): boolean {
  return (t.ref ?? "").startsWith("vuln:");
}

/**
 * t가 기한을 넘긴 항목인가.
 *
 * ★ SLA①(2026-09-13 사장님 결정 — 「기한을 넘겨 완료한 조치는 미준수로 센다」, B 사슬 수리
 *   2800abe6이 보류해 둔 사안) — 예전엔 `!t.done`을 요구해 **늦게 끝낸 건이 준수로 들어갔다**
 *   (기한을 3일 넘겨 완료해도 done=true라 그 순간 기한초과가 아니게 됐다). 이제 완료 건도
 *   완료 시각(completedAt)과 기한을 견줘 판정한다.
 * ⚠ 완료 시각이 없는 완료 건(옛 기록 등, `completedAt == null`)은 **판정 불가로 준수 쪽에
 *   둔다** — 없는 값으로 미준수를 지어내지 않는다(거짓 미준수 방지). tasks.ts의 두 쓰기 경로가
 *   done=true를 만들 때 항상 completedAt을 함께 채우므로(위 RemediationTaskLike 주석), 이
 *   갈래는 완료 시각 컬럼이 생기기 전(2026-07-22 이전)에 완료된 옛 기록에만 해당한다.
 */
export function 기한초과인가(t: RemediationTaskLike, now: number): boolean {
  if (t.dueAt == null) return false; // 기한 자체가 없으면 초과를 논할 수 없다
  if (!t.done) return t.dueAt < now; // 미완료 — 지금 기준으로 기한이 지났는가
  return t.completedAt != null && t.completedAt > t.dueAt; // 완료 — 늦게 끝냈는가
}

/**
 * t가 SLA를 지킨 것으로 세는 항목인가 — 기한초과인가의 정확한 여집합.
 */
export function 준수건인가(t: RemediationTaskLike, now: number): boolean {
  return !기한초과인가(t, now);
}

export interface RemediationSla {
  tasks: number;
  open: number;
  done: number;
  overdue: number; // 기한 초과 — 미완료 중 기한이 지났거나, 완료했어도 기한을 넘겨 끝난 것(SLA①)
  dueSoon: number; // 3일 내 마감(미완료)
  slaCompliance: number; // 기한 초과 안 한 비율 %. 표본 0이면 100(잴 것이 없다는 뜻 — 만점 아님)
}

const DUE_SOON_MS = 3 * 86400000;

/**
 * 조치대상(vuln: 티켓) 배열에서 SLA 집계를 낸다 — kpi.ts·report.ts 공용 단일 출처.
 * 인자는 이미 조치대상인가로 걸러진 배열이어야 한다(호출부: listTasks().filter(조치대상인가)).
 * 이 함수 자체는 listTasks를 부르지 않는다 — 잎 계약을 지키기 위해 걸러내기는 호출부 몫이다.
 */
export function remediationSla(tasks: RemediationTaskLike[], now: number = Date.now()): RemediationSla {
  const done = tasks.filter((t) => t.done).length;
  const open = tasks.length - done;
  const overdue = tasks.filter((t) => 기한초과인가(t, now)).length;
  const dueSoon = tasks.filter((t) => !t.done && t.dueAt != null && t.dueAt >= now && t.dueAt - now <= DUE_SOON_MS).length;
  const compliant = tasks.filter((t) => 준수건인가(t, now)).length;
  const slaCompliance = tasks.length ? Math.round((compliant / tasks.length) * 100) : 100;
  return { tasks: tasks.length, open, done, overdue, dueSoon, slaCompliance };
}

/**
 * SLA 산식을 사람이 읽는 근거 문장으로 — Word·HTML 보고서 두 자리의 단일 출처.
 *
 * ⚠ 표본 0(조치대상 0건) 갈래는 **이 함수 안에서** SLA미집계설명으로 갈라진다. 호출부
 *   (report.ts)의 ternary는 그대로 두되(slaclue.test.ts:98-103이 갈래 수를 센다), 가드를
 *   함수 밖에만 두면 세 번째 소비자가 생기는 순간 「(0 − 0) ÷ 0 × 100」이 되살아난다
 *   (2026-09-11 검토관이 잡았던 바로 그 문장 — 2026-09-12 검토관 [하]로 다시 지적됨).
 * ⚠ 분자 표현 — 옛 문장은 분자를 「완료 건수」로만 적어 코드와 달랐다(2026-09-12 실결함:
 *   코드는 완료 안 했어도 기한 전이거나 기한이 없으면 준수로 센다). 메인 결정(2026-09-12)에
 *   따라 수학적으로 정확하고 검증이 쉬운 표현으로 통일한다: (전체 − 기한초과) ÷ 전체 × 100.
 * ⚠ **반올림을 밝힌다** — 표시 준수율은 Math.round(정수 %)인데(remediationSla) 문장에는 숫자를
 *   대입해 적으므로, 3·7·9건처럼 100으로 안 나누어떨어지면 읽는 사람이 검산했을 때
 *   66.66…% ≠ 67%로 어긋나 보인다(2026-09-12 검토관 [중]). 그래서 문장이 반올림을 스스로 밝힌다.
 */
export function SLA산식설명(조치대상수: number, 기한초과수: number): string {
  if (!(조치대상수 > 0)) return SLA미집계설명;
  return (
    `※ SLA 준수율 = (전체 조치대상 − 기한 초과) ÷ 전체 조치대상 × 100 = ` +
    `(${조치대상수} − ${기한초과수}) ÷ ${조치대상수} × 100(표시된 %는 소수점 첫째 자리에서 반올림). ` +
    `기한 초과 ${기한초과수}건은 미준수. 조치대상은 취약점 연결 조치 티켓(task.ref=vuln:) 기준.`
  );
}

/**
 * 표본 0 갈래 문장 — 조치대상이 0건일 때 산식 대신 나가는 문장(Word·HTML 공용 단일 출처).
 * ⚠ 글자를 바꾸지 않는다(2026-09-11 검토관 [중]이 정한 문장 그대로 옮겨 온 것) — 전엔 이
 *   문장이 report.ts 두 곳에 복사돼 있었다.
 */
export const SLA미집계설명 =
  "※ 조치대상(취약점 연결 조치 티켓)이 0건이라 SLA 준수율은 아직 집계 전입니다 — 100%는 만점이 아니라 «잴 것이 없음»입니다.";
