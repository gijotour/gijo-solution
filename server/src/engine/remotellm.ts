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
// ■ 자격증명(접속 토큰)이 붙었다(2026-08-16) — 내주는 쪽이 주소에 ?token=…으로 실어 준다.
//   remoteLlmTarget()이 URL에서 토큰을 떼어 헤더(x-gijo-serve-token)로 보낸다.
//   ⚠ 이 토큰은 URL의 일부로 app_state에 **평문** 저장된다 — cloudllm의 암호화 보관을 쓰지
//   않는다. 근거: VPN 한정 · GPU 접속용(계정 비밀번호 아님) · admin이 껐다 켜면 재발급되는
//   1회성에 가깝다. 계정 자격증명이 이 칸에 들어오는 날엔 그때 암호화를 단다.

import type { Express } from "express";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { isAirgapOn, isVpnRangeIp } from "./airgap";
import { recordAudit } from "./audit";

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const STATE_KEY = "remote_llm";

export interface RemoteLlmConfig {
  enabled: boolean;
  url: string;            // 예: http://10.8.0.12:8080/v1
  lastCheck: number | null; // 마지막 연결 테스트 성공 시각(ms) — 화면 표시용
  lastModel: string | null; // 그때 원격이 내놓은 모델 id — 「어느 두뇌가 답하나」를 화면이 말하게
  /**
   * 🧠 **마지막으로 원격에 못 닿은 시각(ms)** — 실제 채팅이 겪은 사실이다(2026-09-10).
   *
   * ⚠ lastCheck와 **다른 사실**이라 한 칸에 뭉개지 않는다. lastCheck는 admin이 설정 화면에서
   *   누른 연결 시험이 성공한 시각이고, 이 칸은 **담당자의 질문이 실제로 나가다 죽은** 시각이다.
   *   그 둘은 몇 시간씩 어긋난다 — 아침에 시험이 성공했고 낮에 WireGuard가 끊긴 날, lastCheck만
   *   보는 화면은 「연결됨 · 3시간 전 확인」이라 말한다. 그게 거짓 초록이다.
   */
  lastFailAt: number | null;
  /** 그때 사유 — 사람이 읽는 짧은 말(HTTP 상태·연결 실패·시간 초과). 주소·토큰은 안 적는다. */
  failReason: string | null;
}

// ⚠ **주소가 바뀌면 지난 확인은 무효다.** 그래서 「어느 주소를 쟀는지」를 함께 적고,
//   지금 주소와 다르면 lastCheck·lastModel을 null로 돌려준다.
//   안 그러면 주소를 바꾼 뒤에도 **옛 기계의 모델 이름**이 화면에 남는다 — 그게 거짓 표시다.
interface 저장모양 extends RemoteLlmConfig { lastCheckedUrl?: string | null; lastFailUrl?: string | null }

export function remoteLlmConfig(): RemoteLlmConfig {
  try {
    const row = getStateStmt.get(STATE_KEY) as { value: string } | undefined;
    if (!row) return { enabled: false, url: "", lastCheck: null, lastModel: null, lastFailAt: null, failReason: null };
    const v = JSON.parse(row.value) as Partial<저장모양>;
    const url = String(v.url ?? "");
    // 잰 주소와 지금 주소가 다르면 「모른다」로 답한다(위 주석).
    const 유효 = !v.lastCheckedUrl || v.lastCheckedUrl === url;
    // ⚠ 실패도 **같은 규율**로 무효화한다 — 주소를 바꿨으면 옛 주소에서 못 닿았던 사실은
    //   지금 주소에 대해 아무 말도 하지 않는다. 안 그러면 새 주소가 멀쩡한데 화면이 계속 「끊김」이다.
    const 실패유효 = !v.lastFailUrl || v.lastFailUrl === url;
    return {
      enabled: v.enabled === true,
      url,
      lastCheck: 유효 && typeof v.lastCheck === "number" ? v.lastCheck : null,
      lastModel: 유효 && typeof v.lastModel === "string" && v.lastModel ? v.lastModel : null,
      lastFailAt: 실패유효 && typeof v.lastFailAt === "number" ? v.lastFailAt : null,
      failReason: 실패유효 && typeof v.failReason === "string" && v.failReason ? v.failReason : null,
    };
  } catch {
    return { enabled: false, url: "", lastCheck: null, lastModel: null, lastFailAt: null, failReason: null };
  }
}

