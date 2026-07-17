// engine/agenttools.ts — 에이전트 루프가 호출할 수 있는 도구 레지스트리.
//
// ⚠ 설계 축: **화면 메뉴가 아니라 사용자 의도** (2026-07-17 확정).
// 처음엔 메뉴를 1:1로 미러링했는데(list_assets/get_asset/get_aibom = 자산 메뉴), 그러면 LLM이
// "이 질문은 어느 메뉴인가"를 먼저 풀어야 하고 메뉴를 가로지르는 질문("오늘 뭐부터?", "Log4Shell
// 관련된 거 다 찾아줘")에 도구를 3~4개 조합해야 해서 실패율이 올라간다. 그래서 도구를 의도 단위로
// 잡고, 메뉴 경계를 서버가 가로지른다:
//   찾기(search) · 설명(explain) · 상세(get_asset) · 목록(list_assets) · 오늘(today) · 등록(register_asset)
// 온톨로지(지식 그래프)가 그 접착제다 — 위협→완화통제→보안제품→자산 관계가 이미 메뉴를 가로지른다.
//
// 원칙(QA 보고서 2026-07-17): 판단·검증·실행은 여기(규칙 코드), LLM은 도구 선택·인자 추출만.
// 도구 결과는 LLM에 재주입되므로 장황한 JSON 대신 짧은 한국어 요약 텍스트를 돌려준다.
//
// 쓰기 도구(write:true)는 루프가 바로 실행하지 않는다 — 값을 결재판(PendingApproval)으로
// 만들어 돌려주고, 사람이 승인한 뒤 /api/agent/approve로만 실행된다(시안 B, 2026-07-17 확정).

