// engine/assetassignee.ts — 자산의 **기본 담당자 칸**만 읽고 쓴다. 잎 모듈이다.
//
// ★ 왜 갈랐나 (2026-08-28, 의존 수리 화살 #7)
//   옛 autoassign.ts는 **두 인격**을 겸했다:
//     ① 자산 컬럼 접근자(getDefaultAssignee·setDefaultAssignee + ALTER) — 자산 층(낮음)
//     ② 결재 대장에 쓰는 자동 배정(autoAssignFindings) — 결재 층(높음)
//   ②가 approvals를 물어서 ①까지 통째로 위층으로 끌려 올라갔고, assets가 그 합본을
//   정적으로 import하는 순간 **assets → autoassign → approvals → assets** 3자 순환이
//   닫혔다(값 화살만으로 이룬 진짜 순환 둘 중 하나).
//   인격대로 가르면: 자산은 이 잎만 보고, 결재 쪽 일은 훅으로 위층이 등록한다.
//
// ⚠ 옛 assets.ts:422 주석의 「호출이 런타임이라 안전하다」는 **틀린 안심**이었다 —
//   안전한 것은 호출이지 import가 아니다. 지금 안 터지는 이유는 고리 안 세 모듈 중
//   누구도 최상위에서 상대 함수를 부르지 않기 때문일 뿐이었다(검토 2026-08-23).
import { db } from "../db";

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
