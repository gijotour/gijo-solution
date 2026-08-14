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
import type { Express, Request, Response } from "express";
import { Readable } from "node:stream";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { isAirgapOn, isVpnRangeIp } from "./airgap";

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

/** 로컬 llama의 OpenAI 호환 base URL(기본 모델). 못 구하면 null. */
async function localBaseUrl(): Promise<string | null> {
  try {
    const m = await import("./localengine.js");
    return await m.ensureAgentModel("analysis");
  } catch {
    return null;
  }
}

export function registerLlmServeRoutes(app: Express): void {
  // 상태 조회·전환 — admin 전용. 화면이 주소를 만들어 보여줄 수 있게 포트도 함께 준다.
  app.get("/api/llm/serve", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ ...llmServeConfig(), airgap: isAirgapOn(), port: Number(process.env.PORT ?? 4000) });
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
      res.json({ ...llmServeConfig(), airgap: isAirgapOn(), port: Number(process.env.PORT ?? 4000) });
    })
  );

  // ── OpenAI 호환 창구 ────────────────────────────────────────────────────
  //   붙는 쪽(remotellm)이 기대하는 것은 `<base>/models`와 `<base>/chat/completions`다.
  //   그래서 base는 `http://<이 서버>:<포트>/api/llm/serve/v1`이 된다.
  //   ⚠ 이 두 경로는 **인증 미들웨어를 안 탄다**(VPN 대역 판정이 그 자리를 대신한다) —
  //     그래서 아래 관문을 **모든 경로에서 똑같이** 통과시킨다. 하나라도 빠지면 그게 구멍이다.
  const 관문 = (req: Request, res: Response): boolean => {
    if (isAirgapOn()) { res.status(403).json({ error: "airgap" }); return false; }
    if (!llmServeConfig().enabled) { res.status(404).json({ error: "이 서버는 원격 GPU 제공이 꺼져 있습니다." }); return false; }
    if (!requesterAllowed(req)) {
      console.warn(`[llmserve] VPN 밖에서 온 요청 거절: ${req.socket?.remoteAddress}`);
      res.status(403).json({ error: "VPN 안에서만 쓸 수 있습니다." });
      return false;
    }
    return true;
  };

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
    asyncRoute(async (req, res) => {
      if (!관문(req, res)) return;
      const base = await localBaseUrl();
      if (!base) { res.status(503).json({ error: "이 PC에 서빙 중인 모델이 없습니다." }); return; }

      save({ enabled: true, lastServedAt: Date.now() }); // 「쓰이고 있나」를 화면이 보이게

      try {
        const upstream = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req.body ?? {}),
          // 원격이 큰 모델을 돌릴 수 있다 — 붙는 쪽 기다림보다 넉넉하게 둔다.
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
        res.status(upstream.status);
        const ct = upstream.headers.get("content-type");
        if (ct) res.setHeader("content-type", ct);
        // 스트리밍(SSE)도 그대로 흘려보낸다 — 통째로 모았다가 주면 답이 한참 뒤에 한꺼번에 뜬다.
        if (upstream.body) Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
        else res.end();
      } catch (e) {
        res.status(502).json({ error: `추론에 실패했습니다 — ${e instanceof Error ? e.message : String(e)}` });
      }
    })
  );
}
