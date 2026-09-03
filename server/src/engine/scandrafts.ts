// engine/scandrafts.ts — 스캔(Scan)·위협(TI) 팀원의 「부르는 문」(2026-09-03, 계획서 GIJO_AS_AI팀_증류학습_계획서.md §7 2단계).
//
// ■ 왜
//   등록부에 있던 스캔·TI 팀원은 LLM을 부르는 자리가 0이었다(llm_activity_daily 실측 — 「동작하는 척」).
//   스캔의 실제 일은 규칙 파서(webreport·vulnscan)가 하고 옳게 한다 — 그걸 LLM으로 바꾸지 않는다.
//   대신 파서가 **등록을 끝낸 직후**, 그 결과를 위협 관점에서 **정형 초안**(요약·우선 조치 3건·주의)으로 해석해 남긴다.
//   TI도 같다 — CTI↔자산 매칭은 규칙 엔진(ctimatch, 2회차 ti_trap에서 LLM보다 정확)이 하고, 걸린 것이 있을 때만 해석 3줄을 붙인다.
//
// ■ 정직 규칙
//   · 초안의 우선 조치는 **보고서에 실제로 있는 항목만** — 지어낸 코드·자산은 떨어뜨린다(validateDraft). 전부 떨어지면 저장하지 않는다.
//   · 반입을 막지 않는다 — 초안은 뒤에서 만들고, 실패하면 협업 창에 실패로 남긴다(조용히 삼키지 않는다).
//   · 초안은 **초안**이다. 할 일이 되려면 사람이 채택(register_scan_draft, 결재판)해야 한다 — 「승인이 유일한 문」.
//   · 시험 환경엔 모델이 없다 — chat은 주입(deps)으로 갈아 끼울 수 있고, 실패는 null이다.
import crypto from "crypto";
import { db, migrate } from "../db";
import { emitCollaboration } from "./collaboration";
import { setAgentStatus, resetAgentToDefault, getFormatHelperModel } from "./agents";
import { createTask } from "./tasks";
import { recordAudit } from "./audit";
import { 표식, cti심각도한글 } from "./tone"; // CTI 심각도 라벨의 단일 출처·🤖 표식 — 지역에서 새로 짓지 않는다(검토관 2026-09-03)
import { listTasks } from "./tasks";
import { extractLexicalTerms } from "./hybridsearch"; // CVE 뽑기는 CODE_RE 한 곳 — 새 정규식을 짓지 않는다(설계 계약 2026-09-03)
import { findCasesForCves, type IncidentCaseRow } from "./incidentcases";

migrate(
  "scan-drafts-2026-09-03",
  `CREATE TABLE IF NOT EXISTS scan_drafts (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    source TEXT NOT NULL,
    hosts INTEGER NOT NULL,
    findings INTEGER NOT NULL,
    draft TEXT NOT NULL,
    dropped INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    registeredBy TEXT,
    registeredAt INTEGER,
    taskIds TEXT
  )`,
);
// 📚 비슷한 침해사고 사례(2026-09-03) — 초안이 만들어진 직후 해설 팀원(normaltic)이 붙인다. caseIds=JSON 배열, caseNote=쉬운 부연(🤖) 또는 코드가 만든 제목 줄.
//   ⚠ 위 CREATE에 칸을 더하지 않는다 — 새 DB는 CREATE 뒤 이 ALTER가 한 번 돌고, 기존 DB는 ALTER만 돈다(둘 다 한 번). CREATE에도 넣으면 새 DB에서 duplicate column.
migrate("scan-drafts-cases-2026-09-03", "ALTER TABLE scan_drafts ADD COLUMN caseIds TEXT; ALTER TABLE scan_drafts ADD COLUMN caseNote TEXT;");

export interface ScanDraftPriority { code: string; name: string; host: string; why: string }
export interface ScanDraft { summary: string; priorities: ScanDraftPriority[]; caveats: string[] }
export interface ScanDraftVuln { code: string; name: string; risk: string; host: string }
export interface ScanDraftInput { source: string; hosts: number; findings: number; vulns: ScanDraftVuln[] }
export interface ScanDraftRow {
  id: string; createdAt: number; source: string; hosts: number; findings: number; draft: ScanDraft; dropped: number;
  status: "draft" | "registered"; registeredBy: string | null; registeredAt: number | null; taskIds: string[];
  /** 📚 비슷한 침해사고 사례 id(incident_cases.id) — 없으면 빈 배열. 대화창 답의 「📚 비슷한 사례 N건」의 N. */
  caseIds: string[];
  /** 사례 부연 — 🤖로 시작하면 해설 팀원이 쓴 글, 아니면 코드가 만든 제목 줄. 없으면 null. */
  caseNote: string | null;
}

export const SCAN_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    priorities: {
      type: "array",
      items: { type: "object", properties: { code: { type: "string" }, name: { type: "string" }, host: { type: "string" }, why: { type: "string" } }, required: ["code", "name", "host", "why"] },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "priorities", "caveats"],
} as const;

const MAX_VULNS_IN_PROMPT = 40;

