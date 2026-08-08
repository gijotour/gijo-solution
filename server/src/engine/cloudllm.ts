// engine/cloudllm.ts — 선택적 클라우드 LLM 하이브리드 (Gemini / Claude / OpenAI).
//
// 온프렘이 이 제품의 정체성이라, 클라우드는 **기본 OFF·admin만 활성화**하는 옵션이다. 활성화해도
// 모든 클라우드 호출은 cloudegress.ts의 결정적 게이트를 통과해야 하고(내부 식별자 감지 시 차단),
// 클라우드로는 **RAG·도구 결과 없는 맨몸 일반질문만** 나간다(이 파일이 자체 시스템 프롬프트를
// 만들고 llm.ts의 RAG 주입 경로를 타지 않는다 — 구조적 분리). 모든 판정은 감사 로그에 남는다.
//
// provider는 하나의 내부 인터페이스 뒤에 어댑터 3개로 둔다(MCP 아님 — "채팅 백엔드 교체"엔 과함).
// 키는 cryptopack.ts로 암호화 저장(cti.ts/email.ts와 동일 패턴).

import type { Express, Request } from "express";
import { gateUserInput } from "./gateway";
import * as crypto from "crypto";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import type { GijoUser } from "../auth/users";
import { encryptString, decryptString, getEncryptionKey } from "./cryptopack";
import { screenForCloud } from "./cloudegress";
import { emitCollaboration } from "./collaboration";
import { ingestText, GLOBAL_SCOPE } from "./memory";
import { koDateTimeString } from "../util/date";

export type CloudProvider = "gemini" | "claude" | "openai";
const PROVIDERS: CloudProvider[] = ["gemini", "claude", "openai"];

const PROVIDER_LABEL: Record<CloudProvider, string> = {
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
  openai: "OpenAI",
};

// 기본 모델(사용자가 설정에서 바꿀 수 있음). 비용·품질 균형점을 초깃값으로.
// gemini는 버전 별칭(2.0/2.5-flash)이 "신규 사용자 불가"로 자주 막혀(실측 2026-07-19), 항상 최신
// flash를 가리키는 무버전 별칭 gemini-flash-latest를 기본으로 둔다(설정의 "사용 가능 모델"로 교체 가능).
const DEFAULT_MODEL: Record<CloudProvider, string> = {
  gemini: "gemini-flash-latest",
  claude: "claude-sonnet-5",
  openai: "gpt-4o-mini",
};

// 클라우드로 나가는 유일한 시스템 프롬프트 — 내부 맥락이 없음을 명시하고 일반지식 범위로 못박는다.
const CLOUD_SYSTEM_PROMPT =
  "당신은 보안 실무를 돕는 어시스턴트입니다. 사용자의 일반 보안 지식 질문에 정확하고 간결하게 한국어로 답하세요. " +
  "이 대화에는 특정 조직의 내부 정보가 포함되어 있지 않습니다 — 공개된 일반 지식 범위에서만 답하고, " +
  "특정 회사의 내부 자산·구성·인물을 추측하거나 지어내지 마세요.";

const CLOUD_TIMEOUT_MS = Number(process.env.GIJO_CLOUD_LLM_TIMEOUT_MS ?? 60_000);

// ── 설정 저장 (app_state의 on/off·active provider + cloud_llm_keys의 암호화 키) ────────
const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const getKeyRowStmt = db.prepare("SELECT provider, encryptedApiKey, model FROM cloud_llm_keys WHERE provider = ?");
const upsertKeyStmt = db.prepare(
  `INSERT INTO cloud_llm_keys (provider, encryptedApiKey, model) VALUES (@provider, @encryptedApiKey, @model)
   ON CONFLICT(provider) DO UPDATE SET
     encryptedApiKey = COALESCE(excluded.encryptedApiKey, cloud_llm_keys.encryptedApiKey),
     model = excluded.model`
);
const deleteKeyStmt = db.prepare("DELETE FROM cloud_llm_keys WHERE provider = ?");

