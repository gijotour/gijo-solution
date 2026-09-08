// engine/agentloop.ts — 오케스트레이터 에이전트 루프 (지시 → 도구 선택 → 실행 → 최종 답변)
//
// 흐름(ReAct 단일 스텝 반복, 계획서 §4 Phase 1):
//   ① LLM에 도구 목록 + 지시 + 지금까지의 실행 결과를 주고 "다음 행동" JSON을 받는다
//      (llama.cpp json_schema 강제 — 형식 오류 클래스가 없다. 실측 벤치 10/10 근거).
//   ② action=tool 이면 규칙 검증(validateToolArgs) 후 실행하고 결과를 다음 결정에 재주입.
//   ③ action=final 이거나 반복 상한이면 종료. 도구를 1개 이상 썼으면 최종 답변은 일반 chat
//      경로로 재작성한다 — NO_HAN 문법·서두 제거·이력 기록(학습루프 수집)을 그대로 받기 위해.
//
// 폴백 계약: 이 루프는 실패하거나 할 일이 없으면 null을 돌려주고, 호출자(dispatcher)가 기존
// 채팅 경로로 폴백한다. 즉 루프 도입으로 기존 동작이 나빠지는 회귀가 없다.

import { chat, 자료없음배너, 자료없음중복가드, 지정범위배너 } from "./llm";
import { currentDocIds } from "./ragscope";
import { 새근거수거, 근거를수거하며 } from "./toolevidence"; // 도구가 읽은 근거를 위로 나르는 꼬리표(잎 모듈)
import { 표식 } from "./tone";
import { reportProgress } from "./progress";
import { listAgentTools, listToolsFor, findAgentTool, toolCatalogText, validateToolArgs, buildApproval, PendingApproval, NO_HIT_PREFIX, 되묻기표지, 지식근거없음표지 } from "./agenttools";
import type { AgentTool } from "./agenttools";
import { 법령검색없음표지 } from "./lawinfo";
import { emitCollaboration } from "./collaboration";
import { listProducts } from "./securityproducts";
import { 문서지목질문, 제목지목질문 } from "./memory";
import { recordWork, TOOL_WORK_KIND } from "./worklog";
import { listTasks } from "./tasks";
import { 자산표시이름, listAssets } from "./assets";
import { extractLexicalTerms } from "./hybridsearch"; // CVE 뽑기는 CODE_RE 한 곳 — 새 CVE 정규식을 짓지 않는다(scandrafts와 같은 계약, 2026-09-03)
import { 말조사 } from "../util/josa";

const MAX_STEPS = 5;

// 조회에 그치지 않고 **무언가 하라는** 지시. 이런 말투면 조회 결과가 다음 행동의 재료일 수 있어
// 루프를 한 걸음 더 진행한다(directAnswer 조기 종료를 건너뛴다). 넓게 잡아 두는 편이 안전하다 —
// 잘못 잡히면 응답이 몇 초 느려질 뿐이지만, 놓치면 "배정해줘"가 조회로 끝나 버린다.
const ACTION_INTENT_RE =
  /배정|지정|맡겨|넘겨|바꿔|변경|수정|등록|추가|삭제|지워|해제|승인|반려|실행|시작|돌려|생성|만들|작성|보내|올려|내려|설정/;

// #8 대화 맥락 — 직전에 다룬 취약점을 기억해 "아까 그거 이영희로 바꿔" 같은 후속을 해석한다.
//
// ⚠ **대화마다 따로 기억한다.** 예전에는 전역 1건이었고 주석에 "1인 운영 전제"라고 적혀 있었다.
//   그 전제는 낡았다 — 지금은 보안담당자 여럿이 각자 대화창을 쓴다.
//   전역 1건이면 담당자 A가 방금 다룬 취약점을 **담당자 B의 "아까 그거"가 가리킨다.**
//   남의 맥락으로 남의 자산에 쓰기 지시가 나갈 수 있다(2026-08-03 발견).
// ⚠ 전역이던 시절의 부작용이 하나 더 있었다: 오래 도는 작업(147상황 시뮬레이션) 중
//   앞 질문이 남긴 대상이 10분간 살아 있어, 맥락 없는 "그거 어떻게 해"까지
//   "맥락이 있다"고 판단해 되묻기가 안 걸렸다.
interface LastTarget { assetId: string; finding: string; label: string; at: number }
const 대화별대상 = new Map<string, LastTarget>();
const 기본대화 = "기본";
const TARGET_TTL_MS = 10 * 60 * 1000;
const 대화상한 = 200;   // 대화가 계속 생겨도 메모리를 무한히 먹지 않게
const ANAPHORA_RE = /아까|방금|그거|그것|이거|이것|저거|그\s*취약점|위\s*취약점|같은\s*(거|취약점)|그\s*건|이\s*건/;

export function setLastTarget(assetId: string, finding: string, label: string, 대화 = 기본대화): void {
  if (!assetId || !finding) return;
  대화별대상.set(대화, { assetId, finding, label, at: Date.now() });
  // 오래된 것부터 정리 — 대화가 계속 생겨도 메모리가 안 는다.
  if (대화별대상.size > 대화상한) {
    const 오래된순 = [...대화별대상.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of 오래된순.slice(0, 대화별대상.size - 대화상한)) 대화별대상.delete(k);
  }
}
/**
 * 이 대화에서 **직전에 다룬 자산**(2026-08-09 ③). 없으면 null.
 *
 * 왜 밖으로 내보내나: 되묻기 관문은 직전 대상이 있으면 「맥락으로 풀린다」고 보고 비켜 준다.
 * 그런데 정작 그 대상을 **쓰는 곳이 없었다** — 「그 서버 취약점 몇 건?」이 관문을 지나
 * 세는 질문 강제 분기로 가서 **전역 4,828건**을 답했다(선택 항목 맥락 ④와 같은 병의
 * 마지막 조각). 관문이 있다고 판단했으면 그 맥락을 실제로 써야 말과 행동이 맞는다.
 */
export function 직전대상자산(대화 = 기본대화): { assetId: string; label: string } | null {
  const t = recentTarget(대화);
  return t ? { assetId: t.assetId, label: t.label } : null;
}

function recentTarget(대화 = 기본대화): LastTarget | null {
  const t = 대화별대상.get(대화);
  if (!t) return null;
  if (Date.now() - t.at >= TARGET_TTL_MS) { 대화별대상.delete(대화); return null; }
  return t;
}
export function resetContextForTests(): void {
  대화별대상.clear();
}

// 벤치(tools/orchestrator-bench.mjs)와 동일한 결정 스키마 — 벤치 결과가 곧 이 루프의 실측 근거다.
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["tool", "final"] },
    tool: { type: "string" },
    args: { type: "object", additionalProperties: { type: "string" } },
    answer: { type: "string" },
  },
  required: ["action"],
} as const;

export interface AgentToolCall {
  tool: string;
  args: Record<string, string>;
  result: string;
}

export interface AgentLoopResult {
  output: string;
  toolCalls: AgentToolCall[];
  // 쓰기 도구가 선택되면 실행 대신 결재판을 돌려준다 — 승인은 /api/agent/approve로만(시안 B).
  approval?: PendingApproval;
  // ★ 도구가 **실제로 읽은** 사내 문서 근거(2026-09-08). 도구가 답한 자리에는 근거 배지의
  //   생산자가 없어 sources가 늘 비어 있었다(toolevidence.ts 머리말). 셋은 **함께** 나른다 —
  //   근거세기가 비면 클라가 초록 「📄 근거」로 그려 새 거짓 배지가 된다.
  sources?: string[];
  근거세기?: "강함" | "약함";
  quotes?: { documentId: string; text: string }[];
}

interface Decision {
  action: "tool" | "final";
  tool?: string;
  args?: Record<string, string>;
  answer?: string;
}

function parseDecision(raw: string): Decision | null {
  try {
    const p = JSON.parse(raw) as Decision;
    if (p.action !== "tool" && p.action !== "final") return null;
    return p;
  } catch {
    // 잘린 JSON 회수(실측 2026-07-18): action=final일 때 모델이 도구 결과(자산 목록 등)를 answer에
    // 통째로 뱉으면 maxTokens에서 잘려 JSON이 깨진다. 그 answer는 어차피 composeFinalAnswer가
    // 재작성하므로 버려도 되고, tool 결정의 tool/args는 잘림 앞부분에 온다 → action만 회수하면 된다.
    // (LLM 연결 실패 안내문 "⚠…" 등 action이 없는 진짜 비JSON은 아래에서 null로 폴백된다.)
    const actionM = raw.match(/"action"\s*:\s*"(tool|final)"/);
    if (!actionM) return null;
    if (actionM[1] === "final") return { action: "final" };
    const toolM = raw.match(/"tool"\s*:\s*"([a-zA-Z_]+)"/);
    if (!toolM) return null;
    const argsM = raw.match(/"args"\s*:\s*(\{[^}]*\})/);
    let args: Record<string, string> = {};
    if (argsM) {
      try {
        args = JSON.parse(argsM[1]) as Record<string, string>;
      } catch {
        /* args가 잘렸으면 빈 인자로 — 규칙 검증(validateToolArgs)이 뒤에서 잡는다 */
      }
    }
    return { action: "tool", tool: toolM[1], args };
  }
}

function decisionPrompt(instruction: string, calls: AgentToolCall[], context = "", scope?: ToolScope, fewshot = ""): string {
  const ctx = context ? ["", context, '위는 같은 세션의 이전 대화다. 지시가 "이어서/그거/방금"처럼 앞을 가리키면 이 맥락을 근거로 해석하라.'] : [];
  const history = calls.length
    ? [
        "",
        "지금까지 실행한 도구와 결과:",
        ...calls.map((c, i) => `[${i + 1}] ${c.tool}(${JSON.stringify(c.args)}) →\n${c.result}`),
        "",
        "위 결과로 지시에 답할 수 있으면 action=final로 답하고, 추가 조회가 필요할 때만 다른 도구를 호출하라.",
      ]
    : [];
  return [
    "너는 GIJO AS 보안 플랫폼의 오케스트레이터다. 사용자 지시를 읽고 아래 도구 중 하나를 골라 호출하거나, 도구가 필요 없으면 직접 답한다.",
    "",
    "사용 가능한 도구:",
    toolCatalogText(scope?.domains, scope?.role),
    "",
    "규칙:",
    '- 반드시 JSON 객체 하나만 출력한다: {"action":"tool","tool":"도구이름","args":{...}} 또는 {"action":"final","answer":"직접 답변"}',
    "- 지시와 맞는 도구가 없으면 action=final로 답한다. 도구 이름을 지어내지 않는다.",
    "- args 값은 모두 문자열로 쓴다.",
    ...(fewshot ? [fewshot] : []),
    ...ctx,
    ...history,
    ...anaphoraHint(instruction, scope?.대화),
    "",
    `사용자 지시: "${instruction}"`,
  ].join("\n");
}

/**
 * **가리킬 것이 없는 대명사인가.** "그거 어떻게 해"처럼 대명사뿐이고 직전 대상도 없는 말.
 *
 * 실측(2026-08-03 실전 147상황): 이 말에 LLM이 **27초를 쓰고** "질문을 구체적으로
 *   알려주시면 도와드리겠습니다"를 내놓았다. 되묻는 것은 **맞는 답**이다 —
 *   맥락이 없는데 아무거나 골라 답하면 엉뚱한 자산을 손대게 된다.
 *   틀린 것은 답이 아니라 **27초**다. 되묻는 데 모델이 필요할 리 없다.
 *
 * ⚠ 좁게 잡는다:
 *   · 직전 대상이 **있으면** 잡지 않는다 — 그건 #8 맥락 기능이 이어받아야 한다
 *   · 대명사 말고 **다른 내용이 있으면** 잡지 않는다("그 취약점 담당자 배정해줘"는 진짜 지시다)
 */
export function 가리킬것없는대명사(instruction: string, 대화 = 기본대화): boolean {
  if (!대명사뿐인가(instruction) && !가리킨자산이없나(instruction)) return false;
  return !recentTarget(대화);   // **이 대화의** 직전 대상이 있으면 맥락으로 푼다
}

/**
 * 「이 서버 어떤 서비스 돌고 있어?」처럼 **대상을 가리키기만 하고 무엇인지 안 밝힌** 자산 질문.
 *
 * ★ 왜 갈랐나(2026-08-06 147상황 실측): 이 말이 **47초**를 쓰고 엉뚱한 답을 냈다 —
 *   "이 자산에서 발견된 1개 취약점 중 우선순위가 낮은 것은 1건입니다"(서비스를 물었는데 취약점).
 *   위 「대명사뿐인가」는 뒤에 내용이 붙어 있어 안 걸렸고, 모델은 **어느 서버인지 모르는 채로**
 *   아무 도구나 골랐다. 대상이 없으면 답이 아니라 **되묻기**가 맞다(27초 사고와 같은 병).
 *
 * ⚠ 좁게 잡는다 — 자산을 특정하는 말(이름·IP·호스트명·「전체/모든」)이 있으면 진짜 지시다.
 */
export function 가리킨자산이없나(instruction: string): boolean {
  const t = String(instruction ?? "").trim();
  if (!/(이|그|저|해당)\s*(서버|자산|장비|호스트|시스템|머신)/.test(t)) return false;
  // ⚠ **속성을 캐묻거나 세는 말만** 잡는다(어떤·무슨·뭐가·어디·몇·얼마). 「이 자산 취약점 알려줘」처럼
  //   갈 도구가 분명한 지시는 삼키지 않는다 — 진짜 지시를 되묻기로 막으면 그게 더 나쁘다
  //   (2026-08-06 회귀: 이 조건 없이 만들었다가 기존 시험이 그 자리에서 잡았다).
  // ★ 세는 말(몇·얼마)을 더한다(2026-08-09 ④): 「이 자산 취약점 몇 건이야?」가 대상 없이
  //   세는 질문 강제 분기로 새서 **전역 4,828건**이 나갔다(선택 항목 맥락 A/B/C 교차검증의
  //   C가 잡은 공백). 화면에서 골라 뒀으면(선택) 관문 자체를 건너뛰므로(!선택) 안 걸린다.
  if (!/(어떤|무슨|뭐가|뭘|어디|어느|몇|얼마)/.test(t)) return false;
  if (/\d{1,3}(\.\d{1,3}){3}/.test(t)) return false;            // IP를 적었다 = 특정했다
  if (/전체|모든|전부|목록|리스트/.test(t)) return false;         // 대상이 하나가 아니다
  // 등록된 자산 이름이 문장에 있으면 특정한 것이다(이름으로 부르는 게 이 제품의 관례).
  // (검토관 2026-08-07: require는 vitest ESM 변환에서 미정의로 죽어 catch에 삼켜질 수 있다
  //  — 시험과 제품이 딴 길을 걷는 유일한 자리였다. 이미 정적 임포트하는 assets에서 가져온다.)
  try {
    for (const a of listAssets()) {
      const 이름 = String(a.name ?? "").trim();
      if (이름.length >= 3 && t.includes(이름)) return false;
    }
  } catch { /* 목록을 못 봐도 판정은 계속한다 — 못 보면 되묻는 쪽이 안전하다 */ }
  return true;
}

/**
 * 대명사 말고는 **내용이 없는 말인가.** 직전 대상이 있든 없든 판정은 같다.
 *
 * ★ 왜 갈랐나(2026-08-04 147상황 재측정): 「그거 어떻게 해」가 **25초**를 쓰고
 *   "무엇을 해야 하는지 구체적으로 알려주세요"(23자)를 냈다. 직전 대상이 남아 있어
 *   되묻기 경로를 비켜 갔고, 넘겨받은 모델은 결국 **똑같이 되물었다** — 25초 늦게, 더 불친절하게.
 *   대명사뿐인 말은 어느 쪽이든 모델이 필요 없다. 대상이 있으면 그것을 짚어 확인받고,
 *   없으면 되묻는다. 둘 다 즉답이다.
 */
export function 대명사뿐인가(instruction: string): boolean {
  const t = String(instruction ?? "").trim();
  if (!t || !ANAPHORA_RE.test(t)) return false;
  // 대명사·기능어를 걷어내고 **남는 내용이 거의 없을 때만** 잡는다.
  const 남은 = t
    // 전역 사본으로 치환한다(2026-08-08): /g 없는 원본은 첫 대명사만 지워 「아까 그거」에서
    // 그거가 살아남았다. 원본에 /g를 달지 않는 이유 — 위 .test()가 lastIndex 상태를 갖게 돼
    // 호출마다 결과가 달라진다(전형적 정규식 함정).
    .replace(new RegExp(ANAPHORA_RE.source, "g"), " ")
    // 아까·방금·다시(2026-08-08): 「아까 그거 다시」가 "아까다시" 4자로 남아 관문을 비켜
    // LLM으로 갔고, 모델이 「다시 확인해 주세요.」 7자 단답을 냈다(150상황 실측). 시간
    // 부사와 재시도어는 대상을 더하지 않는 기능어다.
    .replace(/어떻게|어떡|뭐|무엇|해야|하지|하나요|해줘|해\s*줘|알려|보여|아까|방금|이전에|다시|재차|좀|요|는|은|을|를|이|가|\?|\.|,/g, " ")
    .replace(/\s+/g, "");
  return 남은.length <= 2;
}

/**
 * 선택 치환(2026-08-09 2단계) — 화면에서 고른 항목이 있으면 대명사 자리에 **그 이름을 박는다**.
 * 「이 자산 취약점 몇 건이야?」 + 선택 「자산 웹서버A」 → 「자산 웹서버A 취약점 몇 건이야?」.
 * 왜: 선택맥락은 contextText로 모델에게 가지만 **강제 분기(forcedToolFor)는 지시문만 본다** —
 * 치환 없이는 선택을 무시하고 전역 도구로 갔다(실앱 e2e 실측: 한 자산을 골라 물었는데 4,828건).
 * ⚠ 대명사가 없으면 원문 그대로 둔다 — 「미조치 취약점 몇 건?」은 전역 질문일 수 있어
 *   칩이 붙어 있다고 마음대로 좁히면 묻지 않은 답을 주게 된다(선택은 맥락으로만 동행).
 */
export function 선택을박는다(instruction: string, 선택: string): string {
  const t = String(instruction ?? "");
  // ⚠ 앞이 문장 시작·공백일 때만 — 안 그러면 「필요 자산」의 「요 자산」, 「높이」의 「이」까지 문다.
  // ⚠ 낱말 뒤에 한글이 더 붙으면 **다른 낱말**이다 — 평가 게이트가 잡은 실사고(2026-08-09):
  //   「그냥 아무 **얘기**나 해봐」의 「얘」가 대명사로 잡혀 직전 대상이 박히는 바람에
  //   잡담 질문이 자산 목록 조회로 갔다(korean 축 100%→95.8% 하락). 「이것저것」도 같은 병.
  const 지시어 =
    /(^|\s)(?:(?:이|그|저|해당|요)\s*(?:자산|서버|장비|호스트|시스템|머신|항목|취약점|할\s*일|거)(?![가-힣])|(?:지금\s*)?(?:선택한?|고른)\s*(?:자산|서버|장비|호스트|시스템|머신|항목|취약점|할\s*일|거|것)(?![가-힣])|(?:이거|이걸|이것|얘)(?![가-힣]))/;
  const m = 지시어.exec(t);
  if (!m) return t;
  return (t.slice(0, m.index) + m[1] + String(선택 ?? "").trim() + t.slice(m.index + m[0].length))
    .replace(/\s+/g, " ").trim();
}

/** 직전 대상이 있을 때 — **무엇을 가리키는지 짚어 확인받고** 이어갈 길을 준다(즉답). */
export function 대명사확인(대화 = 기본대화): string | null {
  const t = recentTarget(대화);
  if (!t) return null;
  return [
    // ⚠ 내부 id(`vuln:192.168.219.98`)를 그대로 보이지 않는다 — 사람이 읽는 글자가 아니다.
    `「그거」를 **${t.finding}**(자산 ${자산표시이름(t.assetId)})로 봤습니다 — 맞나요?`,
    "",
    `${표식.다음} 이어서 하시려면`,
    `  · "이 취약점 담당자 배정해줘" — 담당자와 기한을 붙입니다(승인 창이 뜹니다)`,
    `  · "이 취약점 조치 절차 알려줘" — 무엇을 어떻게 고치는지 봅니다`,
    `  · 다른 것을 말씀하신 거면 대상을 적어 주세요(예: "○○ 자산 취약점 알려줘")`,
  ].join("\n");
}

/** 되묻는 말 — 무엇이 필요한지 **예시까지** 준다. 그냥 "구체적으로"라고 하면 또 막힌다. */
export function 되물음(): string {
  return [
    "무엇을 말씀하시는지 몰라 되묻습니다 — 앞선 대화가 없어 「그거」가 가리킬 것을 못 찾았습니다.",
    "",
    `${표식.다음} 이렇게 물어보시면 됩니다`,
    '  · "오늘 뭐부터 해야 해?" — 지금 급한 것부터 보여드립니다',
    '  · "미조치 취약점 뭐 있어?" — 목록에서 고르시면 그다음을 이어갑니다',
    '  · "○○ 자산 취약점 알려줘" — 대상을 지목하시면 그것만 봅니다',
  ].join("\n");
}

/** 자산을 가리키기만 하고 안 밝힌 질문용 되묻기 — 「이 서버」라고 물었는데 「그거」라 답하면
 *  어색하다(2026-08-07 배선 직후 실측). 무엇이 필요한지(이름·IP)를 바로 말한다. */
export function 자산되물음(): string {
  return [
    "어느 자산을 말씀하시는지 몰라 되묻습니다 — 「이 서버」가 가리키는 대상을 못 찾았습니다.",
    "",
    `${표식.다음} 자산 이름으로 다시 말씀해 주세요`,
    // ⚠ IP 예시는 안내하지 않는다 — guidance 감시가 잡았다(2026-08-07): IP+서비스 질문은
    //   결정 경로가 없어 모델 판단으로 간다. 흔들리는 말은 가르치지 않는다(안내한 말은 못 박는다).
    '  · "○○ 웹서버 어떤 서비스 돌고 있어?" — 이름으로 지목',
    '  · "자산 목록 보여줘" — 무엇이 있는지부터 보기',
  ].join("\n");
}

// ── 조치 검증 — **대상을 안 댔으면 도구를 부르지 않는다** (2026-09-07 · 야간 회귀 ⑬) ─────
//
// ★★ 실측 사고 (2026-09-06 · .tmp-reports/ops-sim.json)
//   「조치 다 했는데 어떻게 확인해?」 → 「자산 "**최근 취약점**"을 찾을 수 없습니다」
//   「고쳤다고 했는데 정말 닫혔는지 봐줘」 → 「자산 "**web-01**"을 찾을 수 없습니다」
//   둘 다 자산을 지목하지 않은 물음인데 모델이 verify_finding(장비에 접속하는 실행 도구)을
//   고르고 인자를 **지어냈다.** web-01은 도구 설명의 예문(`예: {"assetId":"web-01"…}`)이고
//   운영 자산은 0건이다. 대상이 없으면 답이 아니라 **되묻기**가 맞다 —
//   같은 파일 위쪽의 27초 사고(가리킬것없는대명사)와 같은 병이고, 이쪽이 더 나쁘다:
//   그 자산이 **우연히 실재하면 엉뚱한 장비에 붙는다.**
//
// ⚠ **진짜 지시를 되묻기로 막으면 그게 더 나쁘다**(이 파일의 확립 원칙). 그래서 잣대는
//   「등록된 자산인가」가 아니라 **「사람 말에서 온 값인가」**다 — 사람이 없는 이름을 댔으면
//   그건 지목이므로 도구가 정직하게 「못 찾았다」고 답하게 둔다.
// ⚠ **근거는 「지시문 ∪ 앞선 조회 결과」다** — 이 저장소가 이미 정한 잣대다(buildApproval이
//   쓰기 도구의 지어낸 값을 가려낼 때 쓰는 것과 같다). 모델이 list_assets를 먼저 부르고 그
//   결과의 자산 이름으로 검증을 걸면 그건 **근거 있는 값**이지 지어낸 값이 아니다.
//   이 갈래를 빠뜨리면 「자산 목록 보고 → 그 자산 검증」이라는 정상 흐름이 되묻기로 막힌다.
export function 지목없는검증대상(
  instruction: string,
  assetId: string | undefined,
  근거: { 대화?: string; 범위자산?: string; 앞선결과?: string } = {},
): boolean {
  const 납작 = (s: string | undefined) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
  /** vuln: 같은 접두어 유무로 같은 자산이 다른 값처럼 보이지 않게 — resolveAsset도 둘을 같게 본다. */
  const 아이디핵 = (v: string | undefined) => 납작(v).replace(/^[a-z]+:/, "");
  const id = 납작(assetId);
  if (!id) return true;                                   // 인자 자체가 없다
  // ⚠⚠ **낱말 경계를 본다 — 그냥 포함이면 안 된다**(2026-09-07 반증에서 내가 밟았다).
  //   지어낸 「web-01」이 실재 자산 「payment-web-01」의 **일부라서** 그냥 포함으로는 통과했다.
  //   그러면 지어낸 값이 근거 있는 값으로 둔갑하고, resolveAsset이 느슨히 붙으면
  //   **엉뚱한 장비**로 간다 — 이 관문이 막으려던 바로 그 사고다.
  const 경계로있나 = (건초: string | undefined, 바늘: string): boolean => {
    if (바늘.length < 2) return false;
    const 이스케이프 = 바늘.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 앞뒤가 **식별자 글자가 아니어야** 한다(문장 끝·시작 포함). id에 흔한 -·.·_는 글자로 친다.
    // ⚠⚠ **한국어 조사는 경계다**(2026-09-07 검토관 적발). 한글을 통째로 식별자 글자로 치면
    //   「web-01**의** 조치 검증해줘」·「결제서버**를** 검증해줘」처럼 **가장 흔한 한국어 어순**이
    //   「지목 없음」으로 판정된다. 그러면 이 관문이 스스로 적어 둔 계약(「사람이 없는 이름을 댔으면
    //   막지 않는다 — 도구가 정직하게 못 찾았다고 답한다」)을 어기고, 되묻기가 **사실과 다른 말**을 한다.
    // ⚠ 그렇다고 한글을 전부 경계로 풀면 「회계DB**서버**」가 「회계DB」 지목으로 둔갑한다.
    //   그래서 **조사 목록**만 연다 — 조사 뒤가 다시 한글이면(…서버) 경계로 안 친다.
    const 조사 = "으로|에서|에게|한테|이랑|이나|부터|까지|보다|처럼|라도|은|는|이|가|을|를|의|와|과|랑|도|만|나|로|야";
    const 뒤 = `($|[^0-9a-z가-힣_.-]|(?:${조사})(?=$|[^0-9a-z가-힣_.-]))`;
    return new RegExp(`(^|[^0-9a-z가-힣_.-])${이스케이프}${뒤}`, "i")
      .test(String(건초 ?? "").toLowerCase());
  };
  // ⓪ 🗂 지금 범위를 담당자가 **직접 걸어 둔** 자산이면 지목한 것이다(범위를입힌다가 넣은 값).
  //    ⚠ 값이 **같을 때만**이다 — 모델이 범위를 무시하고 딴 자산을 지어냈으면 그건 지목이 아니다.
  if (근거.범위자산 && id === 납작(근거.범위자산)) return false;
  if (경계로있나(instruction, String(assetId ?? "").trim())) return false; // ① 사람이 그 말을 실제로 했다
  // ② 화면에서 고른 항목(⌗이름::키) — registry의 autoFill이 `키[1]`을 assetId로 뽑는 그 값이다.
  //   ⚠⚠ **그 항목이 바로 이 자산일 때만**이다(2026-09-07 검토관 적발). 예전엔 표지가 있기만 하면
  //     통과라, 화면에서 **자산이 아닌 것**(문서·점검 항목)을 골라 둔 상태면 모델이 지어낸 assetId가
  //     그대로 지났다. 이름으로 고른 경우는 ①·⑤가 이미 잡으므로, 여기 남는 것은 구멍뿐이었다.
  //   ⚠ verify_finding은 write:false라 **autoFill이 안 돈다**(그건 buildApproval 안에서만 돈다) —
  //     즉 이 값을 인자에 넣어 주는 것이 아무도 없다. 그래서 대조는 여기서 해야 한다.
  const 고른것 = /⌗(.+?)::[0-9a-f]{16}/.exec(String(instruction ?? ""))?.[1]?.trim();
  if (고른것 && 아이디핵(고른것) === 아이디핵(assetId)) return false;
  // ③ 직전 대상(「아까 그거」) — 맥락에서 온 근거 있는 값이다(#8 흐름을 끊지 않는다)
  const ctx = recentTarget(근거.대화 ?? 기본대화);
  if (ctx && 납작(ctx.assetId) === id) return false;
  // ④ 앞선 도구 결과에 그 이름이 있으면 **읽고 옮긴 값**이다(지시문 ∪ 조회 결과)
  if (경계로있나(근거.앞선결과, String(assetId ?? "").trim())) return false;
  // ⑤ 사람이 **이름으로** 부르고 모델이 그 자산의 **id로 바꿔 넣은** 정상 흐름은 지목이다.
  //
  // ⚠⚠ **그 자산이 바로 이 assetId일 때만이다**(2026-09-07 검토관 적발 · 이 관문의 가장 큰 구멍).
  //   예전엔 「등록 자산 이름이 지시문에 있기만 하면」 통과라 **args.assetId를 한 번도 안 봤다.**
  //   그래서 「결제서버 조치 검증해줘」에 모델이 **db-02(회계DB)**를 넣어도 그대로 지났고,
  //   resolveAsset은 그 id로 회계DB를 즉시 찾아 **엉뚱한 장비에 접속**한다 —
  //   이 관문 머리글이 「그 자산이 우연히 실재하면 엉뚱한 장비에 붙는다」고 적은 바로 그 사고다.
  //   ⓪(범위자산)·③(직전 대상)은 처음부터 등가를 요구했는데 ⑤만 아무것도 안 요구했다.
  //   낱말 경계도 ①·④와 같은 잣대로 맞춘다(그냥 포함이면 「web-01」이 「payment-web-01」에 붙는다).
  // ⚠ 예전 주석이 댄 근거 「autoFill이 이름→id로 바꿔 둔 경우」는 **이 길에 없다** — autoFill은
  //   buildApproval(결재판)에서만 돌고 verify_finding은 write:false라 결재판을 안 탄다.
  //   진짜 근거는 **모델이 스스로 이름→id로 바꾸는 것**이고, 그건 등가로 확인할 수 있다.
  try {
    for (const a of listAssets()) {
      if (아이디핵(a.id) !== 아이디핵(assetId)) continue;   // ★ 딴 자산의 이름은 이 값의 근거가 아니다
      for (const 표기 of [a.name, a.id]) {
        if (경계로있나(instruction, String(표기 ?? "").trim())) return false;
      }
    }
  } catch { /* 목록을 못 봐도 판정은 계속한다 — 못 보면 되묻는 쪽이 안전하다 */ }
  return true;
}

/** 조치 검증 대상을 안 댔을 때의 되묻기 — 표지가 붙어 **모델을 안 거치고 그대로** 나간다. */
export function 검증대상되물음(): string {
  return [
    // ⚠ 「지시에 자산이 없어」라고 **단정하지 않는다**(2026-09-07 검토관 적발). 사람이 서수·별명으로
    //   가리켰는데 확정을 못 한 회차도 이 길로 오는데, 그때 저 말은 **사실과 다르다**.
    `${되묻기표지} 어느 자산의 조치를 검증할지 확정하지 못해 되묻습니다 — 대상을 확인하지 못해 검증을 실행하지 않았습니다.`,
    "(장비에 실제로 접속하는 일이라, 대상을 짐작해서 붙으면 엉뚱한 장비를 건드립니다.)",
    "",
    `${표식.다음} 이렇게 말씀해 주세요`,
    // ⚠⚠ **여기 예시는 결정적으로 닿는 말만 쓴다**(안내한 말은 못 박는다 — 이 저장소 확립 원칙).
    //   되묻기는 「모델의 도구 선택이 흔들려서」 만든 관문이다. 그 되묻기가 권하는 말이 다시 모델
    //   판단으로 가면 회복 경로를 또 운에 맡기는 것이다(2026-09-07 검토관 적발).
    //   실측: "○○ 서버 조치 검증해줘"=규칙 없음(모델 판단) · "…검증 **실행**해줘"=verify_finding /
    //         "자산 목록 보여줘"=규칙 없음 · "자산 **현황** 보여줘"=자산 현황 카드(isAssetStatusAsk).
    //   짝 시험(verify-target-reask)이 이 줄들을 뽑아 도착지가 있는지 **매번** 확인한다.
    '  · "○○ 서버 조치 검증 실행해줘" — 자산 이름이나 id로 지목하면 그 자산만 확인합니다',
    '  · "자산 현황 보여줘" — 무엇이 있는지부터 보기',
    '  · "미조치 취약점 뭐 있어?" — 목록에서 고르시면 그다음을 이어갑니다',
  ].join("\n");
}

// #8: 지시가 "아까 그거" 류이고 최근 다룬 대상이 있으면, 그 대상을 프롬프트에 실어 해석을 돕는다.
function anaphoraHint(instruction: string, 대화 = 기본대화): string[] {
  const t = recentTarget(대화);
  if (!t || !ANAPHORA_RE.test(instruction)) return [];
  return [
    "",
    `직전에 다룬 취약점: 자산 "${t.assetId}", 취약점 "${t.finding}" (${t.label}). 지시의 "아까/방금/그거/이거"는 이것을 가리킨다 — 필요하면 이 assetId·finding을 그대로 써라.`,
  ];
}

// 파인튜닝 데이터셋 생성용(Phase 4) — 이력 없는 단일 지시의 결정 프롬프트를 그대로 돌려준다.
// 학습 예시의 question이 추론 시 orchestrator가 보내는 프롬프트와 동일해야(train==inference)
// 도구 선택이 실제로 개선된다. 도구 카탈로그가 바뀌면 데이터셋을 재생성해야 한다.
export function buildDecisionPrompt(instruction: string): string {
  return decisionPrompt(instruction, []);
}

