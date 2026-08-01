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
import { 시험문항인가 } from "./datasethygiene";
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
const GOLD_PATH = process.env.GIJO_ORCH_GOLD_PATH ?? path.join("data", "orchestrator-gold.json");
export const ORCHESTRATOR_DATASET_ID = "orchestrator-tools";

// ── 큐레이션 시드 ────────────────────────────────────────────────────────
// tool 헬퍼로 간결하게. update_finding_status는 선언형·명령형·동사변형을 두루 담아 가중한다.
const t = (tool: string, args: Record<string, string> = {}): ToolDecision => ({ action: "tool", tool, args });
const f = (answer: string): ToolDecision => ({ action: "final", answer });

export const SEED_DECISIONS: DecisionPair[] = [
  // 조회 — list_assets / get_asset
  { instruction: "등록된 AI 자산 목록 보여줘", decision: t("list_assets") },
  { instruction: "우리 AI 자산 뭐뭐 있어?", decision: t("list_assets") },
  // 짧은 개수 질문 — "우리" 없이 물으면 도구를 안 타고 RAG(벤더 매뉴얼)로 새어
  // "알 수 없다"고 답하던 실측 결함(2026-07-25 입력·디스패치 테스트) 교정용.
  { instruction: "자산 몇 개야?", decision: t("list_assets") },
  { instruction: "자산 개수 알려줘", decision: t("list_assets") },
  { instruction: "ai-secbot-01 상세 보여줘", decision: t("get_asset", { assetId: "ai-secbot-01" }) },
  { instruction: "ai-doccls-02 자세히 봐줘", decision: t("get_asset", { assetId: "ai-doccls-02" }) },
  // 조회 — search / explain (메뉴 가로지르기)
  { instruction: "Log4Shell 관련된 거 다 찾아줘", decision: t("search", { query: "Log4Shell" }) },
  { instruction: "프롬프트 인젝션 어디에 있는지 찾아줘", decision: t("search", { query: "프롬프트 인젝션" }) },
  // 조직·서비스·호스트 이름으로 묻는 조회 — 실측(2026-07-25): 웹취약점 보고서로 등록된 자산을
  // "안전대부 웹서버 취약점 알려줘"로 물었을 때 도구를 안 부르고 일반지식으로 답했다(자산명에
  // "안전대부"가 있어 search면 정확히 나오는 상황). 조직/서비스명 조회 예시를 가중해 교정한다.
  { instruction: "안전대부 웹서버 취약점 알려줘", decision: t("search", { query: "안전대부" }) },
  { instruction: "certify.aj-safe.co.kr 취약점 뭐 있어?", decision: t("search", { query: "certify.aj-safe.co.kr" }) },
  { instruction: "결제 서비스 쪽에 뭐 걸린 거 있어?", decision: t("search", { query: "결제" }) },
  { instruction: "본인인증 서버 점검 결과 보여줘", decision: t("search", { query: "본인인증" }) },
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
  // ★ 시험지에 있는 지시는 학습에서 뺀다 — **여기서만 걸러진다.**
  //   question이 긴 프롬프트라 위생의 시험 문항 대조(질문 전체를 본다)로는 안 걸린다.
  //   2026-08-01 실측: 시드 37개 중 2개("안전대부 웹서버 취약점 알려줘"·"지금 제일 급한
  //   취약점 알려줘")가 평가 게이트 문항 그대로였다 — 시험지를 오케스트레이터에게
  //   가르치고 있었고, 그러면 게이트 점수가 실력을 못 잰다(위생 규칙 ②가 "가장 위험"이라 적은 것).
  return [...seedOnly, ...gold].filter((d) => !시험문항인가(d.instruction));
}