function isEnabled(): boolean {
  return (getStateStmt.get("cloud:enabled") as { value: string } | undefined)?.value === "1";
}
function activeProvider(): CloudProvider {
  const v = (getStateStmt.get("cloud:provider") as { value: string } | undefined)?.value;
  return PROVIDERS.includes(v as CloudProvider) ? (v as CloudProvider) : "gemini";
}
function providerModel(p: CloudProvider): string {
  return (getKeyRowStmt.get(p) as { model: string } | undefined)?.model || DEFAULT_MODEL[p];
}
function providerKey(p: CloudProvider): string | null {
  const row = getKeyRowStmt.get(p) as { encryptedApiKey: string | null } | undefined;
  return row?.encryptedApiKey ? decryptString(row.encryptedApiKey, getEncryptionKey()) : null;
}
function hasKey(p: CloudProvider): boolean {
  return Boolean((getKeyRowStmt.get(p) as { encryptedApiKey: string | null } | undefined)?.encryptedApiKey);
}

export interface CloudConfigPublic {
  enabled: boolean;
  activeProvider: CloudProvider;
  providers: { provider: CloudProvider; label: string; hasKey: boolean; model: string }[];
}

export function getCloudConfig(): CloudConfigPublic {
  return {
    enabled: isEnabled(),
    activeProvider: activeProvider(),
    providers: PROVIDERS.map((p) => ({ provider: p, label: PROVIDER_LABEL[p], hasKey: hasKey(p), model: providerModel(p) })),
  };
}

// ── 감사 로그 ──────────────────────────────────────────────────────────────
const insertLogStmt = db.prepare(
  "INSERT INTO cloud_egress_log (id, at, userId, provider, decision, reasons, questionPreview) VALUES (@id, @at, @userId, @provider, @decision, @reasons, @questionPreview)"
);
const listLogStmt = db.prepare("SELECT * FROM cloud_egress_log ORDER BY at DESC LIMIT ?");

export interface EgressLogEntry {
  id: string;
  at: number;
  userId: string | null;
  provider: string | null;
  decision: "allowed" | "blocked";
  reasons: string[];
  questionPreview: string | null;
}

function logEgress(entry: { userId?: string; provider?: string | null; decision: "allowed" | "blocked"; reasons: string[]; question: string }): void {
  insertLogStmt.run({
    id: "cel" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"),
    at: Date.now(),
    userId: entry.userId ?? null,
    provider: entry.provider ?? null,
    decision: entry.decision,
    reasons: JSON.stringify(entry.reasons),
    questionPreview: (entry.question ?? "").slice(0, 120),
  });
}

export function listEgressLog(limit = 100): EgressLogEntry[] {
  const rows = listLogStmt.all(Math.min(Math.max(limit, 1), 500)) as {
    id: string; at: number; userId: string | null; provider: string | null; decision: string; reasons: string | null; questionPreview: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id, at: r.at, userId: r.userId, provider: r.provider,
    decision: r.decision === "blocked" ? "blocked" : "allowed",
    reasons: r.reasons ? (JSON.parse(r.reasons) as string[]) : [],
    questionPreview: r.questionPreview,
  }));
}

// ── 토큰 사용량·비용 (요금 화면 연동) ────────────────────────────────────────
const upsertUsageStmt = db.prepare(
  `INSERT INTO cloud_usage (provider, model, calls, inTokens, outTokens) VALUES (@provider, @model, 1, @inTokens, @outTokens)
   ON CONFLICT(provider, model) DO UPDATE SET calls = calls + 1, inTokens = inTokens + @inTokens, outTokens = outTokens + @outTokens`
);
const listUsageStmt = db.prepare("SELECT provider, model, calls, inTokens, outTokens FROM cloud_usage");

function recordCloudUsage(provider: CloudProvider, model: string, inTokens: number, outTokens: number): void {
  upsertUsageStmt.run({ provider, model, inTokens: Math.max(0, inTokens || 0), outTokens: Math.max(0, outTokens || 0) });
}

