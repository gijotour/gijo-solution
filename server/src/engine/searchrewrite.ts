// engine/searchrewrite.ts — **담당자 말투를 검색용 구절로 다시 쓴다**(2026-08-12).
//
// ■ 왜 필요한가 — 실측이 두 번 말했다.
//   ① 같은 문서를 두 말투로 물으면 거리가 **평균 0.19** 벌어진다. 8쌍 중 6쌍이 밀렸고
//      2쌍은 「근거 약함」 문턱(0.85)을 넘었다. 담당자는 말로 묻고 문서는 문어체다.
//   ② 규칙으로 군말·종결어미만 떼는 방식은 **2/8**밖에 못 고쳤다(hybridsearch의 normalizeForSearch).
//      짧게 줄이는 것도 답이 아니었다 — "브루트포스" 단독 1.090은 구어체(1.077)보다 **나쁘다**.
//      좋아지는 것은 **「주제 + 문제 유형」 두 낱말 조합**이고("IPS 오탐", "KEV 기한"),
//      그건 질문에서 「무엇에 대한 무엇」을 알아야 나온다 — 규칙이 아니라 모델의 일이다.
//
// ■ 실측 값·비용 (2026-08-12, qwen3-14b)
//     "KEV에 올라오면 며칠 안에 해야 하는 거였지?" → "KEV 조치 기한"   0.840 → **0.633**
//     "IPS가 자꾸 같은 걸 잡는데 어떡하지?"        → "IPS 오탐 튜닝"   **못 찾음 → 0.508**
//     "브루트포스 같은 게 계속 보이는데…"           → "브루트포스 시스템 확인" 1.015 → 0.843
//     4/6 개선 · 평균 지연 **327ms**(답 전체가 7~15초라 2~5%)
//   ⚠ **2건은 오히려 나빠졌다**(log4shell +0.027 · smb_445 +0.125) — 재작성이 낱말을 바꿔서다.
//     그래서 **원문 검색을 절대 버리지 않는다.** 둘 다 검색해 가까운 쪽을 쓰면 6/6이 문턱 안이다.
//
// ■ 안전 규칙 — 이 기능이 죽어도 검색은 지금대로 돌아야 한다.
//   · 타임아웃을 두고, 실패·빈 결과·이상한 결과는 **조용히 건너뛴다**(빈 문자열 반환).
//   · 같은 질문은 캐시에서 준다 — 한 번의 답에 검색이 여러 번 돌아도 모델은 한 번만 부른다.
//   · `GIJO_SEARCH_REWRITE=0`으로 끌 수 있다. 시험 환경엔 모델이 없어 자연히 건너뛴다.

import { emitLlmActivity } from "./llmactivity"; // 잎 모듈(embedding.ts와 같은 이유로 안전)

const 켜짐 = process.env.GIJO_SEARCH_REWRITE !== "0";
// ⚠ 상수가 아니라 **매 호출 게터**다(2026-08-13 BridgeAI 1단계) — 원격 LLM이 켜져 있으면
//   재작성도 그리로 간다. llm.ts와 같은 게터(remotellm.remoteLlmBaseUrl) 하나를 본다 —
//   사본을 두면 채팅은 원격인데 재작성만 로컬을 찾다 죽는 어긋남이 생긴다.
const 기본통로 = process.env.GIJO_LOCAL_LLM_URL ?? "http://localhost:8080/v1";
async function 통로(): Promise<{ baseUrl: string; headers: Record<string, string>; 원격: boolean }> {
  // 토큰까지 포함한 목표를 받는다(2026-08-16) — 토큰은 헤더로, URL은 깨끗하게.
  const 원격 = await import("./remotellm.js").then((m) => m.remoteLlmTarget()).catch(() => null);
  // ⚠ **「원격인가」를 함께 돌려준다**(2026-08-18 검토 지적). 예전엔 baseUrl·headers만 주고
  //   그 사실을 버려서, 아래 호출이 `redirect: "error"`를 걸 근거가 없었다 —
  //   그래서 `llm.ts`가 두 번이나 고친 방어(원격일 때 리다이렉트 금지)가 **여기만 빠져 있었다.**
  //   나가는 본문이 담당자의 **질문 원문**이라 유출 경로다.
  return 원격 ? { ...원격, 원격: true } : { baseUrl: 기본통로, headers: {}, 원격: false };
}
/** 재작성에 줄 시간. 넘으면 포기하고 원문으로 검색한다 — 검색이 답보다 오래 걸리면 안 된다. */
const 제한MS = Number(process.env.GIJO_SEARCH_REWRITE_TIMEOUT_MS ?? 1500);