// ── 골드 few-shot 동적 주입 (파인튜닝 대체) ────────────────────────────────
// Phase 4 파인튜닝은 held-out 실측 하락(8/8→7/8)으로 폐기됐지만 이 데이터(시드+승인 골드)는 살아
// 있다 — 결정 프롬프트에 지시와 유사한 예시 2~3건을 주입해 도구 선택을 돕는다. 외부 실측 근거:
// 유사 예시 3건 동적 주입으로 도구선택 정확도가 크게 오르며 정적 예시보다 낫다(LangChain 벤치).
// 유사도는 한글 bigram Dice — 임베딩 호출 없이 결정적·<1ms라 디스패치 지연이 없고 오프라인 완동.
function bigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function diceSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return (2 * inter) / (a.size + b.size);
}

// 지시와 유사한 결정 쌍 상위 k건. allowedTools가 오면 현재 카탈로그에 없는 도구 예시는 제외한다
// (좁힌 카탈로그 밖 도구를 예시로 보여주면 모델이 없는 도구를 부를 수 있다). final 예시는 항상 허용.
const FEWSHOT_MIN_SIM = 0.2; // 이하면 무관 — 안 붙인다(무관 예시는 오히려 오염)
export function findSimilarDecisions(instruction: string, k = 3, allowedTools?: Set<string>): DecisionPair[] {
  const q = bigrams(instruction);
  return collectDecisionPairs()
    .filter((p) => p.decision.action === "final" || !allowedTools || allowedTools.has(p.decision.tool ?? ""))
    .map((p) => ({ p, s: diceSim(q, bigrams(p.instruction)) }))
    .filter((x) => x.s >= FEWSHOT_MIN_SIM)
    .sort((x, y) => y.s - x.s)
    .slice(0, k)
    .map((x) => x.p);
}

// 결정 프롬프트에 붙일 예시 블록(없으면 빈 문자열). 7B는 프롬프트가 길어지면 페르소나로 흘러
// 도구를 안 부른 실측(2026-07-17)이 있어 최대 3건·한 줄씩만 붙인다.
export function fewshotBlockFor(instruction: string, allowedTools?: Set<string>): string {
  const hits = findSimilarDecisions(instruction, 3, allowedTools);
  if (hits.length === 0) return "";
  return [
    "",
    "승인·검증된 예시 — 비슷한 지시는 같은 방식으로 결정하라:",
    ...hits.map((h) => `지시 "${h.instruction}" → ${JSON.stringify(h.decision)}`),
  ].join("\n");
}

// ── 증폭(지시문만 패러프레이즈) ────────────────────────────────────────────
// 소량 시드(31건)로 학습하면 과적합한다(실측: loss 0.009). 다양한 표현을 늘려 완화한다.
// 핵심: 지시문의 *표현*만 바꾸고 도구·인자(assetId·finding·status 의도)는 고정한다. dataset.ts의
// amplifyDataset은 question/answer 전체를 바꿔 결정 프롬프트·JSON을 훼손하므로 여기선 못 쓴다.

function normContains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const n = norm(needle);
  return n.length >= 2 && norm(haystack).includes(n);
}

// 원본 지시에 실제로 나타난 인자 값 — 변형이 이걸 잃으면 (지시→인자) 그라운딩이 깨지므로 버린다.
function mustKeepValues(pair: DecisionPair): string[] {
  return Object.values(pair.decision.args ?? {}).filter((v) => v && normContains(pair.instruction, v));
}

