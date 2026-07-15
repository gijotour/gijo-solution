// engine/dataset.ts — 파인튜닝용 대화형 데이터셋 변환 · 증폭 · 저장 (6.2절 ②단계)
// 저장된 데이터셋(data/datasets/<id>.json)이 finetune_unsloth.py의 입력이 된다.

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { chat } from "./llm";

const DATASETS_DIR = path.join("data", "datasets");

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

// 파일명으로 그대로 쓰이므로 경로 조작이 불가능한 id만 허용한다.
const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function saveDataset(id: string, examples: ConversationExample[]): { id: string; examples: number } {
  if (!DATASET_ID_RE.test(id)) {
    throw new Error("데이터셋 ID는 영문 소문자/숫자/하이픈만 가능합니다 (예: incident-qa-v1)");
  }
  const valid = examples.filter((e) => e && typeof e.question === "string" && typeof e.answer === "string" && e.question && e.answer);
  if (valid.length === 0) throw new Error("유효한 question/answer 쌍이 없습니다");
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATASETS_DIR, `${id}.json`), JSON.stringify(valid, null, 2), "utf-8");
  return { id, examples: valid.length };
}

export function listDatasets(): { id: string; examples: number }[] {
  if (!fs.existsSync(DATASETS_DIR)) return [];
  return fs
    .readdirSync(DATASETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const id = f.slice(0, -5);
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, f), "utf-8")) as unknown[];
        return { id, examples: Array.isArray(rows) ? rows.length : 0 };
      } catch {
        return { id, examples: 0 };
      }
    });
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
  app.post("/api/dataset/save", authMiddleware, (req, res) => {
    try {
      res.json(saveDataset(String(req.body.id ?? ""), req.body.examples ?? []));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.get("/api/dataset/list", authMiddleware, (_req, res) => res.json(listDatasets()));
}