// 표준(유료) 요금 추정 단가 — 100만 토큰당 USD. 모델명 부분일치로 매칭, 없으면 제공자 기본값.
// ⚠ 요금은 수시로 바뀌고 무료 등급이면 실제 $0 — 어디까지나 "표준 요금 기준 예상"이다.
const RATE_PER_MTOK: { match: RegExp; in: number; out: number }[] = [
  { match: /gemini.*flash/i, in: 0.1, out: 0.4 },
  { match: /gemini.*pro/i, in: 1.25, out: 5.0 },
  { match: /claude.*(haiku)/i, in: 0.8, out: 4.0 },
  { match: /claude.*(sonnet)/i, in: 3.0, out: 15.0 },
  { match: /claude.*(opus)/i, in: 15.0, out: 75.0 },
  { match: /gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini/i, in: 0.15, out: 0.6 },
  { match: /gpt-4o|gpt-4\.1|gpt-5/i, in: 2.5, out: 10.0 },
];
function rateFor(model: string): { in: number; out: number } {
  return RATE_PER_MTOK.find((r) => r.match.test(model)) ?? { in: 0.5, out: 1.5 };
}

export interface CloudUsageRow {
  provider: CloudProvider;
  providerLabel: string;
  model: string;
  calls: number;
  inTokens: number;
  outTokens: number;
  estimatedCost: number; // 표준 요금 기준 예상 USD(무료 등급이면 실제 $0)
}

export function cloudUsageSummary(): { rows: CloudUsageRow[]; totalCalls: number; totalTokens: number; estimatedCost: number } {
  const rows = (listUsageStmt.all() as { provider: string; model: string; calls: number; inTokens: number; outTokens: number }[]).map((r) => {
    const rate = rateFor(r.model);
    const cost = (r.inTokens / 1_000_000) * rate.in + (r.outTokens / 1_000_000) * rate.out;
    return {
      provider: r.provider as CloudProvider,
      providerLabel: PROVIDER_LABEL[r.provider as CloudProvider] ?? r.provider,
      model: r.model,
      calls: r.calls,
      inTokens: r.inTokens,
      outTokens: r.outTokens,
      estimatedCost: Math.round(cost * 1_000_000) / 1_000_000,
    };
  });
  return {
    rows,
    totalCalls: rows.reduce((s, r) => s + r.calls, 0),
    totalTokens: rows.reduce((s, r) => s + r.inTokens + r.outTokens, 0),
    estimatedCost: Math.round(rows.reduce((s, r) => s + r.estimatedCost, 0) * 1_000_000) / 1_000_000,
  };
}

// ── provider 어댑터 ─────────────────────────────────────────────────────────
// text와 함께 토큰 사용량(요금 계측용)을 돌려준다. system을 인자로 받는다 — 대화(askCloud)는
// CLOUD_SYSTEM_PROMPT를, 문서 보강(cloudComplete)은 번역·구조화 프롬프트를 넣는다.
interface CloudCallResult {
  text: string;
  inTokens: number;
  outTokens: number;
}

async function callOpenAiCompatible(baseUrl: string, apiKey: string, model: string, system: string, user: string, maxTokens?: number): Promise<CloudCallResult> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.3,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  return { text: j.choices?.[0]?.message?.content ?? "", inTokens: j.usage?.prompt_tokens ?? 0, outTokens: j.usage?.completion_tokens ?? 0 };
}

async function callClaude(apiKey: string, model: string, system: string, user: string, maxTokens = 1024): Promise<CloudCallResult> {
  // Anthropic은 OpenAI 호환이 아니라 Messages API — system은 별도 필드, user 메시지만 배열로.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  return { text: j.content?.map((c) => c.text ?? "").join("") ?? "", inTokens: j.usage?.input_tokens ?? 0, outTokens: j.usage?.output_tokens ?? 0 };
}

async function callProvider(p: CloudProvider, apiKey: string, model: string, system: string, user: string, maxTokens?: number): Promise<CloudCallResult> {
  if (p === "openai") return callOpenAiCompatible("https://api.openai.com/v1", apiKey, model, system, user, maxTokens);
  if (p === "gemini") return callOpenAiCompatible("https://generativelanguage.googleapis.com/v1beta/openai", apiKey, model, system, user, maxTokens);
  return callClaude(apiKey, model, system, user, maxTokens);
}