// LLM 출력에서 문자열 배열을 견고하게 뽑는다(코드펜스 제거 → [..] 슬라이스 → parse → 정규식 폴백).
function parseStringArray(raw: string): string[] {
  let s = raw.replace(/```(?:json)?/gi, "").trim();
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
  } catch { /* 폴백 */ }
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try { out.push(JSON.parse(`"${m[1]}"`)); } catch { out.push(m[1]); }
  }
  return out;
}

// trusted: 이 프롬프트는 학습 데이터 증폭용으로 우리가 조립한 것이다 — 사용자 입력이 아니다.
// 타입에 넣어 두지 않으면 llm.chat에 넘길 때 그 표시가 빠져, 우리 프롬프트가 가드레일 검사를
// 받는다(차단 모드에서 데이터셋 생성이 통째로 실패한다).
type ChatFn = (args: { agentId: string; message: string; maxTokens?: number; trusted?: boolean }) => Promise<string>;

async function instructionVariants(pair: DecisionPair, n: number, chat: ChatFn): Promise<string[]> {
  if (n <= 0) return [];
  const keep = mustKeepValues(pair);
  const keepLine = keep.length
    ? `반드시 글자 그대로 유지할 값: ${keep.join(", ")}. 판정·의도(오탐/조치완료/배정 등)도 바꾸지 마라.`
    : "무엇을 시키는지(의도)는 절대 바꾸지 마라.";
  const prompt = [
    `다음 보안 플랫폼 사용자 지시를 뜻은 그대로 두고 표현·말투만 다르게 ${n}가지로 바꿔라.`,
    keepLine,
    `출력은 JSON 문자열 배열만: ["변형1","변형2",...] — 다른 설명 없이.`,
    `원본 지시: "${pair.instruction}"`,
  ].join("\n");
  let raw = "";
  try {
    raw = await chat({ agentId: "analysis", message: prompt, maxTokens: 512, trusted: true });
  } catch {
    return [];
  }
  const seen = new Set([pair.instruction.trim()]);
  const out: string[] = [];
  for (const v of parseStringArray(raw)) {
    if (out.length >= n) break; // 요청 개수(n)로 제한 — 모델이 더 많이 뱉어도 factor가 분포를 통제하게
    const s = v.trim();
    if (!s || s.length > 200 || seen.has(s)) continue;
    if (!keep.every((k) => normContains(s, k))) continue; // 값 유실 → 그라운딩 깨짐, 버린다
    seen.add(s);
    out.push(s);
  }
  return out;
}

// 각 쌍을 (원본 + 유효 변형)으로 늘린다. 약점 update_finding_status는 더 크게 증폭한다.
// chatFn 주입 가능 — 별도 프로세스에서 실행할 때 모델 라우팅/스폰(GPU 경합)을 피하려고 실행 중인
// :8080에 직접 붙는 호출을 넣을 수 있다. 생략하면 서버 컨텍스트의 chat(라우팅 포함)을 쓴다.
export async function amplifyDecisionPairs(
  pairs: DecisionPair[],
  factorFor: (p: DecisionPair) => number = (p) => (p.decision.tool === "update_finding_status" ? 5 : 3),
  chatFn?: ChatFn
): Promise<DecisionPair[]> {
  const chat = chatFn ?? ((await import("./llm.js")).chat as ChatFn);
  const out: DecisionPair[] = [];
  for (const pair of pairs) {
    out.push(pair);
    const variants = await instructionVariants(pair, factorFor(pair) - 1, chat);
    for (const instruction of variants) out.push({ instruction, decision: pair.decision });
  }
  return out;
}

// 시드+골드를 orchestrator-tools.json으로 저장한다. dataset.ts는 llm.ts를 import하므로
// 정적 import 시 순환 우려 → learnloop의 선례대로 동적 import.
// amplify=true면 증폭(LLM 호출 다수 — :8080 필요)한 뒤 저장한다.
export async function buildOrchestratorDataset(
  opts: { amplify?: boolean } = {}
): Promise<{ datasetId: string; examples: number; seed: number; gold: number; amplified: boolean }> {
  let pairs = collectDecisionPairs();
  if (opts.amplify) pairs = await amplifyDecisionPairs(pairs);
  const examples = pairs.map(toTrainingExample);
  const { saveDataset } = await import("./dataset.js");
  const saved = saveDataset(ORCHESTRATOR_DATASET_ID, examples, "라우팅") // 도구 호출 예시라 식별자가 있어야 한다;
  return { datasetId: saved.id, examples: saved.examples, seed: SEED_DECISIONS.length, gold: goldCount(), amplified: !!opts.amplify };
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