// 결재판을 띄울 때 피드에 남길 안내문 — LLM을 한 번 더 부르지 않고 규칙으로 만든다(빠르고 결정적).
function approvalMessage(approval: PendingApproval): string {
  if (approval.missing.length) {
    const labels = approval.fields.filter((f) => approval.missing.includes(f.key)).map((f) => f.label);
    return `${말조사(approval.label, "을")} 준비했습니다. ${labels.join("·")} 값이 필요합니다 — 아래에서 채우고 승인해 주세요.`;
  }
  return `${말조사(approval.label, "을")} 준비했습니다. 아래 값을 확인하고 승인해 주세요.`;
}

// 최종 답변 재작성 — 도구 결과(사실)를 근거로 일반 chat 경로에서 한국어 답을 만든다.
// remember:true라 대화 이력·학습루프 수집·RAG 주입까지 기존 채팅과 동일하게 동작한다.
// 도구 선택 과정의 자체 실수(존재하지 않는 도구를 부름·인자 오류·실행 실패)는 결정 루프가 다음
// 스텝에서 스스로 고치라고 남겨두는 메모지, 사용자에게 보여줄 사실이 아니다. 실측(2026-07-19):
// 이 오류 메시지가 그대로 최종 답변 근거에 섞여 들어가 "자동화된 비교 도구가 없는 것을 확인했기
// 때문에" 같은 내부 과정 이야기가 사용자 답변에 새어나왔다 — 최종 답변을 만들 때는 걸러낸다.
const INTERNAL_TOOL_ERROR_RE = /^(존재하지 않는 도구|인자 오류|도구 실행 실패):/;

// 도구 결과가 이미 사람이 읽기 좋은 결정적 요약이면(directAnswer) LLM 재작성 없이 그대로 답한다.
// 단일 도구 호출일 때만 — 여러 도구를 조합한 답은 종합이 필요하므로 재작성 경로로 보낸다.
/**
 * 도구 결과에 박아 둔 **내부 식별자**를 사람에게 보이기 전에 지운다.
 *
 * 도구는 `자산이름(id=vuln:sample-web01)` 꼴로 id를 함께 낸다 — 일부러 그런 것이다.
 * LLM이 "1번 자산 자세히 봐줘" 같은 후속 지시에서 그 id로 다음 도구를 부르기 때문이다.
 * 문제는 **직답 경로**(도구 결과가 그대로 답이 되는 길)에서 그 id가 담당자 화면까지 간다는 것.
 * 실측(2026-08-01 하루 실전): "오늘 뭐부터 볼까?"의 답에 `(id=vuln:sample-web01)`이 그대로 떴다.
 *
 * ⚠ 지우는 자리는 **사람에게 나가는 마지막 지점 한 곳**이어야 한다.
 *   도구 결과(calls[].result) 자체를 지우면 LLM이 id를 잃어 후속 지시가 끊긴다.
 */
export function 사람용으로다듬기(text: string): string {
  return String(text ?? "").replace(/\s*\(id=[\w:.\-]+\)/g, "");
}

function directAnswerFor(calls: AgentToolCall[]): string | null {
  if (calls.length !== 1) return null;
  const only = calls[0];
  if (INTERNAL_TOOL_ERROR_RE.test(only.result)) return null; // 실패 결과는 재작성 경로에서 안내
  // "못 찾았다"는 답은 그대로 내보낸다 — 재작성을 거치면 "존재하지 않습니다"로 부풀려
  // 담당자가 "우리 회사엔 없구나"로 오해하는 사고가 있었다(2026-07-26 실사용).
  // ★ 법령만 예외 — 못 찾았으면 **모델에게 넘긴다**(2026-08-09, 회귀 하네스가 잡음).
  //   법령 도구가 생기자 모델이 그걸 집으면서, 「접속기록 몇 년 보관?」처럼 답이 있던 질문에
  //   "찾지 못했습니다"만 나갔다.
  //   ⚠ **찾았을 땐 절대 모델을 안 태운다**(아래 directAnswer 그대로) — 조문을 고쳐 쓰면
  //     법률은 지어내기가 가장 위험한 영역이다. 못 찾은 경우에만 연다.
  //   ⚠ 정정(같은 날 오후): 처음엔 "사내 지식도 0건이라 되짚을 곳이 없다"고 적었는데
  //     **그게 측정 실수였다**(질의 본문 키를 틀렸다). 사내 문서에 답이 있다 — 그래서
  //     여기 오기 전에 사내지식으로보강()이 근거를 얹는다. 여긴 그마저 없을 때의 마지막 길이다.
  if (only.result.startsWith(NO_HIT_PREFIX)) {
    return only.tool === "law_lookup" ? null : 사람용으로다듬기(only.result);
  }
  // ★ 되묻는 말도 그대로 내보낸다(2026-09-07) — 아래 모델을거치지않는답인가 머리글 참고.
  if (모델을거치지않는답인가(only.result)) return 사람용으로다듬기(only.result);
  return findAgentTool(only.tool)?.directAnswer ? 사람용으로다듬기(only.result) : null;
}

/**
 * 이 도구 결과는 **모델을 거치지 않고 그대로** 사람에게 나가야 하는가.
 *
 * ★★ 왜 필요한가 (야간 회귀 2026-09-06 실측)
 *   verify_finding이 낸 결정적 문구 「자산 "web-01"을 찾을 수 없습니다. 자산 이름이나 id로
 *   **다시 지목해 주세요**.」가 최종 답에서는 「… ID로 **다시 지정해 주세요**.」로,
 *   다른 회차에서는 「… 닫혔는지 확인할 수 없습니다.」로 **모델이 다시 써서** 나갔다.
 *   verify_finding은 directAnswer가 아니라 결과가 재작성 경로를 타는데, 위 NO_HIT_PREFIX
 *   보호는 **검색 0건 전용**이라 되묻는 말을 못 지켰다.
 *   제품이 정한 말이 회차마다 달라지면 그 말을 기대하는 어떤 잣대도 못 믿는다 —
 *   실제로 하네스 기대표의 「다시 지목」이 빗나가 ⑬ 두 문항이 붉었다.
 *
 * ⚠ **표지가 있을 때만이다.** 「도구 결과는 웬만하면 그대로」로 넓히면 여러 도구를 조합한
 *   답이 종합 없이 나가고, 재작성이 하던 정리(길이·말투)가 통째로 사라진다.
 */
export function 모델을거치지않는답인가(result: string): boolean {
  return String(result ?? "").startsWith(되묻기표지);
}

// ── 법령 도구가 답을 못 낸 자리를 사내 지식으로 메운다 (2026-08-09 재수리) ────────────────
//
// 어제 이 자리를 「법령은 못 찾으면 모델에게 넘긴다」로 고쳤다. 그 전제는 **"사내 지식을
// 뒤져 봐도 0건"**이었는데 그게 **측정 실수**였다(/api/memory/query에 본문 키를 question이
// 아닌 query로 보내 400을 0건으로 읽었다). 오늘 제대로 재니 두 질문 다 사내 문서가
// **1~2위로** 잡힌다 — 전자금융감독규정 제15조도, 시행령 제30조·고시 제8조도 정확히 들어 있다.
//
// 즉 답은 있는데 **라우팅이 지식에 닿지 않아** 모델의 일반 지식으로 때우고 있었다.
// 그래서 법령 도구가 부족할 때만 사내 지식을 한 번 더 뒤져 근거로 얹는다.
//
// ⚠ **찾았을 땐 건드리지 않는다.** 조문 원문을 모델이 고쳐 쓰는 것이 가장 위험하다.
//   여는 경우는 딱 둘 — ①법제처가 못 찾음 ②목록만 왔는데 「몇 년?」처럼 값을 물음.
//   ②를 넓히면 법령 조회의 본래 쓸모(목록·링크)가 흔들린다 — 어제 보류한 이유가 그것이다.
const 법령목록머리 = /^(법령|행정규칙|판례) 검색 — /;
const 값을묻는말 = /몇\s*(년|개월|달|일|시간|건|명|회|번|가지)|며칠|얼마(나|만큼|동안)?|어느\s*정도/;

/** 사내 지식을 얹을 때 쓰는 이름. 등록된 도구가 아니라 **근거 꼬리표**다. */
export const 사내지식꼬리표 = "사내지식";

/** 법령 도구 결과가 질문에 답했는가 — 판정은 코드가 한다(프롬프트에 맡기지 않는다). */
export function 법령답이부족한가(instruction: string, result: string): boolean {
  // ★ 2026-08-13 QA 회귀(fin-mangbunri): FAIL_MARKS 문구 교체로 법령 0건 답이 NO_HIT_PREFIX로
  //   시작하지 않게 되자 이 판정이 false → 사내지식 보강이 소리 없이 죽었다. 발신자(lawinfo)가
  //   내보내는 표지(법령검색없음표지)를 직접 본다 — 문구와 판정은 한 몸이어야 한다.
  if (result.startsWith(NO_HIT_PREFIX) || 법령검색없음표지.test(result.trimStart())) return true;
  if (!법령목록머리.test(result.trimStart())) return false; // 조문 본문을 받았으면 충분하다
  return 값을묻는말.test(instruction);
}

/**
 * **답이 사람에게 나가는 마지막 한 곳.** 보강 → 조립 → 딱지 → 다음 단계를 여기서 다 한다.
 *
 * ⚠ 왜 한 곳으로 모았나(2026-08-10): 처음엔 출구 두 곳(강제 분기·일반 루프 final)에만
 *   보강을 심었는데, `runAgentLoop`에는 출구가 **네 곳**이었다. law_lookup은 directAnswer
 *   도구라 목록을 받는 순간 **early return**(조회형 즉답)으로 빠져나가 보강을 건너뛰었다 —
 *   「접속기록 몇 년?」이 정확히 그 길로 샜다. 반복 상한 출구도 마찬가지였다.
 *   이 저장소가 반복해 겪은 유형이다: **갈래마다 심으면 새 갈래가 생기는 순간 샌다.**
 *   그래서 갈래를 없애고 함수 하나로 모은다. 새 출구가 생겨도 이 함수를 부르면 다 따라온다.
 */
async function 사람에게내보낸다(
  instruction: string,
  calls: AgentToolCall[],
  context: string,
  옵션: { 즉답?: string | null; 그대로?: boolean } = {},
): Promise<string> {
  await 사내지식으로보강(instruction, calls);
  // 보강이 붙었으면 즉답(도구 원문 그대로)은 더 이상 답이 아니다 — 근거가 둘이 됐으므로 다시 쓴다.
  // ⚠ **그대로=true면 길이를 안 본다**(2026-09-07 검토관 라운드). 되묻기처럼 **도구를 아예 안 부른**
  //   결정적 답은 calls가 비거나 앞선 도구가 여럿일 수 있어, 예전 조건(calls.length === 1)만 보면
  //   제품이 정한 말이 모델 재작성으로 샌다 — 「다시 지목」이 「다시 지정」으로 바뀌던 그 사고다.
  const direct = 옵션.즉답 !== undefined ? (옵션.그대로 || calls.length === 1 ? 옵션.즉답 : null) : directAnswerFor(calls);
  if (!direct) reportProgress("write", "조회 결과로 답을 쓰고 있습니다");
  const composed = direct ?? (await composeFinalAnswer(instruction, calls, context));
  reportProgress("review", "답변을 검수하고 있습니다");
  // ⚠ **조문근거를보탠다는 법령한계를밝힌다보다 안쪽**에 둔다 — 한계 문구(「원문 미확인」)와
  //   법제처 원문이 붙기 **전**에 조문을 답 본문 뒤에 붙여야, 조문이 원문 뒤로 밀려나지 않는다.
  return 다음단계붙이기(지식없음을밝힌다(법령한계를밝힌다(조문근거를보탠다(guardAgainstDenial(composed, calls), calls), calls), calls), calls);
}

/**
 * ★ #8 「네 자료엔 없음」 배너 — **도구 경로 판** (2026-08-13 라이트 QA에서 잡힘).
 *
 * 챗 RAG 경로는 llm.ts가 ragResult.자료없음으로 배너를 붙이는데, 도구 최종답
 * (composeFinalAnswer)은 RAG를 **일부러 꺼서**(GPU 경합 — 300초 무응답 원인) 그 길이 없다.
 * 여기서는 explain·remediation의 0-근거 문장(코드가 만든 결정적 표지, 지식근거없음표지)을
 * 보고 붙인다 — 정직을 모델의 재작성 운에 맡기지 않는다(코드가 문장을 붙인다).
 *
 * ⚠ 모든 유효 호출이 0-근거일 때만 — 다른 도구가 사내 데이터를 가져왔으면 「자료 있는」 대화다.
 * ⚠ 답 머리가 이미 「없습니다」로 시작하면 겹쳐 붙이지 않는다(llm.ts와 같은 가드).
 */
export function 지식없음을밝힌다(reply: string, calls: AgentToolCall[]): string {
  if (!reply || !calls.length) return reply;
  const useful = calls.filter((c) => !INTERNAL_TOOL_ERROR_RE.test(c.result));
  if (!useful.length || !useful.every((c) => 지식근거없음표지.test(c.result))) return reply;
  if (자료없음중복가드.test(reply.slice(0, 60))) return reply;
  // ☑ 지정 범위가 걸린 0건은 별개 사실(검토관 [높음] — 「이 문서에서 …」 말투는 도구 경로로
  // 오는데 여기가 옛 배너를 붙이면, 커밋이 「거짓말」이라 지목한 바로 그 문장이 가장 흔한
  // 말투에서 나간다). llm.ts chat 경로와 같은 분기 — 두 출구가 같은 사실을 말해야 한다.
  if (currentDocIds().length) return `${지정범위배너}\n\n${reply}`;
  return `${자료없음배너}\n\n${reply}`;
}

/** 부족하면 사내 지식을 한 번 더 뒤져 calls에 근거로 얹는다(제자리 수정). */
export async function 사내지식으로보강(instruction: string, calls: AgentToolCall[]): Promise<void> {
  const law = calls.find((c) => c.tool === "law_lookup");
  if (!law || calls.some((c) => c.tool === 사내지식꼬리표)) return;
  if (!법령답이부족한가(instruction, law.result)) return;
  // 열람 등급은 viewerctx의 요청 꼬리표를 hybridSearch가 알아서 집는다 — 여기서 다시 싣지 않는다.
  // 실패해도 조용히 넘어간다: 보강은 덤이고, 없다고 원래 답까지 죽이면 더 나쁘다.
  const chunks = await import("./memory.js")
    .then((m) => m.queryMemoryGraded(instruction, 5))
    .then((r) => r.chunks)
    .catch(() => [] as string[]);
  if (!chunks.length) return;
  calls.push({
    tool: 사내지식꼬리표,
    args: { question: instruction },
    result: chunks.join("\n\n---\n\n").slice(0, 3000),
  });
}

/** 사내 근거에 적힌 **조문 표기**를 그대로 뽑는다 — 짓지 않고 **복사**만 한다. */
// ⚠ **법령 이름이 붙은 조문만** 잡는다 — 맨 「제30조」는 안 잡는다(어느 법인지 모르는 번호는
//   근거가 못 된다). 처음엔 법령 이름을 손으로 나열했는데 「전자금융감독규정 제15조」가
//   빠져 금융 망분리 근거를 못 붙였다 — 이름을 열거하지 말고 **꼴로** 잡는다.
const 조문표기 =
  /((?:[가-힣][가-힣\s]{0,24}(?:법률|법|시행령|시행규칙|규정|기준|고시|지침)|법|고시|시행령)\s*제\s*\d+조(?:의\s*\d+)?)/g;

/**
 * **근거를 물었는데 답에 조문 번호가 없으면**, 우리가 실제로 읽은 사내 근거에서 조문을 뽑아 붙인다.
 *
 * ■ 왜 이렇게 하나 (2026-09-01 실측)
 *   「접속기록은 몇 년 보관하고 근거 법령은?」에 답이 1년/2년은 맞히면서 **조문 번호를 안 댔다**.
 *   문맥에는 「개인정보 보호법 시행령 제30조」가 **2조각이나 들어 있었는데** 모델이 다른 조각
 *   (해설 89·63)을 골라 쓴 것이다. 담당자가 원한 건 **조문 번호**다 — 근거를 물었으니까.
 *
 * ⚠ **모델에게 「조문을 대라」고 시키지 않는다.** 7B/14B에 프롬프트 규칙을 더해 행동을
 *   고치려던 시도는 이 저장소에서 반복해 실패했다(CLAUDE.md). 바로 위 법령한계를밝힌다와
 *   같은 방식 — **코드가 붙인다.**
 * ⚠ **짓지 않는다.** 우리가 읽은 조각에 **글자 그대로 있는 표기**만 복사한다.
 *   조각에 없으면 아무것도 안 붙인다(없는 조문을 만들면 이 기능은 없느니만 못하다).
 * ⚠ 답에 이미 그 조문이 있으면 안 붙인다(같은 말을 두 번 하지 않는다).
 */
export function 조문근거를보탠다(answer: string, calls: AgentToolCall[]): string {
  if (!answer.trim()) return answer;
  const 사내 = calls.find((c) => c.tool === 사내지식꼬리표);
  if (!사내) return answer; // 사내 근거를 안 읽었으면 보탤 것이 없다
  // ⚠⚠ **「자주 나는 오해」로 적힌 조문을 베끼면 안 된다**(2026-09-01 실측으로 즉시 드러났다).
  //   이 저장소의 근거 문서들은 **틀린 답을 일부러 적어 둔다** — 「⚠ 자주 나는 오해:
  //   「정보통신망법 제12조」가 근거라고 답하면 틀리다」처럼. 문맥을 안 보고 조문만 긁으면
  //   **그 틀린 답을 근거로 붙인다.** 첫 판이 정확히 그랬고 fin-mangbunri 회귀가 바로 깨졌다.
  //   → 조문이 **부정·정정 문장 안**에 있으면 건너뛴다.
  const 부정말 = /오해|틀리|아니|잘못|혼동|착각|해당\s*없|근거가\s*아니/;
  const 원문 = String(사내.result ?? "");
  const 문장들 = 원문.split(/(?<=[.!?。])\s+|\n+/);
  const 있는것: string[] = [];
  for (const 문장 of 문장들) {
    if (부정말.test(문장)) continue; // 틀린 답으로 적힌 조문이다 — 베끼지 않는다
    조문표기.lastIndex = 0;
    for (const m of 문장.matchAll(조문표기)) 있는것.push(m[1].replace(/\s+/g, " ").trim());
  }
  if (!있는것.length) return answer;
  // 답에 이미 있는 조문 번호는 뺀다 — 번호로 견준다(표기가 조금 달라도 중복을 막는다).
  const 답번호 = new Set([...answer.matchAll(/제\s*(\d+)\s*조/g)].map((m) => m[1]));
  const 보탤것: { n: string; t: string }[] = [];
  for (const t of 있는것) {
    const n = /제\s*(\d+)\s*조/.exec(t)?.[1];
    if (!n || 답번호.has(n)) continue;
    if (보탤것.some((x) => x.n === n)) continue;
    보탤것.push({ n, t });
  }
  if (!보탤것.length) return answer;
  const 목록 = 보탤것.slice(0, 4).map((x) => x.t).join(" · ");
  return `${answer.trim()}\n\n▸ **사내 자료에 적힌 근거 조문**: ${목록}`;
}

/**
 * 법령 답의 **근거가 어디서 왔는지**를 답에 못 박는다.
 *
 * 모델에게 "이렇게 말해"라고 시키지 않는다 — 7B/14B에 프롬프트 규칙을 더해 행동을 고치려던
 * 시도는 이 저장소에서 반복해 실패했다. 붙일지 말지는 **도구 결과가 결정**하고 코드가 붙인다.
 */
export function 법령한계를밝힌다(answer: string, calls: AgentToolCall[]): string {
  const law = calls.find((c) => c.tool === "law_lookup");
  if (!law || !answer.trim()) return answer;
  // ★ 법령검색없음표지 병기(2026-08-13 QA) — 법령답이부족한가와 같은 어긋남이 여기도 있었다.
  //   실제 0건 문구가 NO_HIT_PREFIX로 안 시작해 「원문 미확인」 경고 꼬리가 통째로 죽어 있었다.
  const 못찾음 = law.result.startsWith(NO_HIT_PREFIX) || 법령검색없음표지.test(law.result.trimStart());
  if (calls.some((c) => c.tool === 사내지식꼬리표)) {
    // 법제처가 준 목록·링크는 모델이 고쳐 쓸 수 있으므로 **원문 그대로** 덧붙여 보존한다.
    // ⚠ 다만 원문이 길면 **접는다**(2026-08-16, 야간회귀 3연속 하락 — 「접속기록 보관?」 답이
    //   2,588자로 「너무 긺」). 답 본문은 이미 상한(400토큰)이 있는데, 여기 붙는 법제처 원문에는
    //   상한이 없어 그 조문이 길면 통째로 넘쳤다. 담당자는 2,000자 넘으면 안 읽는다 — 원문은
    //   **참고**라 앞부분만 보이고 나머지는 「…(생략)」으로 접는다(원문 자체는 sources로도 남는다).
    const 원문상한 = Number(process.env.GIJO_LAW_EXCERPT_MAX ?? 900);
    const 원문본 = law.result.trim();
    const 접힌원문 = 원문본.length > 원문상한
      ? `${원문본.slice(0, 원문상한)}\n…(원문이 길어 앞부분만 보입니다 — 전문은 국가법령정보센터에서 확인하세요)`
      : 원문본;
    const 원문 = 못찾음 ? "" : `\n\n▸ 법제처에서 찾은 법령\n${접힌원문}`;
    const 꼬리 = 못찾음
      ? "⚠ **사내 자료를 근거로 답했습니다** — 법제처에서 원문은 확인하지 못했습니다."
      : "⚠ **사내 자료를 함께 근거로 답했습니다.**";
    return `${answer.trim()}${원문}\n\n${꼬리} 조문 번호와 내용은 국가법령정보센터에서 대조하세요. 법률 자문이 아닙니다.`;
  }
  if (!못찾음) return answer;
  return `${answer.trim()}\n\n⚠ **법제처에서 원문을 확인하지 못한 답입니다** — 조문 번호와 내용은 반드시 국가법령정보센터에서 대조하세요. 법률 자문이 아닙니다.`;
}

// 최종 답 길이 상한 — 도구 결과를 프롬프트에 다시 실을 때 과도하게 커지지 않게 자른다(멈춤 방지).
const MAX_FACT_CHARS = 1800;

// LLM이 최종답에서 "없다"고 부정하는 문구. 도구가 실제 데이터를 돌려줬는데 이런 답이 나오면
// 사용자에게는 "제품이 자기 데이터를 못 찾는다"로 보인다 — 실사용 신뢰를 직접 깨는 회귀다.
const DENIAL_RE = /찾을 수 없|찾지 못|정보가 없|확인되지 않|해당하는 (자산|취약점|데이터).{0,10}없|존재하지 않습니다|없습니다\.?$/;
// 도구 결과가 "실제 데이터를 담고 있는가" — 도구들이 0건일 때 쓰는 문구를 부정형으로 판별한다.
// ⚠ 2026-08-01 사고: 도구 0건 문구를 "없습니다"→"전체 N건 중 … **못 찾았습니다**"로 바꾸면서
//   여기를 안 고쳤다. 「못 찾았습니다」는 「찾지 못했습니다」와 어순이 달라 안 걸리고, 문장이
//   51자라 길이 40자 조건도 넘는다 → **0건인데 hasData=true**가 된다.
//   그러면 LLM이 정직하게 "못 찾았습니다"라고 답해도 DENIAL_RE에 걸려 도구 원문으로 덮어쓰고,
//   directAnswer의 "못 찾았다는 답은 그대로 내보낸다" 보호도 안 걸린다.
//   **0건 문구를 바꿀 때는 이 줄을 같이 본다.**
//   ★ 2026-08-14 FAIL_MARKS 전수 교정: handlers.ts의 「찾지 못했습니다」 계열을
//     「검색되지 않았습니다」로 바꾸며 그 꼴을 여기 더했다(주석의 지시 그대로).
const EMPTY_RESULT_RE = /찾지 못했습니다|못 찾았습니다|검색되지 않았습니다|없습니다|0건|해당 없음/;

/**
 * 답 끝에 **「다음 단계」 한 줄**을 붙인다 (2026-08-02 업무 절차 개편).
 *
 * 왜: 메뉴를 절차로 바꾸고 화면에 절차 띠를 달아도, 담당자는 **이 답 다음에 뭘 하는지**를
 *   여전히 스스로 알아야 한다. 대화창이 데려가야 절차가 실제로 돈다
 *   (사용자 지시: "대화창 가이드라인으로 쉽게 업무 보고 리포트까지 전과정을 볼 수 있어야").
 *
 * ⚠ 무엇을 했는지 **모르면 안 붙인다**. 아무 데나 "다음은 조치입니다"를 붙이면 맞는 말 같지만
 *   틀린 안내가 되고, 그런 안내는 한 번만 틀려도 담당자가 다시는 안 믿는다.
 * ⚠ 쓰기 도구(결재판)는 그 자리에서 이미 다음 할 일을 말한다 — 여기서 두 번 말하지 않는다.
 * ⚠ **관문(guardAgainstDenial) 안에 넣지 말 것.** 관문은 거짓 부정을 되돌리는 순수 함수다.
 *   한 번 거기에 끼워 넣었다가 관문 시험이 깨졌다(2026-08-02) — 시험이 옳았다. 이 안내는
 *   **사람에게 나가는 마지막 조립 자리**에서만 붙인다.
 * ⚠ 여기 적는 도구 이름은 **실제로 있는 도구**여야 한다. 처음엔 hardening_status·asset_status를
 *   적어 뒀는데 둘 다 없는 도구였다 — 없는 이름은 영원히 안 걸려 그 안내가 아무 데도 안 나오고,
 *   기능 QA로는 절대 안 잡힌다. nextstep.test.ts가 도구 목록과 대조해 막는다.
 */
export const 도구단계: Record<string, { 다음: string; 말: string }> = {
  // ① 발견·수집 → ② 우선순위 (뭐가 있는지 봤으면, 다음은 무엇부터냐)
  search: { 다음: "② 우선순위", 말: '무엇부터 볼지 정하려면 "지금 가장 급한 취약점 알려줘"' },
  list_assets: { 다음: "② 우선순위", 말: '이 자산들의 취약점을 보려면 "미조치 취약점 뭐 있어?"' },
  get_asset: { 다음: "② 우선순위", 말: '이 자산에서 뭘 먼저 할지는 "이 자산 취약점 우선순위 알려줘"' },
  analysis_status: { 다음: "② 우선순위", 말: '들어온 것 중 급한 것을 보려면 "지금 가장 급한 취약점 알려줘"' },
  threats: { 다음: "② 우선순위", 말: '우리 자산에 걸리는 것만 보려면 "내부 자산에 영향 주는 위협 알려줘"' },
  scan_status: { 다음: "② 우선순위", 말: '스캔 결과를 우선순위로 보려면 "오늘 뭐부터 조치해야 해?"' },
  // ① 안에서 되돌아가는 경우 — 자산 정보가 비어 있으면 채우는 것이 먼저다
  asset_coverage: { 다음: "① 발견", 말: '빠진 정보를 채우려면 "○○ 자산 담당부서 지정해줘"' },

  // ② 우선순위 → ③ 조치 (무엇부터인지 정했으면, 다음은 누가 언제)
  today: { 다음: "③ 조치", 말: '바로 시작하려면 "가장 급한 취약점에 담당자 배정해줘"' },
  urgent_todo: { 다음: "③ 조치", 말: '맡길 사람을 정하려면 "이 건 담당자 ○○로 배정해줘"' },
  finding_status: { 다음: "③ 조치", 말: '조치를 시작하려면 "이 취약점 조치 절차 알려줘"' },
  aibom_status: { 다음: "③ 조치", 말: 'AI 자산에서 위험한 것부터 손보려면 "AI 자산 취약점 담당자 배정해줘"' },

  // ③ 조치 → ④ 검증 (했다고 끝이 아니다 — 닫혔는지 확인해야 끝난다)
  maintenance_status: { 다음: "④ 검증", 말: "끝난 점검은 점검서를 올려 승인받으면 닫힙니다" },
  work_session_status: { 다음: "④ 검증", 말: '고친 것이 실제로 닫혔는지 "조치 검증 결과 알려줘"' },
  remediation: { 다음: "④ 검증", 말: "조치를 마쳤으면 재스캔으로 닫혔는지 확인합니다" },

  // ④ 검증 → ⑤ 보고 (확인까지 끝났으면 남는 일은 보고다)
  hardening_schedule_list: { 다음: "⑤ 보고", 말: '결과를 보고로 만들려면 "이번 주 보안 현황 리포트 만들어줘"' },
  compliance_status: { 다음: "⑤ 보고", 말: '근거를 붙여 보고하려면 "컴플라이언스 리포트 만들어줘"' },

  // ⑤ 보고 — 여기서 한 바퀴가 끝난다. 다음 바퀴는 다시 ①이다.
  kpi_status: { 다음: "⑤ 보고", 말: '보고 문서로 뽑으려면 "이번 달 보안 KPI 리포트 만들어줘"' },
  time_saved: { 다음: "⑤ 보고", 말: '보고에 넣으려면 "이번 달 리포트 만들어줘"' },
};

/**
 * 절차 5단계에 **속하지 않는** 조회 도구의 다음 걸음.
 *
 * 왜 따로 두나: 작업 기록·지식베이스·보안제품·자가 진단은 절차의 한 단계가 아니다.
 *   여기에 "③ 조치로 가세요"를 붙이면 맞는 말 같지만 틀린 안내가 된다.
 *   그렇다고 아무 말도 안 하면 담당자에게 **숫자만 남고 갈 곳이 없다**
 *   (147상황 실전 시뮬레이션에서 9건이 이 모양이었다 — 가장 많은 불편).
 *   그래서 단계 대신 **구체적인 다음 행동**을 준다.
 */
export const 이어서: Record<string, string> = {
  audit_search: '이 기록을 문서로 남기려면 "이번 주 보안 현황 리포트 만들어줘"',
  knowledge_status: "문서를 더 올리려면 대화창 아래 ＋로 파일을 올리세요",
  product_status: '이 제품 점검을 잡으려면 "○○ 정기 점검 잡아줘"',
  handover_status: '넘길 내용을 정리하려면 "인수인계 문서 만들어줘"',
  system_health: "문제가 있으면 각 항목의 조치 안내를 따라가면 됩니다",
  system_log_status: '사람이 한 일은 "기록 보기"에서 봅니다',
  ontology_query: "관계도 전체는 「AI 지식」 화면에서 봅니다",
  law_lookup: '우리 사내 규정과 대조하려면 "이거 해도 돼?"라고 물어보세요',
  model_adoption_status: "모델 배정은 설정 > 서버·AI에서 바꿉니다",
  report_schedule_list: '지금 만들려면 "이번 주 보안 현황 리포트 만들어줘"',
  alert_schedule_status: "알림 규칙은 설정 > 연동에서 바꿉니다",
  routine_tasks: '내 목록에 담으려면 "할 일 추가: ○○"',
  briefing: '바로 시작하려면 "가장 급한 취약점에 담당자 배정해줘"',
};

function 다음단계붙이기(answer: string, calls: AgentToolCall[]): string {
  try {
    if (!answer || answer.length < 20) return answer;
    if (answer.includes("다음 단계")) return answer;   // 이미 말했으면 두 번 말하지 않는다
    for (const c of calls) {
      const m = 도구단계[c.tool];
      if (m) return answer + "\n\n▸ 다음 단계 " + m.다음 + " — " + m.말;
    }
    // 절차 단계가 아닌 조회 도구 — 단계 번호 대신 구체적인 다음 행동을 준다.
    for (const c of calls) {
      const t = 이어서[c.tool];
      if (t) return answer + "\n\n▸ 이어서 — " + t;
    }
    return answer;   // 아는 도구가 아니면 **안 붙인다**(틀린 안내보다 없는 편이 낫다)
  } catch {
    return answer;
  }
}

/**
 * 도구가 데이터를 돌려줬는데 LLM 최종답이 그것을 부정하면, 조회 결과 원문으로 되돌린다.
 * 실측(2026-07-25): search가 자산 1건·취약점 3건을 반환했는데도 7B가 "취약점 정보를 찾을 수
 * 없습니다"로 답했다. 프롬프트 강화(위 지시문)로도 재발했다 — 7B 행동 교정은 프롬프트로 하지
 * 않는다는 원칙에 따라 코드로 막는다. 사람이 읽을 수 있는 원본을 그대로 주는 편이 정직하다.
 */
/**
 * 결과가 **온톨로지 관계만**(- X —[Y]→ Z)으로 이뤄졌는가 — 그러면 「부정을 뒤집을 데이터」가 아니다.
 * ⚠ 2026-08-21 실측: "이 가이드에 방화벽 설정 절차 있어?"(부재 질문)에 LLM이 정직하게 "없습니다"라
 *   답했는데, search가 「방화벽」의 온톨로지 관계(방화벽→보안제품, 질문과 무관)를 반환해 guardAgainstDenial이
 *   그 정직한 부정을 관계 덤프로 덮었다. 온톨로지 관계는 「그 문서에 그 내용이 있다」의 근거가 아니다.
 * ⚠ 실데이터(자산·취약점·문서 발췌)는 화살표 —[…]→ 가 없다(`|`·`[medium]` 등) — 화살표로 정확히 갈린다.
 *   그래서 실데이터엔 여전히 발동한다(2026-07-25 「search가 취약점 줬는데 7B 오부정」 보호 유지).
 */
