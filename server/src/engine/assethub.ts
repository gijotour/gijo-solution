// engine/assethub.ts — 자산 허브(자산 목록·AI-BOM·취약점 통합 뷰) 집계.
//
// 세 메뉴(자산 목록·AI-BOM·취약점)가 실제로는 같은 자산 레코드(assets)를 다른 각도로 보던 것을
// 하나의 "자산 중심" 모델로 합친다(CTEM 모범사례). 특히 AI 자산을 앞세워, LLM 보안(OWASP LLM
// Top 10 2025)을 자산의 실제 AI-BOM 필드로부터 규칙 기반으로 도출해 보여준다.
//
// 정직성: OWASP LLM 노출은 "AI-BOM 기재 상태·견고성 점검 결과"로부터 규칙으로 도출한 자동 점검치다
// (별도 침투테스트가 아니다). 판정 근거를 evidence로 함께 돌려줘 담당자가 사실을 확인할 수 있게 한다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { listAssets, getAsset, isAiAsset, type Asset } from "./assets";
import type { StandardFinding } from "./bridge";

export type OwaspStatus = "open" | "covered" | "na";

export interface OwaspRiskState {
  code: string; // "LLM01" 등
  title: string; // 한국어 짧은 이름
  status: OwaspStatus;
  evidence: string; // 판정 근거(어떤 AI-BOM 필드로 판단했는지)
}

export interface VulnCounts { critical: number; high: number; medium: number; low: number; kev: number; open: number }

export interface AssetHubRow {
  id: string;
  name: string;
  displayName: string | null; // 담당자가 붙인 표시 이름(별칭) — 있으면 화면은 이걸 보여준다
  sourceFile: string | null; // 이 자산이 등록된 출처 파일(finding.source_tool). 직접 등록이면 null
  assetType: string;
  isAi: boolean;
  owner: string;
  service: string | null;
  host: string | null; // 인프라 호스트/서비스(취약점 IP 연결 표시용)
  vuln: VulnCounts;
  bomAreas: { model: number; dataset: number; prompt: number; agentTool: number; infrastructure: number; total: number };
  sbomGenerated: boolean;
  robustnessScore: number | null; // 레드팀 견고성(있으면)
  owaspOpen: number; // 미대응 OWASP LLM 수(AI 자산만)
  owaspTopCodes: string[]; // 미대응 상위 코드(배지용)
  exposureScore: number; // 0~100 종합 노출점수
  riskBand: "critical" | "high" | "medium" | "ok";
}

// 비어있지 않은 문자열인가(AI-BOM 필드 기재 여부 판정).
function filled(s: string | undefined | null): boolean {
  return Boolean(s && s.trim());
}

// AI-BOM 영역별 "기재 항목 수" — 자유 텍스트 필드가 채워졌으면 1로 센다(구성 명세 충실도).
function bomAreaCounts(a: Asset) {
  const b = a.aibom;
  const model = [b.model.foundationModel, b.model.finetuneHistory, b.model.architecture, b.model.weightsHash, b.model.intendedUse, b.model.limitations, b.model.modelRef].filter(filled).length;
  const dataset = [b.dataset.sources, b.dataset.vectorDbLocation].filter(filled).length;
  const prompt = [b.prompt.systemPrompt, b.prompt.guardrails].filter(filled).length;
  const agentTool = [b.agentTool.apis, b.agentTool.mcpServers].filter(filled).length;
  const infrastructure = [b.infrastructure.compute, b.infrastructure.hostingProvider].filter(filled).length;
  return { model, dataset, prompt, agentTool, infrastructure, total: model + dataset + prompt + agentTool + infrastructure };
}

