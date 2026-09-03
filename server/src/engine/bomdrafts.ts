// engine/bomdrafts.ts — 부품표(BOM) 팀원의 「부르는 문」(2026-09-03, 사장님 「부품표 전용 팀원 만들자」 · 계획서 §7 2단계).
//
// ■ 왜 8번째 팀원인가
//   타사 부품표(SBOM) 검수·라이선스 판정·AI-BOM 결손은 전부 규칙 엔진(sbomreview·licenserisk)이 하고 옳게 한다 —
//   그 다섯 파일에는 LLM 호출이 0이었다(정찰 2026-09-03). 2026-07-17에 SBOM 페르소나를 뺀 이유는 「일반 LLM 답변만 내던 중복」이었고,
//   이번엔 다르다: **규칙 판정 뒤에** 담당자 말로 해석(무엇부터 볼지·왜 위험한지)과 라이선스 의무 설명을 붙인다.
//
// ■ 정직 규칙(scandrafts.ts와 같다)
//   · 초안의 「먼저 볼 부품」은 검수 결과에 실제로 있는 부품만 — 지어낸 부품·버전은 떨어뜨린다(validateBomDraft). 전부 떨어지면 저장 안 함.
//   · 반입을 막지 않는다(autoupload는 void로 부른다). 실패는 협업 창에 남긴다.
//   · 등급 판정을 여기서 다시 적지 않는다 — 판정·요구·면책은 licenserisk.ts 한 곳(licenserisk.test의 소스 감시가 그것을 지킨다).
//   · 초안은 해석뿐이다 — 채택→할 일 칸을 두지 않는다(쓰인 적 없는 값을 만들지 않는다, 설계관 2026-09-03 ④).
import crypto from "crypto";
import { db, migrate } from "../db";
import { emitCollaboration } from "./collaboration";
import { setAgentStatus, resetAgentToDefault } from "./agents";
import { 등급판정, 면책문구, 등급순위, type 라이선스등급 }from "./licenserisk";
import { 표식 } from "./tone";
import { 우리말 } from "./scandrafts";

migrate(
  "bom-drafts-2026-09-03",
  `CREATE TABLE IF NOT EXISTS bom_drafts (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    reviewId TEXT NOT NULL,
    source TEXT NOT NULL,
    componentCount INTEGER NOT NULL,
    draft TEXT NOT NULL,
    dropped INTEGER NOT NULL DEFAULT 0
  )`,
);

export interface BomComponentLite { name: string; version: string; license: string; tier: 라이선스등급 | string; 받게되는요구: string; needsCheck?: boolean }
export interface BomDraftPriority { name: string; version: string; license: string; why: string }
export interface BomDraft { summary: string; priorities: BomDraftPriority[]; caveats: string[] }
export interface BomDraftInput { reviewId: string; source: string; componentCount: number; summary: Record<string, number>; components: BomComponentLite[] }
export interface BomDraftRow { id: string; createdAt: number; reviewId: string; source: string; componentCount: number; draft: BomDraft; dropped: number }

export const BOM_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    priorities: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, version: { type: "string" }, license: { type: "string" }, why: { type: "string" } }, required: ["name", "version", "license", "why"] },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "priorities", "caveats"],
} as const;

const MAX_IN_PROMPT = 40;
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");