// 저수준 완성 호출 — 활성 제공자·키를 재사용해 임의 system/user로 호출한다. 문서 보강(번역·구조화)
// 같은 내부 배치용. ⚠ egress 게이트를 타지 않으므로 호출자가 "외부로 나가도 되는 콘텐츠"임을
// 보장해야 한다(벤더 공개 매뉴얼 등). 내부 자산 데이터엔 절대 쓰지 말 것.
export async function cloudComplete(system: string, user: string, maxTokens = 4096): Promise<string> {
  if (!isEnabled()) throw new Error("클라우드 LLM이 비활성 상태입니다(설정에서 관리자가 켜야 합니다).");
  const provider = activeProvider();
  const key = providerKey(provider);
  if (!key) throw new Error(`${PROVIDER_LABEL[provider]} API 키가 없습니다.`);
  const model = providerModel(provider);
  const r = await callProvider(provider, key, model, system, user, maxTokens);
  recordCloudUsage(provider, model, r.inTokens, r.outTokens);
  return r.text;
}

// 제공자가 지금 이 키로 실제 쓸 수 있는 모델 목록을 조회한다 — 모델 별칭이 수시로 바뀌므로
// (실측 2026-07-19: gemini-2.0-flash·2.5-flash가 "신규 사용자 불가"로 404) admin이 유효한 모델을
// 고를 수 있게 한다. 실패는 빈 목록으로(진단용이라 치명적이지 않음).
async function listModelsFor(p: CloudProvider, apiKey: string): Promise<string[]> {
  try {
    if (p === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const j = (await res.json()) as { data?: { id: string }[] };
      return (j.data ?? []).map((m) => m.id);
    }
    const base = p === "openai" ? "https://api.openai.com/v1" : "https://generativelanguage.googleapis.com/v1beta/openai";
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { id: string }[] };
    return (j.data ?? []).map((m) => m.id.replace(/^models\//, ""));
  } catch {
    return [];
  }
}

// ── 게이트를 통과한 클라우드 질의 (이 함수만이 외부로 나가는 유일한 경로) ────────────────
export interface CloudAskResult {
  routedToCloud: boolean; // true면 answer가 클라우드 응답
  blocked: boolean; // true면 게이트가 막음 → 호출자가 로컬로 폴백
  reasons: string[]; // 차단 사유(blocked일 때)
  provider?: CloudProvider;
  providerLabel?: string;
  model?: string;
  answer?: string;
  error?: string;
}

export async function askCloud(question: string, user?: GijoUser): Promise<CloudAskResult> {
  let q = (question ?? "").trim(); // 관문(gate.text)의 개인정보 가림 반영본으로 갈아탄다

  if (!q) return { routedToCloud: false, blocked: false, reasons: [], error: "질문이 비어 있습니다." };
  if (!isEnabled()) return { routedToCloud: false, blocked: false, reasons: [], error: "클라우드 LLM이 비활성 상태입니다(설정에서 관리자가 켜야 합니다)." };

  const provider = activeProvider();
  const apiKey = providerKey(provider);
  if (!apiKey) return { routedToCloud: false, blocked: false, reasons: [], error: `${PROVIDER_LABEL[provider]} API 키가 설정돼 있지 않습니다.` };

  // 입력 관문 — 인젝션 시도는 밖으로 내보내지 않는다. 아래 screenForCloud(내부정보 유출 방지)와
  // 다른 검사다: 이쪽은 "이 요청이 AI를 조종하려는 것인가", 저쪽은 "우리 자료가 섞였는가".
  // 밖으로 나가는 경로일수록 관문을 먼저 지나야 한다(2026-07-30 — 여기만 관문 밖에 있었다).
  const gate = gateUserInput(q, "cloud");
  if (!gate.allowed) {
    logEgress({ userId: user?.id, provider, decision: "blocked", reasons: gate.categories, question: q });
    return { routedToCloud: false, blocked: true, reasons: gate.categories, error: gate.message };
  }
  // 밖으로 나가는 경로일수록 가림이 중요하다 — 주민·카드번호를 클라우드에 내보내지 않는다.
  q = gate.text;

  // 결정적 유출 방지 게이트 — 내부 식별자가 하나라도 걸리면 클라우드로 보내지 않는다.
  const decision = screenForCloud(q);
  if (!decision.allowed) {
    logEgress({ userId: user?.id, provider, decision: "blocked", reasons: decision.reasons, question: q });
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `클라우드 차단: 내부 정보 감지(${decision.reasons.join(" · ")}) — 로컬로 답합니다` });
    return { routedToCloud: false, blocked: true, reasons: decision.reasons };
  }

  const model = providerModel(provider);
  try {
    const r = await callProvider(provider, apiKey, model, CLOUD_SYSTEM_PROMPT, q);
    const answer = r.text;
    recordCloudUsage(provider, model, r.inTokens, r.outTokens);
    logEgress({ userId: user?.id, provider, decision: "allowed", reasons: [], question: q });
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `클라우드 질의: ${PROVIDER_LABEL[provider]}(${model}) — 내부정보 미포함 확인됨` });
    return { routedToCloud: true, blocked: false, reasons: [], provider, providerLabel: PROVIDER_LABEL[provider], model, answer };
  } catch (e) {
    return { routedToCloud: false, blocked: false, reasons: [], provider, error: `${PROVIDER_LABEL[provider]} 호출 실패: ${(e as Error).message}` };
  }
}