// OWASP LLM Top 10(2025) 노출을 자산의 실제 AI-BOM 필드로부터 규칙으로 도출한다.
// open=미대응(노출), covered=대응 근거 있음, na=이 자산엔 해당 없음.
export function deriveOwaspRisks(a: Asset): OwaspRiskState[] {
  const b = a.aibom;
  const hasGuardrails = filled(b.prompt.guardrails);
  const hasSystemPrompt = filled(b.prompt.systemPrompt);
  const hasTools = filled(b.agentTool.apis) || filled(b.agentTool.mcpServers);
  const hasVectorDb = filled(b.dataset.vectorDbLocation);
  const hasDataSources = filled(b.dataset.sources);
  const robust = b.robustness.score;
  const R: OwaspRiskState[] = [];

  // LLM01 프롬프트 인젝션 — 가드레일·견고성 점검이 방어 근거.
  R.push(robust !== null && robust >= 60 && hasGuardrails
    ? { code: "LLM01", title: "프롬프트 인젝션", status: "covered", evidence: `가드레일 기재 + 견고성 ${robust}점` }
    : { code: "LLM01", title: "프롬프트 인젝션", status: "open", evidence: robust === null ? "레드팀 견고성 미점검 + 가드레일 확인 필요" : !hasGuardrails ? "가드레일 미기재" : `견고성 ${robust}점(<60)` });

  // LLM02 민감정보 유출 — 가드레일/출력필터 근거.
  R.push(hasGuardrails
    ? { code: "LLM02", title: "민감정보 유출", status: "covered", evidence: "가드레일 기재(출력 통제 근거)" }
    : { code: "LLM02", title: "민감정보 유출", status: "open", evidence: "가드레일·출력필터 미기재" });

  // LLM03 공급망 — AI-BOM/SBOM 생성 여부가 공급망 가시성 근거.
  R.push(a.sbomGeneratedAt
    ? { code: "LLM03", title: "공급망(모델·데이터)", status: "covered", evidence: "AI-BOM/SBOM 생성됨" }
    : { code: "LLM03", title: "공급망(모델·데이터)", status: "open", evidence: "AI-BOM/SBOM 미생성 — 구성요소 출처 미검증" });

  // LLM04 데이터·모델 중독 — 데이터 출처 기재가 무결성 근거.
  R.push(hasDataSources
    ? { code: "LLM04", title: "데이터·모델 중독", status: "covered", evidence: "데이터 출처 기재됨" }
    : { code: "LLM04", title: "데이터·모델 중독", status: "open", evidence: "학습·튜닝 데이터 출처 미기재" });

  // LLM05 부적절 출력 처리 — 도구 연동이 있는데 가드레일이 없으면 위험.
  R.push(!hasTools
    ? { code: "LLM05", title: "부적절 출력 처리", status: "na", evidence: "후속 시스템(도구) 연동 없음" }
    : hasGuardrails
    ? { code: "LLM05", title: "부적절 출력 처리", status: "covered", evidence: "도구 연동 + 가드레일 기재" }
    : { code: "LLM05", title: "부적절 출력 처리", status: "open", evidence: "도구 연동 있으나 출력 통제 미기재" });

  // LLM06 과도한 에이전트 권한 — 도구/에이전트가 있으면 권한 검토 필요.
  R.push(!hasTools
    ? { code: "LLM06", title: "과도한 에이전트 권한", status: "na", evidence: "연동 도구·에이전트 없음" }
    : { code: "LLM06", title: "과도한 에이전트 권한", status: "open", evidence: "도구/에이전트 연동 — 권한 최소화·승인 검토 필요" });

  // LLM07 시스템 프롬프트 유출 — 시스템 프롬프트가 있는데 가드레일 없으면 노출.
  R.push(!hasSystemPrompt
    ? { code: "LLM07", title: "시스템 프롬프트 유출", status: "na", evidence: "시스템 프롬프트 미기재" }
    : hasGuardrails
    ? { code: "LLM07", title: "시스템 프롬프트 유출", status: "covered", evidence: "시스템 프롬프트 + 가드레일" }
    : { code: "LLM07", title: "시스템 프롬프트 유출", status: "open", evidence: "시스템 프롬프트 있으나 외부 가드레일 미기재" });

  // LLM08 벡터·임베딩 약점 — 벡터DB(RAG)를 쓰면 접근통제 검토 필요.
  R.push(!hasVectorDb
    ? { code: "LLM08", title: "벡터·임베딩 약점", status: "na", evidence: "벡터DB(RAG) 미사용" }
    : { code: "LLM08", title: "벡터·임베딩 약점", status: "open", evidence: "벡터DB 사용 — 접근통제·데이터 분할 검토 필요" });

  return R;
}

// 취약점(findings) 심각도 집계.
function vulnCounts(findings: StandardFinding[]): VulnCounts {
  const c = { critical: 0, high: 0, medium: 0, low: 0, kev: 0, open: 0 };
  for (const f of findings) {
    if (f.state === "fixed") continue; // 해소된 것은 현재 노출로 세지 않는다
    c.open++;
    c[f.severity]++;
    if (f.kev) c.kev++;
  }
  return c;
}