export function buildBomDraftPrompt(input: BomDraftInput): string {
  // 무거운 등급부터 — 담당자가 먼저 볼 것이 목록 앞에 오게. 순위는 licenserisk 등급순위 한 곳(여기서 등급 이름을 나열하지 않는다 — 검토관 2026-09-03: 판정불가가 뒤로 밀려 40건 컷에서 빠졌다).
  const 무게 = (t: unknown) => 등급순위[t as 라이선스등급] ?? 99; // 모르는 등급은 가장 무겁게(빠지지 않게)
  const sorted = [...input.components].sort((a, b) => 무게(b.tier) - 무게(a.tier));
  const lines = sorted.slice(0, MAX_IN_PROMPT).map((c) => `- ${c.name}@${c.version || "-"} · ${c.license || "(라이선스 모름)"} · 등급 ${c.tier} · 요구: ${c.받게되는요구 || "-"}`);
  const 더 = sorted.length > MAX_IN_PROMPT ? `\n(외 ${sorted.length - MAX_IN_PROMPT}건 생략)` : "";
  const 등급별 = Object.entries(input.summary).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(" · ");
  return [
    "다음은 규칙 엔진이 타사 부품표(SBOM)를 검수해 라이선스 등급을 매긴 결과다(이미 확정된 사실). 보안담당자에게 줄 해석 초안을 JSON으로만 써라.",
    "규칙: summary는 2~3문장(한국어, 300자 이내) — 이 부품표를 쓰면 무엇을 요구받게 되는지. priorities는 **아래 목록에 있는 부품만** 최대 3건 — name에는 부품 이름만(버전은 version 칸, 라이선스는 license 칸에 따로), 목록 그대로 옮기고 why에 왜 먼저 봐야 하는지 한 줄.",
    "caveats는 담당자가 확인할 점(최대 3줄, 예: 라이선스 모름 부품은 공급사에 확인). 목록에 없는 부품·라이선스·숫자를 지어내지 마라. 법적 판단을 내리지 마라(등급·요구는 규칙이 이미 정했다).",
    `부품표: ${input.source} · 부품 ${input.componentCount}개 · 등급별: ${등급별 || "없음"}`,
    "부품:",
    ...lines,
    더,
  ].join("\n");
}

/** 모델 출력이 검수 결과 안에 있는지 검증 — 먼저 볼 부품은 실제 부품(name, 가능하면 version)과 맞아야 남는다. */
export function validateBomDraft(raw: unknown, components: BomComponentLite[]): { draft: BomDraft; dropped: number } | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as { summary?: unknown; priorities?: unknown; caveats?: unknown };
  const summary = String(r.summary ?? "").trim();
  if (summary.length < 10 || !우리말(summary)) return null;
  const out: BomDraftPriority[] = [];
  let dropped = 0;
  for (const p of Array.isArray(r.priorities) ? r.priorities : []) {
    if (!p || typeof p !== "object") { dropped += 1; continue; }
    const q = p as Record<string, unknown>;
    // 모델이 「이름@버전」·「이름 (라이선스)」 꼴로 합쳐 쓰는 일이 잦다(격리 실측 2026-09-03) — 이름 칸에서 부품 이름만 떼어 본다.
    //   npm scoped 이름(@babel/core)은 선행 @가 이름의 일부다 — 그것까지 버전 구분자로 보면 이름이 비어 항상 버려진다(검토관 2026-09-03).
    const rawName = String(q.name ?? "").trim();
    const scoped = rawName.startsWith("@");
    const body = scoped ? rawName.slice(1) : rawName;
    const name = norm((scoped ? "@" : "") + body.split(/[@(]/)[0]);
    const version = norm(q.version) || norm(body.includes("@") ? body.split("@")[1]?.split(/[\s(]/)[0] : "");
    let hit = name ? components.find((c) => norm(c.name) === name && (!version || norm(c.version) === version)) : undefined;
    if (!hit && name) hit = components.find((c) => norm(c.name) === name); // 버전을 지어냈거나 비웠다 — 이름으로 교정
    if (!hit && name.length >= 4) {
      // 접두·접미 한정 + 후보가 정확히 하나일 때만(예: libssl ↔ openssl-libssl). 길이 없는 포함 관계는 ssl→openssl, lodash→lodash.merge처럼
      // 다른 부품으로 조용히 치환한다(검토관 2026-09-03). 둘 이상 걸리면 어느 것인지 모르므로 버린다.
      const 후보 = components.filter((c) => { const nm = norm(c.name); return nm.length >= 4 && (nm.startsWith(name) || nm.endsWith(name) || name.startsWith(nm) || name.endsWith(nm)); });
      if (후보.length === 1) hit = 후보[0];
    }
    if (!hit) { dropped += 1; continue; }
    if (out.some((x) => x.name === hit!.name && x.version === hit!.version)) continue;
    const why = String(q.why ?? "").trim().slice(0, 200);
    out.push({ name: hit.name, version: hit.version, license: hit.license, why: 우리말(why) ? why : "" });
    if (out.length >= 3) break;
  }
  if (out.length === 0) return null;
  const caveats = (Array.isArray(r.caveats) ? r.caveats : []).map((c) => String(c ?? "").trim()).filter((c) => c && 우리말(c)).slice(0, 3).map((c) => c.slice(0, 200));
  return { draft: { summary: summary.slice(0, 600), priorities: out, caveats }, dropped };
}

/** 검증이 왜 떨어졌는지 한 줄 — 로그·진단용(판정 로직은 validateBomDraft 하나, 여기서는 이유만 읽는다). */
export function validateFailureReason(raw: unknown, components: BomComponentLite[]): string {
  let o: unknown = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return "JSON 파싱 실패"; } }
  if (!o || typeof o !== "object") return "객체 아님";
  const r = o as { summary?: unknown; priorities?: unknown };
  const summary = String(r.summary ?? "").trim();
  if (summary.length < 10) return "요약이 너무 짧음";
  if (!우리말(summary)) return "요약에 한자가 섞였거나 한글이 없음";
  const names = (Array.isArray(r.priorities) ? r.priorities : []).map((p) => String((p as Record<string, unknown>)?.name ?? "")).filter(Boolean);
  return `우선 부품 ${names.length}건 중 검수 부품과 맞는 것 0 — 모델이 쓴 이름: ${names.join(", ").slice(0, 200)} / 검수 부품: ${components.map((c) => c.name).join(", ").slice(0, 200)}`;
}