function isOntologyOnly(result: string): boolean {
  const 줄 = result.split("\n").map((l) => l.trim()).filter(Boolean);
  const 관계줄 = 줄.filter((l) => /—\[[^\]]+\]→/.test(l));
  // 틀 줄 — 실데이터가 아니라 **감싸개/안내**: "온톨로지 관계:" 헤더 · `■ "대상"` 다중 대상 블록
  //   머리(handlers.ts:874) · `"X"는 이 제품에서 "Y"…부릅니다 — 그걸로 찾은 결과입니다.` 별칭 재시도
  //   안내(handlers.ts:861). ⚠ 이 줄들을 데이터로 세면 다중어·별칭 질문에서 정직한 부정이 다시
  //   관계 덤프로 덮인다(2026-08-21 검토관 [중]). ⚠ 실데이터(자산·취약점·발췌)는 여기 안 걸린다 —
  //   화살표도 없고 이 틀 문구도 아니라 「기타 줄」로 남아 sum≠total → false → 여전히 데이터로 셈.
  const 틀줄 = 줄.filter((l) =>
    /온톨로지/.test(l) || l.startsWith("■") || (/부릅니다/.test(l) && /찾은 결과/.test(l)));
  return 관계줄.length > 0 && 관계줄.length + 틀줄.length === 줄.length;
}

export function guardAgainstDenial(answer: string, calls: AgentToolCall[]): string {
  const hasData = calls.some(
    (c) => !INTERNAL_TOOL_ERROR_RE.test(c.result) && c.result.trim().length > 40 && !EMPTY_RESULT_RE.test(c.result)
      && !isOntologyOnly(c.result) // 온톨로지 관계만이면 데이터로 안 센다(정직한 부정을 관계 덤프로 덮지 않는다)
  );
  // ★ 이 함수가 루프의 **마지막 관문**이다 — 두 출구(538·645) 모두 여기를 지난다.
  //   LLM이 도구 결과에서 id를 그대로 베껴 오는 일이 잦아, 되돌리지 않는 길에서도 지운다.
  if (!hasData) return 사람용으로다듬기(answer); // 도구가 실제로 0건이면 "없다"가 정답
  const short = answer.trim().length < 400; // 긴 답변은 데이터를 다뤘을 가능성이 높다
  if (!(DENIAL_RE.test(answer) && short)) return 사람용으로다듬기(answer);
  const facts = calls
    .filter((c) => !INTERNAL_TOOL_ERROR_RE.test(c.result))
    .map((c) => c.result.trim())
    .join("\n\n");
  // 원자료를 통째로 쏟는 것은 마지막 수단이다 — **사람이 읽을 근거가 있으면 그것만** 추린다.
  // 실측(2026-07-30): 이 함수가 발동해 "조회 결과입니다 + 자산 원문(id=vuln:… 내부 식별자
  // 포함)"을 그대로 내보냈다. 담당자에게 내부 id 덤프는 답이 아니고, 없다는 답보다 조금 나을
  // 뿐이다. 도구가 이미 사람이 읽는 문장(문서 발췌)을 담고 있으면 그쪽을 쓴다.
  const 발췌 = extractQuotedEvidence(facts);
  // 여기도 도구 원문이 그대로 사람에게 간다 — 내부 식별자를 지운다(위 사람용으로다듬기 참고).
  if (발췌) return 사람용으로다듬기(`찾은 근거입니다.\n\n${발췌}`).slice(0, 3000);
  // ★ 2026-08-10: 머리말을 **정직하게** 바꿨다. 예전엔 「조회 결과입니다」라고만 해서,
  //   담당자는 이것이 **정리에 실패한 답**인 줄 모른 채 기계 표기를 읽었다.
  //   ⚠ 감추지 않고 밝힌다 — 자료는 찾았고 문장으로 옮기는 데 실패한 것이 사실이다.
  //   ⚠ 함께 고친 것: 도구 출력 자체를 사람 말로(자산 종류·심각도). **폴백이 나가도
  //     읽을 수 있어야** 이 자리가 부끄럽지 않다.
  return 사람용으로다듬기(
    `찾은 내용을 문장으로 정리하지 못해 **그대로** 보여 드립니다.\n\n${facts}`,
  ).slice(0, 3000);
}

/** 도구 결과에서 사람이 읽는 근거(사내 문서 발췌)만 골라낸다. 없으면 null. */
function extractQuotedEvidence(facts: string): string | null {
  const lines = facts.split("\n");
  const start = lines.findIndex((l) => l.includes("사내 문서 근거(발췌)"));
  if (start < 0) return null;
  const kept: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  · ") && !line.startsWith("      ")) break; // 발췌 블록이 끝났다
    kept.push(line.replace(/^\s*·\s*/, "  · "));
  }
  if (!kept.length) return null;
  return kept.join("\n");
}

async function composeFinalAnswer(instruction: string, calls: AgentToolCall[], context = ""): Promise<string> {
  const usefulCalls = calls.filter((c) => !INTERNAL_TOOL_ERROR_RE.test(c.result));
  const facts = (usefulCalls.length ? usefulCalls : calls)
    .map((c, i) => `[${i + 1}] ${c.tool}: ${c.result.slice(0, MAX_FACT_CHARS)}`)
    .join("\n");
  // ⚠ 작성자 orchestrator 고정 유지 — 「도구 영역 전문가가 최종 답을 쓰게」는 만들었다가
  //   게시 전 검토에서 되돌렸다(2026-08-20 검토관 상4). 이 경로는 remember를 안 켜 RAG가
  //   아예 안 돌므로 노린 실익(역할 영역 부스트)이 0인데, 부작용은 실재했다: 팀원별 두뇌
  //   위치(원격이면 최종 답이 밖으로)·모델 배정(답마다 VRAM 스왑)·어댑터 cache_prompt:false가
  //   전부 최종 답에 걸린다. 역할 부스트는 라우팅된 본답 경로(dispatcher→chat(remember))가
  //   이미 받는다 — 장비운영 주인(categoriesForRole)의 실익은 그쪽에서 난다.
  return chat({
    agentId: "orchestrator",
    // explain: 도구 실행 후 사용자에게 그대로 보여주는 최종 답변이다.
    explain: true,
    // ⚠ trusted — 이 message는 사용자 입력이 아니라 **우리가 조립한 내부 프롬프트**다
    //   (지시문 사본 + 도구 결과 + 작성 규칙). 사용자 지시 자체는 dispatcher가 이미
    //   gateUserInput으로 검사했다. 이걸 안 켜면 우리 프롬프트가 사용자 입력으로 다시 검사되어
    //   가드레일 로그가 내부 문구로 가득 차고, 차단 모드에서는 **제품이 자기 자신을 막는다**
    //   (2026-07-30 실사고: 도구 결정 0/4, A/B/A로 확인). gateway.ts 주석이 지키라던 규칙이다.
    trusted: true,
    message: [
      ...(context ? [context, ""] : []),
      `사용자 지시: "${instruction}"`,
      "",
      "방금 시스템에서 조회한 실제 데이터:",
      facts,
      "",
      "위 데이터만 근거로 지시에 대한 최종 답변을 작성하라. 데이터에 없는 내용은 지어내지 마라.",
      // 실측(2026-07-25): search가 자산·취약점 3건을 정확히 돌려줬는데도 7B가 최종답에서
      // "취약점 정보를 찾을 수 없습니다"로 뒤집었다(도구 결과 무시). RAG 그라운딩과 같은 처방 —
      // "위 데이터가 곧 조회 결과"임을 명시하고, 결과가 있으면 없다고 말하지 못하게 못박는다.
      "위 데이터는 이미 시스템이 조회해 확보한 실제 결과다. 데이터에 항목이 하나라도 있으면 '찾을 수 없다·정보가 없다·확인되지 않는다'고 답하지 말고, 그 항목들을 그대로 정리해 답하라. 데이터가 비어 있을 때만 없다고 답한다.",
      "지시에 비교 대상이나 조건이 여러 개 있으면(예: 자산 2개 비교) 하나만 다루고 끝내지 말고 전부 빠짐없이 다뤄라.",
      "같은 판단·결론을 문장만 바꿔 반복하지 마라 — 한 번만 명확히 말하고 끝내라.",
      "도구·시스템 내부 동작(어떤 도구를 썼는지, 도구가 있는지 없는지 등)은 언급하지 말고, 데이터에서 얻은 결론만 말하라.",
    ].join("\n"),
    // remember:true는 이 합성 메시지로 임베딩(RAG) 호출까지 유발한다 — 단일 GPU에서 채팅 모델과
    // 경합해 데이터가 많을 때 최종답 생성이 멈추는 원인이었다(실측: today/explain 300초 무응답).
    // 최종답에는 이미 근거(facts)가 다 실려 있어 RAG·이력이 필요 없다. 끄고, 생성 길이도 상한을 둔다.
    // 화면에서 읽는 답의 길이 상한. 800이면 **쓰는 데만 40~50초**가 든다
    //   (2026-08-09 실측: "Log4Shell 있어?" 18~63초 · 같은 질문이 회차마다 흔들림.
    //    라우팅·캐시·모델 교체를 차례로 배제하고 남은 것이 생성 시간이었다 — 초당 15~20토큰).
    // 담당자는 30초를 못 기다린다. 대화창 답은 400토큰(≈800자)이면 충분하고,
    // 더 필요한 답(보고서·긴 정리)은 리포트 경로가 따로 받는다(그쪽은 상한을 안 건드렸다).
    // ⚠ 프롬프트로 "짧게 쓰라"고 시키지 않는다 — 이 크기 모델은 그 말을 안 지킨다(제품 규칙).
    maxTokens: Number(process.env.GIJO_ANSWER_MAX_TOKENS ?? 400),
  });
}

// 지시를 에이전트 루프로 처리한다. 도구를 하나도 쓰지 않았거나 결정이 파싱 불가면 null
// (호출자가 기존 채팅으로 폴백). 도구를 썼으면 실행 내역과 최종 답변을 돌려준다.
/**
 * 이번 지시에서 쓸 수 있는 도구의 범위.
 * - domains: 화면에서 온 업무 영역(screencontext). 없으면 좁히지 않는다.
 * - role: 호출자 권한. admin이 아니면 requiredRole="admin" 도구는 후보에서 빠진다.
 * - qa: 평가 게이트/QA 호출 표시(중-3). 루프의 결정 호출은 remember를 안 써 수집이 없고
 *   쓰기 도구는 결재판(approval)으로만 나가므로 지금 동작 차이는 없다 — 향후 기록성
 *   부작용을 갖는 도구가 생기면 이 플래그를 참조해 건너뛴다.
 */
export interface ToolScope {
  domains?: string[];
  role?: string;
  qa?: boolean;
  actor?: string; // 지시한 사람 — 작업 원장(중-2)에 누가 시킨 일인지 남긴다
  // ⚠ 대화 열쇠 — "아까 그거"가 **이 대화의** 직전 대상만 가리키게 한다.
  //   없으면 기본 대화를 쓴다(단일 대화 시절 동작 그대로).
  대화?: string;
  // 🗂 지금 범위(승인 시안 mockups/자산_0단계, 2026-08-18) — 담당자가 「이 자산 안에서만」이라고
  // 명시적으로 건 것. 화면을 옮겨도 남는다.
  // ⚠ **프롬프트로 지키게 하지 않는다.** 7B에 "이 자산만 보라"고 적어 두면 지킬 때도 있고
  //   아닐 때도 있다(이 저장소가 반복해 확인한 실패다). 도구 인자를 **코드로** 채운다.
  범위자산?: string;
}