import { listAssets, getAsset, registerAsset, Asset } from "./assets";
import { expandOntology } from "./ontology";
import { prioritizedReviews, updateFindingReview, findingKey, ReviewPatch, ApprovalStatus } from "./approvals";
import { listProducts } from "./securityproducts";
import { listDocuments } from "./memory";
import { listFindings as listCtiFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";

export interface AgentToolParam {
  name: string;
  label: string; // 결재판에 보일 한국어 이름
  description: string;
  required: boolean;
}

export interface AgentTool {
  name: string;
  label: string; // 결재판 제목용("자산 등록")
  domain: string; // 메뉴 단위 도메인("assets" 등) — 도구 15개 초과 시 도메인 라우팅에 쓴다
  write: boolean; // true면 상태를 바꾸는 도구 — 결재판을 거쳐야 실행된다
  description: string; // LLM에게 보여줄 한 줄 설명(한국어)
  params: AgentToolParam[];
  // 쓰기 도구용: LLM이 안 준 값을 서버 규칙으로 채운다(예: id를 이름에서 생성). 결재판에서 "자동생성"으로 표시된다.
  autoFill?: (args: Record<string, string>) => Record<string, string>;
  effect?: (args: Record<string, string>) => string; // "실행되면:" 고지
  undo?: string; // "되돌리기:" 고지
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

// 자산 상세 — AI-BOM까지 한 번에 준다(예전엔 get_aibom을 따로 뒀는데, LLM이 "AI-BOM도 봐야 하나"를
// 매번 판단해야 해서 도구만 늘고 턴이 늘었다. 상세는 상세 하나로 충분하다).
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
  const b = asset.aibom;
  const v = (s: string) => (s.trim() === "" ? "미기재" : s);
  const aibomLines = [
    `AI-BOM: 파운데이션=${v(b.model.foundationModel)} | 아키텍처=${v(b.model.architecture)} | 용도=${v(b.model.intendedUse)}`,
    `        데이터출처=${v(b.dataset.sources)} | 가드레일=${v(b.prompt.guardrails).slice(0, 40)} | 인프라=${v(b.infrastructure.compute)}`,
  ];
  // 온톨로지 연계: 이 자산의 유형·구성에 걸리는 위협·완화통제를 함께 준다(AI-BOM → 위협 흐름).
  const threats = ontologyLinesFor(`${asset.name} ${asset.assetType} ${b.model.foundationModel} ${b.model.architecture}`, 6);
  return [
    `자산 ${asset.id} (${asset.name})`,
    `유형=${asset.assetType} | 담당=${asset.owner || "미지정"} | 서비스=${asset.service ?? "미지정"} | 경로=${asset.path}`,
    `마지막 스캔: ${asset.lastScannedAt ? new Date(asset.lastScannedAt).toLocaleString("ko-KR") : "스캔 이력 없음"} | ${findingSummary(asset)}`,
    ...aibomLines,
    ...(top.length ? ["주요 finding(심각도순, 최대 5건):", ...top] : []),
    ...(threats.length ? ["사내 온톨로지가 아는 관련 위협·통제:", ...threats] : []),
  ].join("\n").slice(0, 2500);
}

// ── 온톨로지(지식 그래프)를 도구의 접착제로 ─────────────────────────────
// 위협→완화통제→보안제품→자산 관계는 이미 메뉴를 가로지른다. 이걸 도구 결과에 얹어
// LLM이 "메뉴를 더 뒤지지 않아도" 근거 있는 답을 하게 한다.
function ontologyLinesFor(text: string, limit: number): string[] {
  try {
    return expandOntology(text, undefined, { hops: 2, limit }).map(
      (t) => `  - ${t.subject} —[${t.predicate}]→ ${t.object}`
    );
  } catch {
    return []; // 온톨로지가 비어 있어도 도구는 계속 동작한다
  }
}

// explain — "이게 뭐야 / 어떤 위협이 걸려 / 우리 통제는?" 한 방에.
// 온톨로지 관계 + 사내 문서(업로드·자동분류된 장기기억) + 보유 보안제품을 가로질러 근거를 모은다.
async function runExplain(args: Record<string, string>): Promise<string> {
  const topic = args.topic.trim();
  const out: string[] = [];

  const triples = ontologyLinesFor(topic, 12);
  if (triples.length) out.push(`사내 온톨로지 관계 — "${topic}" 관련:`, ...triples);

  // 업로드·자동분류된 사내 문서 중 제목이 걸리는 것(있으면 근거로 제시).
  try {
    const docs = (await listDocuments()).filter((d) => matches(d.documentId, topic));
    if (docs.length) {
      out.push(
        `사내 문서(장기기억) ${docs.length}건:`,
        ...docs.slice(0, 5).map((d) => `  - ${d.documentId}${d.docClass ? ` [${d.docClass}]` : ""} (조각 ${d.chunks})`)
      );
    }
  } catch {
    /* 임베딩 미기동 등 — 문서 근거 없이 계속 */
  }

  // 보유 보안제품 중 관련된 것(대응 수단 제시).
  const products = listProducts().filter((p) => matches(`${p.name} ${p.category} ${p.vendor ?? ""}`, topic));
  if (products.length) {
    out.push(
      `보유 보안제품 ${products.length}건:`,
      ...products.slice(0, 5).map((p) => `  - ${p.name} (${p.category}${p.vendor ? `, ${p.vendor}` : ""})`)
    );
  }

  if (out.length === 0) {
    return `"${topic}"에 대해 사내 온톨로지·문서·보안제품 등록부에서 찾은 근거가 없습니다. 일반 지식으로만 답하거나, 관련 문서를 업로드하면 근거가 쌓입니다.`;
  }
  return out.join("\n").slice(0, 2500);
}

// 느슨한 부분일치 — 한국어는 형태소 분석 없이 공백 토큰화가 불안정해 정규화 후 부분문자열로 본다
// (온톨로지 expandOntology와 같은 전략).
function matches(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const n = norm(needle);
  return n.length >= 2 && norm(haystack).includes(n);
}

// search — 메뉴를 가로지르는 단일 검색. LLM이 "어느 메뉴를 봐야 하나"를 풀지 않아도 되게 한다.
async function runSearch(args: Record<string, string>): Promise<string> {
  const q = args.query.trim();
  const out: string[] = [];

  const assets = listAssets().filter(
    (a) => matches(a.id, q) || matches(a.name, q) || matches(a.assetType, q) || a.components.some((c) => matches(c.name, q))
  );
  if (assets.length) {
    out.push(`AI 자산 ${assets.length}건:`, ...assets.slice(0, 6).map((a) => `  - ${a.id} | ${a.name} | ${a.assetType} | ${findingSummary(a)}`));
  }

  // 취약점 — 전 자산을 가로질러 우선순위 상위에서 찾는다(자산별로 뒤지지 않아도 되게).
  const vulns = prioritizedReviews(100).filter(
    (r) => matches(r.finding.finding_type, q) || matches(r.finding.evidence, q) || matches(r.assetName, q)
  );
  if (vulns.length) {
    // assetId를 함께 준다 — LLM이 이어서 get_asset(assetId)을 부를 수 있어야 한다.
    // (자산명만 주면 id를 몰라 다음 도구를 못 부르고 턴이 낭비된다.)
    out.push(
      `취약점 ${vulns.length}건(우선순위순):`,
      ...vulns.slice(0, 6).map((r) => `  - [${r.finding.severity}] ${r.finding.finding_type} @ ${r.assetName}(id=${r.assetId}) — 점수 ${r.score}${r.assignee ? `, 담당 ${r.assignee}` : ""}${r.overdue ? " ⚠지연" : ""}`)
    );
  }

  const products = listProducts().filter((p) => matches(`${p.name} ${p.category} ${p.vendor ?? ""}`, q));
  if (products.length) {
    out.push(`보안제품 ${products.length}건:`, ...products.slice(0, 5).map((p) => `  - ${p.name} (${p.category})`));
  }

  try {
    const docs = (await listDocuments()).filter((d) => matches(d.documentId, q));
    if (docs.length) {
      out.push(`사내 문서 ${docs.length}건:`, ...docs.slice(0, 5).map((d) => `  - ${d.documentId}${d.docClass ? ` [${d.docClass}]` : ""}`));
    }
  } catch {
    /* 임베딩 미기동 — 문서 검색 생략 */
  }

  const triples = ontologyLinesFor(q, 6);
  if (triples.length) out.push("온톨로지 관계:", ...triples);

  if (out.length === 0) return `"${q}"에 해당하는 자산·취약점·보안제품·문서·온톨로지 관계를 찾지 못했습니다.`;
  return out.join("\n").slice(0, 2500);
}

// today — "오늘 뭐부터?" 한 방에. KEV/EPSS/VPR 점수로 전 자산을 가로질러 정렬한 조치 우선순위.
function runToday(args: Record<string, string>): string {
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
  const top = prioritizedReviews(limit);
  if (top.length === 0) return "지금 조치할 취약점이 없습니다. (오탐 판정·조치완료 제외)";
  const lines = top.map((r, i) => {
    const f = r.finding;
    const tags = [
      f.kev ? "KEV(실제악용)" : null,
      f.epss != null ? `EPSS ${f.epss}` : null,
      f.vpr != null ? `VPR ${f.vpr}` : null,
    ].filter(Boolean).join(" · ");
    // assetId 포함 — LLM이 "1번 자산 자세히 봐줘" 후속 지시에 get_asset을 바로 부를 수 있게.
    return `${i + 1}. [${f.severity}] ${f.finding_type} @ ${r.assetName}(id=${r.assetId})${tags ? ` — ${tags}` : ""}${r.assignee ? ` | 담당 ${r.assignee}` : " | 담당 미지정"}${r.dueDate ? ` | 기한 ${r.dueDate}` : ""}${r.overdue ? " ⚠기한초과" : ""}`;
  });
  const overdue = top.filter((r) => r.overdue).length;
  return [
    `오늘 조치 우선순위 상위 ${top.length}건 (KEV→EPSS→VPR 순):`,
    ...lines,
    overdue ? `⚠ 기한 초과 ${overdue}건 포함` : "",
  ].filter(Boolean).join("\n").slice(0, 2500);
}

// threats — "요즘 위협 있어? / 새로 뜬 거 우리랑 관련?" 한 방에. 위협 인텔리전스(CTI) 피드의
// 최신 탐지와 사내 자산 신호(이름·컴포넌트·AI-BOM·CVE)의 교집합을 준다. 위협×자산은 이미 메뉴를
// 가로지르므로(domain=cross) 의도 축 도구로 딱 맞는다 — 매칭 계산은 기존 순수함수를 그대로 쓴다.
const CTI_SEV_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

async function runThreats(args: Record<string, string>): Promise<string> {
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
  let findings;
  try {
    findings = await listCtiFindings();
  } catch {
    return "위협 인텔리전스(CTI) 피드를 조회하지 못했습니다.";
  }
  if (findings.length === 0) {
    return "CTI 피드에 새로 탐지된 위협이 없습니다. (피드 미연동 시 위협 인텔리전스 화면에서 API 키를 설정하세요.)";
  }
  const { matches, summary } = matchCtiToAssets(findings, listAssets());
  if (matches.length === 0) {
    return `최신 위협 ${summary.totalFindings}건을 확인했지만, 우리 자산 신호와 겹치는 것은 없습니다.`;
  }
  const top = matches
    .slice()
    .sort((a, b) => (CTI_SEV_ORDER[a.finding.severity] ?? 3) - (CTI_SEV_ORDER[b.finding.severity] ?? 3))
    .slice(0, limit);
  // matchedAssets에 id=를 함께 준다 — LLM이 이어서 get_asset(assetId)으로 파고들 수 있게.
  const lines = top.map((m) => {
    const hit = m.matchedAssets.map((a) => `${a.assetName}(id=${a.assetId})`).join(", ");
    return `- [${m.finding.severity}] ${m.finding.type} — ${m.finding.target} (출처 ${m.finding.source}) → 우리 자산: ${hit}`;
  });
  return [
    `최신 위협 ${summary.totalFindings}건 중 우리 자산에 걸리는 것 ${summary.matchedFindings}건 (영향 자산 ${summary.affectedAssets}개, 심각·경고 ${summary.criticalMatches}건):`,
    ...lines,
  ].join("\n").slice(0, 2500);
}

// ── 「AI 자산」 쓰기 도구 (Phase 2 — 결재판 경유) ────────────────────────

// 이름에서 자산 id를 만든다 — UX 피드백 러프엣지("id를 사람이 지정해야 함") 해소.
// 기존 시드 자산의 관례(ai-secbot-01, ai-doccls-02)를 따라 번호 접미사를 붙이고, 충돌하면 증가시킨다.
export function generateAssetId(name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^가-힣a-z0-9-]/g, "") // 경로·특수문자 제거(id는 URL·파일명에 쓰인다)
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "asset";
  for (let n = 1; n < 100; n++) {
    const candidate = `${base}-${String(n).padStart(2, "0")}`;
    if (!getAsset(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// 경로 확장자로 자산 유형을 추정한다(규칙 — LLM 추정이 아니라 결정적).
function inferAssetType(path: string): string {
  if (/\.(gguf|safetensors|bin|pt|pth)$/i.test(path)) return "LLM 서비스";
  if (/\.(onnx|pb|h5|tflite)$/i.test(path)) return "분류 모델";
  return "기타";
}

function runRegisterAsset(args: Record<string, string>): string {
  const id = args.assetId?.trim() || generateAssetId(args.name);
  if (getAsset(id)) return `이미 존재하는 자산 id입니다: ${id}`;
  const before = listAssets().length;
  const asset = registerAsset({
    id,
    name: args.name.trim(),
    path: args.path.trim(),
    assetType: args.assetType?.trim() || inferAssetType(args.path),
    owner: args.owner?.trim() || undefined,
  });
  return `자산 ${asset.id}(${asset.name})을 등록했습니다. 등록 자산 ${before}개 → ${before + 1}개. 스캔은 아직 실행하지 않았습니다.`;
}

// ── 취약점 조치 쓰기 도구 (Phase 2 — 결재판 경유) ────────────────────────
//
// finding 지목의 원칙: findingKey는 (assetId+내용) sha1 해시라 LLM이 만들 수 없다. 그래서 LLM은
// today/search/get_asset 결과에 이미 노출된 assetId와 finding 설명(심각도·유형)을 "복사"만 하고,
// 어떤 finding인지 특정하는 판단은 서버 규칙(resolveFinding)이 한다. 해석 실패·모호는 규칙이
// 거부하고 사람에게 되묻는다(오발동 방지). 매칭이 유일할 때만 실제 findingKey로 변환해 실행한다.

interface FindingHit {
  key: string; // 실제 findingKey (sha1 16자)
  label: string; // 사람이 읽을 요약 "[critical] 프롬프트 인젝션"
}

function findingLabel(f: Asset["findings"][number]): string {
  return `[${f.severity}] ${f.finding_type}`;
}

// assetId 안에서 needle(심각도·유형·근거 부분일치)로 finding 1건을 특정한다.
// 0건/2건+는 실패로 돌려주고(사람에게 되묻기), 정확히 1건일 때만 hit을 준다.
function resolveFinding(assetId: string, needle: string): { ok: true; hit: FindingHit } | { ok: false; error: string } {
  const asset = getAsset((assetId ?? "").trim());
  if (!asset) {
    const ids = listAssets().map((a) => a.id).join(", ") || "(없음)";
    return { ok: false, error: `자산 "${assetId}"을(를) 찾을 수 없습니다. 등록된 자산 id: ${ids}` };
  }
  if (asset.findings.length === 0) return { ok: false, error: `자산 ${asset.id}에는 조치할 취약점(finding)이 없습니다.` };
  const n = (needle ?? "").trim();
  if (n.length < 2) {
    const sample = asset.findings.slice(0, 6).map(findingLabel).join(" / ");
    return { ok: false, error: `어느 취약점인지 지목이 필요합니다. ${asset.id}의 취약점: ${sample}` };
  }
  const hits = asset.findings.filter((f) => matches(`${f.finding_type} ${f.severity} ${f.evidence}`, n));
  if (hits.length === 0) {
    const sample = asset.findings.slice(0, 6).map(findingLabel).join(" / ");
    return { ok: false, error: `${asset.id}에서 "${needle}"에 맞는 취약점을 찾지 못했습니다. 이 자산의 취약점: ${sample}` };
  }
  if (hits.length > 1) {
    const sample = hits.slice(0, 6).map(findingLabel).join(" / ");
    return { ok: false, error: `"${needle}"에 ${hits.length}건이 걸립니다 — 심각도·유형으로 더 구체적으로 지목하세요: ${sample}` };
  }
  const f = hits[0];
  return { ok: true, hit: { key: findingKey(asset.id, f), label: findingLabel(f) } };
}

// 상태 한국어 → enum (결정적 규칙, LLM 추정이 아니다).
function normalizeStatus(raw: string): ApprovalStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (/오탐|false|무시|반려|제외|reject/.test(s)) return "rejected";
  if (/조치|완료|해결|확정|승인|approv|fix|done|patch/.test(s)) return "approved";
  if (/미검토|보류|대기|원복|pending/.test(s)) return "pending";
  return null;
}

const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 쓰기 도구는 실패 시 문자열이 아니라 throw 한다 — 결재판 승인 경로(/api/agent/approve)가 이를
// 400으로 돌려 화면이 "실행 실패"로 표시한다. 읽기 도구가 오류 문자열을 LLM에 재주입하는 것과 달리,
// 쓰기 실패를 "✅ 완료" 메시지로 보여주면 사람이 배정이 된 줄 오해할 수 있어서다(오발동 방지).
function runAssignFinding(args: Record<string, string>): string {
  const r = resolveFinding(args.assetId, args.finding);
  if (!r.ok) throw new Error(r.error);
  const assignee = args.assignee.trim(); // required — validateToolArgs가 보장
  const patch: ReviewPatch = { assignee };
  const due = args.dueDate?.trim();
  if (due) {
    if (!DUE_RE.test(due)) throw new Error(`기한은 YYYY-MM-DD 형식이어야 합니다 (받은 값: "${due}").`);
    patch.dueDate = due;
  }
  updateFindingReview(args.assetId.trim(), r.hit.key, patch, "orchestrator");
  return `${args.assetId} ${r.hit.label} → 담당자 ${assignee}${patch.dueDate ? `, 기한 ${patch.dueDate}` : ""} 배정했습니다.`;
}

function runUpdateFindingStatus(args: Record<string, string>): string {
  const r = resolveFinding(args.assetId, args.finding);
  if (!r.ok) throw new Error(r.error);
  const status = normalizeStatus(args.status);
  if (!status) throw new Error(`상태 "${args.status}"를 해석하지 못했습니다. "조치완료" 또는 "오탐"으로 지정하세요.`);
  const patch: ReviewPatch = { status };
  const note = args.note?.trim();
  if (note) patch.note = note;
  updateFindingReview(args.assetId.trim(), r.hit.key, patch, "orchestrator");
  const label = status === "rejected" ? "오탐(SBOM·조치 대상에서 제외)" : status === "approved" ? "조치완료(확정)" : "미검토(원복)";
  return `${args.assetId} ${r.hit.label} → ${label} 처리했습니다.${note ? ` 사유: ${note}` : ""}`;
}

// ── 레지스트리 ──────────────────────────────────────────────────────────

const TOOLS: AgentTool[] = [
  {
    name: "list_assets",
    label: "자산 목록 조회",
    domain: "assets",
    write: false,
    description: "등록된 AI 자산 전체 목록을 조회한다 (개수·이름·유형·담당자·finding 요약 포함)",
    params: [],
    run: runListAssets,
  },
  {
    name: "get_asset",
    label: "자산 상세 조회",
    domain: "assets",
    write: false,
    description:
      '자산 1개의 상세를 조회한다 — 취약점(finding)·AI-BOM·관련 위협까지 함께 나온다. 예: {"assetId":"ai-secbot-01"}',
    params: [{ name: "assetId", label: "자산 id", description: "조회할 자산 id", required: true }],
    run: runGetAsset,
  },
  {
    name: "search",
    label: "통합 검색",
    domain: "cross", // 메뉴를 가로지른다 — 자산·취약점·보안제품·문서·온톨로지를 한 번에
    write: false,
    description:
      '무엇이든 찾는다 — 자산·취약점·보안제품·사내문서·온톨로지 관계를 한 번에 검색한다. 어디 있는지 모를 때 이것부터 쓴다. 예: {"query":"Log4Shell"}',
    params: [{ name: "query", label: "검색어", description: "찾을 키워드 (자산명·취약점·제품·문서·위협)", required: true }],
    run: runSearch,
  },
  {
    name: "explain",
    label: "근거 조회(온톨로지)",
    domain: "cross",
    write: false,
    description:
      '보안 주제·위협·용어의 사내 근거를 모은다 — 온톨로지 관계(위협→완화통제→제품)·사내 문서·보유 보안제품. "이게 뭐야", "무슨 위협이 걸려", "우리 통제는?"에 쓴다. 예: {"topic":"프롬프트 인젝션"}',
    params: [{ name: "topic", label: "주제", description: "설명이 필요한 위협·용어·주제", required: true }],
    run: runExplain,
  },
  {
    name: "today",
    label: "오늘의 조치 우선순위",
    domain: "cross",
    write: false,
    description:
      '지금 조치할 취약점 우선순위를 전 자산을 가로질러 알려준다(KEV→EPSS→VPR 순, 담당자·기한·지연 포함). "오늘 뭐부터?"에 쓴다. 예: {"limit":"5"}',
    params: [{ name: "limit", label: "개수", description: "상위 몇 건 (기본 5)", required: false }],
    run: runToday,
  },
  {
    name: "threats",
    label: "우리 관련 위협(CTI)",
    domain: "cross", // 위협 인텔리전스 × 자산을 가로지른다
    write: false,
    description:
      '우리 자산에 걸리는 최신 위협을 알려준다 — CTI(위협 인텔리전스) 피드의 탐지와 사내 자산의 교집합. "요즘 위협 있어?", "새로 뜬 거 우리랑 관련?"에 쓴다. 예: {"limit":"5"}',
    params: [{ name: "limit", label: "개수", description: "상위 몇 건 (기본 5)", required: false }],
    run: runThreats,
  },
  {
    name: "register_asset",
    label: "자산 등록",
    domain: "assets",
    write: true,
    description:
      '새 AI 자산을 등록한다(id는 자동 생성되므로 넣지 마라). 예: {"name":"사내 챗봇","path":"models/chatbot.gguf"}',
    params: [
      { name: "assetId", label: "자산 id", description: "비워두면 이름에서 자동 생성", required: false },
      { name: "name", label: "이름", description: "자산 이름", required: true },
      { name: "path", label: "모델 경로", description: "모델 파일 경로 (예: models/chatbot.gguf)", required: true },
      { name: "assetType", label: "유형", description: "LLM 서비스 / 분류 모델 / 이상탐지 모델 / 기타", required: false },
      { name: "owner", label: "담당자", description: "담당 조직·담당자 (선택)", required: false },
    ],
    // 결재판을 띄우기 전에 서버 규칙으로 채운다 — 사람이 타이핑할 값을 최대한 줄인다(시안 B).
    autoFill: (args) => {
      const filled: Record<string, string> = {};
      if (!args.assetId?.trim() && args.name?.trim()) filled.assetId = generateAssetId(args.name);
      if (!args.assetType?.trim() && args.path?.trim()) filled.assetType = inferAssetType(args.path);
      return filled;
    },
    effect: (args) =>
      `자산 인벤토리에 1건 추가(${listAssets().length}→${listAssets().length + 1}개) · 스캔은 실행되지 않음 · AI-BOM은 빈 상태로 생성` +
      (args.owner?.trim() ? "" : " · 담당자 미지정"),
    undo: "자산 화면에서 삭제하거나, 아래 '방금 등록 취소'로 되돌릴 수 있습니다.",
    run: runRegisterAsset,
  },
  {
    name: "assign_finding",
    label: "취약점 담당자·기한 배정",
    domain: "assets",
    write: true,
    description:
      '취약점에 조치 담당자(와 기한)를 배정한다. assetId와 finding(심각도·유형으로 지목)은 today/search 결과에서 가져온다. 예: {"assetId":"ai-secbot-01","finding":"프롬프트 인젝션","assignee":"김보안","dueDate":"2026-07-31"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id (today/search 결과의 id=)", required: true },
      { name: "finding", label: "대상 취약점", description: "심각도·유형으로 지목 (예: critical 프롬프트 인젝션)", required: true },
      { name: "assignee", label: "담당자", description: "조치 담당자·조직", required: true },
      { name: "dueDate", label: "기한", description: "조치 기한 YYYY-MM-DD (선택)", required: false },
    ],
    effect: (args) => `취약점 검토대장에 담당자${args.dueDate?.trim() ? "·기한(SLA)" : ""}을 기록 · 스캔·자산 데이터는 바뀌지 않음`,
    undo: "승인 화면(취약점 관리)에서 담당자·기한을 다시 비우면 미배정으로 원복됩니다.",
    run: runAssignFinding,
  },
  {
    name: "update_finding_status",
    label: "취약점 판정(오탐·조치완료)",
    domain: "assets",
    write: true,
    description:
      '취약점 판정을 바꾼다 — "이건 오탐이야", "오탐 처리해줘", "조치완료", "고쳤어/패치했어"에 쓴다. status는 "오탐" 또는 "조치완료". assetId·finding은 today/search 결과에서 지목한다. 예: {"assetId":"ai-secbot-01","finding":"버전 노출","status":"오탐","note":"내부망 전용"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id", required: true },
      { name: "finding", label: "대상 취약점", description: "심각도·유형으로 지목", required: true },
      { name: "status", label: "판정", description: "조치완료 / 오탐 (미검토로 원복도 가능)", required: true },
      { name: "note", label: "사유", description: "판정 근거·메모 (선택)", required: false },
    ],
    effect: (args) => {
      const st = normalizeStatus(args.status ?? "");
      if (st === "rejected") return "이 취약점을 오탐 처리 · SBOM 취약점과 '오늘의 조치'에서 제외됨";
      if (st === "approved") return "이 취약점을 조치완료로 확정 · 검토대장에 기록";
      return "판정을 미검토로 원복";
    },
    undo: "승인 화면에서 판정을 미검토로 되돌리면 원상복귀됩니다.",
    run: runUpdateFindingStatus,
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

// ── 결재판(시안 B, 2026-07-17 확정) ─────────────────────────────────────
// 쓰기 도구는 실행 전에 이 구조를 화면에 띄워 사람이 검토·승인한다. 각 값이 어디서 왔는지
// (지시에서/자동생성/AI 추정) 표시해, 7B 모델의 추정을 사람이 빠르게 검증하게 한다.
// 되물어보기(ask_user)는 별도 도구가 필요 없다 — 빠진 필수값이 빈 칸으로 표시되는 게 곧 되물음이다.

// said=지시문에 나온 값 · found=앞선 조회 결과(today/search 등)에서 온 값 · auto=서버 규칙 생성 ·
// guess=근거 없는 AI 추정(필수면 되묻음) · empty=빈 칸. said·found는 근거가 있어 그대로 유지한다.
export type FieldSource = "said" | "found" | "auto" | "guess" | "empty";

export interface ApprovalField {
  key: string;
  label: string;
  value: string;
  source: FieldSource;
  required: boolean;
  hint: string;
}

export interface PendingApproval {
  tool: string;
  label: string;
  fields: ApprovalField[];
  effect: string;
  undo: string;
  missing: string[]; // 필수인데 비어 있는 필드 — 화면이 빨갛게 강조하고 승인을 막는다
  instruction: string; // 이 결재판을 만든 원 지시 — 승인 시 파인튜닝 골드 예시로 누적(Phase 4)
}

// 값이 특정 텍스트(지시문·조회 결과)에 실제로 나왔는지 규칙으로 본다(LLM에게 출처를 묻지 않는다 — 부담·환각 회피).
// 공백을 무시하고 비교해 "사내 챗봇" ↔ "사내챗봇" 같은 표기 차이를 흡수한다.
function textHas(haystack: string, value: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const v = norm(value);
  return v.length >= 2 && norm(haystack).includes(v);
}

// toolResults: 이 결재판이 뜨기까지 에이전트 루프가 실행한 읽기 도구들의 결과(합친 텍스트).
// assign_finding의 assetId·finding처럼 "앞선 조회 결과에서 복사한" 값은 환각이 아니므로 유지한다.
export function buildApproval(
  tool: AgentTool,
  rawArgs: Record<string, string>,
  instruction: string,
  toolResults = ""
): PendingApproval {
  const autoFilled = tool.autoFill ? tool.autoFill(rawArgs) : {};
  const args = { ...rawArgs, ...autoFilled };
  const fields: ApprovalField[] = tool.params.map((p) => {
    const value = (args[p.name] ?? "").trim();
    let source: FieldSource;
    if (!value) source = "empty";
    else if (p.name in autoFilled) source = "auto";
    else if (textHas(instruction, value)) source = "said";
    else if (textHas(toolResults, value)) source = "found"; // 앞선 조회 결과에서 온 값 — 근거 있음
    else source = "guess";
    // 필수값은 LLM이 지어낸 값(guess)을 받지 않는다 — 빈 칸으로 되묻는다.
    // 실측(2026-07-17): 경로를 안 알려주고 "테스트봇 등록해줘"라고 하면 7B 모델이 그럴듯한
    // 파일 경로를 지어낸다. 근거 없는 필수값이 채워져 있으면 사람이 무심코 승인할 수 있으므로,
    // 필수값은 "지시·조회 결과에 있거나 서버 규칙이 만든 것"만 인정한다. 선택값의 추정은 배지로 표시만 한다.
    if (source === "guess" && p.required) return { key: p.name, label: p.label, value: "", source: "empty" as const, required: true, hint: p.description };
    return { key: p.name, label: p.label, value, source, required: p.required, hint: p.description };
  });
  return {
    tool: tool.name,
    label: tool.label,
    fields,
    effect: tool.effect ? tool.effect(args) : "",
    undo: tool.undo ?? "",
    missing: fields.filter((f) => f.required && !f.value).map((f) => f.key),
    instruction,
  };
}

// 승인된 쓰기 도구를 실행한다 — 화면에서 사람이 확인(값 수정 가능)한 뒤에만 여기로 온다.
// 규칙 검증은 여기서 한 번 더 한다(화면을 우회한 호출 방어).
export async function executeApprovedTool(toolName: string, args: Record<string, string>): Promise<string> {
  const tool = findAgentTool(toolName);
  if (!tool) throw new Error(`존재하지 않는 도구: ${toolName}`);
  if (!tool.write) throw new Error(`${toolName}은(는) 승인이 필요한 쓰기 도구가 아닙니다`);
  const invalid = validateToolArgs(tool, args);
  if (invalid) throw new Error(invalid);
  return String(await tool.run(args));
}