type ChatFn = (args: { agentId: string; message: string; trusted: boolean; responseSchema?: unknown; maxTokens?: number }) => Promise<string>;

const insertStmt = db.prepare("INSERT INTO bom_drafts (id, createdAt, reviewId, source, componentCount, draft, dropped) VALUES (?, ?, ?, ?, ?, ?, ?)");

/** 부품표 팀원의 부르는 문 ① — 타사 SBOM 검수(규칙)가 끝난 직후 부른다(autoupload가 void로). 못 만들면 null, 사유는 협업 창에. */
export async function draftBomInterpretation(input: BomDraftInput, deps?: { chat?: ChatFn }): Promise<{ id: string; dropped: number } | null> {
  if (!input.components.length) return null;
  setAgentStatus("bom", "working");
  try {
    const chat: ChatFn = deps?.chat ?? ((await import("./llm.js")).chat as unknown as ChatFn);
    const out = await chat({ agentId: "bom", message: buildBomDraftPrompt(input), trusted: true, responseSchema: BOM_DRAFT_SCHEMA, maxTokens: 700 });
    const v = validateBomDraft(out, input.components);
    if (!v) {
      // 실패 이유를 한 번 계산해 서버 로그(원문 포함)와 협업 창(사유만)에 같이 남긴다 — 「맞지 않음」만으로는 프롬프트를 못 고친다(격리 실측 2026-09-03).
      const 사유 = validateFailureReason(out, input.components);
      console.warn(`[bomdrafts] 검증 실패 — ${사유} · 모델 원문: ${String(out).replace(/\s+/g, " ").slice(0, 1500)}`);
      emitCollaboration({ from: "bom", to: "orchestrator", message: `${input.source} 부품표 해석 초안 못 만듦 — ${사유.slice(0, 160)}(지어낸 부품은 남기지 않는다)` });
      return null;
    }
    const id = crypto.randomUUID();
    insertStmt.run(id, Date.now(), input.reviewId, input.source, input.componentCount, JSON.stringify(v.draft), v.dropped);
    emitCollaboration({
      from: "bom", to: "orchestrator",
      message: `${input.source} 부품표 해석 초안 — 먼저 볼 부품 ${v.draft.priorities.length}건${v.dropped ? ` (근거 없는 ${v.dropped}건 버림)` : ""}: ${v.draft.priorities.map((p) => `${p.name}@${p.version || "-"}`).join(" · ")}`,
    });
    return { id, dropped: v.dropped };
  } catch (e) {
    emitCollaboration({ from: "bom", to: "orchestrator", message: `${input.source} 부품표 해석 초안 실패 — ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    return null;
  } finally {
    resetAgentToDefault("bom");
  }
}

interface Raw { id: string; createdAt: number; reviewId: string; source: string; componentCount: number; draft: string; dropped: number }
const toRow = (r: Raw): BomDraftRow => {
  let draft: BomDraft = { summary: "", priorities: [], caveats: [] };
  try { draft = JSON.parse(r.draft) as BomDraft; } catch { /* 깨진 행은 빈 초안으로 보인다 */ }
  return { ...r, draft };
};

/** 검수를 지우면 그 초안도 함께 — 없는 검수의 초안이 남아 보이면 안 된다(sbomreview.검수삭제가 부른다). */
export function deleteBomDraftsForReview(reviewId: string): number {
  return db.prepare("DELETE FROM bom_drafts WHERE reviewId = ?").run(reviewId).changes;
}

export function listBomDrafts(limit = 3): BomDraftRow[] {
  return (db.prepare("SELECT * FROM bom_drafts ORDER BY createdAt DESC LIMIT ?").all(Math.max(1, Math.min(50, limit))) as Raw[]).map(toRow);
}

export function formatBomDrafts(rows: BomDraftRow[]): string {
  if (!rows.length) return "부품표 해석 초안이 없습니다 — 타사 SBOM을 올리면 검수 직후 부품 팀원이 초안을 남깁니다.";
  return rows
    .map((r) => {
      const 머리 = `■ ${r.source} — 부품 ${r.componentCount}개 · ${new Date(r.createdAt).toLocaleString("ko-KR")} · 초안 #${r.id.slice(0, 8)}`;
      const 우선 = r.draft.priorities.map((p, i) => `  ${i + 1}. ${p.name}@${p.version || "-"} (${p.license || "라이선스 모름"})${p.why ? ` — ${표식.안내} ${p.why}` : ""}`);
      const 주의 = r.draft.caveats.map((c) => `  ${표식.안내} 확인할 점: ${c}`);
      return [머리, `  ${표식.안내} ${r.draft.summary}`, ...우선, ...주의, r.dropped ? `  (근거 없는 부품 ${r.dropped}건은 버렸습니다)` : "",
        `  ${표식.안내} 요약·이유·확인할 점은 AI가 쓴 글입니다 — 등급·요구는 규칙 판정(검수 결과)이 정본이고, 초안은 부품 이름·버전만 검수 결과와 대조했습니다`].filter(Boolean).join("\n");
    })
    .join("\n\n")
    .slice(0, 2500);
}

// ── 부르는 문 ② — 라이선스 의무 설명(대화창 도구 license_explain) ─────────────────────────────────
export const LICENSE_EXPLAIN_SCHEMA = {
  type: "object",
  properties: { explanation: { type: "string" }, first_step: { type: "string" } },
  required: ["explanation", "first_step"],
} as const;
/** 설명은 즉답 도구 안에서 돈다 — 시간 예산(기본 8초)을 넘으면 규칙 판정문만 나간다(GIJO_BOM_EXPLAIN_MS). */
const EXPLAIN_MS = () => Math.max(500, Number(process.env.GIJO_BOM_EXPLAIN_MS ?? 8000));

/**
 * 라이선스 이름 하나를 받아 규칙 판정(등급·요구·근거, licenserisk 한 곳)을 먼저 적고, 그 뒤에 부품 팀원의 설명 2~3문장을 붙인다.
 * 규칙 문장은 항상 나간다. 설명은 모델이 시간 안에 못 오거나 한자가 섞이면 빠진다(사람이 읽는 줄만 거른다).
 */
/** 입력에서 라이선스 이름 후보만 뽑는다 — 문장이 통째로 들어오면 그 문장을 라이선스 이름처럼 출력했다(검토관 2026-09-03). */
export function 라이선스이름후보(입력: string): string {
  const 후보 = String(입력 ?? "").match(/[A-Za-z][A-Za-z0-9.+-]{1,}/g) ?? [];
  // SPDX스러운 것(하이픈·숫자 포함) 우선, 없으면 첫 영문 토큰. 판본 풀이는 licenserisk 자유표기 한 곳이 한다.
  return (후보.find((t) => /[-0-9]/.test(t)) ?? 후보[0] ?? "").trim();
}

export async function explainLicense(license: string, deps?: { chat?: ChatFn }): Promise<string> {
  const 입력 = String(license ?? "").trim();
  const 원문 = 라이선스이름후보(입력);
  if (!원문) return "어느 라이선스인지 이름을 적어 주세요(예: AGPL-3.0, GPL-2.0, MIT, Apache-2.0).";
  const 판정 = 등급판정(원문); // 판본 없는 홑이름(AGPL·GPL)도 licenserisk 자유표기가 읽고 확인필요를 붙인다
  const 줄 = [
    `${표식.위치} ${원문} — 등급 「${판정.등급}」${판정.확인필요 ? " (확인 필요)" : ""}`,
    `  요구: ${판정.받게되는요구}`,
    `  근거: ${판정.근거}`,
    // ⚠ NC(비영리)·ND(변경금지) 줄을 여기서 따로 붙이지 않는다(2026-09-03 검토관 수리 뒤). 등급판정이 알아본
    //   판정불가(NC·ND·LicenseRef)의 「요구」 칸에 그 조건 문장을 이미 싣는다 — 같은 뜻을 두 줄로 내면 담당자는
    //   조건이 둘인 줄 안다. 문장은 licenserisk 한 곳이 짓는다(bomdrafts.test 소스 감시).
  ];
  if (process.env.GIJO_BOM_EXPLAIN !== "0") {
    setAgentStatus("bom", "working");
    try {
      const chat: ChatFn = deps?.chat ?? ((await import("./llm.js")).chat as unknown as ChatFn);
      const 예산 = new Promise<string>((resolve) => setTimeout(() => resolve(""), EXPLAIN_MS()).unref?.());
      const out = await Promise.race([
        chat({
          agentId: "bom", trusted: true, responseSchema: LICENSE_EXPLAIN_SCHEMA, maxTokens: 300,
          message: `아래는 규칙 엔진이 정한 라이선스 판정이다(확정된 사실 — 바꾸거나 반박하지 마라). 보안담당자에게 JSON으로만 답하라.\nexplanation: 이 라이선스의 부품을 우리 제품·서비스에 넣으면 실무에서 무엇이 달라지는지 2~3문장(한국어, 250자 이내, 법적 판단 아님·판정에 적힌 요구를 풀어 쓰기). first_step: 담당자가 먼저 할 일 한 줄.\n\n라이선스: ${원문}\n등급: ${판정.등급}\n요구: ${판정.받게되는요구}\n근거: ${판정.근거}`,
        }),
        예산,
      ]);
      if (out) {
        let o: { explanation?: unknown; first_step?: unknown } = {};
        try { o = JSON.parse(String(out).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { o = {}; }
        const 설명 = String(o.explanation ?? "").trim().slice(0, 300);
        const 첫걸음 = String(o.first_step ?? "").trim().slice(0, 120);
        if (설명.length >= 10 && 우리말(설명)) 줄.push(`  ${표식.안내} 부품 팀원 설명: ${설명}${첫걸음 && 우리말(첫걸음) ? `\n  ${표식.다음} 먼저 할 일: ${첫걸음}` : ""}`);
      }
    } catch {
      /* 설명이 없어도 규칙 판정문은 그대로 값이 있다 */
    } finally {
      resetAgentToDefault("bom");
    }
  }
  줄.push(`  ${면책문구}`);
  return 줄.join("\n").slice(0, 2500);
}