export function buildScanDraftPrompt(input: ScanDraftInput): string {
  const lines = input.vulns.slice(0, MAX_VULNS_IN_PROMPT).map((v) => `${이름표(v.code, v.name)} · 위험 ${v.risk || "-"} · 자산 ${v.host || "-"}`);
  const 더 = input.vulns.length > MAX_VULNS_IN_PROMPT ? `\n(외 ${input.vulns.length - MAX_VULNS_IN_PROMPT}건 생략)` : "";
  return [
    "다음은 방금 자산·취약점으로 등록된 웹취약점 점검 보고서의 항목이다. 보안담당자에게 줄 해석 초안을 JSON으로만 써라.",
    "규칙: summary는 2~3문장(한국어, 300자 이내). priorities는 **아래 목록에 있는 항목만** 최대 3건 — code·name·host를 목록 그대로 옮기고 why에 왜 먼저인지 한 줄.",
    "caveats는 담당자가 확인해야 할 점(최대 3줄). 목록에 없는 취약점·자산·숫자를 지어내지 마라.",
    `보고서: ${input.source} · 자산 ${input.hosts} · 취약점 ${input.findings}건`,
    "항목:",
    ...lines,
    더,
  ].join("\n");
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
/** json_schema 경로는 한자 차단(GBNF)·중국어 재생성 후처리가 둘 다 꺼져 있다 — 사람이 읽는 줄은 여기서 거른다(actioncheck.ts와 같은 잣대). */
export const 우리말 = (s: string) => /[가-힣]/.test(s) && !/[一-鿿]/.test(s);
/** 파서의 name에 [코드]가 이미 붙어 있을 수 있다(webreport) — 두 번 찍지 않는다. */
export const 이름표 = (code: string, name: string) => (code && !name.includes(`[${code}]`) ? `[${code}] ${name}` : name || `[${code || "-"}]`);

/** 모델 출력이 보고서 사실 안에 있는지 검증한다 — 우선 조치는 실제 항목과 code(또는 name+host)가 맞아야 남는다. */
export function validateDraft(raw: unknown, vulns: ScanDraftVuln[]): { draft: ScanDraft; dropped: number } | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as { summary?: unknown; priorities?: unknown; caveats?: unknown };
  const summary = String(r.summary ?? "").trim();
  if (summary.length < 10 || !우리말(summary)) return null;
  const byCode = new Map(vulns.filter((v) => v.code).map((v) => [norm(v.code), v]));
  const out: ScanDraftPriority[] = [];
  let dropped = 0;
  for (const p of Array.isArray(r.priorities) ? r.priorities : []) {
    if (!p || typeof p !== "object") { dropped += 1; continue; }
    const q = p as Record<string, unknown>;
    const code = norm(q.code);
    const host = norm(q.host);
    // 같은 코드가 여러 자산에 걸리는 것이 보고서의 보통 모양이다(host::code) — code+host가 함께 맞는 항목을 먼저 찾고,
    // 자산을 지어냈거나 비웠을 때만 코드로 교정한다(검토관 2026-09-03: 예전엔 코드가 먼저 이겨 다른 자산을 지목했다).
    let hit = code ? vulns.find((v) => norm(v.code) === code && (!host || norm(v.host) === host)) : undefined;
    if (!hit && code) hit = byCode.get(code);
    if (!hit) hit = vulns.find((v) => norm(v.name) && norm(v.name) === norm(q.name) && (!host || norm(v.host) === host));
    if (!hit) { dropped += 1; continue; }
    if (out.some((x) => x.code === hit!.code && x.host === hit!.host)) continue; // 같은 것을 두 번
    const why = String(q.why ?? "").trim().slice(0, 200);
    out.push({ code: hit.code, name: hit.name, host: hit.host, why: 우리말(why) ? why : "" });
    if (out.length >= 3) break;
  }
  if (out.length === 0) return null; // 근거 있는 우선 조치가 하나도 없으면 초안이 아니다
  const caveats = (Array.isArray(r.caveats) ? r.caveats : []).map((c) => String(c ?? "").trim()).filter((c) => c && 우리말(c)).slice(0, 3).map((c) => c.slice(0, 200));
  return { draft: { summary: summary.slice(0, 600), priorities: out, caveats }, dropped };
}

type ChatFn = (args: { agentId: string; message: string; trusted: boolean; responseSchema?: unknown; maxTokens?: number; modelOverride?: string }) => Promise<string>;

const insertStmt = db.prepare(
  "INSERT INTO scan_drafts (id, createdAt, source, hosts, findings, draft, dropped, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')",
);

/**
 * 스캔 팀원의 부르는 문 — 보고서 등록 직후 부른다(반입 경로는 기다리지 않는다: `void draftScanInterpretation(...)`).
 * 돌려주는 값: 저장된 초안 id, 못 만들면 null(협업 창에 사유가 남는다).
 */