// 종합 노출점수(0~100) — 취약점 심각도 + AI 위험 미대응 + 외부노출 가중. 결정적 규칙.
function exposureScore(v: VulnCounts, owaspOpen: number, external: boolean): number {
  let s = 0;
  // Critical 하나만으로도 "높음" 밴드에 들도록 가중을 크게 준다(단일 Critical=45).
  s += Math.min(60, v.critical * 45 + v.high * 20 + v.medium * 8 + v.low * 3);
  s += v.kev * 12;
  s += owaspOpen * 7; // AI 위험 미대응 1건당 가중
  if (external) s += 10; // 인터넷/외부 노출 자산 가중
  return Math.min(100, s);
}

function bandOf(score: number): AssetHubRow["riskBand"] {
  return score >= 75 ? "critical" : score >= 45 ? "high" : score >= 18 ? "medium" : "ok";
}

// 인프라 호스트/서비스 표기 — 취약점 IP 연결을 보여주기 위한 표시용 문자열.
function hostOf(a: Asset): string | null {
  const infra = a.aibom.infrastructure;
  return filled(infra.hostingProvider) ? infra.hostingProvider.trim() : (a.service ? a.service : null);
}

// 이 자산이 어느 파일로 등록됐는지 — findings의 source_tool(업로드 파일명)에서 뽑는다.
// 취약점 임포터(vulnscan/webreport)가 sourceLabel로 파일명을 넣으므로 별도 저장이 필요 없다.
// 여러 파일이 섞이면(재점검 등) 가장 많이 등장한 것을 대표로 본다. findings가 없으면 null(직접 등록).
export function sourceFileOf(a: Asset): string | null {
  const tally = new Map<string, number>();
  for (const f of a.findings) {
    const src = (f.source_tool ?? "").trim();
    if (src) tally.set(src, (tally.get(src) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  return [...tally.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
}

// 파일(출처) 단위 묶음 — "올린 파일 기준으로 자산을 정리해서 본다"(2026-07-25 사용자 요청).
export interface HubSourceGroup {
  sourceFile: string | null; // null = 직접 등록(파일 없음)
  label: string; // 화면 표시용 이름
  assetIds: string[];
  assetCount: number;
  vuln: VulnCounts; // 이 파일이 가져온 취약점 합계
  lastScannedAt: number | null; // 이 묶음의 최근 점검 시각
}

export function buildSourceGroups(rows: AssetHubRow[], assets: Asset[]): HubSourceGroup[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const groups = new Map<string, HubSourceGroup>();
  for (const r of rows) {
    const key = r.sourceFile ?? "";
    const cur =
      groups.get(key) ??
      ({
        sourceFile: r.sourceFile,
        label: r.sourceFile ?? "직접 등록 (파일 없음)",
        assetIds: [],
        assetCount: 0,
        vuln: { open: 0, critical: 0, high: 0, medium: 0, low: 0, kev: 0 },
        lastScannedAt: null,
      });
    cur.assetIds.push(r.id);
    cur.assetCount++;
    cur.vuln = {
      open: cur.vuln.open + r.vuln.open,
      critical: cur.vuln.critical + r.vuln.critical,
      high: cur.vuln.high + r.vuln.high,
      medium: cur.vuln.medium + r.vuln.medium,
      low: cur.vuln.low + r.vuln.low,
      kev: cur.vuln.kev + r.vuln.kev,
    };
    const scanned = byId.get(r.id)?.lastScannedAt ?? null;
    if (scanned && (!cur.lastScannedAt || scanned > cur.lastScannedAt)) cur.lastScannedAt = scanned;
    groups.set(key, cur);
  }
  // 파일로 등록된 묶음을 먼저(취약점 많은 순), 직접 등록은 마지막.
  return [...groups.values()].sort((x, y) => {
    if (!x.sourceFile !== !y.sourceFile) return x.sourceFile ? -1 : 1;
    return y.vuln.open - x.vuln.open || x.label.localeCompare(y.label);
  });
}

export function buildHubRow(a: Asset): AssetHubRow {
  const ai = isAiAsset(a);
  const v = vulnCounts(a.findings);
  const bomAreas = bomAreaCounts(a);
  const owasp = ai ? deriveOwaspRisks(a) : [];
  const open = owasp.filter((o) => o.status === "open");
  const external = /인터넷|external|public|외부/i.test((a.aibom.infrastructure.hostingProvider || "") + " " + (a.service || ""));
  const score = exposureScore(v, open.length, external);
  return {
    id: a.id,
    name: a.name,
    displayName: a.displayName ?? null,
    sourceFile: sourceFileOf(a),
    assetType: a.assetType,
    isAi: ai,
    owner: a.owner,
    service: a.service,
    host: hostOf(a),
    vuln: v,
    bomAreas,
    sbomGenerated: Boolean(a.sbomGeneratedAt),
    robustnessScore: a.aibom.robustness.score,
    owaspOpen: open.length,
    owaspTopCodes: open.slice(0, 3).map((o) => o.code),
    exposureScore: score,
    riskBand: bandOf(score),
  };
}

export interface HubSummary {
  totalAssets: number;
  aiAssets: number;
  itAssets: number;
  overallExposure: number; // 전 자산 노출점수 가중 평균(자산 위험도 대표값)
  bands: { aiAssetAvg: number; externalAvg: number; internalAvg: number };
  owaspOpenByCode: { code: string; title: string; count: number }[]; // AI 위험 미대응 집계
  vuln: { open: number; critical: number; high: number; medium: number; kev: number };
  sbomMissing: number;
}

export function buildHub(): { summary: HubSummary; rows: AssetHubRow[]; sourceGroups: HubSourceGroup[] } {
  const assets = listAssets();
  const rows = assets.map(buildHubRow);
  // AI 자산을 노출점수 내림차순으로 먼저, 그 다음 IT 자산.
  rows.sort((x, y) => (x.isAi === y.isAi ? y.exposureScore - x.exposureScore : x.isAi ? -1 : 1));

  const aiRows = rows.filter((r) => r.isAi);
  const itRows = rows.filter((r) => !r.isAi);
  const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : 0);

  // OWASP 미대응 코드별 집계(AI 자산 전체).
  const owaspMap = new Map<string, { title: string; count: number }>();
  for (const a of assets) {
    if (!isAiAsset(a)) continue;
    for (const o of deriveOwaspRisks(a)) {
      if (o.status !== "open") continue;
      const cur = owaspMap.get(o.code) ?? { title: o.title, count: 0 };
      cur.count++;
      owaspMap.set(o.code, cur);
    }
  }
  const owaspOpenByCode = [...owaspMap.entries()]
    .map(([code, v]) => ({ code, title: v.title, count: v.count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const vuln = rows.reduce(
    (acc, r) => ({ open: acc.open + r.vuln.open, critical: acc.critical + r.vuln.critical, high: acc.high + r.vuln.high, medium: acc.medium + r.vuln.medium, kev: acc.kev + r.vuln.kev }),
    { open: 0, critical: 0, high: 0, medium: 0, kev: 0 }
  );

  const externalRows = rows.filter((r) => /인터넷|external|public|외부/i.test((r.host || "") + " " + (r.service || "")));
  const summary: HubSummary = {
    totalAssets: rows.length,
    aiAssets: aiRows.length,
    itAssets: itRows.length,
    overallExposure: avg(rows.map((r) => r.exposureScore)),
    bands: {
      aiAssetAvg: avg(aiRows.map((r) => r.exposureScore)),
      externalAvg: avg(externalRows.map((r) => r.exposureScore)),
      internalAvg: avg(rows.filter((r) => !externalRows.includes(r)).map((r) => r.exposureScore)),
    },
    owaspOpenByCode,
    vuln,
    sbomMissing: aiRows.filter((r) => !r.sbomGenerated).length,
  };
  return { summary, rows, sourceGroups: buildSourceGroups(rows, assets) };
}

// 자산 상세(허브 디테일 탭용) — 허브 row + OWASP 전체 상태 + 취약점 목록.
export function buildHubDetail(assetId: string) {
  const a = getAsset(assetId);
  if (!a) return undefined;
  const row = buildHubRow(a);
  const owasp = row.isAi ? deriveOwaspRisks(a) : [];
  const findings = a.findings
    .filter((f) => f.state !== "fixed")
    .map((f) => ({ title: f.finding_type, severity: f.severity, kev: Boolean(f.kev), evidence: f.evidence?.slice(0, 200) ?? "", state: f.state ?? "active" }));
  return { row, owasp, findings, aibom: a.aibom, host: row.host };
}

export function registerAssetHubRoutes(app: Express): void {
  app.get("/api/assethub", authMiddleware, (_req, res) => {
    res.json(buildHub());
  });
  app.get("/api/assethub/:id", authMiddleware, (req, res) => {
    const detail = buildHubDetail(req.params.id);
    if (!detail) { res.status(404).json({ error: "자산을 찾을 수 없습니다" }); return; }
    res.json(detail);
  });
}
