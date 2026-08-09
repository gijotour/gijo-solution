// GIJO AS 클라이언트 — API 공통 심장부(2026-08-06 apiClient.ts 분리)
// 서버 주소·토큰 보관과 request() 한 벌 — 모든 도메인 api/*.ts가 여기만 의존한다.
// 서버(gijo-as-server)와의 모든 통신은 이 모듈을 통해서만 이루어진다.
// preload.ts가 이 모듈을 사용해 window.gijo.* 표면을 구성한다.
//
// 인증: 로그인 성공 시 서버가 발급한 access token(짧은 만료, JWT) + refresh token(회전형)을 보관한다.
// [실기동 검증 중 발견된 버그] 이 페이지들은 SPA가 아니라 매번 mainWindow.loadFile()로
// 전체 페이지 네비게이션을 한다 — Electron은 네비게이션마다 preload 스크립트를 처음부터
// 다시 실행하므로, 모듈 내부 변수에만 저장하면 로그인 직후 다음 페이지로
// 이동하는 순간 토큰이 사라져 즉시 로그인 화면으로 튕기는 무한 루프가 발생했다.
// 그래서 메인 프로세스(페이지 이동에도 살아있는 유일한 곳)에 상태를 동기 IPC로 위임한다.
import { ipcRenderer } from "electron";

const DEFAULT_SERVER_URL = process.env.GIJO_SERVER_URL ?? "http://localhost:4000";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
}

const persisted = ipcRenderer.sendSync("auth:getState") as AuthState;

let serverUrl = persisted.serverUrl ?? DEFAULT_SERVER_URL;
let accessToken: string | null = persisted.accessToken;
let refreshToken: string | null = persisted.refreshToken;

function persist(): void {
  ipcRenderer.send("auth:setState", { accessToken, refreshToken, serverUrl });
}

export function setServerUrl(url: string): void {
  serverUrl = url.replace(/\/+$/, "");
  persist();
}

export function getServerUrl(): string {
  return serverUrl;
}

export function setAuthTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  persist();
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export function isAuthenticated(): boolean {
  return accessToken !== null;
}

interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  skipAuthRetry?: boolean;
}