// 제품 핵심 문구인데 LLM이 "일반 질문"으로 오인해 도구를 건너뛰고 잡담으로 답하던 의도를
// 결정적으로 해당 도구에 못박는다(A단계 교훈: 라우팅 흔들림은 프롬프트 힌트가 아니라 결정적
// 후처리로 고친다). 실측(2026-07-19): "오늘 뭐부터 조치해야 해?"가 3/3 chat 폴백 → today 미호출.
// 문구가 명백할 때만 발동하도록 좁게 잡는다(과발동 시 최악이라도 우선순위 목록을 보여주는 것뿐).
// argsByModel(선택, 2026-09-03): **도구는 못 박되 인자는 모델이 뽑는다.** 「사례 등록: …」처럼 칸이 여덟(제목·한 줄·쉬운 설명·
//   연도·업종·지역·교훈·출처)이라 정규식으로는 못 가르고, 그렇다고 빈 인자로 결재판을 띄우면 담당자가 전부 손으로 채워야 한다.
//   runAgentLoop의 강제 쓰기 분기가 이 표시를 보고 extractToolArgsByModel로 인자만 뽑아 결재판에 올린다(필수값의 지어낸 값은
//   buildApproval이 종전대로 비운다 — 모델 선택 경로와 같은 잣대).
const FORCED_INTENTS: { re: RegExp; tool: string; args: Record<string, string>; argsByModel?: true }[] = [
  // "스캔 안 된 자산 있어?" — **틀린 답이 나오던 자리**(2026-08-02 평가 게이트가 잡음).
  //   LLM이 scan_status(재스캔 상태 변화)를 골라 "스캔 안 된 자산이 없습니다"라고 답했다.
  //   같은 시각 오늘 할 일에는 "스캔이 안 된 자산 609건"이 떠 있었다 — 담당자가 이 답을 믿으면
  //   609건을 없는 것으로 처리한다. 도구 이름이 비슷해 생긴 혼동이라 프롬프트로는 안 잡힌다.
  //   asset_coverage = "무엇을 모르는가"(결손), scan_status = "무엇이 달라졌는가"(재스캔 변화).
  {
    re: /(스캔|점검)\s*(안|되지)\s*(된|한|않은)?\s*자산|스캔\s*누락|점검\s*누락|커버리지.{0,6}(빠진|없는|부족)|담당(부서)?\s*(없|미지정|안\s*정)/,
    tool: "asset_coverage",
    args: {},
  },
  // 대상을 지목한 취약점 질문 — 자산 등록부만 보면 **사내 진단 보고서를 놓친다**.
  // 실측(2026-08-02): "안전대부 웹서버 취약점 알려줘"가 list_assets로 잡혀
  //   "finding 없음 · 스캔 실패 1건"으로 답했다. 같은 보고서에 5건(평문 전송·디렉토리 인덱싱 등)이
  //   적혀 있는데도 그렇다 — 목록 도구는 문서를 아예 후보에 올리지 않는다.
  // search는 자산·문서·온톨로지를 함께 보고, 자산이 비면 문서 발췌를 앞으로 올린다.
  // ⚠ 좁게 잡는다: 대상 이름이 앞에 오고 "취약점 알려/뭐/보여"로 끝나는 물음만.
  //   "취약점 몇 건이야"처럼 **세는 질문**은 목록이 맞으므로 비켜 준다(아래 적용부에서 거른다).
  {
    // ★ 「정리해줘」를 더한다(2026-08-04 지적함). 「SSH 취약점 정리해줘」가 이 규칙을 비켜
    //   모델에게 갔고, 모델은 **우리 취약점 대신 일반적인 진단 방법론**을 읊었다.
    //   담당자는 우리 것을 물었는데 남의 교과서를 받은 셈이다.
    // ⚠ 자모(ㄱ-ㅎㅏ-ㅣ)도 앞말로 받는다(2026-08-08): 「ㅇㅇ 취약점 정리해줘」의 ㅇㅇ가
    //   가-힣(완성형)에 안 걸려 이 규칙을 비켰고, LLM이 31초를 쓰고는 **쓰기 결재판**을
    //   잘못 골랐다(150상황 실측 — 조회 질문에 판정 카드가 나감).
    // ⚠ 기한·SLA가 낀 물음은 여기서 안 받는다(2026-08-08) — 「조치 기한 넘긴 취약점 있어?」가
    //   여기 걸려 텍스트 검색 미스 안내가 나갔다. 그 물음의 정답은 속성 필터(기한초과)를 가진
    //   finding_status라 뒤의 [55]가 받는다.
    re: /^(?!.*(기한|SLA))[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9._-]{2,}\s*(웹\s*)?(서버|자산|호스트|시스템|장비)?\s*(의|에)?\s*취약점.{0,6}(알려|보여|뭐|무엇|있어|있나|현황|정리)/,
    tool: "search",
    args: {},
  },
  {
    // ⚠ 앵커 없는 「뭐부터」는 **문장 맨 앞일 때만** 잡는다(2026-08-12 실측).
    //   그전에는 어디에 있든 물어서, **"방화벽이 갑자기 응답이 없어. 뭐부터 해?"** 에
    //   「오늘 조치 우선순위 5건」이 나갔다(0.8초). 담당자는 장애를 말했는데 취약점 목록을 받았다.
    //   ⚠ 이건 처음이 아니다 — dispatcher.ts의 「○○ 어떻게 해?」 주석(2026-08-01)에
    //   **"10.10.20.41 취약점 점검 뭐부터 해?"는 today가 가져가 절차가 영영 안 열렸다**고 적혀 있다.
    //   그때는 「내 할 일 이름과 겹칠 때만」으로 좁혀 막았는데, 앞에 **다른 상황 서술**이 붙은
    //   문장은 그 좁힘을 그냥 지나갔다.
    //   맨 앞이면 담당자가 아무 맥락 없이 물은 것이라 today가 맞다("뭐부터 해?").
    //   앞에 말이 붙어 있으면 **그 말이 주제**다 — 그쪽 분기·지식이 답할 자리를 뺏지 않는다.
    //   게이트·시험의 문항은 전부 「오늘 뭐부터」라 첫째 갈래가 그대로 잡는다(확인함).
    re: /오늘.{0,6}(뭐|무엇|어디|먼저).{0,4}(부터|먼저).{0,6}(조치|해|처리|봐|볼|하지)|^\s*뭐부터\s*(조치|해|하지)|(제일|가장|지금)\s*급한\s*(취약점|건|것)|우선순위.{0,4}(취약점|조치)/,
    tool: "today",
    args: {},
  },
  // 보안장비 하드닝(보안설정) 점검 — 명백한 문구는 곧장 스캔 도구로. CIS를 명시하면 cis, 아니면 국내 CCE(kisa).
  {
    re: /(하드닝|보안\s*설정)\s*(점검|진단|스캔|체크)|CCE\s*(점검|진단|기준)|(장비|서버|시스템)\s*(보안\s*)?(점검|진단)해|기준.{0,3}(점검|진단)|취약점\s*진단해|정기\s*점검\s*(돌려|실행|해)/,
    tool: "run_hardening_scan",
    args: {},
  },
  // 정기 리포트 스케줄 조회 — "다음 리포트 언제", "이번 주 스케줄" 등은 today/briefing으로 새기 쉬워 못박는다.
  {
    re: /(정기|자동)?\s*리포트\s*(스케줄|일정|예약).{0,6}(확인|알려|보여|뭐)|다음\s*(정기\s*)?리포트.{0,4}(언제|일정)|리포트\s*(자동\s*)?생성.{0,4}(언제|스케줄|일정)/,
    tool: "report_schedule_list",
    args: {},
  },
  // 통합 보안 분석(관제) 허브 현황 — "보안 분석" 키워드가 today/briefing으로 새기 쉬워 못박는다.
  {
    // ⚠ 「상관분석」을 더했다(2026-08-03 실전 147상황): 이 도구가 실제로 하는 일이
    //   소스 간 상관인데 **제 이름을 몰라** LLM에게 갔고, 모델은 웹 점검 보고서 얘기를
    //   33초 동안 늘어놓았다. 화면·기능 이름 그대로 물으면 결정적으로 잇는다.
    // ★ 「오늘 로그에서 이상 징후 있어?」를 더한다(2026-08-04 지적함). 규칙이 없어 **매번
    //   다른 답**이 나왔다(들쭉날쭉 = 못 믿는 답이다). 보안로그는 이 허브가 정규화해 들고
    //   있는 4소스 중 하나라, 로그의 이상 징후를 묻는 말은 여기가 제자리다.
    // ★ 3차(2026-08-04): 「이상한 접속 시도 있었어?」가 남아 있었다. 1회차엔 29.9초,
    //   3회차엔 **되물음으로 끝났다** — 회차마다 답이 달라지는 것이 곧 못 믿는다는 뜻이다.
    re: /통합\s*(보안\s*)?(분석|관제)|보안\s*분석\s*(현황|어때|보여)|관제\s*현황|상관\s*분석|소스\s*간\s*상관|로그[^.\n]{0,10}(이상|징후|수상|의심|특이)|(이상|수상|의심)(한|스러운)?\s*(징후|낌새|움직임|접속|로그인|시도|트래픽|접근)/,
    tool: "analysis_status",
    args: {},
  },
  // 보유 보안제품 목록 — 담당자는 "보안장비"라고도 부른다(2026-07-26 실사용: "보안장비 리스트"가
  // 통합 검색으로 가서 0건 → "존재하지 않습니다"로 답했다. 실제로는 3건 등록돼 있었다).
  // 하드닝 점검("보안장비 점검해줘")과 겹치지 않게 목록·현황을 묻는 말투일 때만 잡는다.
  {
    re: /(보안\s*(장비|제품|솔루션|기기))\s*(목록|리스트|현황|뭐|어떤|들)|(보유|도입)한?\s*보안\s*(장비|제품|솔루션)/,
    tool: "product_status",
    args: {},
  },
  // 보안 KPI 현황 — "KPI"는 영문이라 대소문자 무관하게 잡는다.
  {
    // ★ "우리 보안 점수 어때?"를 넣었다(2026-08-01 하루 실전).
    //   그전엔 모델 재량으로 가서 32초를 헤매다 엉뚱한 CVE 설명을 내놨다 —
    //   종합 보안태세 점수는 KPI가 결정적으로 계산해 두는 값이라 물어볼 것이 아니다.
    re: /보안\s*kpi|kpi\s*(현황|어때|보여)|보안\s*지표\s*(현황|보여)|보안\s*(점수|태세)\s*(어때|어떻|얼마|보여|알려|몇)/i,
    tool: "kpi_status",
    args: {},
  },
  // 작업 세션(대화 세션형) 현황.
  //
  // ★ "최근에 내가 한 작업 보여줘"를 반드시 여기로 보낸다(2026-08-01 챗봇 전수에서 발견).
  //   그전엔 모델 재량으로 갔다가 **"GIJO AS는 작업 로그를 기록하지 않습니다"**라고 답했다 —
  //   있는 기능을 없다고 잘라 말한 것이라, 담당자는 화면(작업 내역)이 있는 줄도 모르고 돌아선다.
  //   모르는 것을 지어내는 것보다 **있는 것을 없다고 하는 쪽**이 더 나쁘다.
  //   프롬프트로 타이르지 않고(확립 원칙) 경로로 못 박는다.
  {
    re: /작업\s*세션.{0,6}(뭐|확인|알려|보여)|(지난|최근)\s*(대화\s*)?세션|(최근|지난|요즘|그동안).{0,10}(내가\s*)?한\s*(작업|일)|작업\s*(내역|이력|기록).{0,8}(보여|알려|확인|뭐)/,
    tool: "work_session_status",
    args: {},
  },
  // 온톨로지(지식 그래프)를 콕 집어 물으면 그리로 간다 — [2026-07-29 평가 게이트가 잡음]
  // 도구를 2개 늘리자 "Log4Shell 완화 방법을 온톨로지에서 찾아줘"가 explain으로만 갔다.
  // 도구 목록이 길어질수록 LLM의 선택이 흔들린다는 건 이 프로젝트의 반복 실측이다 —
  // 사용자가 이름을 대고 지목한 경우까지 모델 재량에 맡길 이유가 없다.
  {
    re: /온톨로지|지식\s*그래프|트리플/,
    tool: "ontology_query",
    args: {},
  },
  // 원격 정기점검(하드닝) 스케줄 조회 — 위의 "하드닝 점검 실행"과 갈라야 한다("점검"이 겹친다).
  // 스케줄·주기를 묻는 말투일 때만 잡고, 실행 명령형은 위 run_hardening_scan으로 그대로 간다.
  // [2026-07-29 평가 게이트가 잡음] "원격 정기점검 스케줄 어떻게 되어 있어?"에 자산 취약점 답이 나왔다.
  {
    // ⚠ 좁게 잡는다(검토 지적 2026-07-29). 앞의 '원격/정기'를 선택으로 두면 맨 "점검 일정"만으로
    // 걸려 **유지보수 점검**(maintenance_items — 다른 기능이다) 질문까지 삼켰다. 또 "정기점검
    // 돌려줘"는 실행 명령인데 조회로 갔다 — 명령형 어미는 여기서 제외하고 run_hardening_scan에 맡긴다.
    // ⚠ 또 넓었다(2026-07-31 QA-M04 재발). `정기점검.{0,6}알려`가 **"정기점검 절차를 알려줘"**까지
    //   삼켰다 — 그건 스케줄 조회가 아니라 **점검을 어떻게 하는지** 묻는 지식 질문이다.
    //   담당자는 점검일 아침에 그렇게 묻는데, 돌아온 답이 "등록된 스케줄이 없습니다"였다.
    //   `절차·방법·항목·순서·단계·체크리스트`가 함께 있으면 이 도구가 아니다.
    re: /^(?!.*(절차|방법|항목|순서|단계|체크\s*리스트|어떻게\s*하))(?:.*(?:(원격|하드닝|정기)\s*점검\s*(스케줄|일정|주기)|정기점검.{0,6}(언제|어떻게|확인|알려|보여)|(원격|하드닝)\s*점검.{0,4}자동.{0,6}(돌|실행|되)))/,
    tool: "hardening_schedule_list",
    args: {},
  },
  // 유지보수 점검 현황 — [2026-08-04 평가 게이트가 채택 보류를 낸 문항]
  //   「유지보수 점검 뭐 남았어?」에 도구를 하나도 안 골랐다(LLM 판단, FLAKY).
  //   maintenance_status가 버젓이 있는데 안 불린 것 — 오늘만 여러 번 본 같은 종류다.
  // ⚠ **하드닝(원격 점검)과 다른 기능이다.** 위 규칙이 예전에 이 질문을 삼킨 적이 있어
  //   `유지보수·정비` 낱말을 못 박고, 절차·방법을 묻는 지식 질문은 위와 같은 방식으로 비켜 준다.
  {
    re: /^(?!.*(절차|방법|항목\s*설명|순서|체크\s*리스트|어떻게\s*하))(?:.*(유지\s*보수|유지보수|정비)\s*(점검|일정)?\s*[^.\n]{0,8}(뭐|무엇|남았|현황|어때|보여|알려|확인|밀린|지난))/,
    tool: "maintenance_status",
    args: {},
  },
  // 컴플라이언스 이행 현황 — [2026-07-29 평가 게이트(중-3) 첫 실행] "컴플라이언스 현황 요약해줘"에
  // 24초를 쓰고도 도구를 하나도 안 골랐다(LLM 판단). 화면·메뉴 이름 그대로 물은 건 결정적으로 잇는다.
  {
    // 2026-08-06 147상황 실측: 「KISA 위협 대응 현황 알려줘」가 **30.7초**였다(답은 맞았다).
    //   이 제품의 컴플라이언스 대장은 KISA AI 위협 대응 매뉴얼이므로 **KISA만** 이 자리로 잇는다.
    //   ⚠ ISMS-P·ISO 27001을 넣었다가 검토관이 잡았다(2026-08-07): 그 표준을 물어도 KISA
    //   카탈로그가 **표준이 다르다는 말 한 줄 없이** 확실하게 나간다 — 100% 재현되는 오답이라
    //   느린 정답(모델 경로)보다 나쁘다. 다른 표준 대장이 생기면 그때 각자 규칙을 단다.
    re: /컴플라이언스\s*(현황|이행|상태|어때|보여|요약)|(규제|통제)\s*항목\s*(현황|이행)|이행\s*현황\s*(확인|알려|보여|요약)|KISA[^.\n]{0,10}(위협\s*)?(대응|이행|준수)\s*(현황|상태|어때|보여|알려|요약)/i,
    tool: "compliance_status",
    args: {},
  },
  // 오늘의 브리핑 — 대시보드(전체 도구 노출)에서 문구가 명백한데도 LLM이 도구를 건너뛰고 잡담으로
  // 떨어지던 것(실측 0/3 → chat)을 못박는다. "문서 리포트 작성"은 여기 안 걸리게 좁게 잡는다.
  {
    re: /브리핑|아침.{0,5}(뭐|무엇).{0,4}챙|오늘.{0,6}(챙겨야|챙길|상황\s*(요약|정리))|지금.{0,4}상황\s*(요약|정리)/,
    tool: "briefing",
    args: {},
  },
  // 세는 질문 — 집계 도구가 답한다. 「몇 건/몇 개」인데 도구를 안 부르면 모델이 일반론을 편다.
  //   실측(2026-08-03): "미배정 취약점 몇 건이야?"에 "시스템에 따라 다릅니다"라고 답했는데,
  //   같은 시각 절차 띠는 "미배정 14"를 정확히 띄우고 있었다. 아는 것을 모른다고 한 것이다.
  //   ⚠ 취약점 관련 세는 말만 잡는다 — "문서 몇 건"·"점검 몇 건"은 각자 도구가 따로 있다.
  {
    // ⚠ 「검토 안 한 항목 몇 건」을 더했다(2026-08-03 실전 147상황): 안 걸려서 LLM에게 갔고,
    //   34초 뒤에 나온 답이 복창 방어에 걸려 "답변을 만들지 못했습니다"였다.
    //   세는 질문은 도구가 세면 0.1초에 정확히 답한다.
    // ★ 2026-08-04 4차 147상황: 「KEV 걸린 거 있어?」가 「몇 건」이 없어 이 규칙을 비켜
    //   모델로 새서 40초를 썼다(모델이 finding_status를 고른 회차엔 빨랐다 — 전형적 흔들림).
    //   ⚠ 「걸린|잡힌|뜬」+「있/없」을 요구한다 — 「KEV 등재 취약점 조치 기한 근거 지침이
    //     뭐야?」(시연 ③ 대본)는 지식 질문이라 가로채면 시연이 깨진다.
    re: /(미배정|배정\s*안\s*[된함]|담당자?\s*없)[^\n]{0,10}(취약점|건|것)?[^\n]{0,6}(몇|얼마)|(취약점|고위험|critical|kev)[^\n]{0,10}몇\s*(건|개)|(기한\s*(초과|지난)|지연)[^\n]{0,10}몇\s*(건|개)|(검토|확인)\s*(안\s*[한된]|못\s*한|미)[^\n]{0,10}몇\s*(건|개)|kev[^\n]{0,6}(걸린|잡힌|뜬)[^\n]{0,6}(있|없)/i,
    tool: "finding_status",
    args: {},
  },
  // ── 아래 셋은 147상황 실전 시뮬레이션이 잡은 「아는 것을 모른다고 답함」 ──────────
  // 지금 쓰는 모델 — "구체적으로 알려드리지 않습니다"라고 거절하고 엉뚱한 AI보안 일반론을 폈다.
  //   같은 시각 자가 진단은 모델 이름을 정확히 답한다. 숨길 정보가 아니라 **담당자가 알아야 할**
  //   운영 정보다 — 어떤 모델이 답했는지 모르면 답을 어디까지 믿을지도 못 정한다.
  // ⚠ model_adoption_status는 "채택 **이력**"이다 — 담당자가 묻는 것은 **지금 도는 모델**이라
  //   이력을 주면 질문에 답한 것이 아니다(2026-08-03 실서버 확인으로 바로잡음).
  //   자가 진단이 상주 모델 이름을 정확히 답한다.
  //   (주석을 re:와 tool: **사이에 두지 말 것** — guidance-check의 규칙 추출이 그 틈에서
  //    끊겨 이 규칙만 조용히 검사 밖이었다. 2026-08-21 설계관 적발 — 도구 자신이 경고한
  //    실패 모드가 도구 자신에게 일어나 있었다.)
  {
    re: /(지금|현재|우리)?\s*(무슨|어떤|뭐)\s*모델|모델\s*(뭐|무엇)\s*(쓰|사용|돌)|어떤\s*(ai|엘엘엠|llm)\s*(쓰|사용)/i,
    tool: "system_health",
    args: {},
  },
  // 어제·지난주와 비교 — "비교할 정보가 없습니다"라고 답했지만 KPI 스냅샷이 매일 쌓인다.
  //   ⚠ 비교는 KPI의 추세가 답한다. 없다고 말하는 것은 있는 기능을 없다고 하는 것이다.
  {
    re: /(어제|지난주|지난달|저번주|전주|전달)\s*(랑|와|과|보다|대비|에\s*비해)?\s*(비교|비하면|대비)|나빠진\s*거|좋아진\s*거|추세\s*(어때|어떻|보여)/,
    tool: "kpi_status",
    args: {},
  },
  // 최근에 올린 문서 — 문서 **목록**을 묻는데 RAG 본문을 답으로 삼아 남의 문서 내용과
  //   MD5 해시까지 늘어놓았다. 목록 질문은 목록 도구가 답한다.
  {
    // ★ 2026-08-04: **제품이 「올린 문서가 잘 반영됐는지 확인해줘」라고 안내해 놓고**
    //   그 말이 어느 규칙에도 안 걸렸다(안내 문구 전수 점검에서 발견).
    //   우리가 시킨 대로 쳤는데 답이 회차마다 다르면 제품이 자기 말을 못 지킨 것이다.
    //   ⚠ 「들어온」은 2026-08-06부터 여기 없다 — 「(새로/최근) 들어온 문서」는 반입 소식
    //   (recent_documents, FORCED_INTENTS[47])의 영토다. 여기는 **내가 올린 게 잘 반영됐나**만.
    //   ★ 2026-08-13 라이트 게이트: 「내가 **넣은** 자료 뭐뭐 있어?」가 안 걸려 LLM이 빈 DB에서
    //   **존재하지 않는 문서 대장을 지어냈다**(CrowdStrike 보고서·날짜·제출자까지 — 번들의 기능
    //   설명 문서가 RAG에 잡혀 #8 배너도 안 붙는 사각). 재고 질문은 등록부를 직접 세는
    //   knowledge_status로 못박는다 — 「내가」 주어와 「넣은」 동사를 어휘에 더했다.
    re: /(최근|요즘|새로|내가)\s*(에\s*)?(올린|등록한|추가한|넣은)\s*(문서|자료|파일)|문서\s*(목록|리스트)|(올린|넣은)\s*(문서|자료)\s*(뭐|무엇|보여|알려|잘|제대로)|(문서|자료).{0,8}(반영|들어갔|수집)(됐|되었|된)/,
    tool: "knowledge_status",
    args: {},
  },
  // AI가 아낀 시간 — **도구가 있는데 안 불렸다**(2026-08-03 실전 147상황).
  //   LLM이 "처리 건수를 입력해 주시면 정확한 시간을 알려드릴 수 있습니다"라고 답했다.
  //   ⚠ 담당자에게 숫자를 받아 계산하는 기능이 아니다 — **우리가 처리한 기록을 우리가 센다.**
  //   계획서 중-2의 대표 지표라 이 답이 시연에 나오면 기능이 없는 것처럼 보인다.
  {
    re: /(아낀|절감|줄인|save[d]?)\s*(시간|공수|시간이|근무)|시간\s*(을\s*)?(얼마나\s*)?(아꼈|절감|줄였)|자동화\s*(효과|성과)|(ai|에이아이)\s*가?\s*(대신|얼마나)\s*(한|해\s*준|처리)/i,
    tool: "time_saved",
    args: {},
  },
  // 위험한 순·EPSS 순으로 보여 달라 — **정렬은 코드가 하는 일**이다.
  //   실측(2026-08-03): "EPSS 점수 높은 순으로 보여줘"에 LLM이 EPSS 개념 강의를 39초 했다.
  //   today가 이미 KEV→EPSS→VPR 순으로 전 자산을 가로질러 정렬한다.
  // ⚠ "EPSS가 뭐야?"(개념 질문)는 잡지 않는다 — 그건 explain 몫이다.
  {
    // ⚠ 셋 다 today가 이미 하는 일이다(KEV 우선 정렬 · 상위 N건):
    //   · "EPSS 높은 순으로 보여줘"        — 정렬
    //   · "실제로 악용되는 것만 골라줘"     — KEV가 맨 위에 온다
    //   · "그중에 제일 위험한 거 하나만"    — 상위 1건
    //   실측(2026-08-03): 셋 다 LLM에게 갔고 각각 39초 강의 / 복창 방어에 걸려 답 못 만듦 /
    //   "밝혀내어 주세요."라는 말이 안 되는 답이 나왔다.
    // ⚠ "EPSS가 뭐야?"(개념)는 안 잡는다 — explain 몫이다.
    re: /(epss|vpr|cvss|위험도|심각도|우선순위)\s*(점수\s*)?(높은|낮은)\s*순|(높은|위험한)\s*순(으로|서)?\s*(보여|정렬|알려)|정렬해\s*(줘|주세요)|실제로\s*악용|악용\s*(되는|중인|확인된)\s*(것|거|취약점)|(제일|가장)\s*위험한\s*(거|것|취약점|자산)?\s*(하나|한\s*건|1건)?/i,
    tool: "today",
    args: {},
  },
  // 인터넷에 노출된 자산 — 실측(2026-08-03): 노출 여부를 물었는데
  //   "이 자산에서 발견된 1개 취약점 중 즉시 조치 없음입니다"라고 특정 자산 취약점을 답했다.
  //   노출 점수는 assethub가 이미 계산하는데 챗봇이 못 부르고 있었다.
  {
    re: /(인터넷|외부|공개|퍼블릭|public)(에|으로|에서)?\s*(노출|열려|접근|오픈|공개)|노출된?\s*(자산|장비|서버)|외부\s*공개\s*(자산|장비)/i,
    tool: "exposed_assets",
    args: {},
  },
  // SBOM 부품 — 파트너 지적(2026-08-04): "Tenable은 CPE만 기준이라 정보가 제한된다."
  //
  // ⚠ **조회를 먼저 본다.** 처음엔 수집(쓰기)을 앞에 뒀다가 「SBOM 얼마나 채워졌어?」가
  //   결재판으로 갔다 — **묻는 말인데 장비에 접속하겠다고 나선 것**이다.
  //   「채워**졌어?**」(묻기)와 「채워**줘**」(시키기)를 가르지 못한 탓이고,
  //   순서로 한 번, 시킴꼴 조건으로 또 한 번 막는다.
  {
    // ★ 위협 인텔 — 규칙이 **아예 없었다**(2026-08-04 안내 문구 전수 점검에서 발견).
    //   위협 화면이 「최근 탐지 내역 알려줘」라고 칩에 적어 두고 그 말이 모델 판단으로 갔다.
    //   ⚠ 「위협」만으로 잡지 않는다 — 「위협 모델링」·「이 취약점 위협도」 같은 말을 가로챈다.
    re: /(?!.*위협\s*(도|모델링))(최근|요즘|새로|오늘)\s*(뜬|들어온|올라온|새로)?\s*(탐지|위협|위협\s*정보)\s*(내역|목록)?\s*(알려|보여|뭐|있어|있나|없어)|위협\s*인텔|(우리|내부)\s*자산에?\s*(걸리는|영향)\s*위협/,
    tool: "threats",
    args: {},
  },
  {
    // ★ 「위험도 높은 자산 알려줘」(2026-08-04 147상황). 규칙이 없어 모델이 **단건 도구**를
    //   골랐고 "이 자산에서 발견된 1개 취약점은 낮은 심각도입니다"(29자)로 끝냈다 —
    //   목록을 물었는데 한 건을 답한 것이다. 등급은 자산 화면·KPI와 **같은 규칙**을 쓴다.
    //   ⚠ '자산'이라는 말을 반드시 요구한다 — 「위험한 취약점」은 자산 목록이 아니다.
    re: /(위험도?\s*(높은|높음|큰)|고위험|위험한|위험\s*큰)\s*(ai\s*)?자산/i,
    tool: "list_assets",
    args: { risk: "high" },
  },
  {
    // ⚠⚠ **조회 규칙보다 앞에 둔다**(2026-09-01 재검토 [중]). 뒤에 두고 조회 쪽에서
    //   「기재해줘」꼴을 비켜 주게 했더니 **어미를 쫓는 싸움**이 됐다 — 부탁해·주시겠어요·
    //   놔·놓아라·두세요가 줄줄이 샜다. 어미는 끝이 없다.
    //   앞에 두면 셀 필요가 없다: 쓰기 동사(기재·기입·적어·채워)가 있으면 여기서 잡히고,
    //   없으면 그냥 뒤 조회로 흘러간다. **물음만 빼면 된다**(무엇을 적을지 묻는 말은 조회다).
    // 📦 AI-BOM 칸 기입 — 「가드레일 기재해줘」(대장 §3-4 항목 5).
    //   ⚠ **조회를 먼저 뺀다.** 「AI-BOM 현황」·「보여줘」는 aibom_status의 영토다 —
    //     그쪽이 훨씬 자주 쓰이는 말이라 이 규칙이 삼키면 조회가 통째로 죽는다.
    //   ⚠ 동사를 **기재·기입·적어·채워**로 좁혔다. 「등록」·「입력」은 자산 등록·문서 입력까지
    //     끌어와서 뺐다(낱말 가로채기 계보).
    //   ⚠ 「가드레일」은 레드팀 기능에도 있는 말이라 **홑낱말로는 안 잡는다** — 기입 동사가
    //     붙을 때만이다(「가드레일 규칙 뭐야?」는 지식으로 가야 한다).
    //   ⚠⚠ **배제어에서 「목록」을 뺐다**(2026-09-01 4차 검토 [상]). 칸 이름에 「API 목록」·
    //     「MCP 서버 목록」이 있어서, 배제어의 「목록」이 **자기 양성 낱말을 먹었다** —
    //     「API 목록 기재해줘」가 어느 규칙에도 안 걸려 모델 판단으로 샜다.
    //     조회는 현황·보여줘·알려줘·얼마나가 이미 걸러 준다.
    re: /^(?![\s\S]*(현황|보여\s*줘|알려\s*줘|얼마나|어때|뭐야|뭔가|무엇|뭘|뭐를|어느|어떻게|어떤\s*걸|하나요|해야\s*(해|하나|되나)))[\s\S]*((AI-?BOM|에이아이\s*봄)[\s\S]{0,30}(기재|기입|적어|채워)|(기초\s*모델|아키텍처|파인튜닝\s*이력|데이터셋\s*출처|벡터\s*DB|시스템\s*프롬프트|가드레일|API\s*목록|MCP\s*서버|서빙\s*환경|호스팅\s*공급업체)[\s\S]{0,24}(기재|기입|적어|채워))/,
    tool: "set_aibom_field",
    args: {},
  },
  {
    // ★ AI-BOM은 **SBOM보다 먼저** 본다(2026-08-04 147상황).
    //   「자산 중에 AI-BOM 비어 있는 거 뭐야?」가 아무 규칙에도 안 걸려 엉뚱한 도구로 갔고
    //   "이 자산은 취약점 스캐너에서 포함되지 않았습니다"라는 27자를 답했다 — 묻지도 않은 말이다.
    //   ⚠ 'ai bom'을 요구하므로 'SBOM'은 여기 안 걸린다(S·B·O·M 안에 'ai'가 없다).
    //   ⚠⚠ **기입 시킴말은 비켜 준다**(2026-09-01 검토관 [상]). 이 규칙은 조회 도구인데
    //     조건이 없어 「AI-BOM에 가드레일 기재해줘」 같은 **쓰기 요청까지 삼켰다.**
    //     FORCED_INTENTS는 배열 순서대로 첫 매치에서 끝나므로 뒤에 붙인 기입 규칙
    //     (set_aibom_field)이 **영영 안 걸렸다** — 적으라고 시켰는데 목록만 받고 아무것도
    //     안 적혔다. 시험이 규칙을 **홀로** 평가해 「잡는다」로 통과한 거짓 초록이었다.
    //     ⚠ 「~해 줘」꼴(시킴말)만 비킨다 — 「AI-BOM 뭘 기재해야 해?」는 물음이라
    //       여기(조회)가 맞다.
    re: /ai[-\s_]?bom/i,
    tool: "aibom_status",
    args: {},
  },
  {
    // 「비어 있는」은 「비었」과 다른 글자다 — 사람은 둘 다 쓴다(2026-08-04 실측).
    re: /sbom[^.\n]{0,12}(얼마나|현황|범위|채워졌|채워져|정확|비었|비어\s?있|부족)|(구성요소|부품)[^.\n]{0,10}(현황|얼마나|몇\s*개|정확|비었|비어\s?있)/i,
    tool: "sbom_coverage",
    args: {},
  },
  {
    // 시킴꼴만 잡는다 — 「읽어 줘·수집해 줘·채워 줘·가져와」. 「채워졌어?」는 안 걸린다.
    re: /(패키지|구성요소|부품|sbom)[^.\n]{0,12}(읽어|수집해?|가져와|채워)\s*(줘|주세요|줄래|주라|봐|보자)|(패키지|구성요소)\s*목록\s*(읽어|수집)/i,
    tool: "collect_packages",
    args: {},
  },
  // 점수 영향 — 실측(2026-08-03): 「이 취약점 조치하면 점수 얼마나 올라?」에 33.5초를 쓰고
  //   벤더 문서의 진단 방법론을 읽어 줬다. 점수는 규칙으로 내는 값이라 지어낼 이유가 없다.
  {
    re: /(점수|보안태세|스코어)[^.\n]{0,12}(올라|오르|올리|깎|낮아|영향|바뀌)|조치하면[^.\n]{0,10}점수/,
    tool: "posture_impact",
    args: {},
  },
  // 업무 절차 단계 — 실측(2026-08-03): 「지금 우리 어느 단계가 제일 밀렸어?」에 28초를 쓰고
  //   "어떤 프로젝트를 진행 중인지 알려 달라"고 **되물었다.** 숫자는 workflow.ts가 다 세고 있다.
  {
    // ★ 「발견 단계에서 뭘 해야 해?」를 더한다(2026-08-04 147상황). 이 말이 규칙에 안 걸려
    //   LLM+RAG로 새면서 **35초**를 쓰고 Tenable 사용자 가이드를 읽어 줬다 — 남의 제품
    //   방법론 강의다. 절차 5단계는 우리가 정한 것이라 지어낼 이유가 없다.
    // ★ 「이 취약점 다음 단계가 뭐야?」도 여기서 받는다(33초 → 즉답).
    // ★ 2026-08-04 **2차**: 1차가 「단계|절차」라는 말을 요구해 한 가족의 일부만 덮었다.
    //   남은 3건은 그 말을 안 쓴다 — 「우선순위 정하려면 뭘 봐야 해?」(36초) ·
    //   「조치까지 갔는데 그다음은?」(33초) · 「보고까지 끝내려면 뭐가 남았어?」(34초).
    //   ⚠ 「하려면」은 **일부러 뺐다** — 「이 취약점 조치하려면?」은 그 건의 조치 절차를
    //     묻는 말이라 remediation이 맡아야 한다. 여기로 끌어오면 그 답을 빼앗는다.
    // ★ 2026-09-08 **좁히기**(가로채기 라운드 실측): 위 「(단계|절차)…뭐/뭘/무엇/해야」 갈래는
    //   **주어를 안 보는 규칙**이라 남의 절차까지 삼켰다 — 「등급 5단계 뭐야?」(공급망) ·
    //   「이관 절차 뭐야?」(인수인계) · 「대응 절차 뭐야?」(로그 분석) · 「학습 루프 4단계 뭐야?」(학습)에
    //   우리 업무 5단계의 **현황 숫자**가 나갔다 — 뜻을 물었는데 숫자를 준 것이다.
    //   그 넷은 **제 화면 안에서만** 화면 안내가 막아 줬을 뿐이고(panelname 명부가 「정체물음」
    //   사유로 봐주던 네 줄), 대화창이나 다른 화면에서 같은 말을 하면 그대로 샜다.
    //   → 주어를 **우리 5단계 이름**(workflow.ts의 label — 발견·수집/우선순위/조치/검증/보고)과
    //     「업무」로 못 박는다. 「발견 단계에서 뭘 해야 해?」·「조치 3단계 뭐야?」는 그대로 잡고,
    //     다른 주어의 절차·단계는 화면 안내·지식(RAG)으로 놓아준다.
    // ★ 2026-09-08 **되돌림 한 뼘**(같은 날 검토관 [중]): 좁히기 1차가 주어를 단계 **이름**으로만
    //   못 박아, 같은 것을 **가리키는 말**까지 함께 놓아줬다 — 「지금 단계에서 뭘 해야 해?」·
    //   「지금 단계 뭐야?」·「우리 절차 뭐야?」가 null이 됐다. 사람은 제 업무를 이름으로 안 부른다.
    //   같은 가족인 「어느 단계…」·「다음 단계…」는 제 갈래가 따로 있어 살아 있었으니 **같은 부류인데
    //   답이 갈리던** 자리이기도 했다. → 우리 것이 분명한 지시어(지금·현재·이번·우리·전체)를 주어에
    //   더하고, 홑지시어(이·그)는 **「해야」(무엇을 할까)일 때만** 받는다.
    //   ⚠ 「이 절차 뭐야?」를 안 받는 이유 — 보고 있는 화면의 절차(이관·대응·학습 루프)를 묻는
    //     **뜻 물음**일 수 있다. 뜻을 물으면 뜻으로 답해야 한다(위 좁히기와 같은 근거).
    //   ⚠ 홑지시어 앞의 `(?<![가-힣])`는 조사 「이」를 막는다 — 그것이 없으면 「등급이 절차…」처럼
    //     낱말 끝의 「이」가 지시어로 읽힌다.
    //   짝 시험 test/workflow-stage-routing.test.ts — 잡아야 할 꼴·놓아야 할 꼴·헛돎 반증.
    re: /(단계|절차)[^.\n]{0,10}(제일|가장|어디|어느|밀렸|밀린|현황)|(어느|어떤)\s*단계|절차\s*(어디쯤|현황)|(발견|수집|우선순위|조치|검증|보고|업무|지금|현재|이번|우리|전체)\s*\d*\s*(단계|절차)[^.\n]{0,8}(뭐|뭘|무엇|해야)|(?<![가-힣])(이|그)\s*(단계|절차)[^.\n]{0,8}해야|다음\s*단계|(발견|수집|우선순위|조치|검증|보고)\s*(까지|는|를|을)?\s*[^.\n]{0,10}(그\s*다음|다음은|남았|끝내려면|정하려면)|(발견|수집|우선순위|조치|검증|보고)\s*(은|는)\s*[^.\n]{0,8}(어떻게|뭐|무엇)/,
    tool: "workflow_status",
    args: {},
  },
  // 잃은 취약점 — 실측(2026-08-03): 실패한 modelscan이 자산 46개에서 4,817건을 덮어썼다.
  //   담당자는 "취약점이 왜 0건이야?"라고 묻지 "스캔 이력 복구"라고 묻지 않는다 — 그 말로 닿게 한다.
  // ⚠ 되살리기는 쓰기라 결재판이 뜬다. 조회(현황)와 갈라야 한다 — **되돌리겠다는 말**만 쓰기로 보낸다.
  {
    re: /(잃|사라진|없어진|날아간|지워진|덮어[쓴씌])[^.\n]{0,12}(취약점|스캔|결과)[^.\n]{0,12}(되살|복구|살려|되돌)|(취약점|스캔\s*결과)[^.\n]{0,10}(되살려|복구해)/,
    tool: "restore_lost_findings",
    args: {},
  },
  {
    re: /(취약점|스캔\s*결과)[^.\n]{0,10}(왜|어째서)[^.\n]{0,6}(0건|없|비었|안\s*나)|(잃|사라진|없어진|날아간|지워진)[^.\n]{0,12}(취약점|스캔\s*결과)|스캔\s*결과가?\s*(사라|없어)/,
    tool: "lost_findings_status",
    args: {},
  },
  // 자산을 등록하겠다 — 실측(2026-08-03 서랍 점검): `register_asset`이 있는데 안 불려
  //   **Tenable Security Center 로그인 → Explore > Assets…** 남의 제품 매뉴얼 절차를 답했다.
  //   우리 제품에서 등록하는 법을 물었는데 벤더 문서를 읽어 준 것이다.
  // ⚠ 쓰기 도구라 결재판이 뜬다 — 이름·경로가 없으면 결재판이 빈 칸을 되묻는다(그게 맞는 흐름).
  // ⚠ "자산 목록"·"자산 몇 개"(조회)와 갈라야 한다 — **등록 의사**를 밝힌 말만 잡는다.
  {
    // ⚠ 조사 하나로 새 나간다 — 「…를 **자산으로** 등록해줘」가 (을|를)에 안 걸려 chat으로 빠졌고,
    //   모델이 "등록하였습니다"라고 **지어냈다**(2026-08-09 평가 게이트 write-approval-register).
    //   그래서 「자산/장비로 등록」꼴과, 대상과 「등록」 사이에 IP·이름이 끼는 꼴을 함께 잡는다.
    // ⚠ 2026-08-10: **「하려면」은 방법을 묻는 말이다** — 「자산을 등록하려면 어떻게 해?」에
    //   `하려`가 걸려 **승인 결재판**이 떴다. 담당자는 방법을 물었는데 제품이 등록을 하려 든 것이다.
    //   (실제로 등록되진 않았지만, 묻지도 않은 승인창은 「내가 뭘 잘못 눌렀나」를 만든다.)
    //   `하려(?!면)`으로 좁힌다 — 「등록하려고」·「등록하려는데」는 그대로 의사 표시로 잡는다.
    re: /(자산|장비|서버|모델)\s*(을|를|으?로)?\s*(새로\s*)?(등록|추가)(할게|하고\s*싶|해\s*줘|해줘|하려(?!면)|할래|하자)|(새|신규)\s*(자산|장비|서버|모델)\s*(등록|추가)|(새|신규)?\s*(자산|장비|서버|호스트|모델)[^\n]{0,40}?(자산|장비)\s*(으?로)\s*(등록|추가)/,
    tool: "register_asset",
    args: {},
  },
  // 스캔 결과가 **언제** 들어왔나 — 실측(2026-08-03): 30초를 쓰고
  //   "이 자산에서 발견된 1개 취약점 중…"이라고 답했다. **언제를 물었는데 무엇을 답했다.**
  //   숫자가 언제 것인지 모르면 그 숫자로 보고를 쓸 수 없다.
  // ⚠ "언제 점검해?"(일정)와 갈라야 한다 — 그건 hardening_schedule_list 몫이라 뒤에 있다.
  {
    // ⚠ 「최신인가」는 **대상 낱말이 없으면** 무엇이든 삼킨다 — 실제로 「지식 번들 최신인가요?」를
    //   가로챘다(2026-08-05). 스캔/자료 이야기일 때만 잡도록 앞에 대상을 못 박고,
    //   번들·모델처럼 제 상태 도구가 있는 대상은 비켜 준다(적용부의 continue와 같은 원리).
    re: /(스캔|점검|취약점|자료|데이터)\s*(결과|정보)?\s*(는\s*)?(언제|얼마나\s*(됐|오래))\s*(들어|반입|올라|받|갱신|업데이트|된)|(스캔|점검|취약점|자료|데이터)\s*(결과|정보)?\s*(는\s*)?최신\s*(인가|이야|인지)|(자료|데이터)\s*(가\s*)?(오래|낡)/,
    tool: "scan_status",
    args: {},
  },
  // 이번 주 한 일 — 실측(2026-08-03): 작업 세션 **개념 설명**만 하고 실제 한 일을 안 셌다.
  //   작업 원장에 건수와 기준시간이 다 있는데 세지 않은 것이다.
  {
    re: /(이번\s*주|금주|이번\s*달|최근)\s*(에\s*)?(한\s*일|처리한|작업)\s*(정리|요약|보여|알려|뭐)|한\s*일\s*(정리|요약)해/,
    tool: "time_saved",
    args: { days: "7" },
  },
  // 자산이 몇 개인가 — 등록부를 세면 되는 일인데 LLM에게 가서 25초가 걸렸다
  //   (2026-08-03 실전 147상황, "우리 자산 몇 대야?").
  // ⚠ **"스캔 안 된 자산"과 갈라야 한다** — 그건 결손을 묻는 것이라 asset_coverage 몫이고,
  //   그 규칙이 배열에서 **앞에 있어** 먼저 잡는다(순서가 곧 우선순위).
  {
    re: /(자산|장비|서버|호스트)[^\n]{0,8}(몇\s*(대|개|건)|개수|총\s*몇)|자산\s*(총계|전체)\s*(몇|얼마)/,
    tool: "list_assets",
    args: {},
  },
  // 보고서가 어디 있는가 — "지난달 리포트 어디 있어?"가 LLM에게 가서 사내 문서(스캐너 매니페스트)를
  //   읽고 `FindingsManifestFile (MD5: ed32e90f…)`를 늘어놓았다(2026-08-03 실전 147상황).
  //   담당자는 리포트를 찾고 있었는데 남의 파일 해시를 받았다.
  // ⚠ **만들기·스케줄과 갈라야 한다** — 여기는 "어디 있나/뭐 있나"만 잡는다.
  {
    re: /(리포트|보고서)\s*(는\s*)?(어디|어딨|위치|찾아|목록|리스트)|(지난\s*(달|주)|예전|저번)\s*(리포트|보고서)\s*(어디|찾|보여|있)/,
    tool: "report_list",
    args: {},
  },
  // 보고서를 냈는가 — "이번 주 보고서 썼어?"에 **"지난주 보고서는 7월 5일에 작성되었습니다"**라고
  //   답했다(2026-08-03 실전 147상황). **이번 주를 물었는데 지난주를 답한 것**이다 —
  //   담당자는 이 답을 보고 "썼구나" 하고 넘어간다. 같은 숫자를 절차 띠 ⑤ 보고 칸은 이미
  //   결정적으로 세고 있었다. 세는 일을 모델에 맡기지 않는다.
  // ⚠ "보고서 만들어줘"(생성)와 갈라야 한다 — 여기는 **냈는지 묻는 말**만 잡는다.
  {
    re: /(보고서|보고|리포트)\s*(는\s*)?(썼|냈|만들었|작성했|올렸|했)(어|나|니|는지|던가)|(이번\s*주|이번\s*달|최근)\s*(보고서|보고|리포트)\s*(있|했|썼|냈)|보고서\s*(언제|마지막)/,
    tool: "report_activity",
    args: {},
  },
  // 지식 번들 반입 — 폐쇄망 담당자가 파일로 받은 번들을 대화창에서 넣는다(후-3 구독화 3단계, 쓰기·결재판·admin).
  //   ⚠ **상태(아래)보다 먼저 본다** — "번들 넣어줘"의 「번들」만 보면 상태 규칙도 걸린다.
  //   반입은 명령형 어미(넣/올려/반입/적용/갱신)를 못 박아 상태 조회와 갈라 낸다.
  //   "번들"은 다른 어느 규칙에도 없는 낱말이라 앞선 규칙을 가로채지 않는다(2026-08-04 확인).
  // ⚠ **묻는 말은 비켜 간다**(2026-08-05 검토 지적으로 좁힘). 예전엔 `번들.{0,4}적용`이라
  //   "번들 **언제 적용**됐어?"(조회)까지 삼켜 **반입 결재판**을 띄웠다 — 현황을 물었는데
  //   실행 확인이 뜨는 것은 오승인의 시작점이다. 명령형 어미를 못 박고, 의문형은 아래
  //   상태 규칙이 받게 한다(적용/갱신은 뒤에 명령 어미가 붙을 때만 쓰기로 본다).
  {
    re: /(지식\s*)?번들.{0,4}(반입해|반입하|넣어|넣는|넣자|올려|적용해|적용하자|갱신해|갱신하자|업데이트해)|(반입|갱신|업데이트)\s*할?\s*(지식\s*)?번들|(지식\s*)?번들\s*(을|를)?\s*(넣|반입)/,
    tool: "knowledge_bundle_import",
    args: {},
  },
  // 지식 번들 현황 — "지금 실린 지식이 언제 기준인가"(구독의 본질=최신성). knowledge_status(재고)와 다르다.
  //   ⚠ 반입(위)이 명령형을 먼저 가져가므로 여기는 조회 어미만 남는다.
  {
    // ⚠ 「번들 **언제** 적용/갱신됐어?」를 여기서 명시적으로 잡는다(2026-08-05). 쓰기 규칙을
    //   좁히자 이 말이 앞쪽 scan_status(「스캔 언제 들어왔나」)에 가로채였다 —
    //   막기만 하고 제자리를 안 주면 막다른 길이 된다. 번들 낱말이 있으면 번들 상태가 답한다.
    re: /(지식\s*)?번들.{0,6}(언제|얼마나|최신|최근).{0,10}(적용|갱신|반입|받|업데이트|인가|됐|였|이야|인지)|(지식\s*)?번들\s*(을|를|이|은|의)?\s*(상태|버전|현황|정보|목록|뭐|무엇|어떤|언제|실렸|실려|들어|최신)|(지금|현재)\s*(실린|들어\s*있는|쓰는)\s*지식\s*(은|이|의)?\s*(버전|기준|뭐|무엇|언제|어떤)|지식\s*번들/,
    tool: "knowledge_bundle_status",
    args: {},
  },
  // 에어갭 봉인 현황 — "인터넷과 분리됐나"는 기밀 배치의 핵심 신뢰 신호라 지어내면 안 된다(후-4).
  //   상태 도구가 env·차단 실측을 그대로 읽어 답한다. "에어갭·봉인·인터넷 막/차단·외부로 나가" 명시일 때만.
  // 봉인 증명서(제출물) — **상태 조회보다 먼저** 본다. "에어갭 증명해줘"의 「에어갭」만 보면
  //   상태 규칙도 걸리기 때문(번들 반입↔상태와 같은 순서 원칙). 증명서는 증명·감사 낱말로 못 박는다.
  {
    re: /(에어\s*갭|봉인).{0,6}(증명서|증명|감사\s*자료|제출)|(증명서|감사\s*자료)\s*(발행|만들|뽑|주)|봉인\s*(을|를)?\s*증명/i,
    tool: "airgap_certificate",
    args: {},
  },
  {
    re: /에어\s*갭|air\s*-?\s*gap|봉인\s*(상태|됐|여부|현황)|인터넷\s*(과|이랑|을|를)?\s*(분리|차단|막|끊)|외부(로|랑)?\s*(나가|통신|연결|전송).{0,4}(있|되|막|차단|여부|되나|하나)|외부\s*(통로|연결)\s*(있|없|막|차단)|오프라인\s*(봉인|모드)\s*(됐|상태|여부)/i,
    tool: "airgap_status",
    args: {},
  },
  // 모델 생각 모드 지정(쓰기·admin) — 자동 판별 정정. **조회(아래)보다 먼저** 봐야
  //   "생각 모드 꺼줘"가 상태 조회로 새지 않는다(번들 반입↔상태와 같은 순서 원칙).
  // ⚠ **묻는 말은 비켜 간다**(2026-08-05 검토 지적으로 좁힘). 예전엔 `켜`만 봐서
  //   "생각 모드 **켜져** 있어?"(조회)가 지정 결재판을 띄웠다. 명령형 어미(꺼줘·켜줘·바꿔)를
  //   못 박고, 상태를 묻는 말(켜져·꺼져·있어·인가)은 적응 상태 규칙이 받게 한다.
  //   ⚠ 주석에 슬래시로 낱말을 나열하지 말 것 — route-explain이 그걸 정규식으로 읽어
  //     「…있어?」 7문항이 이 규칙에 걸린 것처럼 보였다(거짓 겹침 7건, 2026-08-05).
  {
    re: /(모델|얘|이거).{0,10}(생각|thinking|추론)\s*(모드)?\s*(를|은|는)?\s*(꺼\s*줘|꺼줘|끄자|끄도록|켜\s*줘|켜줘|켜자|켤래|지정해|바꿔)/i,
    tool: "set_model_thinking",
    args: {},
  },
  // BYOM 모델 적응 상태+스모크 — "올린 모델 괜찮은가"는 BYOM 제품의 핵심 신뢰 질문이라
  //   지어내면 안 된다(자동 적응 2단계). ⚠ "무슨 모델 쓰나"(system_health[15])와 갈랐다 —
  //   여기는 적응·검증·스모크·"올린 모델" 앵커가 있을 때만.
  {
    // ⚠ 「생각 모드 **켜져 있어?**」류(조회)도 여기서 받는다(2026-08-05). 쓰기 규칙을 좁히자
    //   이 말이 아무 데도 안 걸려 **막다른 길**이 됐다 — 지정(쓰기)은 명령형만, 상태는 여기.
    re: /(모델|엔진)\s*(자동\s*)?(적응|맞춤|스모크)\s*(상태|결과|내용|어때|보여|알려)?|올린\s*모델.{0,10}(괜찮|잘\s*도|맞춰|상태|점검|검증|어때)|모델\s*(검증|점검)\s*(해|좀|해줘|결과)|(생각|thinking|추론)\s*(모드)?\s*(가|는|은)?\s*(켜져|꺼져|켜졌|꺼졌|켜진|꺼진|활성|비활성)/i,
    tool: "model_fit_status",
    args: {},
  },
  // 정기점검 **잡기**(일정 등록) — [2026-08-06 QA 서랍이 잡음, 3/3 재현]
  //   서랍이 적어 준 「{제품} 정기점검 잡아줘」(console.js)가 규칙에 안 걸려 모델 선택으로 갔고,
  //   그날 모델 상태에 따라 규칙 복창(79초)·일반 강의(40초)·엉뚱한 자산 요약(3.7초)이 나왔다 —
  //   결재판은 세 번 다 안 떴다. **서랍이 약속한 말은 결정적으로**(확립 원칙) 못 박는다.
  // ⚠ 시킴꼴(잡아/예약/등록 + 줘/주세요/할게/해)을 요구한다 — 「정기점검 언제야?」(조회)는
  //   앞의 스케줄 조회 규칙들[10~11] 몫이라 먼저 걸리고, 절차 질문은 시킴꼴이 없어 안 걸린다.
  //   productName·scheduleDate는 결재판 인자 추출이 뽑고, 빈 값은 결재판이 사람에게 물어본다.
  // ⚠ 자리: **배열 끝에 둔다** — 처음엔 유지보수 옆(12번)에 끼웠는데 routes.ts 규칙표가
  //   FORCED_INTENTS[n] 명시 번호를 써서 뒤 30개 번호가 전부 밀렸다(route-explain이
  //   컴플라이언스 라벨을 붙여 보여줌). 겹치는 규칙이 없어 순서는 뜻이 없다 — 끝이 안전하다.
  {
    re: /(정기\s*점검|정기점검)\s*(일정)?\s*[^.\n]{0,10}(잡아|예약|등록)\s*(해\s*)?(줘|주세요|할게|해줘|해\s*주)/,
    tool: "schedule_maintenance",
    args: {},
  },
  // ── 서랍 약속 전수 결정화 (2026-08-06, 「정기점검 잡아줘」 회귀의 일반화) ──────────
  // 서랍 18문항을 전수 실측했다: 규칙 밖 9문항 중 6개는 함수 결정층이 이미 받았고(0.5~2초),
  // 아래 3개만 모델 판단으로 남아 있었다. 서랍이 적어 준 말은 결정적으로 — 셋 다 조회(읽기)다.
  //
  // 「지금 손댈 일 뭐야?」 — 실측 34.3초(모델이 urgent_todo를 고르긴 했지만 고르는 데 그만큼 씀).
  {
    re: /지금[^.\n]{0,6}손\s*댈[^.\n]{0,6}(일|것|거)|손댈\s*일\s*(뭐|알려|보여|있)/,
    tool: "urgent_todo",
    args: {},
  },
  // 「승인 기다리는 것 있어?」 — 실측 12.4초·도구 미선택(그날그날 다른 답).
  //   drawer의 정답 표본이 유지보수 점검의 승인 대기/반려 목록이라 maintenance_status로 못 박는다.
  //   ⚠ 「승인해줘」(쓰기 시킴꼴)·「승인 기준 알려줘」(지식)는 다른 말이다 — 기다림/대기 앵커 필수.
  {
    re: /승인[^.\n]{0,6}(기다리|대기)[^.\n]{0,8}(있|뭐|건|목록|보여|알려)/,
    tool: "maintenance_status",
    args: {},
  },
  // 「최근 작업 기록에서 이상한 게 있어?」 — 실측 38.3초 + **도구가 어긋남**(작업 기록을 물었는데
  //   시스템 로그 도구가 답함). audit_search는 query 없이도 최근 전체를 요약한다 — 그대로 잇는다.
  {
    re: /(작업\s*기록|감사\s*(기록|로그))[^.\n]{0,10}(이상|수상|특이|문제)[^.\n]{0,6}(있|없|게|한)/,
    tool: "audit_search",
    args: {},
  },
  // [46] 「새 문서 뭐 들어왔어?」 — 문서 반입 소식(2026-08-06, 1차 목표 소스 확장+후-6).
  //   today가 이 문구를 안내하므로 결정적이어야 한다(안내한 말은 흔들리지 않는다).
  //   ⚠ 조회 앵커(뭐/목록/알려/보여/있) 필수 — 「들어온 문서 지워줘」(쓰기)는 삼키지 않는다.
  {
    //   사이 낱말은 들어온/올라온만 — 「최근 올린 문서」(반영 확인)와 「문서 목록」(재고)은
    //   knowledge_status 영토라 삼키지 않는다(겹침 0 원칙).
    re: /(새|새로|최근)\s*(들어온|올라온)?\s*문서[^.\n]{0,8}(뭐|알려|보여|들어왔|있어|있나|현황)|(들어온|올라온)\s*문서[^.\n]{0,6}(뭐|알려|보여|있)/,
    tool: "recent_documents",
    args: {},
  },
  // [47] 「규정 대조 이력 보여줘」 — 해자 슬라이스 1(2026-08-06). 도구 안내문이 이 문구를
  //   가르치므로 결정적이어야 한다. ⚠ 이력/기록 앵커 필수 — 「~해도 돼?」(새 판정)와 다른 말이다.
  {
    re: /(규정|행동)\s*(대조|판정)[^.\n]{0,4}(이력|기록|내역)|(대조|판정)\s*(이력|기록)[^.\n]{0,6}(보여|알려|줘|있)/,
    tool: "action_check_history",
    args: {},
  },
  // [48] 「이번 주 예정된 점검 있어?」 — **파일럿 첫날 키트가 시연 전 점검용으로 가르치는 문장**인데
  //   실측 30.0초에 리포트 전환이었다(2026-08-06). 시연 중이라면 그 자리에서 대본이 깨진다.
  //   위 [유지보수] 규칙은 「유지보수·정비」 낱말을 요구해 이 말을 못 받았다 — 기간+점검 꼴을 받는다.
  //   ⚠ 절차·방법을 묻는 지식 질문은 비켜 준다(위 규칙과 같은 제외구).
  {
    //   ⚠ 검토관 2026-08-07: 「예정」 앵커를 선택(?)으로 뒀더니 「오늘 점검 **결과** 알려줘」
    //   같은 과거 질문까지 삼킬 수 있었다 — 앵커를 필수로 좁히고, 결과·이력도 제외구에 넣는다.
    re: /^(?!.*(절차|방법|항목\s*설명|순서|체크\s*리스트|어떻게\s*하|결과|이력|보고))(?:.*(이번\s*주|이번주|다음\s*주|다음주|이번\s*달|이번달|오늘|내일)\s*[^.\n]{0,6}(예정|잡[힌혀]|남[은아])\s*[^.\n]{0,4}점검[^.\n]{0,8}(있|뭐|무엇|보여|알려|현황|어때))/,
    tool: "maintenance_status",
    args: {},
  },
  // [49] 「오탐 자주 나는 패턴 알려줘」 — 해자 슬라이스 3(2026-08-06 시안 승인).
  //   도구 설명이 이 문구를 가르치므로 결정적이어야 한다.
  //   ⚠ 자주/잦은/반복/패턴 앵커 필수 — 「이거 오탐 처리해줘」(쓰기 지시)는 삼키지 않는다.
  {
    re: /(오탐|false\s*positive)[^.\n]{0,8}(자주|잦|반복|패턴|많이)[^.\n]{0,10}(뭐|알려|보여|있|현황)|(자주|잦게)\s*(틀리|오탐)[^.\n]{0,8}(탐지|패턴|것)/i,
    tool: "fp_patterns",
    args: {},
  },
  // [50] 「미점검 대상 몇 개야?」 — 147상황 4차 실측(2026-08-07): 커버리지 도구(asset_coverage,
  //   unscanned)가 제목·사유·목록·조치까지 답하는데 모델이 안 불러 **"미점검 대상은 12개
  //   입니다"** 한 줄(근거·다음 걸음 없음)이 나갔다. 숫자만 주고 갈 곳 없는 답은 이 제품의
  //   반복 결함이다. ⚠ 「어떻게 처리해」(방법 질문)는 앵커(몇/개수/목록/보여/알려)가 없어 안 삼킨다.
  {
    re: /(미점검|미스캔|점검\s*안\s*[된됀]|스캔\s*안\s*[된됀])\s*(대상|자산|장비)?[^.\n]{0,6}(몇|개수|얼마나|목록|보여|알려)/,
    tool: "asset_coverage",
    args: { gap: "unscanned" },
  },
  // [51] 「중복된 문서 있어?」 — 147상황 상비 질문인데 도구가 없어 모델이 근처 도구(새 문서
  //   목록)를 골라 답하던 미비(2026-08-07 도구 신설과 함께 결정화). ⚠ 문서 낱말 필수 —
  //   「중복된 자산」·「중복 로그인」은 다른 영토다.
  // ⚠ 2026-08-13 — **여기를 넓히려다 되돌렸다. 그 자리는 이 층이 아니었다.**
  //   라이트 게이트 lt-dup-1「내 문서함에 중복된 거 있어?」가 안 걸려 어순을 넓혔더니,
  //   `forcedToolFor` 단위 시험은 통과하는데 **실제 경로에서는 안 닿았다**(max 실측 d37a299).
  //   그 어순은 이 층에 오기 전에 dispatcher의 `KB_HYGIENE_INTENT_RE`(dispatcher.ts)가 먼저 채 간다.
  //   「기능은 있는데 말이 안 닿는다」를 고치는 수리 자체가 같은 함정에 빠진 것이다.
  //   ★ 교훈: 강제분기를 손볼 땐 **dispatchInstruction으로 재라.** 이 함수만 재면 앞 층이 안 보인다.
  //   → 중복을 묻는 말은 **kbhygiene 한 곳**으로 모았다(제목만 보는 여기보다 상위집합이다).
  //     여기는 그쪽이 안 받는 먼 어순(사이 5~6자 등)의 안전망으로 남는다.
  {
    re: /(중복|겹치)[^.\n]{0,6}문서[^.\n]{0,8}(있|없|찾|보여|알려|확인|정리)/,
    tool: "doc_duplicates",
    args: {},
  },
  // [52] 「최근에 추가된 자산 뭐야?」 — 운영 실측(2026-08-07): 도구에 시간 필터를 넣었는데
  //   모델이 **문서 소식**(recent_documents)을 골라 자산 질문에 문서 목록이 나갔다.
  //   자산 낱말이 있으면 자산 도구다 — 시간 분기는 list_assets 안(query의 「최근」)이 받는다.
  {
    re: /(최근|새로|요즘)[^.\n]{0,6}(추가|등록|들어온)[^.\n]{0,4}(자산|장비|서버)[^.\n]{0,8}(뭐|목록|보여|알려|있)/,
    tool: "list_assets",
    args: { query: "최근 추가" },
  },
  // [53] 「지금 제일 급한 게/거/위험 뭐야?」 — 150상황 재측정(2026-08-07, 14B 전환 직후):
  //   모델이 urgent_todo를 **맞게 고르는데 고르는 데만 41초·31초**를 썼다(답 자체는 결정적 도구
  //   출력 0.2초짜리). ⚠ 「급한 취약점/건/것」은 위 today 규칙의 말이라 손대지 않는다 — 여기서는
  //   대상을 안 댄 일반형(게·거·위험·일)만 받는다. 조회 앵커(뭐/무엇/알려/보여) 필수 —
  //   「급한 거 김보안한테 배정해줘」(쓰기 재료 흐름)는 삼키지 않는다.
  {
    re: /(지금|오늘)?\s*(제일|가장)\s*급한\s*(게|거|위험|일)\s*(뭐|무엇|알려|보여)|지금\s*급한\s*(게|거|일)\s*(뭐|무엇)/,
    tool: "urgent_todo",
    args: {},
  },
  // [54] 「컴플라이언스 대응 안 된 항목 알려줘」 — 같은 재측정에서 31.5초. 모델이
  //   compliance_status를 맞게 골랐지만 [53]과 같은 병(고르는 데 다 씀). 위 컴플라이언스 규칙은
  //   현황/이행/요약 꼴만 받아 「대응 안 된」·「미대응」 부정형이 새고 있었다 — 우리말 상태어를
  //   못 알아듣던 필터 사고(2026-08-04)와 같은 계열이라 부정형을 명시로 받는다.
  {
    re: /(컴플라이언스|규제|통제)[^.\n]{0,8}((대응|이행|조치)\s*안\s*된|미대응|미이행)[^.\n]{0,8}(항목|것|거|뭐|알려|보여|있)/,
    tool: "compliance_status",
    args: {},
  },
  // [55] 「조치 기한 넘긴 취약점 있어?」 — 게이트 sla-overdue 실측(2026-08-08): 모델이
  //   온톨로지 도구를 골라 기한 질문에 생애주기 관계도를 냈다(3/3 재현 — 흔들림이 아니라
  //   비결정 선택이 굳은 것). 속성사전(기한초과→overdue)이 있는 finding_status로 못 박는다.
  //   ⚠ 취약점|건|거 앵커 필수 — 「기한 지난 점검 일정」(maintenance)·「기한 지난 일」(할 일)은
  //   다른 영토라 삼키지 않는다.
  {
    // ⚠ 한글에는 \b가 안 걸린다(JS 정규식 함정 — 「건 」에서 경계 불성립, 실측). 공백·문장부호
    //   lookahead로 경계를 잡는다.
    re: /^(?!.*(점검|일정|할\s*일))(?=.*(조치\s*)?기한[^.\n]{0,4}(넘긴|지난|초과)|.*SLA[^.\n]{0,6}(넘긴|초과|지난|위반))(?=.*(취약점|(건|거)(?=[\s?.!,]|$)))/,
    tool: "finding_status",
    args: { filter: "기한초과" },
  },
  // [56] 법령·고시·판례 찾기 — 「법령·판례」 화면(2026-08-09 신설)이 **누르면 이 말 그대로**
  //   대화창에 넣는다. 제품이 적어 준 말은 결정적이어야 한다(guidance-check가 잡음).
  //   ⚠ 사내 규정 대조(「~해도 돼?」)는 삼키지 않는다 — 그건 actioncheck의 영토이고,
  //     법 원문 찾기와 답의 성격이 다르다(판정 ○/△/× vs 원문·링크).
  //   ⚠ 「방법·사용법」의 '법'에 걸리지 않게 **법 이름 꼬리말**만 받는다(보호법·기본법·법률 등).
  //   ⚠ 약칭 「정보통신망법(망법)·신용정보법」을 더한다 — 이 둘은 꼬리말이 목록에 없어 투명했고, 「정보통신
  //     망법상 침해사고 신고 의무」가 침해에서 비킨 뒤 여기 못 걸려 LLM 재량으로 새던 뿌리다(2026-08-21 설계관).
  //   ⚠ law_lookup은 연동이 꺼져 있으면 도구 목록에 없다 → available 검사에서 자동으로 비켜간다.
  {
    re: /^(?!.*(해도\s*(돼|되나|될까|괜찮)|위반이야))(?=.*(법령|법률|시행령|시행규칙|고시|훈령|예규|행정규칙|판례|판결|보호법|기본법|거래법|촉진법|특별법|진흥법|방지법|관리법|보안법|망법|신용정보법|보관\s*기간|몇\s*년\s*(동안\s*)?보관|얼마나\s*(동안\s*)?보관|(법적\s*)?근거\s*(규정|조항|조문|법령)))(?=.*(찾아|알려|보여|검색|뭐라고|어떻게\s*(돼|되어)|있어|있나|있는지|해야\s*[하해돼되]|근거\s*(법령|규정|조항|조문)|무엇(인가|이야|입니까)|뭐야))/,
    tool: "law_lookup",
    args: {},
  },
  // ★ 2026-08-10: 「레드팀 점검 **결과** 알려줘」가 **실행 도구의 인자 오류**를 답했다
  //   (「필수 인자 누락: assetId」). 조회를 물었는데 실행이 잡은 것이다 —
  //   결과를 보는 도구가 없어서 남는 자리로 흘러갔다.
  // ⚠ 「점검 **해줘**·돌려줘」(실행)와 갈라야 한다 — 여기는 **지난 결과를 보는** 말만 잡는다.
  {
    re: /(레드팀|red\s*team|ai\s*(공격|침투)\s*시험|견고성).{0,12}(결과|점수|현황|어땠|어때|보여|알려)(?!.{0,6}(해줘|돌려|실행|시작))|(레드팀|견고성)\s*(점수|결과)/i,
    tool: "redteam_status",
    args: {},
  },
  // ── 2026-08-21 연계성 라운드 — 다음 걸음 칩이 안내하는 말 3개를 결정화 ─────────────
  //   guidance-routing 시험이 막았다: 「제품이 안내한 말은 전부 결정적이어야 한다」.
  //   칩으로 달아 놓고 모델 판단에 맡기면 회차마다 답이 흔들린다(두더지잡기의 뿌리).
  // 「재스캔」·「재 스캔」 다 잡는다(\s*) — 가지 하나로(검토관 하8).
  // (주석은 re: 줄 **위**에 — 줄 끝에 붙이면 guidance-check 추출이 끊긴다. 오늘 두 번째.)
  {
    re: /재\s*스캔\s*(상태|현황|결과)/,
    tool: "scan_status",
    args: {},
  },
  {
    re: /지식\s*(저장소|창고)\s*(상태|현황)|지식\s*저장소\s*어때/,
    tool: "knowledge_status",
    args: {},
  },
  {
    re: /자가\s*진단\s*(해줘|돌려|실행|해\s*봐)|self[\s-]*(check|test)\s*(해줘|실행)/i,
    tool: "system_health",
    args: {},
  },
  // 「이거 검증 실행해줘」 — fix-close 시나리오 3단계이자 승인 뒤 칩(2026-08-21 검토관 상2:
  //   verify_finding은 읽기(write:false)라 결재판이 안 서는데 결정 규칙이 없어 **사슬의
  //   마지막 고리가 모델 운**이었다). 시킴꼴만 잡는다 — 「검증 현황」(조회)·「검증이 뭐야」
  //   (지식)·「하드닝 점검해줘」(다른 도구)와 안 겹친다.
  {
    re: /(조치)?\s*검증\s*(실행|돌려)(해\s*줘|줘)?/,
    tool: "verify_finding",
    args: {},
  },
  // 조치·수정 요청서(2026-08-21 시안 확정) — 「…요청서 만들어줘」는 유형 무관 결정 규칙으로
  // 받는다. ⚠ REMEDIATION 계열 규칙보다 먼저 소비돼야 「정책 수정 요청서」가 조치방법 답으로
  // 새지 않는다(설계관 경고 — FORCED가 특수경로보다 앞이라 여기 두면 안전).
  {
    re: /요청서\s*(만들|작성|생성|해\s*줘)/,
    tool: "create_request_doc",
    args: {},
  },
  {
    re: /요청\s*(현황|목록|이력)|회신\s*없는\s*요청/,
    tool: "request_status",
    args: {},
  },
  // URL 지식화(2026-08-21) — 링크+반입 동사가 함께 있을 때만. 링크만 붙인 일반 질문은 안 삼킨다.
  {
    re: /(https?:\/\/\S+[\s\S]*(지식|반입|넣어|학습|수집))|((지식|반입|학습)[\s\S]*https?:\/\/\S+)/,
    tool: "ingest_url",
    args: {},
  },
  // 타사 SBOM 검수 조회(2026-08-22, 계획서 중-7 확장) — **약속한 말은 결정적으로**.
  //   ⚠ 실측: 이 규칙이 없을 때 「SBOM 검수 결과 알려줘」가 aibom_status로 새서
  //     「등록된 AI/모델 자산이 없습니다」라고 답했다 — 그런데 그 문구는 **우리가 반입 칩에
  //     적어 담당자에게 약속한 말**이다(autoupload 반입칩 sbom). 안내한 말이 안 되면 거짓이 된다.
  //   ⚠ 좁게 — 「검수/점검 결과」이거나 「소스 공개 요구」를 물을 때만. 「SBOM 만들어줘」(생성)·
  //     「AI-BOM 현황」(우리 자산)은 안 삼킨다.
  {
    // ⚠ **좁혀야 한다**(2026-08-22 검토관 [높음]). 처음 규칙은 두 갈래에 조회 동사가 없어
    //   「GPL 쓰면 소스 공개 의무가 있나요?」·「공급망 점검 어떻게 해?」까지 삼켰다.
    //   그러면 **방금 지식화한 라이선스 자료가 답해야 할 물음**에 「아직 검수한 게 없습니다」가
    //   나가고, 최악은 담당자가 그것을 **「의무 없음」으로 읽는 것**이다.
    //   → 세 갈래 전부에 **조회 동사**를 요구하고, 「검수한 것을 보여 달라」는 뜻일 때만 받는다.
    //   ⚠ 절차·방법을 묻는 말(어떻게·방법·절차·왜·뭐야)은 제외구로 비켜 준다 — 지식이 답할 몫이다.
    re: /^(?![\s\S]*(어떻게|방법|절차|왜\s|뭐야|무엇인가|이란|란\s))[\s\S]*((SBOM|부품표)[\s\S]{0,10}(검수|점검)[\s\S]{0,8}(결과|현황|알려|보여|목록)|공급망[\s\S]{0,4}점검[\s\S]{0,8}(결과|현황|알려|보여|목록)|(소스[\s\S]{0,2}공개[\s\S]{0,6}(요구|의무)받[\s\S]{0,6}(부품|것))[\s\S]{0,8}(뭐|무엇|있|알려|보여))/i,
    tool: "sbom_review_status",
    args: {},
  },
  // 📂 지켜보는 폴더(2026-08-31 사장님 「위키처럼 디렉토리 지정해서 계속 확인」) — 화면·안내가
  //   「지정은 대화창에서」라고 약속하므로 결정적이어야 한다. 순서: 조회 → 해제 → 등록(첫 일치승).
  //   ⚠ 낱말 가로채기 계보(routes.ts 실사고 §): 「감시」·「확인」 **홑낱말 금지** — 세 갈래 전부가
  //   폴더/디렉토리 낱말을 요구해 관제(「방화벽 로그 감시해줘」)·침해 초동절차를 안 삼킨다.
  //   경로에 침해/로그가 들어도(D:\침해사고_로그) 폴더 앵커로 여기에 온다(routing 시험이 반례로 못박음).
  {
    re: /지켜보는\s*폴더[\s\S]{0,14}(뭐|목록|현황|알려|보여|있)/,
    tool: "watch_folder_list",
    args: {},
  },
  {
    re: /(폴더|디렉터리|디렉토리)[\s\S]{0,24}(그만\s*지켜|감시\s*(해제|중지)|지켜보[\s\S]{0,6}그만)|지켜보는\s*폴더[\s\S]{0,20}(빼|삭제|해제|그만)/,
    tool: "watch_folder_remove",
    args: {},
  },
  {
    // 시킴꼴만 — 조회 어미(뭐·목록·현황·알려줘·보여줘·있어)는 제외구로 비켜 위 조회 규칙과 안 겹친다.
    re: /^(?![\s\S]*(뭐\s|목록|현황|알려\s*줘|보여\s*줘|있어))[\s\S]*(폴더|디렉터리|디렉토리)[\s\S]{0,30}(계속\s*)?(지켜봐|지켜보|감시\s*등록|감시해)/,
    tool: "watch_folder_add",
    args: {},
  },
  {
    // 📋 점검서 올리기 — **화면이 담당자에게 시킨 말**이라 반드시 결정적이어야 한다.
    //   maintenance.html:451이 [점검서 올리기] 단추로 「「○○」 점검서를 올릴게」를 대화창에
    //   직접 넣어 준다. 그 말이 모델 판단으로 가면 회차마다 딴 도구로 새고, 제품이 시킨 대로
    //   쳤는데 아무 일도 안 일어나는 자리가 된다(2026-08-31 대장 §4 끊김 3).
    //   ⚠ 좁게 — 「점검서」라는 낱말이 있을 때만. 「점검 결과 알려줘」(조회)는 안 삼킨다.
    re: /점검서[^.\n]{0,8}(올릴게|올릴께|올려|제출|냈|낼게|등록)/,
    tool: "submit_maintenance_report",
    args: {},
  },
  {
    // 📋 점검 승인·반려(관리자) — 화면 [승인]/[반려] 단추와 같은 급을 대화에도 둔다.
    //   ⚠ **「점검」이 함께 있을 때만** 받는다. 「승인」 홑낱말로 잡으면 결재판 승인·조치
    //     승인·위험수용 승인까지 삼킨다(낱말 가로채기 계보 — 이 저장소가 반복해 겪은 것).
    //   ⚠ 조회는 비켜 준다 — 「승인 대기 뭐 있어?」는 위쪽 규칙(승인 대기 목록)의 몫이다.
    //   ⚠ requiredRole:"admin"이라 관리자가 아니면 도구 목록에서 빠지고, 강제 규칙도
    //     available 검사에서 자동으로 비켜간다(agentloop 권한 규약).
    re: /^(?![\s\S]*(대기|목록|현황)[^.\n]{0,6}(있|뭐|보여|알려))[\s\S]*점검[^.\n]{0,12}(승인|반려|거절)/,
    tool: "review_maintenance",
    args: {},
  },
  {
    // 📄 정기 리포트 일정 **바꾸기** — 조회·등록만 있던 자리의 마지막 짝(대장 §6 끊김 2).
    //   ⚠ **「리포트」와 「바꾸기 말」이 함께** 있을 때만. 「바꿔줘」 홑낱말이면 담당자 변경·
    //     상태 변경까지 삼킨다(낱말 가로채기 계보).
    //   ⚠ 「걸어줘」(등록)는 안 삼킨다 — 그건 report_schedule_add의 몫이다.
    re: /^(?![\s\S]*(걸어|등록해|잡아))[\s\S]*(리포트|보고서)[\s\S]{0,20}(바꿔|변경|옮겨|수정)/,
    tool: "report_schedule_update",
    args: {},
  },
  {
    // 📄 정기 리포트 일정 **지우기** — 자동 생성 중지.
    //   ⚠ 리포트 **문서**를 지우는 말(「리포트 삭제해줘」)과 갈린다 — 「자동·정기·스케줄」이
    //     함께 있을 때만 일정으로 본다. 문서 삭제는 다른 도구의 영토다.
    re: /(자동\s*생성|정기|스케줄|예약)[\s\S]{0,20}(리포트|보고서)[\s\S]{0,20}(그만|중지|멈춰|해제|지워|삭제)|(리포트|보고서)[\s\S]{0,20}(자동\s*생성|정기\s*생성)[\s\S]{0,12}(그만|중지|멈춰|해제)/,
    tool: "report_schedule_delete",
    args: {},
  },
  {
    // 🖥 관제 이벤트 상태 바꾸기 — 「이 이벤트 확인 처리로 바꿔줘」(대장 §2 끊김 4).
    //   ⚠ **「이벤트」가 함께 있을 때만.** 「확인 처리로 바꿔줘」만으로 잡으면 취약점 상태
    //     변경(update_finding_status의 영토)까지 삼킨다 — 낱말 가로채기 계보.
    //   ⚠ 조회(「관제 이벤트 뭐 있어?」)는 비켜 준다.
    re: /^(?![\s\S]*(뭐\s|목록|현황|알려\s*줘|보여\s*줘|있어\??$))[\s\S]*이벤트[\s\S]{0,20}(확인|처리\s*중|완료|무시)[\s\S]{0,10}(로|으로)?[\s\S]{0,6}(바꿔|변경|처리|표시)/,
    tool: "set_event_status",
    args: {},
  },
  {
    // 🧰 보안제품 지우기 — 「FW-01 등록부에서 삭제해줘」(대장 §7 끊김 3).
    //   ⚠ **「제품」 또는 「등록부」**가 함께 있을 때만. 「삭제해줘」 홑낱말이면 문서·자산·
    //     일정 삭제까지 삼킨다. 자산 삭제는 다른 도구의 영토다.
    re: /(보안\s*제품|제품)\s*(등록부|목록)?[\s\S]{0,16}(삭제|지워|빼)|등록부에서[\s\S]{0,16}(삭제|지워|빼)/,
    tool: "delete_product",
    args: {},
  },
  {
    //   ⚠⚠ **낱말을 두 층으로 가른다**(2026-09-01 4차 검토 [중]). 배제를 늘렸다 줄였다 하는
    //     두더지잡기를 「조회 낱말 양성 요구」로 바꿨더니 이번엔 **약한 낱말**이 개념 물음을
    //     끌어왔다 — 「VEX 파일이 뭐야?」·「VEX 상태가 뭐야?」가 건수표로 갔다.
    //     · **강한 조회어**(현황·내보·추출·건수·대상·나가) = 우리 데이터를 묻는 말이다.
    //       정의 물음이 섞여 있어도 이건 조회다(「VEX 현황 설명해줘」).
    //     · **약한 낱말**(파일·목록·문서·상태·표준·형식) = 개념일 수도 있다.
    //       정의 물음이 없을 때만 조회로 본다.
    //   ⚠ 낱말 경계를 둔다 — convex·vexing이 VEX로 읽히던 자리다.
    //   ⚠ 거꾸로 꼴(낱말이 앞)은 **강한 조회어만** 받는다 — 안 그러면
    //     「파일 목록에서 vex.json 지워줘」까지 삼킨다.
    re: /^(?![\s\S]*(뭐(야|예요|죠|니)|뭔가(요)?|무엇(인가|입니까|이야|이에요)?|어떻게\s*(만들|써|쓰|하)|왜\s*(필요|쓰|써)|설명|소개|이란|란\s*(뭐|무엇)))[\s\S]*(?:(?<![a-zA-Z])(?:VEX|vex)(?![a-zA-Z])[\s\S]{0,16}(현황|내보|추출|건수|대상|나가|export|파일|목록|문서|상태|표준|형식)|(현황|내보|추출|건수|대상|나가|export)[\s\S]{0,16}(?<![a-zA-Z])(?:VEX|vex)(?![a-zA-Z]))|[\s\S]*(?:(?<![a-zA-Z])(?:VEX|vex)(?![a-zA-Z])[\s\S]{0,16}(현황|내보|추출|건수|대상|나가|export)|(현황|내보|추출|건수|대상|나가|export)[\s\S]{0,16}(?<![a-zA-Z])(?:VEX|vex)(?![a-zA-Z]))/i,
    tool: "vex_status",
    args: {},
  },
  {
    // 📦 SBOM 없는 자산 — 「SBOM 없는 자산 알려줘」(대장 §3-4 항목 2).
    //   triage screenguide가 **직접 권하는 문장**인데 전용 분기가 없어 LLM 판단으로 샜다.
    //   답은 sbom_coverage가 준다(SBOM이 아예 없는 자산 목록 + 왜 제외했는지).
    //   ⚠⚠ 처음엔 aibom_status로 보냈는데 **그 도구는 AI 자산만 센다**(검토관 [상]).
    //     IT·일반 소프트웨어 자산이 통째로 빠졌고, 등록 자산이 전부 IT면 「등록된 AI/모델
    //     자산이 없습니다」라고 답했다 — SBOM 없는 자산이 12건 있는데 없다고 말하는 셈이다.
    //     잣대는 assetcoverage.sbomApplies **하나**를 쓴다(화면·현황 카드와 같은 수).
    //   ⚠ **「만들어줘」를 뺀다.** generate_sbom의 영토다 — 생성 요청을 조회로 돌리면
    //     담당자는 만든 줄 알고 넘어가는데 아무것도 안 만들어진다(가장 나쁜 오라우팅).
    //   ⚠ 「생성」 배제에 (?<!미)를 붙인 이유: **「미생성」이 「생성」을 품는다.**
    //     안 붙이면 「SBOM 미생성 자산 보여줘」가 스스로 배제돼 규칙이 헛돈다(시험이 잡았다).
    re: /^(?![\s\S]*(만들|뽑아|(?<!미)생성))[\s\S]*(SBOM|부품표)[\s\S]{0,12}(없는|미생성|안\s*만든|누락)[\s\S]{0,12}(자산|것|거)?/,
    tool: "sbom_coverage",
    args: {},
  },
  {
    // ⏳ 지원 종료(EOL) 점검 — 「지원 끝난 부품 있어?」(계획서 중-7 + 전-4).
    //   ⚠ 「지원」 홑낱말은 절대 안 쓴다 — 「지원해줘」·「기술 지원」까지 삼킨다.
    //     **끝/종료/만료/단종**과 붙어 있을 때만이다.
    //   ⚠ 「버전」도 안 쓴다 — 버전 물음은 자산 조회의 영토다.
    re: /(EOL|EOS)\b|지원\s*(종료|끝난|끝났|만료)|(단종|수명\s*(종료|끝))/i,
    tool: "eol_check",
    args: {},
  },
  {
    // 📚 침해사고 히스토리 **등록** — 「사례 등록: 2024년 ○○사 랜섬웨어, …, 출처 https://…」(화면·screenguide가 약속한 말).
    //   ⚠ 네 규칙(등록·삭제 = 쓰기, 샘·조회 = 읽기) 가운데 **등록·삭제가 먼저** 온다 — 「침해사고 사례 등록: …」이 아래 조회 규칙에
    //     삼켜지면 등록이 목록 답으로 바뀐다(가장 나쁜 오라우팅: 담당자는 등록된 줄 안다).
    //   ⚠ 「등록」 뒤 **콜론이 있을 때만** — 「사례 등록하려면 어떻게 해?」(방법 질문)는 screenguide 몫이라 안 삼킨다.
    //   인자는 모델이 뽑는다(argsByModel) — 칸이 여덟이라 정규식으로 못 가른다. 결재판이 확인한 뒤에만 실행된다.
    re: /^\s*(?:침해\s*사고\s*)?(?:사례|히스토리)\s*등록\s*[:：]/,
    tool: "register_incident_case",
    args: {},
    argsByModel: true,
  },
  {
    // 📚 침해사고 히스토리 **삭제** — 「사례 삭제 ic-…」(등록 답·화면 상세가 되돌리기로 약속한 말).
    //   ⚠ **ic- 번호가 있을 때만** 강제한다(적용부에서 뽑는다) — 번호 없이 「사례 삭제해줘」면 모델에 넘긴다(빈 결재판 방지).
    //     번호 요구가 곧 낱말 가로채기 방어다: 「취약점 사례 목록에서 지워줘」 같은 말은 번호가 없어 여기 안 온다.
    re: /(?:사례|히스토리)[^\n]{0,24}(?:삭제|지워|지우)|(?:삭제|지워|지우)[^\n]{0,12}(?:사례|히스토리)/,
    tool: "delete_incident_case",
    args: {},
  },
  {
    // 📚 사례의 샘 — 「해외 보안 유튜브 추천해줘」·「보안 사고 소식 어디서 봐?」·「사례의 샘 보여줘」(screenguide가 약속한 말).
    //   ⚠ 「추천」·「사이트」 홑낱말은 안 쓴다 — 보안/해킹/침해/사고 낱말과 붙은 매체(유튜브·채널·사이트·블로그·뉴스·소식)일 때만.
    //   갈래(유튜브·국내·사이트)는 handlers.runIncidentSources 한 곳이 말에서 읽는다 — 지시문을 통째로 넘긴다(workflow_status와 같은 이유).
    re: /사례의\s*샘|(?:보안|해킹|침해|사고)\s*(?:관련\s*)?(?:유튜브|유투브|채널|사이트|블로그|뉴스|소식)[^\n]{0,14}(?:추천|어디|볼\s*만|알려|보여)|(?:유튜브|유투브)[^\n]{0,10}추천/i,
    tool: "incident_sources",
    args: {},
  },
  {
    // 📚 침해사고 히스토리 **조회** — 「침해사고 히스토리 보여줘」(incidentcases.html 칩이 넣어 주는 말 — guidance-routing이 잰다)·
    //   「사고 사례 보여줘」·「비슷한 사례 있어?」·「CVE-2021-44228 비슷한 사례 있어?」.
    //   ⚠ **「사례」 홑낱말은 안 쓴다** — report.ts의 「취약점 사례」와 겹친다(terms.ts 별칭·handlers 머리글과 같은 계약).
    //     침해사고/침해/해킹/사고 + 히스토리/사례 복합어, 또는 비슷한/유사한 + 사례만.
    //   ⚠ 등록(콜론)·삭제·샘은 위 세 규칙의 영토라 배제한다 — 배열 순서로도 앞이 이기지만, 표(routes)를 읽는 사람이
    //     정규식만 보고도 경계를 알게 적어 둔다.
    //   ⚠ **「추천」은 배제어에서 뺐다**(검토관 2026-09-03) — 「사고 사례 추천해줘」·「침해사고 히스토리 추천해줘」가 통째로 막혀
    //     모델 판단으로 샜다. 샘 규칙은 **매체 낱말**(유튜브·채널·사이트·블로그·뉴스·소식)이 있을 때만 걸리고 배열에서 앞이라,
    //     매체 낱말이 있으면 샘이 이기고 없으면 여기로 온다 — 「추천」 한 낱말로 조회를 통째로 막을 이유가 없다.
    //   ⚠ 앞 층(dispatcher 침해사고질문인가)은 「어떻게·절차·대응」이 있을 때만 초동 절차로 채 간다 — 조회 어미는 여기 온다.
    //   인자: CVE가 있으면 cve(정확 일치), 앵커 바로 앞 낱말 하나면 q(「랜섬웨어 사고 사례」→ 랜섬웨어). 둘 다 없으면 최근 목록.
    re: /^(?![\s\S]*(?:등록\s*[:：]|삭제|지워|지우|사례의\s*샘))[\s\S]*(?:(?:침해\s*사고|침해|해킹|사고)\s*(?:히스토리|사례)|(?:비슷한|유사한?)\s*(?:사고\s*)?사례)/,
    tool: "incident_cases",
    args: {},
  },
  {
    // 📊 사내 **지표율** 물음 — 「조치 완료율 어때?」·「SLA 준수율 몇 %야?」·「작년 대비 나아졌어?」
    //   (2026-09-06 사고 수리 · 계획서 전-4).
    //
    // ★ 왜 못 박나(실측): 「보안 교육 이수율은 82.3%입니다 · 작년 대비 12.5% 증가 · 36.4%」가
    //   그대로 나갔다. 이 세 숫자는 chat_logs 5,998행·운영 문서 전수에 **0건** — 모델이 지어냈다.
    //   그런데 kpi.ts는 「취약점 조치율·SLA 준수율·컴플라이언스 이행률」을 **이미 계산해 두고 있다**.
    //   위 [7]은 「보안 KPI·보안 지표·보안 점수」라는 **제품 이름**을 댈 때만 잡고, [16]은 어제·지난주
    //   비교만 잡아, **지표 이름으로 부르는 말**이 통째로 모델 재량으로 샜다.
    //   있는 값을 지어내게 두는 것이 이 저장소가 가장 비싸게 겪은 실패다(있는 기능을 없다고 하기의 쌍).
    //
    // ⚠ 「율/률」 홑낱말은 안 쓴다 — 「환율」·「비율이 뭐야」까지 삼킨다. 조치·완료·준수·대응·이행·
    //   패치·적용·이수 같은 **업무 낱말과 붙었을 때**만이다.
    // ⚠ 절차·방법·기준·법령·규정·지침이 있으면 **비켜선다** — 「조치율 계산 기준이 뭐야?」는
    //   지식·법령의 영토이지 숫자 조회가 아니다(낱말 가로채기 계보).
    // ⚠ 「어떻게」는 **홑낱말로 안 뺀다**(첫 판에서 잡은 내 실수): 「자산 등록률 **어떻게 돼**?」가
    //   통째로 막힌다 — 그건 방법을 묻는 말이 아니라 **값을 묻는 말**이다. 계산·산출·측정·
    //   올리기와 붙었을 때만 뺀다(「조치율 어떻게 올려?」는 개선 방법이라 지식의 영토).
    // ⚠⚠ 배제어는 **활용형까지 적는다**(2026-09-06 검토 실측). 첫 판은 사전형(올리·구하·높이)만
    //   적어 두고 주석·커밋·routes 표에는 「조치율 어떻게 올려?」를 예로 들었는데, 「올리」는
    //   「올려/올릴」에 글자로 안 들어가 **그 예문이 실제로는 kpi_status로 강제되고 있었다**
    //   (약속-코드 불일치 — 세 곳이 똑같이 약속해도 코드가 안 하면 약속이 아니다).
    //   한국어 어간은 활용에서 글자가 바뀐다 — 사전형만 적으면 안 잡힌다.
    // ⚠ 뜻풀이 갈래(뭐야·뭔데·무슨 뜻·이란·정의·설명)도 뺀다 — 같은 파일의 형제 규칙(VEX 등)이
    //   이미 그렇게 한다. 「조치율이 무슨 뜻이야?」에 숫자표를 던지는 것이 **낱말 가로채기** 계보다.
    // ⚠ (작년|전년|올해) 대비 — [16]이 어제·지난주·지난달만 받아 **해 단위 비교**가 비어 있었다.
    //   같은 추세 값이 답하므로 같은 도구로 보낸다.
    // ⚠ 제품이 **안 세는 지표**(교육 이수율 등)도 여기로 온다 — 지어낸 %보다
    //   「그 지표는 아직 집계하지 않습니다」가 낫다(runKpiStatus가 그 문장을 말한다).
    //
    // ★★ 2026-09-06 2차 넓힘 — **사내 실적률 열세 낱말**(제출·참여·응답·설치·가입·서명·서약·
    //   열람·클릭·훈련·교육·출석·백업). 라이브 4표본 실측에서 **3표본이** 승인문답·통계 PDF
    //   조각을 근거로 「강함」 배지를 달고 확정 %를 냈다(서약서 제출률 95%·외주 80↔85 · 피싱
    //   클릭률 16.2/18.5 · 백신 설치율). 그 %들은 **남의 회사 통계이거나 업계 평균**인데
    //   「사내 실적」으로 읽혔다 — 숫자 관문(citeguard)은 「조각에 그 숫자가 있나」만 보므로
    //   **원리상 못 막는다**(있긴 있다, 주어가 남일 뿐). 막을 수 있는 층은 **라우팅**뿐이다:
    //   여기로 오면 runKpiStatus가 「아직 집계하지 않습니다」라고 정직하게 말한다.
    // ⚠ 탐지·차단·검출은 **일부러 뺐다** — 「IPS 탐지율」·「WAF 차단율」은 사내 실적이 아니라
    //   **제품 스펙**을 묻는 말이라 지식·제품 소개의 영토다(낱말 가로채기 계보).
    // ⚠ 가운데 칸에 「성공」을 더했다 — 「백업 **성공**률」은 낱말이 백업+성공+률이라
    //   낱말 목록에 백업만 넣어서는 **안 걸린다**(첫 판에 그렇게 짰다가 시험이 잡았다).
    //   위 「활용형까지 적는다」와 같은 부류의 약속-코드 불일치다 — 예문을 **실제로 재 본다.**
    //
    // ★★ 2026-09-06 3차 — 위 2차 넓힘이 **남의 통계를 묻는 말까지** 가로챈 것을 되돌린다(검토관 실측).
    //   클릭·설치·참여를 낱말 목록에 넣자 「피싱 클릭률 **업계 평균**은?」·「**국내** 백신 설치율
    //   **통계**」·「**타사** 보안교육 참여율」이 넷 다 kpi_status로 강제됐다. 강제도구는 LLM을
    //   아예 안 거치므로 runKpiStatus의 사내 표로 끝나 「아직 집계하지 않습니다」가 나온다 —
    //   그런데 그 값은 **문서에 실제로 있다**(피싱 16.2/18.5). 있는 답을 없다고 하는 쪽이 됐다.
    //   → 남을 가리키는 낱말(업계·타사·동종·국내·해외·글로벌·일반적·평균적·다른 회사)을 배제어에 넣는다.
    //   ⚠ 맞바꿈을 적어 둔다: 「**국내** 지사 백신 설치율」 같은 **사내** 물음도 함께 비켜선다.
    //     그건 2차 넓힘 **이전 동작**(모델+RAG)으로 돌아가는 것이라 새로 생기는 손해가 아니고,
    //     이 파일이 정한 더 나쁜 실패는 「넓혀서 남의 답을 삼키는 것」이다.
    //   ⚠ 홑낱말 「평균」은 **안 넣었다** — 「평균 조치율」은 사내 물음일 수 있다. 남을 가리키는
    //     꼴(업계 평균·글로벌 평균)은 앞 낱말이 이미 잡는다.
    //
    // ★★ 같은 날 — 개선 동사를 **「어떻게」에서 떼어 홑낱말로** 옮긴다(검토관 실측 둘째).
    //   ① 「낮추·낮춰·낮출」이 통째로 빠져 있었다. 2차에서 넣은 클릭률·열람률은 **낮추는** 지표라
    //      「클릭률 어떻게 낮춰?」가 그대로 강제됐다(옛 낱말은 아무도 낮추자고 안 물어 안 드러났다).
    //   ② 배제어가 「어떻게 X」 붙임꼴이라 「교육 참여율 **높이려면**?」·「클릭률 **낮추는 법**」·
    //      「설치율 **높일 방안**」이 다 샜다 — 「어떻게」를 안 붙이는 게 오히려 자연스러운 말투다.
    //   개선 동사는 **어디에 있든** 개선을 묻는 말이므로 홑낱말로 뺀다. 결과를 묻는 말은 활용이
    //   달라 안 걸린다(올랐·높아졌·낮아·줄었 — 실측으로 확인). 「개선·향상」은 명사라 홑낱말로
    //   빼면 「조치율 **개선됐어**?」(값 물음)까지 죽어 **「어떻게」에 남겨 둔다.**
    re: /^(?![\s\S]*(?:절차|방법|기준|법령|규정|지침|뜻|정의|소개|설명|뭐야|뭐예요|뭐에요|뭔데|뭔가|무엇|이란|업계|타사|동종|국내|해외|글로벌|일반적|평균적|다른\s*(?:회사|기업|기관|조직)|올리|올려|올릴|높이|높여|높일|줄이|줄여|줄일|낮추|낮춰|낮출|어떻게\s*(?:계산|산출|구하|구해|재|측정|개선|향상)))[\s\S]*(?:(?:조치|완료|준수|대응|이행|패치|적용|이수|등록|제출|참여|응답|설치|가입|서명|서약|열람|클릭|훈련|교육|출석|백업)\s*(?:(?:완료|성공)\s*)?(?:율|률)|SLA\s*준수|(?:작년|전년|올해|전년도)\s*(?:대비|보다))/i,
    tool: "kpi_status",
    args: {},
  },
  // ── 「기한 지난 ○○」 나머지 두 영토 (2026-09-07 · 야간 회귀 ① 수리) ────────────────
  //
  // ★★ 왜 생겼나: 위 finding_status 규칙(「기한 지난 취약점」)이 주석으로 이렇게 약속해 뒀다 —
  //   「기한 지난 점검 일정」(maintenance)·「기한 지난 일」(할 일)은 다른 영토라 삼키지 않는다.
  //   그런데 **삼키지 않기만 하고 그 영토로 보내는 규칙을 안 만들었다.** 둘 다 아무 규칙에도
  //   안 걸려 모델 판단으로 흘렀고, 2026-09-06 야간 회귀에서 「기한 지난 일 있어?」가
  //   **system_log_status**로 가서 「올린 문서에 숨은 지시문 발견」 같은 **제품 내부 처리 실패
  //   6건**을 「할 일」이라며 나열했다. 담당자가 자기 밀린 일을 물었는데 서버 로그가 나온 것이다.
  //   ⚠ 그 전날까지 초록이던 것은 실패가 0건이라 답에 「없」이 들어가 기대표를 **우연히**
  //     통과했기 때문이다 — 기능이 맞아서가 아니었다(약속-코드 불일치의 전형).
  //
  // ⚠ **자리는 배열 끝이다.** routes.ts 규칙표가 FORCED_INTENTS[n] 자리 번호로 가리키므로
  //   중간에 끼우면 뒤 번호가 통째로 밀린다(2026-08-10 실사고). 끝에 붙이면 안 밀린다.
  // ⚠ 앞의 finding_status 규칙이 **먼저** 훑이므로 「기한 지난 취약점」은 종전 그대로다.
  {
    // 「기한 지난 점검 일정 알려줘」 — 유지보수 점검의 지연분.
    // ⚠ 하드닝(원격·보안설정) 점검은 위 hardening_schedule_list의 영토라 배제한다.
    // ⚠ 절차·방법을 묻는 지식 질문은 비켜 준다(같은 파일 유지보수 규칙과 같은 제외구) —
    //   「기한 지난 점검 절차 알려줘」에 「등록된 점검이 없습니다」가 나가면 안 된다.
    re: /^(?![\s\S]*(절차|방법|항목\s*설명|순서|체크\s*리스트|어떻게\s*하|하드닝|원격|보안\s*설정|취약점))(?=[\s\S]*(?:조치\s*)?기한[^.\n]{0,4}(넘긴|지난|초과)|[\s\S]*밀린)(?=[\s\S]*점검)(?=[\s\S]*(있|없|뭐|무엇|남았|현황|목록|보여|알려|확인|어때))/,
    tool: "maintenance_status",
    args: {},
  },
  {
    // 「기한 지난 일 있어?」 — 내 할 일 쪽. urgent_todo가 KPI의 나쁜 값에서
    // **「기한 지난 조치 N건」을 P0로** 뽑아 주는 도구다(handlers.runUrgentTodo).
    // ⚠ 한글에는 \b가 안 걸린다 — 「일」이 「일정·일반」의 앞 글자로 잡히지 않게
    //   공백·문장부호 lookahead로 경계를 잡는다(위 finding_status 규칙과 같은 방식).
    // ⚠ 쓰기 재료 흐름은 삼키지 않는다 — 「기한 지난 조치 마무리를 **할 일로 담아줘**」는
    //   add_task의 영토다(담아·추가해·등록을 배제어에 둔다).
    re: /^(?![\s\S]*(점검|일정|취약점|스캔|담아|추가해|등록|절차|방법|어떻게))(?=[\s\S]*(?:조치\s*)?기한[^.\n]{0,4}(넘긴|지난|초과)|[\s\S]*SLA[^.\n]{0,6}(넘긴|초과|지난|위반))(?=[\s\S]*(?:(?:할\s*)?일|업무|작업)(?=[\s?.!,]|$))(?=[\s\S]*(있|없|뭐|무엇|목록|보여|알려|현황))/,
    tool: "urgent_todo",
    args: {},
  },
  // ── 📄 조각 없는 문서 (2026-09-07 · 계획서 전-4) ──────────────────────────────
  //
  // ★★ 왜 강제하나 — 「올렸는데 왜 답을 못 하지」는 **정답이 결정적**이다
  //   대장(memory_documents)과 저장소(LanceDB)를 대조하면 답이 하나로 나온다. 모델 판단에 맡기면
  //   같은 물음이 search로 흘러 「그 문서 있습니다」라고 답하는데 정작 검색은 0건이다 —
  //   담당자는 제품이 거짓말을 한다고 읽는다. 읽기인데 결정적이면 강제한다(recent_documents[47]과 대칭).
  //
  // ⚠ **자리는 배열 끝이다.** routes.ts 규칙표가 FORCED_INTENTS[n] 자리 번호로 가리키므로
  //   중간에 끼우면 뒤 번호가 통째로 밀린다(2026-08-10 실사고: 18줄). 붙인 뒤 반드시
  //   `node tools/routes-renumber.mjs --write` — 손으로 세지 않는다.
  //
  // ⚠ 배제구 — 이 라운드가 함께 만든 **쓰기 도구의 영토를 삼키지 않는다**:
  //   「조각 없는 문서 **다시 넣어줘**」는 reingest_document다(다시 넣·재인입·되살). 여기서 채 가면
  //   담당자가 고쳐 달라 했는데 목록만 다시 받는다. 「지워/삭제」도 delete_document의 영토다.
  //   ⚠ 절차·방법은 지식의 영토다 — 「조각이 사라지는 이유가 뭐야?」에 목록이 나가면 안 된다.
  //   (배제구를 두는 방식은 X 갈래의 today·urgent_todo 선례를 그대로 따른다.)
  {
    re: /^(?![\s\S]*(다시\s*넣|재인입|되살|담아|추가해|등록해|절차|방법|어떻게\s*하|지워|삭제))(?=[\s\S]*(?:조각|청크)[^.\n]{0,6}(?:없|사라|빠진|비어|누락)|[\s\S]*(?:지식|저장소|장기기억)[^.\n]{0,8}(?:사라진|없어진|빠진|안\s*들어간)\s*문서)(?=[\s\S]*문서)(?=[\s\S]*(있|없|뭐|무엇|목록|보여|알려|확인|현황|왜))/,
    tool: "doc_chunk_gaps",
    args: {},
  },
  // ── 🌙 「간밤에 뭐 터진 거 있어?」 (2026-09-08 · 야간 회귀 ① 수리) ─────────────────
  //
  // ★★ 왜 강제하나 — **모델이 매번 다른 답을 골랐고 둘 다 물음의 뜻이 아니었다**
  //   이 말은 어떤 규칙에도 안 걸려(제품 함수 forcedToolFor 실측 null) 09-03부터 모델 판단으로
  //   샜고, 모델은 낱말 「터진」만 보고 📚 침해사고 히스토리(incident_cases)를 골랐다.
  //   그건 **남의 회사 사고를 모아 둔 외부 사례 DB**다 — 담당자가 물은 것은 **우리 환경에서
  //   밤사이 생긴 일**인데 2024년 타사 랜섬웨어 사례가 나온다.
  //     · 2026-09-07 03:04 회차 → 「20건 중 「터진」에 걸리는 사례가 없습니다」(123자)
  //     · 2026-09-08 03:04 회차 → 타사 사례 5건 2,983자
  //   같은 말에 답이 이렇게 갈리는 것 자체가 모델 재량의 값이다. 아침에 가장 먼저 치는 말이라
  //   여기서 어긋나면 하루의 첫인상이 통째로 어긋난다.
  //
  // ★ 왜 briefing인가 — **「지난 이후 새로 생긴 것」을 실제로 세는 도구가 이것뿐이다**
  //   후보의 핸들러를 읽어 본 결과(2026-09-08 설계관):
  //     · briefing → briefing.ts의 newFindings = 지난 스냅샷 대비 **차집합**. 여기 하나뿐이다.
  //     · urgent_todo(handlers.runUrgentTodo)·analysis_status·threats → **시간창이 아예 없다**
  //       (KPI 나쁜 값 / 현재 미해결 전체 / CTI 교집합 — 「밤사이」라는 개념이 없다).
  //     · scan_status의 「신규」는 **재스캔 대비**지 밤사이가 아니다(잣대가 다르다 — 한 답에
  //       섞으면 같은 말이 두 숫자가 된다).
  //     · system_log_status는 **금지**다. 2026-09-06에 「기한 지난 일」이 이리로 새어
  //       제품 내부 처리 실패 6건을 「할 일」이라 답한 그 자리다(제품 로그 ≠ 우리 환경의 사건).
  //   ⚠ **한계를 알고 쓴다**: newFindings는 「밤사이」가 아니라 「어제 이후」다(하루 단위).
  //     ★ 정정(2026-09-08 오후 · 검토관 [상] 수리 뒤): 처음엔 「야간 하네스가 03:04에 스냅샷을
  //       먹으니 사람의 아침 브리핑은 03:04 이후만 센다」고 적었는데, 그 원인을 briefing.ts에서
  //       고쳤다 — 기준점은 이제 **오늘 이전 마지막 스냅샷**이라 03:04(오늘)은 기준이 못 된다.
  //       같은 수리로 **같은 날 두 번째 물음에서 「신규」 줄이 사라지던 것**도 없어졌다
  //       (이 규칙 때문에 한 아침에 briefing이 두 번 불리게 되어 드러난 결함이다).
  //
  // ⚠ **자리는 배열 끝이다.** routes.ts 규칙표가 자리 번호로 가리키므로 중간에 끼우면 뒤 번호가
  //   통째로 밀린다(2026-08-10 실사고: 18줄). 끝에 붙이면 안 밀린다.
  // ★ **앞자리가 곧 방어다**(2026-09-08 착수 전 실측 — 셋 다 그대로임을 확인하고 붙였다):
  //     · 「밤사이 로그에 이상 있었어?」   → analysis_status(앞자리)   — 로그 갈래는 이미 결정적
  //     · 「밤새 새로 올라온 문서 있어?」  → recent_documents(앞자리)  — 문서 갈래도 이미 결정적
  //     · 「간밤에 터진 사고 사례 알려줘」 → incident_cases(앞자리)    — 외부 사례는 그쪽 영토
  //     · 「밤새 서버 털렸어 어떻게 해?」  → 침해사고초동절차(dispatcher 특수경로, 배열보다 앞)
  //   아래 배제어는 **이중 방어**일 뿐이다 — 자리를 앞으로 옮기면 그 순간 위 넷이 깨진다.
  // ⚠ 매체 낱말(뉴스·기사·유튜브·채널·블로그·사이트·소식)을 뺀다 — 「간밤에 터진 뉴스 알려줘」는
  //   incident_sources의 영토다(지금은 사건어가 없어 안 걸리지만 「터진」이 붙으면 걸린다).
  //   ★ 「기사」는 2026-09-08 검토관이 잡았다 — 주석은 매체를 뺀다고 적어 놓고 **가장 흔한 낱말이
  //     빠져 있었다**(실측: 「간밤에 터진 기사 알려줘」→briefing). 약속과 코드가 어긋난 자리다.
  // ★★ **브리핑이 담지 않는 갈래는 이름으로 뺀다**(2026-09-08 검토관 [중] 수리).
  //   briefing.ts의 dailyBriefingText가 내는 줄은 다섯뿐이다 — 조치 상위·지난 이후 신규·SLA(초과/임박)·
  //   우리 자산 위협·오늘 추천. 백업·로그인·스캔·점검·회의·자산 변경은 **한 줄도 없다.**
  //   그런데 못 박으면 매번 같은 엉뚱한 답이 결정적으로 나간다 — 모델 재량보다 나쁘다.
  //     · 백업 → system_health(registry 설명 「백업 최신성」) · 스캔 → scan_status
  //     · 점검 → maintenance_status · 로그인/접속 기록 → analysis_status · 회의 → 우리 몫이 아니다
  //   실측(변경 전): 「밤새 백업 실패 났어?」·「밤새 로그인 실패 있었어?」가 briefing으로 갔다.
  // ⚠ 홑낱말 「있었」은 사건어에서 뺐다 — 「간밤에 회의 있었어?」·「간밤에 백업 실패한 거 있었어?」
  //   까지 삼켰다. 대신 **주어가 일반적인 꼴**(무슨 일·별일·아무 일·사고 + 있었/없었)만 남긴다.
  //   「어젯밤에 무슨 일 있었어?」는 그대로 걸리고, 「밤사이 별일 없었지?」가 새로 걸린다.
  // ⚠ 「밤새(?!도록|워)」 — 「밤새도록 돌린 스캔」·「밤새워 만든 문서」의 밤새는 **밤이라는 시간창이
  //   아니라 「내내」라는 부사**다. 같은 두 글자라 그물에 걸린다(2026-09-08 실측).
  // ⚠ 쓰기 흐름은 삼키지 않는다 — 「담아·추가해·등록해」는 add_task, 「다시 넣어」는 reingest다.
  //   **배정·승인·조치 같은 지시**는 여기 정규식이 아니라 아래 `조회로못박지않을것`이 막는다
  //   (잣대 한 곳). ⚠ 2026-09-08 정정: 처음엔 「배정 지시」만 적었는데 코드도 배정만 막고 있어
  //   「…있으면 승인해줘」 8꼴이 그대로 삼켜졌다(검토관 적발). 약속과 코드를 함께 넓혔다.
  // ⚠ 「보고서·리포트」는 적지 않는다 — 적용부의 briefing 공통 분기가 이미 비켜 준다(같은 이유).
  {
    re: /^(?![\s\S]*(사례|히스토리|뉴스|기사|유튜브|채널|블로그|소식|사이트|절차|방법|어떻게\s*[하해]|담아|추가해|등록해|등록\s*:|다시\s*넣|재인입|백업|로그인|접속\s*기록|스캔|점검|회의|자산\s*변경))(?=[\s\S]*(간밤|밤새(?!도록|워)|어젯밤|지난밤|밤사이))(?=[\s\S]*(터진|터졌|터질|생긴|생겼|일어난|일어났|(?<![지끝])났|(무슨\s*일|별일|아무\s*일|사고)\s*[이가]?\s*(있었|없었)|새로\s*(등록된|올라온|뜬)\s*(취약점|결함|사고|이슈|건)))(?=[\s\S]*(있|없|뭐|무엇|무슨|알려|보여|확인|현황|목록|어때|어떤|정리|요약|[?？]))/,
    tool: "briefing",
    args: {},
  },
];

