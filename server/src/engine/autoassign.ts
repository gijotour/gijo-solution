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

import { db } from "../db";
import type { StandardFinding } from "./bridge";
import { findingKey, updateFindingReview } from "./approvals";

// 자산별 기본 담당자 — assets에 컬럼 하나로 둔다(nullable, 없으면 자동 배정 안 함).
try { db.exec("ALTER TABLE assets ADD COLUMN defaultAssignee TEXT"); } catch { /* 이미 있으면 무시 */ }

export function getDefaultAssignee(assetId: string): string | null {
  const r = db.prepare("SELECT defaultAssignee FROM assets WHERE id = ?").get(assetId) as { defaultAssignee: string | null } | undefined;
  const v = (r?.defaultAssignee ?? "").trim();
  return v || null;
}

export function setDefaultAssignee(assetId: string, assignee: string | null): string | null {
  const v = (assignee ?? "").trim();
  db.prepare("UPDATE assets SET defaultAssignee = ? WHERE id = ?").run(v || null, assetId);
  return v || null;
}

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