function saveConfig(c: 저장모양): void {
  setStateStmt.run(STATE_KEY, JSON.stringify(c));
}

/** 지금 저장돼 있는 원문 그대로(무효화 규칙을 안 태운 값) — 실패/성공 기록이 덮어쓸 밑판. */
function 저장원문(): 저장모양 {
  try {
    const row = getStateStmt.get(STATE_KEY) as { value: string } | undefined;
    if (row) return JSON.parse(row.value) as 저장모양;
  } catch { /* 깨진 값이면 아래 기본값 */ }
  return { enabled: false, url: "", lastCheck: null, lastModel: null, lastFailAt: null, failReason: null };
}

/**
 * 🧠 **채팅이 원격에 못 닿았다** — 그 사실을 상태에 남긴다(2026-09-10 · llm.ts 원격 폴백의 짝).
 *
 * ★ 왜 필요한가: 폴백만 있고 기록이 없으면 **아무도 모르게 강등된다.** 담당자는 그 한 답에
 *   붙은 한 줄만 보고 지나가고, 로스터 명패는 계속 「🌐 외부지원」이라 말한다 — 원격이 며칠째
 *   죽어 있어도 화면은 초록이다. 이 저장소가 「조용한 고장」이라 부르는 바로 그 꼴이다.
 * ⚠ **주소·토큰은 안 적는다** — 사유는 사람이 읽는 짧은 말만(부르는 쪽이 그렇게 만든다).
 * ⚠ 이 기록이 원격을 **끄지는 않는다.** 끄면 사람이 다시 켜기 전엔 원격이 영영 안 살아나고,
 *   잠깐 끊긴 VPN 한 번에 설정이 뒤집힌다. 다음 질문은 그대로 다시 원격을 시도하고,
 *   성공하면 아래 원격성공기록이 이 자국을 지운다.
 */
export function 원격실패기록(사유: string): void {
  const prev = 저장원문();
  const url = String(prev.url ?? "");
  if (!url) return; // 주소가 없으면 적을 대상이 없다
  saveConfig({ ...prev, lastFailAt: Date.now(), failReason: String(사유).slice(0, 200), lastFailUrl: url });
}

/**
 * 🧠 원격이 다시 답했다 — 실패 자국을 지운다. **자국이 있을 때만** 쓴다(채팅마다 DB를 안 만진다).
 *
 * ⚠ lastCheck는 안 건드린다 — 그 칸의 생산자는 연결 시험 하나다(아래 /test의 ★). 「언제 확인했나」와
 *   「지금 되나」를 한 칸에 뭉개면 화면이 어느 사실을 말하는지 알 수 없게 된다.
 */
export function 원격성공기록(): void {
  const prev = 저장원문();
  if (prev.lastFailAt == null && !prev.failReason) return;
  saveConfig({ ...prev, lastFailAt: null, failReason: null, lastFailUrl: null });
}

/**
 * 채팅이 실제로 갈 원격 /v1 주소 — 꺼져 있거나 에어갭이면 null(로컬 경로 그대로).
 *
 * ⚠ 채팅 경로(`llm.ts chat()`)가 **이 게터 하나**를 본다. 상수 사본을 두 곳에 두면
 *   한쪽만 고쳐져 어긋난다 — 이 저장소가 반복해 겪은 유형이다.
 * ⚠ `searchrewrite.ts`는 2026-09-10에 여기서 **떨어져 나갔다**(언제나 로컬). 팀원별 두뇌 위치를
 *   못 보는 도우미가 전역만 따라 원격으로 가면, 아무도 원격을 고르지 않은 경로까지 보이지 않는
 *   왕복을 치른다 — 짧고(40토큰) 지연에 민감한(RAG 앞단) 곁가지는 이 게터를 안 쓴다.
 *   ⚠ 그 파일이 「5.4초→57초」의 범인이었다는 첫 설명은 **틀렸다**(상한 1.5초 · 그쪽 머리말 ★).
 *   총괄이 전역만 켜도 원격으로 가던 자리가 더 그럴듯한 원인이고, `llm.ts resolveRemoteTarget` ⓪에서 막았다.
 * ⚠ 에어갭 검사를 여기서도 한다(저장 시에만 막으면, 저장 뒤 에어갭을 켠 경우가 샌다).
 */
