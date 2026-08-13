// engine/remotellm.ts — 원격 LLM(BridgeAI 1단계) — **VPN 안의** GPU 서버로 채팅을 보낸다.
//
// ■ 사장님 결정(2026-08-13): BridgeAI(원격 GPU 오프로드)를 전 제품에 **선택** 연동, **VPN 전용**.
//   1단계 = 「설정에서 원격 GPU 주소를 넣으면 GIJO AS의 채팅이 그리로 간다」.
//
// ■ 왜 이 파일이 필요한가(max 인계: 원격LLM_런타임설정_BridgeAI)
//   채팅 백엔드 URL이 **모듈 상수(env)**였다 — 부팅 때 한 번 읽고 끝이라 런타임에 못 바꾼다.
//   그런데 제품은 화면 문구로 「② 사내 GPU 서버에 연결 — 설정에서 서버 주소 입력」을 이미
//   **광고**하고 있었다. 입력을 받는 라우트·저장·적용이 어디에도 없었다 — 광고만 있고 구현이 없음.
//
// ■ 왜 큰가: 라이트 10GB 기계가 원격 14B/32B를 쓰면 라우팅 손실·정리본 값 손실이
//   **모델을 안 바꾸고** 풀린다(다 모델 크기 문제였다). 기계 교체 없이 「더 크게」가 실현된다.
//
// ■ 경계 셋 (전부 코드가 지킨다 — 문구로 안내만 하고 코드가 안 막으면 광고와 같다)
//   ① **VPN 전용**: 저장 시 URL 호스트가 사설·VPN 대역이어야 한다. 공인 IP·공개 도메인은 거부.
//      판정은 airgap.ts의 isVpnRangeIp **한 곳**(사설 대역 + CGNAT 100.64/10) — 새 판정기를 만들지
//      않는다. 호스트명은 내부 DNS가 있어도 **거부**한다: 이름은 어디로든 풀릴 수 있어
//      「확실히 VPN 안」을 코드가 보증할 수 없다(airgap의 default-deny와 같은 자세).
//   ② **에어갭이면 기능 자체를 막는다**: 원격은 네트워크가 전제다. 켜져 있는 상태에서
//      에어갭이 켜지면 egress 봉인(installAirgapGuard)이 실제 전송도 막는다 — 이중 방어.
//   ③ **admin 전용**: 채팅이 어디로 가는지를 바꾸는 설정이다.
//
// ■ 자격증명은 아직 없다 — 일부러다. BridgeAI 프록시는 그냥 /v1이라 URL만으로 된다(max).
//   인증이 붙는 날 cloudllm.ts의 암호화 보관 패턴을 그대로 재사용한다. 지금 칸만 만들어 두면
//   「소비자 없는 생산자」가 된다(그 값을 누가 넣는가 원칙).

import type { Express } from "express";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { isAirgapOn, isVpnRangeIp } from "./airgap";

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const STATE_KEY = "remote_llm";

export interface RemoteLlmConfig {
  enabled: boolean;
  url: string;            // 예: http://10.8.0.12:8080/v1
  lastCheck: number | null; // 마지막 연결 테스트 성공 시각(ms) — 화면 표시용
}

export function remoteLlmConfig(): RemoteLlmConfig {
  try {
    const row = getStateStmt.get(STATE_KEY) as { value: string } | undefined;
    if (!row) return { enabled: false, url: "", lastCheck: null };
    const v = JSON.parse(row.value) as Partial<RemoteLlmConfig>;
    return { enabled: v.enabled === true, url: String(v.url ?? ""), lastCheck: typeof v.lastCheck === "number" ? v.lastCheck : null };
  } catch {
    return { enabled: false, url: "", lastCheck: null };
  }
}

function saveConfig(c: RemoteLlmConfig): void {
  setStateStmt.run(STATE_KEY, JSON.stringify(c));
}

/**
 * 채팅이 실제로 갈 원격 /v1 주소 — 꺼져 있거나 에어갭이면 null(로컬 경로 그대로).
 *
 * ⚠ llm.ts·searchrewrite.ts가 **이 게터 하나**를 본다. 상수 사본을 두 곳에 두면
 *   한쪽만 고쳐져 어긋난다 — 이 저장소가 반복해 겪은 유형이다.
 * ⚠ 에어갭 검사를 여기서도 한다(저장 시에만 막으면, 저장 뒤 에어갭을 켠 경우가 샌다).
 */
export function remoteLlmBaseUrl(): string | null {
  if (isAirgapOn()) return null;
  const c = remoteLlmConfig();
  return c.enabled && c.url ? c.url : null;
}

/** URL이 VPN 전용 규칙에 맞는가 — 맞으면 null, 틀리면 사람이 읽을 거절 사유. */
export function remoteUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return "주소 형식이 올바르지 않습니다 — 예: http://10.8.0.12:8080/v1";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "http(s) 주소만 됩니다.";
  if (!isVpnRangeIp(u.hostname)) {
    return "VPN 안의 주소만 됩니다 — 사설 대역(10.x·172.16-31.x·192.168.x·100.64-127.x) IP로 넣어 주세요. 호스트명·공인 IP는 받지 않습니다(어디로 풀릴지 코드가 보증할 수 없습니다).";
  }
  return null;
}

export function registerRemoteLlmRoutes(app: Express): void {
  // 조회 — 화면 카드가 그린다. 자격증명은 애초에 저장하지 않으므로 새어 나갈 것도 없다.
  app.get("/api/llm/remote", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ ...remoteLlmConfig(), airgap: isAirgapOn() });
  });

  // 연결 테스트 — 저장 전에 도달을 확인한다. OpenAI 호환 /models를 찌른다.
  app.post(
    "/api/llm/remote/test",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      if (isAirgapOn()) {
        res.status(403).json({ ok: false, error: "에어갭 모드에서는 원격 LLM을 쓸 수 없습니다 — 원격은 네트워크가 전제입니다." });
        return;
      }
      const url = String(req.body?.url ?? "").trim();
      const 문제 = remoteUrlProblem(url);
      if (문제) { res.status(400).json({ ok: false, error: 문제 }); return; }
      try {
        const r = await fetch(`${url.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) { res.json({ ok: false, error: `원격이 답했지만 거절했습니다(HTTP ${r.status}) — /v1 주소인지 확인하세요.` }); return; }
        const j = (await r.json().catch(() => null)) as { data?: unknown[] } | null;
        res.json({ ok: true, models: Array.isArray(j?.data) ? j.data.length : null });
      } catch (e) {
        res.json({ ok: false, error: `원격에 닿지 못했습니다 — ${e instanceof Error ? e.message : String(e)}. VPN 연결과 주소를 확인하세요.` });
      }
    })
  );

  // 저장 + 켜기/끄기 — 켤 때는 URL이 규칙에 맞아야 한다. 끌 때는 조건 없이 끈다(끄기는 항상 안전).
  app.post(
    "/api/llm/remote",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const enabled = req.body?.enabled === true;
      const url = String(req.body?.url ?? "").trim();
      if (enabled) {
        if (isAirgapOn()) {
          res.status(403).json({ error: "에어갭 모드에서는 원격 LLM을 켤 수 없습니다." });
          return;
        }
        const 문제 = remoteUrlProblem(url);
        if (문제) { res.status(400).json({ error: 문제 }); return; }
      }
      const prev = remoteLlmConfig();
      saveConfig({ enabled, url: url || prev.url, lastCheck: prev.lastCheck });
      res.json({ ...remoteLlmConfig(), airgap: isAirgapOn() });
    })
  );
}