export async function draftScanInterpretation(input: ScanDraftInput, deps?: { chat?: ChatFn }): Promise<{ id: string; dropped: number } | null> {
  if (!input.vulns.length) return null;
  setAgentStatus("scan", "working");
  try {
    const chat: ChatFn = deps?.chat ?? ((await import("./llm.js")).chat as unknown as ChatFn);
    // 서식 전용 보조 모델(있으면) — 스키마 강제 추출이라 소형 모델의 강점 자리(3회차 실측). 팀원은 그대로 scan이다(활동·말풍선은 스캔 팀원 이름).
    const 보조 = getFormatHelperModel();
    const out = await chat({ agentId: "scan", message: buildScanDraftPrompt(input), trusted: true, responseSchema: SCAN_DRAFT_SCHEMA, maxTokens: 700, ...(보조 ? { modelOverride: 보조 } : {}) });
    const v = validateDraft(out, input.vulns);
    if (!v) {
      emitCollaboration({ from: "scan", to: "orchestrator", message: `${input.source} 해석 초안 못 만듦 — 모델 출력이 보고서 항목과 맞지 않아 버림(지어낸 항목은 남기지 않는다)` });
      noteSimilarCasesWithoutDraft({ source: input.source, findings: input.vulns }); // 규칙이 찾은 사례는 모델과 무관하다 — 초안이 없다고 사례까지 사라지면 안 된다
      return null;
    }
    const id = crypto.randomUUID();
    insertStmt.run(id, Date.now(), input.source, input.hosts, input.findings, JSON.stringify(v.draft), v.dropped);
    emitCollaboration({
      from: "scan", to: "orchestrator",
      message: `${input.source} 해석 초안 — 우선 조치 ${v.draft.priorities.length}건${v.dropped ? ` (근거 없는 ${v.dropped}건 버림)` : ""}: ${v.draft.priorities.map((p) => `[${p.code}] ${p.host}`).join(" · ")}${보조 ? ` · 서식 보조 모델 ${보조}` : ""}`,
    });
    // 해설 팀원의 부르는 문 ②(2026-09-03) — 초안이 생긴 직후 보고서 항목의 CVE로 과거 침해사고 사례를 찾아 붙인다.
    //   초안 반환을 기다리게 하지 않는다(void). 후보가 없으면 아무 말도 안 한다(침묵) — 없는 사례를 지어 붙이지 않는다.
    void explainSimilarCases({ draftId: id, findings: input.vulns });
    return { id, dropped: v.dropped };
  } catch (e) {
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${input.source} 해석 초안 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    noteSimilarCasesWithoutDraft({ source: input.source, findings: input.vulns }); // 모델이 죽어도 규칙 대조는 돈다(웹보고서 경로의 사례가 초안 성공에 묶여 있던 결함 — 검토관 2026-09-03)
    return null;
  } finally {
    resetAgentToDefault("scan");
  }
}

interface Raw { id: string; createdAt: number; source: string; hosts: number; findings: number; draft: string; dropped: number; status: string; registeredBy: string | null; registeredAt: number | null; taskIds: string | null; caseIds: string | null; caseNote: string | null }
const toRow = (r: Raw): ScanDraftRow => {
  let draft: ScanDraft = { summary: "", priorities: [], caveats: [] };
  try { draft = JSON.parse(r.draft) as ScanDraft; } catch { /* 깨진 행은 빈 초안으로 보인다 — 숨기지 않는다 */ }
  let taskIds: string[] = [];
  try { taskIds = r.taskIds ? (JSON.parse(r.taskIds) as string[]) : []; } catch { taskIds = []; }
  let caseIds: string[] = [];
  try { caseIds = r.caseIds ? (JSON.parse(r.caseIds) as string[]) : []; } catch { caseIds = []; }
  return { ...r, draft, status: r.status === "registered" ? "registered" : "draft", taskIds, caseIds, caseNote: r.caseNote ?? null };
};

export function listScanDrafts(limit = 5): ScanDraftRow[] {
  const rows = db.prepare("SELECT * FROM scan_drafts ORDER BY createdAt DESC LIMIT ?").all(Math.max(1, Math.min(50, limit))) as Raw[];
  return rows.map(toRow);
}

export function getScanDraft(idOrPrefix: string): ScanDraftRow | undefined {
  const key = String(idOrPrefix ?? "").trim();
  if (!key) return listScanDrafts(1)[0];
  const r = (db.prepare("SELECT * FROM scan_drafts WHERE id = ?").get(key) ?? db.prepare("SELECT * FROM scan_drafts WHERE id LIKE ? ORDER BY createdAt DESC").get(`${key}%`)) as Raw | undefined;
  return r ? toRow(r) : undefined;
}

