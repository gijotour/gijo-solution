// engine/compliance.ts — KISA AI 보안 위협 대응 매뉴얼 기반 규제 프레임워크 대응 현황
//
// 출처: 한국인터넷진흥원(KISA) AI Security Red Team, 「AI 보안 위협 대응 매뉴얼」(2026.7),
// 별첨1 "LLM 보안 위협 및 국제 프레임워크 매핑표". 매뉴얼의 위협 분류 코드(D/M/A/S/H)를
// OWASP LLM Top 10 · NIST AML · MITRE ATLAS에 매핑한 정적 카탈로그다.
// 각 위협은 우리 AI-BOM 5영역(assets.ts의 AiBom)과도 연결해, 자산 구성명세 → 노출 위협 →
// 국제 프레임워크 → 대응 현황이 하나로 이어지게 한다. threat.html 가짜 데이터와 달리 실제
// 규제기관 문서 기반이라 그대로 신뢰 가능하다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db, assertTestDb } from "../db";
import { THREAT_CRITERIA } from "./compliance-criteria";
import { getAsset, type AiBom } from "./assets";

export type ThreatCategory = "data" | "model" | "agent" | "supplychain" | "highperf";
export type AiBomArea = "model" | "dataset" | "prompt" | "agentTool" | "infrastructure";
export type ComplianceStatus = "covered" | "partial" | "na" | "open";

export interface ThreatEntry {
  code: string;
  category: ThreatCategory;
  name: string;
  aibomAreas: AiBomArea[]; // 이 위협이 관련되는 AI-BOM 영역(주 영역)
  owasp: string[];
  nist: string[];
  mitre: string[];
}

