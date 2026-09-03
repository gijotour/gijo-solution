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

export interface ScanDraftPriority { code: string; name: string; host: string; why: string }
export interface ScanDraft { summary: string; priorities: ScanDraftPriority[]; caveats: string[] }
export interface ScanDraftVuln { code: string; name: string; risk: string; host: string }
export interface ScanDraftInput { source: string; hosts: number; findings: number; vulns: ScanDraftVuln[] }
export interface ScanDraftRow {
  id: string; createdAt: number; source: string; hosts: number; findings: number; draft: ScanDraft; dropped: number;
  status: "draft" | "registered"; registeredBy: string | null; registeredAt: number | null; taskIds: string[];
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
      return null;
    }
    const id = crypto.randomUUID();
    insertStmt.run(id, Date.now(), input.source, input.hosts, input.findings, JSON.stringify(v.draft), v.dropped);
    emitCollaboration({
      from: "scan", to: "orchestrator",
      message: `${input.source} 해석 초안 — 우선 조치 ${v.draft.priorities.length}건${v.dropped ? ` (근거 없는 ${v.dropped}건 버림)` : ""}: ${v.draft.priorities.map((p) => `[${p.code}] ${p.host}`).join(" · ")}${보조 ? ` · 서식 보조 모델 ${보조}` : ""}`,
    });
    return { id, dropped: v.dropped };
  } catch (e) {
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${input.source} 해석 초안 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    return null;
  } finally {
    resetAgentToDefault("scan");
  }
}

interface Raw { id: string; createdAt: number; source: string; hosts: number; findings: number; draft: string; dropped: number; status: string; registeredBy: string | null; registeredAt: number | null; taskIds: string | null }
const toRow = (r: Raw): ScanDraftRow => {
  let draft: ScanDraft = { summary: "", priorities: [], caveats: [] };
  try { draft = JSON.parse(r.draft) as ScanDraft; } catch { /* 깨진 행은 빈 초안으로 보인다 — 숨기지 않는다 */ }
  let taskIds: string[] = [];
  try { taskIds = r.taskIds ? (JSON.parse(r.taskIds) as string[]) : []; } catch { taskIds = []; }
  return { ...r, draft, status: r.status === "registered" ? "registered" : "draft", taskIds };
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
      return [머리, `  ${표식.안내} ${r.draft.summary}`, ...우선, ...주의, r.dropped ? `  (근거 없는 항목 ${r.dropped}건은 버렸습니다)` : "",
        `  ${표식.안내} 요약·이유·확인할 점은 AI가 쓴 글이라 사실 확인이 필요합니다 — 보고서와 대조한 것은 우선 조치의 코드·자산뿐입니다`].filter(Boolean).join("\n");
    })
    .join("\n\n")
    .slice(0, 2500);
}

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