/** 사람이 초안을 채택한다 — 우선 조치가 할 일(스캔 팀원 귀속)이 된다. 두 번 채택은 거부. */
export function registerScanDraft(idOrPrefix: string, by?: string | null): { row: ScanDraftRow; taskIds: string[]; 신규: number; 기존: number } {
  const row = getScanDraft(idOrPrefix);
  if (!row) throw new Error(`초안을 찾지 못했습니다: ${idOrPrefix || "(최근 없음)"}`);
  if (row.status === "registered") throw new Error(`이미 채택된 초안입니다(${row.registeredBy ?? "?"} · 할 일 ${row.taskIds.length}건)`);
  // createTask는 같은 글의 할 일이 이미 있으면 그 행을 돌려준다(중복 억제) — 「N건 등록」이 거짓이 되지 않게 새로 생긴 것만 센다.
  const 전에 = new Set(listTasks({ includeAgentRuns: true }).map((t) => t.id));
  const taskIds = row.draft.priorities.map((p) =>
    // ⚠ agentId를 붙이지 않는다 — tasks.listTasks는 agentId가 있는 행을 「에이전트 실행 기록」으로 보고 기본 목록에서 숨긴다.
    //   이 할 일은 사람이 채택한 사람의 일이다. 출처는 origin "ai"(AI가 제안), 근거는 ref로 초안에 잇는다. P1 = 높음(tasks.ts 잣대 P0~P3).
    createTask({ text: `[스캔 해석] ${p.host} ${이름표(p.code, p.name)} — ${p.why || "우선 조치"}`, priority: "P1", origin: "ai", ref: `scan_draft:${row.id}` }).id,
  );
  const 신규 = taskIds.filter((id) => !전에.has(id)).length;
  const 기존 = taskIds.length - 신규;
  db.prepare("UPDATE scan_drafts SET status = 'registered', registeredBy = ?, registeredAt = ?, taskIds = ? WHERE id = ?").run(by ?? null, Date.now(), JSON.stringify(taskIds), row.id);
  recordAudit({ kind: "write", actor: by ?? null, action: "스캔 해석 초안 채택", target: row.source, detail: `초안 ${row.id.slice(0, 8)} · 할 일 새로 ${신규}건${기존 ? ` · 이미 있던 ${기존}건` : ""}`, result: "ok" });
  return { row: getScanDraft(row.id)!, taskIds, 신규, 기존 };
}

export function formatScanDrafts(rows: ScanDraftRow[]): string {
  if (!rows.length) return "스캔 해석 초안이 없습니다 — 웹취약점 점검 보고서를 올리면 스캔 팀원이 등록 직후 초안을 남깁니다.";
  return rows
    .map((r) => {
      const 머리 = `■ ${r.source} — 자산 ${r.hosts}·취약점 ${r.findings}건 · ${new Date(r.createdAt).toLocaleString("ko-KR")} · ${r.status === "registered" ? `채택됨(${r.registeredBy ?? "?"}, 할 일 ${r.taskIds.length}건)` : `초안 #${r.id.slice(0, 8)}`}`;
      // 보고서와 대조한 것은 우선 조치의 코드·자산뿐이다 — 요약·이유·확인할 점은 AI가 쓴 글이라 🤖(안내) 표식을 붙이고 경계를 말한다.
      const 우선 = r.draft.priorities.map((p, i) => `  ${i + 1}. ${이름표(p.code, p.name)} @ ${p.host}${p.why ? ` — ${표식.안내} ${p.why}` : ""}`);
      const 주의 = r.draft.caveats.map((c) => `  ${표식.안내} 확인할 점: ${c}`);
      // 📚 비슷한 사례 — caseNote가 🤖로 시작하면 해설 팀원 글, 아니면 코드가 만든 제목 줄(둘 다 그대로 싣는다).
      //   ⚠ 「📚 비슷한 사례 N건」 문구는 계약이다 — 클라 칩(console.js attachCaseChip)이 이 표기로 칩을 단다. 바꾸면 칩이 조용히 사라진다.
      const 사례 = r.caseIds.length && r.caseNote ? `  ${표식.사례} 비슷한 사례 ${r.caseIds.length}건 — ${r.caseNote}` : "";
      return [머리, `  ${표식.안내} ${r.draft.summary}`, ...우선, ...주의, 사례, r.dropped ? `  (근거 없는 항목 ${r.dropped}건은 버렸습니다)` : "",
        `  ${표식.안내} 요약·이유·확인할 점은 AI가 쓴 글이라 사실 확인이 필요합니다 — 보고서와 대조한 것은 우선 조치의 코드·자산뿐입니다`].filter(Boolean).join("\n");
    })
    .join("\n\n")
    .slice(0, 2500);
}

