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
//   · **언제나 이 PC(로컬 엔진)에서 한다** — 원격 전역 스위치·팀원 두뇌 위치를 안 본다(아래 ★ 2026-09-10).

import { emitLlmActivity } from "./llmactivity"; // llm.ts·embedding.ts와 같은 활동 신호 모듈(db를 문다 — 잎은 아니다)

const 켜짐 = process.env.GIJO_SEARCH_REWRITE !== "0";
// ★ **재작성 도우미는 언제나 로컬 엔진을 쓴다**(2026-09-10 win 운영 실측으로 되돌림).
//   2026-08-13(BridgeAI 1단계)부터 여기는 원격 게터를 **직접** 불러 전역 스위치를 그대로 따랐다.
//   그 배선을 끊는다 — 아래 실측이 그것이 옳지 않았음을 말한다.
//
// ■ 무엇이 있었나 (2026-09-10 win 운영 실측)
//   원격 두뇌(gb10)를 전역으로 켜고 **리포트·해설 팀원만** 원격으로 배정했더니,
//   로컬로 남겨 둔 총괄·분석 경로의 물음 「Log4Shell 위험 분석해줘」가 **5.4초 → 57초**가 됐다.
//   전역을 끄자 8.2초로 돌아왔다. 범인이 이 파일이었다 — 재작성은 `chat()`을 안 거치므로
//   팀원별 두뇌 위치 판정(`agents.ts getAgentLocation`)에 **걸리지 않고** 전역만 따라
//   매 물음마다 원격 왕복(큰 모델 콜드 40초+)을 탔다.
//
// ■ 왜 로컬로 못 박나 — 이 작업의 성질이 그렇다.
//   ① **짧다**: 40토큰짜리 한 줄 변환이다. 큰 원격 모델의 값어치(긴 추론·깊은 분석)를 쓸 자리가 아니다.
//   ② **지연에 민감하다**: RAG **앞단**이라 담당자가 답을 기다리는 시간에 통째로 얹힌다.
//      제한이 1.5초인 까닭이 그것인데, 원격 콜드 스타트는 그 한도를 원리상 못 지킨다.
//   ③ **한 물음당 한 번 더 도는 왕복이다**: 사람이 고른 두뇌로 가는 본 답 말고 보이지 않는 곳에서
//      한 번 더 나간다. 그래서 「① 전역 ON + ② 팀원 opt-in」 **두 겹 관문**의 뜻이 무너진다 —
//      아무도 원격을 고르지 않은 경로까지 원격 값을 치르기 때문이다.
//
// ⚠ 대가(정직하게): 로컬 엔진이 안 떠 있는 완전 원격 구성에서는 이 호출이 연결 실패로 떨어져
//   재작성이 **조용히 빠진다**(빈 문자열 → 원문으로 검색). 위 안전 규칙 그대로다 —
//   잃는 것은 검색 품질 개선분이고 검색 자체는 돈다. 57초짜리 답보다 그쪽이 낫다.
// ⚠ 되살리려거든 전역만 보지 말 것 — 사서(curator)의 **두뇌 위치**를 먼저 물어야 한다.
//   그때는 접속 토큰 헤더·리다이렉트 금지도 함께 달아야 한다(아래 fetch 주석).
const 통로 = process.env.GIJO_LOCAL_LLM_URL ?? "http://localhost:8080/v1";

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
  // 사서(curator)의 부르는 문 — **짝 있는 신호**(start↔done/error)로 낸다. done만 내면 레일이 「일하는 중」 불을 꺼 버린다(검토관 2026-09-03).
  //   채택 여부와 무관하게 모델은 돌았으므로 done으로 세고 detail에 채택/미채택을 적는다. 질문 원문은 신호에 싣지 않는다(전 접속자에게 방송된다).
  //   ⚠ 알려진 한계: 이 호출은 chat()을 안 거치고 **로컬 통로로 바로** 간다 — 사서에게 전용 모델·어댑터·두뇌 위치를 배정해도 여기엔 쓰이지 않는다(계획서 §7·§10).
  emitLlmActivity({ kind: "chat", phase: "start", agent: "curator", agentName: "Curator Agent", detail: "검색어 재작성" });
  try {
    const res = await fetch(`${통로}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: 지시 + q }],
        max_tokens: 40,
        temperature: 0,
        // 캐시 오염을 막는다 — 이 호출은 대화 맥락과 무관한 짧은 변환이다.
        cache_prompt: false,
      }),
      signal: AbortSignal.timeout(제한MS),
      // ⚠ 접속 토큰 헤더와 리다이렉트 금지가 여기 **없는 이유**: 이 호출은 이 PC 밖으로 안 나간다(위 ★).
      //   밖으로 내보내는 날엔 그 방어 둘을 함께 달아야 한다 — `llm.ts`가 두 번 고친 그 방어다.
      //   `remoteegressguard.test.ts`가 engine 전체를 훑어 「밖으로 갈 수 있는 /chat/completions」를
      //   스스로 찾아 대조하므로, 되살리는 순간 그 시험이 방어 누락을 빨간불로 잡는다.
    });
    if (res.ok) {
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const 구절 = String(j?.choices?.[0]?.message?.content ?? "")
        .trim()
        .split("\n")[0]
        .replace(/^["'「]+|["'」]+$/g, "")
        .trim();
      const 채택 = 쓸만한가(q, 구절);
      if (채택) 결과 = 구절;
      emitLlmActivity({ kind: "chat", phase: "done", agent: "curator", agentName: "Curator Agent", detail: `검색어 재작성(${채택 ? "채택" : "미채택"})`, latencyMs: Date.now() - 시작 });
    } else {
      emitLlmActivity({ kind: "chat", phase: "error", agent: "curator", agentName: "Curator Agent", detail: `검색어 재작성 HTTP ${res.status}` });
    }
  } catch {
    // 모델이 없거나 느리다 — 원문으로 간다. 로그는 안 남기지만 활동 신호는 짝을 맞춘다(불을 켰으면 끈다).
    결과 = "";
    emitLlmActivity({ kind: "chat", phase: "error", agent: "curator", agentName: "Curator Agent", detail: "검색어 재작성 실패(시간 초과·연결)" });
  }

  if (캐시.size >= 캐시최대) 캐시.clear(); // 오래된 것부터 지우는 대신 통째로 비운다(작고 단순하게)
  캐시.set(q, 결과);
  return 결과;
}
