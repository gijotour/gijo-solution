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

export function registerModelDexRoutes(app: Express): void {
  app.get("/api/modeldex", authMiddleware, (_req, res) => {
    res.json({ models: SECURITY_LLM_DEX, groups: synthesisGroups() });
  });
}