// ── 클라우드 답변을 지식베이스(RAG)에 저장 (4단계: 사람 승인 후에만) ──────────────
// 설계 원칙(2026-07-19): 클라우드 답변은 자동 인입하지 않는다 — 외부 생성물이라 환각·라이선스·
// 로컬 모델 종속 위험이 있다. 사용자가 명시적으로 "저장" 버튼을 눌러 승인한 것만, 그것도 "외부
// 클라우드 생성물이라 검증 필요"라는 경고 문구를 앞에 붙여 저장한다(RAG가 나중에 이걸 근거로
// 답할 때 그 성격을 알 수 있게). documentId에도 ☁를 붙여 '올린 문서 관리'에서 구분되게 한다.
export interface SaveToKbResult {
  documentId: string;
  chunks: number;
}

export async function saveCloudAnswerToKb(question: string, answer: string, providerLabel: string, model: string): Promise<SaveToKbResult> {
  const q = (question ?? "").trim();
  const a = (answer ?? "").trim();
  if (!a) throw new Error("저장할 답변이 없습니다.");
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const qSlug = q.replace(/\s+/g, " ").slice(0, 30) || "클라우드 답변";
  const documentId = `☁ ${qSlug} (${providerLabel}, ${stamp})`;
  const content = [
    `[클라우드 보조 답변 · ${providerLabel} ${model} · ${koDateTimeString(now.getTime())}]`,
    "⚠ 외부 클라우드 LLM이 생성한 내용입니다 — 사내 검증 근거가 아니므로 사실 확인 후 활용하세요.",
    "",
    `질문: ${q}`,
    "",
    "답변:",
    a,
  ].join("\n");
  // classify=false — 출처가 명확(클라우드)하므로 LLM 분류를 돌리지 않는다.
  const r = await ingestText(documentId, content, GLOBAL_SCOPE, undefined, false);
  emitCollaboration({ from: "orchestrator", to: "analysis", message: `클라우드 답변을 지식베이스에 저장(승인): ${documentId} — ${r.chunks}청크` });
  return { documentId, chunks: r.chunks };
}

