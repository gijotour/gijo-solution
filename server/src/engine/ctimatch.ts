// engine/ctimatch.ts — CTI 위협 인텔 ↔ 내부 자산 자동 매칭 (6.1절)
//
// CTI 피드(cti.ts)가 가져온 위협 finding의 target/type 텍스트와 자산 인벤토리(assets.ts)의
// 구체적 식별자(자산명·컴포넌트명·CVE·AI-BOM 모델/인프라)를 대조해 "이 위협이 우리 어느 자산에
// 영향을 주는가"를 자동 산출한다. 지금까지는 담당자가 위협 피드와 자산 목록을 눈으로 대조해야
// 했다 — 이 매칭 레이어가 그 수작업을 없앤다.
//
// 오탐을 줄이려고 자산의 "구체적 식별자"가 CTI 텍스트에 토큰 단위로 나타날 때만 매칭한다
// (일반 단어 "model/security/attack" 등은 불용어로 걸러 과매칭을 막는다).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { listAssets, Asset } from "./assets";
import { listFindings, CtiFinding } from "./cti";

// 일반 단어는 매칭 근거에서 제외 — 이런 게 겹친다고 "영향"이라 볼 수 없다.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "into", "your", "are", "was", "not", "new", "via",
  "using", "use", "used", "about", "over", "under", "attack", "attacks", "malware", "campaign", "campaigns",
  "threat", "threats", "intel", "pulse", "cyber", "report", "group", "groups", "actor", "actors", "targeting",
  "targets", "target", "data", "api", "apis", "model", "models", "service", "services", "server", "security",
  "vulnerability", "vulnerabilities", "exploit", "exploited", "tool", "tools", "version", "update", "patch",
  "system", "network", "cloud", "access", "gguf", "llm", "llms", "cve", "released", "active", "instruct",
]);

// 토큰화: 하이픈·점을 구분자로 쪼개 [a-z0-9] 조각을 만든다(컴포넌트명의 버전 접미사 대응 —
// "Qwen2.5-7B-Instruct" → qwen2/7b/instruct). 단 CVE 식별자는 정규식으로 통째 뽑아 보존한다
// (숫자 조각으로 쪼개지면 연도/번호가 다른 finding과 오탐되므로). 순수 숫자·불용어·2자 이하는 버린다.
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const cves = lower.match(/cve-\d{4}-\d{3,}/g) ?? [];
  const words = (lower.match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t)
  );
  return [...cves, ...words];
}

// 자산의 "구체적 식별자" 토큰 집합 — 이게 CTI 텍스트에 나오면 영향으로 본다.
export function assetSignals(asset: Asset): Set<string> {
  const parts: string[] = [asset.name, asset.assetType];
  for (const c of asset.components ?? []) parts.push(c.name);
  const b = asset.aibom;
  if (b) {
    parts.push(b.model?.foundationModel ?? "", b.model?.architecture ?? "");
    parts.push(b.infrastructure?.compute ?? "", b.infrastructure?.hostingProvider ?? "");
    parts.push(b.agentTool?.apis ?? "");
  }
  // finding evidence/type에서 CVE 식별자도 신호로 쓴다(양쪽에 같은 CVE면 강한 매칭).
  for (const f of asset.findings ?? []) parts.push(f.finding_type, f.evidence);
  return new Set(parts.flatMap(tokenize));
}

export interface CtiAssetMatch {
  finding: CtiFinding;
  matchedAssets: { assetId: string; assetName: string; matchedOn: string[] }[];
}

export interface CtiMatchSummary {
  totalFindings: number;
  matchedFindings: number;
  affectedAssets: number; // 영향받는 고유 자산 수
  criticalMatches: number; // 매칭된 finding 중 warning/critical
}

// 순수 함수(테스트 용이): 주어진 finding·자산 배열로 매칭을 계산한다.
export function matchCtiToAssets(
  findings: CtiFinding[],
  assets: Asset[]
): { matches: CtiAssetMatch[]; summary: CtiMatchSummary } {
  const signalsByAsset = assets.map((a) => ({ asset: a, signals: assetSignals(a) }));
  const matches: CtiAssetMatch[] = [];
  const affected = new Set<string>();
  let criticalMatches = 0;

  for (const finding of findings) {
    const hay = new Set(tokenize(`${finding.target} ${finding.type}`));
    const matchedAssets: CtiAssetMatch["matchedAssets"] = [];
    for (const { asset, signals } of signalsByAsset) {
      const matchedOn = [...signals].filter((s) => hay.has(s));
      if (matchedOn.length > 0) {
        matchedAssets.push({ assetId: asset.id, assetName: asset.name, matchedOn });
        affected.add(asset.id);
      }
    }
    if (matchedAssets.length > 0) {
      matches.push({ finding, matchedAssets });
      if (finding.severity === "warning" || finding.severity === "critical") criticalMatches++;
    }
  }

  return {
    matches,
    summary: {
      totalFindings: findings.length,
      matchedFindings: matches.length,
      affectedAssets: affected.size,
      criticalMatches,
    },
  };
}

export function registerCtiMatchRoutes(app: Express): void {
  app.get(
    "/api/cti/asset-matches",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      const [findings, assets] = await Promise.all([listFindings(), Promise.resolve(listAssets())]);
      res.json(matchCtiToAssets(findings, assets));
    })
  );
}