// access token이 만료돼 401이 오면, refresh token으로 한 번만 조용히 재발급받고 원 요청을 재시도한다.
// refresh도 실패하면(만료/폐기) 토큰을 지워서 다음 API 호출들이 즉시 401로 실패 -> 각 페이지의
// isAuthenticated() 가드가 로그인 화면으로 돌려보낸다.
//
// [2026-07-26 실사용 사고] 서버의 refresh token은 회전형(한 번 쓰면 즉시 폐기)이다. 그런데
// 토큰 사본이 이 모듈의 지역 변수에도 있어서, 창·프레임이 여럿이면 각자 낡은 사본을 들고 있다.
// 한 창이 갱신에 성공해 토큰이 회전하면 나머지는 폐기된 토큰으로 갱신을 시도해 실패하고,
// 실패 처리로 공용 상태까지 지워버려 멀쩡하던 세션이 통째로 끊겼다
// (증상: 업로드는 되는데 "리포트 저장 실패 401 unauthorized").
// 그래서 ① 갱신은 이 컨텍스트에서 한 번만 돌고(single-flight), ② 갱신 전후로 메인 프로세스의
// 공용 상태를 다시 읽어 남이 이미 갱신했으면 그 토큰을 받아 쓰고, ③ 내가 쓴 토큰이 여전히
// 최신일 때만 지운다.
function readShared(): AuthState {
  const s = ipcRenderer.sendSync("auth:getState") as AuthState;
  accessToken = s.accessToken;
  refreshToken = s.refreshToken;
  if (s.serverUrl) serverUrl = s.serverUrl;
  return s;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(usedAccessToken: string | null): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    // 다른 창이 이미 갱신했다면 새 토큰을 받아 쓰기만 하면 된다.
    const shared = readShared();
    if (shared.accessToken && shared.accessToken !== usedAccessToken) return true;
    if (!refreshToken) return false;

    const usedRefresh = refreshToken;
    const res = await fetch(`${serverUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: usedRefresh }),
    }).catch(() => null);

    if (!res || !res.ok) {
      // 내가 보내는 사이에 남이 갱신했을 수 있다 — 다시 읽어 확인하고, 그래도 그대로면 그때 지운다.
      const after = readShared();
      if (after.accessToken && after.accessToken !== usedAccessToken) return true;
      if (after.refreshToken === usedRefresh) setAuthTokens(null);
      return false;
    }
    const result = (await res.json()) as { accessToken: string; refreshToken: string };
    setAuthTokens(result);
    return true;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// 답 스트리밍(전-7) — SSE(POST)를 읽어 delta를 콜백으로 흘리고, done의 result를 돌려준다.
// request()와 같은 401-1회-재발급 계약. done 없이 끊기면 **끊겼다고 던진다**(잘린 답을
// 완성인 척 두지 않는다 — 시안의 정직 규칙).
export async function requestStream<T = unknown>(
  path: string,
  body: unknown,
  on: { start?: () => void; delta?: (text: string) => void }
): Promise<T> {
  const 한번 = async (retry: boolean): Promise<T> => {
    const sentToken = accessToken;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sentToken) headers["Authorization"] = `Bearer ${sentToken}`;
    const res = await fetch(`${serverUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.status === 401 && retry && (await tryRefresh(sentToken))) return 한번(false);
    if (!res.ok || !res.body) throw new Error(`GIJO AS 서버 오류 ${res.status} ${path.split("?")[0]}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let 결과: T | undefined;
    let 오류: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const 블록 = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = 블록.match(/^data: ([\s\S]*)$/);
        if (!m) continue;
        try {
          const ev = JSON.parse(m[1]) as { t: string; text?: string; result?: T; message?: string };
          if (ev.t === "start") on.start?.();
          else if (ev.t === "delta") on.delta?.(ev.text ?? "");
          else if (ev.t === "done") 결과 = ev.result;
          else if (ev.t === "error") 오류 = ev.message ?? "알 수 없는 오류";
        } catch { /* 깨진 이벤트는 건너뛴다 */ }
      }
    }
    if (오류) throw new Error(오류);
    if (결과 === undefined) throw new Error("답이 중간에 끊겼습니다 — 다시 물어봐 주세요.");
    return 결과;
  };
  return 한번(true);
}

export async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sentToken = accessToken;
  if (sentToken) headers["Authorization"] = `Bearer ${sentToken}`;

  const res = await fetch(`${serverUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.skipAuthRetry && (await tryRefresh(sentToken))) {
    return request<T>(path, { ...opts, skipAuthRetry: true });
  }

  if (!res.ok) {
    // ⚠ 담당자가 읽는 첫 줄이 무엇인지가 중요하다.
    //   예전엔 "GIJO AS 서버 오류 500 /api/law/search?query=%EA%B0%9C%EC%9D%B8… {"error":"…"}"
    //   처럼 **인코딩된 URL과 JSON 껍데기가 앞에** 오고, 정작 서버가 적어 보낸 한글 사유는
    //   저 뒤에 묻혔다(2026-07-29 실측). 사유를 아는데 못 읽게 만드는 건 없느니만 못하다.
    //   서버가 error/message를 주면 **그걸 그대로 앞에** 세우고, 기술 정보는 뒤에 괄호로 붙인다.
    let 사유 = "";
    let detail = "";
    try {
      const body = (await res.json()) as Record<string, unknown>;
      detail = JSON.stringify(body);
      // message(사람이 읽는 문장)를 error(기계 코드)보다 **앞세운다**. 둘 다 있으면 예전 코드가
      // error를 골라 "password_required" 같은 영문 코드를 담당자에게 첫 줄로 보여줬다
      // (2026-07-30 발견). 코드는 클라이언트가 분기용으로 쓰는 값이고 사람에게 읽힐 말이 아니다.
      const m = body?.message ?? body?.error;
      if (typeof m === "string" && m.trim()) 사유 = m.trim();
    } catch {
      /* 응답 본문이 JSON이 아닌 경우 무시 */
    }
    throw new Error(
      사유
        ? `${사유}\n(서버 오류 ${res.status} · ${path.split("?")[0]})`
        : `GIJO AS 서버 오류 ${res.status} ${path} ${detail}`
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
