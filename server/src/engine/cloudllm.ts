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
import * as crypto from "crypto";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import type { GijoUser } from "../auth/users";
import { encryptString, decryptString, getEncryptionKey } from "./cryptopack";
import { screenForCloud } from "./cloudegress";
import { emitCollaboration } from "./collaboration";

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

// ── provider 어댑터 ─────────────────────────────────────────────────────────
async function callOpenAiCompatible(baseUrl: string, apiKey: string, model: string, question: string): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: CLOUD_SYSTEM_PROMPT }, { role: "user", content: question }],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}

async function callClaude(apiKey: string, model: string, question: string): Promise<string> {
  // Anthropic은 OpenAI 호환이 아니라 Messages API — system은 별도 필드, user 메시지만 배열로.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: CLOUD_SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],
    }),
    signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { content?: { text?: string }[] };
  return j.content?.map((c) => c.text ?? "").join("") ?? "";
}

async function callProvider(p: CloudProvider, apiKey: string, model: string, question: string): Promise<string> {
  if (p === "openai") return callOpenAiCompatible("https://api.openai.com/v1", apiKey, model, question);
  if (p === "gemini") return callOpenAiCompatible("https://generativelanguage.googleapis.com/v1beta/openai", apiKey, model, question);
  return callClaude(apiKey, model, question);
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
  const q = (question ?? "").trim();
  if (!q) return { routedToCloud: false, blocked: false, reasons: [], error: "질문이 비어 있습니다." };
  if (!isEnabled()) return { routedToCloud: false, blocked: false, reasons: [], error: "클라우드 LLM이 비활성 상태입니다(설정에서 관리자가 켜야 합니다)." };

  const provider = activeProvider();
  const apiKey = providerKey(provider);
  if (!apiKey) return { routedToCloud: false, blocked: false, reasons: [], error: `${PROVIDER_LABEL[provider]} API 키가 설정돼 있지 않습니다.` };

  // 결정적 유출 방지 게이트 — 내부 식별자가 하나라도 걸리면 클라우드로 보내지 않는다.
  const decision = screenForCloud(q);
  if (!decision.allowed) {
    logEgress({ userId: user?.id, provider, decision: "blocked", reasons: decision.reasons, question: q });
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `클라우드 차단: 내부 정보 감지(${decision.reasons.join(" · ")}) — 로컬로 답합니다` });
    return { routedToCloud: false, blocked: true, reasons: decision.reasons };
  }

  const model = providerModel(provider);
  try {
    const answer = await callProvider(provider, apiKey, model, q);
    logEgress({ userId: user?.id, provider, decision: "allowed", reasons: [], question: q });
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `클라우드 질의: ${PROVIDER_LABEL[provider]}(${model}) — 내부정보 미포함 확인됨` });
    return { routedToCloud: true, blocked: false, reasons: [], provider, providerLabel: PROVIDER_LABEL[provider], model, answer };
  } catch (e) {
    return { routedToCloud: false, blocked: false, reasons: [], provider, error: `${PROVIDER_LABEL[provider]} 호출 실패: ${(e as Error).message}` };
  }
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
}
