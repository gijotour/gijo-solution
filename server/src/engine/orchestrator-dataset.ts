// engine/orchestrator-dataset.ts — 오케스트레이터 도구 선택 파인튜닝 데이터셋 (Phase 4)
//
// 목적: 실 LLM 실측(2026-07-18)에서 7B가 update_finding_status 같은 쓰기 도구를 선언형 지시
// ("~은 오탐이야")에서 못 고르고 채팅으로 폴백하는 것을 확인 → 지시→도구결정 예시를 학습시켜
// 도구 선택률을 올린다. 학습 예시는 학습루프가 그대로 소비하는 {question, answer} 형식:
//   question = 추론 때 orchestrator가 보내는 결정 프롬프트(카탈로그+규칙+지시) — buildDecisionPrompt
//   answer   = 기대 결정 JSON ({"action":"tool","tool":...,"args":{...}} 또는 {"action":"final",...})
// train==inference 포맷이라 실제 선택 개선에 직결된다. 도구 카탈로그가 바뀌면 재생성해야 한다.
//
// 두 소스를 합친다:
//   ① SEED — 손으로 큐레이션(모든 도구 + final 음성예시, 약점 update_finding_status를 가중).
//   ② GOLD — 사람이 결재판에서 승인한 쓰기(지시→도구+인자)를 누적(appendApprovedDecision).
//      승인 = 사람이 검증한 정답이라, 모델 자기오류를 재강화하지 않는 안전한 자가강화 신호다.

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { buildDecisionPrompt } from "./agentloop";

export interface ToolDecision {
  action: "tool" | "final";
  tool?: string;
  args?: Record<string, string>;
  answer?: string;
}

export interface DecisionPair {
  instruction: string;
  decision: ToolDecision;
}

// GOLD(승인 누적)는 datasets/ 밖에 둔다 — 원시 쌍이라 그대로는 학습 데이터셋이 아니고,
// build 시 결정 프롬프트로 렌더해 datasets/orchestrator-tools.json으로 내보낸다(카탈로그 드리프트 견딤).
const GOLD_PATH = path.join("data", "orchestrator-gold.json");
export const ORCHESTRATOR_DATASET_ID = "orchestrator-tools";

// ── 큐레이션 시드 ────────────────────────────────────────────────────────
// tool 헬퍼로 간결하게. update_finding_status는 선언형·명령형·동사변형을 두루 담아 가중한다.
const t = (tool: string, args: Record<string, string> = {}): ToolDecision => ({ action: "tool", tool, args });
const f = (answer: string): ToolDecision => ({ action: "final", answer });