// ── [83] 사내 지표율 — **주체어 규칙**(게이트, 기본 꺼짐) ────────────────────────
//
// ★ 무엇을 더하나: 위 [83]은 **지표 낱말 목록**(조치·제출·참여…)으로 잡는다. 목록에 없는 지표는
//   그대로 샌다 — 「우리 회사 정보보호 예산 **집행률**」·「당사 취약점 **평균** 조치 기간」·
//   「우리 자산 등록 **건수**」가 그렇다. 목록은 사고가 날 때마다 한 낱말씩 늘려 왔는데,
//   늘리는 쪽이 사고를 따라가지 못한다. 주체어(우리·사내·자사·당사)가 앞에 붙은 수치 물음은
//   **정의상 사내 실적**이라, 낱말이 아니라 **주어**로 잡으면 목록을 안 늘리고도 막힌다.
//
// ⚠ 왜 게이트로 두나: 이 갈래는 넓다. 넓은 규칙은 **남의 답을 삼킨다**(이 파일이 2차 넓힘에서
//   실제로 겪었고 3차에서 되돌렸다). 그래서 기본은 **끈 채로** 두고, 운영에서 켜서 재 본 뒤
//   승격 여부를 사람이 정한다. 켜기: 운영 env(gijo-as.env)에 `GIJO_KPI_SUBJECT_RULE=1` 한 줄.
//
// ⚠⚠ 왜 위 배열의 정규식 **리터럴을 그대로 두고** 여기서 갈아 끼우나 (조립 방식의 근거):
//   `re:`를 조립식(`new RegExp(...)`)으로 바꾸면 **소스를 글자로 읽는 감시 도구들이 이 규칙을
//   통째로 못 본다.** tools/guidance-check.mjs의 강제규칙 추출기는 `re: /…/,` 다음 줄의
//   `tool: "…"`를 찾는 꼴이라, 식별자를 쓰면 매치가 아예 안 되어 **못 읽은 규칙으로도 안 세고**
//   조용히 빠진다(그 파일이 「조용히 버리면 그 규칙은 검사에서 통째로 빠지는데 도구는 멀쩡하다고
//   답한다」고 적어 둔 바로 그 함정이다). → 기본형은 리터럴로 남기고, **켰을 때만** 조립한다.
//   그래서 게이트가 꺼져 있으면 [83]의 정규식 문자열은 **종전과 한 글자도 다르지 않다.**
//
// ★★ 2026-09-06 **A1 수리 — 「주어만으로」는 너무 넓었다**(검토관 실측).
//   첫 판은 「주체어 + (율|률|비율|평균|건수)」만 봤다. 켠 채로 전체 사슬을 재 보니 탐침 24문장 중
//   **13이 kpi_status로 강제**됐다 — 요구된 음성 8을 훨씬 넘어 이런 것까지 잡았다:
//     · 「우리 회사 **연차 사용률**」 · 「우리 회사 사원 **평균 연봉**」 · 「우리 팀 커피 소비량 평균」
//     · 「우리 회사 화장실 청소 주기 평균」 → **보안과 무관한 사내 물음**인데 보안 KPI 표가 나간다.
//     · 「사내 **문서 등록 건수**」 → 문서 수는 문서함이 세는 값인데 kpi_status의 표에는 없다.
//       그 표에는 문서 줄이 아예 없어 **묻지도 않은 자산·취약점 표**만 받는다(있는 답을 죽이는 쪽).
//     · 「당사 IPS **오탐율**」 → 방어가 탐지·차단·검출 세 낱말뿐이라 「오탐」이 비켜 갔다.
//     · 「당사 제품 대비 **경쟁사** 성능 평균」 → 3차 되돌림의 배제어에 「경쟁사」가 없었다.
//   ⚠ 첫 판이 「음성 8/8」이라고 적을 수 있었던 것은 **그 여덟 문장만 재서**다. 규칙의 넓이는
//     고른 표본이 아니라 **안 고른 문장**에서 드러난다 — 이 저장소가 반복해 겪은 모집단 함정이다.
//   → 세 가지를 고쳐 「주어 + **우리 영토** + 수치」로 좁힌다:
//     ① **영토 낱말**을 하나 요구한다(보안·취약점·자산·계정·패치·백업·침해…). 이것은 첫 판이
//        버리려 한 「지표 낱말 목록」과 **다른 종류**다 — 지표 이름(집행률·이수율·소진율…)은 사고마다
//        늘지만, **영토는 제품이 다루는 분야**라 안 는다. 늘어나는 목록은 여전히 안 쓴다.
//     ② 남을 가리키는 낱말에 **경쟁사·경쟁**을 더한다(업계·타사·동종과 같은 계보).
//     ③ 제품 스펙 방어에 **오탐·미탐**을 더한다(탐지·차단·검출과 같은 계약).
//   ⚠ 남는 넓이도 적어 둔다(승격 판단 재료다): 영토 낱말이 든 사내 수치 물음은 지표가 아니어도
//     잡힌다 — 「우리 회사 보안 담당자 평균 연차」가 그렇다. 그때 나가는 답은 지어낸 %가 아니라
//     **사내 KPI 표**라 사고는 아니지만, 묻지 않은 표인 것은 맞다. 시험이 이 문장을 못 박아 둔다.
//
// ⚠ 배제어는 **기본 규칙에서 물려받는다**(베끼지 않는다) — 아래 조립이 리터럴에서 그대로 떼어
//   쓴다. 베껴 두면 한쪽만 고쳐져 어긋난다(이 저장소가 가장 자주 밟은 자리).
// ⚠ 탐지·차단·검출(+오탐·미탐)은 **주체어 갈래 안에서 따로 막는다**(위 배제어에 넣으면 꺼진
//   기본형까지 글자가 바뀐다). 이 파일이 이미 정한 계약이라 게이트가 뒤집으면 안 된다:
//   「IPS 탐지율」·「WAF 차단율」은 사내 실적이 아니라 **제품 스펙**을 묻는 말이다.