// ── 해설(normaltic) 팀원의 부르는 문 ② — 스캔 초안에 📚 비슷한 침해사고 사례를 붙인다(2026-09-03) ────────
//
// ■ 왜 해설 팀원인가: 등록부의 역할이 「용어 해설 · 사례 부연(사내 지식)」인데 실제 문은 복합 지시 파이프라인(dispatcher) 한 곳뿐이었다.
//   과거 사고 사례는 침해사고 히스토리 표(incidentcases)가 규칙으로 찾고, 팀원은 **그 후보만 재료로** 2~4문장 쉬운 부연을 쓴다.
// ■ 정직 규칙: 후보 0이면 침묵(호출 없음). 모델이 후보 밖 사례 번호·CVE를 쓰면 그 부연은 버리고 코드가 만든 제목 줄만 남긴다(지어내기 금지).
//   모델이 늦거나(예산 GIJO_CASE_EXPLAIN_MS, 기본 8초) 죽어도 caseIds·제목 줄은 저장된다 — 규칙이 찾은 사실은 모델과 무관하다.
// ★ 지목은 **제목이 아니라 번호(ic-…)로** 받는다(2026-09-04 win 격리 왕복 실측 수리).
//   예전엔 모델이 돌려준 **제목**을 후보 제목과 글자 그대로 대조했는데, 긴 제목(em대시·괄호가 섞인)을
//   Qwen2.5-7B가 못 옮겨 2/2 탈락했다 — 부연은 멀쩡한데 **베껴 쓰기 시험**에서 떨어진 것이다.
//   번호는 짧고 형식이 고정이라 작은 모델도 옮긴다. 대신 「후보 밖은 버린다」는 잣대는 그대로 지킨다.
export const CASE_EXPLAIN_SCHEMA = {
  type: "object",
  // 키는 영문(스키마 강제 디코딩 관례). caseIds=부연에 쓴 사례 번호(후보 목록 안에서만), note=쉬운 부연.
  //   ⚠ caseIds를 **앞에** 둔다 — 강제 디코딩은 이 차례대로 뽑으므로, 재료를 먼저 고르고 그 다음에 글을 쓰게 한다.
  properties: { caseIds: { type: "array", items: { type: "string" } }, note: { type: "string" } },
  required: ["caseIds", "note"],
} as const;
const CASE_EXPLAIN_MS = () => Math.max(500, Number(process.env.GIJO_CASE_EXPLAIN_MS ?? 8000));

/** 보고서 항목(코드·이름)에서 CVE만 뽑는다 — hybridsearch CODE_RE(extractLexicalTerms) 재사용, 대문자로 나온다. */
export function cvesInFindings(findings: { code: string; name: string }[]): string[] {
  const text = findings.map((f) => `${f.code} ${f.name}`).join("\n");
  return extractLexicalTerms(text).codes.filter((c) => c.startsWith("CVE-"));
}

export function buildCaseExplainPrompt(cves: string[], 후보: IncidentCaseRow[]): string {
  return [
    "다음은 방금 등록된 취약점 점검 결과에 나온 CVE와, 규칙 엔진이 침해사고 히스토리에서 찾은 과거 사고 사례다(이미 확정된 사실). 보안담당자에게 줄 쉬운 부연을 JSON으로만 써라.",
    "caseIds: 부연에 쓴 사례의 **번호**만 배열로 — 아래 목록의 대괄호 안 번호(ic-로 시작)를 그대로 옮긴다. 목록에 없는 번호는 쓰지 마라.",
    "note: 2~4문장(한국어, 400자 이내) — 이 취약점이 실제 사고에서 어떻게 쓰였고 담당자가 무엇을 조심해야 하는지, **아래 사례의 제목·한 줄·교훈만 재료로**. 목록에 없는 사례·회사·숫자·CVE를 지어내지 마라.",
    `CVE: ${cves.join(", ")}`,
    "사례:",
    ...후보.map((c) => `- [${c.id}] ${c.title} (${c.year}·${c.industry}·${c.region}) — ${c.oneLiner} / 교훈: ${c.lesson}`),
  ].join("\n");
}

/** 사례 번호 꼴 — incidentcases.ID_RE(`ic-` + 16자리 16진수)와 같은 모양. 본문에서 「지어낸 번호」를 찾을 때만 쓴다(느슨하게 4자리부터 줍는다). */
const CASE_ID_IN_TEXT = /ic-[0-9a-f]{4,}/gi;

/**
 * 모델 출력을 후보와 대조한다 — caseIds는 **후보 번호 안의 것만** 남고, 하나도 안 맞으면 null.
 * note는 지어내기를 두 갈래로 본다: ① 보고서·후보 밖 CVE가 있으면 버린다 ② 후보 밖 사례 번호(ic-…)가 있으면 버린다.
 * (scandrafts.validateDraft와 같은 잣대: 지어낸 것은 떨어뜨리고, 전부 떨어지면 초안이 아니다.)
 *
 * ⚠ **제목 대조는 하지 않는다**(2026-09-04 수리). 제목을 글자 그대로 옮기게 하면 작은 모델(Qwen2.5-7B)이
 *   긴 제목에서 떨어져 나가고, 그건 부연의 품질이 아니라 **받아쓰기 실력**을 재는 것이었다.
 */
export function validateCaseNote(raw: unknown, 후보: IncidentCaseRow[], allowedCves: string[]): { note: string; matched: IncidentCaseRow[] } | null {
  let o: unknown = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; } }
  if (!o || typeof o !== "object") return null;
  const r = o as { note?: unknown; caseIds?: unknown };
  const note = String(r.note ?? "").trim().slice(0, 500);
  if (note.length < 10 || !우리말(note)) return null;
  const byId = new Map(후보.map((c) => [norm(c.id), c]));
  const matched: IncidentCaseRow[] = [];
  for (const t of Array.isArray(r.caseIds) ? r.caseIds : []) {
    const hit = byId.get(norm(t));
    if (hit && !matched.includes(hit)) matched.push(hit);
  }
  if (!matched.length) return null;
  const 허용 = new Set([...allowedCves, ...후보.flatMap((c) => c.cves)].map((c) => c.toUpperCase()));
  const 지어낸CVE = extractLexicalTerms(note).codes.filter((c) => c.startsWith("CVE-") && !허용.has(c));
  if (지어낸CVE.length) return null;
  const 지어낸번호 = (note.match(CASE_ID_IN_TEXT) ?? []).filter((id) => !byId.has(norm(id)));
  if (지어낸번호.length) return null;
  return { note, matched };
}

