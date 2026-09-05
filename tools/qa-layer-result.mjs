// QA 전수조사(tools/qa-full.mjs)의 **순수 조각** — 계층 판정과 변경 목록 읽기의 단일 출처.
//
// ■ 왜 따로 뺐나 (2026-09-05)
//   tools/qa-full.mjs의 run()이 `r.status === 0` 하나로만 판정해서, tools/docs-drift.mjs가
//   fc396fdb부터 내는 **exit 2(판정 못 함)** 를 exit 1(어긋남)과 똑같이 「✗ 실패」로 셌다.
//   그러면 「도구를 돌릴 환경이 아니었다」가 「문서가 어긋났다」로 보고된다 —
//   **재지 못한 것을 빨강으로 칠하는 것도 거짓말이다.** 이 저장소는 반대 방향(거짓 초록)으로
//   이미 데었고 뿌리가 같다: 모르는 것을 아는 척하는 것.
//   규칙을 스크립트 한복판에 두면 가짜 종료 코드로 재 볼 수가 없어, 여기로 꺼내 시험을 붙였다
//   (server/test/qalayerresult.test.ts).
//
// 종료 코드의 뜻(도구가 약속한 것만 여기서 해석한다):
//   0 = 통과 · 1 = 실패 · **약속된 코드 = 판정 못 함**(초록도 빨강도 아닌 회색)

/** 계층 하나의 결과 한 줄. opts.판정못함코드에 든 종료 코드만 회색이 된다. */
export function 계층결과(name, status, ms, opts = {}) {
  // ⚠ **약속한 계층에만** 적용한다 — 아무 계층에나 「2는 봐준다」를 걸면 진짜 실패가 회색에 숨는다.
  if ((opts.판정못함코드 ?? []).includes(status)) {
    const 사유 = opts.판정못함사유 ?? "위 출력의 안내를 보고 원인을 없앤 뒤 다시 돌리세요";
    return { name, ok: null, ms, 판정못함: true, note: "판정 못 함(종료코드 " + status + ") — " + 사유 };
  }
  return { name, ok: status === 0, ms };
}

/** 요약표의 한 글자. ? = 판정 못 함 · ― = 안 돌림 · ✓/⚠/✗ = 실제로 쟀다. */
export function 기호(r, 알려진이슈 = false) {
  if (r.판정못함) return "?";
  if (r.ok === null) return "―";
  return r.ok ? "✓" : 알려진이슈 ? "⚠" : "✗";
}

/** `git status --porcelain` 출력을 **파일 경로 목록**으로 읽는다.
 *
 * ⚠⚠ 2026-09-05 적발: 호출부가 `execSync(...).trim()` 한 값을 넘기고 있었다. porcelain은
 *   **줄 앞 공백이 뜻을 가진다**(" M 경로" = 미스테이지 수정 · "?? 경로" = 미추적). 통째로
 *   trim하면 **첫 줄의 앞 공백 한 칸이 깎여** slice(3)이 경로의 첫 글자까지 먹는다 —
 *   실측: " M tools/local-digest.mjs" → "ools/local-digest.mjs".
 *   그러면 그 파일의 계층 매핑(QUALITY_RE · startsWith("server/") 등)이 **전부 빗나가고**,
 *   돌아야 할 계층이 **조용히 안 돈다**. 이 저장소가 되풀이해 겪은 「만들어 놓고 안 도는 검사」다.
 *   그래서 다듬기를 여기서 **줄 단위로만** 한다 — 원문을 그대로 받는다.
 * ⚠ 이름이 바뀐 항목은 "옛 -> 새"로 온다 — 새 이름만 본다(옛 이름은 이미 없는 파일이라
 *   어떤 계층 규칙에도 안 걸리고, 걸려도 없는 파일을 검사하게 된다). */
export function 변경목록(porcelain) {
  return String(porcelain ?? "")
    .split("\n")
    .filter((l) => l.length > 3)
    .map((l) => l.slice(3).trim())
    .map((l) => (l.includes(" -> ") ? l.slice(l.indexOf(" -> ") + 4) : l))
    .filter(Boolean);
}
