// engine/scopecmd.ts — 「범위 걸기」를 대화로 (기능 가이드 ②, 2026-08-19).
//
// ■ 왜: 🗂 지금 범위는 ⓪ 자산의 핵심 임무인데 거는 길이 화면 클릭뿐이었다(시나리오 대장 끊김 —
//   「web-01로 범위 걸어줘」를 받는 분기·도구가 없다). dispatcher는 #범위 표식을 소비만 했다.
// ■ 계약: DispatchResult.scopeSet → 클라 콘솔이 setScope를 실행한다(범위의 주인은 화면 상태 —
//   서버는 신호만 준다. 서버가 세션에 범위를 저장하면 화면 알약과 어긋나는 두 번째 진실이 생긴다).
// ■ 대상 해석 순서: ①선택 ⌗키의 자산 ②문장 속 자산 이름(등록부 대조) — 못 찾으면 정직하게 되묻기.

import { listAssets, getAsset, 자산표시이름 } from "./assets";

export interface ScopeSet { kind: "asset" | "clear"; id?: string; label?: string }

// ⚠ 「설정·맞춰」는 **범위 낱말일 때만** — 「KISA 기준으로 설정해줘」(하드닝 표준 변경 의도)를
//   삼키면 안 된다. 「기준」은 걸/잡 동사와 붙을 때만 범위 말로 본다(1차 카드의 분기 과포착 교훈).
const 걸기_RE = /(범위\s*(으로|로)?\s*(걸|잡|설정|맞춰)|기준\s*(으로|로)?\s*(걸|잡))/;
const 풀기_RE = /범위\s*(풀|해제|끄|지워|없애)/;

export function isScopeCommand(text: string): boolean {
  const t = String(text || "");
  return 풀기_RE.test(t) || 걸기_RE.test(t);
}

/** 범위 지시를 해석한다. 반환: 답 글 + 클라에 보낼 scopeSet 신호(못 찾으면 신호 없음=되묻기). */
export function scopeCommandAnswer(text: string, 선택?: string): { output: string; scopeSet?: ScopeSet } {
  const t = String(text || "");
  if (풀기_RE.test(t)) {
    return { output: "🗂 범위를 풀었습니다 — 이제 전체 기준으로 답합니다.", scopeSet: { kind: "clear" } };
  }
  // ①선택 ⌗키 — 화면·카드에서 고른 자산이 최우선(사람이 방금 가리킨 것)
  const 키 = /⌗(.+?)::[0-9a-f]{16}/.exec(선택 ?? "") ?? /⌗(.+?)(?:\s|$)/.exec(선택 ?? "");
  const 후보들 = listAssets();
  let asset = 키 ? getAsset(키[1].trim()) ?? null : null;
  // ②문장 속 자산 이름 — 등록부 양방향 대조(picklist 대상자산고르기와 같은 결)
  if (!asset) {
    const 낱말들 = t.replace(/[?!.,]/g, " ").split(/\s+/)
      .map((w) => w.replace(/(으로|로|을|를|은|는|이|가)$/, "").trim())
      .filter((w) => w.length >= 3 && !/범위|기준|걸어|설정|잡아/.test(w));
    asset = 후보들.find((a) => {
      const 이름 = [a.displayName || "", a.name, a.id, a.ip || "", a.hostname || ""].filter(Boolean);
      return 이름.some((s) => s.length >= 3 && (t.includes(s) || 낱말들.some((w) => s.toLowerCase().includes(w.toLowerCase()))));
    }) ?? null;
  }
  if (!asset) {
    return {
      output: 후보들.length
        ? "어느 자산으로 범위를 걸지 찾지 못했습니다 — 자산 이름을 함께 말씀해 주세요(예: \"web-01로 범위 걸어줘\"). 등록된 자산은 \"자산 현황 보여줘\"로 볼 수 있습니다."
        : "아직 등록된 자산이 없어 범위를 걸 수 없습니다 — 스캐너 결과 파일을 올리면 자산이 자동으로 등록됩니다.",
    };
  }
  const label = 자산표시이름(asset.id);
  return {
    output: `🗂 범위를 「${label}」(으)로 걸었습니다 — 이제 대화 지시가 이 자산 기준으로 갑니다. 풀 때는 "범위 풀어줘" 또는 알약의 ✕.`,
    scopeSet: { kind: "asset", id: asset.id, label },
  };
}