export const SEED_DECISIONS: DecisionPair[] = [
  // 조회 — list_assets / get_asset
  { instruction: "등록된 AI 자산 목록 보여줘", decision: t("list_assets") },
  { instruction: "우리 AI 자산 뭐뭐 있어?", decision: t("list_assets") },
  { instruction: "ai-secbot-01 상세 보여줘", decision: t("get_asset", { assetId: "ai-secbot-01" }) },
  { instruction: "ai-doccls-02 자세히 봐줘", decision: t("get_asset", { assetId: "ai-doccls-02" }) },
  // 조회 — search / explain (메뉴 가로지르기)
  { instruction: "Log4Shell 관련된 거 다 찾아줘", decision: t("search", { query: "Log4Shell" }) },
  { instruction: "프롬프트 인젝션 어디에 있는지 찾아줘", decision: t("search", { query: "프롬프트 인젝션" }) },
  { instruction: "프롬프트 인젝션이 뭐야?", decision: t("explain", { topic: "프롬프트 인젝션" }) },
  { instruction: "모델 탈옥 관련해서 우리 통제가 뭐가 있는지 설명해줘", decision: t("explain", { topic: "모델 탈옥" }) },
  // 조회 — today / threats
  { instruction: "오늘 뭐부터 해야 돼?", decision: t("today") },
  { instruction: "지금 제일 급한 취약점 알려줘", decision: t("today") },
  { instruction: "오늘의 조치 상위 3개만", decision: t("today", { limit: "3" }) },
  { instruction: "요즘 우리 자산에 걸리는 위협 있어?", decision: t("threats") },
  { instruction: "새로 뜬 위협 중에 우리랑 관련된 거 있어?", decision: t("threats") },
  // 쓰기 — register_asset
  { instruction: "사내 챗봇 등록해줘 경로는 models/chatbot.gguf", decision: t("register_asset", { name: "사내 챗봇", path: "models/chatbot.gguf" }) },
  { instruction: "새 자산 등록: 문서분류기, 경로 models/doccls.onnx", decision: t("register_asset", { name: "문서분류기", path: "models/doccls.onnx" }) },
  // 쓰기 — assign_finding
  { instruction: "ai-secbot-01 프롬프트 인젝션 김보안한테 배정해줘 기한 2026-08-15", decision: t("assign_finding", { assetId: "ai-secbot-01", finding: "프롬프트 인젝션", assignee: "김보안", dueDate: "2026-08-15" }) },
  { instruction: "ai-web-03 SSL 만료 취약점 운영팀에 배정", decision: t("assign_finding", { assetId: "ai-web-03", finding: "SSL 만료", assignee: "운영팀" }) },
  { instruction: "vuln:sample-web01 Log4j 담당 정요한으로 배정해줘 기한 2026-07-24", decision: t("assign_finding", { assetId: "vuln:sample-web01", finding: "Log4j", assignee: "정요한", dueDate: "2026-07-24" }) },
  // 쓰기 — update_finding_status (약점 — 가중: 선언형·명령형·동사변형 다수)
  { instruction: "ai-secbot-01의 버전 정보 노출은 오탐이야", decision: t("update_finding_status", { assetId: "ai-secbot-01", finding: "버전 정보 노출", status: "오탐" }) },
  { instruction: "이거 오탐 처리해줘, ai-web-03 SSL 만료", decision: t("update_finding_status", { assetId: "ai-web-03", finding: "SSL 만료", status: "오탐" }) },
  { instruction: "ai-secbot-01 프롬프트 인젝션 조치완료야", decision: t("update_finding_status", { assetId: "ai-secbot-01", finding: "프롬프트 인젝션", status: "조치완료" }) },
  { instruction: "버전 정보 노출 고쳤어 ai-doccls-02", decision: t("update_finding_status", { assetId: "ai-doccls-02", finding: "버전 정보 노출", status: "조치완료" }) },
  { instruction: "ai-web-03 Log4j 패치했어", decision: t("update_finding_status", { assetId: "ai-web-03", finding: "Log4j", status: "조치완료" }) },
  { instruction: "ai-secbot-01 SSL 만료는 내부망 전용이라 오탐으로 빼줘", decision: t("update_finding_status", { assetId: "ai-secbot-01", finding: "SSL 만료", status: "오탐", note: "내부망 전용" }) },
  { instruction: "이 취약점 무시해도 돼 오탐이야, ai-doccls-02 버전 노출", decision: t("update_finding_status", { assetId: "ai-doccls-02", finding: "버전 노출", status: "오탐" }) },
  { instruction: "ai-web-03 OpenSSH 사용자 열거 조치 끝났어", decision: t("update_finding_status", { assetId: "ai-web-03", finding: "OpenSSH 사용자 열거", status: "조치완료" }) },
  { instruction: "프롬프트 인젝션 노출 오탐 처리, ai-secbot-01", decision: t("update_finding_status", { assetId: "ai-secbot-01", finding: "프롬프트 인젝션 노출", status: "오탐" }) },
  { instruction: "ai-doccls-02 버전 정보 노출 이제 해결했어", decision: t("update_finding_status", { assetId: "ai-doccls-02", finding: "버전 정보 노출", status: "조치완료" }) },
  // final — 음성 예시(도구 없이 답해야 함 — 과잉 도구 호출 방지)
  { instruction: "고마워", decision: f("도움이 되었다니 다행입니다. 더 필요한 게 있으면 말씀해 주세요.") },
  { instruction: "안녕하세요", decision: f("안녕하세요. 보안 현황이나 조치에 대해 무엇을 도와드릴까요?") },
  { instruction: "수고했어", decision: f("감사합니다. 추가로 확인할 항목이 있으면 알려주세요.") },
];

