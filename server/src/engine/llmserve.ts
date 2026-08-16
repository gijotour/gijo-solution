// engine/llmserve.ts — **이 PC의 GPU를 VPN 안의 다른 GIJO에게 내준다**(원격 GPU의 「받는 쪽」).
//
// ■ 왜 필요한가 (2026-08-14에 드러난 구멍)
//   remotellm.ts로 「원격 GPU에 붙는 쪽」은 만들었고, 화면에서도 고르게 했다. 그런데 실측하며
//   드러났다 — **붙을 상대를 만드는 길이 없었다.** llama-server는 `--host`를 안 줘서
//   127.0.0.1에만 바인드된다(localengine.ts:583). 그래서 큰 GPU가 있는 기계에 GIJO를 깔아도
//   옆 노트북이 붙을 수가 없었다. 「설정에서 주소를 넣으세요」가 또 한 겹 위에서 광고만 되는
//   자리였다 — 이 기능이 처음 생긴 이유가 정확히 그 문제였다.
//
// ■ 왜 llama를 직접 열지 않고 GIJO가 중계하나
//   ① llama-server를 0.0.0.0에 열면 **인증이 전혀 없는 추론 서버**가 망에 뜬다. 우리가 켜고 끄고
//      대역을 판정할 자리가 없다.
//   ② 모델 풀은 포트가 여럿이고 스왑으로 바뀐다(localengine). 그 포트들을 다 여는 것은 더 나쁘다.
//   ③ GIJO 서버 포트 하나만 쓰면 방화벽·VPN 설정이 한 줄로 끝난다.
//   그래서 **GIJO가 OpenAI 호환 창구를 흉내 내 로컬 llama로 넘긴다.**
//
// ■ 경계 (문구가 아니라 코드가 지킨다 — remotellm.ts와 같은 자세)
//   ① 기본 **꺼짐**. admin이 명시적으로 켠다.
//   ② 요청이 **VPN·사설 대역에서 와야 한다**. 공인 IP에서 오면 거절 — 판정은 airgap.ts의
//      isVpnRangeIp 한 곳(새 판정기를 만들지 않는다).
//   ③ **에어갭이면 켜져 있어도 막는다**(원격 제공도 바깥과의 통신이다).
//   ④ 프록시 대상은 **로컬 llama뿐**이다. 임의 URL로 못 넘긴다(열린 중계기가 되면 안 된다).
//
// ⚠ **접속 토큰이 붙었다**(2026-08-16). 처음엔 「VPN 전용이니 VPN 안은 신뢰 경계」라 무인증이었는데,
//   그 판정이 사설 대역 전체(사무실 LAN 포함)라 문서에 자백해야 했다. 이제 켤 때 토큰을 만들어
//   주소에 실어 주고, 붙는 쪽이 헤더로 제시해야 통과한다 — 「사설 대역이면 누구나」가 「토큰을
//   아는 쪽만」이 됐다. 토큰 없는 옛 켜짐은 llmServeOn()이 「꺼짐」으로 막는다.
import express from "express";
import type { Express, Request, Response } from "express";
import { Readable, pipeline } from "node:stream";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isAirgapOn, isVpnRangeIp } from "./airgap";
import { recordAudit } from "./audit";

/** 접속 토큰을 새로 만든다 — URL에 실려도 무방한 24바이트 base64url(사람이 안 정한다). */
function 토큰생성(): string {
  return randomBytes(24).toString("base64url");
}