// 별첨1 매핑표를 그대로 옮긴 카탈로그(20개 위협).
export const THREAT_CATALOG: ThreatEntry[] = [
  { code: "D01", category: "data", name: "불균형 데이터", aibomAreas: ["dataset"], owasp: ["LLM04:2025 Data and Model Poisoning"], nist: ["AML.013 Data Poisoning"], mitre: ["AML.T0020 Poison Training Data"] },
  { code: "D02", category: "data", name: "부정확한 데이터", aibomAreas: ["dataset"], owasp: ["LLM04:2025 Data and Model Poisoning"], nist: ["AML.013 Data Poisoning"], mitre: ["AML.T0019 Publish Poisoned Datasets", "AML.T0020 Poison Training Data"] },
  { code: "D03", category: "data", name: "개인정보 비식별화 미흡", aibomAreas: ["dataset"], owasp: ["LLM02:2025 Sensitive Information Disclosure"], nist: [], mitre: [] },
  { code: "M01", category: "model", name: "학습 데이터 유출", aibomAreas: ["model", "dataset"], owasp: ["LLM02:2025 Sensitive Information Disclosure", "LLM10:2025 Unbounded Consumption"], nist: ["AML.032 Reconstruction", "AML.033 Membership Inference"], mitre: ["AML.T0024.002 Extract AI Model"] },
  { code: "M02", category: "model", name: "벡터 DB·임베딩 유출", aibomAreas: ["dataset"], owasp: ["LLM08:2025 Vector and Embedding Weaknesses"], nist: ["AML.035 Prompt Extraction", "AML.038 Data Extraction"], mitre: ["AML.T0057 LLM Data Leakage", "AML.T0085.000 RAG Databases"] },
  { code: "M03", category: "model", name: "시스템 프롬프트 유출", aibomAreas: ["prompt"], owasp: ["LLM07:2025 System Prompt Leakage"], nist: ["AML.038 Data Extraction"], mitre: ["AML.T0056 Extract LLM System Prompt"] },
  { code: "M04", category: "model", name: "모델 유출", aibomAreas: ["model"], owasp: ["LLM10:2023 Model Theft"], nist: ["AML.031 Model Extraction"], mitre: ["AML.T0024.002 Extract AI Model"] },
  { code: "M05", category: "model", name: "환각", aibomAreas: ["model", "prompt"], owasp: ["LLM09:2025 Misinformation"], nist: [], mitre: ["AML.T0062 Discover LLM Hallucinations"] },
  { code: "M06", category: "model", name: "탈옥", aibomAreas: ["prompt"], owasp: ["LLM01:2025 Prompt Injection"], nist: ["AML.018 Prompt Injection"], mitre: ["AML.T0054 LLM Jailbreak"] },
  { code: "M07", category: "model", name: "부적절한 출력 처리", aibomAreas: ["model", "agentTool"], owasp: ["LLM05:2025 Improper Output Handling"], nist: ["AML.027 Misaligned Outputs"], mitre: ["AML.T0067 LLM Trusted Output Components Manipulation"] },
  { code: "M08", category: "model", name: "모델 DoS", aibomAreas: ["infrastructure"], owasp: ["LLM10:2025 Unbounded Consumption"], nist: ["AML.016 Availability Attacks"], mitre: ["AML.T0029 Denial of AI Service"] },
  { code: "A01", category: "agent", name: "부적절한 도구 설계", aibomAreas: ["agentTool"], owasp: ["LLM06:2025 Excessive Agency"], nist: ["AML.018 Prompt Injection"], mitre: ["AML.T0053", "AML.T0081", "AML.T0086"] },
  { code: "A02", category: "agent", name: "에이전트 하이재킹", aibomAreas: ["prompt", "agentTool"], owasp: ["LLM01:2025 Prompt Injection", "LLM06:2025 Excessive Agency"], nist: ["AML.015 Indirect Prompt Injection"], mitre: ["AML.T0051.001 LLM Prompt Injection - Indirect"] },
  { code: "A03", category: "agent", name: "에이전트 DoS", aibomAreas: ["agentTool", "infrastructure"], owasp: ["LLM10:2025 Unbounded Consumption"], nist: ["AML.01 Availability Violations"], mitre: ["AML.T0029 Denial of AI Service", "AML.T0034 Cost Harvesting"] },
  { code: "A04", category: "agent", name: "에이전트 메모리 오염", aibomAreas: ["agentTool", "dataset"], owasp: ["LLM01:2025 Prompt Injection", "LLM08:2025 Vector and Embedding Weaknesses"], nist: ["AML.023 Backdoor Poisoning"], mitre: ["AML.T0080.001 AI Agent Context Poisoning: Memory"] },
  { code: "S01", category: "supplychain", name: "데이터 포이즈닝", aibomAreas: ["dataset"], owasp: ["LLM03:2025 Supply Chain", "LLM04:2025 Data and Model Poisoning"], nist: ["AML.05 Supply Chain Attacks"], mitre: ["AML.T0010.002 AI Supply Chain Compromise: Data"] },
  { code: "S02", category: "supplychain", name: "모델 포이즈닝", aibomAreas: ["model"], owasp: ["LLM03:2025 Supply Chain", "LLM04:2025 Data and Model Poisoning"], nist: ["AML.05 Supply Chain Attacks"], mitre: ["AML.T0018", "AML.T0031", "AML.T0058"] },
  { code: "S03", category: "supplychain", name: "취약한 버전의 추론 엔진 사용", aibomAreas: ["infrastructure"], owasp: ["LLM03:2025 Supply Chain"], nist: ["AML.05 Supply Chain Attacks"], mitre: ["AML.T0010.001 AI Supply Chain Compromise: AI Software"] },
  { code: "S04", category: "supplychain", name: "취약한 버전의 에이전트 확장요소 사용", aibomAreas: ["agentTool"], owasp: ["LLM03:2025 Supply Chain"], nist: ["AML.05 Supply Chain Attacks"], mitre: ["AML.T0010.005 AI Supply Chain Compromise: AI Agent Tool"] },
  { code: "H01", category: "highperf", name: "고도화된 사이버 공격 지원", aibomAreas: ["infrastructure"], owasp: [], nist: [], mitre: ["AML.T0048 External Harms"] },
  { code: "H02", category: "highperf", name: "자율성으로 인한 통제 상실", aibomAreas: ["agentTool"], owasp: ["LLM06:2025 Excessive Agency"], nist: [], mitre: [] },
];

export const CATEGORY_LABEL: Record<ThreatCategory, string> = {
  data: "데이터 위협",
  model: "모델 위협",
  agent: "에이전트 위협",
  supplychain: "공급망 위협",
  highperf: "고성능 모델 위협",
};

