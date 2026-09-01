// tools/qa-account.mjs — 점검 도구들이 쓸 계정을 한 곳에서 읽는다.
//
// 왜 생겼나(2026-08-09): 계정 비밀번호가 도구 **7곳에** 그대로 박혀 있었다. 저장소를 남과
// 공유하려다 발견했다 — 파일에서 지워도 git 이력에는 남으므로, 새는 자리를 하나로 모으고
// 소스 감시 시험(no-hardcoded-credentials)으로 다시 생기는 것을 막는다.
//
// ⚠ 기본값을 두지 않는다. "없으면 이걸로"가 바로 비밀번호가 코드에 눌러앉는 길이다.
//   없으면 **무엇을 해야 하는지 말하고 멈춘다**(조용한 실패 금지 — 제품 원칙과 같다).

/**
 * @param {string} [why] 이 도구가 왜 로그인하는지 — 안내 문구에 그대로 쓴다.
 * @returns {{ user: string, pass: string }}
 */
/**
 * ⚠⚠ **QA 전용 계정(win_claude-qa)만으로는 QA가 반쪽이 된다**(2026-09-01 실측).
 *   그 계정은 security_officer이고 **소속 팀이 없어**, 검증 계층 9건이 통째로
 *   「이 자산은 보안관제팀 소관입니다 — 권한이 없습니다」로 실패한다.
 *   admin 전용 창구(/api/localengine/model-licenses)도 403이 난다.
 *   ⚠ 그렇다고 **QA 계정의 권한을 올리지 않는다** — 운영 서버에 admin 계정을 하나 더 두는
 *     것은 보안 결정이지 편의가 아니다. 대신 **이미 문서화된 테스트용 admin 계정**
 *     (CLAUDE.md: win = claude-deploy)을 쓴다.
 *   ⚠ 그 계정으로 로그인하면 **계정당 1세션**이라 같은 계정의 앱 세션이 끊긴다.
 *     사장님 계정과는 다른 계정이라 사장님 세션에는 영향이 없다.
 */
export function account(why = "점검") {
  const user = process.env.GIJO_ADMIN_USER || process.env.GIJO_QA_USER || "";
  const pass = process.env.GIJO_ADMIN_PASSWORD || process.env.GIJO_QA_PASS || "";
  if (!user || !pass) {
    console.error(
      `✗ ${why}에 쓸 계정이 없습니다 — 비밀번호는 코드에 두지 않습니다.\n` +
        "  환경변수 GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 를 넣고 실행하세요.\n" +
        '  PowerShell: $env:GIJO_ADMIN_USER="계정"; ' +
        '$env:GIJO_ADMIN_PASSWORD=[Environment]::GetEnvironmentVariable("GIJO_ADMIN_PASSWORD","User")\n' +
        "  bash:       GIJO_ADMIN_USER=계정 GIJO_ADMIN_PASSWORD=... node <도구>"
    );
    process.exit(1);
  }
  return { user, pass };
}
