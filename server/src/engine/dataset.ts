// engine/dataset.ts — 파인튜닝용 대화형 데이터셋 변환 · 증폭 (6.2절 ②단계)

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { chat } from "./llm";

export interface ConversationExample {
  question: string;
  answer: string;
}

function parseExamples(raw: string): ConversationExample[] {
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is ConversationExample =>
          typeof item === "object" && item !== null && "question" in item && "answer" in item
      );
    }
  } catch {
    // LLM이 JSON 포맷을 지키지 못한 경우 빈 배열 반환 — 호출부에서 재시도/사용자 검수 필요
  }
  return [];
}

export async function convertToConversationFormat(rawText: string): Promise<ConversationExample[]> {
  const prompt = [
    "아래 보안 문서를 파인튜닝용 질문-답변(Q&A) 쌍으로 변환해줘.",
    "출력은 JSON 배열만: [{\"question\":\"...\",\"answer\":\"...\"}, ...] 형식, 다른 텍스트 없이.",
    "문서 내용을 근거로 3~8개의 Q&A 쌍을 만들어줘.",
    "문서:",
    rawText,
  ].join("\n\n");
  return parseExamples(await chat({ agentId: "analysis", message: prompt }));
}

export async function amplifyDataset(examples: ConversationExample[], factor = 3): Promise<ConversationExample[]> {
  if (examples.length === 0) return [];
  const amplified: ConversationExample[] = [...examples];
  for (const example of examples) {
    const prompt = [
      `다음 질문-답변 쌍을 의미는 유지하면서 표현만 다르게 ${factor - 1}가지 버전으로 바꿔줘.`,
      "출력은 JSON 배열만: [{\"question\":\"...\",\"answer\":\"...\"}, ...] 형식, 다른 텍스트 없이.",
      `원본: ${JSON.stringify(example)}`,
    ].join("\n\n");
    const variants = parseExamples(await chat({ agentId: "analysis", message: prompt }));
    amplified.push(...variants);
  }
  return amplified;
}

export function registerDatasetRoutes(app: Express): void {
  app.post(
    "/api/dataset/convert",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await convertToConversationFormat(req.body.rawText));
    })
  );
  app.post(
    "/api/dataset/amplify",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await amplifyDataset(req.body.examples, req.body.factor));
    })
  );
}
