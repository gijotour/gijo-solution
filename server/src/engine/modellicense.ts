// engine/modellicense.ts — 번들 로컬 LLM의 상업 배포 가능 여부 분류(제품화 법무 리스크 가시화).
//
// ⚠️ 중요: 이 분류는 **법무 검토의 출발점**이지 법적 확정이 아니다. 파일명 패턴에 근거한 보수적
// 추정이며, 실제 상업 배포 전에는 각 모델의 원본 라이선스를 법무가 확인해야 한다.
// 목적: "어떤 모델을 그대로 번들해 팔아도 되고, 어떤 것은 고객이 직접 받아야(BYOM) 하는지"를
// 제품에서 한눈에 보여줘 관리 가능하게 하는 것.
//
// 상용화 권장: 기본 탑재는 tier="permissive"만, 나머지는 BYOM(고객이 직접 가져오기)로.

import type { Express } from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";

export type LicenseTier = "permissive" | "restricted" | "review" | "byom";
export interface ModelLicense {
  id: string;
  tier: LicenseTier;
  license: string; // 추정 라이선스명
  bundleSafe: boolean; // 그대로 상업 번들 재배포 가능(추정)
  note: string;
}

// 패턴 → 라이선스 추정. 위에서부터 먼저 매칭. 보수적으로: 확실치 않으면 review/byom.
const RULES: { re: RegExp; tier: LicenseTier; license: string; note: string }[] = [
  // gijo-main-orchestrator — 출처 확정(2026-07-22 조사): Qwen2.5-7B-Instruct + Qwen2.5-7B-Instruct-1M
  // SLERP 합성(HF 캐시 02:01 다운로드 → 02:07 GGUF 생성 타임라인 + GGUF 메타 qwen2·7.6B·"Merged"로 확증).
  // 두 원본 모두 Apache-2.0 → 합성본도 Apache-2.0 재배포 가능. 일반 gijo-* BYOM 규칙보다 먼저 매칭.
  // (-ko 변형은 Gukbap-Qwen2.5-7B 합성 추정 — 그 라이선스 확인 전까지 일반 규칙(BYOM)에 남긴다.)
  { re: /^gijo-main-orchestrator$/i, tier: "permissive", license: "Apache-2.0(Qwen2.5-7B 합성)", note: "원본: Qwen2.5-7B-Instruct + 1M SLERP — 상업 번들 가능" },
  { re: /bge|embed/i, tier: "permissive", license: "MIT/Apache-2.0(임베딩)", note: "임베딩 모델 — 대체로 관대" },
  // Qwen2.5-7B/14B/32B·Coder·Qwen3 등은 Apache-2.0. 단 Qwen2.5-3B는 비상업 연구 라이선스라 별도.
  { re: /qwen2\.5-3b/i, tier: "restricted", license: "Qwen Research License(비상업)", note: "3B는 비상업 라이선스 — 상업 번들 불가" },
  { re: /qwen2\.5-(7b|14b|coder)|qwen__qwen2\.5|qwen3-30b|qwen2\.5-coder/i, tier: "permissive", license: "Apache-2.0(추정)", note: "Qwen2.5/3 대다수 Apache-2.0 — 원본 확인 권장" },
  // Llama 계열(Meta) — Llama Community License: 상업 사용 가능하나 재배포·명명·MAU 조건 有.
  { re: /llama|hermes/i, tier: "restricted", license: "Llama Community License", note: "상업 조건부(명명·재배포·MAU 조항) — 준수 검토 필요" },
  // abliterated/merge/claude-mythos/qwythos/gijo-* — 출처·라이선스 불명확 → BYOM 권장.
  // (합성 모델이 lily/security 문자열을 포함할 수 있어 보안특화 규칙보다 먼저 검사한다.)
  { re: /abliterated|mythos|qwythos|merged|gijo-|sec-tuned/i, tier: "byom", license: "출처 불명확", note: "합성·개조·출처불명 — 상업 번들 금지, 고객 BYOM 권장" },
  { re: /foundation-sec|securityllm|lily|zysec/i, tier: "review", license: "베이스모델 상속(불명확)", note: "보안 특화 파인튜닝 — 베이스 라이선스 확인 필요" },
];

export function classifyModelLicense(id: string): ModelLicense {
  const rule = RULES.find((r) => r.re.test(id));
  if (rule) return { id, tier: rule.tier, license: rule.license, bundleSafe: rule.tier === "permissive", note: rule.note };
  return { id, tier: "review", license: "미분류", bundleSafe: false, note: "규칙 미매칭 — 법무 검토 필요" };
}

export function classifyAvailableModels(ids: string[]): {
  models: ModelLicense[];
  summary: { permissive: number; restricted: number; review: number; byom: number; bundleSafe: number; total: number };
} {
  const models = ids.map(classifyModelLicense);
  const summary = {
    permissive: models.filter((m) => m.tier === "permissive").length,
    restricted: models.filter((m) => m.tier === "restricted").length,
    review: models.filter((m) => m.tier === "review").length,
    byom: models.filter((m) => m.tier === "byom").length,
    bundleSafe: models.filter((m) => m.bundleSafe).length,
    total: models.length,
  };
  return { models, summary };
}

export function registerModelLicenseRoutes(app: Express): void {
  // 번들 모델 라이선스 현황 — 상업 배포 가능/제약/검토/BYOM 분류. 관리자 전용(사업·법무용 정보).
  app.get("/api/localengine/model-licenses", authMiddleware, adminMiddleware, async (_req, res) => {
    const { listAvailableModels } = await import("./localengine.js");
    const ids = listAvailableModels().map((m) => m.id);
    res.json({ ...classifyAvailableModels(ids), disclaimer: "법무 검토의 출발점이며 법적 확정이 아님. 상업 배포 전 각 모델 원본 라이선스 확인 필요." });
  });
}