/**
 * 해설 팀원의 부연 **한 문** — 초안 훅(explainSimilarCases)과 반입 훅(explainSimilarCasesForImport)이 나눠 쓴다.
 * (부르는 문 수는 agentroster.test가 소스에서 센다 — 두 훅이 각자 chat을 부르면 「문 셋」이 되어 계약이 어긋난다.)
 * 돌려주는 값: 검증을 지난 부연, 없으면 빈 문자열(제목 줄만 남긴다). GIJO_CASE_EXPLAIN=0이면 모델을 부르지 않는다.
 */
async function 사례부연(cves: string[], 후보: IncidentCaseRow[], deps?: { chat?: ChatFn }): Promise<string> {
  if (process.env.GIJO_CASE_EXPLAIN === "0") return "";
  setAgentStatus("normaltic", "working");
  try {
    const chat: ChatFn = deps?.chat ?? ((await import("./llm.js")).chat as unknown as ChatFn);
    const 예산 = new Promise<string>((resolve) => setTimeout(() => resolve(""), CASE_EXPLAIN_MS()).unref?.());
    const out = await Promise.race([
      chat({ agentId: "normaltic", trusted: true, responseSchema: CASE_EXPLAIN_SCHEMA, maxTokens: 400, message: buildCaseExplainPrompt(cves, 후보) }),
      예산,
    ]);
    if (!out) return ""; // 시간 예산 초과 — 규칙이 찾은 사실(제목 줄)만
    const v = validateCaseNote(out, 후보, cves);
    if (v) return v.note;
    emitCollaboration({ from: "normaltic", to: "orchestrator", message: `비슷한 사례 부연 못 만듦 — 모델 출력이 후보 사례와 맞지 않아 버림(지어낸 사례·CVE는 남기지 않는다) · 제목 줄만 남김` });
    return "";
  } catch (e) {
    emitCollaboration({ from: "normaltic", to: "orchestrator", message: `비슷한 사례 부연 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)} · 제목 줄만 남김` });
    return "";
  } finally {
    resetAgentToDefault("normaltic");
  }
}

/**
 * 부연 재료·꼬리표로 넘기는 CVE 상한 — **세 훅이 나눠 쓰는 한 잣대**(초안 훅·반입 훅·초안 실패 훅).
 * 반입은 CVE가 수백이라 프롬프트에 다 부으면 안 되고, 초안 훅도 Nessus를 겸한 보고서에서는 같은 처지다(검토관 2026-09-03:
 * 초안 훅만 상한이 없어 보고서 전체 CVE가 caseNote 꼬리에 붙었다 — 같은 자리에 다른 잣대를 두면 반드시 어긋난다).
 */
export const IMPORT_CASE_CVE_CAP = 5;

/**
 * 규칙만으로 「비슷한 사례」를 찾는다 — 모델은 안 부른다. 세 훅이 나눠 쓰는 **한 자리**(잣대가 갈리지 않게).
 * 돌려주는 값: 후보 · 후보에 실제로 걸린 CVE(상한) · 코드가 만든 제목 줄. CVE가 없거나 후보가 0이면 null(침묵).
 */
function 사례찾기(findings: { code: string; name: string }[]): { 후보: IncidentCaseRow[]; 걸린CVE: string[]; 제목줄: string } | null {
  const cves = cvesInFindings(findings);
  if (!cves.length) return null;
  const 후보 = findCasesForCves(cves);
  if (!후보.length) return null; // 침묵 — 없는 사례를 지어 붙이지 않는다
  const 걸린 = new Set(후보.flatMap((c) => c.cves.map((x) => x.toUpperCase())));
  // 후보는 교집합으로 뽑았으니 걸린CVE는 반드시 하나 이상이다 — 「보고서에 있던 CVE 전부」가 아니라 「사례에 걸린 CVE」만 말한다.
  const 걸린CVE = cves.filter((c) => 걸린.has(c)).slice(0, IMPORT_CASE_CVE_CAP);
  return { 후보, 걸린CVE, 제목줄: 후보.map((c) => `${c.title}(${c.year})`).join(" · ") };
}

/**
 * 초안 직후 부른다(void) — CVE → 후보 사례(규칙) → (모델) 부연 → scan_drafts.caseIds/caseNote 저장 + 협업 창.
 * 돌려주는 값: 저장한 것, 후보가 없으면 null(아무 말도 안 한다). GIJO_CASE_EXPLAIN=0이면 모델 없이 제목 줄만.
 * · 절대 던지지 않는다 — `void`로 부르는 약속이 거부되면 아무도 못 받는다(반입 훅과 같은 계약, 검토관 2026-09-03).
 */
