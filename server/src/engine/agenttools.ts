// engine/agenttools.ts — 에이전트 루프가 호출할 수 있는 도구 레지스트리.
// 메뉴 하나씩 확장한다(계획서 §4): 1차 「AI 자산」 조회 도구부터. 쓰기 도구는 Phase 2에서
// 확인 카드와 함께 추가한다(write:true는 루프가 실행을 거부하고 안내만 한다).
//
// 원칙(QA 보고서 2026-07-17): 판단·검증·실행은 여기(규칙 코드), LLM은 도구 선택·인자 추출만.
// 도구 결과는 LLM에 재주입되므로 장황한 JSON 대신 짧은 한국어 요약 텍스트를 돌려준다.

import { listAssets, getAsset, Asset } from "./assets";

export interface AgentToolParam {
  name: string;
  description: string;
  required: boolean;
}

export interface AgentTool {
  name: string;
  domain: string; // 메뉴 단위 도메인("assets" 등) — 도구 15개 초과 시 도메인 라우팅에 쓴다
  write: boolean; // true면 상태를 바꾸는 도구 — Phase 2 확인 카드 전까지 루프가 실행 거부
  description: string; // LLM에게 보여줄 한 줄 설명(한국어)
  params: AgentToolParam[];
  run: (args: Record<string, string>) => Promise<string> | string;
}

// ── 「AI 자산」 도구 구현 ────────────────────────────────────────────────

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

function findingSummary(asset: Asset): string {
  if (asset.findings.length === 0) return "finding 없음";
  const counts = SEVERITY_ORDER.map((s) => [s, asset.findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`)
    .join(", ");
  return `finding ${asset.findings.length}건 (${counts})`;
}

function runListAssets(): string {
  const assets = listAssets();
  if (assets.length === 0) return "등록된 AI 자산이 없습니다.";
  const lines = assets.map(
    (a) => `- ${a.id} | ${a.name} | 유형=${a.assetType} | 담당=${a.owner || "미지정"} | ${findingSummary(a)}`
  );
  return [`등록된 AI 자산 ${assets.length}개:`, ...lines].join("\n").slice(0, 2000);
}

function runGetAsset(args: Record<string, string>): string {
  const asset = getAsset(args.assetId);
  if (!asset) {
    const ids = listAssets().map((a) => a.id).join(", ") || "(없음)";
    return `자산 "${args.assetId}"을(를) 찾을 수 없습니다. 등록된 자산 id: ${ids}`;
  }
  const top = asset.findings
    .slice()
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 5)
    .map((f) => `  - [${f.severity}] ${f.finding_type}: ${f.evidence.slice(0, 80)}`);
  return [
    `자산 ${asset.id} (${asset.name})`,
    `유형=${asset.assetType} | 담당=${asset.owner || "미지정"} | 서비스=${asset.service ?? "미지정"} | 경로=${asset.path}`,
    `마지막 스캔: ${asset.lastScannedAt ? new Date(asset.lastScannedAt).toLocaleString("ko-KR") : "스캔 이력 없음"} | ${findingSummary(asset)}`,
    ...(top.length ? ["주요 finding(심각도순, 최대 5건):", ...top] : []),
  ].join("\n").slice(0, 2000);
}

function runGetAibom(args: Record<string, string>): string {
  const asset = getAsset(args.assetId);
  if (!asset) return `자산 "${args.assetId}"을(를) 찾을 수 없습니다.`;
  const b = asset.aibom;
  const v = (s: string) => (s.trim() === "" ? "미기재" : s);
  return [
    `${asset.id} AI-BOM 5영역:`,
    `- 모델: 파운데이션=${v(b.model.foundationModel)} | 아키텍처=${v(b.model.architecture)} | 용도=${v(b.model.intendedUse)} | 한계=${v(b.model.limitations)}`,
    `- 데이터: 출처=${v(b.dataset.sources)} | 벡터DB=${v(b.dataset.vectorDbLocation)}`,
    `- 프롬프트: 시스템=${v(b.prompt.systemPrompt).slice(0, 60)} | 가드레일=${v(b.prompt.guardrails).slice(0, 60)}`,
    `- 도구: API=${v(b.agentTool.apis)} | MCP=${v(b.agentTool.mcpServers)}`,
    `- 인프라: 컴퓨트=${v(b.infrastructure.compute)} | 호스팅=${v(b.infrastructure.hostingProvider)}`,
  ].join("\n").slice(0, 2000);
}

// ── 레지스트리 ──────────────────────────────────────────────────────────

const TOOLS: AgentTool[] = [
  {
    name: "list_assets",
    domain: "assets",
    write: false,
    description: "등록된 AI 자산 전체 목록을 조회한다 (개수·이름·유형·담당자·finding 요약 포함)",
    params: [],
    run: runListAssets,
  },
  {
    name: "get_asset",
    domain: "assets",
    write: false,
    description: '자산 1개의 상세와 발견된 취약점(finding)을 조회한다. 예: {"assetId":"ai-secbot-01"}',
    params: [{ name: "assetId", description: "조회할 자산 id", required: true }],
    run: runGetAsset,
  },
  {
    name: "get_aibom",
    domain: "assets",
    write: false,
    description: '자산의 AI-BOM(모델·데이터·프롬프트·도구·인프라 구성명세)을 조회한다. 예: {"assetId":"ai-secbot-01"}',
    params: [{ name: "assetId", description: "조회할 자산 id", required: true }],
    run: runGetAibom,
  },
];

export function listAgentTools(): AgentTool[] {
  return TOOLS;
}

export function findAgentTool(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

// LLM 프롬프트에 넣을 도구 목록 텍스트.
export function toolCatalogText(): string {
  return TOOLS.map((t) => {
    const params = t.params.length ? `(${t.params.map((p) => p.name + (p.required ? "" : "?")).join(", ")})` : "()";
    return `- ${t.name}${params}: ${t.description}`;
  }).join("\n");
}

// 규칙 검증: 필수 인자가 전부 있고 문자열인지. 문제가 없으면 null, 있으면 한국어 사유를 돌려준다.
export function validateToolArgs(tool: AgentTool, args: Record<string, unknown>): string | null {
  for (const p of tool.params) {
    const v = args[p.name];
    if (p.required && (typeof v !== "string" || v.trim() === "")) {
      return `필수 인자 누락: ${p.name} (${p.description})`;
    }
    if (v !== undefined && typeof v !== "string") return `인자 ${p.name}은(는) 문자열이어야 합니다`;
  }
  return null;
}