/** 자기 조직을 가리키는 주어. */
const KPI_주체어 = String.raw`(?:우리|사내|자사|당사)`;
/**
 * 우리 영토 — 이 낱말이 문장 어딘가에 있어야 「사내 **보안** 실적」 물음이다.
 * ⚠ 지표 이름이 아니라 **분야**를 적는다(연봉·연차·커피를 막는 것이 목적이고, 새 지표가 생겨도
 *   분야는 그대로다). ⚠ 보안제품 이름(IPS·WAF·EDR)은 **일부러 안 넣는다** — 그건 제품 스펙·
 *   제품 소개의 영토라 위 계약과 같은 이유로 비켜서야 한다.
 */
const KPI_영토 =
  String.raw`보안|정보보호|취약점|자산|조치|패치|점검|침해|사고|악성|랜섬|백신|방화벽|계정|권한|접근|인증|MFA|암호|백업|로그|감사|교육|훈련|서약|개인정보|컴플라이언스|SLA|CVE|KEV`;
/** 남을 가리키는 낱말 — 기본 규칙의 배제어(업계·타사·동종…)에 **더한다**. */
const KPI_남의주어 = String.raw`경쟁사|경쟁`;
/** 제품 스펙 물음 — 사내 실적이 아니다. 주어와 수치 사이에 오면 비켜선다. */
const KPI_제품스펙 = String.raw`탐지|차단|검출|오탐|미탐`;
/** 수치를 묻는 꼬리. */
const KPI_수치 = String.raw`율|률|비율|평균|건수`;

/**
 * 게이트가 켜졌을 때 [83]에 주체어 갈래를 **OR로 더한** 정규식. 시험이 직접 문다.
 *
 * ⚠ 기본형(base)은 **글자 그대로** 첫 갈래에 들어간다 — 켜도 종전에 잡히던 것은 그대로 잡힌다.
 * ⚠ 모양이 달라졌으면 **아무것도 안 한다**(기본 규칙 그대로 돌려준다). 틀린 정규식을 조립해서
 *   조용히 다른 것을 잡는 쪽이, 게이트가 안 켜지는 것보다 훨씬 비싸다.
 */
export function kpi주체어갈래붙이기(base: RegExp): RegExp {
  const s = base.source;
  const 머리 = String.raw`^(?![\s\S]*(?:`;      // 기본형의 선행부정 시작
  const 이음 = String.raw`))[\s\S]*(?:`;        // 배제어가 끝나고 본문이 시작되는 자리
  const i = s.indexOf(이음);
  if (!s.startsWith(머리) || i < 0) return base;
  const 물려받은배제어 = s.slice(머리.length, i); // ★ 베끼지 않고 **떼어 쓴다**(단일 출처)
  const 새갈래 =
    `^(?![\\s\\S]*(?:${물려받은배제어}|${KPI_남의주어}))` +
    `(?=[\\s\\S]*(?:${KPI_영토}))` +
    `[\\s\\S]*${KPI_주체어}\\s*(?:(?!${KPI_제품스펙})[^\\n]){0,20}?(?:${KPI_수치})`;
  return new RegExp(`(?:${s})|(?:${새갈래})`, base.flags);
}

if (process.env.GIJO_KPI_SUBJECT_RULE === "1") {
  // ⚠⚠ **「배열 맨 끝」으로 찾지 않는다**(2026-09-07에 실제로 깨졌다). 예전엔 `length - 1`로
  //   집었는데, 그 자리 번호는 「앞으로 아무도 규칙을 안 덧붙인다」는 **지킬 수 없는 약속**이었다.
  //   이 파일이 스스로 「자리는 배열 끝에 둔다」고 권해 왔으므로 덧붙임은 반드시 일어난다 —
  //   실제로 「기한 지난 ○○」 두 규칙을 끝에 붙이자마자 게이트가 조용히 안 켜졌다(시험이 잡았다).
  //   → **도구 이름으로** 찾는다. kpi_status 규칙은 셋이지만 주체어를 더할 대상은 **맨 나중 것**이고,
  //     엉뚱한 규칙을 잡으면 아래 모양 검사(kpi주체어갈래붙이기)가 그대로 돌려줘 아무 일도 안 한다.
  const 자리 = FORCED_INTENTS.map((r) => r.tool).lastIndexOf("kpi_status");
  const 원본 = 자리 >= 0 ? FORCED_INTENTS[자리] : undefined;
  if (!원본) {
    // 규칙이 사라졌다 — 엉뚱한 규칙을 넓히느니 아무것도 안 한다(자리 번호 사고의 계보).
    console.warn("[agentloop] GIJO_KPI_SUBJECT_RULE — kpi_status 규칙을 못 찾아 주체어 규칙을 안 켰습니다.");
  } else {
    const 넓힌 = kpi주체어갈래붙이기(원본.re);
    if (넓힌 === 원본.re) console.warn("[agentloop] GIJO_KPI_SUBJECT_RULE — [83] 정규식 모양이 달라져 안 켰습니다.");
    else FORCED_INTENTS[자리] = { ...원본, re: 넓힌 };
  }
}
// 등록된 보안제품 이름을 콕 집어 "설명해줘"라고 물으면 그 제품의 사내 근거(매뉴얼·온톨로지)를
// 모아 답한다. [2026-07-26 실사용] "Tenable Web App Scanning 주요기능 설명해줘"에 도구를 하나도
// 안 쓰고 "이 자산 취약점 1건" 같은 엉뚱한 답이 나왔다 — 매뉴얼이 들어 있는데도 찾아보지 않았다.
// 어느 도구로 갈지 정해두지 않으면 LLM이 그냥 지어낸다.
const EXPLAIN_VERB_RE = /설명|주요\s*기능|무슨\s*(제품|기능)|뭐(야|하는)|어떤\s*(제품|기능|역할)|알려줘|소개/;