/** 같은 질문을 다시 묻지 않는다(한 답에 검색이 여러 번 돈다). 작게 유지한다. */
const 캐시 = new Map<string, string>();
const 캐시최대 = 200;

const 지시 =
  "다음 질문을 사내 문서 검색용 짧은 구절로 바꿔라. " +
  "주제어와 문제 유형만 남기고 5어절 이내. 설명·따옴표 없이 구절만 출력.\n\n" +
  '예) "IPS가 자꾸 같은 걸 잡는데 어떡하지?" → IPS 오탐 튜닝\n' +
  '예) "KEV에 올라오면 며칠 안에 해야 하는 거였지?" → KEV 조치 기한\n\n질문: ';

/** 결과가 쓸 만한가. 이상하면 안 쓰는 편이 낫다 — 원문 검색이 이미 있다. */
function 쓸만한가(원문: string, 결과: string): boolean {
  if (!결과) return false;
  if (결과.length > 60) return false; // 구절이 아니라 문장을 뱉었다
  if (결과 === 원문.trim()) return false; // 바뀐 게 없으면 검색을 한 번 더 할 값이 없다
  if (/[.!?]$|입니다|습니다|해야|하세요/.test(결과)) return false; // 설명문을 뱉었다
  return true;
}

/**
 * 검색용 구절을 만든다. 실패하면 **빈 문자열** — 부르는 쪽은 그때 원문만 쓴다.
 * ⚠ 절대 던지지 않는다. 검색은 이 기능 없이도 돌아야 한다.
 */
export async function rewriteForSearch(question: string): Promise<string> {
  const q = String(question ?? "").trim();
  if (!켜짐 || q.length < 6 || q.length > 200) return "";
  const 있는것 = 캐시.get(q);
  if (있는것 !== undefined) return 있는것;

  let 결과 = "";
  const 시작 = Date.now();
  try {
    const t = await 통로();
    const res = await fetch(`${t.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...t.headers },
      body: JSON.stringify({
        messages: [{ role: "user", content: 지시 + q }],
        max_tokens: 40,
        temperature: 0,
        // 캐시 오염을 막는다 — 이 호출은 대화 맥락과 무관한 짧은 변환이다.
        cache_prompt: false,
      }),
      signal: AbortSignal.timeout(제한MS),
      // ⚠ 원격일 때 리다이렉트 금지 — VPN 안 서버가 3xx로 밖을 가리키면 **질문 원문이 따라간다.**
      //   `llm.ts:768`·`:883`과 같은 방어다(2026-08-18에 이 곁가지가 빠져 있던 것을 찾음).
      redirect: t.원격 ? "error" : "follow",
    });
    if (res.ok) {
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const t = String(j?.choices?.[0]?.message?.content ?? "")
        .trim()
        .split("\n")[0]
        .replace(/^["'「]+|["'」]+$/g, "")
        .trim();
      if (쓸만한가(q, t)) {
        결과 = t;
        // 사서(curator)가 한 일로 센다(AI 팀 감독 llm_activity_daily · 레일 실신호). 채택된 것만 — 실패·미채택은
        // 원문 검색이 이미 있어 값이 없고, 세면 「일했다」가 부풀려진다(2026-09-03 설계관: 성공 가지에서만).
        emitLlmActivity({ kind: "chat", phase: "done", agent: "curator", detail: `검색어 재작성: ${t.slice(0, 40)}`, latencyMs: Date.now() - 시작 });
      }
    }
  } catch {
    // 모델이 없거나 느리다 — 원문으로 간다. 로그도 남기지 않는다(질문마다 시끄러워진다).
    결과 = "";
  }

  if (캐시.size >= 캐시최대) 캐시.clear(); // 오래된 것부터 지우는 대신 통째로 비운다(작고 단순하게)
  캐시.set(q, 결과);
  return 결과;
}
