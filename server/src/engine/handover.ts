// engine/handover.ts — 퇴사자 인수인계 자동 검증 (Knowledge Transfer Verify)
//
// 담당자가 노하우 문서를 RAG에 올린 뒤 "AI가 정말 이 문서로 답하는가"를 기계가 확인한다:
//   문서 조각 샘플 → LLM이 그 문서로만 답할 수 있는 실무 질문 1개 생성 → 실제 디스패치
//   → 응답의 근거 문서(sources — dispatcher.computeOfferSignals가 채움)에 해당 문서가 오르는지 판정.
// 회귀 하네스(tools/regress)와 같은 "생성-실행-대조" 메커니즘이고, sources 인프라(근거 배지)를 재사용한다.
// 결과 리포트는 퇴사 절차의 감사 증적(무엇을 이관했고 검증 통과율 몇 %)으로 쓸 수 있다.

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";

export interface HandoverCheck {
  documentId: string;
  question: string; // 자동 생성된 검증 질문
  cited: boolean; // 답변 근거에 이 문서가 올랐는가 = 이관 성공
  sources: string[]; // 실제로 오른 근거 문서들
  answerPreview: string;
  error?: string;
}

export interface HandoverReport {
  total: number;
  cited: number;
  passRate: number; // 0~100
  results: HandoverCheck[];
}

// 의존성 주입 — 테스트가 실 LLM·DB 없이 판정 로직을 검증할 수 있게 한다.
export interface HandoverDeps {
  sampleOf: (documentId: string) => Promise<string | null>;
  genQuestion: (sample: string) => Promise<string>;
  ask: (question: string) => Promise<{ output: string; sources?: string[] }>;
}

async function defaultDeps(): Promise<HandoverDeps> {
  const { getDocumentSample } = await import("./memory.js");
  const { chat } = await import("./llm.js");
  const { dispatchInstruction } = await import("./dispatcher.js");
  return {
    sampleOf: (id) => getDocumentSample(id),
    genQuestion: async (sample) =>
      chat({
        agentId: "analysis",
        message: [
          "아래는 사내 인수인계 문서의 일부다. 이 문서 내용으로만 답할 수 있는 실무 질문 1개를 한국어 한 문장으로 만들어라.",
          "질문 문장만 출력하고 다른 말은 붙이지 마라.",
          "",
          "[문서]",
          sample.slice(0, 1500),
        ].join("\n"),
        trusted: true,
        maxTokens: 120,
      }),
    ask: async (q) => {
      const r = await dispatchInstruction(q);
      return { output: r.output, sources: r.sources };
    },
  };
}

const MAX_DOCS = 10; // 한 번에 검증할 문서 상한 — 문서당 LLM 2회(질문 생성+디스패치)라 배치를 제한한다

export async function verifyHandover(documentIds: string[], deps?: HandoverDeps): Promise<HandoverReport> {
  const d = deps ?? (await defaultDeps());
  const results: HandoverCheck[] = [];
  for (const documentId of documentIds.slice(0, MAX_DOCS)) {
    try {
      const sample = await d.sampleOf(documentId);
      if (!sample) {
        results.push({ documentId, question: "", cited: false, sources: [], answerPreview: "", error: "문서 조각을 찾지 못했습니다(인입 여부 확인)" });
        continue;
      }
      // 질문 생성 실패(LLM 다운 등)면 문서명 기반 폴백 질문 — 검증 자체는 계속한다.
      let question = "";
      try {
        question = (await d.genQuestion(sample)).trim().split("\n")[0].replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 200);
      } catch {
        /* 폴백으로 */
      }
      if (!question) question = `${documentId.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")} 관련 절차를 알려줘`;
      const a = await d.ask(question);
      const sources = a.sources ?? [];
      results.push({ documentId, question, cited: sources.includes(documentId), sources, answerPreview: (a.output ?? "").slice(0, 200) });
    } catch (err) {
      results.push({ documentId, question: "", cited: false, sources: [], answerPreview: "", error: err instanceof Error ? err.message : String(err) });
    }
  }
  const cited = results.filter((r) => r.cited).length;
  return { total: results.length, cited, passRate: results.length ? Math.round((cited / results.length) * 100) : 0, results };
}

export function registerHandoverRoutes(app: Express): void {
  // 인수인계 자동 검증 — 올린 문서들이 실제로 답변 근거로 인용되는지 일괄 확인.
  app.post(
    "/api/handover/verify",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body?.documentIds)
        ? (req.body.documentIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];
      if (ids.length === 0) {
        res.status(400).json({ error: "documentIds(검증할 문서 ID 배열)가 필요합니다" });
        return;
      }
      res.json(await verifyHandover(ids));
    })
  );

  // 인수인계 완료 처리 — 이관자·문서 목록·검증 통과율을 감사 로그(작업 기록)에 증적으로 남긴다.
  app.post(
    "/api/handover/complete",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body?.documentIds)
        ? (req.body.documentIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const cited = Number(req.body?.cited ?? 0);
      const total = Number(req.body?.total ?? ids.length);
      const passRate = Number(req.body?.passRate ?? 0);
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      recordAudit({
        kind: "write",
        actor,
        action: "인수인계 완료",
        target: null,
        detail: `문서 ${total}건 이관 · 검증 인용 ${cited}/${total} (${passRate}%) — ${ids.slice(0, 10).join(", ")}${ids.length > 10 ? " 외" : ""}`,
        result: "ok",
      });
      res.json({ ok: true });
    })
  );
}