/** 상수시간 비교 — 한 글자씩 맞혀보는 타이밍 공격을 막는다. 길이가 다르면 즉시 false. */
function 토큰일치(준값: string, 설정값: string): boolean {
  const a = Buffer.from(준값);
  const b = Buffer.from(설정값);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * 이 서버가 실제로 듣는 포트.
 *
 * ⚠ `process.env.PORT`가 아니다 — 이 저장소는 **아무 데서도 PORT를 넣지 않는다.**
 *   실제 값은 `GIJO_SERVER_PORT`(index.ts:42)이고, 번들 클라는 라이트 7445·표준 7446으로 띄운다.
 *   처음에 PORT로 읽었더니 카드가 **항상 4000**을 보여, 상대에게 알려 줄 주소가 틀렸다
 *   (검토관 지적 H2 — 「붙을 상대가 없다」가 한 겹 위에서 재발할 자리였다).
 *   index.ts와 **같은 식**을 쓴다. 어긋나면 serve-port 시험이 실패한다.
 */
export function servePort(): number {
  return Number(process.env.GIJO_SERVER_PORT ?? 4000);
}

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const STATE_KEY = "llm_serve";

export interface LlmServeConfig {
  enabled: boolean;
  lastServedAt: number | null; // 마지막으로 남의 요청을 받아넘긴 시각 — 화면이 「쓰이고 있나」를 보인다
  // 접속 토큰 — 붙는 쪽이 헤더로 제시해야 통과한다(2026-08-16 신설).
  //   ⚠ 이것이 있으면 「사설 대역이면 누구나」가 아니라 「토큰을 아는 쪽만」이 된다 —
  //     문서에 자백해야 했던 「사무실 LAN의 다른 PC도 붙는다」가 이걸로 닫힌다.
  //   ⚠ 켤 때 서버가 만들어 준다(사람이 정하지 않는다 — 약한 토큰 방지). 주소와 함께 복사된다.
  token: string | null;
}

export function llmServeConfig(): LlmServeConfig {
  try {
    const row = getStateStmt.get(STATE_KEY) as { value: string } | undefined;
    if (!row) return { enabled: false, lastServedAt: null, token: null };
    const v = JSON.parse(row.value) as Partial<LlmServeConfig>;
    return {
      enabled: v.enabled === true,
      lastServedAt: typeof v.lastServedAt === "number" ? v.lastServedAt : null,
      token: typeof v.token === "string" && v.token ? v.token : null,
    };
  } catch {
    return { enabled: false, lastServedAt: null, token: null };
  }
}

function save(c: LlmServeConfig): void {
  setStateStmt.run(STATE_KEY, JSON.stringify(c));
}

/**
 * 내주는 중인가 — 에어갭이면 켜져 있어도 아니다(저장 뒤 에어갭을 켠 경우가 새지 않게).
 *
 * ⚠ **토큰이 없는 켜짐은 「꺼짐」으로 본다**(2026-08-16 관문 게이트). 토큰 인증을 배포하기
 *   **전에** 이미 enabled:true로 저장된 상태는 token 필드가 없어, 「토큰 있을 때만 검사」
 *   하위호환이 그 창구를 **무인증 그대로** 뚫리게 했다 — 이 커밋의 목적(무인증을 닫는다)이
 *   정작 기존 켜짐엔 반쪽이 되는 자리다. 토큰 없는 켜짐은 열지 않는다: admin이 한 번 껐다
 *   켜면 토큰이 발급돼 정상 동작한다. 「덜 안전한 채로 조용히 도는 것」보다 「안 열리는 것」이 낫다.
 */
export function llmServeOn(): boolean {
  if (isAirgapOn()) return false;
  const c = llmServeConfig();
  return c.enabled && Boolean(c.token);
}

/**
 * 요청을 보낸 쪽이 VPN·사설 대역인가.
 *
 * ⚠ req.ip는 프록시 뒤에서 바뀔 수 있다. 우리 배포는 앞단 프록시가 없지만, 누가 앞에 두면
 *   X-Forwarded-For를 **믿지 않는다** — 헤더는 보내는 쪽이 지어낼 수 있어서, 그걸 믿으면
 *   공인 IP가 사설인 척할 수 있다. 소켓 주소만 본다.
 */
export function requesterAllowed(req: Request): boolean {
  const raw = req.socket?.remoteAddress ?? "";
  // ::ffff:10.8.0.11 같은 IPv4-mapped IPv6를 벗긴다.
  const host = raw.replace(/^::ffff:/, "");
  if (host === "::1") return true; // 같은 기계(IPv6 루프백)
  return isVpnRangeIp(host);
}

/**
 * **브라우저에서 온 요청인가** — 그렇다면 거절한다.
 *
 * ⚠ 왜 필요한가 (검토관 지적 H1, 실측으로 확인됨)
 *   이 창구는 인증이 없고 관문이 **소켓 주소**만 본다. 그런데 이 서버의 CORS는
 *   `GIJO_CORS_ORIGINS`가 없으면 **모든 오리진을 허용**한다(app.ts:108-115). 그래서
 *   사무실 PC(사설 IP)에서 담당자가 아무 웹사이트를 열면, **그 페이지의 자바스크립트가**
 *   이 창구를 부를 수 있었다 — 소켓 주소는 브라우저가 있는 사설 IP라 관문을 통과하고,
 *   응답에 `Access-Control-Allow-Origin: *`이 붙어 크로스오리진으로 **읽히기까지** 했다.
 *   2026-08-14 실측: `Origin: https://evil.example.com`으로 HTTP 200 + ACAO `*`.
 *   즉 신뢰 경계가 「VPN 안의 GIJO」가 아니라 「사설망 브라우저가 방문한 임의의 웹사이트」였다.
 *
 * 판정: `Origin` 또는 `Referer`가 있으면 브라우저(또는 브라우저를 흉내 낸 것)로 본다.
 *   서버 대 서버 호출(우리 GIJO의 fetch)은 이 헤더를 보내지 않는다.
 *   ⚠ 헤더가 없다고 안전하다는 뜻은 아니다 — 그건 소켓 대역 판정이 맡는다. 여기서 막는 것은
 *     **브라우저가 남의 페이지 지시로 이 창구를 부르는 길**이다(CSRF와 같은 부류).
 */
export function browserOriginated(req: Request): boolean {
  const h = req.headers ?? {};
  return Boolean(h.origin || h.referer);
}

/**
 * **앞단에 프록시가 있나** — 있으면 이 창구를 닫는다.
 *
 * ⚠ 왜 (검토관 지적 M2 — fail-open이었다)
 *   대역 판정은 소켓 주소를 본다. 그런데 고객이 서버 앞에 nginx 같은 것을 두면 **모든 요청의
 *   소켓 주소가 127.0.0.1**이 되어, 인터넷에서 온 것까지 전부 「사설」로 통과한다.
 *   「X-Forwarded-For를 안 믿는다」는 신중해 보이지만, 그 헤더를 무시한 결과가 **전원 통과**라
 *   방향이 거꾸로였다. 모르면 막는다(airgap의 default-deny와 같은 자세).
 * ⚠ 우리 배포에는 프록시가 없다 — 그래서 평소에는 이 검사가 아무 일도 하지 않는다.
 *   프록시를 둔 고객에게는 창구가 안 열리고, 그 이유를 화면과 응답이 말한다.
 */
export function proxyDetected(req: Request): boolean {
  const h = (req.headers ?? {}) as Record<string, unknown>;
  return Boolean(h["x-forwarded-for"] || h["x-real-ip"] || h["forwarded"] || h["x-forwarded-host"]);
}

/**
 * 동시에 받아 줄 추론 수.
 *
 * ⚠ 왜 (검토관 지적 M5) — 무인증 경로에 상한이 없으면 사설망의 아무 장치가 요청을 몰아넣어
 *   이 PC의 GPU를 독차지할 수 있다. 게다가 외부 요청이 모델 로드를 유발해 **로컬 사용자의
 *   모델을 밀어낼** 수도 있다. 내주는 것은 호의이지 무제한 위임이 아니다.
 */
const 동시상한 = Number(process.env.GIJO_SERVE_CONCURRENCY ?? 2);
let 처리중 = 0;
export function serveInFlight(): { 처리중: number; 상한: number } {
  return { 처리중, 상한: 동시상한 };
}

/**
 * 거절을 **접어서** 로그로 남긴다 — DB에 쓰지 않는다.
 *
 * ⚠ 왜 (재검토 B-1) 무인증 경로에서 요청마다 감사 INSERT를 하면, 두드리는 쪽이 그대로
 *   **쓰기 원시기능**을 갖는다: audit_log가 부풀어 실제 보안 사건이 최신 목록에서 밀려나고,
 *   better-sqlite3 동기 쓰기가 이벤트 루프를 멈춰 전 사용자가 느려진다.
 *   같은 출처는 1분에 한 줄만 남기고 나머지는 센다 — 사후에 「누가 두드렸나」는 남되 값은 싸다.
 */
const 거절기록 = new Map<string, { 시각: number; 건수: number }>();
function 거절로그(보낸곳: string, 사유: string): void {
  const now = Date.now();
  const 이전 = 거절기록.get(보낸곳);
  if (이전 && now - 이전.시각 < 60_000) { 이전.건수 += 1; return; }
  if (이전 && 이전.건수 > 1) console.warn(`[llmserve] ${보낸곳} 거절 ${이전.건수}건(직전 1분)`);
  거절기록.set(보낸곳, { 시각: now, 건수: 1 });
  console.warn(`[llmserve] 거절: ${보낸곳} — ${사유}`);
  // 표가 무한히 자라지 않게 정리한다.
  // ⚠ 예전엔 「size>500 **그리고** 5분 지난 것」만 지웠다(3차 검토 L-1): 살아 있는 출처가
  //   500을 넘으면 **아무것도 안 지워지고 계속 자랐다.** 상한이 상한이 아니었다.
  //   ▶ 오래된 것을 먼저 지우고, 그래도 넘치면 **가장 오래된 것부터 잘라** 500을 지킨다.
  if (거절기록.size > 500) {
    for (const [k, v] of 거절기록) if (now - v.시각 > 300_000) 거절기록.delete(k);
    if (거절기록.size > 500) {
      const 오래된순 = [...거절기록.entries()].sort((a, b) => a[1].시각 - b[1].시각);
      for (const [k] of 오래된순.slice(0, 거절기록.size - 500)) 거절기록.delete(k);
    }
  }
}

/**
 * 로컬 llama의 OpenAI 호환 base URL(기본 모델). 내줄 수 없으면 null.
 *
 * ⚠ `ensureAgentModel`은 **모델이 없어도 기본 포트 URL을 돌려준다**(localengine.ts:1083-1085).
 *   그래서 그것만 믿으면 모델이 하나도 없는 기계에서도 「내주는 중」으로 보이고, 붙는 쪽은
 *   502 「닿지 못했습니다」를 받는다 — 원인은 「모델이 없음」인데 「닿지 못함」이라고 말하는 것이다
 *   (검토관 지적 M12). 그래서 **모델 파일이 있는지 먼저 본다.**
 */
// 미배정 판정용 찌르기의 결과를 잠깐 기억한다(10초).
// ⚠ 왜(3차 검토 L-3): 캐시가 없으면 **요청마다** 로컬 왕복이 하나 늘고, GET /models는 같은
//   엔드포인트를 두 번(찌르기+본 호출) 부른다. 10초면 「모델을 방금 올렸는데 안 잡힌다」가
//   체감되지 않을 만큼 짧고, 요청 폭주 때 찌르기 폭주를 막을 만큼은 길다.
let 찔러본 = { 시각: 0, 살아있음: false };

async function localBaseUrl(): Promise<string | null> {
  try {
    const m = await import("./localengine.js");
    const { getAgentModel } = await import("./agents.js");
    const 배정 = getAgentModel("analysis");
    if (배정 && !m.isModelAvailable(배정)) return null;
    const base = await m.ensureAgentModel("analysis");
    // ⚠ **미배정일 때가 문제였다**(재검토 A-4). 배정이 없으면 ensureAgentModel이 모델 유무와
    //   무관하게 기본 포트 URL을 준다 — 모델이 0개인 기계는 대개 배정도 없다(미배정=조용한 폴백).
    //   그래서 붙는 쪽이 「모델이 없음」인데 「닿지 못했습니다」를 받았다. 실제로 서빙 중인지
    //   **한 번 찔러 본다**(파일 목록을 다시 세지 않는다 — 판정의 집은 localengine이다).
    if (!배정) {
      if (Date.now() - 찔러본.시각 > 10_000) {
        let 살아있음 = false;
        try {
          const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) });
          살아있음 = r.ok;
        } catch { /* 못 닿음 = 죽어 있음 */ }
        찔러본 = { 시각: Date.now(), 살아있음 };
      }
      if (!찔러본.살아있음) return null;
    }
    return base;
  } catch {
    return null;
  }
}

