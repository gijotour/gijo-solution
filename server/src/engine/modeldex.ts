// engine/modeldex.ts — 보안 특화 LLM 도감 (보안 LLM 합성 화면용)
//
// aicitybuilders.com/dex처럼 HuggingFace 공개 모델을 카탈로그로 보여주되, 범용이 아니라
// "보안 특화 LLM"만 큐레이션한다. 각 모델의 base 아키텍처가 같아야 SLERP 등으로 합성 가능하므로
// arch를 함께 제공한다(합성 호환 그룹핑용). 실재하는 모델만 담는다(HF에서 확인).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";

export interface DexModel {
  id: string; // HuggingFace repo id
  name: string;
  base: string;
  arch: "mistral" | "llama" | "qwen2" | "other";
  size: string;
  focus: string; // 특화 분야
  note?: string;
  lang: "영어" | "중국어" | "다국어";
}

// 검증된 보안 특화 LLM 큐레이션 (HF에서 존재·base 확인, 2026-07). 합성은 arch가 같은 것끼리.
export const SECURITY_LLM_DEX: DexModel[] = [
  { id: "segolilylabs/Lily-Cybersecurity-7B-v0.2", name: "Lily Cybersecurity 7B", base: "Mistral-7B-Instruct-v0.2", arch: "mistral", size: "7B", focus: "일반 보안 Q&A · 사고대응 · 개념 설명", note: "채팅 모델 옵션 (합성 소스로도 사용)", lang: "영어" },
  { id: "ZySec-AI/SecurityLLM", name: "ZySec 7B (SecurityLLM)", base: "Mistral-7B", arch: "mistral", size: "7B", focus: "보안 운영 · 정책 · 컴플라이언스 문서", lang: "영어" },
  { id: "fdtn-ai/Foundation-Sec-8B", name: "Foundation-Sec 8B", base: "Llama-3.1-8B", arch: "llama", size: "8B", focus: "위협 분석 · 보안 추론 (범용 보안 파운데이션)", note: "Cisco Foundation AI", lang: "영어" },
  { id: "clouditera/SecGPT-1.5B", name: "SecGPT 1.5B", base: "Qwen2-1.5B", arch: "qwen2", size: "1.5B", focus: "경량 보안 어시스턴트 (온디바이스)", note: "clouditera", lang: "중국어" },
  { id: "AlicanKiraz0/Titus-CybersecurityLLM-v1.0", name: "Titus Cybersecurity LLM", base: "Qwen (추정)", arch: "other", size: "-", focus: "공격·방어 통합 보안 지식", lang: "영어" },
];

// 같은 arch끼리 묶어 "합성 호환 그룹"을 만든다. 크기까지 같아야 실제 SLERP가 되므로 size도 표기.
// ⚠ 2026-09-07 — **사람이 보는 소비자가 0이 됐다.** 유일한 소비자였던 merge.html(LLM 합성)을
//   내리면서 이 그룹을 화면에 그리는 곳이 없어졌다. 값은 /api/modeldex 응답의 groups 칸으로
//   여전히 나가고 modeldex.test가 그 꼴을 지킨다 — 그래서 지우지 않되, 「누가 보나」를 여기 적어
//   둔다. 다음에 도감 화면을 손보는 사람이 이 칸을 살릴지 내릴지 판단할 근거다.
export function synthesisGroups(): { arch: string; models: DexModel[] }[] {
  const byArch = new Map<string, DexModel[]>();
  for (const m of SECURITY_LLM_DEX) {
    if (!byArch.has(m.arch)) byArch.set(m.arch, []);
    byArch.get(m.arch)!.push(m);
  }
  return [...byArch.entries()].map(([arch, models]) => ({ arch, models }));
}

// ── 추천 LLM 가이드 (용도별 카탈로그, 다운로드 페이지용) ──────────────────────
// aicitybuilders.com/dex처럼 "우리가 써야 할" LLM을 용도별로 큐레이션한다. 다운로드가 실제로
// 되도록 id는 전부 GGUF 저장소(HF에서 존재·gguf 확인, 2026-07)로 지정한다.
export interface RecommendedModel {
  id: string; // 다운로드 가능한 GGUF HF repo id
  name: string;
  size: string;
  approxGb: string; // Q4_K_M 대략 크기
  desc: string;
  tag?: string; // 예: "GIJO 기본", "임베딩", "롱컨텍스트"
}

