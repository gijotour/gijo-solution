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
import { listTriples, addTriples, countTriples, deleteTriplesBySource } from "./ontology";
import { verifyBundle, type BundleManifest, type BundlePayload } from "./bundleverify";
import { raw as expressRaw } from "express";
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
// ⚠ MITRE 문구는 **축자로 요구된다** — 2026-07-31 원문 재대조로 확정했다.
//   attack.mitre.org/resources/legal-and-branding/terms-of-use — 상업 재배포는 명시적으로
//   허용되지만(“research, development, and commercial purposes”), 조건이 둘이다:
//     ① 아래 영문 고지를 **그대로** 재현할 것
//     ② **라이선스 본문 자체도 함께** 재현할 것(고지만으로는 부족)
//   그래서 영문 원문을 손대지 않고 싣고, 한국어 설명은 뒤에 덧붙인다.
//   ②는 번들의 ATTRIBUTIONS 파일에서 전문을 싣는다(요약하지 말 것 — 요약은 재현이 아니다).
export const BUNDLE_ATTRIBUTIONS = [
  "© 2026 The MITRE Corporation. This work is reproduced and distributed with the permission of The MITRE Corporation. — MITRE ATT&CK® · ATLAS™ · CWE™ 수록분에 적용. 라이선스 전문은 attack.mitre.org/resources/legal-and-branding/terms-of-use 참조.",
  // ⚠ CC BY-SA 4.0은 **동일조건 변경허락(ShareAlike)** 이 붙는다 — 2차적 저작물로 판단되면
  //   그 부분을 같은 라이선스로 공개해야 한다. 상업 번들에서 가장 큰 쟁점이라 법무 확인 대상.
  //   (GIJO_AS_지식번들_법무검토요청.md 참조)
  "OWASP Top 10 for LLM Applications (2025) — © OWASP Foundation. CC BY-SA 4.0에 따라 수록(출처 표시·동일조건 변경허락).",
  "NIST AI RMF 1.0 · GenAI Profile(NIST AI 600-1) — 미 연방정부 저작물(17 U.S.C. §105, 퍼블릭 도메인). 출처 표시.",
  // ★ **판정 완료(2026-08-22)** — 그전엔 「공공누리 유형 확인 중」인 채로 상용 번들에 실려
  //   나가고 있었다. 같은 날 문서 7종을 라이선스 위반으로 걷어내면서, 이 번들의 **나머지 절반**은
  //   아무도 안 봤다는 것이 검토에서 드러났다.
  //
  //   ■ 무엇을 싣는지 실제로 세어 보고 판정했다 — **저작물이 아니라 사실만 싣는다.**
  //     이 출처에서 온 것: 위협 **코드**(D01…) · **이름**(2~3낱말, 예: 「불균형 데이터」) ·
  //     **분류**(데이터/모델/프롬프트…) · **영향 영역**. 그리고 OWASP·NIST·MITRE **식별자**
  //     상호참조(그쪽은 위에서 따로 고지한다).
  //     ⚠ 실측: 21개 항목 전부 **서술문이 0건**이다(60자를 넘는 문자열 0개).
  //       원문의 설명·표·그림·문장은 **하나도 옮기지 않았다.**
  //
  //   ■ 무엇이 걸릴 뻔했나 — 공공누리 **유형2·4는 상업적 이용을 금지**한다(유형3·4는 변경금지).
  //     우리는 상용 제품이므로, 이 매뉴얼이 유형2나 4라면 **그 저작물을 실을 수 없다.**
  //
  //   ■ 왜 그래도 안 걸리나 — **사실 자체는 저작권 대상이 아니다.**
  //     「이런 위협이 있고 이 분류에 든다」는 사실이고, 짧은 이름은 그 사실의 명칭이다.
  //     공공누리가 막는 것은 **저작물의 이용**인데, 우리는 저작물을 이용하지 않는다.
  //     ★ 같은 날 문서 7종을 우리 글로 다시 쓴 것과 **정확히 같은 논리**다.
  //
  //   ⚠ 이 판정은 **「서술을 안 옮긴다」는 조건 위에** 서 있다. 누군가 원문 설명을 그대로
  //     가져다 붙이는 순간 무너진다 — 그래서 `docslicense.test.ts`가 그 조건을 기계로 지킨다.
  //     (출처 표시는 계속한다 — 예의이자, 담당자가 원문을 찾아갈 길이다.)
  "KISA 「AI 보안 위협 대응 매뉴얼」(2026.7) — 한국인터넷진흥원. **위협 분류 체계의 출처 표시**입니다. 이 제품은 위협의 코드·명칭·분류(사실)만 수록하며 원문의 설명·표·문장은 수록하지 않습니다.",
] as const;

