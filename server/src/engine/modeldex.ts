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
  { id: "segolilylabs/Lily-Cybersecurity-7B-v0.2", name: "Lily Cybersecurity 7B", base: "Mistral-7B-Instruct-v0.2", arch: "mistral", size: "7B", focus: "일반 보안 Q&A · 사고대응 · 개념 설명", note: "GIJO 확정 채팅 모델", lang: "영어" },
  { id: "ZySec-AI/SecurityLLM", name: "ZySec 7B (SecurityLLM)", base: "Mistral-7B", arch: "mistral", size: "7B", focus: "보안 운영 · 정책 · 컴플라이언스 문서", lang: "영어" },
  { id: "fdtn-ai/Foundation-Sec-8B", name: "Foundation-Sec 8B", base: "Llama-3.1-8B", arch: "llama", size: "8B", focus: "위협 분석 · 보안 추론 (범용 보안 파운데이션)", note: "Cisco Foundation AI", lang: "영어" },
  { id: "clouditera/SecGPT-1.5B", name: "SecGPT 1.5B", base: "Qwen2-1.5B", arch: "qwen2", size: "1.5B", focus: "경량 보안 어시스턴트 (온디바이스)", note: "clouditera", lang: "중국어" },
  { id: "AlicanKiraz0/Titus-CybersecurityLLM-v1.0", name: "Titus Cybersecurity LLM", base: "Qwen (추정)", arch: "other", size: "-", focus: "공격·방어 통합 보안 지식", lang: "영어" },
];

// 같은 arch끼리 묶어 "합성 호환 그룹"을 만든다. 크기까지 같아야 실제 SLERP가 되므로 size도 표기.
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
    icon: "🛡️",
    title: "보안 특화 LLM",
    intro: "침해사고 대응·취약점 분석·보안 개념을 이미 학습한 모델. 보안 담당 에이전트의 두뇌로 바로 쓰기 좋습니다.",
    models: [
      { id: "QuantFactory/Lily-Cybersecurity-7B-v0.2-GGUF", name: "Lily Cybersecurity 7B", size: "7B", approxGb: "약 4.4GB", tag: "GIJO 기본", desc: "사이버보안 일반 Q&A·사고대응·개념 설명에 특화. GIJO AS의 확정 채팅 모델입니다." },
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
      { id: "NousResearch/Hermes-3-Llama-3.1-8B-GGUF", name: "Hermes 3 (Llama 3.1 8B)", size: "8B", approxGb: "약 4.9GB", tag: "학습루프 베이스", desc: "헤르메스 학습 루프의 확정 베이스. 지시 따르기·구조화 출력이 뛰어나 자가학습 루프에 적합합니다. 실제 학습은 HF 원본(NousResearch/Hermes-3-Llama-3.1-8B)으로, 이 GGUF는 학습 전 베이스 응답 확인용." },
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
      { id: "bartowski/Llama-3.2-3B-Instruct-GGUF", name: "Llama 3.2 3B", size: "3B", approxGb: "약 2GB", desc: "작은 크기에 품질이 좋아 빠른 응답용으로 인기. 여러 개를 동시에 올리기 좋습니다." },
      { id: "bartowski/Qwen2.5-3B-Instruct-GGUF", name: "Qwen2.5 3B", size: "3B", approxGb: "약 2GB", desc: "한국어가 준수한 경량 모델. 요약·분류 같은 보조 작업에 적합합니다." },
      { id: "bartowski/Llama-3.2-1B-Instruct-GGUF", name: "Llama 3.2 1B", size: "1B", approxGb: "약 0.8GB", desc: "초경량. 의도 분류·라우팅처럼 아주 빠른 판단이 필요한 곳에." },
      { id: "Qwen/Qwen2-0.5B-Instruct-GGUF", name: "Qwen2 0.5B", size: "0.5B", approxGb: "약 0.4GB", tag: "초경량", desc: "가장 가벼운 테스트·개발용. 파이프라인 점검이나 저사양 데모에 씁니다." },
    ],
  },
];

export function registerModelDexRoutes(app: Express): void {
  app.get("/api/modeldex", authMiddleware, (_req, res) => {
    res.json({ models: SECURITY_LLM_DEX, groups: synthesisGroups() });
  });
  app.get("/api/llmguide", authMiddleware, (_req, res) => {
    res.json(LLM_GUIDE);
  });
}
