// engine/learnmemory.ts — 겹 1 「기억 성장」: 담당자가 문답을 승인하는 순간 그 주제의 지식영역에 반입한다.
//
// ■ 왜 생겼나 (증류학습 계획서 §2 원칙 2 · §6-1, 2026-09-03 실측)
//   승인된 문답이 학습 재료(chat_logs rating=1)로만 쌓이고 **기억(RAG)에는 안 들어갔다.** 다음 날
//   같은 질문이 와도 팀원은 그걸 모른다. 300건이 모여 어댑터가 구워지기 전까지 아무것도 자라지
//   않았다 — 「사용하면서 성장」이 안 느껴진 이유. 이 모듈이 그 빠른 겹이다: 학습이 필요 없고,
//   잘못되면 그 조각만 빼면 되고, 다음 질문부터 바로 쓴다.
//
// ■ 어떻게 (설계관 2026-09-03 검토 + 검토관 5갈래 반영)
//   · 원천은 learnloop의 승인 신호 하나(emitChatLogRated). 승인 입구가 여러 곳이라 rateChatLog만
//     후크하면 작업내역·시드 승인이 샌다 — 입구들이 전부 신호를 보내고 여기는 듣기만 한다.
//     삭제 입구도 둘(deleteChatLog·pruneChatLogs)이라 둘 다 「해제」 신호를 보낸다.
//   · 반입 모양은 cloudllm.saveCloudAnswerToKb(완성품)의 일반화 — ingestText 한 번.
//   · scope는 **global**(팀원·주제를 scope에 넣으면 safeScope가 한글을 지워 검색 밖으로 사라진다).
//     팀원 우선순위는 category(=topic) + hybridsearch.ROLE_CATEGORY 부스트가 이미 맡는다.
//   · origin="approved-qa"로 표시해 문서 수 계열(새 문서 배지·대장·중복 후보·팀 구성·자가진단·지식 현황·
//     문서 목록 화면)에서 뺀다 — 소비처 목록은 memorygrowth.test가 센다.
//   · uploadedBy를 비운다 — 「새로 들어온 문서」 세 줄 요약을 만들지 않는다(승인 문답은 소식이 아니다).
//   · documentId = 승인문답:<로그 id> — 해제·삭제 때 같은 id로 조각을 뺀다(ingestText는 documentId 단위 멱등).
//
// ■ 안전장치 (검토관 2026-09-03 상·중 적발분)
//   ① **열람 등급 = 승인자의 등급.** 등급 없이 넣으면 NULL→「공개」로 접혀, 기밀 문서를 근거로 만든 답이
//      공개 문서로 복제된다(등급 세탁). 승인자가 볼 수 있던 최고 등급을 문서 등급으로 잠근다 — 승인자
//      자신보다 넓은 눈에는 절대 안 보인다. 승인자를 모르면 기밀(C)로 닫는다(fail-closed).
//      ⚠ 잔여 위험: 승인자의 **개인 문서**를 근거로 만든 답은 같은 등급의 다른 사람에게 보일 수 있다 —
//        답이 어느 문서에서 왔는지 로그가 안 남기므로 여기서 못 가린다. 계획서 §10에 적어 두었다.
//   ② **로그 id별 직렬 큐 + 사후 재확인.** 승인 직후 해제하면 느린 반입(임베딩 재시도 최대 50초)이 빠른 제거
//      뒤에 끝나 조각이 남는다 — 같은 id의 사건은 순서대로만 처리하고, 반입이 끝난 뒤 rating이 여전히 1인지
//      다시 본다(아니면 바로 뺀다).
//   ③ **멱등.** 이미 반입된 문서(memory_documents 행 있음)는 다시 임베딩하지 않는다 — 재승인마다 GPU를
//      채팅과 다투지 않는다.
//   ④ **위생.** 직접 👍 경로(로그 화면·API)는 후보함 제외 규칙을 안 지난다 — 폴백 문구(「찾지 못했습니다」)가
//      전역 지식이 되지 않게 여기서 회피 답변·위생 판별을 한 번 더 지난다.
//   ⑤ **실패는 감사에 남긴다.** 화면은 이미 「승인됨」이라 warn 한 줄로는 아무도 모른다 — 반입·제거 실패를
//      audit(kind=write, result=fail)로 남겨 감사 화면에 뜨게 한다.
//   ⑥ 운영자 스위치 `GIJO_MEMORY_GROWTH=0`이면 반입을 끈다(시험 환경도 이 값으로 임베딩·LanceDB에 안 닿는다).
//
// ⚠ 등록이 없으면 **소리 없이** 아무것도 안 된다(memoryhooks와 같은 부류) — app.ts가 기억성장_배선()을
//   부르고, memorygrowth.test가 그 줄과 청취자 수를 지킨다.

