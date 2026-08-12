// tools/create-qa-account.mjs — **QA 계정을 만들고 열람 등급까지 올린다.**
//
// ■ 왜 도구로 두나
//   계정 생성과 열람 등급은 **호출이 둘로 나뉘어 있다**(users.ts). `createUser`는 등급을
//   `null`로 만드는데, null은 「공개만」이라 민감·기밀 문서가 안 보인다. 생성만 하고 끝내면
//   로그인은 되는데 **QA가 조용히 반쪽이 된다** — "왜 이 문서가 안 보이지"를 아무도 못 푼다.
//   그래서 둘을 한 번에 묶고, **끝에 실제로 로그인해서 되는지까지 확인**한다("있다 ≠ 된다").
//
// ■ 비밀번호는 이 파일에도, 화면에도, 명령줄에도 안 나온다
//   환경변수에서만 읽는다(win=사용자 환경변수 · max=키체인에서 꺼내 export).
//   ⚠ 어떤 경로로도 값을 출력하지 않는다 — 오류 메시지에도 싣지 않는다.
//   자리 규칙은 `GIJO_AS_2머신_개발환경_가이드.md` §8 참고.
//
// 사용:
//   win:  node tools/create-qa-account.mjs
//   max:  GIJO_QA_PASSWORD=$(security find-generic-password -a gijo-qa -s gijo-max-claude-qa -w) \
//         GIJO_ADMIN_USER=jyh \
//         GIJO_ADMIN_PASSWORD=$(security find-generic-password -a gijo-qa -s gijo-qa-pass -w) \
//         GIJO_SERVER_URL=http://localhost:4000 node tools/create-qa-account.mjs
//
// ⚠ **기계마다 다른 두 가지**(2026-08-12 max에서 확인) — 기본값은 win 기준이다:
//   · 관리자 계정 이름이 다르다. win=claude-deploy · **max=jyh**. 안 넘기면 win 것으로 붙는다.
//   · 키체인 `-a`는 **gijo-qa**다. `-a claude-qa`로는 아무것도 안 나온다(종료코드 44) —
//     그러면 빈 비밀번호가 조용히 들어간다. 가이드 §8 정정 참고.
//
// 환경변수
//   GIJO_ADMIN_USER     : 관리자 아이디 — 기본 claude-deploy(win). **max는 jyh를 넘길 것**
//   GIJO_ADMIN_PASSWORD : 그 관리자의 비밀번호 — 계정을 만들 권한
//   GIJO_QA_PASSWORD    : 새로 만들 QA 계정의 비밀번호
//   GIJO_SERVER_URL     : 기본 http://localhost:4000
//   GIJO_QA_USER        : 기본 claude-qa
//
// ⚠ 이 스크립트는 **관리자로 로그인한다.** 계정당 1세션이라, 지금 앱에 같은 관리자 계정으로
//   들어가 있으면 그 세션이 끊긴다(2026-07 중복로그인 방지). 앱을 닫고 돌리는 편이 안전하다.

const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const ADMIN = process.env.GIJO_ADMIN_USER || "claude-deploy";
const ADMIN_PW = process.env.GIJO_ADMIN_PASSWORD;
const QA_USER = process.env.GIJO_QA_USER || "claude-qa";
const QA_PW = process.env.GIJO_QA_PASSWORD;

function 죽는다(말) { console.error(`★ ${말}`); process.exit(2); }

if (!ADMIN_PW) 죽는다("GIJO_ADMIN_PASSWORD가 없다 — 관리자 권한 없이는 계정을 못 만든다.");
if (!QA_PW) {
  죽는다(
    "GIJO_QA_PASSWORD가 없다.\n" +
    "  win:  setx GIJO_QA_PASSWORD \"<값>\"  (새 터미널에서 다시 실행)\n" +
    "  max:  export GIJO_QA_PASSWORD=$(security find-generic-password -a gijo-qa -s gijo-max-claude-qa -w)"
  );
}

// ⚠ 키체인이 못 찾으면 `$(...)`는 **빈 문자열**이 된다 — 위 검사는 통과하지 못하지만,
//   공백이나 개행만 든 값은 통과해 버린다. 빈 비밀번호로 계정을 만들면 나중에
//   "왜 로그인이 안 되지"만 남는다. 여기서 끊는다.
if (!QA_PW.trim()) 죽는다("GIJO_QA_PASSWORD가 비어 있다 — 키체인 -a/-s 이름을 확인할 것(못 찾으면 종료코드 44).");
if (!ADMIN_PW.trim()) 죽는다("GIJO_ADMIN_PASSWORD가 비어 있다 — 같은 이유일 수 있다.");

