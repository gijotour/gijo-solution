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
// ⚠ 인증(토큰)은 아직 없다 — 사장님 결정이 「VPN 전용」이고, VPN 안은 이미 신뢰 경계 안이라는
//   같은 근거다(remotellm.ts 주석과 짝). 붙는 쪽에 자격증명이 생기는 날 여기도 함께 단다.
import express from "express";
import type { Express, Request, Response } from "express";
import { Readable, pipeline } from "node:stream";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { isAirgapOn, isVpnRangeIp } from "./airgap";
import { recordAudit } from "./audit";

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
}

export function llmServeConfig(): LlmServeConfig {
  try {
    const row = getStateStmt.get(STATE_KEY) as { value: string } | undefined;
    if (!row) return { enabled: false, lastServedAt: null };
    const v = JSON.parse(row.value) as Partial<LlmServeConfig>;
    return { enabled: v.enabled === true, lastServedAt: typeof v.lastServedAt === "number" ? v.lastServedAt : null };
  } catch {
    return { enabled: false, lastServedAt: null };
  }
}

function save(c: LlmServeConfig): void {
  setStateStmt.run(STATE_KEY, JSON.stringify(c));
}

/** 내주는 중인가 — 에어갭이면 켜져 있어도 아니다(저장 뒤 에어갭을 켠 경우가 새지 않게). */
export function llmServeOn(): boolean {
  if (isAirgapOn()) return false;
  return llmServeConfig().enabled;
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
 * 로컬 llama의 OpenAI 호환 base URL(기본 모델). 내줄 수 없으면 null.
 *
 * ⚠ `ensureAgentModel`은 **모델이 없어도 기본 포트 URL을 돌려준다**(localengine.ts:1083-1085).
 *   그래서 그것만 믿으면 모델이 하나도 없는 기계에서도 「내주는 중」으로 보이고, 붙는 쪽은
 *   502 「닿지 못했습니다」를 받는다 — 원인은 「모델이 없음」인데 「닿지 못함」이라고 말하는 것이다
 *   (검토관 지적 M12). 그래서 **모델 파일이 있는지 먼저 본다.**
 */
async function localBaseUrl(): Promise<string | null> {
  try {
    const m = await import("./localengine.js");
    const { getAgentModel } = await import("./agents.js");
    const 배정 = getAgentModel("analysis");
    // 배정 모델이 없으면 기본 모델(부팅 때 로드된 것)을 쓰는 구조다 — 그때는 살아 있는지
    // /models 응답으로 판정한다(여기서 파일 목록을 다시 세지 않는다).
    if (배정 && !m.isModelAvailable(배정)) return null;
    return await m.ensureAgentModel("analysis");
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
function 주소재료(req: Request): { seenAddress: string; addressIsPrivate: boolean; port: number } {
  const raw = String(req.socket?.localAddress ?? "").replace(/^::ffff:/, "");
  return { seenAddress: raw, addressIsPrivate: raw ? isVpnRangeIp(raw) : false, port: servePort() };
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
      recordAudit({ kind: "block", action: "원격 GPU 창구 거절(VPN 밖)", actor: `원격 ${보낸곳}`, result: "blocked" });
      res.status(404).json({ error: "not found" });
      return false;
    }
    // ⚠ 브라우저에서 온 것은 거절한다 — CORS가 모든 오리진을 허용하는 배포에서 남의 웹페이지가
    //   이 창구를 부를 수 있었다(H1, 실측 확인). 우리 GIJO의 서버 대 서버 fetch는 이 헤더가 없다.
    if (browserOriginated(req)) {
      recordAudit({ kind: "block", action: "원격 GPU 창구 거절(브라우저 요청)", actor: `원격 ${보낸곳}`, detail: String(req.headers?.origin ?? req.headers?.referer ?? ""), result: "blocked" });
      res.status(403).json({ error: "브라우저에서는 쓸 수 없습니다 — GIJO 서버끼리만 주고받는 창구입니다." });
      return false;
    }
    // ⚠ 앞단 프록시가 있으면 소켓 주소가 전부 127.0.0.1이라 대역 판정이 **전원 통과**가 된다(M2).
    //   모르면 막는다 — 이 창구는 「확실히 VPN 안」이 성립할 때만 열려야 한다.
    if (proxyDetected(req)) {
      recordAudit({ kind: "block", action: "원격 GPU 창구 거절(앞단 프록시 감지)", actor: `원격 ${보낸곳}`, result: "blocked" });
      res.status(403).json({ error: "앞단에 프록시가 있어 요청자를 확인할 수 없습니다 — 이 창구는 프록시 없이 VPN으로 직접 붙을 때만 열립니다." });
      return false;
    }
    if (isAirgapOn()) { res.status(404).json({ error: "not found" }); return false; }
    if (!llmServeConfig().enabled) { res.status(404).json({ error: "이 서버는 원격 GPU 제공이 꺼져 있습니다." }); return false; }
    return true;
  };

  // ⚠ **본문 상한을 따로 건다**(검토관 지적 M5). 전역 파서는 200mb인데(app.ts:139 — 매뉴얼
  //   PDF 업로드 때문), 그 크기를 **인증 없는 경로**에 그대로 열어 두면 사설망의 아무 장치가
  //   200MB를 메모리에 밀어넣을 수 있다. 채팅 요청은 이보다 훨씬 작다.
  //   ⚠ 이 파서가 먹으려면 이 라우트가 전역 파서보다 **먼저 등록**돼야 한다(app.ts에서 그렇게 부른다).
  const 본문 = express.json({ limit: "8mb" });

  app.get(
    "/api/llm/serve/v1/models",
    asyncRoute(async (req, res) => {
      if (!관문(req, res)) return;
      const base = await localBaseUrl();
      if (!base) { res.status(503).json({ error: "이 PC에 서빙 중인 모델이 없습니다." }); return; }
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
    본문,
    asyncRoute(async (req, res) => {
      if (!관문(req, res)) return;
      // ⚠ 동시 처리 상한(M5) — 내주는 것은 호의이지 무제한 위임이 아니다. 넘치면 429로
      //   정직하게 거절한다(줄 세워 두면 붙는 쪽은 「느리다」로 오해하고 원인을 못 찾는다).
      if (처리중 >= 동시상한) {
        res.status(429).json({ error: `이 PC가 지금 ${동시상한}건을 처리 중입니다 — 잠시 뒤 다시 시도하세요.` });
        return;
      }
      const base = await localBaseUrl();
      if (!base) { res.status(503).json({ error: "이 PC에 서빙 중인 모델이 없습니다." }); return; }

      // ⚠ `enabled: true`를 박아 쓰지 않는다(검토관 지적 M3) — 관문 통과와 이 쓰기 사이에
      //   admin이 껐으면, 처리 중이던 요청이 **꺼진 스위치를 다시 켜** 화면이 「내주는 중」으로
      //   돌아온다. 지금 값을 읽어 그대로 두고 시각만 갱신한다.
      const 지금설정 = llmServeConfig();
      if (!지금설정.enabled) { res.status(404).json({ error: "이 서버는 원격 GPU 제공이 꺼져 있습니다." }); return; }
      save({ ...지금설정, lastServedAt: Date.now() }); // 「쓰이고 있나」를 화면이 보이게
      const 보낸곳 = String(req.socket?.remoteAddress ?? "(미상)");
      // 무인증 창구라 활동 감사(actor 필요)가 통째로 건너뛴다 — 감사를 직접 남긴다(M4).
      // 「누가·어디서 내 GPU를 썼나」를 사후에 알 길이 없으면 보안 제품에서 그 자체가 지적 대상이다.
      recordAudit({ kind: "config", action: "원격 GPU 내줌(추론 1건)", actor: `원격 ${보낸곳}`, result: "ok" });

      // ⚠ 상류를 취소할 통로를 만든다 — 클라이언트가 끊으면 llama 생성도 멈춘다(L1).
      //   없으면 버려진 요청이 10분 타임아웃까지 슬롯을 점유한다.
      const 취소 = new AbortController();
      const 시계 = setTimeout(() => 취소.abort(), 10 * 60 * 1000); // 큰 모델을 감안해 넉넉히
      // ⚠ 상한 계수는 **끝날 때 반드시 되돌린다** — 안 그러면 몇 건 처리 후 창구가 영영 막힌다.
      //   res의 close는 정상 종료·에러·클라이언트 끊김 어느 쪽에서도 온다.
      처리중 += 1;
      let 되돌림 = false;
      const 놓기 = () => { if (!되돌림) { 되돌림 = true; 처리중 = Math.max(0, 처리중 - 1); } };
      res.on("close", () => { clearTimeout(시계); 취소.abort(); 놓기(); });

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
        if (!upstream.body) { clearTimeout(시계); 놓기(); res.end(); return; }
        // 스트리밍(SSE)도 그대로 흘려보낸다 — 통째로 모았다가 주면 답이 한참 뒤에 한꺼번에 뜬다.
        // ⚠ `.pipe()`를 쓰지 않는다(검토관 지적 H3): pipe는 에러를 전달하지 않고, 리스너 없는
        //   `error`는 **uncaught exception이라 서버 프로세스가 죽는다**. 이 저장소에는
        //   process.on("uncaughtException")이 없고, 운영 서버가 죽으면 전 사용자 세션이 끊긴다.
        //   실제 방아쇠가 가상이 아니다: 모델 LRU 스왑이 생성 중인 llama를 내릴 때·타임아웃·연결 리셋.
        pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res, (err) => {
          clearTimeout(시계);
          놓기();
          if (!err) return;
          console.warn(`[llmserve] 중계 중 끊김: ${err.message}`);
          if (!res.headersSent) res.status(502).json({ error: "추론 중 연결이 끊겼습니다." });
          else res.destroy(); // 이미 흘려보내던 중이면 소켓을 닫는 것이 유일한 정직한 마무리다
        });
      } catch (e) {
        clearTimeout(시계);
        놓기();
        res.status(502).json({ error: `추론에 실패했습니다 — ${e instanceof Error ? e.message : String(e)}` });
      }
    })
  );
}

export function registerLlmServeRoutes(app: Express): void {
  // 상태 조회·전환 — admin 전용. 화면이 주소를 만들어 보여줄 수 있게 재료를 함께 준다.
  app.get("/api/llm/serve", authMiddleware, adminMiddleware, (req, res) => {
    res.json({ ...llmServeConfig(), airgap: isAirgapOn(), ...주소재료(req) });
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
      save({ enabled, lastServedAt: prev.lastServedAt });
      recordAudit({
        kind: "config",
        action: enabled ? "원격 GPU 내주기 켬" : "원격 GPU 내주기 끔",
        // ⚠ 감사의 「누가」는 **사람이 읽는 이름**이다 — 계정 아이디(username)를 쓰면
        //   auditactor 시험이 막는다(담당자가 화면에서 읽는 글자이기 때문). 다른 라우트와 같은 꼴.
        actor: (req as unknown as { user?: { displayName?: string } }).user?.displayName ?? "(알 수 없음)",
        result: "ok",
      });
      res.json({ ...llmServeConfig(), airgap: isAirgapOn(), ...주소재료(req) });
    })
  );
}