// 조직 차원의 위협별 대응 현황. 위협 코드별로 상태/메모를 저장한다.
const getStatusStmt = db.prepare("SELECT threatCode, status, note, updatedAt FROM compliance_status");
const upsertStatusStmt = db.prepare(
  "INSERT INTO compliance_status (threatCode, status, note, updatedAt) VALUES (@threatCode, @status, @note, @updatedAt) ON CONFLICT(threatCode) DO UPDATE SET status = excluded.status, note = excluded.note, updatedAt = excluded.updatedAt"
);

interface StatusRow {
  threatCode: string;
  status: ComplianceStatus;
  note: string | null;
  updatedAt: number;
}

export interface ThreatWithStatus extends ThreatEntry {
  categoryLabel: string;
  status: ComplianceStatus;
  note: string;
  updatedAt: number | null;
  // 별첨2 평가기준·진단방법 — 위협을 펼쳤을 때 대응 상태 판단의 근거로 보여준다.
  criteria: { impact: string; good: string; weak: string; diagnosis: string };
}

export function listCompliance(): ThreatWithStatus[] {
  const statusMap = new Map((getStatusStmt.all() as StatusRow[]).map((r) => [r.threatCode, r]));
  return THREAT_CATALOG.map((t) => {
    const s = statusMap.get(t.code);
    return {
      ...t,
      categoryLabel: CATEGORY_LABEL[t.category],
      status: s?.status ?? "open",
      note: s?.note ?? "",
      updatedAt: s?.updatedAt ?? null,
      criteria: THREAT_CRITERIA[t.code] ?? { impact: "", good: "", weak: "", diagnosis: "" },
    };
  });
}

const VALID_STATUS: ComplianceStatus[] = ["covered", "partial", "na", "open"];

export function setComplianceStatus(threatCode: string, status: ComplianceStatus, note: string): void {
  if (!THREAT_CATALOG.some((t) => t.code === threatCode)) throw new Error(`알 수 없는 위협 코드: ${threatCode}`);
  if (!VALID_STATUS.includes(status)) throw new Error(`알 수 없는 상태: ${status}`);
  upsertStatusStmt.run({ threatCode, status, note: note || null, updatedAt: Date.now() });
}

