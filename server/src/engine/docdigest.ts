// engine/docdigest.ts — 문서 반입 소식: 올라온 문서를 ① 대장으로 알리고 ② 세 줄로 요약하고
// ③ 우리 지식(온톨로지)과의 접점까지 잇는다. [2026-08-06 사용자 승인 "추천으로 전부 진행" —
// 계획서 1차 목표(3소스 분석)의 소스 확장 + 후-6(축적 자산) 소속]
//
// 왜: CrowdStrike 위협 보고서 같은 PDF를 올려도 **올린 순간의 카드가 전부**였다 — 그 뒤로는
// 무엇이 들어왔는지, 무슨 내용인지, 우리와 무슨 상관인지 아무도 모른다(2026-08-06 사용자 지적).
//
// 원칙:
// - 접점(온톨로지 대조)은 **결정적**이다 — LLM이 꺼져 있어도 나온다.
// - 요약만 LLM이고, 실패하면 실패했다고 기록한다(없는 요약을 지어내지 않는다).
// - 요약은 "자체 요약" 표기와 함께 보인다 — 7B 숫자 오독 전례(2026-08-03) 때문에 원문 대체가 아니다.
import { db } from "../db";
import { chat } from "./llm";
import { expandOntology } from "./ontology";

db.exec(`CREATE TABLE IF NOT EXISTS doc_digests (
  documentId TEXT PRIMARY KEY,
  summary TEXT,            -- 세 줄 요약(줄바꿈 구분). NULL이면 아직/실패
  keywords TEXT,           -- 쉼표 구분 핵심어
  matches TEXT,            -- 온톨로지 접점(줄바꿈 구분, 결정적)
  model TEXT,              -- 요약에 쓴 모델 표기(정직성)
  failedReason TEXT,       -- 요약 실패 사유(실패도 기록 — 조용한 공백 금지)
  madeAt TEXT NOT NULL
)`);

const upsert = db.prepare(`INSERT INTO doc_digests (documentId, summary, keywords, matches, model, failedReason, madeAt)
  VALUES (@documentId, @summary, @keywords, @matches, @model, @failedReason, @madeAt)
  ON CONFLICT(documentId) DO UPDATE SET summary=excluded.summary, keywords=excluded.keywords,
    matches=excluded.matches, model=excluded.model, failedReason=excluded.failedReason, madeAt=excluded.madeAt`);

/** 온톨로지 표제어와 문서 본문을 결정적으로 대조 — "보고서의 ○○ ↔ 우리 지식의 △△" 접점.
 *  본문에 실제 등장하는 표제어 찾기·확장은 expandOntology가 이미 한다(시드 탐지+홉 확장) — 재사용. */
export function ontologyMatchesFor(text: string, limit = 5): string[] {
  return expandOntology(text, undefined, { hops: 1, limit })
    .map((t) => `${t.subject} —[${t.predicate}]→ ${t.object}`);
}

/** 반입 직후 백그라운드로 요약·접점을 만든다 — 실패해도 인입은 이미 성공, 여기서 죽지 않는다. */
export async function makeDigest(documentId: string, raw: string, category?: string): Promise<void> {
  const matches = ontologyMatchesFor(raw);
  let summary: string | null = null;
  let keywords: string | null = null;
  let failedReason: string | null = null;
  try {
    const 본문 = raw.slice(0, 5000);
    const out = await chat({
      agentId: "report",
      message:
        `다음 문서를 딱 세 줄로 요약해줘(각 줄 60자 이내, 줄마다 줄바꿈). 마지막 줄 뒤에 "핵심어: " 로 시작하는 핵심 단어 5개를 쉼표로 적어줘. ` +
        `문서에 없는 숫자·사실을 지어내지 마세요. 분류: ${category ?? "미상"}.\n\n${본문}`,
      trusted: true, // 내부 조립 프롬프트(gateway 자기차단 함정 — 보안 어휘가 규칙에 걸린다)
      noLearn: true, // 자동 요약이 학습 이력을 오염시키지 않게
    });
    const 줄들 = out.split("\n").map((l) => l.trim()).filter(Boolean);
    const kwLine = 줄들.find((l) => l.startsWith("핵심어"));
    keywords = kwLine ? kwLine.replace(/^핵심어\s*[:：]\s*/, "") : null;
    summary = 줄들.filter((l) => !l.startsWith("핵심어")).slice(0, 3).join("\n") || null;
    if (!summary) failedReason = "모델 응답에서 요약을 못 뽑음";
  } catch (err) {
    failedReason = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  upsert.run({
    documentId, summary, keywords,
    matches: matches.length ? matches.join("\n") : null,
    model: summary ? "로컬 모델 자체 요약" : null,
    failedReason, madeAt: new Date().toISOString(),
  });
}

export interface RecentDoc {
  documentId: string;
  category: string | null;
  uploadedBy: string | null;
  ingestedAt: string;
  summary: string | null;
  keywords: string | null;
  matches: string | null;
  failedReason: string | null;
}

/** 최근 N일 반입 대장 — memory_documents(메타)와 doc_digests(소식)를 합쳐 본다. */
export function listRecentDocs(days = 7): RecentDoc[] {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  return db.prepare(
    `SELECT m.documentId, m.category, m.uploadedBy, m.ingestedAt,
            d.summary, d.keywords, d.matches, d.failedReason
       FROM memory_documents m LEFT JOIN doc_digests d ON d.documentId = m.documentId
      WHERE m.ingestedAt >= ? ORDER BY m.ingestedAt DESC`
  ).all(cutoff) as RecentDoc[];
}

/** 대화창 답변 본문 — 없으면 없다고 말한다(0건 재작성 금지 원칙과 같은 계열). */
export function recentDocumentsText(days = 7): string {
  const rows = listRecentDocs(days);
  if (!rows.length) return `최근 ${days}일 사이 새로 들어온 문서가 없습니다.`;
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category ?? "일반", (byCat.get(r.category ?? "일반") ?? 0) + 1);
  const 머리 = `최근 ${days}일 새 문서 ${rows.length}건 — ${[...byCat].map(([c, n]) => `${c} ${n}`).join(" · ")}`;
  const lines = rows.slice(0, 10).map((r) => {
    const when = r.ingestedAt.slice(5, 10).replace("-", "/");
    const who = r.uploadedBy ? ` · ${r.uploadedBy}` : "";
    let 소식 = "";
    if (r.summary) 소식 = `\n   ${r.summary.split("\n").join("\n   ")}\n   (로컬 모델 자체 요약 — 원문 확인은 지식 화면에서)`;
    else if (r.failedReason) 소식 = `\n   요약 없음(${r.failedReason.slice(0, 60)})`;
    if (r.matches) 소식 += `\n   🔗 우리 지식과의 접점: ${r.matches.split("\n").slice(0, 2).join(" / ")}`;
    return `- ${r.documentId} [${r.category ?? "일반"}] ${when}${who}${소식}`;
  });
  const tail = rows.length > 10 ? `\n(외 ${rows.length - 10}건 — 지식 화면에서 전체 목록)` : "";
  return `${머리}\n${lines.join("\n")}${tail}`;
}
