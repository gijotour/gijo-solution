// 창 배치 계산 — Electron을 안 쓰는 순수 함수라 시험으로 확인할 수 있다.
//
// ⚠ main.ts 안에 두면 **검증할 방법이 없다.** 개발 머신이 세로 모니터(1080×1920)라
//   나란히 둘 자리가 없어(420+900=1320 > 1080) 실앱에서는 "안 비켜 주는 쪽"만 확인된다.
//   비켜 주는 쪽은 여기서 시험으로 본다(2026-08-01).

export interface 사각 {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 두 사각이 겹치는가. */
export function 겹치나(a: 사각, b: 사각): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * 대화 창이 저 자리에 뜰 때, 셸을 어디로 옮겨야 겹치지 않는가.
 *
 * @param 셸       지금 셸 자리
 * @param 대화창   대화 창이 뜰 자리
 * @param 최소폭   셸이 이보다 좁아지면 **옮기지 않는다** — 표가 안 들어가는 폭으로
 *                 밀어 넣느니 겹치는 게 낫다. 겹침은 담당자가 창을 옮겨 풀 수 있지만,
 *                 못 읽는 표는 풀 방법이 없다.
 * @returns 옮길 자리, 또는 **건드리지 말아야 하면 null**
 */
export function 셸옮길자리(셸: 사각, 대화창: 사각, 최소폭 = 900): 사각 | null {
  if (!겹치나(셸, 대화창)) return null; // 애초에 안 겹치면 멀쩡한 창을 흔들지 않는다
  const 남는너비 = 대화창.x - 셸.x;
  if (남는너비 < 최소폭) return null;
  return { x: 셸.x, y: 셸.y, width: 남는너비, height: 셸.height };
}
