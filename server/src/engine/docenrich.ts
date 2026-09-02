// engine/docenrich.ts — 문서 보강 인입: 영문 제품 매뉴얼·장애노트를 클라우드 LLM으로 한글 변환 +
// 온톨로지 관계 추출해서 RAG·온톨로지에 저장한다(2026-07-19 설계).
//
// 왜: 로컬 7B로는 1,500페이지 영문 매뉴얼을 실시간으로 못 읽는다. 무거운 일(번역·구조화)을 미리
// 한 번, 클라우드로 처리해두면 질의 시점엔 로컬 7B가 관련 한글 조각 + 온톨로지 사실만 읽으면 된다.
// PDF 추출이 띄어쓰기를 잃는 문제(예: "TenableSecurityCenter")도 번역이 함께 교정한다.
//
// 보안: 벤더 공개 매뉴얼 등 "외부로 나가도 되는 자료"에만 쓴다. 인입 텍스트에 내부 식별자가
// 섞이면(사설IP·자산명 등) screenForCloud가 잡아 그 청크는 번역하지 않고 원문 그대로 저장한다.

import type { Express } from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { cloudComplete } from "./cloudllm";
import { screenForCloud } from "./cloudegress";
import { ingestText, GLOBAL_SCOPE } from "./memory";
import { addTriples } from "./ontology";
import { emitCollaboration } from "./collaboration";
import { chat } from "./llm";

const ENRICH_SYSTEM =
  "당신은 보안제품 문서를 한국 보안팀의 지식베이스에 넣기 위해 가공하는 전문가입니다. " +
  "영문 발췌를 (1) 자연스러운 한국어로 번역하고 (2) 검색·조치에 바로 쓸 수 있는 관계(트리플)로 구조화합니다. " +
  "번역 시 명령어·CLI·설정키·파일경로·포트번호·플러그인 ID·제품명·CVE·로그 필드명 등 식별자는 원문 그대로 둡니다(번역/변형 금지). " +
  "반드시 JSON 하나만 출력하고 다른 말은 하지 않습니다.";

// 보강 방식 — cloud(품질 최고·비용/한도) · local(폐쇄망·무료·품질 낮음) · auto(클라우드 되면 쓰고
// 안 되면 로컬) · manual(사람이 한글·트리플을 직접 작성해 올림, AI 미사용·최고 정확).
export type EnrichMode = "auto" | "cloud" | "local" | "manual";

export interface EnrichResult {
  korean: string;
  triples: { subject: string; predicate: string; object: string }[];
  translated: boolean; // false면 내부정보 감지·실패로 원문 저장(번역 안 함)
  via: "cloud" | "local" | "none"; // 실제로 무엇으로 보강했는지(투명성)
}

function buildEnrichPrompt(text: string, productName: string): string {
  return [
    `제품: ${productName}`,
    "아래 발췌를 처리해 다음 형식의 JSON 하나만 출력하세요:",
    '{"korean":"<한국어 번역, 식별자는 원문 유지>","triples":[{"subject":"<주체>","predicate":"<관계>","object":"<값>"}]}',
    "triples 규칙: 로그필드→의미, 설정항목→기본값/설명, 증상/에러→원인/해결처럼 '검색해서 바로 쓸' 명확한 사실만.",
    "애매하거나 서술뿐이면 triples는 빈 배열 []. subject·predicate·object는 짧은 한국어(식별자는 원문).",
    "",
    "발췌:",
    '"""',
    text.slice(0, 6000),
    '"""',
  ].join("\n");
}

// 코드펜스·앞뒤 잡텍스트를 걷어내고 첫 JSON 객체만 파싱한다(모델이 ```json…``` 로 감싸는 경우 대응).
function parseEnrichJson(raw: string): { korean: string; triples: { subject: string; predicate: string; object: string }[] } | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      korean?: string;
      triples?: { subject?: string; predicate?: string; object?: string }[];
    };
    const triples = (obj.triples ?? [])
      .filter((t) => t && t.subject && t.predicate && t.object)
      .map((t) => ({ subject: String(t.subject).trim(), predicate: String(t.predicate).trim(), object: String(t.object).trim() }));
    return { korean: (obj.korean ?? "").trim(), triples };
  } catch {
    return null;
  }
}