// ── GOLD(승인 누적) ──────────────────────────────────────────────────────

function readGold(): DecisionPair[] {
  try {
    const rows = JSON.parse(fs.readFileSync(GOLD_PATH, "utf-8")) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (r): r is DecisionPair =>
        typeof r === "object" && r !== null && typeof (r as DecisionPair).instruction === "string" && !!(r as DecisionPair).decision
    );
  } catch {
    return [];
  }
}

// 사람이 승인한 쓰기 도구를 골드 예시로 누적한다(성공한 /api/agent/approve에서 호출).
// 지시가 비었으면(구 클라이언트가 안 넘기면) 조용히 건너뛴다 — 프롬프트를 지어내지 않는다.
export function appendApprovedDecision(instruction: string, tool: string, args: Record<string, string>): void {
  try {
    const instr = (instruction ?? "").trim();
    if (!instr || !tool) return;
    fs.mkdirSync(path.dirname(GOLD_PATH), { recursive: true });
    const rows = readGold();
    // 같은 (지시+도구) 중복은 최신 인자로 대체 — 데이터셋 편향 방지.
    const key = `${instr}::${tool}`;
    const filtered = rows.filter((r) => `${r.instruction}::${r.decision.tool ?? ""}` !== key);
    filtered.push({ instruction: instr, decision: { action: "tool", tool, args } });
    fs.writeFileSync(GOLD_PATH, JSON.stringify(filtered, null, 2), "utf-8");
  } catch {
    /* 누적 실패가 승인 실행을 막지 않는다 — 학습 데이터는 부가 기능 */
  }
}

export function goldCount(): number {
  return readGold().length;
}

// ── 데이터셋 빌드 ──────────────────────────────────────────────────────────

// 결정 쌍을 학습루프가 소비하는 {question, answer}로 렌더한다(train==inference).
export function toTrainingExample(pair: DecisionPair): { question: string; answer: string } {
  return { question: buildDecisionPrompt(pair.instruction), answer: JSON.stringify(pair.decision) };
}

export function collectDecisionPairs(): DecisionPair[] {
  // 시드 먼저, 그다음 승인 누적. 같은 지시가 겹치면 승인(현장 실제 문구)을 우선한다.
  const gold = readGold();
  const goldKeys = new Set(gold.map((g) => g.instruction.trim()));
  const seedOnly = SEED_DECISIONS.filter((s) => !goldKeys.has(s.instruction.trim()));
  return [...seedOnly, ...gold];
}

// 시드+골드를 orchestrator-tools.json으로 저장한다. dataset.ts는 llm.ts를 import하므로
// 정적 import 시 순환 우려 → learnloop의 선례대로 동적 import.
export async function buildOrchestratorDataset(): Promise<{ datasetId: string; examples: number; seed: number; gold: number }> {
  const pairs = collectDecisionPairs();
  const examples = pairs.map(toTrainingExample);
  const { saveDataset } = await import("./dataset.js");
  const saved = saveDataset(ORCHESTRATOR_DATASET_ID, examples);
  return { datasetId: saved.id, examples: saved.examples, seed: SEED_DECISIONS.length, gold: goldCount() };
}

export function registerOrchestratorDatasetRoutes(app: Express): void {
  // 현황: 시드·골드 개수(빌드 없이 확인).
  app.get("/api/learnloop/orchestrator-dataset", authMiddleware, (_req, res) => {
    res.json({ datasetId: ORCHESTRATOR_DATASET_ID, seed: SEED_DECISIONS.length, gold: goldCount() });
  });
  // 빌드: 시드+골드를 data/datasets/orchestrator-tools.json으로 내보낸다(학습루프가 이 id로 학습).
  app.post(
    "/api/learnloop/orchestrator-dataset/build",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json(await buildOrchestratorDataset());
    })
  );
}
