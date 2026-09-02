// auth/passwordpolicy.ts — **비밀번호 규칙의 단일 출처.**
//
// ■ 왜 파일을 따로 뒀나 (2026-09-02 · 여정 점검 F8-03·F6-08 수리)
//   화면(settings.html)이 「4자 이상」이라 안내하는데 서버는 8자를 요구했다. 담당자가 안내대로
//   6자를 넣으면 서버가 거절한다 — **한 제품이 두 규칙을 말한 것**이다. 게다가 챗봇 안내
//   (engine/howto.ts)까지 「4자 이상」이라 말해 자리가 셋이었다.
//
//   그래서 숫자를 한 곳으로 모으는데, 그 자리가 `auth/users.ts`면 안 된다:
//   users는 db·auth·audit을 끌고 오므로, **순수한 안내 표인 howto.ts가 import하는 순간 DB가 열린다.**
//   (tools/learn-candidate-review.mjs가 server/dist/engine/howto.js를 서버 밖에서 부른다 —
//    그때 저장소 루트에 data/ DB 파일이 생겨 버린다.)
//   그래서 **아무것도 끌고 오지 않는 파일**로 뗀다. 여기는 앞으로도 import를 늘리지 말 것.
//
// ■ 누가 이 값을 읽나
//   · 서버 검사   — auth/users.ts validatePassword (여기서 다시 export한다)
//   · 화면        — GET /api/auth/me 의 minPasswordLen (auth/auth.ts) → settings.html
//   · 챗봇 안내   — engine/howto.ts
//
// ⚠ 아직 손으로 적힌 자리가 남아 있다(로그인 전이라 /api/auth/me를 못 부르는 곳):
//   client/src/main.ts · setup.html. 정책을 바꾸면 그 자리도 함께 본다.

/**
 * 비밀번호 최소 길이. 길이 우선 정책 — 보안 제품이라 최소한은 강제한다.
 * 기본 8자, `GIJO_MIN_PASSWORD_LEN`으로 조정한다.
 *
 * ⚠ 모듈이 처음 불릴 때 한 번 읽는다. 시험에서 나중에 env를 바꿔도 이 값은 안 바뀐다 —
 *   정책값을 바꿔 가며 재려면 env를 세운 뒤 모듈을 새로 불러야 한다(vi.resetModules).
 */
export const MIN_PASSWORD_LEN = Number(process.env.GIJO_MIN_PASSWORD_LEN ?? 8);