async function 부른다(길, 옵션 = {}, 토큰) {
  const r = await fetch(`${BASE}${길}`, {
    ...옵션,
    headers: {
      "Content-Type": "application/json",
      ...(토큰 ? { Authorization: `Bearer ${토큰}` } : {}),
      ...(옵션.headers ?? {}),
    },
  });
  const 본문 = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, 본문 };
}

// ① 관리자로 붙는다
const 로그인 = await 부른다("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: ADMIN, password: ADMIN_PW }),
});
if (!로그인.ok) {
  if (로그인.status === 409) 죽는다("관리자가 이미 어딘가에 로그인돼 있다(계정당 1세션). 앱을 닫고 다시 돌려라.");
  죽는다(`관리자 로그인 실패 ${로그인.status} — ${로그인.본문?.error ?? ""}`);
}
const token = 로그인.본문.accessToken;
const adminRefresh = 로그인.본문.refreshToken;
console.log(`✓ 관리자로 붙었다 (${ADMIN})`);

// ⚠ **끝나면 반드시 세션을 비운다.** 이 제품은 계정당 1세션이라, 스크립트가 로그인만 하고
//   나가면 **사람이 앱에서 그 계정으로 못 들어간다**(409). 2026-08-12에 이 도구 첫 판이
//   정확히 그 사고를 냈다 — 만들어 놓고 정작 claude-qa로 로그인이 막혔다.
async function 나간다(라벨, accessToken, refreshToken) {
  if (!accessToken || !refreshToken) return;
  const r = await 부른다("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }, accessToken);
  console.log(`· ${라벨} 세션 정리 ${r.ok ? "✓" : "실패 " + r.status}`);
}

// ② 이미 있는지 본다 — 두 번 돌려도 안전해야 한다
const 목록 = await 부른다("/api/users", {}, token);
if (!목록.ok) 죽는다(`계정 목록을 못 읽었다 ${목록.status}`);
const 있는것 = (Array.isArray(목록.본문) ? 목록.본문 : 목록.본문?.users ?? []).find(
  (u) => u.username === QA_USER
);

let id = 있는것?.id;
if (있는것) {
  console.log(`· 계정이 이미 있다: ${QA_USER} (등급 ${있는것.clearance ?? "미지정=공개만"})`);
} else {
  const 생성 = await 부른다("/api/users", {
    method: "POST",
    body: JSON.stringify({
      username: QA_USER,
      password: QA_PW,
      displayName: "QA 자동확인",
      role: "security_officer",
    }),
  }, token);
  if (!생성.ok) 죽는다(`계정 생성 실패 ${생성.status} — ${생성.본문?.error ?? ""}`);
  id = 생성.본문.id;
  console.log(`✓ 계정을 만들었다: ${QA_USER} (${id})`);
}

// ③ 열람 등급을 기밀(C)로 — **이걸 빼면 공개 문서만 보인다**
const 등급 = await 부른다(`/api/users/${id}/clearance`, {
  method: "POST",
  body: JSON.stringify({ clearance: "C" }),
}, token);
if (!등급.ok) 죽는다(`등급 변경 실패 ${등급.status} — ${등급.본문?.error ?? ""}`);
console.log(`✓ 열람 등급 = C(기밀)`);

// ④ **정말 되는지 확인한다** — 만들었다는 응답과 로그인이 되는 것은 다른 얘기다.
const 확인 = await 부른다("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: QA_USER, password: QA_PW }),
});
if (!확인.ok) {
  await 나간다(ADMIN, token, adminRefresh);
  죽는다(`만들긴 했는데 로그인이 안 된다 ${확인.status} — 비밀번호를 확인할 것.`);
}

// 등급이 **정말 저장됐는지** 계정 자신의 눈으로 읽는다. 응답이 왔다는 것과 남았다는 것은 다르다.
const 나 = await 부른다("/api/auth/me", {}, 확인.본문.accessToken);
const 등급확인 = 나.본문?.clearance ?? "null(공개만)";
console.log(`✓ ${QA_USER}로 로그인 확인 (401 아님, ${확인.status}) · 저장된 등급 = ${등급확인}`);
if (등급확인 !== "C") console.log("★ 등급이 C가 아니다 — 민감·기밀 문서가 안 보인다. 확인할 것.");

// 세션을 비우고 나간다 — 사람이 바로 앱에 들어갈 수 있어야 한다.
await 나간다(QA_USER, 확인.본문.accessToken, 확인.본문.refreshToken);
await 나간다(ADMIN, token, adminRefresh);

console.log(`\n서버: ${BASE}`);
console.log("완료 — 비밀번호는 어디에도 찍지 않았고, 세션도 남기지 않았다.");