// ── 라우트 ──────────────────────────────────────────────────────────────────
export function registerCloudLlmRoutes(app: Express): void {
  // 설정 조회 — 키 평문은 절대 안 내려주고 설정 여부(hasKey)만.
  app.get("/api/cloud/config", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(getCloudConfig());
  });

  // on/off·활성 provider·키·모델 설정 — 관리자 전용.
  app.post(
    "/api/cloud/config",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const body = req.body as { enabled?: boolean; activeProvider?: string; provider?: string; apiKey?: string; model?: string; clearKey?: boolean };

      if (typeof body.enabled === "boolean") setStateStmt.run("cloud:enabled", body.enabled ? "1" : "0");
      if (body.activeProvider && PROVIDERS.includes(body.activeProvider as CloudProvider)) {
        setStateStmt.run("cloud:provider", body.activeProvider);
      }

      // provider별 키/모델 설정. clearKey면 삭제, apiKey가 오면 암호화 저장, model만 오면 모델만 갱신.
      const p = body.provider as CloudProvider | undefined;
      if (p && PROVIDERS.includes(p)) {
        if (body.clearKey) {
          deleteKeyStmt.run(p);
        } else {
          const encryptedApiKey = body.apiKey ? encryptString(body.apiKey.trim(), getEncryptionKey()) : null;
          upsertKeyStmt.run({ provider: p, encryptedApiKey, model: (body.model ?? DEFAULT_MODEL[p]).trim() });
        }
      }
      res.json(getCloudConfig());
    })
  );

  // 게이트를 통과시켜 클라우드에 질의 — 누구나(로그인) 호출. 차단이면 blocked:true로 돌려주고
  // 클라이언트가 로컬로 폴백한다. 여기서만 외부로 나간다.
  app.post(
    "/api/cloud/ask",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const user = (req as Request & { user?: GijoUser }).user;
      const question = String((req.body as { question?: string })?.question ?? "");
      res.json(await askCloud(question, user));
    })
  );

  // 사용 가능 여부 — 비밀 없이 "클라우드가 켜져 있고 쓸 수 있는지"만. 비-admin도 대화에서 확인 가능.
  app.get("/api/cloud/status", authMiddleware, (_req, res) => {
    const p = activeProvider();
    res.json({ enabled: isEnabled() && hasKey(p), activeProvider: p, providerLabel: PROVIDER_LABEL[p] });
  });

  // 토큰 사용량·예상 비용 — 요금 화면(billing.html) 연동. 비밀 없음(제공자·모델·토큰·호출수만).
  app.get("/api/cloud/usage", authMiddleware, (_req, res) => {
    res.json(cloudUsageSummary());
  });

  // 이 키로 지금 쓸 수 있는 모델 목록 — 관리자 전용(모델 별칭이 자주 바뀌어 유효한 걸 고르게).
  app.get(
    "/api/cloud/models",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const p = String(req.query.provider || activeProvider()) as CloudProvider;
      if (!PROVIDERS.includes(p)) return res.status(400).json({ error: "알 수 없는 제공자" });
      const key = providerKey(p);
      if (!key) return res.status(400).json({ error: "이 제공자의 API 키가 없습니다." });
      const models = await listModelsFor(p, key);
      res.json({ provider: p, models });
    })
  );

  // 유출 방지 게이트 미리보기 — 실제 호출 없이 "이 질문이 클라우드로 나갈 수 있는지"만 판정(투명성).
  app.post("/api/cloud/screen", authMiddleware, (req, res) => {
    const question = String((req.body as { question?: string })?.question ?? "");
    res.json(screenForCloud(question));
  });

  // 감사 로그 — 관리자 전용.
  app.get("/api/cloud/egress-log", authMiddleware, adminMiddleware, (req, res) => {
    res.json(listEgressLog(Number(req.query.limit) || 100));
  });

  // 클라우드 답변을 지식베이스에 저장 — 사용자가 답변 아래 버튼을 눌러 명시적으로 승인한 경우만.
  app.post(
    "/api/cloud/save-to-kb",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { question, answer, providerLabel, model } = req.body as { question?: string; answer?: string; providerLabel?: string; model?: string };
      if (!answer) return res.status(400).json({ error: "answer가 필요합니다." });
      res.json(await saveCloudAnswerToKb(question ?? "", answer, providerLabel ?? "클라우드", model ?? ""));
    })
  );
}
