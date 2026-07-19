// engine/llm.ts — LLM 호출 레이어. llama-server(OpenAI 호환 API)에 요청을 보내는 얇은 클라이언트.
// 서버 프로세스 안에서 localengine.ts가 띄운 llama-server를 호출한다 (같은 머신, localhost).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { getAgentById } from "./agents";
import { emitLlmActivity, modelBasename } from "./llmactivity";
import { recordChatLog } from "./learnloop";

const LOCAL_LLM_BASE_URL = process.env.GIJO_LOCAL_LLM_URL ?? "http://localhost:8080/v1";
// 6.2절: 임베딩 모델(BGE-M3 등)은 채팅용 LLM과 별도 llama-server 프로세스로 동시 서빙한다 (RTX 3090 VRAM 여유 활용).
const EMBEDDING_SERVER_URL = process.env.GIJO_EMBEDDING_URL ?? "http://localhost:8081/v1";

export interface ChatArgs {
  agentId: string;
  message: string;
  maxTokens?: number; // 지정 시 응답 길이 상한(데이터셋 변환처럼 긴 JSON 출력이 필요할 때)
  // true면 단기 기억(대화 이력)과 장기 기억(RAG) 자동 주입을 켠다 — 대화형 채팅 라우트 전용.
  // dispatcher/analysis 같은 프로그램적 단발 호출은 기본값(false)으로 이력에 끼어들지 않는다.
  remember?: boolean;
  // 지정 시 llama.cpp json_schema 강제 디코딩 — 출력이 스키마에 맞는 JSON임을 샘플러 수준에서
  // 보장한다(에이전트 루프의 도구 선택 등). 이 경로는 결정 호출이므로 temperature 0으로 고정하고,
  // 인사말 제거·중국어 재생성 후처리를 건너뛴다(JSON을 훼손할 수 있으므로).
  responseSchema?: unknown;
}

// ── 단기 기억: 에이전트별 최근 대화 이력 ─────────────────────────────────────
// 의도적으로 인메모리·휘발성이다(agents.ts의 status와 같은 원칙) — 서버 재시작이면 사라진다.
// 영속 대화방 개념이 생기기 전까지는 에이전트당 하나의 공유 이력이며, 최근 HISTORY_LIMIT개
// 메시지만 유지해 컨텍스트 창을 보호한다.
const HISTORY_LIMIT = 20; // 10턴 (user+assistant 쌍 기준)

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const histories = new Map<string, ChatTurn[]>();

export function resetChatHistoryForTests(): void {
  histories.clear();
}

