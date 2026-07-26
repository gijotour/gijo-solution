// engine/verifyaccess.ts — 조치 검증 실행 권한 판정
//
// 왜 별도 파일인가(2026-07-26 설계 확정): 이 판정은 보안 제품의 핵심 경계라서
// 라우트 안에 흩어 두면 반드시 어느 한 곳이 빠진다. 한 곳에 모아 테스트로 고정한다.
//
// ⚠ 이 파일이 존재하는 진짜 이유 — **자격증명과 권한은 다르다.**
//   HardeningTarget.secret에 키·비밀번호가 있어 시스템은 사실상 모든 자산에 접속할 수 있다.
//   그러므로 물어야 할 질문은 "접속되나?"가 아니라 **"이 사용자가 시켜도 되나?"**이다.
//   화면에서 버튼만 숨기는 방식은 API 직접 호출로 우회되므로 불충분하다 — 반드시 API에서 막는다.
//
// 규칙(초안 승인분):
//   admin            → 전체 자산 허용
//   security_officer → ① user.team === asset.owner (소속 팀 자산)
//                      ② 본인이 그 finding의 assignee 또는 securityOwner
//   그 외            → 거부

import type { GijoUser } from "../auth/users";
import { getAsset } from "./assets";
import { listFindingReviews } from "./approvals";

export interface AccessDecision {
  allowed: boolean;
  reason: string; // 거부 사유(허용이면 근거) — 화면에 그대로 보여준다
}

/** 팀 이름 비교 — 공백·대소문자 차이로 조용히 실패하지 않게 다듬어 비교한다. */
function sameTeam(a?: string | null, b?: string | null): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
}

/**
 * 이 사용자가 이 자산에 조치 검증을 실행해도 되는가.
 * findingKey를 주면 "그 건의 담당자인가"까지 본다(팀이 달라도 본인 담당이면 허용).
 *
 * 거부 메시지는 행동 가능해야 한다 — "권한이 없습니다"로 끝내면 담당자가 다음에 뭘 해야 할지 모른다.
 * 자산 존재 자체는 인벤토리에서 이미 보이므로 숨기지 않고, 소관 팀을 알려주는 편이 실무에 유용하다.
 */
export function canVerifyAsset(user: GijoUser | undefined, assetId: string, findingKey?: string): AccessDecision {
  if (!user) return { allowed: false, reason: "로그인이 필요합니다." };

  const asset = getAsset(assetId);
  if (!asset) return { allowed: false, reason: `자산을 찾을 수 없습니다: ${assetId}` };

  if (user.role === "admin") return { allowed: true, reason: "관리자 권한" };

  if (sameTeam(user.team, asset.owner)) {
    return { allowed: true, reason: `소속 팀 자산(${asset.owner})` };
  }

  if (findingKey) {
    const mine = listFindingReviews().find(
      (r) => r.assetId === assetId && r.findingKey === findingKey &&
        (r.assignee === user.displayName || r.securityOwner === user.displayName)
    );
    if (mine) return { allowed: true, reason: "본인이 담당(배정)된 건" };
  }

  const owner = (asset.owner || "").trim();
  const who = owner ? `${owner} 소관입니다` : "소관 팀이 지정돼 있지 않습니다";
  return {
    allowed: false,
    reason:
      `이 자산(${asset.name})은 ${who}. 검증을 실행할 권한이 없습니다.\n` +
      `→ 담당자에게 요청하거나, 관리자에게 권한(소속 팀 지정)을 요청하세요.` +
      (user.team ? `` : `\n(현재 계정에 소속 팀이 지정돼 있지 않습니다.)`),
  };
}
