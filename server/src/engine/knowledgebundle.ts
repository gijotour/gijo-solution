// engine/knowledgebundle.ts — 기본 지식 번들: 제품에 실려 나가는 보안 지식에 버전을 붙인다.
// (계획서 전-4, 2026-07-29 — "설치하면 빈 깡통 아님"을 상품으로. 행안부 공공 AI 가이드의
//  RAG 우선 방향과 정합. 후-3에서 연 단위 갱신 구독으로 확장할 기반.)
//
// 번들 = 이미 검증돼 있는 세 자산의 묶음에 버전·상태·무결성을 씌운 것이다. 자산을 옮기지 않는다:
//   ① 온톨로지 표준 시드 9종(KISA+ATLAS+OWASP+NIST AI RMF+CWE+ATT&CK 등, ontology-seed.ts)
//   ② 제품 문서 코퍼스(docs-manifest.json → docsbundle.ts 멱등 인입)
//   ③ 보안 지식 문서(knowledge/*.md — 이번에 ②의 매니페스트로 편입)
// 적용은 전부 기존 멱등 경로를 재사용한다 — 새 인입 기계를 만들면 어긋날 자리만 는다.
import type { Express, Request } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { seedOntologyFromCatalog, SEED_SOURCE, MITIGATION_SOURCE, PRODUCT_SOURCE, VULN_SOURCE } from "./ontology-seed";
import { ATLAS_SOURCE } from "./atlas-seed";
import { OWASP_SOURCE } from "./owasp-llm-seed";
import { NIST_SOURCE } from "./nist-airmf-seed";
import { CWE_SOURCE } from "./cwe-seed";
import { ATTACK_SOURCE } from "./attack-seed";
import { listTriples } from "./ontology";
import { bootstrapDocsBundle } from "./docsbundle";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

// 버전 표기: 연.월-차수(CalVer). 지식은 기능이 아니라 "언제 기준의 세상인가"가 본질이라
// SemVer(호환성 약속)보다 날짜가 정직하다 — 조사(2026-07-29) 확인: CISA KEV가 연.월.일
// catalogVersion을 실제로 쓰고, 연 단위 갱신 데이터엔 CalVer 계열이 업계 권장이다.
export const KNOWLEDGE_BUNDLE_VERSION = "2026.07-1";

// 재배포 고지 의무(조사 2026-07-29) — MITRE 계열(ATT&CK·ATLAS·CWE)은 저작권 고지+라이선스
// 문구 재현이 재배포 조건이고, NIST는 퍼블릭 도메인(출처 표시 권장), KISA는 문서별 공공누리
// 유형 확인이 필요하다. 번들 상태·반입 매니페스트에 항상 함께 내보낸다.
// ⚠ MITRE 축자 문구는 원문 페이지 재대조 후 확정할 것(법무 확인 항목) — 아래는 요지 표기.
export const BUNDLE_ATTRIBUTIONS = [
  "MITRE ATT&CK® / ATLAS™ / CWE™ — © The MITRE Corporation. MITRE의 허가 조건(저작권 고지·라이선스 재현)에 따라 수록. 상세: attack.mitre.org/resources/legal-and-branding",
  "OWASP Top 10 for LLM Applications — OWASP Foundation, CC 라이선스 조건에 따름",
  "NIST AI RMF 1.0 · GenAI Profile(AI 600-1) — 미 연방정부 저작물(퍼블릭 도메인), 출처 표시",
  "KISA AI 보안 위협 대응 매뉴얼(2026.7) — 공공누리 유형 문서별 확인 필요(반영 전 판권면 대조)",
] as const;

const STATE_KEY = "knowledgeBundle:applied"; // JSON {version, at, triples, docs}

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

interface AppliedState {
  version: string;
  at: number;
  triples: number;
  docsIngested: number;
  docsSkipped: number;
}

export function getAppliedBundle(): AppliedState | null {
  const row = getStateStmt.get(STATE_KEY) as { value: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.value) as AppliedState; } catch { return null; }
}

