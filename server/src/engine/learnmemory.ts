// engine/learnmemory.ts — 겹 1 「기억 성장」: 담당자가 문답을 승인하는 순간 그 주제의 지식영역에 반입한다.
//
// ■ 왜 생겼나 (증류학습 계획서 §2 원칙 2 · §6-1, 2026-09-03 실측)
//   승인된 문답이 학습 재료(chat_logs rating=1)로만 쌓이고 **기억(RAG)에는 안 들어갔다.** 다음 날
//   같은 질문이 와도 팀원은 그걸 모른다. 300건이 모여 어댑터가 구워지기 전까지 아무것도 자라지
//   않았다 — 「사용하면서 성장」이 안 느껴진 이유. 이 모듈이 그 빠른 겹이다: 학습이 필요 없고,
//   잘못되면 그 조각만 빼면 되고, 다음 질문부터 바로 쓴다.
//
// ■ 어떻게 (설계관 2026-09-03 검토 반영)
//   · 원천은 learnloop의 승인 신호 하나(emitChatLogRated). 승인 입구가 네 곳이라 rateChatLog만
//     후크하면 작업내역·시드 승인이 샌다 — 입구들이 전부 신호를 보내고 여기는 듣기만 한다.
//   · 반입 모양은 cloudllm.saveCloudAnswerToKb(완성품)의 일반화 — ingestText 한 번.
//   · scope는 **global**(팀원·주제를 scope에 넣으면 safeScope가 한글을 지워 검색 밖으로 사라진다).
//     팀원 우선순위는 category(=topic) + hybridsearch.ROLE_CATEGORY 부스트가 이미 맡는다.
//   · origin="approved-qa"로 표시해 문서 수 계열(새로 들어온 문서 대장·중복 후보)에서 뺀다.
//   · uploadedBy를 비운다 — 「새로 들어온 문서」 세 줄 요약을 만들지 않는다(승인 문답은 소식이 아니다).
//   · documentId = 승인문답:<로그 id> — 해제·삭제 때 같은 id로 조각을 뺀다(ingestText는 documentId 단위 멱등).
//
// ⚠ 등록이 없으면 **소리 없이** 아무것도 안 된다(memoryhooks와 같은 부류) — app.ts가 기억성장_배선()을
//   부르고, memorygrowth.test가 그 줄과 청취자 수를 지킨다.

import { db } from "../db";
import { onChatLogRated, type ChatLog, type ChatLogRatedEvent } from "./learnloop";

export const APPROVED_QA_ORIGIN = "approved-qa";
export const approvedQaDocId = (logId: string): string => `승인문답:${logId}`;

const ORIGIN_LABEL: Record<ChatLog["origin"], string> = {
  chat: "실대화 승인",
  worksession: "작업내역 승인",
  seed: "문서 시드",
  distill: "교사 모델 증류(승인됨)",
};

/** 반입 본문 — 사람이 읽어도 출처가 보이게. 조각 검색에 걸리는 건 질문·답 문장이다. */
export function approvedQaContent(log: ChatLog): string {
  const 날짜 = new Date(log.createdAt).toISOString().slice(0, 10);
  const lines = [
    `[승인 문답 · 주제 ${log.topic ?? "일반"} · 출처 ${ORIGIN_LABEL[log.origin] ?? log.origin} · ${날짜}]`,
    "",
    `질문: ${log.question.trim()}`,
    "",
    "답변:",
    log.answer.trim(),
  ];
  if (log.cites.length) lines.push("", `근거 조각: ${log.cites.join(", ")}`);
  if (log.teacher) lines.push(`교사 모델: ${log.teacher}`);
  return lines.join("\n");
}

async function handle(e: ChatLogRatedEvent): Promise<void> {
  const m = await import("./memory.js"); // 동적 import — memory ⇄ learnloop 순환 차단
  if (e.kind === "approved") {
    const log = e.log;
    if (log.rating !== 1) return;
    const category = log.topic ?? "일반";
    const r = await m.ingestText(approvedQaDocId(log.id), approvedQaContent(log), m.GLOBAL_SCOPE, undefined, false, undefined, category, APPROVED_QA_ORIGIN);
    console.log(`[learnmemory] 승인 문답 반입: ${r.documentId} → ${category} (${r.chunks}조각)`);
  } else {
    try {
      const r = await m.deleteDocument(approvedQaDocId(e.id), false);
      if (r.deletedChunks > 0) console.log(`[learnmemory] 승인 해제·삭제로 기억에서 뺌: ${approvedQaDocId(e.id)} (${r.deletedChunks}조각)`);
    } catch (err) {
      // 반입된 적이 없는 로그의 해제는 정상이다 — 조용히 넘긴다. 그 외 실패는 적는다.
      console.warn(`[learnmemory] 제거 실패(${e.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** 지식 현황용 — 승인 문답으로 들어간 문서 수. 문서 수 계열에서 따로 세기 위한 단일 출처. */
export function countApprovedQaDocs(): number {
  try {
    const r = db.prepare("SELECT COUNT(*) AS n FROM memory_documents WHERE origin = ?").get(APPROVED_QA_ORIGIN) as { n: number } | undefined;
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

export function 기억성장_배선(): void {
  onChatLogRated((e) => {
    void handle(e).catch((err) => console.warn(`[learnmemory] 반입 실패: ${err instanceof Error ? err.message : String(err)}`));
  });
}