/**
 * 화면이 「상대에게 알려 줄 주소」를 만들 재료.
 *
 * ⚠ 서버는 자기 VPN 주소를 스스로 모른다(랜카드가 여럿이면 고를 수 없다). 대신 **이 연결을 받은
 *   주소**(socket.localAddress)를 안다 — 화면이 접속한 그 주소가 곧 상대가 쓸 주소다.
 * ⚠ 사설인지 판정은 **airgap.ts 한 곳**을 쓴다. 처음에는 화면이 정규식을 다시 만들어 뒀는데,
 *   서버 판정과 달라서(127.x·169.254.x 누락) 정상 상태에서도 「VPN 주소가 아닙니다」 경고가
 *   항상 떴다(검토관 지적 M6). 판정을 두 곳에 적으면 어긋난다 — 이 저장소의 반복 유형이다.
 */
function 주소재료(req: Request): { seenAddress: string; addressIsPrivate: boolean; port: number; token: string | null } {
  const raw = String(req.socket?.localAddress ?? "").replace(/^::ffff:/, "");
  // ⚠ 토큰은 화면이 주소 뒤에 `?token=…`으로 붙여 보여준다 — 붙는 쪽이 그 주소를 그대로
  //   넣으면 remotellm이 토큰을 떼어 헤더로 보낸다(사람이 토큰을 따로 다루지 않는다).
  return { seenAddress: raw, addressIsPrivate: raw ? 상대가쓸수있나(raw) : false, port: servePort(), token: llmServeConfig().token };
}