const STATE_KEY = "knowledgeBundle:applied"; // JSON {version, at, triples, docs}

// 반입 대기 폴더 — 폐쇄망 담당자가 파일로 받은 번들을 여기 떨궈 두면 대화창에서 반입한다. (후-3 3단계)
//   지금까지 반입은 CLI(import.mjs)로만 가능했다. 담당자가 대화창에서 다루려면 서버가 읽을 수
//   있는 자리에 파일이 있어야 하는데, 폐쇄망이라 어차피 파일은 서버 머신에 떨어진다.
//   DB와 같은 데이터 뿌리 아래 둔다 — 운영 위치를 옮기면(GIJO_DB_PATH) 이 폴더도 함께 옮겨진다.
const DATA_ROOT = path.dirname(process.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite"));
export const BUNDLE_INBOX_DIR = process.env.GIJO_BUNDLE_INBOX ?? path.join(DATA_ROOT, "bundle-inbox");

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

/**
 * 서명이 검증된 번들을 반입한다. (계획서 후-3 2단계)
 *
 * ⚠ **검증은 호출 전에 끝나 있어야 한다** — 이 함수는 verifyBundle이 통과시킨 payload만 받는다.
 *   검증과 적용을 한 함수에 섞으면 "검증을 건너뛰는 호출 경로"가 언젠가 생긴다.
 *
 * ⚠ **addTriples는 중복을 걸러 주지 않는다** — 매번 새 UUID로 그냥 INSERT한다.
 *   나는 이걸 "멱등하다"고 잘못 알고 그대로 썼다가 운영에 2000행을 복제했다(아래 참고).
 *   멱등은 **출처별로 지우고 다시 넣어** 우리가 만든다(시드가 쓰는 것과 같은 전략).
 * 문서는 파일로 떨궈 기존 인입기가 읽게 한다 — 새 인입 기계를 만들면 어긋날 자리만 는다.
 */
export async function importVerifiedBundle(
  manifest: BundleManifest,
  payload: BundlePayload,
  actor: string
): Promise<{ version: string; triplesAdded: number; triplesReplaced: number; docsWritten: number; at: number }> {
  // 온톨로지 — **출처별로 지우고 다시 넣는다**(seedOntologyFromCatalog와 같은 멱등 전략).
  //
  // ⚠ 실사고(2026-07-31): 처음엔 addTriples로 그냥 넣었는데, addTriple은 매번 새 UUID로
  //   INSERT할 뿐 중복을 보지 않는다. 서버에서 뽑은 번들을 도로 넣자 **운영 온톨로지에
  //   2000행이 그대로 복제됐다**(4185행 중 고유 2185). 같은 지식이 두 벌 있으면 검색 결과가
  //   중복으로 차 근거 표시가 망가지고, 번들을 받을 때마다 배로 는다.
  //   시드가 멱등이라 "기존 멱등 경로를 재사용한다"고 적어 놓고 정작 그 경로를 우회했다.
  //
  // 출처 태그로 지우므로 **고객이 손으로 넣은 지식은 보존된다**(출처가 다르다).
  const sources = [...new Set(payload.ontology.map((t) => t.source).filter((s): s is string => !!s))];
  let removed = 0;
  for (const s of sources) removed += deleteTriplesBySource(s);
  const before = countTriples();
  addTriples(payload.ontology.map((t) => ({
    subject: t.subject, predicate: t.predicate, object: t.object, scope: t.scope, source: t.source,
  })));
  const triplesAdded = countTriples() - before;

  // 문서 — 지식 문서 디렉터리에 쓴다. 이름은 verifyBundle이 이미 안전성을 확인했지만,
  // **여기서 한 번 더 basename을 취한다**: 이 함수만 따로 부르는 경로가 나중에 생겨도
  // 파일이 엉뚱한 데 써지지 않게. 방어는 겹쳐 두는 편이 싸다.
  const docsDir = process.env.GIJO_DOCS_DIR ?? "docs";
  const knowledgeDir = path.join(docsDir, "knowledge");
  let docsWritten = 0;
  if (payload.docs.length) {
    fs.mkdirSync(knowledgeDir, { recursive: true });
    for (const d of payload.docs) {
      const safe = path.basename(d.file);
      if (!safe || safe.startsWith(".")) continue;
      fs.writeFileSync(path.join(knowledgeDir, safe), Buffer.from(d.contentBase64, "base64"));
      docsWritten++;
    }
  }
  // 문서를 새로 깔았으니 코퍼스를 다시 태운다(멱등 — 내용이 같으면 건너뛴다).
  const docsResult = await bootstrapDocsBundle();

  const state: AppliedState = {
    version: manifest.version,
    at: Date.now(),
    triples: triplesAdded,
    docsIngested: docsResult.ingested.length,
    docsSkipped: docsResult.skipped.length,
  };
  setStateStmt.run(STATE_KEY, JSON.stringify(state));

  recordAudit({
    kind: "config",
    actor,
    action: "지식 번들 반입(서명 검증 통과)",
    target: manifest.version,
    detail: [
      `발행 ${manifest.issuedAt} · 서명 확인됨`,
      `지식 ${payload.ontology.length}건 적재(출처 ${sources.length}종 교체 — 이전 ${removed}건 정리)`,
      `문서 ${docsWritten}건 기록 · 인입 신규 ${docsResult.ingested.length}/유지 ${docsResult.skipped.length}`,
    ].join("\n"),
    result: "ok",
  });

  return { version: manifest.version, triplesAdded, triplesReplaced: removed, docsWritten, at: state.at };
}

// ── 반입 대기 폴더(대화창 반입 경로, 후-3 3단계) ────────────────────────────

export interface InboxBundle {
  file: string;
  bytes: number;
  ok: boolean;              // 서명·해시 검증 통과 여부
  version?: string;         // ok일 때만
  issuedAt?: string;
  counts?: { triples: number; docs: number };
  reason?: string;          // ok=false일 때 거부 사유(담당자가 읽을 한 줄)
}

/**
 * 반입 대기 폴더의 번들 파일을 훑어 **서명까지 확인**한다. 폴더가 없으면 빈 목록.
 * 목록만 만드는 읽기 동작이라 아무것도 바꾸지 않는다 — 반입은 별도(importBundleFromInbox).
 */
export function listInboxBundles(): InboxBundle[] {
  let names: string[];
  try {
    names = fs.readdirSync(BUNDLE_INBOX_DIR).filter((n) => n.toLowerCase().endsWith(".gijobundle"));
  } catch {
    return []; // 폴더 없음 = 대기 중인 번들 없음(에러 아님)
  }
  names.sort();
  return names.map((file) => {
    let raw: Buffer;
    try {
      raw = fs.readFileSync(path.join(BUNDLE_INBOX_DIR, file));
    } catch {
      return { file, bytes: 0, ok: false, reason: "파일을 읽을 수 없습니다." };
    }
    const v = verifyBundle(raw);
    if (!v.ok || !v.manifest) return { file, bytes: raw.length, ok: false, reason: v.reason };
    return { file, bytes: raw.length, ok: true, version: v.manifest.version, issuedAt: v.manifest.issuedAt, counts: v.manifest.counts };
  });
}

/**
 * 반입 대기 폴더의 번들을 **이름으로 골라 반입**한다(대화창 경로). 서명이 맞을 때만.
 *
 * ⚠ 거부는 HTTP 반입과 **똑같이 감사기록에 남긴다** — 가짜 번들 반입 시도는 그 자체가 사건이다.
 * ⚠ basename만 취한다 — 이름에 경로(`../` 등)가 섞여도 대기 폴더 밖은 못 읽는다.
 *   verifyBundle이 내용도 다시 검증하지만, 방어는 파일을 여는 자리에서 먼저 겹쳐 둔다.
 */
export async function importBundleFromInbox(
  fileName: string,
  actor: string
): Promise<
  | { ok: true; version: string; triplesAdded: number; triplesReplaced: number; docsWritten: number }
  | { ok: false; reason: string }
> {
  const safe = path.basename(String(fileName ?? "").trim());
  if (!safe || !safe.toLowerCase().endsWith(".gijobundle")) {
    return { ok: false, reason: "번들 파일 이름(.gijobundle)이 필요합니다. 「지식 번들 상태」로 대기 목록을 볼 수 있습니다." };
  }
  let raw: Buffer;
  try {
    raw = fs.readFileSync(path.join(BUNDLE_INBOX_DIR, safe));
  } catch {
    return { ok: false, reason: `반입 대기 폴더에 파일이 없습니다: ${safe}` };
  }

  const v = verifyBundle(raw);
  if (!v.ok || !v.manifest || !v.payload) {
    recordAudit({
      kind: "block",
      actor,
      action: "지식 번들 반입 거부(대화창)",
      target: safe,
      detail: v.reason ?? "검증 실패",
      result: "blocked",
    });
    return { ok: false, reason: v.reason ?? "서명 검증에 실패했습니다." };
  }
  const r = await importVerifiedBundle(v.manifest, v.payload, actor);
  return { ok: true, version: r.version, triplesAdded: r.triplesAdded, triplesReplaced: r.triplesReplaced, docsWritten: r.docsWritten };
}

export function registerKnowledgeBundleRoutes(app: Express): void {
  // 번들 반입 — **admin만**, 그리고 서명이 맞을 때만.
  // 본문은 gzip 바이너리라 express.raw로 받는다(JSON 파서를 태우면 깨진다).
  app.post(
    "/api/knowledge-bundle/import",
    authMiddleware,
    adminMiddleware,
    expressRaw({ type: "application/octet-stream", limit: "64mb" }),
    asyncRoute(async (req, res) => {
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? "admin";
      const raw = req.body as Buffer;
      const v = verifyBundle(Buffer.isBuffer(raw) ? raw : Buffer.alloc(0));
      if (!v.ok || !v.manifest || !v.payload) {
        // ⚠ 거부는 **기록에 남긴다**. 가짜 번들 반입 시도는 그 자체가 보안 사건이다.
        recordAudit({
          kind: "block",
          actor,
          action: "지식 번들 반입 거부",
          target: `${Buffer.isBuffer(raw) ? raw.length : 0}바이트`,
          detail: v.reason ?? "검증 실패",
          result: "blocked",
        });
        res.status(400).json({ ok: false, reason: v.reason });
        return;
      }
      res.json({ ok: true, ...(await importVerifiedBundle(v.manifest, v.payload, actor)) });
    })
  );


  app.get("/api/knowledge-bundle/status", authMiddleware, (_req, res) => {
    res.json(getBundleStatus());
  });
  // 수동 적용은 admin — 온톨로지 시드 재적재는 수동 입력분은 보존하지만 그래도 운영 행위다.
  app.post("/api/knowledge-bundle/apply", authMiddleware, adminMiddleware, asyncRoute(async (req, res) => {
    const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? "admin";
    res.json(await applyKnowledgeBundle(actor));
  }));
}