// 한 청크를 번역·구조화한다. mode에 따라 클라우드/로컬을 고른다.
//  · 내부정보(사설IP·자산명 등)가 감지되면 클라우드로 절대 안 보낸다 — 로컬로만 시도(폐쇄망이라 안전).
//  · auto: 클라우드 되면 클라우드, 실패·비활성이면 로컬로 폴백. local: 로컬만. cloud: 클라우드만(실패 시 원문).
export async function enrichChunk(text: string, productName: string, mode: EnrichMode = "auto"): Promise<EnrichResult> {
  const prompt = buildEnrichPrompt(text, productName);
  const canCloud = screenForCloud(text).allowed && mode !== "local";

  if (canCloud) {
    try {
      const parsed = parseEnrichJson(await cloudComplete(ENRICH_SYSTEM, prompt, 4096));
      if (parsed?.korean) return { korean: parsed.korean, triples: parsed.triples, translated: true, via: "cloud" };
    } catch (e) {
      if (mode === "cloud") throw e; // 클라우드 강제인데 실패면 그대로 알린다
      // auto → 아래 로컬 폴백
    }
    if (mode === "cloud") return { korean: text, triples: [], translated: false, via: "none" };
  }

  // 로컬 폴백(또는 mode=local·내부정보 감지) — 온프렘 7B로 번역·추출. 품질은 낮지만 폐쇄망에서도 된다.
  try {
    const parsed = parseEnrichJson(await chat({ agentId: "curator", message: `${ENRICH_SYSTEM}\n\n${prompt}`, trusted: true }));
    if (parsed?.korean) return { korean: parsed.korean, triples: parsed.triples, translated: true, via: "local" };
  } catch {
    /* 로컬도 실패 → 원문 저장 */
  }
  return { korean: text, triples: [], translated: false, via: "none" };
}

export interface EnrichIngestResult {
  documentId: string;
  chunks: number;
  triples: number;
  translated: boolean;
  via: "cloud" | "local" | "manual" | "none";
}

// 한 섹션을 RAG + 온톨로지에 저장한다. mode=manual이면 사람이 작성한 한글·트리플을 그대로 쓰고(AI
// 미사용), 그 외엔 enrichChunk로 번역·추출한다. documentId·source에 제품·섹션을 담아 출처가 드러나게 한다.
export async function enrichAndIngest(args: {
  text: string;
  productName: string;
  sourceDoc: string;
  section: string;
  mode?: EnrichMode;
  korean?: string; // manual 모드: 사람이 작성한 한글 본문
  triples?: { subject: string; predicate: string; object: string }[]; // manual 모드: 사람이 작성한 관계(선택)
}): Promise<EnrichIngestResult> {
  const mode = args.mode ?? "auto";
  let korean: string;
  let triples: { subject: string; predicate: string; object: string }[];
  let via: EnrichIngestResult["via"];

  if (mode === "manual") {
    korean = (args.korean ?? args.text ?? "").trim();
    triples = (args.triples ?? []).filter((t) => t && t.subject && t.predicate && t.object);
    via = "manual";
    if (!korean) throw new Error("manual 모드에는 korean(한글 본문)이 필요합니다.");
  } else {
    const r = await enrichChunk(args.text, args.productName, mode);
    korean = r.korean;
    triples = r.triples;
    via = r.via;
  }

  const translated = via !== "none";
  const documentId = `${args.productName} · ${args.section}${via === "none" ? " (원문)" : via === "manual" ? " (수동)" : ""}`;
  const content = [`[${args.productName} — ${args.sourceDoc} · ${args.section}]`, "", korean].join("\n");
  const r = await ingestText(documentId, content, GLOBAL_SCOPE, undefined, false);

  let tripleCount = 0;
  if (triples.length) tripleCount = addTriples(triples.map((t) => ({ ...t, scope: GLOBAL_SCOPE, source: documentId }))).length;

  emitCollaboration({
    from: "curator",
    to: "orchestrator",
    message: `문서 보강 인입(${via}): ${documentId} — ${r.chunks}청크${tripleCount ? ` · 온톨로지 ${tripleCount}관계` : ""}`,
  });
  return { documentId, chunks: r.chunks, triples: tripleCount, translated, via };
}

export function registerDocEnrichRoutes(app: Express): void {
  // 한 섹션을 RAG+온톨로지에 저장 — 관리자 전용. mode: auto|cloud|local|manual.
  //  · auto/cloud/local: text(영문/원문)를 AI로 번역·구조화.  · manual: korean(+triples)을 사람이 작성해 올림.
  app.post(
    "/api/docs/enrich-ingest",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const { text, productName, sourceDoc, section, mode, korean, triples } = req.body as {
        text?: string; productName?: string; sourceDoc?: string; section?: string;
        mode?: EnrichMode; korean?: string; triples?: { subject: string; predicate: string; object: string }[];
      };
      if (!productName || !section) return res.status(400).json({ error: "productName·section이 필요합니다." });
      if (mode === "manual" ? !korean : !text) return res.status(400).json({ error: mode === "manual" ? "manual 모드는 korean이 필요합니다." : "text가 필요합니다." });
      res.json(await enrichAndIngest({ text: text ?? "", productName, sourceDoc: sourceDoc ?? "", section, mode, korean, triples }));
    })
  );
}