/**
 * **상대가 이 주소로 우리에게 붙을 수 있나** — 「사설인가」와 다른 질문이다.
 *
 * ⚠ 왜 따로 만들었나 (2026-08-14 재검토 A-2 — 내가 반쪽만 고쳤던 자리)
 *   화면의 사설 판정을 서버로 모을 때 `isVpnRangeIp`를 그대로 썼다. 그런데 그 함수는
 *   **루프백(127.x·::1)을 사설로 통과시킨다**(airgap.ts:58 — 에어갭 봉인에서는 맞는 판정이다).
 *   번들 배포는 클라가 `http://localhost:<포트>`로 붙으므로 socket.localAddress가 127.0.0.1이 되고,
 *   그러면 화면이 **경고를 끄고 「이 주소를 상대에게 주세요」라고 확언**했다 —
 *   상대에게 `http://127.0.0.1:7446/...`을 넘기게 된다. H2와 **똑같은 실패**(붙을 상대가 없다)의
 *   재발이고, 앞 검토가 「정상 상태에서도 경고가 떴다」고 한 그 상황은 실은 **정상이 아니었다.**
 *   ▶ 판정 단일화(옳은 절반)는 남기고, 루프백·링크로컬은 「상대가 못 쓰는 주소」로 가른다.
 */