// AI 초안(자동 triage) — 위협의 양호/취약 기준 + 조직의 실제 AI 자산 현황을 근거로 대응 상태
// 초안(status + 근거 note)을 로컬 LLM이 제안한다. 자동 저장 아님(담당자 검토 후 PUT). 21개를
// 첫날부터 수작업 평가하는 부담을 줄이는 게 목적.
export async function buildComplianceDraft(code: string): Promise<{ status: ComplianceStatus; note: string }> {
  const threat = listCompliance().find((t) => t.code === code);
  if (!threat) throw new Error(`알 수 없는 위협 코드: ${code}`);

  // 조직 현황 요약 — 실제 자산 데이터 기반(지어내지 않게).
  const { listAssets } = await import("./assets.js");
  const assets = listAssets();
  const withAibom = assets.filter((a) => a.aibom && JSON.stringify(a.aibom).replace(/[{}":,\s]/g, "").length > 0).length;
  const findings = assets.reduce((n, a) => n + (a.findings?.length ?? 0), 0);
  const context = `등록 AI 자산 ${assets.length}개, AI-BOM 작성 ${withAibom}개, 스캔 취약점 ${findings}건`;

  const prompt = [
    `KISA AI 보안 위협 대응 현황 평가 초안을 작성하세요.`,
    `위협: ${threat.name} (${threat.categoryLabel})`,
    `[양호(대응됨) 기준] ${threat.criteria.good || "-"}`,
    `[취약(미흡) 기준] ${threat.criteria.weak || "-"}`,
    `[우리 조직 현황] ${context}`,
    "",
    "규칙:",
    "- 첫 줄에 정확히 다음 중 하나만: '상태: covered'(충분히 대응) / '상태: partial'(부분 대응) / '상태: na'(해당 없음) / '상태: open'(미대응).",
    "- 그다음 줄부터 담당자가 확인할 근거와 권장 조치를 2~3문장으로.",
    "- 반드시 한국어로만 작성(중국어·일본어 금지). 주어진 현황 범위 안에서만 판단하고 지어내지 마세요.",
  ].join("\n");

  const { chat } = await import("./llm.js");
  const reply = await chat({ agentId: "orchestrator", message: prompt, remember: false, maxTokens: 400 });

  const m = reply.match(/상태\s*[:：]\s*(covered|partial|na|open)/i);
  const status = (m ? (m[1].toLowerCase() as ComplianceStatus) : "partial");
  // 첫 '상태:' 줄을 제외한 나머지를 근거 note로.
  const note = reply.replace(/^[^\n]*상태\s*[:：]\s*(covered|partial|na|open)[^\n]*\n?/im, "").trim() || reply.trim();
  return { status, note: `🤖 AI 초안(검토 필요) · ${note}` };
}

export function resetComplianceForTests(): void {
  assertTestDb("resetComplianceForTests");
  db.exec("DELETE FROM compliance_status");
}

// ── AI-BOM ↔ KISA 위협 자동 매칭 (거버넌스 연계) ──────────────────────────
// 자산의 AI-BOM에서 "채워진 영역"을 보고, 그 영역과 연결된 위협을 노출 위협으로 매칭한다.
// 조직 대응 상태(covered/partial/na/open)를 결합해 "이 AI 자산이 어떤 위협에 노출됐고 대응됐는지"를 준다.
function filledAiBomAreas(aibom: AiBom): Set<AiBomArea> {
  const s = new Set<AiBomArea>();
  const any = (o: Record<string, string>) => Object.values(o).some((v) => (v ?? "").trim() !== "");
  if (any(aibom.model)) s.add("model");
  if (any(aibom.dataset)) s.add("dataset");
  if (any(aibom.prompt)) s.add("prompt");
  if (any(aibom.agentTool)) s.add("agentTool");
  if (any(aibom.infrastructure)) s.add("infrastructure");
  return s;
}

export interface AiBomThreatMatch {
  code: string;
  name: string;
  category: ThreatCategory;
  categoryLabel: string;
  matchedAreas: AiBomArea[];
  status: ComplianceStatus;
  owasp: string[];
  nist: string[];
}
export interface AiBomThreatReport {
  assetId: string;
  assetName: string;
  matches: AiBomThreatMatch[];
  summary: { relevant: number; covered: number; partial: number; na: number; open: number };
}

const STATUS_RANK: Record<ComplianceStatus, number> = { open: 0, partial: 1, na: 2, covered: 3 };

export function aibomThreatMatches(assetId: string): AiBomThreatReport {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("자산을 찾을 수 없습니다");
  const filled = filledAiBomAreas(asset.aibom);
  const statusMap = new Map((getStatusStmt.all() as StatusRow[]).map((r) => [r.threatCode, r.status]));
  const matches: AiBomThreatMatch[] = [];
  const summary = { relevant: 0, covered: 0, partial: 0, na: 0, open: 0 };
  for (const t of THREAT_CATALOG) {
    const matchedAreas = t.aibomAreas.filter((a) => filled.has(a));
    if (matchedAreas.length === 0) continue;
    const status = statusMap.get(t.code) ?? "open";
    matches.push({
      code: t.code,
      name: t.name,
      category: t.category,
      categoryLabel: CATEGORY_LABEL[t.category],
      matchedAreas,
      status,
      owasp: t.owasp,
      nist: t.nist,
    });
    summary.relevant++;
    if (status === "covered") summary.covered++;
    else if (status === "partial") summary.partial++;
    else if (status === "na") summary.na++;
    else summary.open++;
  }
  matches.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.code.localeCompare(b.code));
  return { assetId, assetName: asset.name, matches, summary };
}

export function registerComplianceRoutes(app: Express): void {
  app.get("/api/compliance", authMiddleware, (_req, res) => res.json(listCompliance()));
  // AI-BOM 기반 자산별 노출 위협 + 대응 현황(거버넌스 연계).
  app.get("/api/assets/:id/aibom/threats", authMiddleware, (req, res) => {
    try {
      res.json(aibomThreatMatches(String(req.params.id)));
    } catch (e) {
      res.status(404).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  // AI 초안 — 위협별 대응 상태 제안(저장 아님, 담당자 검토용).
  app.post("/api/compliance/:code/draft", authMiddleware, asyncRoute(async (req, res) => {
    res.json(await buildComplianceDraft(String(req.params.code)));
  }));
  app.put("/api/compliance/:code", authMiddleware, (req, res) => {
    try {
      setComplianceStatus(String(req.params.code), req.body.status, String(req.body.note ?? ""));
      res.json(listCompliance().find((t) => t.code === String(req.params.code)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
