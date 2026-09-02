// GIJO AS 클라이언트 API — 인증·계정 관리
// 2026-08-06 apiClient.ts(2,141줄)에서 분리 — 구역 본문은 원문 그대로, 공통은 core.ts.
import { request } from "./core";
import { getServerUrl, setAuthTokens, getRefreshToken } from "./core";

// ── 인증 ──────────────────────────────────────────────────────────────
// 중복로그인 방지: 이미 다른 곳에서 로그인 중이면 서버가 409(already_logged_in)를 준다.
// request()의 예외는 contextBridge를 건너며 커스텀 속성이 사라지므로, login()은 던지지 않고
// 결과를 구조화된 값으로 돌려준다 — 렌더러가 "강제 로그인하시겠습니까?" 확인 UI를 그릴 수 있게.
export interface LoginResult {
  ok: boolean;
  code?: "already_logged_in" | "invalid_credentials" | "locked" | "error" | "mfa_required";
  /**
   * 중복 로그인일 때 **이미 붙어 있는 자리**(2026-09-02 F2-07 승인 시안).
   * 예전엔 「이미 다른 곳에서 로그인 중입니다」만 있어서, 담당자는 그것이 **자기가 아까 쓰던
   * 자리인지 남인지** 알 수 없었다 — 보안 제품에서 그 구분이 「밀고 들어갈까」의 근거다.
   * ⚠ 서버가 새로 세는 값이 아니다. 세션 기록에 이미 있던 것을 실어 보낼 뿐이다.
   */
  기존접속?: { ip: string | null; since: number | null; lastSeenAt: number | null };
  message?: string;
  user?: { id: string; displayName: string; role: string };
  // 2차 인증이 켜진 계정 — 이 값을 들고 loginMfa()로 6자리(또는 복구 코드)를 보낸다.
  // ⚠ 이 시점에는 아직 세션이 없다(setAuthTokens를 부르지 않는다) — 토큰은 2단계 성공 때만 저장한다.
  mfaToken?: string;
  // 관리자 2차 인증 필수 정책이 켜졌는데 아직 등록하지 않은 계정 — 등록 화면으로 보내야 한다.
  // 이 세션은 등록 관련 API만 부를 수 있다(서버가 그 밖의 경로를 403으로 막는다).
  enrollRequired?: boolean;
  // 복구 코드로 들어왔을 때 — 남은 개수를 알려 다시 발급하도록 유도한다.
  recoveryUsed?: boolean;
  recoveryRemaining?: number;
  // 비밀번호를 틀렸을 때 **몇 번 남았는지**(F8-09). 문장은 서버가 만들어 message에 싣는다 —
  // 이 숫자는 「경고를 띄울지」를 정할 때만 쓴다(임계·잠금 시간을 화면이 갖지 않게).
  remaining?: number;
}

interface LoginBody {
  accessToken?: string;
  refreshToken?: string;
  user?: { id: string; displayName: string; role: string };
  error?: string;
  message?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
  enrollRequired?: boolean;
  recoveryUsed?: boolean;
  recoveryRemaining?: number;
  remaining?: number;
}

function loginFailure(status: number, data: LoginBody): LoginResult {
  const code =
    // ⚠ 아래 코드 판정은 그대로 두고, 본문의 기존접속만 그대로 넘긴다(모양이 다르면 화면이 안 그린다).
    status === 409 && data.error === "already_logged_in" ? "already_logged_in"
    : status === 429 ? "locked"
    : "invalid_credentials";
  // 남은 횟수는 **서버가 줄 때만** 싣는다 — 없으면 없는 대로 둔다(모르는 것을 0으로 만들지 않는다).
  return {
    ok: false, code,
    message: data.message ?? data.error ?? "로그인에 실패했습니다.",
    ...(typeof data.remaining === "number" ? { remaining: data.remaining } : {}),
  };
}

// 로그인 요청 시간제한 — 응답 없는 주소(방화벽 drop·엉뚱한 IP)를 넣으면 Windows TCP가
// 20초 넘게 매달려 「연결 중...」 버튼이 굳은 채 손쓸 길이 없었다(F2-06, 2026-09-02).
// ⚠ 이 값의 단일 출처는 여기 한 곳이다 — 아래 문구도 이 상수에서 초를 만들어 쓴다.
const 로그인제한밀리초 = 8000;