export function 상대가쓸수있나(host: string): boolean {
  const h = String(host ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!h) return false;
  if (h === "::1" || h === "localhost" || h === "0.0.0.0") return false;
  if (/^127\./.test(h)) return false;          // 루프백 — 상대 기계에서는 자기 자신을 가리킨다
  if (/^169\.254\./.test(h)) return false;     // 링크로컬(자동 할당) — 라우팅되지 않는다
  if (h.startsWith("fe80")) return false;      // IPv6 링크로컬
  return isVpnRangeIp(h);
}

/**
 * **창구만** 등록한다 — 전역 JSON 파서보다 **먼저** 불려야 한다(app.ts).
 *
 * 왜 나눴나: 이 두 경로는 인증이 없어 본문 상한을 따로 걸어야 하는데, Express는 등록 순서대로
 * 미들웨어를 쌓는다. 전역 파서 뒤에 두면 이미 200mb로 읽힌 뒤라 소용이 없다.
 * 설정·조회 라우트(아래)는 인증이 있고 순서와 무관하므로 원래 자리에 그대로 둔다.
 */
export function registerLlmServeGateway(app: Express): void {
  // ── OpenAI 호환 창구 ────────────────────────────────────────────────────
  //   붙는 쪽(remotellm)이 기대하는 것은 `<base>/models`와 `<base>/chat/completions`다.
  //   그래서 base는 `http://<이 서버>:<포트>/api/llm/serve/v1`이 된다.
  //   ⚠ 이 두 경로는 **인증 미들웨어를 안 탄다**(VPN 대역 판정이 그 자리를 대신한다) —
  //     그래서 아래 관문을 **모든 경로에서 똑같이** 통과시킨다. 하나라도 빠지면 그게 구멍이다.
  const 관문 = (req: Request, res: Response): boolean => {
    const 보낸곳 = String(req.socket?.remoteAddress ?? "(미상)");
    // ⚠ **대역 판정이 맨 앞이다**(검토관 지적 M1). 예전엔 「꺼짐」을 먼저 답해서, 밖에서 훑는
    //   쪽이 무인증으로 「이건 GIJO다 · 에어갭이다」를 알아냈다. 밖에서 온 것은 전부 같은 404다 —
    //   있는지 없는지조차 알려주지 않는다.
    if (!requesterAllowed(req)) {
      // ⚠ 여기서 **감사를 남기지 않는다**(재검토 B-1). 이 자리는 인증 이전이라 아무나 두드릴 수
      //   있는데, 두드릴 때마다 SQLite에 동기 쓰기를 하면 ① 스캐너가 audit_log를 채워
      //   **실제 보안 사건이 최신 목록에서 밀려나고** ② 동기 쓰기가 이벤트 루프를 멈춰
      //   전 사용자 응답이 느려진다. 무인증 경로의 감사는 「기록」이 아니라 **쓰기 원시기능**이다.
      //   대신 거절은 같은 IP를 접어서 로그로만 남긴다(아래 거절로그).
      거절로그(보낸곳, "VPN 밖");
      res.status(404).json({ error: "not found" });
      return false;
    }
    // ⚠ 브라우저에서 온 것은 거절한다 — CORS가 모든 오리진을 허용하는 배포에서 남의 웹페이지가
    //   이 창구를 부를 수 있었다(H1, 실측 확인). 우리 GIJO의 서버 대 서버 fetch는 이 헤더가 없다.
    if (browserOriginated(req)) {
      거절로그(보낸곳, `브라우저 요청(${String(req.headers?.origin ?? req.headers?.referer ?? "")})`);
      // ⚠ 본문을 **404와 같게** 준다(재검토 B-7). 브라우저 갈래에는 CORS 헤더가 붙어 응답이
      //   크로스오리진으로 **읽히므로**, 「GIJO 창구다」라고 답하면 사내망 페이지가 포트를 훑어
      //   제품을 식별할 수 있다. 대역 밖에 아무것도 안 알려주기로 한 것과 같은 자세다.
      res.status(404).json({ error: "not found" });
      return false;
    }
    if (isAirgapOn()) { res.status(404).json({ error: "not found" }); return false; }
    // ⚠ llmServeOn()을 쓴다(단순 enabled가 아니라) — 토큰 없는 옛 켜짐은 여기서 「꺼짐」으로
    //   막힌다(관문 게이트). 그래야 배포 즉시 무인증 창구가 닫히고, admin이 껐다 켜 토큰을 받는다.
    if (!llmServeOn()) { res.status(404).json({ error: "이 서버는 원격 GPU 제공이 꺼져 있습니다." }); return false; }
    // ⚠ 앞단 프록시가 있으면 소켓 주소가 전부 127.0.0.1이라 대역 판정이 **전원 통과**가 된다(M2).
    //   모르면 막는다 — 이 창구는 「확실히 VPN 안」이 성립할 때만 열려야 한다.
    // ⚠ 이 검사는 **꺼짐 검사 뒤**에 둔다(3차 검토 L-2): 도움말 문구는 켠 운영자의 고객에게만
    //   의미가 있다. 기본값(꺼짐)에서 XFF를 끼워도 **프록시 안내 문구**는 얻지 못한다.
    //   ⚠ 정직하게: 이 재배열이 감춘 것은 프록시 안내뿐이다 — 꺼짐 404의 문구는 대역 안
    //   요청 공통이라 그대로다(사용안내서 「안 될 때」 표가 그 문구를 진단 근거로 쓴다).
    //   켠 뒤에는 운영자가 스스로 연 것이라 안내의 값이 지문 위험보다 크다.
    if (proxyDetected(req)) {
      거절로그(보낸곳, "앞단 프록시 감지");
      res.status(403).json({ error: "앞단에 프록시가 있어 요청자를 확인할 수 없습니다 — 이 창구는 프록시 없이 VPN으로 직접 붙을 때만 열립니다." });
      return false;
    }
    // ⚠ **토큰 검사가 마지막이다**(2026-08-16 신설). 여기까지 온 요청은 켜짐·사설 대역·비-브라우저·
    //   프록시 없음이 확인된 상태다. 토큰이 설정돼 있으면 붙는 쪽이 헤더로 같은 값을 제시해야 한다.
    //   이것이 「사설 대역이면 누구나」를 「토큰을 아는 쪽만」으로 좁힌다 — 문서에 자백해야 했던
    //   「사무실 LAN의 다른 PC도 붙는다」가 이걸로 닫힌다.
    //   ⚠ 토큰이 없는 설정(옛 켜짐·수동 편집)은 통과시킨다 — 하위호환. 다만 켜기 라우트가
    //     항상 토큰을 만들므로 새 켜짐은 늘 토큰을 갖는다.
    //   ⚠ 비교는 **길이 무관 상수시간**으로(timingSafeEqual) — 토큰을 한 글자씩 맞혀보는 걸 막는다.
    const 설정토큰 = llmServeConfig().token;
    if (설정토큰) {
      const 준토큰 = String(req.headers?.["x-gijo-serve-token"] ?? "");
      if (!토큰일치(준토큰, 설정토큰)) {
        거절로그(보낸곳, "토큰 불일치");
        res.status(401).json({ error: "접속 토큰이 필요합니다 — 빌려주는 쪽 화면의 주소에 포함된 토큰을 그대로 쓰세요." });
        return false;
      }
    }
    return true;
  };

  // ⚠ **본문 상한을 따로 건다**(검토관 지적 M5). 전역 파서는 200mb인데(app.ts:139 — 매뉴얼
  //   PDF 업로드 때문), 그 크기를 **인증 없는 경로**에 그대로 열어 두면 사설망의 아무 장치가
  //   200MB를 메모리에 밀어넣을 수 있다. 채팅 요청은 이보다 훨씬 작다.
  //   ⚠ 이 파서가 먹으려면 이 라우트가 전역 파서보다 **먼저 등록**돼야 한다(app.ts에서 그렇게 부른다).
  const 본문 = express.json({ limit: "8mb" });
  // ⚠ 관문은 **미들웨어 하나**로 두고 모든 창구 라우트에 같은 방식으로 붙인다.
  //   핸들러 안에서 부르는 형태와 섞으면 「관문을 거치는가」를 세는 시험이 형태 차이에 걸려
  //   헛돈다(실제로 한 번 그랬다). 붙는 자리는 **본문 파서보다 앞**이다(A-5).
  const 관문미들 = (req: Request, res: Response, next: express.NextFunction): void => {
    if (관문(req, res)) next();
  };

  app.get(
    "/api/llm/serve/v1/models",
    관문미들,
    asyncRoute(async (req, res) => {
      const base = await localBaseUrl();
      if (!base) { res.status(503).json({ error: "이 PC의 모델이 아직 준비되지 않았습니다 — 등록된 모델이 없거나 로딩 중입니다. 잠시 뒤 다시 시도하세요." }); return; }
      try {
        const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(10000) });
        res.status(r.status).json(await r.json().catch(() => ({ data: [] })));
      } catch (e) {
        res.status(502).json({ error: `이 PC의 모델에 닿지 못했습니다 — ${e instanceof Error ? e.message : String(e)}` });
      }
    })
  );

  app.post(
    "/api/llm/serve/v1/chat/completions",
    // ⚠ 관문이 **본문 파서보다 앞**이다(재검토 A-5). 예전엔 파서가 먼저라, 대역 밖·프록시 뒤·
    //   브라우저 요청도 8MB를 먼저 파싱한 뒤 거절됐다 — 무인증 CPU·메모리 소모가 그대로 남았다.
    관문미들,
    본문,
    asyncRoute(async (req, res) => {
      // ⚠ 상한 검사와 계수 증가 **사이에 await를 두지 않는다**(재검토 A-6, TOCTOU).
      //   예전엔 사이에 localBaseUrl()(모델 로드·LRU 스왑이면 수십 초)이 있어, 동시에 20건을
      //   밀면 20건 모두 「처리중 0」에서 통과해 GPU를 점유했다 — 상한이 막으려던 그 상황이다.
      if (처리중 >= 동시상한) {
        res.status(429).json({ error: `이 PC가 지금 ${동시상한}건을 처리 중입니다 — 잠시 뒤 다시 시도하세요.` });
        return;
      }
      처리중 += 1;
      let 되돌림 = false;
      const 놓기 = () => { if (!되돌림) { 되돌림 = true; 처리중 = Math.max(0, 처리중 - 1); } };

      // ⚠ 취소 통로를 **await보다 먼저** 만든다(3차 검토 H-4 — 내가 A-6을 고치며 낸 틈).
      //   예전엔 close 리스너가 둘로 쪼개져, 아래 localBaseUrl() await 중에 클라가 끊기면
      //   그때 발생한 close를 **뒤에 등록될 리스너가 못 받았다**(EventEmitter는 지난 이벤트를
      //   재생하지 않는다). 그러면 ① 상류 llama 생성이 취소되지 않고 ② 슬롯만 반납돼
      //   **동시 상한이 우회**된다(요청 후 즉시 끊기를 반복하면 처리중 0인 채 GPU만 쌓인다).
      //   ▶ 리스너를 **하나로** 두고, 만드는 것도 여기서 먼저 한다.
      const 취소 = new AbortController();
      const 시계 = setTimeout(() => 취소.abort(), 10 * 60 * 1000); // 큰 모델을 감안해 넉넉히
      res.on("close", () => { clearTimeout(시계); 취소.abort(); 놓기(); });

      const base = await localBaseUrl();
      // ⚠ await 사이에 이미 끊겼으면 여기서 접는다 — 위 리스너가 정리는 했지만, 끊긴 상대에게
      //   응답을 쓰려 하거나 상류를 새로 부르는 일은 하지 않는다.
      if (res.destroyed) { 놓기(); return; }
      if (!base) { 놓기(); res.status(503).json({ error: "이 PC의 모델이 아직 준비되지 않았습니다 — 등록된 모델이 없거나 로딩 중입니다. 잠시 뒤 다시 시도하세요." }); return; }

      // ⚠ `enabled: true`를 박아 쓰지 않는다(검토관 지적 M3) — 관문 통과와 이 쓰기 사이에
      //   admin이 껐으면, 처리 중이던 요청이 **꺼진 스위치를 다시 켜** 화면이 「내주는 중」으로
      //   돌아온다. 지금 값을 읽어 그대로 두고 시각만 갱신한다.
      const 지금설정 = llmServeConfig();
      if (!지금설정.enabled) { 놓기(); res.status(404).json({ error: "이 서버는 원격 GPU 제공이 꺼져 있습니다." }); return; }
      const 보낸곳 = String(req.socket?.remoteAddress ?? "(미상)");

      // ⚠ **일이 끝난 뒤에** 기록한다(재검토 B-2). 예전엔 상류를 부르기도 전에
      //   `result:"ok"`와 「마지막 사용」을 남겨, 502로 끝난 요청도 「내줌·성공」으로 보였다 —
      //   activityaudit.ts가 res.on("finish")를 기다리는 것과 같은 이유다(거짓 기록 금지).
      let 기록함 = false;
      const 마무리기록 = (성공: boolean) => {
        if (기록함) return;
        기록함 = true;
        if (성공) save({ ...llmServeConfig(), lastServedAt: Date.now() }); // 「쓰이고 있나」 표시
        // 무인증 창구라 활동 감사(actor 필요)가 통째로 건너뛴다 — 감사를 직접 남긴다(M4).
        // ⚠ 이 감사는 **관문을 통과한 요청만** 남긴다(거절은 로그로 접는다 — B-1).
        recordAudit({
          kind: "config",
          action: "원격 GPU 내줌(추론 1건)",
          actor: `원격 ${보낸곳}`,
          result: 성공 ? "ok" : "error",
        });
      };

      try {
        const upstream = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req.body ?? {}),
          signal: 취소.signal,
        });
        res.status(upstream.status);
        const ct = upstream.headers.get("content-type");
        if (ct) res.setHeader("content-type", ct);
        if (!upstream.body) { clearTimeout(시계); 놓기(); 마무리기록(upstream.ok); res.end(); return; }
        // 스트리밍(SSE)도 그대로 흘려보낸다 — 통째로 모았다가 주면 답이 한참 뒤에 한꺼번에 뜬다.
        // ⚠ `.pipe()`를 쓰지 않는다(검토관 지적 H3): pipe는 에러를 전달하지 않고, 리스너 없는
        //   `error`는 **uncaught exception이라 서버 프로세스가 죽는다**. 이 저장소에는
        //   process.on("uncaughtException")이 없고, 운영 서버가 죽으면 전 사용자 세션이 끊긴다.
        //   실제 방아쇠가 가상이 아니다: 모델 LRU 스왑이 생성 중인 llama를 내릴 때·타임아웃·연결 리셋.
        pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res, (err) => {
          clearTimeout(시계);
          놓기();
          마무리기록(!err && upstream.ok); // 끝난 뒤에야 성공/실패를 안다
          if (!err) return;
          console.warn(`[llmserve] 중계 중 끊김: ${err.message}`);
          if (!res.headersSent) res.status(502).json({ error: "추론 중 연결이 끊겼습니다." });
          else res.destroy(); // 이미 흘려보내던 중이면 소켓을 닫는 것이 유일한 정직한 마무리다
        });
      } catch (e) {
        clearTimeout(시계);
        놓기();
        마무리기록(false);
        res.status(502).json({ error: `추론에 실패했습니다 — ${e instanceof Error ? e.message : String(e)}` });
      }
    })
  );
}

