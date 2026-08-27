// engine/autoassign.ts — 자산 기본 담당자로 새 취약점을 자동 배정한다 (계획서 Part 1)
//
// 왜: 미배정이 쌓이면 조치도 검증도 시작되지 않는다. 한 번 밀린 걸 일괄 배정으로 치워도,
// 다음 스캔에서 새 취약점이 또 미배정으로 들어오면 같은 적체가 반복된다.
// 그래서 "쌓인 걸 치우는 도구"(일괄 배정)와 "다시 쌓이지 않게 하는 장치"(이 파일)는 짝이다.
//
// 규칙(단순하게 유지 — 자동 배정이 똑똑해지려 하면 사람이 예측할 수 없게 된다):
//  · 자산에 기본 담당자가 지정돼 있을 때만 배정한다. 없으면 아무 일도 하지 않는다(미배정 유지).
//  · **이미 담당자가 있는 건은 절대 건드리지 않는다** — 사람이 정한 배정을 기계가 덮으면 안 된다.
//  · 상태도 바꾸지 않는다. 배정은 "누가 볼 것인가"이지 "검토했다"가 아니다(미검토는 그대로).
//
// ★ 층 정리 (2026-08-28, 화살 #7)
//   이 파일은 이제 **결재 층 물건만** 남았다 — 자산 컬럼 접근자(getDefaultAssignee 등)는
//   잎 모듈 assetassignee.ts로 내려갔고, 여기서 재수출해 옛 호출부는 한 줄도 안 바뀐다.
//   그리고 assets가 이 파일을 **부르지 않는다** — 아래 registerFindingsRecorded로
//   자기를 등록한다(app.ts가 배선). 그래서 assets→autoassign→approvals→assets 순환이 끊긴다.
import type { StandardFinding } from "./bridge";
import { findingKey } from "./findingkey"; // 잎(화살 #2) — approvals 전체를 물지 않는다
import { updateFindingReview } from "./approvals";
import { db } from "../db";
import { getDefaultAssignee } from "./assetassignee";
import { onFindingsRecorded } from "./assets";

// 자산 컬럼 접근자는 잎으로 이사 — 재수출(옛 호출부·시험 무변경).
export { getDefaultAssignee, setDefaultAssignee } from "./assetassignee";

/** 현재 담당자가 비어 있는지 — 이미 배정된 건을 덮지 않기 위한 확인. */
function hasAssignee(assetId: string, key: string): boolean {
  const r = db.prepare("SELECT assignee FROM finding_approvals WHERE assetId = ? AND findingKey = ?")
    .get(assetId, key) as { assignee: string | null } | undefined;
  return Boolean((r?.assignee ?? "").trim());
}

export interface AutoAssignResult {
  assignee: string | null;
  assigned: number; // 이번에 새로 배정된 건수
}

/**
 * 스캔으로 들어온 finding들을 자산 기본 담당자에게 배정한다.
 * 기본 담당자가 없거나, 이미 배정된 건이면 건너뛴다. 조용히 실패하지 않게 건수를 돌려준다.
 */
export function autoAssignFindings(assetId: string, findings: StandardFinding[]): AutoAssignResult {
  const assignee = getDefaultAssignee(assetId);
  if (!assignee) return { assignee: null, assigned: 0 };

  let assigned = 0;
  for (const f of findings || []) {
    // 이미 해결된 것으로 들어온 항목까지 배정할 이유는 없다.
    if (f.state === "fixed") continue;
    const key = findingKey(assetId, f);
    if (hasAssignee(assetId, key)) continue; // 사람이 정한 배정을 덮지 않는다
    try {
      updateFindingReview(assetId, key, { assignee }, "자동 배정(자산 기본 담당자)");
      assigned++;
    } catch { /* 상태 전이 제약 등으로 실패하면 그 건만 건너뛴다 */ }
  }
  return { assignee, assigned };
}

/**
 * ★ 자산 층에 자기를 꽂는다 — app.ts가 부팅 때 한 번 호출한다(배선).
 *
 * ⚠ **등록이 안 걸리면 자동 배정이 소리 없이 죽는다.** 옛 구조는 assets.ts가 직접
 *   부르고 그 자리가 `catch {}`라 실패도 안 보였다 — 훅으로 바꾸면서 그 위험이
 *   「등록을 잊는 것」으로 옮겨 갔다(반증 검토 2026-08-23 경고). 그래서:
 *     · autoassign.test가 「등록 0건이면 실패」를 못 박는다
 *     · assets.ts는 청취자가 없으면 아무 일도 안 하지만, 있으면 **동기로** 부른다
 *       (호출 순서 계약: findings 저장 뒤 · broadcast 앞 — 화면이 미배정을 먼저 받고
 *        나중에 배정되는 깜빡임을 막는다)
 */
export function 자동배정_배선(): void {
  onFindingsRecorded((assetId, findings) => {
    autoAssignFindings(assetId, findings);
  });
}