// 사용 시점 차단을 감사에 남길 때 같은 주소로 도배되지 않게 — 주소당 첫 1회만(airgap.ts 관례).
const 차단기록한주소 = new Set<string>();

export function remoteLlmBaseUrl(): string | null {
  if (isAirgapOn()) return null;
  const c = remoteLlmConfig();
  if (!c.enabled || !c.url) return null;
  // ★ 사용 시점 재검증(2026-08-19 검토 지적). 저장 관문만 믿으면 관문을 안 거친 값이 샌다 —
  //   DB 복원·다른 설치본 이식·규칙이 조여진 뒤의 옛 저장값. 저장과 **같은 판정기**를 쓴다.
  const 문제 = remoteUrlProblem(c.url);
  if (문제) {
    if (!차단기록한주소.has(c.url)) {
      차단기록한주소.add(c.url);
      let 호스트 = c.url;
      try { 호스트 = new URL(c.url).host; } catch { /* 파싱 불가면 원문 — 토큰 쿼리는 host에 없다 */ }
      recordAudit({
        kind: "block", actor: "시스템(원격 LLM)",
        action: "저장된 원격 GPU 주소가 규칙에 안 맞아 차단", target: 호스트,
        detail: 문제, result: "blocked",
      });
    }
    return null; // 로컬로 폴백 — 조용히 밖으로 나가는 것보다 낫다
  }
  return c.url;
}

/**
 * 채팅이 쓸 **정리된 base URL + 헤더** — 토큰을 URL에서 떼어 헤더로 옮긴다(2026-08-16).
 *
 * ⚠ 왜: 내주는 쪽이 토큰을 주소 뒤 `?token=…`으로 실어 준다(사람이 토큰을 따로 안 다루게).
 *   그런데 그대로 `${url}/chat/completions`를 부르면 쿼리가 경로 중간에 박혀 깨진다.
 *   그래서 여기서 **URL은 토큰을 뗀 깨끗한 것**으로, **토큰은 헤더(x-gijo-serve-token)**로 가른다.
 *   llm.ts의 chat()이 이 하나를 쓴다 — 헤더 구성을 두 곳에 적으면 어긋난다.
 *   (searchrewrite.ts는 2026-09-10부터 안 쓴다 — 위 remoteLlmBaseUrl 주석의 이유.)
 * ⚠ �trailing slash도 여기서 정리한다(`/v1/` → `/v1`) — 소비자가 `${base}/models`를 붙이므로.
 */
export function remoteLlmTarget(): { baseUrl: string; headers: Record<string, string> } | null {
  const raw = remoteLlmBaseUrl();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const token = u.searchParams.get("token");
    u.search = ""; // 토큰(과 다른 쿼리)을 URL에서 제거
    const baseUrl = u.toString().replace(/\/+$/, "");
    return { baseUrl, headers: token ? { "x-gijo-serve-token": token } : {} };
  } catch {
    return { baseUrl: raw.replace(/\/+$/, ""), headers: {} };
  }
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
    // ⚠ 문구를 「사설 대역」으로 적는다(3차 검토 M-2) — 코드가 보는 것이 그것이고,
    //   「VPN 안」이라고 말하면 사무실 LAN도 통과한다는 사실을 감춘다(문서는 이미 정정했다).
    return "사설 대역 주소만 됩니다 — 10.x·172.16-31.x·192.168.x·100.64-127.x IP로 넣어 주세요. 호스트명·공인 IP는 받지 않습니다(어디로 풀릴지 코드가 보증할 수 없습니다).";
  }
  return null;
}