export async function explainSimilarCases(input: { draftId: string; findings: { code: string; name: string }[] }, deps?: { chat?: ChatFn }): Promise<{ caseIds: string[]; caseNote: string; ai: boolean } | null> {
  try {
    const m = 사례찾기(input.findings);
    if (!m) return null;
    const 부연 = await 사례부연(m.걸린CVE, m.후보, deps);
    const caseIds = m.후보.map((c) => c.id);
    // 🤖가 붙은 것만 AI 글 — 제목 줄은 코드가 만든다. 걸린 CVE를 꼬리에 단다: 클라 칩(console.js attachCaseChip)이 답 본문의 CVE 표기로
    // 히스토리를 좁혀 여는데, 초안 본문에는 코드(IW-20)만 있고 CVE가 없을 수 있다.
    const caseNote = `${부연 ? `${표식.안내} ${부연}` : m.제목줄} · ${m.걸린CVE.join(", ")}`;
    db.prepare("UPDATE scan_drafts SET caseIds = ?, caseNote = ? WHERE id = ?").run(JSON.stringify(caseIds), caseNote, input.draftId);
    emitCollaboration({ from: "normaltic", to: "orchestrator", message: `${표식.사례} 비슷한 사례 ${m.후보.length}건 — ${m.제목줄}${부연 ? ` · ${표식.안내} ${부연}` : ""}`.slice(0, 400) });
    return { caseIds, caseNote, ai: !!부연 };
  } catch (e) {
    emitCollaboration({ from: "normaltic", to: "orchestrator", message: `비슷한 사례 붙이기 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    return null;
  }
}

/**
 * 초안이 **실패했을 때**의 사례 대조(2026-09-03 검토관) — 규칙이 찾은 사실은 모델과 무관한데, 웹보고서 경로에서는
 * 사례 부연이 초안 성공에만 매달려 있어 모델이 죽으면 「비슷한 사례」가 통째로 사라졌다(그 경로는 vulnscan 반입 훅이 비켜 준다).
 * · 저장하지 않는다 — 붙일 초안 행이 없다. 협업 창 말풍선 하나뿐이다.
 * · 모델을 부르지 않는다 — 초안이 실패한 마당에 같은 모델을 또 부르지 않는다(부르는 문 수도 그대로 하나, agentroster.test 계약).
 * · 절대 던지지 않는다.
 */
export function noteSimilarCasesWithoutDraft(input: { source: string; findings: { code: string; name: string }[] }): { caseIds: string[]; caseNote: string } | null {
  try {
    const m = 사례찾기(input.findings);
    if (!m) return null;
    const caseNote = `${m.제목줄} · ${m.걸린CVE.join(", ")}`;
    emitCollaboration({
      from: "normaltic", to: "orchestrator",
      message: `${표식.사례} 비슷한 사례 ${m.후보.length}건 — ${input.source} 해석 초안은 못 만들었지만 규칙이 찾은 사례는 있습니다: ${caseNote}`.slice(0, 400),
    });
    return { caseIds: m.후보.map((c) => c.id), caseNote };
  } catch (e) {
    emitCollaboration({ from: "normaltic", to: "orchestrator", message: `${input.source} 비슷한 사례 확인 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    return null;
  }
}

/**
 * 해설 팀원의 부르는 문 ③ — 취약점 **반입** 직후 부른다(vulnscan.importVulnScan 끝, void). 네 등록 경로(웹취약점 보고서·Nessus HTML·
 * CSV/JSON 자동 갈래·/api/vulnscan/import)가 전부 그 함수를 지나므로 훅은 거기 하나다. 운영 실측(2026-09-03): 취약점 288건 중 CVE 있음
 * 201건(70%)이고 CVE는 Nessus/CSV/JSON에서 오는데, 초안 훅(explainSimilarCases)은 웹보고서 경로에서만 불려 CVE가 드문 길만 덮고 있었다.
 * · draftId 없음·저장 없음 — 협업 창 말풍선 **하나**뿐(초안이 없으니 칩이 읽을 caseNote 자리도 없다). 반입 한 번 = 말풍선 최대 하나.
 * · 후보 0이면 침묵. 끄개·예산은 초안 훅과 같다(GIJO_CASE_EXPLAIN·GIJO_CASE_EXPLAIN_MS). 웹보고서 format은 호출부가 건너뛴다(초안 훅이
 *   caseNote 저장 계약을 진다 — 이중 발화 금지). 호출부는 state==="new"인 finding만 넘긴다 — 재스캔마다 같은 사례를 되풀이하지 않는다.
 * · 부연 재료·꼬리표 CVE는 **후보에 걸린 것**만(IMPORT_CASE_CVE_CAP) — 반입 한 번의 CVE 수백 개를 프롬프트에 붓지 않는다.
 * · 절대 던지지 않는다 — void로 부르는 약속이 거부되면 아무도 못 받는다. 실패는 협업 창에 사유로 남긴다.
 */
export async function explainSimilarCasesForImport(input: { source: string; findings: { code: string; name: string }[] }, deps?: { chat?: ChatFn }): Promise<{ caseIds: string[]; caseNote: string; ai: boolean } | null> {
  try {
    const m = 사례찾기(input.findings);
    if (!m) return null;
    const 부연 = await 사례부연(m.걸린CVE, m.후보, deps);
    const caseIds = m.후보.map((c) => c.id);
    const caseNote = `${부연 ? `${표식.안내} ${부연}` : m.제목줄} · ${m.걸린CVE.join(", ")}`;
    emitCollaboration({
      from: "normaltic", to: "orchestrator",
      message: `${표식.사례} 비슷한 사례 ${m.후보.length}건 — ${input.source} 반입에서 CVE 있는 새 취약점 ${input.findings.length}건 중 ${m.걸린CVE.join(", ")}: ${m.제목줄}${부연 ? ` · ${표식.안내} ${부연}` : ""}`.slice(0, 400),
    });
    return { caseIds, caseNote, ai: !!부연 };
  } catch (e) {
    emitCollaboration({ from: "normaltic", to: "orchestrator", message: `${input.source} 비슷한 사례 확인 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    return null;
  }
}

// ⚠ 조회 API(GET /api/scan-drafts)는 두지 않는다(검토관 2026-09-03) — 주석·app.ts는 「클라 칩이 읽는다」고 적었지만
//   칩(console.js attachCaseChip)은 **답 본문의 문구**로 판정하고 이 창구를 부르는 코드는 어디에도 없었다(전수 grep 0곳).
//   부르는 사람 없는 창구는 인증·감사·상한을 이고 있는 빈 문일 뿐이라 지운다. 초안은 대화창 도구 scan_drafts(=formatScanDrafts)로 본다.
// ── TI 팀원의 부르는 문 ─────────────────────────────────────────────────────────────
export interface ThreatMatchLite { type: string; target: string; severity: string; assets: string[] }
export const TI_INTERPRET_SCHEMA = {
  type: "object",
  // 키는 영문(스키마 강제 디코딩 관례 — 한글 키는 실모델로 통과시킨 근거가 없다). 라벨·설명은 한글.
  properties: { interpretation: { type: "string" }, first_assets: { type: "array", items: { type: "string" } } },
  required: ["interpretation", "first_assets"],
} as const;
/** TI 해석 시간 예산 — threats는 즉답 도구다. 넘으면 규칙 답만 즉시 나간다(GIJO_TI_INTERPRET_MS, 기본 5초). */
const TI_INTERPRET_MS = () => Math.max(500, Number(process.env.GIJO_TI_INTERPRET_MS ?? 5000));

/**
 * CTI 매칭 결과(규칙)가 있을 때만 해석 3줄을 만든다. 실패하면 빈 문자열 — 요약(규칙)은 그대로 값이 있다.
 * GIJO_TI_INTERPRET=0 이면 끈다(시험 환경 기본 — vitest.config).
 */
export async function interpretThreats(items: ThreatMatchLite[], deps?: { chat?: ChatFn }): Promise<string> {
  if (!items.length || process.env.GIJO_TI_INTERPRET === "0") return "";
  setAgentStatus("ti", "working");
  try {
    const chat: ChatFn = deps?.chat ?? ((await import("./llm.js")).chat as unknown as ChatFn);
    const 목록 = items.slice(0, 8).map((m) => `- [${cti심각도한글(m.severity)}] ${m.type} — ${m.target} → 우리 자산: ${m.assets.slice(0, 3).join(", ")}`).join("\n");
    const 예산 = new Promise<string>((resolve) => setTimeout(() => resolve(""), TI_INTERPRET_MS()).unref?.());
    const out = await Promise.race([
      chat({
        agentId: "ti", trusted: true, responseSchema: TI_INTERPRET_SCHEMA, maxTokens: 350,
        message: `아래는 규칙 엔진이 위협 인텔을 우리 자산과 대조해 걸러낸 결과다(이미 확정된 사실). JSON으로만 답하라.\ninterpretation: 담당자에게 왜 지금 이것이 문제인지 2~3문장(한국어, 250자 이내). first_assets: 먼저 볼 자산 최대 3개(목록에 있는 자산 이름 그대로).\n목록에 없는 자산·위협·숫자를 지어내지 마라.\n\n${목록}`,
      }),
      예산,
    ]);
    if (!out) return ""; // 시간 예산 초과 — 규칙 답만 즉시(활동 신호에는 남는다)
    let o: { interpretation?: unknown; first_assets?: unknown } = {};
    try { o = JSON.parse(String(out).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return ""; }
    const 해석 = String(o.interpretation ?? "").trim().slice(0, 300);
    if (해석.length < 10 || !우리말(해석)) return "";
    const 자산전부 = new Set(items.flatMap((m) => m.assets.map(norm)));
    const 우선 = (Array.isArray(o.first_assets) ? o.first_assets : []).map((s) => String(s ?? "").trim()).filter((s) => s && 자산전부.has(norm(s))).slice(0, 3);
    return `${표식.안내} TI 해석: ${해석}${우선.length ? `\n  먼저 볼 자산: ${우선.join(", ")}` : ""}`;
  } catch {
    return "";
  } finally {
    resetAgentToDefault("ti");
  }
}