// 연결 자체가 안 된 경우의 한국어 사유 — **시간 초과**와 **그 밖의 연결 실패**를 가른다.
// 둘을 뭉뚱그리면 담당자가 「주소를 고칠지 더 기다릴지」를 판단할 수 없다.
function 연결실패문구(e: unknown): string {
  const 이름 = (e as { name?: string } | null)?.name;
  return 이름 === "TimeoutError" || 이름 === "AbortError"
    ? `서버가 ${Math.round(로그인제한밀리초 / 1000)}초 안에 응답하지 않았습니다 — 서버 주소와 사내망(VPN) 연결을 확인하세요.`
    : "서버에 연결할 수 없습니다 — 서버 주소와 사내망(VPN) 연결을 확인하세요.";
}

export const authApi = {
  login: async (username: string, password: string, force = false): Promise<LoginResult> => {
    // ⚠ 시간제한을 준다(F2-06) — 없으면 응답 없는 주소에서 버튼이 수십 초 굳는다.
    //   그리고 **왜 실패했는지**를 담아 돌려준다: 예전엔 사유가 한 문장으로 뭉개져
    //   화면이 「아이디/비밀번호를 확인하세요」로 엉뚱한 곳을 가리켰다.
    let 실패사유 = 연결실패문구(null);
    const res = await fetch(`${getServerUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, ...(force ? { force: true } : {}) }),
      signal: AbortSignal.timeout(로그인제한밀리초),
    }).catch((e: unknown) => { 실패사유 = 연결실패문구(e); return null; });
    if (!res) return { ok: false, code: "error", message: 실패사유 };
    const data = (await res.json().catch(() => ({}))) as LoginBody;
    if (!res.ok) return loginFailure(res.status, data);
    // 2차 인증이 켜진 계정 — 아직 로그인이 끝나지 않았다. 토큰을 저장하지 않는다.
    if (data.mfaRequired) {
      return { ok: false, code: "mfa_required", mfaToken: data.mfaToken, user: data.user };
    }
    setAuthTokens({ accessToken: data.accessToken!, refreshToken: data.refreshToken! });
    return { ok: true, user: data.user, enrollRequired: data.enrollRequired };
  },

  // 로그인 2단계 — 인증앱의 6자리 또는 복구 코드 하나.
  loginMfa: async (mfaToken: string, code: string, isRecovery = false): Promise<LoginResult> => {
    // 2단계도 같은 제한을 쓴다(F2-06) — 1단계만 고치면 6자리를 넣은 뒤에 똑같이 굳는다.
    let 실패사유 = 연결실패문구(null);
    const res = await fetch(`${getServerUrl()}/api/auth/login/mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, ...(isRecovery ? { recoveryCode: code } : { code }) }),
      signal: AbortSignal.timeout(로그인제한밀리초),
    }).catch((e: unknown) => { 실패사유 = 연결실패문구(e); return null; });
    if (!res) return { ok: false, code: "error", message: 실패사유 };
    const data = (await res.json().catch(() => ({}))) as LoginBody;
    if (!res.ok) return loginFailure(res.status, data);
    setAuthTokens({ accessToken: data.accessToken!, refreshToken: data.refreshToken! });
    return {
      ok: true, user: data.user,
      recoveryUsed: data.recoveryUsed, recoveryRemaining: data.recoveryRemaining,
    };
  },
  logout: async () => {
    await request("/api/auth/logout", { method: "POST", body: { refreshToken: getRefreshToken() } });
    setAuthTokens(null);
  },
  // 2차 인증 — 로그인 뒤(설정 화면)에서 쓰는 등록·해제·관리자 관리.
  mfaStatus: () =>
    request<{
      enabled: boolean; enrolling: boolean; enabledAt: number | null; lastUsedAt: number | null;
      recoveryRemaining: number; serverTime: number; stepSeconds: number; requiredForAdmin: boolean;
    }>("/api/auth/mfa/status"),
  mfaStart: () =>
    request<{ secretDisplay: string; uri: string; qrSvg: string | null }>("/api/auth/mfa/start", { method: "POST" }),
  mfaConfirm: (code: string) =>
    request<{ ok: boolean; recoveryCodes: string[]; accessToken?: string; refreshToken?: string }>(
      "/api/auth/mfa/confirm", { method: "POST", body: { code } }
    ).then((r) => {
      // 등록 전용 제한 세션이었다면 서버가 정상 세션으로 올려 준다 — 받은 자리에서 갈아 끼운다.
      if (r.accessToken && r.refreshToken) setAuthTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      return r;
    }),
  mfaDisable: (password: string) => request<{ ok: boolean }>("/api/auth/mfa/disable", { method: "POST", body: { password } }),
  mfaRegenerateRecovery: (password: string) =>
    request<{ ok: boolean; recoveryCodes: string[] }>("/api/auth/mfa/recovery", { method: "POST", body: { password } }),
  mfaUserList: () =>
    request<{ id: string; username: string; displayName: string; role: string; enabled: boolean; enabledAt: number | null; recoveryRemaining: number }[]>(
      "/api/users/mfa"
    ),
  mfaResetUser: (userId: string) => request<{ ok: boolean }>(`/api/users/${userId}/mfa/reset`, { method: "POST" }),
  mfaPolicy: () =>
    request<{ requireForAdmin: boolean; blocked: { id: string; username: string; displayName: string }[] }>(
      "/api/auth/mfa/policy"
    ),
  mfaSetPolicy: (on: boolean) =>
    request<{ ok: boolean; requireForAdmin: boolean; blocked: { username: string }[] }>(
      "/api/auth/mfa/policy", { method: "POST", body: { on } }
    ),
  me: () => request("/api/auth/me"),
  sessions: () => request<ActiveSessionInfo[]>("/api/auth/sessions"),
};