export interface LlmGuideCategory {
  key: string;
  icon: string;
  title: string;
  intro: string;
  models: RecommendedModel[];
}

export const LLM_GUIDE: LlmGuideCategory[] = [
  {
    key: "security",
    icon: "🛡",
    title: "보안 특화 LLM",
    intro: "침해사고 대응·취약점 분석·보안 개념을 이미 학습한 모델. 보안 담당 에이전트의 두뇌로 바로 쓰기 좋습니다.",
    models: [
      { id: "QuantFactory/Lily-Cybersecurity-7B-v0.2-GGUF", name: "Lily Cybersecurity 7B", size: "7B", approxGb: "약 4.4GB", tag: "보안 특화", desc: "사이버보안 일반 Q&A·사고대응·개념 설명에 특화한 채팅 모델 옵션. (GIJO 기본 채팅 모델은 자체 gijo-main-orchestrator입니다.)" },
      { id: "QuantFactory/SecurityLLM-GGUF", name: "ZySec 7B (SecurityLLM)", size: "7B", approxGb: "약 4.4GB", desc: "보안 운영·정책·컴플라이언스 문서 이해에 강합니다. 리포트/거버넌스 계열 에이전트에 적합." },
      { id: "mradermacher/Foundation-Sec-8B-GGUF", name: "Foundation-Sec 8B", size: "8B", approxGb: "약 4.9GB", tag: "Cisco", desc: "위협 분석·보안 추론용 파운데이션 모델(Cisco Foundation AI). 분석·CTI 에이전트 후보." },
    ],
  },
  {
    key: "finetune",
    icon: "🎓",
    title: "파인튜닝 베이스 LLM",
    intro: "우리 문서로 학습(파인튜닝)시켜 문체·판단을 각인시킬 때 쓰는 범용 베이스. 학습이 잘 먹고 자료가 많은 모델을 골랐습니다.",
    models: [
      // ⚠ 낡은 설명 정리(2026-08-09): 예전엔 "학습루프의 확정 베이스"라고 적혀 있었는데,
      //   학습 루프 베이스는 Qwen3-14B로 바뀌었다(AI팀 재설계 0단계). 화면이 옛말을 하면
      //   고객이 어느 쪽을 믿을지 몰라진다 — 지금 사실만 적는다.
      { id: "NousResearch/Hermes-3-Llama-3.1-8B-GGUF", name: "Hermes 3 (Llama 3.1 8B)", size: "8B", approxGb: "약 4.9GB", tag: "범용", desc: "지시 따르기·구조화 출력이 뛰어난 범용 모델. 라이선스 제약(비상업 연구용)이 있어 도입 전 확인이 필요합니다." },
      { id: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF", name: "Llama 3.1 8B Instruct", size: "8B", approxGb: "약 4.9GB", desc: "가장 널리 쓰이는 파인튜닝 베이스. 한국어 포함 다국어와 도구 사용이 안정적입니다." },
      { id: "bartowski/Qwen2.5-7B-Instruct-GGUF", name: "Qwen2.5 7B Instruct", size: "7B", approxGb: "약 4.7GB", desc: "지시 따르기·한국어 품질이 좋아 파인튜닝 후 실무 응답이 매끄럽습니다." },
      { id: "bartowski/Phi-3.5-mini-instruct-GGUF", name: "Phi-3.5 mini", size: "3.8B", approxGb: "약 2.4GB", tag: "경량 베이스", desc: "작지만 추론이 좋아 GPU 여유가 적을 때 파인튜닝 베이스로 쓰기 좋습니다." },
    ],
  },
  {
    key: "knowledge",
    icon: "📚",
    title: "지식 관리(RAG)에 강한 LLM",
    intro: "장기 기억(문서 검색) 결과를 잘 활용하려면 긴 컨텍스트와 요약력이 필요합니다. 검색용 임베딩 모델도 여기 있습니다.",
    models: [
      { id: "bartowski/Qwen2.5-14B-Instruct-GGUF", name: "Qwen2.5 14B Instruct", size: "14B", approxGb: "약 9GB", tag: "롱컨텍스트", desc: "128K 토큰 컨텍스트. 많은 문서를 넣고 근거 기반으로 답하게 할 때 강합니다(VRAM 넉넉할 때)." },
      { id: "bartowski/Qwen2.5-7B-Instruct-GGUF", name: "Qwen2.5 7B Instruct", size: "7B", approxGb: "약 4.7GB", tag: "롱컨텍스트", desc: "128K 컨텍스트를 가벼운 비용으로. 일상적인 RAG 응답에 균형이 좋습니다." },
      { id: "gpustack/bge-m3-GGUF", name: "BGE-M3 (임베딩)", size: "임베딩", approxGb: "약 0.4GB", tag: "임베딩", desc: "장기 기억 검색에 쓰는 임베딩 모델. GIJO에 기본 내장돼 있으며, 교체·재배치용으로 받을 수 있습니다." },
    ],
  },
  {
    key: "light",
    icon: "⚡",
    title: "가벼운 LLM",
    intro: "빠른 응답·저사양·여러 모델 동시 상주가 필요할 때. 분류/라우팅 같은 가벼운 작업에 딱 맞습니다.",
    models: [
      { id: "mykor/Midm-2.0-Mini-Instruct-gguf", name: "Mi:dm 2.0 Mini (KT)", size: "2.3B", approxGb: "약 1.4GB", tag: "서식·추출 전용", desc: "KT Mi:dm 2.0 Mini, MIT. 서식 채우기·발췌→JSON·32K 안 사실 회수는 만점(3회차 실측)이나 판단·절제·인용은 약하다 — 서식 전용 보조 모델 자리(팀원 배정 아님)." },
      { id: "bartowski/Llama-3.2-3B-Instruct-GGUF", name: "Llama 3.2 3B", size: "3B", approxGb: "약 2GB", desc: "작은 크기에 품질이 좋아 빠른 응답용으로 인기. 여러 개를 동시에 올리기 좋습니다." },
      { id: "bartowski/Qwen2.5-3B-Instruct-GGUF", name: "Qwen2.5 3B", size: "3B", approxGb: "약 2GB", desc: "한국어가 준수한 경량 모델. 요약·분류 같은 보조 작업에 적합합니다." },
      { id: "bartowski/Llama-3.2-1B-Instruct-GGUF", name: "Llama 3.2 1B", size: "1B", approxGb: "약 0.8GB", desc: "초경량. 의도 분류·라우팅처럼 아주 빠른 판단이 필요한 곳에." },
      { id: "Qwen/Qwen2-0.5B-Instruct-GGUF", name: "Qwen2 0.5B", size: "0.5B", approxGb: "약 0.4GB", tag: "초경량", desc: "가장 가벼운 테스트·개발용. 파이프라인 점검이나 저사양 데모에 씁니다." },
    ],
  },
];

// ── AI 팀 에이전트별 모델 추천 (기능 기반) ────────────────────────────
// 각 에이전트의 담당 역할(agents.ts AGENT_DEFS)에 맞는 모델을 도감(LLM_GUIDE)에서 고른다.
// modelId는 반드시 LLM_GUIDE에 있는 다운로드 가능한 GGUF여야 한다 — 그래야 에이전트 화면에서
// "받기"(다운로드 큐)와 "적용"(할당)이 바로 동작한다. 이름/용량 등 표시 정보는 아래에서
// LLM_GUIDE를 조회해 자동으로 채운다(중복 정의 방지).
interface AgentModelRecSpec {
  modelId: string; // LLM_GUIDE의 GGUF repo id
  reason: string;
}

const AGENT_MODEL_RECOMMENDATIONS: Record<string, AgentModelRecSpec> = {
  orchestrator: {
    modelId: "bartowski/Qwen2.5-7B-Instruct-GGUF",
    reason: "지시 이해와 한국어 라우팅 정확도가 좋아 작업 분배·의도 판단·결과 취합에 적합. 더 빠른 응답이 급하면 Llama 3.2 3B로 교체하세요.",
  },
  scan: {
    modelId: "mradermacher/Foundation-Sec-8B-GGUF",
    reason: "업로드·스캔(ModelScan) 결과로 나온 모델 취약점을 위협 관점에서 해석·요약하는 데 강합니다.",
  },
  analysis: {
    modelId: "bartowski/Qwen2.5-7B-Instruct-GGUF",
    reason: "우선순위 판단과 매끄러운 한국어 설명 품질이 좋습니다. 학습 루프·어댑터 등 AI 모델 관리 설명에도 맞습니다(문서 분류·보강은 Curator 몫).",
  },
  report: {
    modelId: "bartowski/Qwen2.5-7B-Instruct-GGUF",
    reason: "한국어 보고서 문체·서식 품질이 가장 좋아 내부 보고서·결과 레포팅에 적합합니다.",
  },
  ti: {
    modelId: "mradermacher/Foundation-Sec-8B-GGUF",
    reason: "딥웹·다크웹 CTI 피드의 영문 위협 정보를 보안 관점에서 해석·요약하는 데 강합니다. 자산 매칭 자체는 규칙 엔진(CTI↔자산 대조)이 수행합니다.",
  },
  normaltic: {
    modelId: "bartowski/Qwen2.5-7B-Instruct-GGUF",
    reason: "스캔·분석 결과에 나온 용어를 사내 자료 근거로 해설하고 사례를 부연하는 데 한국어 품질·지시따르기가 좋습니다(엄격 그라운딩에 적합).",
  },
  curator: {
    modelId: "bartowski/Qwen2.5-7B-Instruct-GGUF",
    reason: "문서 분류·세 줄 요약·번역 보강·정형 초안은 지시 따르기와 한국어 요약 품질이 관건입니다. A.X-4.0-Light 7B는 팀원 역할 시험 2회차(2026-09-03)에서 현행과 동률이었으나 문서 분류·요약 과업으로 잰 값은 아직 없습니다 — 지식 적재 게이트에서 그 과업으로 재판정한 뒤 교체 후보입니다.",
  },
  bom: {
    modelId: "bartowski/Qwen2.5-7B-Instruct-GGUF",
    reason: "규칙 판정 뒤의 해석·설명이라 한국어 지시 따르기와 절제(판정을 바꾸지 않기)가 관건입니다. 판정 자체는 규칙 엔진이 합니다.",
  },
};

export interface AgentModelRecommendation extends RecommendedModel {
  agentId: string;
  reason: string;
}

// 도감(LLM_GUIDE) 전체를 id로 조회할 수 있게 평탄화한 룩업.
const GUIDE_BY_ID: Map<string, RecommendedModel> = new Map(LLM_GUIDE.flatMap((c) => c.models).map((m) => [m.id, m]));

// 에이전트별 추천을 도감 정보(name/size/approxGb/tag)로 살찌워 돌려준다.
export function getAgentModelRecommendations(): Record<string, AgentModelRecommendation> {
  const out: Record<string, AgentModelRecommendation> = {};
  for (const [agentId, spec] of Object.entries(AGENT_MODEL_RECOMMENDATIONS)) {
    const model = GUIDE_BY_ID.get(spec.modelId);
    if (!model) continue; // 도감에 없는 id는 건너뛴다(다운로드 불가라 추천해도 무의미)
    out[agentId] = { agentId, reason: spec.reason, ...model };
  }
  return out;
}

export function registerModelDexRoutes(app: Express): void {
  app.get("/api/modeldex", authMiddleware, (_req, res) => {
    res.json({ models: SECURITY_LLM_DEX, groups: synthesisGroups() });
  });
  app.get("/api/llmguide", authMiddleware, (_req, res) => {
    res.json(LLM_GUIDE);
  });
  app.get("/api/modeldex/agent-recommendations", authMiddleware, (_req, res) => {
    res.json(getAgentModelRecommendations());
  });
}
