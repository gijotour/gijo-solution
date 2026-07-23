// engine/shadowai.ts — Shadow AI 탐지. 시스템에서 실제로 존재·로드·사용 중인 LLM인데
// AI 자산으로 등록(거버넌스)되지 않은 것을 찾아낸다.
//
// 왜 중요한가(2026 리서치): Shadow AI(비인가·미등록 AI)가 데이터 유출의 가장 흔한 진입점이 됐다.
// AI-SPM의 핵심은 "쓰이는 모든 AI를 발견·거버넌스"하는 것. GIJO는 자기 시스템에서 관측 가능한
// 신호(모델 파일·엔진 풀 상주·에이전트 배정)로 이걸 정직하게 계산한다 — 외부 스캔을 지어내지 않는다.
//
// 정의: 관측된 모델 ∖ 거버넌스된 모델 = Shadow. "거버넌스됨"=어떤 AI 자산의 AI-BOM(model.modelRef
// 또는 foundationModel)에 연결돼 있음. 담당자는 이 목록을 보고 자산으로 등록하거나 제거를 판단한다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { listAssets, isAiAsset } from "./assets";
import { listAvailableModels, getLocalEngineStatus } from "./localengine";
import { listAgents } from "./agents";

export interface ShadowModel {
  modelId: string;
  sources: string[]; // 어디서 관측됐나(모델 파일·엔진 상주·에이전트 배정)
  running: boolean; // 지금 엔진 풀에 로드돼 있나
  usedByAgents: string[]; // 이 모델을 쓰는 에이전트(있으면 실제 사용 중)
  severity: "high" | "medium"; // 로드·사용 중이면 high(지금 활동), 파일만 있으면 medium
  suggestion: string;
}

export interface ShadowAiReport {
  scannedAt: string;
  observedCount: number; // 관측된 모델 수(임베딩 제외)
  governedCount: number; // 자산에 연결된 모델 수
  shadow: ShadowModel[];
}

// 문자열 정규화 — modelRef가 "models/foo/foo.gguf"거나 "foo"거나 대소문자 차이가 있어도 같게 본다.
function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/\.gguf$/i, "").replace(/^models[\\/]/i, "").split(/[\\/]/).pop() ?? "";
}

// 자산의 AI-BOM에 연결된(=거버넌스된) 모델 참조를 모은다.
function governedModelRefs(): Set<string> {
  const set = new Set<string>();
  for (const a of listAssets()) {
    if (!isAiAsset(a)) continue;
    const m = a.aibom?.model;
    if (!m) continue;
    if (m.modelRef?.trim()) set.add(norm(m.modelRef));
    if (m.foundationModel?.trim()) set.add(norm(m.foundationModel));
  }
  return set;
}

export function detectShadowAi(): ShadowAiReport {
  const governed = governedModelRefs();
  const status = getLocalEngineStatus();
  const loadedIds = new Set(status.loaded.map((m) => norm(m.modelId)));

  // 에이전트별 배정 모델(실제 사용 신호).
  const agentByModel = new Map<string, string[]>();
  for (const ag of listAgents()) {
    if (!ag.assignedModelId) continue;
    const k = norm(ag.assignedModelId);
    agentByModel.set(k, [...(agentByModel.get(k) ?? []), ag.name]);
  }

  // 관측 대상 = 모델 파일 목록 ∪ 로드된 풀 ∪ 에이전트 배정(파일 없이 배정만 된 경우도 포함).
  const observed = new Map<string, { id: string; sources: Set<string> }>();
  const add = (rawId: string, source: string) => {
    const id = norm(rawId);
    if (!id) return;
    const cur = observed.get(id) ?? { id: rawId, sources: new Set<string>() };
    cur.sources.add(source);
    observed.set(id, cur);
  };
  for (const m of listAvailableModels()) add(m.id, "모델 파일(models/)");
  for (const m of status.loaded) add(m.modelId, "엔진 풀 상주(실행 중)");
  for (const [k] of agentByModel) add(k, "에이전트 배정");

  const shadow: ShadowModel[] = [];
  for (const [id, info] of observed) {
    if (governed.has(id)) continue; // 자산에 연결됨 → 거버넌스됨
    const running = loadedIds.has(id);
    const usedByAgents = agentByModel.get(id) ?? [];
    const active = running || usedByAgents.length > 0;
    shadow.push({
      modelId: info.id,
      sources: [...info.sources],
      running,
      usedByAgents,
      severity: active ? "high" : "medium",
      suggestion: active
        ? "지금 사용 중인데 AI 자산으로 등록되지 않았습니다 — 자산 등록 후 AI-BOM·OWASP LLM 위험을 점검하세요."
        : "배치돼 있으나 미등록입니다 — 쓸 모델이면 자산 등록, 아니면 제거를 검토하세요.",
    });
  }
  // 활동 중(high)을 먼저, 그 다음 이름순.
  shadow.sort((a, b) => (a.severity === b.severity ? a.modelId.localeCompare(b.modelId) : a.severity === "high" ? -1 : 1));

  return {
    scannedAt: new Date().toISOString(),
    observedCount: observed.size,
    governedCount: governed.size,
    shadow,
  };
}

// 챗봇/화면이 그대로 쓸 요약 텍스트.
export function formatShadowAi(): string {
  const r = detectShadowAi();
  if (r.shadow.length === 0) {
    return `🕵 Shadow AI 점검 — 미등록 AI 모델 없음 ✓ (관측 ${r.observedCount}개 모두 자산에 연결됨)`;
  }
  const L: string[] = [];
  L.push(`🕵 Shadow AI 점검 — 미등록 AI 모델 ${r.shadow.length}개 발견 (관측 ${r.observedCount} · 거버넌스 ${r.governedCount})`);
  for (const s of r.shadow) {
    const tag = s.severity === "high" ? "⚠사용 중" : "배치만";
    const used = s.usedByAgents.length ? ` · 사용: ${s.usedByAgents.join(", ")}` : "";
    L.push(`  • [${tag}] ${s.modelId} (${s.sources.join(", ")}${used})`);
  }
  L.push("→ 자산 목록에서 등록하면 AI-BOM·OWASP LLM 위험 점검 대상이 됩니다.");
  return L.join("\n");
}

export function registerShadowAiRoutes(app: Express): void {
  app.get("/api/shadow-ai", authMiddleware, (_req, res) => {
    res.json(detectShadowAi());
  });
}