export function registerRemoteLlmRoutes(app: Express): void {
  // 조회 — 화면 카드가 그린다. 자격증명은 애초에 저장하지 않으므로 새어 나갈 것도 없다.
  app.get("/api/llm/remote", authMiddleware, adminMiddleware, (_req, res) => {
    // effective — **게터와 같은 계산**(검토관 #3). 사용 시점 재검증으로 차단된 상태에서
    // 설정 화면이 「켜짐 — 원격으로 갑니다」라고 말하면 /where(대화창 칩)와 정면으로 어긋난다.
    res.json({ ...remoteLlmConfig(), airgap: isAirgapOn(), effective: remoteLlmBaseUrl() !== null });
  });

  /**
   * **내 질문이 어디로 가나** — 로그인한 누구나 볼 수 있다(admin 아니어도).
   *
   * ⚠ 왜 라우트를 나눴나 (검토관 지적 H4 — 정직성 문제였다)
   *   위 조회는 admin 전용이라, 담당자(비-admin) 화면에서는 원격이 켜져 있어도 **로컬 모델이
   *   답하는 것처럼** 보였고 「질문이 VPN으로 전송됩니다」 경고를 **못 봤다**. 그 경고가 가장
   *   필요한 사람은 질문을 실제로 입력하는 담당자다. 화면이 말하는 것과 코드가 하는 것이
   *   정면으로 어긋나 있었다.
   * ⚠ 그래서 **바꾸는 것은 그대로 admin**이고, **보는 것만** 연다. 주소는 알려주지 않는다 —
   *   담당자에게 필요한 것은 「지금 바깥으로 나가는가」이고, 어디로 가는지는 설정 권한의 몫이다.
   */
  app.get("/api/llm/remote/where", authMiddleware, (_req, res) => {
    // 게터와 같은 계산을 쓴다(2026-08-19) — 사용 시점 재검증으로 차단된 상태인데
    // 여기만 「원격중」이라 답하면 화면이 거짓을 보증하게 된다.
    // ⚠ **주소는 여전히 안 알려준다**(위 주석의 결정 그대로). 대신 **모델 이름**은 연다 —
    //   담당자가 「어느 두뇌가 내 질문에 답하나」를 아는 것은 정직성이고, 모델 이름은
    //   망 구조를 알려주지 않는다. 주소를 아는 것과는 다른 이야기다.
    const c = remoteLlmConfig();
    const 켜짐 = remoteLlmBaseUrl() !== null;
    res.json({
      remote: 켜짐,
      airgap: isAirgapOn(),
      model: 켜짐 ? c.lastModel : null,
      checkedAt: 켜짐 ? c.lastCheck : null,
      // 🧠 **실제 채팅이 못 닿은 사실**(2026-09-10). remote·checkedAt만으로는 「설정은 켜졌고
      //   아침에 시험도 통과했는데 지금은 죽어 있다」를 화면이 말할 수 없다 — 그 상태가
      //   로스터에 「🌐 외부지원」으로 초록이면 거짓이다.
      // ⚠ **remote의 뜻은 안 바꾼다.** 그 칸은 여전히 「설정상 원격으로 간다」이고, 실패 한 번으로
      //   false가 되면 설정 화면과 대화창 칩이 「꺼짐」이라 말하게 된다 — 아무도 안 껐는데.
      //   판단은 읽는 쪽이 한다: lastFailAt이 checkedAt보다 나중이면 지금은 닿지 않는 것이다.
      lastFailAt: 켜짐 ? c.lastFailAt : null,
      failReason: 켜짐 ? c.failReason : null,
    });
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
        // 토큰이 주소에 실려 있으면 떼어 헤더로 보낸다 — **실제 붙을 때와 같은 방식**이라야
        // 연결 테스트가 토큰 오류까지 잡는다(2026-08-16). URL은 토큰 뗀 것으로 찌른다.
        let 찌를url = url.replace(/\/+$/, "");
        const 헤더: Record<string, string> = {};
        try {
          const u = new URL(url);
          const tk = u.searchParams.get("token");
          if (tk) 헤더["x-gijo-serve-token"] = tk;
          u.search = "";
          찌를url = u.toString().replace(/\/+$/, "");
        } catch { /* URL 파싱 실패는 아래 fetch가 잡는다 */ }
        // redirect 금지(검토관) — 테스트 대상이 3xx로 공인 호스트를 가리켜도 따라가지 않는다.
        const r = await fetch(`${찌를url}/models`, { headers: 헤더, signal: AbortSignal.timeout(5000), redirect: "error" });
        if (!r.ok) { res.json({ ok: false, error: `원격이 답했지만 거절했습니다(HTTP ${r.status}) — /v1 주소인지 확인하세요.` }); return; }
        const j = (await r.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
        const 개수 = Array.isArray(j?.data) ? j.data.length : null;
        // ★ **여기가 lastCheck의 생산자다**(2026-09-02). 그전까지 lastCheck는 타입에 있고
        //   화면이 읽는데 **아무도 값을 넣지 않아 늘 null**이었다 — 소비자만 있고 생산자가
        //   없는 값(이 저장소가 반복해 겪은 유형). 모델 이름도 여기서만 알 수 있다:
        //   /models를 이미 찌르고 있었는데 **개수만 쓰고 버렸다.**
        const 모델 = Array.isArray(j?.data) && typeof j.data[0]?.id === "string" ? String(j.data[0].id) : null;
        const prev = remoteLlmConfig();
        // 🧠 성공했으니 **실패 자국을 지운다**(2026-09-10) — 안 지우면 사람이 시험을 통과시켜 놓고도
        //   화면이 계속 「끊김」이라 말한다(회복을 못 알아보는 상태 = 또 다른 거짓 표시).
        saveConfig({ ...prev, lastCheck: Date.now(), lastModel: 모델, lastCheckedUrl: url, lastFailAt: null, failReason: null, lastFailUrl: null });
        res.json({ ok: true, models: 개수, model: 모델 });
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
      if (enabled && isAirgapOn()) {
        res.status(403).json({ error: "에어갭 모드에서는 원격 LLM을 켤 수 없습니다." });
        return;
      }
      // 검증 규칙(검토관 2건을 함께 반영, 2026-08-19):
      //   · 켤 때는 쓸 주소(실린 url 또는 저장값)가 규칙에 맞아야 한다 — 규칙 밖이면 400.
      //   · **끄기는 항상 된다.** 처음 고친 판은 끌 때도 url을 검증해 400을 냈는데, 클라 4곳이
      //     전부 현재 주소를 동봉해 보내서 **규칙 밖 주소가 저장돼 있으면 끌 방법이 없어졌다**
      //     (이 수리가 겨냥한 바로 그 상황에서). 끌 때 규칙 밖 url이 실려 오면 저장하지 않고
      //     끄기만 반영한다 — 「꺼 둔 채 심어 두기」 길도 그대로 막힌다.
      const prev = remoteLlmConfig();
      let 저장url = url || prev.url;
      if (enabled) {
        const 문제 = remoteUrlProblem(저장url);
        if (문제) { res.status(400).json({ error: 문제 }); return; }
      } else if (url && remoteUrlProblem(url)) {
        저장url = prev.url; // 규칙 밖 새 주소는 안 받는다 — 끄기만 통과
      }
      // 🧠 실패 자국은 여기서 지운다 — 사람이 설정을 다시 만졌으면 「다시 재 본다」가 맞다.
      //   (주소를 안 바꾸고 껐다 켠 경우까지 포함 — 그게 담당자가 하는 첫 조치다.)
      saveConfig({ enabled, url: 저장url, lastCheck: prev.lastCheck, lastModel: prev.lastModel, lastCheckedUrl: 저장url, lastFailAt: null, failReason: null, lastFailUrl: null });
      차단기록한주소.clear(); // 주소가 바뀌었으니 다음 차단은 다시 한 번 기록한다
      // 채팅이 어디로 가는지를 바꾸는 admin 설정 — 작업 기록에 남긴다(2026-08-19 검토 지적:
      // 이 파일에 감사가 한 줄도 없었다). ⚠ URL 전체를 적지 않는다 — ?token=이 평문으로 딸려 온다.
      let 호스트 = "(없음)";
      try { 호스트 = new URL(url || prev.url).host; } catch { /* 주소 없이 끈 경우 */ }
      recordAudit({
        kind: "config", actor: (req as { user?: { displayName?: string } }).user?.displayName ?? null,
        action: enabled ? "원격 GPU 켬" : "원격 GPU 끔", target: 호스트,
        detail: enabled ? "이후 채팅 생성이 이 주소의 원격 LLM으로 간다" : "채팅 생성이 로컬 모델로 돌아온다",
        result: "ok",
      });
      res.json({ ...remoteLlmConfig(), airgap: isAirgapOn() });
    })
  );
}