import { db } from "../db";
import { onChatLogRated, getChatLog, type ChatLog, type ChatLogRatedEvent } from "./learnloop";
import { clearanceOf, type Grade } from "./grades";
import { 학습재료가못되나 } from "./datasethygiene";
import { NO_ANSWER } from "./sessionpatterns";
import { recordAudit } from "./audit";

export const APPROVED_QA_ORIGIN = "approved-qa";
export const approvedQaDocId = (logId: string): string => `승인문답:${logId}`;
const ENABLED = process.env.GIJO_MEMORY_GROWTH !== "0";

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

/** 위생 — 폴백·회피 답변과 시점데이터·시험문항·문서복사는 기억이 되지 않는다. 사유를 돌려준다(없으면 null). */
export function 반입못하는이유(log: ChatLog): string | null {
  if (NO_ANSWER.some((n) => n.re.test(log.answer))) return "회피 답변(지식 구멍)";
  return 학습재료가못되나(log.question, log.answer);
}

/** 승인자의 열람 등급 → 문서 등급. 모르면 기밀(가장 좁게). */
export function gradeForApprover(approverId: string | null | undefined): Grade {
  if (!approverId) return "C";
  try {
    const row = db.prepare("SELECT clearance FROM users WHERE id = ?").get(approverId) as { clearance?: string | null } | undefined;
    if (!row) return "C";
    return clearanceOf(row.clearance);
  } catch {
    return "C";
  }
}

const docExistsStmt = db.prepare("SELECT 1 FROM memory_documents WHERE documentId = ?");
const setGradeStmt = db.prepare("UPDATE memory_documents SET grade = ? WHERE documentId = ?");

async function ingest(log: ChatLog, approverId: string | null | undefined): Promise<void> {
  const docId = approvedQaDocId(log.id);
  const why = 반입못하는이유(log);
  if (why) {
    recordAudit({ kind: "write", actor: "system", action: "승인 문답 반입 안 함(위생)", target: docId, detail: why, result: "blocked" });
    return;
  }
  if (docExistsStmt.get(docId)) return; // 멱등 — 로그는 불변이라 다시 넣을 이유가 없다
  const m = await import("./memory.js"); // 동적 import — memory ⇄ learnloop 순환 차단
  const category = log.topic ?? "일반";
  const r = await m.ingestText(docId, approvedQaContent(log), m.GLOBAL_SCOPE, undefined, false, undefined, category, APPROVED_QA_ORIGIN);
  const grade = gradeForApprover(approverId);
  setGradeStmt.run(grade, docId);
  // 사후 재확인 — 반입이 도는 사이 해제됐으면(같은 큐라 뒤에 오지만, 큐 밖의 prune·직접 삭제 대비) 바로 뺀다.
  const now = getChatLog(log.id);
  if (!now || now.rating !== 1) {
    await m.deleteDocument(docId, false);
    console.log(`[learnmemory] 반입 직후 승인이 풀려 있어 다시 뺌: ${docId}`);
    return;
  }
  console.log(`[learnmemory] 승인 문답 반입: ${docId} → ${category} · 등급 ${grade} (${r.chunks}조각)`);
}

async function remove(id: string): Promise<void> {
  const docId = approvedQaDocId(id);
  if (!docExistsStmt.get(docId)) return; // 반입된 적 없음 — 정상
  const m = await import("./memory.js");
  const r = await m.deleteDocument(docId, false);
  console.log(`[learnmemory] 승인 해제·삭제로 기억에서 뺌: ${docId} (${r.deletedChunks}조각)`);
}

// 로그 id별 직렬 큐 — 같은 id의 사건은 들어온 순서로만 처리한다(승인→해제 경합 차단).
const queues = new Map<string, Promise<void>>();
function enqueue(id: string, job: () => Promise<void>, what: string): void {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(job).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[learnmemory] ${what} 실패(${id}): ${msg}`);
    recordAudit({ kind: "write", actor: "system", action: `승인 문답 ${what} 실패`, target: approvedQaDocId(id), detail: msg.slice(0, 300), result: "error" });
  });
  queues.set(id, next);
  void next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
}

function handle(e: ChatLogRatedEvent): void {
  if (!ENABLED) return;
  if (e.kind === "approved") {
    if (e.log.rating !== 1) { console.warn(`[learnmemory] approved 신호인데 rating≠1 — 무시: ${e.log.id}`); return; }
    enqueue(e.log.id, () => ingest(e.log, e.approverId), "반입");
  } else {
    enqueue(e.id, () => remove(e.id), "제거");
  }
}

/** 시험·진단용 — 큐가 비기를 기다린다. */
export async function memoryGrowthIdle(): Promise<void> {
  await Promise.all([...queues.values()]);
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
  onChatLogRated(handle);
  if (!ENABLED) console.warn("[learnmemory] GIJO_MEMORY_GROWTH=0 — 승인 문답을 기억에 반입하지 않는다(학습 재료로만 쌓임)");
}