// ── 장기 기억: LanceDB 지식 베이스 검색 결과를 참고 자료로 주입 ──────────────
// 임베딩 서버가 없거나 지식 베이스가 비어 있으면 조용히 생략한다 — RAG가 안 된다고
// 채팅 자체가 죽으면 안 된다. (memory.ts가 llm.ts의 embed를 쓰므로 순환 참조를 피해
// 호출 시점에 동적 import.)
async function ragContextFor(message: string, agentId: string): Promise<string | null> {
  try {
    const { queryMemory } = await import("./memory.js");
    // 에이전트 전용 지식 + 전역 지식만 검색 (다른 에이전트 전용 문서는 제외).
    const chunks = await queryMemory(message, 4, agentId);

    const parts: string[] = [];
    if (chunks.length > 0) {
      parts.push(
        "참고 자료 — 사내 지식 베이스(장기 기억)에서 검색된 관련 내용입니다. 답변에 활용하되, 질문과 무관하면 무시하세요.\n" +
          chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n")
      );
    }

    // 하이브리드: 온톨로지(지식 그래프)에서 질문·청크에 걸린 엔티티의 관계·규칙을 동반 주입한다.
    // 벡터 검색과 별개 seam이라, 임베딩 서버가 없어 청크가 비어도 규칙은 걸릴 수 있다.
    try {
      const { ontologyContextFor } = await import("./ontology.js");
      const onto = ontologyContextFor(message, chunks, agentId);
      if (onto) parts.push(onto);
    } catch {
      /* 온톨로지가 비어있거나 조회 실패해도 채팅은 계속된다 (RAG와 동일한 방어). */
    }

    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch {
    return null;
  }
}

// 시스템 프롬프트가 아예 없으면 모델이 역할·언어 지시를 전혀 못 받아 주제 이탈·영어 혼용·환각이
// 심해진다(특히 영어 중심 모델). 모든 에이전트 호출에 한국어 기본 처리 + 역할 + 환각 억제를 깐다.
export function systemPromptFor(agentId: string): string {
  const agent = getAgentById(agentId);
  // 사내지식 해설 에이전트(GIJO Agent, id=normaltic): 오직 아래 '참고 자료'(RAG 검색 결과)만 근거로 삼는 엄격 그라운딩.
  // 다른 에이전트와 달리 LLM 자체 지식으로 지어내지 않고, 자료가 없으면 없다고 답한다.
  // 복합 지시 파이프라인에서는 Scan·Analyze 결과를 받아 용어 해설·사례 부연 단계로 자동 투입된다(dispatcher).
  if (agentId === "normaltic") {
    return [
      "당신은 GIJO AS의 사내 지식 해설 담당 보안 AI입니다. 취약점·코드·스캔(분석) 결과가 주어지면 사내 지식베이스(장기 기억)에서 검색된 자료를 근거로 용어를 해설하고 관련 실제 사례를 부연합니다. Scan·Analyze 에이전트 결과에 대한 부연 설명도 당신 담당입니다.",
      "규칙:",
      "- 아래에 붙는 '참고 자료 — 사내 지식 베이스'에 있는 내용만 근거로 삼습니다. 참고 자료가 없거나 질문과 무관하면 지어내지 말고 '등록된 사내 자료에는 관련 내용이 없습니다'라고 먼저 밝힙니다(그 뒤 필요하면 아주 짧은 일반 정의만 덧붙입니다).",
      "- 답변 구성: ① 한두 문장 요약 설명 → ② 관련 실제 사례(참고 자료에서 찾은 것)를 목록으로, 가능하면 출처(문서·카테고리)를 함께 밝힙니다.",
      "- 반드시 한국어로, 인사말·자기소개 없이 본론만 간결하게. 확인되지 않은 내용은 지어내지 않습니다.",
    ].join("\n");
  }
  // 표시 이름(팀 로스터 커스터마이징: "모니터링 재욱" 등)은 화면용이다. 프롬프트엔 이름 대신
  // 역할만 넣는다 — `당신은 "○○"입니다` 형태로 이름을 주면 약한 모델이 매 답변을 자기소개로
  // 시작하기 때문(실측: Mistral 계열 보안모델이 "안녕하세요, 저는 …입니다"로 장황해짐).
  const identity = agent
    ? `당신은 GIJO AS(AI 자산 보안 관리 플랫폼)에서 ${agent.role}를 담당하는 보안 AI입니다.`
    : `당신은 GIJO AS(AI 자산 보안 관리 플랫폼)의 보안 어시스턴트입니다.`;
  return [
    identity,
    "응답 규칙(위에서부터 엄격히 지킬 것):",
    // 서두 금지 — 최상단·최강. gijo(Qwen)가 규칙이 아래에 묻히면 인사말로 시작하므로 맨 위에 배치.
    "- 【첫 문장 규칙 — 최우선】 인사말·서두·예고 없이 곧바로 본론(핵심 내용)으로 시작합니다. 다음으로 시작하면 안 됩니다: '안녕하세요'·'안녕'·'반갑습니다' 같은 인사, '~에 대해 답변/설명/작성하겠습니다'·'~를 알려드리겠습니다'·'맞는 답을 드리겠습니다' 같은 예고, '저는 ○○입니다' 자기소개. 리포트 요청이면 제목이나 핵심 요지 문장부터, 질문이면 답 자체부터 씁니다.",
    "- 실제 인물·가상 담당자 이름이나 페르소나를 만들지 않습니다('보고서 전문 도희' 등 금지).",
    // 언어 강화 — 보안 합성모델(Mistral 계열)의 영어 드리프트, gijo(Qwen)의 중국어 드리프트를 함께 억제.
    "- 출력은 처음부터 끝까지 반드시 한국어로만 작성합니다. 영어·중국어·일본어 문장을 섞지 마세요(코드·명령어·CVE·제품명·버전 등 고유 표기만 원문 유지). 어색한 직역 없이 매끄러운 한글로.",
    // 근거 우선 — GIJO Agent(id=normaltic)만큼 엄격하진 않되, 사내 데이터가 있으면 그것을 우선 근거로 삼도록.
    "- 아래에 '참고 자료 — 사내 지식 베이스'나 '관련 규칙·관계'(온톨로지)가 붙어 있으면 그것을 최우선 근거로 삼고, 가능하면 어떤 자료·규칙에 따랐는지 밝힙니다. 사내 자료에 없어 일반 지식으로 답할 때는 '(일반 지식 기준)'임을 짧게 표시합니다.",
    "- 상대는 기업 보안담당자입니다. 불필요한 미사여구나 서론/결론 없이 간결하고 정확하게 핵심만 답합니다.",
    "- 【반복 금지】 같은 결론·판단을 표현만 바꿔 두 번 이상 말하지 않습니다(예: 본문에서 이미 '먼저 조치해야 한다'고 했다면, 끝에 '결론:'을 또 붙여 같은 말을 반복하지 않습니다). 각 사실·판단은 정확히 한 번만 말하고 끝냅니다.",
    "- 확인되지 않은 사실을 지어내지 않습니다. 모르면 모른다고 답합니다.",
    "- 질문과 직접적인 관계가 없는 내용은 절대 언급하지 말고 완전히 배제하십시오.",
    "- 시니어 보안 전문가의 관점에서, 정확한 용어와 근거(CVE·CVSS·EPSS·KEV·심각도 등)를 들어 서술하되 주어진 데이터 범위 안에서만 판단하고 과장하지 않습니다.",
  ].join("\n");
}

// ── 응답 후처리: 첫머리 인사말·예고 서두 제거(본문 보존) ─────────────────
// LLM이 프롬프트 규칙을 100% 지키지 않아 남는 '안녕하세요 …', '~을 보고드리겠습니다' 같은
// 응답-메타 예고, 자기소개를 서버에서 마지막으로 정리한다. 본문·구조화 출력(상태:/번호목록)은 건드리지 않게
// 보수적으로: (1) 쉼표로 붙은 선행 인사만 제거, (2) 첫 문장이 '인사/자기소개/응답메타 예고'이고 뒤에 본문이
// 남을 때만 그 문장을 제거(최대 2문장).
const GREETING_PREFIX_RE = /^(안녕하세요|안녕히 계세요|안녕|반갑습니다|반가워요|반갑네요|좋은 (아침|오후|하루)(입니다|이에요|예요)?)[\s,·!.]*/;
// 응답-메타(답변/보고/작성 등) + 예고 종결. '즉시 패치를 적용하겠습니다' 같은 실제 조치문은 메타어가 없어 보존됨.
const PREAMBLE_SENTENCE_RE = /(답변|설명|작성|보고|안내|정리|요약|말씀|브리핑|리포트|검토)\S*\s*(을|를|에 대해|에 대한|해)?\s*(드리겠습니다|드릴게요|하겠습니다|할게요|알려드리겠습니다|말씀드리겠습니다|보고드리겠습니다)[.!?]?\s*$/;
const SELF_INTRO_RE = /^(저는|제가|나는)\s.*(입니다|이에요|예요|담당(합니다|입니다)?)[.!?]?\s*$/;
// 모델이 붙인 제목/라벨 한 줄('[제목] …', '# …', '**…**', '제목: …') — 리포트 템플릿이 이미 제목을
// 넣으므로 이 줄을 빼야 그 아래 인사말도 정리된다.
const TITLE_LINE_RE = /^(\[[^\]\n]{1,20}\][^\n]{0,45}|【[^】\n]{1,20}】[^\n]{0,45}|#{1,6}\s[^\n]{1,45}|\*\*[^*\n]{1,45}\*\*|제목\s*[:：][^\n]{1,45})$/;

export function stripLeadingPreamble(text: string): string {
  let t = (text ?? "").trim();
  // 제목/라벨 한 줄 제거(뒤에 본문이 있을 때만) → 그 아래 인사말이 선행으로 노출되게.
  const nlIdx = t.indexOf("\n");
  if (nlIdx > 0) {
    const firstLine = t.slice(0, nlIdx).trim();
    const restLines = t.slice(nlIdx).trim();
    // 문장부호가 있으면 제목이 아니라 실제 문장일 수 있으니 보존.
    if (restLines && !/[.!?。]/.test(firstLine) && TITLE_LINE_RE.test(firstLine)) t = restLines;
  }
  const afterGreet = t.replace(GREETING_PREFIX_RE, "").trim(); // "안녕하세요, 본문" → "본문"
  if (afterGreet) t = afterGreet; // 인사만 있고 뒤 본문이 없으면 원문 유지(빈 응답 방지)
  for (let i = 0; i < 2; i++) {
    const nl = t.indexOf("\n");
    const dot = t.search(/[.!?？。]/);
    const cut = dot >= 0 ? dot + 1 : nl >= 0 ? nl : -1;
    const first = (cut >= 0 ? t.slice(0, cut) : t).trim();
    const rest = cut >= 0 ? t.slice(cut).trim() : "";
    if (!first || !rest) break; // 뒤에 본문이 없으면 보존(전체 삭제 방지)
    if (GREETING_PREFIX_RE.test(first) || SELF_INTRO_RE.test(first) || PREAMBLE_SENTENCE_RE.test(first)) {
      t = rest;
    } else break;
  }
  return t.trim();
}

// 중국어 드리프트 감지 — 2자 이상 연속된 CJK 한자는 중국어 구다(현대 한국어는 한자를 잇달아 쓰지 않음).
// 문장 중간에 섞이면 잘라낼 수 없어 재생성으로 처리한다. 단일 한자(예: 外)는 무시해 오탐을 줄인다.
const countHan = (t: string): number => (t.match(/[一-鿿]/g) || []).length;
const hasChineseDrift = (t: string): boolean => /[一-鿿]{2,}/.test(t);

// 영어 드리프트 감지 — 응답 전체가 영어로 나오는 경우(실측 2026-07-19: 보안 합성모델이
// "취약점 조치 우선순위" 질문에 2512자를 전부 영어로 답함). 중국어와 달리 문자 종류로는
// 못 가른다 — 정상 한국어 답변에도 CVE·제품명·명령어 같은 라틴 문자가 섞이기 때문이다.
// 그래서 '한글 음절 대비 라틴 문자 비율'로 판정한다.
//
// 오탐 방지 장치 두 가지:
//  (1) 코드 블록/인라인 코드는 원문 유지가 정상이므로 측정에서 제외한다.
//  (2) 임계치를 아주 낮게(25%) 잡는다 — 고유명사가 많은 한국어 답변도 실측상 50% 이상이라
//      여유가 크다. 전면 영어 응답은 한글이 0~5%라 이 사이에 명확한 골짜기가 있다.
//  (3) 글자 수가 적으면(짧은 확인 응답·코드 한 줄) 비율이 요동치므로 아예 판정하지 않는다.
const CODE_SPAN_RE = /```[\s\S]*?```|`[^`\n]*`/g;
const HANGUL_RATIO_THRESHOLD = 0.25;
const DRIFT_MIN_LETTERS = 60;

/** 코드 구간을 뺀 본문에서 한글 음절이 (한글+라틴) 글자 중 차지하는 비율. 글자가 없으면 1(정상 취급). */
export function hangulRatio(text: string): number {
  const t = (text ?? "").replace(CODE_SPAN_RE, " ");
  const hangul = (t.match(/[가-힣]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return hangul + latin === 0 ? 1 : hangul / (hangul + latin);
}

export function hasEnglishDrift(text: string): boolean {
  const t = (text ?? "").replace(CODE_SPAN_RE, " ");
  const letters = (t.match(/[가-힣]/g) || []).length + (t.match(/[A-Za-z]/g) || []).length;
  if (letters < DRIFT_MIN_LETTERS) return false; // 표본이 너무 작아 판정 불가
  return hangulRatio(text) < HANGUL_RATIO_THRESHOLD;
}

// 중국어 드리프트 근본 차단 — llama.cpp GBNF 문법으로 생성 단계에서 한자(U+4E00–U+9FFF)를 금지한다.
// 프롬프트 규칙(확률적)·후처리 재생성(사후적)과 달리 샘플러 수준의 결정적 차단이라 드리프트가 0이 된다.
// merge 재합성은 실측(2026-07-17)에서 효과 없음이 증명돼 이 방식을 채택. 한글(U+AC00–)은 별개 영역이라 무영향.
// llama.cpp 외 서버가 grammar 필드를 모르면 무시되며, 그 경우 아래 hasChineseDrift 재생성이 백스톱으로 남는다.
const NO_HAN_GRAMMAR = "root ::= [^\\u4e00-\\u9fff]*";

// 로컬 LLM/임베딩 응답 상한 — GPU가 학습·병렬 에이전트 작업에 잡혀 있으면 요청이 무한 대기할 수
// 있다(실측 2026-07-17: 채팅 5분 행 후 실패). 상한을 두고 정직한 지연 안내로 떨어뜨린다.
const LLM_TIMEOUT_MS = Number(process.env.GIJO_LLM_TIMEOUT_MS ?? 120_000);

export async function chat(args: ChatArgs): Promise<string> {
  const history = args.remember ? (histories.get(args.agentId) ?? []) : [];
  const rag = args.remember ? await ragContextFor(args.message, args.agentId) : null;

  // RAG 참고자료는 별도 system 메시지가 아니라 시스템 프롬프트에 합친다 — Mistral 계열
  // (Lily 포함) 채팅 템플릿은 system 메시지 2개를 "roles must alternate" 에러로 거부한다.
  //
  // 구조화 결정 호출(responseSchema)은 대화용 페르소나를 상속하지 않는다. systemPromptFor는
  // "인사말 없이 산문으로 간결하게 답하라" 같은 *서술* 규칙이라, 도구 선택 JSON을 내야 하는
  // 결정 호출과 충돌한다 — 실측(2026-07-17): 도구가 6개로 늘어 사용자 메시지가 길어지자 모델이
  // 페르소나 쪽으로 기울어 register_asset을 안 부르고 산문으로 답했다(같은 모델에 페르소나 없이
  // 직접 물으면 3/3 정확). 결정 호출의 규칙은 호출자 메시지에 이미 다 들어 있다.
  const systemContent = args.responseSchema
    ? "너는 지시를 읽고 도구를 고르는 분류기다. 설명·인사 없이 요청된 JSON 객체 하나만 출력한다."
    : rag
      ? `${systemPromptFor(args.agentId)}\n\n${rag}`
      : systemPromptFor(args.agentId);
  const messages = [{ role: "system", content: systemContent }, ...history, { role: "user", content: args.message }];

  // 실시간 스트림용: 어느 에이전트가 지금 로컬 LLM으로 추론하는지 눈에 보이게 한다.
  const agentName = getAgentById(args.agentId)?.name ?? args.agentId ?? "에이전트";
  const started = Date.now();

  // 멀티모델 풀: 에이전트에 할당된 모델을 (필요하면 로드하고) 그 모델이 서빙되는 URL을 받는다.
  // 이렇게 해야 서로 다른 모델을 쓰는 에이전트들이 스왑 없이 각자 포트에서 병렬로 답한다.
  // (순환참조 회피 위해 동적 import. localengine을 못 불러오면 기본 URL로 폴백.)
  const baseUrl = await import("./localengine.js")
    .then((m) => m.ensureAgentModel(args.agentId))
    .catch(() => LOCAL_LLM_BASE_URL);

  emitLlmActivity({ kind: "chat", phase: "start", agent: agentName, detail: "추론 요청" });

  // json_schema와 grammar는 llama.cpp에서 동시에 못 쓴다 — 스키마 강제 시 스키마가 우선.
  const constrained = args.responseSchema
    ? { json_schema: args.responseSchema, temperature: 0 }
    : { grammar: NO_HAN_GRAMMAR };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", messages, ...constrained, ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}) }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  }).catch((err: unknown) => ((err as Error)?.name === "TimeoutError" ? ("timeout" as const) : null));

  if (res === "timeout") {
    // GPU가 학습·병렬 작업에 잡혀 요청이 무한 대기하는 것을 상한으로 끊는다(실측: 채팅 5분 행).
    emitLlmActivity({ kind: "chat", phase: "error", agent: agentName, detail: `응답 시간 초과(${Math.round(LLM_TIMEOUT_MS / 1000)}s)` });
    return `⚠ 로컬 LLM 응답이 제한 시간(${Math.round(LLM_TIMEOUT_MS / 1000)}초)을 초과했습니다. GPU가 학습이나 다른 작업을 처리 중일 수 있습니다 — 잠시 후 다시 시도하세요.`;
  }

  if (!res || !res.ok) {
    emitLlmActivity({ kind: "chat", phase: "error", agent: agentName, detail: "로컬 LLM 연결 실패" });
    // 최종 사용자용 안내(개발자용 원인 대신). 두 경로를 함께 제시한다:
    // ① 이 PC에서 완결 — '추천 LLM 가이드'에서 모델 내려받아 로드  ② 사내 GPU 서버에 연결 — 설정에서 서버 주소 입력.
    return "⚠ AI 모델이 아직 준비되지 않았습니다. 다음 중 하나로 해결하세요 — ① 상단 '추천 LLM 가이드'에서 모델을 내려받아 로드(에이전트 AI 화면), 또는 ② 설정에서 모델이 있는 사내 GPU 서버 주소를 입력해 연결.";
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    timings?: { predicted_per_second?: number };
  };
  const rawContent = data.choices?.[0]?.message?.content ?? "";

  // 스키마 강제 응답은 JSON 그대로 반환 — 후처리(서두 제거·중국어 재생성)가 JSON을 훼손하면 안 된다.
  if (args.responseSchema) {
    emitLlmActivity({
      kind: "chat",
      phase: "done",
      agent: agentName,
      model: modelBasename(data.model),
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - started,
      detail: "구조화 응답 완료",
    });
    return rawContent.trim();
  }

  let reply = stripLeadingPreamble(rawContent);

  // 언어 드리프트(중국어 혼입 / 전면 영어) 감지 시 한국어 강제로 1회 재생성하고 더 나은 쪽을 채택한다.
  // (인사말과 달리 잘라낼 수 없으므로 재요청. 드리프트는 소수 질문에서만 나므로 대부분 재생성 안 함.)
  // 두 드리프트가 겹쳐도 재생성은 한 번만 한다 — 중국어 혼입이 더 좁고 확실한 신호라 우선.
  const drift = hasChineseDrift(reply)
    ? {
        detail: "중국어 감지 — 한국어로 재생성",
        instruction:
          "직전 답변에 중국어(汉字)가 섞였습니다. 같은 내용을 처음부터 끝까지 반드시 한국어로만 다시 작성하세요. 중국어·한자 단어를 절대 쓰지 마세요(CVE·제품명·버전 등 고유 표기만 원문 유지).",
        // 한자가 더 적은 쪽이 더 나은 답.
        isBetter: (candidate: string, current: string) => countHan(candidate) < countHan(current),
      }
    : hasEnglishDrift(reply)
      ? {
          detail: "영어 감지 — 한국어로 재생성",
          instruction:
            "직전 답변이 영어로 작성되었습니다. 같은 내용을 처음부터 끝까지 반드시 한국어로만 다시 작성하세요. 영어 문장을 쓰지 마세요(코드·명령어·CVE·제품명·버전 등 고유 표기만 원문 유지).",
          // 한글 비율이 더 높은 쪽이 더 나은 답.
          isBetter: (candidate: string, current: string) => hangulRatio(candidate) > hangulRatio(current),
        }
      : null;

  if (drift) {
    emitLlmActivity({ kind: "chat", phase: "start", agent: agentName, detail: drift.detail });
    const retryMessages = [...messages, { role: "assistant", content: rawContent }, { role: "user", content: drift.instruction }];
    const retryRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "local", messages: retryMessages, grammar: NO_HAN_GRAMMAR, ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}) }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }).catch(() => null); // 재작성 실패·시간 초과면 원래 답을 그대로 쓴다
    if (retryRes && retryRes.ok) {
      const retryData = (await retryRes.json()) as { choices?: { message?: { content?: string } }[] };
      const retryReply = stripLeadingPreamble(retryData.choices?.[0]?.message?.content ?? "");
      if (retryReply && drift.isBetter(retryReply, reply)) reply = retryReply;
    }
  }

  // llama.cpp 실측치(usage·timings)를 그대로 실어 보낸다 — 값이 나오면 실제 추론이 일어난 것.
  emitLlmActivity({
    kind: "chat",
    phase: "done",
    agent: agentName,
    model: modelBasename(data.model),
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    tokensPerSec: data.timings?.predicted_per_second ? Math.round(data.timings.predicted_per_second) : undefined,
    latencyMs: Date.now() - started,
    detail: "응답 완료",
  });

  if (args.remember && reply) {
    const updated = [...history, { role: "user" as const, content: args.message }, { role: "assistant" as const, content: reply }];
    histories.set(args.agentId, updated.slice(-HISTORY_LIMIT));
    // 헤르메스 학습 루프 ① 수집: 실제 대화만 영속 저장한다(연결 실패 문자열은 위에서 조기 반환돼
    // 여기 못 온다). recordChatLog는 내부 try/catch — 수집 실패가 채팅을 죽이지 않는다.
    recordChatLog(args.agentId, args.message, reply);
  }
  return reply;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const started = Date.now();
  // OpenAI 호환 경로(/v1/embeddings)를 쓴다. 최신 llama.cpp의 네이티브 /embeddings는
  // {data:[...]} 가 아니라 [{index,embedding:[[...]]}] 형태(중첩 배열)를 돌려줘 파싱이 깨진다.
  const res = await fetch(`${EMBEDDING_SERVER_URL}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", input: texts }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS), // 임베딩도 무한 대기 방지(시간 초과 시 아래 연결 실패 처리)
  }).catch(() => null);

  if (!res || !res.ok) {
    emitLlmActivity({ kind: "embed", phase: "error", model: "임베딩", detail: "임베딩 서버 연결 실패" });
    throw new Error(
      "임베딩 서버에 연결할 수 없습니다. 별도 llama-server를 --embedding 플래그로 " + EMBEDDING_SERVER_URL + " 에 기동하세요."
    );
  }
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  if (!data.data) throw new Error("임베딩 서버 응답 형식이 올바르지 않습니다.");
  // 장기 기억 검색·수집 때 임베딩이 실제로 도는 것도 보이게 한다(추론 파이프라인의 일부).
  emitLlmActivity({
    kind: "embed",
    phase: "done",
    model: "임베딩 서버",
    detail: `${texts.length}개 임베딩`,
    latencyMs: Date.now() - started,
  });
  return data.data.map((d) => d.embedding);
}

export function registerLlmRoutes(app: Express): void {
  app.post(
    "/api/llm/chat",
    authMiddleware,
    asyncRoute(async (req, res) => {
      // 모델 라우팅(에이전트 할당 모델 로드·URL 선택)은 chat() 안에서 처리한다.
      // 대화형 라우트는 단기 기억(이력) + 장기 기억(RAG) 주입을 켠다.
      res.json({ reply: await chat({ ...req.body, remember: true }) });
    })
  );
}