/** 번들에 포함된 지식 문서의 무결성 지문 — 폐쇄망 반입 심사용. 파일을 못 찾으면 null 해시. */
export function bundleDocFingerprints(): { file: string; sha256: string | null; bytes: number | null }[] {
  const manifestFile = process.env.GIJO_DOCS_MANIFEST ?? "docs-manifest.json";
  let files: { file: string }[] = [];
  try {
    files = (JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as { files: { file: string }[] }).files ?? [];
  } catch { /* 매니페스트 없으면 빈 목록 */ }
  const candidates = process.env.GIJO_DOCS_DIR ? [process.env.GIJO_DOCS_DIR] : ["docs", ".."];
  return files.map(({ file }) => {
    for (const dir of candidates) {
      try {
        const p = path.resolve(dir, file);
        const buf = fs.readFileSync(p);
        return { file, sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
      } catch { /* 다음 후보 */ }
    }
    return { file, sha256: null, bytes: null };
  });
}

export interface BundleStatus {
  bundleVersion: string;
  applied: AppliedState | null;
  upToDate: boolean;
  ontology: { sources: string[]; triples: number };
  docs: { total: number; withFile: number; fingerprints: { file: string; sha256: string | null; bytes: number | null }[] };
  attributions: string[];
}

export function getBundleStatus(): BundleStatus {
  const applied = getAppliedBundle();
  // 온톨로지 실측 — 상태는 주장하는 값이 아니라 지금 DB에 실제로 있는 값이다.
  // 출처 태그는 시드 모듈의 상수를 그대로 쓴다 — 문자열을 베껴 적으면 반드시 어긋난다.
  const seedSources = [SEED_SOURCE, MITIGATION_SOURCE, PRODUCT_SOURCE, VULN_SOURCE,
    ATLAS_SOURCE, OWASP_SOURCE, NIST_SOURCE, CWE_SOURCE, ATTACK_SOURCE];
  let triples = 0;
  const present: string[] = [];
  for (const s of seedSources) {
    const n = listTriples({ source: s }).length;
    if (n > 0) { present.push(s); triples += n; }
  }
  const fingerprints = bundleDocFingerprints();
  return {
    bundleVersion: KNOWLEDGE_BUNDLE_VERSION,
    applied,
    upToDate: applied?.version === KNOWLEDGE_BUNDLE_VERSION,
    ontology: { sources: present, triples },
    docs: { total: fingerprints.length, withFile: fingerprints.filter((f) => f.sha256).length, fingerprints },
    attributions: [...BUNDLE_ATTRIBUTIONS],
  };
}

/** 번들 적용 — 기존 멱등 경로 2개(온톨로지 재적재·문서 코퍼스 인입)를 순서대로 태운다. */
export async function applyKnowledgeBundle(actor?: string): Promise<AppliedState> {
  const onto = seedOntologyFromCatalog();
  const docs = await bootstrapDocsBundle();
  const state: AppliedState = {
    version: KNOWLEDGE_BUNDLE_VERSION,
    at: Date.now(),
    triples: onto.inserted,
    docsIngested: docs.ingested.length,
    docsSkipped: docs.skipped.length,
  };
  setStateStmt.run(STATE_KEY, JSON.stringify(state));
  recordAudit({
    kind: "config",
    actor: actor ?? "시스템(부팅 자동)",
    action: "기본 지식 번들 적용",
    target: KNOWLEDGE_BUNDLE_VERSION,
    detail: `트리플 ${onto.inserted} · 문서 신규 ${docs.ingested.length}/유지 ${docs.skipped.length}`,
    result: "ok",
  });
  return state;
}

/**
 * 부팅 시 버전 확인 — 코드가 새 번들 버전을 실고 있으면 자동 적용한다(멱등이라 안전).
 * 임베딩 서버가 아직 안 떠 있으면 문서 인입이 실패할 수 있어 docsbundle의 재시도 관행을 따라
 * 실패해도 서버 기동을 막지 않는다 — 다음 부팅 또는 수동 적용에서 재시도된다.
 */
export async function ensureKnowledgeBundle(): Promise<void> {
  try {
    const applied = getAppliedBundle();
    if (applied?.version === KNOWLEDGE_BUNDLE_VERSION) return;
    console.log(`[knowledge-bundle] ${applied?.version ?? "(미적용)"} → ${KNOWLEDGE_BUNDLE_VERSION} 적용 시작`);
    const s = await applyKnowledgeBundle();
    console.log(`[knowledge-bundle] 적용 완료 — 트리플 ${s.triples} · 문서 신규 ${s.docsIngested}/유지 ${s.docsSkipped}`);
  } catch (e) {
    console.warn("[knowledge-bundle] 적용 실패(기동은 계속) —", e instanceof Error ? e.message : e);
  }
}

export function registerKnowledgeBundleRoutes(app: Express): void {
  app.get("/api/knowledge-bundle/status", authMiddleware, (_req, res) => {
    res.json(getBundleStatus());
  });
  // 수동 적용은 admin — 온톨로지 시드 재적재는 수동 입력분은 보존하지만 그래도 운영 행위다.
  app.post("/api/knowledge-bundle/apply", authMiddleware, adminMiddleware, asyncRoute(async (req, res) => {
    const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? "admin";
    res.json(await applyKnowledgeBundle(actor));
  }));
}