// 점검 절차·방법·항목을 묻는 말 — 스케줄 조회(hardening_schedule_list)와 갈라야 한다.
// 저쪽은 "언제/일정"을 묻고 이쪽은 "어떻게/무엇을"을 묻는다. 답이 나오는 곳도 다르다
// (저쪽=등록된 스케줄, 이쪽=지식베이스의 유지보수 절차 문서).
// ⚠ 넓게 잡았다가 바로 다른 것을 깨뜨렸다(2026-07-31, 회귀 하네스가 잡음):
//   "리눅스 SSH root 로그인 차단은 KISA 어떤 **점검항목**이야?"가 걸려 U-01 답이 사라졌다.
//   그건 하드닝 **기준 코드**를 묻는 질문이지 유지보수 절차가 아니다. 그래서:
//     · "점검항목"처럼 붙여 쓴 말은 제외한다(사이에 공백·수식어가 있어야 절차 질문이다)
//     · 정기·월간·주간처럼 **주기어**가 함께 있거나 "유지보수"가 명시될 때만 잡는다
//   좁히다 놓치면 답이 조금 헤맬 뿐이지만, 넓혀서 남의 답을 삼키면 그 기능이 죽는다.
/** 보안장비 운영 설정을 어떻게 보나 — 장비 낱말 · 설정 대상 · 확인 동사가 **셋 다** 있어야 한다. */
const 제품낱말 = /방화벽|waf|ips|ids|vpn|edr|백신|안티바이러스|스위치|라우터|프록시|siem|dlp|ahnlab|안랩|fortinet|palo\s*alto|checkpoint|cisco/i;
const 설정낱말 = /룰셋|룰|정책|규칙|시그니처|화이트리스트|블랙리스트|예외|설정|구성/;
const 확인낱말 = /어떻게|어케|방법|보나|보려면|확인|조회|어디서/;
function 제품설정질문(s: string): boolean {
  const t = String(s ?? "");
  return 제품낱말.test(t) && 설정낱말.test(t) && 확인낱말.test(t);
}

const MAINT_PROCEDURE_RE =
  /((정기|월간|주간|분기|연간)\s*점검|유지보수(\s*점검)?)\s*.{0,8}(절차|방법|순서|단계|항목|체크\s*리스트)|(점검|유지보수)\s+(절차|방법|순서|단계|체크\s*리스트)/;

// explain에 넘길 주제 — 장비 종류가 적혀 있으면 살려야 문서가 정확히 걸린다.
const MAINT_DEVICE_RE = /(방화벽|IPS|IDS|WAF|VPN|백신|안티바이러스|스위치|라우터|웹서버|서버)/i;
function maintenanceTopicOf(instruction: string): string {
  const dev = instruction.match(MAINT_DEVICE_RE);
  return (dev ? `${dev[1]} ` : "") + "정기점검 절차";
}
function namedProductIn(instruction: string): string | null {
  const q = instruction.replace(/\s+/g, "").toLowerCase();
  // 긴 이름부터 본다 — "Tenable Security Center"가 "Tenable"보다 먼저 걸리게.
  const names = listProducts()
    .map((p) => p.name)
    .filter((n) => n && n.replace(/\s+/g, "").length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const n of names) if (q.includes(n.replace(/\s+/g, "").toLowerCase())) return n;
  return null;
}

// [2026-07-29 시연 실측, 계획서 전-1] "SonicWall VPN 인증서 점검은 어떻게 해?"가 안내 대신
// **실제 하드닝 점검을 실행**했다. 방법을 묻는 말과 실행 지시는 다르다 — 방법 질문이면
// 점검 도구를 쓰지 않고 지식(RAG·채팅)으로 답한다. 실행은 명령형(점검해줘·실행·돌려)일 때만.
export function isHowtoNotCommand(instruction: string): boolean {
  const howto = /어떻게|어떤\s*방법|방법(을|이|은)?\s*(알려|뭐|있)|절차(가|를|는)?\s*(알려|뭐|어떻)|뭘\s*봐야/.test(instruction);
  const imperative = /(점검|진단|스캔)\s*(해\s*줘|해줘|해라|하자|실행|시작|돌려)|돌려\s*줘|실행해/.test(instruction);
  return howto && !imperative;
}

/** 사내 규정·지침을 조회하는 말인가 — 법령(외부)·판정 이력·행동 대조와 갈라야 한다.
 *  ⚠ 제외어에 「기록」을 넣지 않는다 — 「접속**기록** 보관 규정」이 걸려 정작 시연 문장이
 *  새 나간다(첫 구현에서 실제로 그랬다). 이웃 보호는 이력·대조 + 규정낱말 요구로 충분하다. */
export function 사내규정질문(instruction: string): boolean {
  return /^(?!.*(법령|법적|법제처|판례|법률|이력|대조))(?:.*(사내\s*)?(규정|지침|정책)[^.\n]{0,10}(알려|찾|보여|뭐야|확인))/.test(instruction);
}

// export: 시험이 **실제 라우팅 함수**를 그대로 불러 대조한다(정규식을 베껴 쓰면 드리프트한다).
/** 「…있으면 담당자한테 배정해줘」 같은 **쓰기 흐름**을 삼키면 안 되는 조회 도구들.
 *  강제 경로는 한 수로 끝나므로, 여기 있는 도구로 못 박히면 배정 단계에 영영 못 간다. */
// ⚠ briefing을 2026-09-08에 더했다(🌙 간밤 규칙과 같은 라운드). 「밤새 터진 거 김보안한테
//   배정해줘」는 조회로 끝내면 배정이 영영 안 된다 — 그리고 이 도구는 **원래도 같은 구멍**이었다
//   (「오늘 브리핑 보고 담당자 지정해줘」). 새 규칙에 배제어를 또 적는 대신 **이미 있는 잣대 한 곳**에
//   더한다 — 그래야 [13]과 새 규칙이 같은 답을 낸다(2026-09-07 urgent_todo·maintenance_status를
//   여기 더한 것과 같은 수리다).
const 조회로못박지않을것 = new Set(["today", "urgent_todo", "maintenance_status", "briefing"]);

/** 강제 결과 — `데이터의존`은 **글자만으로 안 갈리는 갈래**(제목 지목: 문서 목록을 조회한다)라는 표시다.
 *  route-explain이 이 값을 보고 「간다」고 단정하지 않는다(dispatcher 결정적도착지의 `조건부`). */
export interface 강제결과 { tool: string; args: Record<string, string>; argsByModel?: boolean; 데이터의존?: true }