export function registerLlmServeRoutes(app: Express): void {
  // 상태 조회·전환 — admin 전용. 화면이 주소를 만들어 보여줄 수 있게 재료를 함께 준다.
  app.get("/api/llm/serve", authMiddleware, adminMiddleware, (req, res) => {
    // 처리중/상한도 함께 준다(재검토 B-8) — 안 주면 빌려주는 쪽은 자기 기계가 지금 거절 중인 것을
    // 알 길이 없다(붙는 쪽만 429를 본다).
    res.json({ ...llmServeConfig(), airgap: isAirgapOn(), ...주소재료(req), ...serveInFlight() });
  });

  app.post(
    "/api/llm/serve",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const enabled = req.body?.enabled === true;
      if (enabled && isAirgapOn()) {
        res.status(403).json({ error: "에어갭 모드에서는 이 PC를 원격 GPU로 내줄 수 없습니다 — 바깥과의 통신이 전제입니다." });
        return;
      }
      const prev = llmServeConfig();
      // ⚠ 켤 때 토큰을 **만든다**(2026-08-16). 껐다 켜면 새 토큰이라, 옛 주소를 아는 쪽은
      //   다시 못 붙는다(끄기가 실질적 무효화다 — 「안 쓸 때 꺼 두라」가 이걸로 힘을 갖는다).
      //   끌 때는 토큰을 지운다(꺼진 창구에 토큰이 남을 이유가 없다).
      const token = enabled ? 토큰생성() : null;
      save({ enabled, lastServedAt: prev.lastServedAt, token });
      recordAudit({
        kind: "config",
        action: enabled ? "원격 GPU 내주기 켬(토큰 재발급)" : "원격 GPU 내주기 끔",
        // ⚠ 감사의 「누가」는 **사람이 읽는 이름**이다 — 계정 아이디(username)를 쓰면
        //   auditactor 시험이 막는다(담당자가 화면에서 읽는 글자이기 때문). 다른 라우트와 같은 꼴.
        actor: (req as unknown as { user?: { displayName?: string } }).user?.displayName ?? "(알 수 없음)",
        result: "ok",
      });
      res.json({ ...llmServeConfig(), airgap: isAirgapOn(), ...주소재료(req) });
    })
  );
}