// 접속 중 세션(외부 콘솔 클라이언트) — 팀 사무실 창 presence 표시용.
export interface ActiveSessionInfo {
  userId: string;
  username: string;
  displayName: string;
  role: "security_officer" | "admin";
  ip: string | null;
  since: number;
  lastSeenAt: number;
}

// ── 계정 관리 (admin 전용 목록/생성/삭제, 본인 비밀번호 변경은 누구나) ──────
export interface GijoUserPublic {
  id: string;
  username: string;
  displayName: string;
  role: "security_officer" | "admin";
  team: string | null; // 소속 팀 — 자산(owner)과 매칭해 조치 검증 권한을 판정
  createdAt: number;
}

export const usersApi = {
  list: () => request<GijoUserPublic[]>("/api/users"),
  // 조치 담당자 배정용(승인 화면 자동완성) — 관리자 아니어도 조회 가능.
  assignable: () => request<{ id: string; displayName: string; role: string; team: string | null }[]>("/api/users/assignable"),
  // 소속 팀 지정 — assets.owner와 매칭해 조치 검증 실행 권한을 판정한다(관리자 전용).
  setTeam: (id: string, team: string | null) =>
    request<GijoUserPublic>(`/api/users/${encodeURIComponent(id)}/team`, { method: "POST", body: { team } }),
  create: (args: { username: string; password: string; displayName: string; role: "security_officer" | "admin" }) =>
    request<GijoUserPublic>("/api/users", { method: "POST", body: args }),
  remove: (id: string) => request(`/api/users/${id}`, { method: "DELETE" }),
  changePassword: (id: string, password: string) =>
    request(`/api/users/${id}/password`, { method: "POST", body: { password } }),
  // 열람 등급(기밀 C·민감 S·공개 O) — 관리자만. 서버가 감사에 남긴다.
  setClearance: (id: string, clearance: string) =>
    request<GijoUserPublic>(`/api/users/${id}/clearance`, { method: "POST", body: { clearance } }),
  setRole: (id: string, role: "security_officer" | "admin") =>
    request<GijoUserPublic>(`/api/users/${id}/role`, { method: "POST", body: { role } }),
  sessions: () => request<ActiveSessionInfo[]>("/api/users/sessions"),
  terminateSession: (id: string) => request<{ terminated: boolean }>(`/api/users/${id}/terminate-session`, { method: "POST" }),
};

export interface ActiveSessionInfo { userId: string; username: string; displayName: string; role: "security_officer" | "admin"; ip: string | null; since: number; lastSeenAt: number }