export function forcedToolFor(instruction: string, scope?: ToolScope): 강제결과 | null {
  // ⚠ 강제 분기는 **화면 도메인 좁히기를 따르지 않는다**(검토 지적 2026-07-29).
  //   도메인 좁히기의 목적은 "LLM에게 보여 줄 도구 목록을 짧게 유지해 선택이 흔들리지 않게" 하는
  //   것인데, 강제 분기는 LLM을 아예 거치지 않는다 — 좁힐 이유가 없다. 그런데 좁힌 목록으로
  //   확인하는 바람에, 유지보수 화면에서만 보이는 도구를 취약점 화면에서 부르면 분기가 조용히
  //   비켜났다. 게이트가 잡아 고친 바로 그 오답이 다른 화면에서 그대로 재현되던 것이다.
  //   권한(role)은 그대로 지킨다 — admin 전용 도구가 강제 분기로 새면 안 된다.
  const available = new Set(listToolsFor(undefined, scope?.role).map((t) => t.name));

  // ★ 「X가 무슨 제품이야?」 — 제품 설명 질문을 explain(사내 근거)으로 못 박는다(2026-08-20).
  //   평가게이트 explain-product 실측: 강제 규칙이 없어 ⑨ 모델 선택으로 떨어졌고, 소형 모델이
  //   자산 도구를 골라 「이 자산에서 발견된 1개 취약점 중 즉시 조치 없음」을 답했다(7/26 실사고
  //   재발 — 운영 리셋 후 자산 1대 상태에서 재현). 이름을 못 뽑으면 강제하지 않는다.
  if (available.has("explain") && /(무슨|어떤)\s*제품|뭐\s*하는\s*(제품|솔루션|도구)/.test(instruction)) {
    const m = /^\s*(.{2,60}?)\s*(?:이|가|은|는)?\s*(?:(?:무슨|어떤)\s*제품|뭐\s*하는\s*(?:제품|솔루션|도구))/.exec(instruction);
    const 이름 = (m?.[1] ?? "").trim();
    // 대명사·자기 지칭은 제외 — 「이건/우리 제품」은 선택 치환·제품 즉답 등 제 길이 있다.
    if (이름 && !/^(이|그|저|이건|그건|저건|이거|우리|본|해당)$/.test(이름)) {
      return { tool: "explain", args: { topic: 이름 } };
    }
  }

  // 제품 소개자료 등록(추가 기능 2026-08-09) — 소개자료 화면이 "등록은 대화창에서"라고 안내한다.
  // 「제품 소개자료」 낱말 묶음은 다른 영토와 안 겹친다. 이름을 못 뽑으면 강제하지 않는다.
  if (available.has("register_product_intro") && /제품\s*소개\s*자료/.test(instruction) && /(등록|올려|추가)/.test(instruction)) {
    // "제품 소개자료 등록: SecuFW, 분류: 방화벽, 벤더: 시큐업, 소개: …" 꼴에서 결정적으로 뽑는다.
    const name = /(?:등록|추가|올려)[^:：]*[:：]\s*([^,，\n]+)/.exec(instruction)?.[1]?.trim()
      ?? /소개\s*자료\s*(?:등록|추가)?\s*[:：]?\s*「([^」]+)」/.exec(instruction)?.[1]?.trim() ?? "";
    const category = /분류\s*[:：]\s*([^,，\n]+)/.exec(instruction)?.[1]?.trim() ?? "";
    const vendor = /벤더\s*[:：]\s*([^,，\n]+)/.exec(instruction)?.[1]?.trim() ?? "";
    const summary = /소개\s*[:：]\s*([^,，\n]+)/.exec(instruction)?.[1]?.trim() ?? "";
    if (name) return { tool: "register_product_intro", args: { name, category, vendor, summary } };
  }

  // 전문가 어댑터 지시(재설계 2026-08-08) — 「어댑터」 낱말은 다른 영토와 안 겹쳐 결정적으로 잇는다.
  // 화면(설정·에이전트)이 "채택·배정은 대화창에서"라고 안내하므로 이 경로가 없으면 안내가 거짓이 된다.
  // 인자를 못 뽑으면 강제하지 않고 흘려보낸다(LLM 추출이 이어받음) — 빈 인자 결재판을 만들지 않는다.
  if (/어댑터/.test(instruction) && !/네트워크\s*어댑터|랜\s*어댑터/i.test(instruction)) {
    const 어댑터명 = /([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+)/i.exec(instruction)?.[1] ?? "";
    // 반입 — "xxx.gguf 어댑터 반입해줘". 파일명이 없으면 강제하지 않는다(빈 결재판 방지).
    if (available.has("import_adapter") && /(반입|가져와|가져오|들여와|들여오)/.test(instruction)) {
      const 파일 = /([\w가-힣.-]+\.gguf)/i.exec(instruction)?.[1] ?? "";
      // 낱말은 handlers.ts runAdapterImport의 주제별칭 표와 같아야 한다 — 여기서 못 뽑으면 주제 없이(topic "") 반입돼
      //   어댑터가 분야를 잃는다. 「일반|용어|개념」은 해설(normaltic) 어댑터(2026-09-03, 검토관 다).
      const 분야 = /(취약점|장비운영|장비|사내규정|규정|위협대응|위협|일반|용어|개념)/.exec(instruction)?.[1] ?? "";
      if (파일) return { tool: "import_adapter", args: { file: 파일, topic: 분야 } };
    }
    if (available.has("adopt_adapter") && /(채택|승인)/.test(instruction) && !/배정/.test(instruction) && 어댑터명) {
      const 해제 = /(채택|승인)\s*(해제|취소)|해제|내려/.test(instruction);
      const 근거 = /근거\s*[:：]\s*([^\n]+)/.exec(instruction)?.[1]?.trim() ?? "";
      return { tool: "adopt_adapter", args: { adapter: 어댑터명, mode: 해제 ? "해제" : "채택", note: 근거 } };
    }
    if (available.has("assign_adapter") && /(배정|붙여|달아|입혀|장착)/.test(instruction)) {
      const 팀원 = /(스캔|분석|리포트|보고서|티아이|기조|사서|큐레이터|해설|부품표|부품|총괄|오케스트|scan|analysis|report|ti|normaltic|gijo|curator)/i.exec(instruction)?.[1] ?? "";
      const 해제 = /(해제|빼|떼)/.test(instruction);
      if (팀원 && (어댑터명 || 해제)) {
        return { tool: "assign_adapter", args: { agent: 팀원, adapter: 해제 ? "없음" : 어댑터명 } };
      }
    }
    if (available.has("adapter_status") && /(현황|상태|목록|뭐\s*있|있어|어때|채택\s*됐|배정\s*됐)/.test(instruction)) {
      return { tool: "adapter_status", args: {} };
    }
  }

  if (available.has("explain") && EXPLAIN_VERB_RE.test(instruction)) {
    const product = namedProductIn(instruction);
    if (product) return { tool: "explain", args: { topic: product } };
  }

  // CVE 식별자 + 「뭐야/설명」 — 실측(2026-08-07): 모델 자유작문으로 27~34초를 오갔다.
  //   같은 질문을 explain(근거 수집) 경로로 던지면 같은 내용이 ~9초에 나온다(실측 대조).
  //   식별자가 문장에 있으면 그 경로로 못 박는다. ⚠ 조치·절차·대응을 물으면 비켜 준다 —
  //   그건 플레이북(조치 절차)의 영토다.
  const cveId = /(CVE-\d{4}-\d{4,})/i.exec(instruction)?.[1];
  if (available.has("explain") && cveId && /뭐야|뭔가요|무엇|설명/.test(instruction) && !/조치|절차|대응|패치/.test(instruction)) {
    return { tool: "explain", args: { topic: cveId.toUpperCase() } };
  }

  // 점검 "절차·방법·항목"을 묻는 말은 **사내 문서 근거**로 결정적으로 잇는다.
  // [2026-07-31 QA-M04 재발] "방화벽 월간 정기점검 절차를 알려줘"에 처음엔 스케줄 조회가
  // (빈 스케줄), 그걸 고치자 이번엔 LLM이 분석 허브를 골라 취약점 목록이 돌아왔다.
  // 담당자가 점검일 아침에 던지는 질문인데 두 번 다 엉뚱한 답이었다.
  // 7B에 프롬프트로 타이르지 않고(확립 원칙) 경로를 코드로 못박는다 —
  // 유지보수 절차는 지식베이스에 있고, explain이 그 문서를 근거로 모은다.
  if (available.has("explain") && MAINT_PROCEDURE_RE.test(instruction)) {
    return { tool: "explain", args: { topic: maintenanceTopicOf(instruction) } };
  }

  // 보안장비 **운영 설정을 어떻게 보나** — 답은 그 제품의 사내 매뉴얼에 있다.
  //   실측(2026-08-03): "WAF 룰셋 어떻게 확인해?"에 LLM이
  //   "당신이 주어진 질문에 대해서, 우선순위 판단에 관심이 있는 것으로 보입니다"로 시작하는
  //   엉뚱한 답을 길게 늘어놓았다. 매뉴얼이 들어 있는데도 찾아보지 않은 것이다.
  // ⚠ 좁게 잡는다: **장비·제품 낱말 + 설정 대상 + 확인/설정 동사**가 다 있어야 한다.
  //   "어떻게 해"만으로 잡으면 내 할 일 절차(work_steps)를 가로챈다.
  if (available.has("explain") && 제품설정질문(instruction)) {
    return { tool: "explain", args: { topic: instruction.replace(/\s*(어떻게|어케)\s*.*$/, "").trim() || instruction } };
  }

  // 사내 규정을 묻는 말은 **사내 문서**가 근거다 — 법제처(외부)로 보내지 않는다.
  //   실측(2026-08-07 시연 대본 대조): "접속기록 보관 기간 규정 알려줘"를 LLM이 법령 조회로
  //   보냈고, 법제처 API가 IP 검증으로 거부하자 **그 오류문이 담당자에게 그대로** 나갔다.
  //   시연 ③이 가르치는 문장이다 — 사내 규정 문서(RAG)를 근거로 답해야 한다.
  //   ⚠ 법령·법적 근거·판례를 명시하면 법제처가 맞다(비켜 준다). 「규정 대조 이력」(판정 기록
  //   조회)과 「~해도 돼?」(행동 대조)도 다른 말이다 — 이력·기록·대조를 제외한다.
  // ★ 문서를 콕 집어 그 내용/존재를 묻는 말(「이 안내서에서 암호화 대상 뭐야」·「이 매뉴얼 랜섬웨어 대응
  //   절차 있어?」)은 문서 RAG(explain)로 못박는다 — 안 그러면 ⑨ LLM 라우터가 법령 검색을 오선택하거나
  //   (2026-08-21 실측) 낱말 트리거(침해사고)가 채 간다. 신호=문서지목질문(**언어패턴**: 문서유형어+조사
  //   또는 지시어+문서유형어 — docScope 토큰매칭 아님, 업로드 문서 유무와 무관). 사내규정질문보다 앞에
  //   둔다(더 구체 — 문서를 명시 지목). 둘 다 참이어도 같은 explain으로 수렴한다(검토관 ②).
  if (available.has("explain") && 문서지목질문(instruction)) {
    return { tool: "explain", args: { topic: instruction } };
  }

  if (available.has("explain") && 사내규정질문(instruction)) {
    return { tool: "explain", args: { topic: instruction.replace(/\s*(알려|찾아|보여|확인)[^.\n]*$/, "").trim() || instruction } };
  }

  // 문서 **소재**를 묻는 말(「방화벽 매뉴얼 어디 있더라」)은 통합 검색이 답한다.
  //   라이트 게이트 실측(2026-08-13): LLM이 도구 없이 자유작문으로 「할 일 추가로 찾을 수
  //   있습니다」라는 헛길 안내를 냈다(근거약함 배너는 붙었지만 답이 길이 아니다). 문서·매뉴얼
  //   낱말 + 어디 조합을 search로 못박는다 — 검색어는 「어디」 앞의 대상 이름만.
  //   ⚠ 법령·판례(법제처 영토)와 화면·메뉴(화면 안내 영토)가 낀 말은 비켜 준다.
  {
    const 문서소재 = /(매뉴얼|가이드|지침서?|문서|자료)\s*(가|이|은|는)?\s*어디(\s|에|서|\?|$|있|였|더라|지|야|냐)/.exec(instruction);
    if (available.has("search") && 문서소재 && !/법령|법적|판례|화면|메뉴/.test(instruction)) {
      const 대상 = instruction.slice(0, 문서소재.index + 문서소재[1].length).replace(/^.*?(?=[가-힣A-Za-z0-9])/, "").trim();
      if (대상) return { tool: "search", args: { query: 대상.slice(0, 60) } };
    }
  }

  // 상태어·속성어 + 취약점 조회 — 「미조치 취약점 알려줘」(2026-08-08 리허설 실측: 3/3 재현).
  //   search가 "미조치"로 **지식 문서**(생애주기 설명)를 끌어와 실데이터(미검토 4,826)를 안
  //   보여줬다 — 상태·속성은 글자 검색이 아니라 상태 칸의 몫이다(2026-08-04 원칙). 상태어를
  //   그대로 필터로 넘긴다 — 속성사전(필터에맞나)이 그 말을 안다. 필터가 동적이라 FORCED
  //   배열이 아닌 여기서(정적 args 한계). ⚠ 파일럿 첫날 대본 4절의 문장이라 흔들리면 안 된다.
  {
    const 상태어취약점 = /^(미조치|미검토|미배정|열린|고위험|매우\s*심각한?|심각한|critical|high|kev|실제\s*악용)\s*(된|인)?\s*(상태\s*)?취약점[^.\n]{0,8}(알려|보여|뭐|현황|목록|있)/i.exec(instruction);
    if (available.has("finding_status") && 상태어취약점) {
      return { tool: "finding_status", args: { filter: 상태어취약점[1].replace(/\s+/g, "") } };
    }
  }

  // 조건 일괄 배정 — 「고위험인데 미배정인 취약점 **전부** 담당자 김도희로 배정해줘」.
  //   파일럿 리허설 실측(2026-08-07): 조건·전부·이름을 다 말했는데 LLM이 **단건** 배정 도구를
  //   골라 "자산 id가 필요합니다"라고 되물었다 — 담당자는 이미 다 말했다. 일괄 도구(bulk_update)가
  //   있으니 조건을 뽑아 결재판까지 결정적으로 잇는다(실행은 여전히 승인 후).
  //   ⚠ 좁게: 집합어(전부/모두/일괄) + 조건 토큰 + 담당자 이름이 **셋 다** 있을 때만.
  if (available.has("bulk_update") && /전부|모두|모조리|일괄|다\s*배정/.test(instruction) && /배정|맡겨/.test(instruction)) {
    const 토큰: string[] = [];
    if (/고위험|위험\s*높/.test(instruction)) 토큰.push("고위험");
    else if (/critical|크리티컬|매우\s*심각/i.test(instruction)) 토큰.push("critical");
    else if (/high|높은/i.test(instruction)) 토큰.push("high");
    if (/미배정|담당\s*없|미지정/.test(instruction)) 토큰.push("미배정");
    if (/kev|실제\s*악용/i.test(instruction)) 토큰.push("kev");
    if (/기한\s*초과|지연/.test(instruction)) 토큰.push("기한초과");
    const 이름 = /담당자?\s*(?:를|을)?\s*([가-힣]{2,4})\s*(?:로|으로|한테|에게)/.exec(instruction)?.[1];
    if (토큰.length && 이름) {
      return { tool: "bulk_update", args: { filter: 토큰.join(" "), assignee: 이름 } };
    }
  }

  // "가장 급한 취약점 담당자·기한 배정해줘"처럼 배정/지정 지시면 우선순위 조회(today)로 못박지 않는다
  // — LLM이 assign_finding(쓰기)을 고르도록 둔다(실측: today 강제가 배정 명령까지 흡수했었음).
  // ⚠ 사이에 **사람 이름이 들어간다**. 「담당자를 **김도희로** 지정해줘」처럼.
  //   예전 규칙은 담당자 뒤 2글자까지만 봐서 이 말을 놓쳤고, 그러면 today가 흡수해
  //   **쓰기 지시에 오늘 목록이 나왔다**(2026-08-09 파일럿 리허설 실측 — 대본 24~30분이
  //   바로 이 문장이라 시연이 그 자리에서 깨진다).
  // ⚠ 「미배정 몇 건?」 같은 **조회**는 뺀다 — 그건 세는 질문이지 시키는 말이 아니다.
  // ⚠ 「배정 **현황**」도 조회다(2026-09-08 검토관 적발) — 홑낱말 「배정」만 보고 쓰기로 읽으면
  //   「간밤에 터진 거 담당자 배정 현황 알려줘」가 강제에서 풀려 모델 재량으로 샌다(실측 ∅).
  const isAssignQuery = /미배정|배정\s*안\s*[된함]|배정\s*없|담당자?\s*없|배정\s*(현황|목록|상태|내역)/.test(instruction);
  const isAssign =
    !isAssignQuery &&
    /배정|담당자[^\n]{0,12}(지정|정해|배치|맡|넣)|기한\s*(을|를)?\s*(지정|정해|설정|잡)|맡겨|배치해줘/.test(instruction);
  // ★★ **배정만이 쓰기가 아니다**(2026-09-08 검토관 적발 · 실측 8꼴). 「…있으면 승인해줘」를
  //   조회로 못 박으면 목록만 나가고 승인은 영영 안 된다 — isAssign과 **똑같은 사고**인데
  //   막는 낱말이 배정 하나뿐이었다. 잣대는 아래 조회로못박지않을것 한 곳에서 함께 쓴다.
  // ⚠ **문장 끝**에만 건다. 낱말만 보면 「오늘 조치해야 할 거 뭐야?」 같은 **조회**까지 삼킨다 —
  //   그게 이 파일이 2026-08-01에 겪은 사고다(제외어 목록이 업무 이름을 잡아먹었다).
  const isWriteOrder =
    /(승인|반려|조치|처리|마감|종결|차단|삭제|제거|회수)\s*해\s*(줘|주세요|라|다오)?\s*[.!?？~]*\s*$|(지워|없애)\s*(줘|주세요)?\s*[.!?？~]*\s*$/.test(instruction);
  // ⚠ "○○ 완료" 분기는 **dispatcher로 옮겼다**(2026-08-01 검토). 여기서 낱말 제외어
  //   (취약점|점검|자산|CVE)를 쓰다가 정작 업무 이름 자체가 그 낱말로 만들어진다는 걸
  //   놓쳐, 목록이 시킨 그대로 친 "취약점 점검 완료"가 도구를 못 탔다. 자물쇠는 하나여야
  //   한다 — dispatcher의 내할일완료말()이 이름 대조로 판정한다.

  // ★ "n번 했어" / "n번 취소" — 절차 카드를 보고 답하는 말. 짧아서 7B가 늘 흘린다.
  //   여기서 잡지 않으면 담당자가 단계를 밟아도 진행이 하나도 안 남는다.
  const 단계말 = instruction.match(/^\s*(\d{1,2})\s*(?:번|단계)\s*(했|완료|끝|취소|되돌|다시)/);
  if (단계말) {
    const 되돌림 = /취소|되돌|다시/.test(단계말[2]);
    const tool = 되돌림 ? "step_undo" : "step_done";
    if (available.has(tool)) return { tool, args: { step: 단계말[1] } };
  }

  // ★ "○○ 어떻게 해?" — 목록 답변이 이렇게 물으라고 **약속한** 말이라 반드시 이어져야 한다.
  //   ⚠ 화면 사용법·개념 질문("이 화면 어떻게 써", "CVSS가 뭐야")과 섞이면 안 된다 —
  //   그건 screenguide·explain의 몫이므로, 열려 있는 내 할 일과 이름이 겹칠 때만 잡는다.
  const 절차말 = instruction.match(/^(.{2,60}?)\s*(?:어떻게\s*(?:해|하지|하나요|합니까)|절차\s*(?:알려|보여)|뭐부터\s*(?:해|하지))\s*[?？]?\s*$/);
  if (절차말 && available.has("work_steps") && !/화면|메뉴|이거|이걸|여기/.test(절차말[1])) {
    const 납작 = (s: string) => s.replace(/\s/g, "");
    const 겹침 = listTasks().some((t) => !t.done &&
      (납작(t.text).includes(납작(절차말[1])) || 납작(절차말[1]).includes(납작(t.text))));
    if (겹침) return { tool: "work_steps", args: { task: 절차말[1].trim() } };
  }

  for (const f of FORCED_INTENTS) {
    if (f.re.test(instruction) && available.has(f.tool)) {
      // 배정 지시는 **조회 도구로 못 박지 않는다** — 강제 경로는 도구 하나를 부르고 즉시 끝나서
      // 「조회 → 배정」 2수 흐름이 통째로 죽는다(시킨 일은 안 되고 목록만 나간다).
      // ⚠ 예전엔 today에만 걸었는데 같은 성질의 **urgent_todo·maintenance_status가 그대로 샜다**
      //   (2026-09-07 검토관 적발 · 실측: 「기한 지난 점검 있으면 담당자한테 배정해줘」→maintenance_status).
      //   원래 사고는 2026-08-09 파일럿 리허설 — today 강제가 배정 명령을 흡수해 대본이 그 자리에서 깨졌다.
      // ⚠ 2026-09-08: **배정 외의 쓰기 명령**도 같은 자리에서 막는다(위 isWriteOrder 머리글).
      if (조회로못박지않을것.has(f.tool) && (isAssign || isWriteOrder)) continue;
      if (f.tool === "search") {
        // 세는 질문("몇 건", "총 몇 개")은 목록·집계가 맞다 — 검색으로 돌리지 않는다.
        if (/몇\s*(건|개)|총\s*\d|건수/.test(instruction)) continue;
        // ⚠ "오늘 / 지금 가장 급한 / 우선순위 / 뭐부터"는 **today가 맡는 말**이다.
        //   평가 게이트 실측(2026-08-02): 이 제외가 없어 today-urgent가 search로 새면서
        //   routing이 100% → 96.9%로 떨어졌다. FORCED_INTENTS는 배열 순서대로 보는데
        //   내가 넣은 규칙이 앞에 있어 좁은 규칙(today)을 가로챈 것이다.
        //   여기서 continue하면 그다음 규칙으로 넘어가므로 today가 제자리를 찾는다.
        if (/오늘|지금\s*(가장|제일)|가장\s*급한|제일\s*급한|우선순위|뭐부터/.test(instruction)) continue;
        // ⚠ "잃은 / 사라진 취약점"은 **검색어가 아니다**(2026-08-03 실측). 이 규칙이 앞에 있어
        //   「잃은 취약점 있어?」가 query="잃은"으로 검색에 새고 "찾지 못했습니다"로 끝났다 —
        //   담당자는 4,467건이 덮여 있다는 사실을 영영 못 본다. 잃은 것을 묻는 말은 뒤의
        //   lost_findings_status가 맡는다.
        if (/잃|사라진|없어진|날아간|지워진|덮어[쓴씌]/.test(instruction)) continue;
        // 검색어는 **대상 이름만** 넣는다. 지시문을 통째로 넣으면 "취약점 알려줘"까지 섞여
        //   엉뚱한 문서가 걸린다(검색어 하나 원칙 — 도구 설명에 적힌 대로).
        const 대상 = instruction.replace(/\s*(의|에)?\s*취약점.*$/, "").trim();
        if (!대상) continue;
        return { tool: "search", args: { query: 대상 } };
      }
      // ★ 「결제서버 조치 검증 실행해줘」의 **대상**을 넘긴다(2026-09-07 검토관 적발).
      //   예전엔 args:{}뿐이라 자산 이름을 또렷이 말해도 인자가 비었고, 도구가 「어느 자산인지
      //   몰라」로 **되물었다** — 되묻기가 가르치는 말이 다시 되묻기로 오는 **막다른 길**이었다.
      //   (되묻기 예시는 「결정적으로 닿는 말」만 쓰기로 했고 그 말이 바로 이 문장이라, 이쪽이 살아야 한다.)
      // ⚠ **지어내지 않는다** — 사람 말에서 남는 부분만 넘기고, 없으면 빈 인자로 둔다.
      //   그러면 도구가 자산못찾음되묻기()로 정직하게 되묻는다(문구는 한 곳에서만 만든다).
      // ⚠ 대명사만 남으면 대상이 아니다(「이거 검증 실행해줘」) — 직전 대상이 있으면 그것을 쓴다(#8).
      if (f.tool === "verify_finding") {
        // ⓐ 화면에서 고른 항목(⌗이름::키)이 실려 있으면 **그것이 대상**이다 —
        //    registry의 autoFill이 쓰는 값과 **같은 규칙**을 쓴다(두 곳에서 가르면 어긋난다).
        //    ⚠ 이 도구는 write:false라 autoFill이 안 돈다. 여기서 안 하면 아무도 안 한다.
        const 고른것 = /⌗(.+?)::([0-9a-f]{16})/.exec(instruction);
        if (고른것) return { tool: f.tool, args: { assetId: 고른것[1].trim(), finding: "key:" + 고른것[2] } };
        const 대상 = instruction
          .replace(/(?:(?:취약점|조치)\s*)*검증\s*(?:실행|돌려)\s*(?:해\s*줘|주세요|줄래|주라|줘|봐)?/g, " ")
          .replace(/\s+/g, " ")
          .trim()                                              // ⚠ 조사 떼기 **전에** 공백을 정리한다
          .replace(/(.{2,})(?:의|를|을|이|가|은|는|도)$/, "$1"); //   (안 그러면 「결제서버의 」의 $가 안 맞는다)
        const 대명사만 = !대상 || /^(이거|이것|이건|그거|그것|그건|저거|저것|아까\s*거|방금\s*거|해당\s*건)$/.test(대상);
        const ctx = 대명사만 ? recentTarget(scope?.대화) : null;
        if (ctx) return { tool: f.tool, args: { assetId: ctx.assetId, finding: ctx.finding } };
        return { tool: f.tool, args: 대명사만 ? {} : { assetId: 대상 } };
      }
      // ★ 「critical 취약점 몇 건이야?」 — 조건을 안 넘겨 **전체 건수**를 답하던 것(2026-08-03).
      //   담당자는 심각도로 좁혀 물었는데 4,827건을 그대로 받았다. 취약점이 17건일 때는
      //   전체나 critical이나 비슷해 보여 아무도 몰랐다 — 데이터가 커지고서야 드러났다.
      // ⚠ 조건은 **물음에 실제로 있는 말**만 넘긴다. 없는 조건을 지어내면 엉뚱하게 좁힌다.
      // ★ 「GIJO AS 서버 패키지 목록 읽어줘」의 **대상**을 넘긴다(2026-08-04).
      //   안 넘기면 결재판에 `"undefined"에 해당하는 점검 대상을 찾지 못했습니다`가 뜬다 —
      //   어제 심각도 조건이 사라지던 것과 **같은 함정**이다(args를 비운 채 부르기).
      if (f.tool === "collect_packages") {
        const 대상 = instruction
          .replace(/(패키지|구성요소|부품|sbom)/gi, " ")
          .replace(/(목록|읽어|수집해?|가져와|채워)\s*(줘|주세요|줄래|주라|봐|보자)?/g, " ")
          .replace(/[의를을에서]\s*$/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return { tool: f.tool, args: 대상 ? { target: 대상 } : {} };
      }
      // ★ 지목한 단계를 넘긴다(2026-08-04). 안 넘기면 「발견 단계에서 뭘 해야 해?」에
      //   5단계 전체 현황이 나와 **묻지 않은 것까지** 답하게 된다.
      //   ⚠ 지시문을 통째로 넘긴다 — 단계 판별은 agenttools의 질문속단계 한 곳에서만 한다
      //     (두 곳에서 가르면 반드시 어긋난다. 절차 숫자를 한 곳에서 세는 것과 같은 이유).
      if (f.tool === "workflow_status") {
        return { tool: f.tool, args: { stage: instruction } };
      }
      // ★ 지표 이름을 넘긴다(2026-09-06 · 사고 수리). 제품이 **안 세는 지표**(교육 이수율 등)를
      //   물었을 때 「그건 아직 집계하지 않습니다」라고 답하려면 답이 물음을 알아야 한다.
      //   ⚠ 지시문을 통째로 넘긴다 — 지표 이름 판별은 handlers.안세는지표찾기 **한 곳**에서만 한다
      //     (workflow_status의 stage와 같은 이유: 두 곳에서 가르면 반드시 어긋난다).
      if (f.tool === "kpi_status") {
        return { tool: f.tool, args: { q: instruction } };
      }
      // ★ 법령 검색어는 **법 이름만** 넣는다(2026-08-09). 지시문을 통째로 넘기면 "찾아줘"까지
      //   섞여 법제처가 0건을 준다 — 검색어 하나 원칙(search와 같은 함정).
      //   종류는 말에서 읽는다: 판례→prec · 고시/훈령/행정규칙→admrul · 나머지→law.
      if (f.tool === "law_lookup") {
        const target = /판례|판결/.test(instruction) ? "prec"
          : /고시|훈령|행정규칙|예규/.test(instruction) ? "admrul"
          : "law";
        let q = instruction
          .replace(/[?？!！.]+\s*$/g, " ")
          .replace(/(뭐라고|어떻게)\s*(돼|되어)\s*있(어|나|는지)?\s*$/g, " ")
          .replace(/(찾아|알려|보여|검색해?)\s*(줘|주세요|줄래|주라|봐|보자)?\s*$/g, " ")
          .trim();
        // 꼬리에 붙은 종류말·「관련」·조사를 차례로 턴다("개인정보 유출 관련 판례" → "개인정보 유출").
        // ★ 「내용·본문·전문」도 턴다(2026-08-13 QA): 「제40조 내용 알려줘」에서 알려줘만 떨어져
        //   "…법 내용"이 검색어로 남았고, 법제처가 0건 → 조문 본문 대신 목록으로 물러났다.
        for (let i = 0; i < 3; i++) {
          q = q
            .replace(/\s*(판례|판결|고시|훈령|행정규칙|예규|법령|법률|원문|조문|내용|본문|전문)\s*$/g, "")
            .replace(/\s*(관련|관한|에\s*대한)\s*$/g, "")
            .replace(/\s*(이|가|을|를|은|는|의)\s*$/g, "")
            .trim();
        }
        // ★ 조문 번호는 **따로 떼어 인자로** 넘긴다(2026-08-09, 후-3). 위 꼬리 털기가 「조문」을
        //   지우므로 여기서 먼저 뽑지 않으면 「제29조」가 검색어에 남아 법제처가 0건을 준다.
        //   법령(law) 갈래에서만 — 고시·판례는 조문 단위 조회 대상이 아니다.
        const 조 = target === "law" ? /제?\s*(\d{1,3})\s*조/.exec(instruction)?.[1] : undefined;
        if (조) q = q.replace(/제?\s*\d{1,3}\s*조\s*/g, " ").replace(/\s+/g, " ").trim();
        if (!q) continue; // 이름이 안 남으면 모델에게 넘긴다 — 빈 검색어로 부르지 않는다
        return { tool: f.tool, args: { query: q, target, ...(조 ? { article: 조 } : {}) } };
      }
      if (f.tool === "finding_status") {
        const 조건 = /(critical|긴급|매우\s*심각)/i.test(instruction) ? "critical"
          : /(high|고위험|높음)/i.test(instruction) ? "high"
          : /(medium|중간)/i.test(instruction) ? "medium"
          : /(low|낮음)/i.test(instruction) ? "low"
          : /kev|실제\s*악용/i.test(instruction) ? "kev"
          : /미배정|배정\s*안|담당자?\s*없/.test(instruction) ? "미배정"
          : /기한\s*(초과|지난)|지연/.test(instruction) ? "기한"
          : "";
        // ★ 자산을 지목한 세는 질문은 **그 자산으로 좁힌다**(2026-08-09 2단계 e2e가 잡은 공백).
        //   「172.168.50.142 취약점 몇 건이야?」에 전역 4,828건이 나갔다 — 이름을 직접 쳐도
        //   화면에서 골라도(선택 치환) 같았다. 유일하게 특정될 때만 좁힌다(모호하면 전역 그대로 —
        //   없는 조건을 지어내 엉뚱하게 좁히는 것이 더 나쁘다). 필터 토큰은 id다: 현황 도구의
        //   건초더미가 assetId라 표시 이름 토큰은 안 맞는다.
        const 지목 = 지목된자산아이디(instruction);
        const filter = [조건, 지목].filter(Boolean).join(" ");
        return { tool: f.tool, args: filter ? { filter } : {} };
      }
      if (f.tool === "briefing" && /리포트|보고서|report/i.test(instruction)) continue; // 문서 리포트는 briefing 아님
      // 하드닝 점검 기준 선택: CIS 명시→cis, PC/윈도우→kisa_pc, 네트워크 장비→kisa_net, 그 외→국내 CCE(kisa).
      if (f.tool === "run_hardening_scan") {
        if (isHowtoNotCommand(instruction)) continue; // 방법 질문은 실행하지 않는다(2026-07-29)
        // 스케줄·주기를 묻는 말은 조회다 — 배열 순서상 실행이 먼저 걸리므로 여기서 비켜 준다
        // ("하드닝 점검 스케줄 알려줘"가 실제 점검을 돌리던 것, 검토 지적 2026-07-29).
        if (/스케줄|일정|주기/.test(instruction) && !/돌려|실행해|지금\s*해/.test(instruction)) continue;
        const standard = /\bcis\b|국제/i.test(instruction) ? "cis"
          : /\bpc\b|피시|윈도우|windows/i.test(instruction) ? "kisa_pc"
          : /네트워크\s*장비|스위치|라우터|cisco/i.test(instruction) ? "kisa_net"
          : "kisa";
        return { tool: f.tool, args: { standard } };
      }
      // 온톨로지 조회는 **검색어가 필수**다(agenttools: query required). 빈 인자로 부르면 도구가
      // "무엇의 연결 관계를 찾을지 알려주세요"를 돌려주고, 강제 경로는 예외가 아니면 폴백하지
      // 않으므로 그 되물음이 유일한 근거가 되어 답이 만들어진다 — 도구는 불렀는데 답은 빈
      // '거짓 통과'다(검토 지적 2026-07-29). 질문에서 검색어를 뽑고, 못 뽑으면 강제하지 않는다.
      if (f.tool === "ontology_query") {
        const query = ontologyQueryOf(instruction);
        if (!query) continue; // LLM이 고르게 둔다 — 빈 조회로 되묻느니 낫다
        return { tool: f.tool, args: { query } };
      }
      // 📚 침해사고 히스토리(2026-09-03) — 인자를 말에서 뽑는다.
      if (f.tool === "delete_incident_case") {
        // 번호(ic-16자리 16진수, incidentcases ID_RE)가 없으면 강제하지 않는다 — 빈 결재판 대신 모델이 되묻는다.
        const id = /\b(ic-[0-9a-f]{16})\b/i.exec(instruction)?.[1];
        if (!id) continue;
        return { tool: f.tool, args: { id: id.toLowerCase() } };
      }
      if (f.tool === "incident_sources") {
        // 갈래(유튜브·국내·사이트)는 handlers.runIncidentSources 한 곳이 말에서 읽는다 — 두 곳에서 가르면 어긋난다.
        return { tool: f.tool, args: { kind: instruction } };
      }
      if (f.tool === "incident_cases") {
        // CVE는 hybridsearch CODE_RE 한 곳으로 뽑는다(대문자) — 있으면 그 CVE가 걸린 사례만(규칙 정확 일치).
        const cve = extractLexicalTerms(instruction).codes.find((c) => c.startsWith("CVE-")) ?? "";
        if (cve) return { tool: f.tool, args: { cve } };
        const 주제 = 사례주제어(instruction);
        return { tool: f.tool, args: 주제 ? { q: 주제 } : {} };
      }
      return { tool: f.tool, args: f.args, ...(f.argsByModel ? { argsByModel: true as const } : {}) };
    }
  }

  // ★★ 제목으로 문서를 콕 집었는가 — **배열 뒤, return null 바로 앞**(2026-09-08).
  //   ⚠ **자리가 이 규칙의 절반이다.** 앞머리에 두면 「랜섬웨어 대응」·「침해사고 대응절차」처럼
  //     제목 토큰이 그대로 들어맞는 물음이 FORCED 134개와 침해·장애 특수경로를 통째로 뺏는다
  //     (설계관 정정의 핵심 근거 — 실측에서 실제로 뺏었다). 꼬리에 두면 preempt가 0이고,
  //     증상 ②가 새던 자리(⑨ 모델 선택) **바로 앞**만 정확히 막는다.
  //   ⚠ 배열을 안 건드리므로 routes-renumber는 필요 없다(routes.test는 FORCED_INTENTS[n] 행만 센다).
  //   왜 필요한가(2026-09-08 라이브 재현): 「금융 취약점 평가기준 항목 알려줘」가 아무 규칙에도
  //     안 걸려 ⑨ 모델 선택으로 떨어졌고, 모델이 compliance_status를 골라 **KISA 위협 카탈로그**
  //     (S01 데이터 포이즈닝…)를 「평가기준 항목」이라며 답했다. 지목한 문서와 아무 상관이 없다.
  //     ⚠ 이것은 compliance_status 규칙을 좁혀서는 못 고친다 — route-explain 실측이 「걸리는 규칙
  //       없음」이었다. 규칙이 채 간 게 아니라 **아무 규칙도 없어서** 모델 재량이 답했다.
  //   ⚠ **데이터에 달린 갈래다**(문서 목록을 조회한다) — `데이터의존`을 붙여 route-explain이
  //     빈 DB에서 「걸리는 규칙 없음」이라 단정하지 않게 한다(검토관 [중] · 결정적도착지의 조건부).
  if (available.has("explain") && 제목지목질문(instruction)) {
    return { tool: "explain", args: { topic: instruction }, 데이터의존: true };
  }
  return null;
}

/**
 * 「랜섬웨어 사고 사례 알려줘」의 **랜섬웨어** — 사례 앵커(사고 사례·침해사고 히스토리·비슷한 사례) 바로 앞의 낱말 하나(조사는 뗀다).
 * 없거나 꾸밈말(실제·과거·국내·다른…)이면 빈 문자열 → 전체 목록. 낱말 둘 이상(「병원 해킹 사고 사례」)은 앞 낱말을 버리고
 * 앵커에 붙은 낱말만 보는데 그것이 꾸밈말(해킹)이면 역시 빈 문자열이다 — listIncidentCases의 q는 **통째로 LIKE**라 여러
 * 낱말을 이어 넘기면 0건이 되기 때문(없는 것을 있다고도, 있는 것을 없다고도 하지 않는 쪽으로 기운다).
 */
export function 사례주제어(instruction: string): string {
  const m = /([A-Za-z0-9가-힣][A-Za-z0-9가-힣.\-]{1,29}?)(?:로|으로|과|와|랑|이랑|의|에서|에)?\s+(?:관련\s+)?(?:(?:침해\s*사고|침해|해킹|사고)\s*(?:히스토리|사례)|(?:비슷한|유사한?)\s*(?:사고\s*)?사례)/.exec(instruction);
  const 낱말 = m?.[1]?.trim() ?? "";
  if (!낱말 || 낱말.length < 2) return "";
  if (/^(실제|과거|최근|국내|해외|다른|이런|그런|저런|비슷|유사|관련|우리|전체|모든|어떤|무슨|보안|침해|해킹|사고|사례|히스토리|등록된|기존|있는|참고)$/.test(낱말)) return "";
  return 낱말;
}

/**
 * 도구는 정해졌고 **인자만** 모델이 뽑는다(FORCED_INTENTS의 argsByModel 규칙용, 2026-09-03).
 * 결정 프롬프트(도구 고르기)를 다시 돌리지 않는다 — 그 도구 하나의 칸 목록만 주고 JSON으로 받는다.
 * 실패(모델 없음·형식 불가)는 빈 인자 — 결재판이 칸을 되묻는다. 값은 전부 문자열로 맞추고 선언에 없는 칸은 버린다
 * (validateToolArgs가 「인자 오류」로 도구를 통째로 죽이는 함정 회피 — 범위를입힌다와 같은 이유).
 */
export async function extractToolArgsByModel(tool: AgentTool, instruction: string, deps?: { chat?: typeof chat }): Promise<Record<string, string>> {
  const 칸 = tool.params.map((p) => `- ${p.name}: ${p.label}${p.required ? "(필수)" : ""} — ${p.description}`);
  // 키는 영문(스키마 강제 디코딩 관례) — 도구 선언의 param 이름 그대로.
  const schema = { type: "object", properties: Object.fromEntries(tool.params.map((p) => [p.name, { type: "string" }])) };
  try {
    const raw = await (deps?.chat ?? chat)({
      agentId: "orchestrator",
      // ⚠ trusted — 도구 칸 목록이 실린 **우리 프롬프트**다. 사용자 지시는 dispatcher가 이미 검사했다(decisionPrompt와 같은 이유).
      trusted: true,
      responseSchema: schema,
      maxTokens: 900,
      message: [
        `너는 GIJO AS 보안 플랫폼의 오케스트레이터다. 아래 사용자 지시에서 「${tool.label}」 도구의 인자만 뽑아 JSON 객체 하나로 출력한다.`,
        "규칙: 지시에 적힌 내용만 옮긴다 — 없는 값은 칸을 비우거나 빼고, 지어내지 않는다. 값은 모두 문자열로 쓴다. 여러 개는 쉼표로 잇는다.",
        "인자:",
        ...칸,
        "",
        `사용자 지시: "${instruction}"`,
      ].join("\n"),
    });
    const o = JSON.parse(String(raw ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "")) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const 받는것 = new Set(tool.params.map((p) => p.name));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (!받는것.has(k) || v == null) continue;
      const s = (Array.isArray(v) ? v.map((x) => String(x)).join(", ") : String(v)).trim();
      if (s) out[k] = s;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 문장이 등록된 자산 **하나**를 지목하면 그 id를 준다 (2026-08-09 2단계).
 * 표시 이름·원래 이름·id 어느 글자로 불러도 잡는다 — 담당자가 보는 글자는 표시 이름이고,
 * 선택 치환이 박는 글자도 표시 이름이다. 둘 이상 걸리면 빈 문자열(모호 — 좁히지 않는다).
 * ⚠ 토큰은 공백 없는 id만 쓴다 — 필터가 공백으로 토큰을 가르기 때문(필터에맞나).
 */
export function 지목된자산아이디(instruction: string): string {
  const 문장 = instruction.toLowerCase();
  const 걸림 = new Set<string>();
  for (const a of listAssets()) {
    const 이름들 = [(a as { displayName?: string }).displayName, a.name, a.id].filter(
      (n): n is string => typeof n === "string" && n.trim().length >= 2,
    );
    if (이름들.some((n) => 문장.includes(n.toLowerCase()))) 걸림.add(a.id);
    if (걸림.size > 1) return "";
  }
  const [단하나] = [...걸림];
  return 단하나 && !/\s/.test(단하나) ? 단하나 : "";
}

/**
 * 온톨로지 도구가 답할 질문인가 — **연결·매핑·관계**를 물을 때만 참.
 * "리눅스 SSH root 원격 로그인 차단은 KISA 어떤 점검항목이야?"처럼 항목 자체를 묻는
 * 질문은 거짓 — 그건 RAG(지식 검색)의 영토다. LLM이 온톨로지를 잘못 골라도
 * 이 판별이 코드로 되돌린다(runAgentLoop의 거부 분기).
 */
export function isRelationQuestion(instruction: string): boolean {
  return /온톨로지|지식\s*그래프|트리플|연결|매핑|관계|이어져|이어진/.test(instruction);
}

/**
 * "Log4Shell 완화 방법을 온톨로지에서 찾아줘" → "Log4Shell 완화 방법"
 * 온톨로지·지식그래프라는 말 자체와 지시 어미를 걷어 낸 나머지가 검색어다.
 */
export function ontologyQueryOf(instruction: string): string {
  const q = instruction
    .replace(/온톨로지|지식\s*그래프|트리플/g, " ")
    // "뭐 들어있어?" 같은 되묻기 말은 검색어가 아니라 **현황 질문**이다 — 걷어 내면 빈 문자열이
    // 되어 강제 분기가 물러나고, 그런 질문은 LLM이 knowledge_status로 보낸다.
    .replace(/뭐|무엇|어떤\s*것|들어\s*있|들어|있어|있나|있는지|내용/g, " ")
    .replace(/에서|에|을|를|좀|한번|찾아|검색|조회|보여|알려|해|줘|주세요|봐|봐줘|줄래|해줘|하기|\?|!|\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return q.length >= 2 ? q.slice(0, 60) : "";
}

// 자동화 작업 원장 기록(계획서 중-2). 매핑에 없는 도구는 세지 않고, 평가 게이트·QA 실행은
// scope.qa로 걸러 아예 담지 않는다 — 시험이 고객의 절감 숫자를 만들면 안 된다.
function recordToolWork(toolName: string, scope?: ToolScope): void {
  const kind = TOOL_WORK_KIND[toolName];
  if (!kind) return;
  recordWork({ kind, detail: toolName, actor: scope?.actor ?? null, source: "chat", qa: scope?.qa });
}

/**
 * 🗂 지금 범위를 도구 인자에 **코드로** 입힌다(승인 시안 mockups/자산_0단계, 2026-08-18).
 *
 * ⚠ 프롬프트로 시키지 않는 이유 — 「7B에 규칙을 더해 행동을 교정하려 하지 말 것」은 이 저장소가
 *   반복해 확인한 것이다. "이 자산만 보라"고 적어 두면 지킬 때도 있고 아닐 때도 있다.
 * ⚠ **모델이 이미 자산을 지정했으면 건드리지 않는다.** 담당자가 문장 안에서 다른 자산을
 *   말했을 수 있고(「범위는 web-01인데 db-02는 어때?」), 그때 범위가 덮으면 사람 말을
 *   화면 상태가 조용히 이기는 셈이 된다 — 그건 이 저장소가 경계하는 바로 그 사고다.
 * ⚠ 자산 인자를 받지 않는 도구(문서 검색·법령 등)에는 아무것도 안 한다. 없는 인자를 넣으면
 *   `validateToolArgs`가 「인자 오류」를 내고 도구가 통째로 죽는다.
 */
function 범위를입힌다(args: Record<string, string>, tool: AgentTool | undefined, scope?: ToolScope): Record<string, string> {
  const 자산 = scope?.범위자산;
  if (!자산 || !tool) return args;
  // 이 도구가 실제로 받는 인자 이름만 본다 — 선언에 없는 이름을 넣으면 검증이 막는다.
  const 받는것 = new Set(tool.params.map((p) => p.name));
  for (const 이름 of ["assetId", "asset", "host"]) {
    if (!받는것.has(이름)) continue;
    const 이미 = String(args[이름] ?? "").trim();
    if (이미) return args;            // 사람 말이 먼저다 — 덮지 않는다
    return { ...args, [이름]: 자산 };
  }
  return args;
}

/**
 * 루프를 돌리고, **도구가 읽은 근거**를 함께 실어 돌려준다(2026-09-08 · toolevidence.ts).
 *
 * ⚠ 감싸는 자리가 여기 하나여야 한다 — 루프 본체는 return 자리가 열 곳이 넘어서, 갈래마다
 *   근거를 붙이면 반드시 하나를 빠뜨린다(「배관이 다 살아 있어도 갈래 하나를 빠뜨리면
 *   아무 일도 안 일어난다」 — 바로 아래 강제 경로 주석이 같은 사고를 적어 두었다).
 */
export async function runAgentLoop(instruction: string, context = "", scope?: ToolScope): Promise<AgentLoopResult | null> {
  const 그릇 = 새근거수거();
  const r = await 근거를수거하며(그릇, () => runAgentLoopCore(instruction, context, scope));
  if (!r || !그릇.값) return r;
  const { sources, 근거세기, quotes } = 그릇.값;
  return { ...r, sources, 근거세기, ...(quotes?.length ? { quotes } : {}) };
}

async function runAgentLoopCore(instruction: string, context = "", scope?: ToolScope): Promise<AgentLoopResult | null> {
  // 범위를 적용한 뒤 쓸 도구가 하나도 없으면 루프를 돌 이유가 없다(호출자가 채팅으로 폴백).
  if (listToolsFor(scope?.domains, scope?.role).length === 0) return null;

  // 대표 문구는 LLM 결정을 건너뛰고 곧장 그 도구를 실행한다 — 흔들림 없이 항상 답한다.
  const forced = forcedToolFor(instruction, scope);
  if (forced) {
    const tool = findAgentTool(forced.tool);
    // ⚠ **쓰기 도구는 강제로 실행하지 않는다** — 그건 사람 확인 없이 상태를 바꾸는 일이다.
    //   대신 **결재판을 띄운다**: 무엇을 할지 보여주고 빈 칸을 되묻는 것까지가 결재판 몫이다.
    //   실측(2026-08-03 서랍 점검): "새 자산 등록할게"가 여기서 조용히 빠져나가
    //   LLM에게 갔고, **Tenable Security Center 로그인 → Explore > Assets** 남의 제품
    //   매뉴얼 절차를 답했다. 도구도 규칙도 있는데 **실행 문턱에서 새고 있었다.**
    if (tool?.write) {
      // 📚 argsByModel(2026-09-03) — 도구는 못 박고 **인자만** 모델이 뽑는다(FORCED_INTENTS 머리글). 모델이 죽거나 형식이
      //   깨지면 빈 인자로 결재판이 뜬다(칸을 되묻는다) — 강제 경로가 조용히 새는 일은 없다(forced-write-approval 계약 그대로).
      if (forced.argsByModel) reportProgress("understand", `${tool.label} — 지시에서 칸을 뽑고 있습니다`);
      const 인자 = forced.argsByModel ? await extractToolArgsByModel(tool, instruction) : forced.args;
      reportProgress("review", `${tool.label} — 확인을 받습니다`);
      return {
        output: `${말조사(tool.label, "을")} 진행합니다 — 아래 내용을 확인하고 승인해 주세요.`,
        toolCalls: [],
        approval: buildApproval(tool, 인자, instruction, ""),
      };
    }
    if (tool && !tool.write) {
      try {
        reportProgress("tools", `${tool.label} 실행 중`);
        // 🗂 범위는 **이 빠른 길에도** 입혀야 한다(2026-08-18 실측). 강제 규칙 경로는 LLM 결정을
        // 건너뛰므로 아래 일반 루프의 주입이 안 온다 — 범위를 걸어 놓고 물었는데 전체가 왔다.
        // 배관이 다 살아 있어도 **갈래 하나를 빠뜨리면 아무 일도 안 일어난다.**
        const 강제인자 = 범위를입힌다(forced.args, tool, scope);
        const result = String(await tool.run(강제인자));
        recordToolWork(forced.tool, scope);
        const calls: AgentToolCall[] = [{ tool: forced.tool, args: 강제인자, result }];
        return { output: await 사람에게내보낸다(instruction, calls, context), toolCalls: calls };
      } catch {
        /* 강제 실행 실패 시 아래 일반 루프로 폴백 */
      }
    }
  }

  // 골드 few-shot(파인튜닝 대체) — 시드+승인 골드에서 유사 예시 2~3건을 첫 결정에만 주입한다.
  // (2번째 스텝부터는 도구 결과 history가 이미 근거라 안 붙인다 — 프롬프트 길이 절약.)
  // 좁힌 카탈로그에 없는 도구 예시는 제외(없는 도구 호출 유도 방지). 동적 import는 순환 회피
  // (orchestrator-dataset이 buildDecisionPrompt를 import한다).
  const allowedTools = new Set(listToolsFor(scope?.domains, scope?.role).map((t) => t.name));
  const fewshot = await import("./orchestrator-dataset.js")
    .then((m) => m.fewshotBlockFor(instruction, allowedTools))
    .catch(() => "");

  const calls: AgentToolCall[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    // 결정 프롬프트도 느리다(실측 5.8초) — 침묵 구간이 되지 않게 지금 뭘 하는지 알린다.
    reportProgress("understand", calls.length === 0 ? "무엇을 할지 정하고 있습니다" : "다음 단계를 정하고 있습니다");
    const raw = await chat({
      agentId: "orchestrator",
      message: decisionPrompt(instruction, calls, context, scope, calls.length === 0 ? fewshot : ""),
      responseSchema: DECISION_SCHEMA,
      maxTokens: 300,
      // ⚠ trusted — 이 message는 **도구 카탈로그가 실린 우리 결정 프롬프트**다. 사용자 지시는
      //   dispatcher가 이미 검사했다. 안 켜면 우리 프롬프트가 검사 대상이 되는데, 도구 설명에
      //   "탈옥·프롬프트 주입" 같은 보안 낱말이 들어 있어 **우리 규칙에 우리가 걸린다**.
      //   flag 모드에서는 로그만 쌓여 보이지 않았고, 차단 모드에서 제품이 죽었다(2026-07-30).
      trusted: true,
    }).catch(() => "");
    const decision = parseDecision(raw);
    if (!decision) return null; // LLM 다운·형식 불가 → 기존 채팅 폴백

    if (decision.action === "final") {
      if (calls.length === 0) return null; // 도구가 필요 없는 일반 대화 → 기존 채팅(RAG·이력)이 더 낫다
      return { output: await 사람에게내보낸다(instruction, calls, context), toolCalls: calls };
    }

    // action=tool — 규칙 검증이 LLM 출력 뒤에 항상 위치한다(QA 원칙).
    const tool = decision.tool ? findAgentTool(decision.tool) : undefined;
    const args = 범위를입힌다(decision.args ?? {}, tool, scope);

    // 같은 조회 도구를 같은 인자로 되풀이하면(실측: today를 5회 반복) 재실행은 같은 결과라 낭비다.
    // 이미 실행한 (도구+인자)면 재실행 없이 루프를 끝내 지금까지의 결과로 최종 답을 만든다.
    // 쓰기 도구는 해당 없음(결재판을 돌려주고 즉시 종료하므로 calls에 쌓이지 않는다).
    if (tool && !tool.write) {
      const sig = `${decision.tool}:${JSON.stringify(args)}`;
      if (calls.some((c) => `${c.tool}:${JSON.stringify(c.args)}` === sig)) break;
    }

    let result: string;
    if (!tool) {
      result = `존재하지 않는 도구: ${decision.tool ?? "(없음)"}. 사용 가능한 도구 중에서만 골라라.`;
    } else if (tool.name === "run_hardening_scan" && isHowtoNotCommand(instruction)) {
      // LLM이 스스로 점검 도구를 골라도 방법 질문이면 실행을 막는다(2026-07-29 시연 실측).
      // 첫 수라면 루프를 접고 지식(RAG·채팅)으로 넘긴다 — 그쪽이 방법 설명을 잘한다.
      if (calls.length === 0) return null;
      result = "이 지시는 점검 '방법'을 묻는 질문이라 점검을 실행하지 않았다. 아는 지식으로 절차를 설명하라.";
    } else if (
      tool.name === "verify_finding" &&
      지목없는검증대상(instruction, args.assetId, {
        대화: scope?.대화,
        범위자산: scope?.범위자산,
        // 앞선 조회 결과도 근거다 — 「자산 목록 보고 → 그 자산 검증」을 막으면 안 된다.
        앞선결과: calls.map((c) => c.result).join("\n"),
      })
    ) {
      // 모델이 자산을 **지어냈다**(도구 설명의 예문 web-01 등). 장비에 접속하는 실행 도구라
      // 짐작으로 부르면 엉뚱한 장비를 건드린다 — 부르지 않고 되묻는다(2026-09-06 야간 회귀 ⑬).
      // ⚠ 되묻기 표지가 붙어 있어 이 답은 모델 재작성을 거치지 않고 그대로 나간다.
      // ★ **여기서 끝낸다**(2026-09-07 검토관 적발) — 되묻기는 이미 끝난 답이다.
      //   ① 한 수 더 돌면, 앞선 도구가 하나라도 있을 때 directAnswerFor가 `calls.length !== 1`에서
      //      먼저 빠져나가 되묻는 말이 **재작성 경로**를 탄다 — 「다시 지목」이 「다시 지정」으로
      //      다시 쓰이는, ⓑ가 막으려던 바로 그 사고가 다중 호출 회차에서만 되살아난다.
      //   ② calls에 verify_finding을 쌓으면 nextguide가 **마지막 도구 이름**으로 후속 칩을 정해
      //      검증을 한 줄도 안 한 답에 「이거 조치완료 처리해줘」가 붙는다(가리킬 「이거」도 없다).
      //   그래서 도구를 calls에 담지 않고 결정적 문구를 그대로 내보낸다.
      return { output: await 사람에게내보낸다(instruction, calls, context, { 즉답: 검증대상되물음(), 그대로: true }), toolCalls: calls };
    } else if (tool.name === "ontology_query" && !isRelationQuestion(instruction)) {
      // "○○은 KISA 어떤 점검항목이야?" 같은 **정의·해당 항목 질문**에 LLM이 온톨로지를 고르면
      // 트리플에 그 서술이 없어 "연결을 찾지 못했다"가 답이 된다 — RAG가 1순위로 근거를 들고
      // 있는데도(2026-08-08 kisa-u01 회귀 2연속 실측). 도구 설명("연결·매핑을 물을 때만")은
      // 7B/14B가 흘려듣는다 — 프롬프트가 아니라 코드로 막는다(확립 원칙).
      if (calls.length === 0) return null; // 지식(RAG·채팅) 폴백 — 그쪽이 근거를 갖고 있다
      result = "이 지시는 연결 관계가 아니라 항목 자체를 묻는 질문이다. 아는 지식으로 답하라.";
    } else if (tool.write) {
      // 쓰기 도구는 여기서 실행하지 않는다 — 값을 결재판으로 만들어 돌려주고, 사람이 승인해야
      // /api/agent/approve에서 실행된다(오발동 방지). 루프는 여기서 끝난다.
      // 지금까지의 조회 결과를 함께 넘긴다 — assetId·finding처럼 앞선 도구 결과에서 복사한 값을
      // 환각(guess)으로 오판해 되묻지 않게 하기 위해서다(근거=지시문 ∪ 조회 결과).
      // #8: 직전 대상(lastTarget)도 그라운딩에 포함한다 — "아까 그거"에서 모델이 채운 assetId·finding이
      // 지시문에 없어도 blank되지 않게(맥락에서 온 근거 있는 값이므로).
      const ctx = recentTarget();
      const toolResults = [calls.map((c) => c.result).join("\n"), ctx ? `직전 대상 자산 ${ctx.assetId} 취약점 ${ctx.finding}` : ""].filter(Boolean).join("\n");
      const approval = buildApproval(tool, args, instruction, toolResults);
      // 방금 다룬 취약점을 기억(후속 "아까 그거"용) — assetId·finding 인자가 있는 도구만.
      // ⚠ autoFill **정정 후** 값(approval.args)으로 — 정정 전 LLM 추정값으로 기억하면
      //   결재판은 옳은 대상인데 「아까 그거」는 엉뚱한 자산을 가리킨다(검토관 6②).
      if (approval.args.assetId && approval.args.finding) setLastTarget(approval.args.assetId, approval.args.finding, tool.label, scope?.대화);
      emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `승인 대기: ${tool.label} — 값 검토 요청` });
      return { output: approvalMessage(approval), toolCalls: calls, approval };
    } else {
      const invalid = validateToolArgs(tool, args);
      if (invalid) {
        result = `인자 오류: ${invalid}`;
      } else {
        emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `도구 실행: ${tool.name}(${JSON.stringify(args)})` });
        // 진행 카드: 도구를 **실명으로** 알린다. 전체 개수는 미리 모르므로 %는 붙이지 않는다(정직 원칙).
        reportProgress("tools", `${tool.label} 실행 중${calls.length > 0 ? ` — ${calls.length + 1}번째 도구` : ""}`);
        try {
          result = String(await tool.run(args));
          recordToolWork(tool.name, scope);
        } catch (err) {
          result = `도구 실행 실패: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
    calls.push({ tool: decision.tool ?? "(없음)", args, result });

    // directAnswer 도구가 성공했고 **조회만 요구한 지시**면 다시 물어보지 않는다 — 그 결과가 곧 답이다.
    // 예전엔 여기서 루프를 한 바퀴 더 돌며 "더 할 일 있나?"를 LLM에 물었는데, 그 한 번이 프롬프트
    // 2,800~4,700토큰을 다시 읽느라 5초 넘게 걸렸다(2026-07-30 실측: 12토큰 생성에 5.8초).
    // 질문 하나가 LLM 호출 3번·14초였고 그중 한 번은 결과를 바꾸지 않는 순수 낭비였다.
    //
    // ⚠ 단, 조회 결과가 **쓰기의 재료**인 흐름은 끊으면 안 된다("오늘 제일 급한 거 김보안한테
    //   배정해줘" → today로 찾고 assign_finding으로 이어간다 — 시험이 이걸 잡았다).
    //   그래서 행동을 요구하는 말투면 종전대로 루프를 계속한다. 못 알아보면 느려질 뿐 틀리지는
    //   않는다 — 안전한 실패 방향으로 기울여 둔다.
    const early = directAnswerFor(calls);
    if (early && !ACTION_INTENT_RE.test(instruction)) {
      // ⚠ 즉답이라도 **출구를 거친다**(2026-08-10). 예전엔 여기서 곧장 나가느라 보강도 딱지도
      //   건너뛰었다 — law_lookup이 directAnswer라 「접속기록 몇 년?」이 정확히 이 길로 샜다.
      return { output: await 사람에게내보낸다(instruction, calls, context, { 즉답: early }), toolCalls: calls };
    }
  }

  // 반복 상한 도달 — 지금까지 모은 결과로라도 답을 만든다(도구를 썼을 때만).
  if (calls.length === 0) return null;
  return { output: await 사람에게내보낸다(instruction, calls, context), toolCalls: calls };
}
