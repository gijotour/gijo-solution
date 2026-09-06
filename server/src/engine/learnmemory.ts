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
//   ② **전역 직렬 큐 + 사후 재확인.** 승인 직후 해제하면 느린 반입(임베딩 재시도 최대 50초)이 빠른 제거
//      뒤에 끝나 조각이 남는다 — 사건은 들어온 순서대로만 처리하고, 반입이 끝난 뒤 rating이 여전히 1인지
//      다시 본다(아니면 바로 뺀다).
//   ③ **멱등.** 이미 반입된 문서(memory_documents 행 있음)는 다시 임베딩하지 않는다 — 재승인마다 GPU를
//      채팅과 다투지 않는다.
//   ④ **위생.** 직접 👍 경로(로그 화면·API)는 후보함 제외 규칙을 안 지난다 — 폴백 문구(「찾지 못했습니다」)가
//      전역 지식이 되지 않게 여기서 회피 답변·위생 판별을 한 번 더 지난다.
//   ⑤ **실패는 감사에 남긴다.** 화면은 이미 「승인됨」이라 warn 한 줄로는 아무도 모른다 — 반입·제거 실패를
//      audit(kind=write, result=fail)로 남겨 감사 화면에 뜨게 한다.
//   ⑥ 운영자 스위치 `GIJO_MEMORY_GROWTH=0`이면 반입을 끈다(시험 환경도 이 값으로 임베딩·LanceDB에 안 닿는다).
//
// ■ 603건 유실 사고와 그 답 (2026-09-03 운영 DB 실측)
//   승인 1,856건 vs approved-qa 문서 1,253건 — **603건이 기억에 안 들어갔고 감사 기록은 0건**이었다.
//   유실분은 origin='distill' 523건 + 옛 행 80건. 원인은 둘이 겹친 것이다:
//     · **큐가 id별로 갈려 있어 동시 실행이 무제한**이었다. 일괄 승인으로 1,700여 건이 한꺼번에 들어오자
//       임베딩 요청이 GPU 한 대로 동시에 몰려 큐가 길게 밀렸다.
//     · **큐는 메모리에만 있다.** 그날 배포로 서버가 세 번 재시작(마지막 15:06)했고, 밀려 있던 것이
//       프로세스와 함께 사라졌다. 프로세스가 죽어서 실패 감사조차 못 남겼다 — 화면은 「승인됨」인데
//       기억에는 없고, 아무 데도 그 사실이 안 적혀 있었다.
//   답은 두 가지다. ⓐ 큐를 **하나로 합쳐 한 번에 한 건**만 임베딩한다(폭주 차단). ⓑ **큐는 최적화일 뿐
//   진실은 DB**로 두고, 부팅할 때 「rating=1인데 승인문답 문서가 없는」 로그를 다시 채운다
//   (syncApprovedQaDocs — incidentcases.syncIncidentCaseDocs와 같은 결). 그리고 그 차이를
//   approvedQaDocStats()로 늘 드러내 아침 보고표가 매일 보게 한다 — 안 드러나면 또 몇 달을 모른다.
//
// ⚠ 등록이 없으면 **소리 없이** 아무것도 안 된다(memoryhooks와 같은 부류) — app.ts가 기억성장_배선()을
//   부르고, index.ts가 부팅 뒤 syncApprovedQaDocsWithRetry()를 부른다. memorygrowth.test가 그 두 줄과
//   청취자 수를 지킨다.

import { db } from "../db";
import { onChatLogRated, getChatLog, type ChatLog, type ChatLogRatedEvent } from "./learnloop";
import { clearanceOf, type Grade } from "./grades";
import { 학습재료가못되나 } from "./datasethygiene";
import { NO_ANSWER } from "./sessionpatterns";
import { recordAudit } from "./audit";
import { 승인문답_접두 } from "./docorigin"; // origin 잣대 한 곳(잎 모듈 — 화살이 늘지 않는다)

export const APPROVED_QA_ORIGIN = "approved-qa";
// 접두사를 상수로 둔 이유: 재동기화 SQL이 `documentId = 접두사 || c.id`로 문서 유무를 대조한다.
// 문자열을 두 곳에 적으면 언젠가 어긋나고, 그러면 「없다」로 잘못 세어 멀쩡한 문서를 다시 임베딩한다.
// ★ 2026-09-07: 문자열 자체는 **docorigin(잎)**이 소유한다 — 검색 자르기(memory.ts)도 같은 잣대를
//   써야 하는데 그쪽이 learnmemory를 물지 않기 때문이다. 여기서는 **재수출**만 한다(소비자 무변경).
export const APPROVED_QA_DOC_PREFIX = 승인문답_접두;
export const approvedQaDocId = (logId: string): string => `${APPROVED_QA_DOC_PREFIX}${logId}`;
const ENABLED = process.env.GIJO_MEMORY_GROWTH !== "0";

const ORIGIN_LABEL: Record<ChatLog["origin"], string> = {
  chat: "실대화 승인",
  worksession: "작업내역 승인",
  seed: "문서 시드",
  distill: "교사 모델 증류(승인됨)",
};

/**
 * 반입 본문 — 사람이 읽어도 출처가 보이게. 조각 검색에 걸리는 건 질문·답 문장이다.
 *
 * ★ **꼬리 메타를 본문에서 뺐다**(2026-09-06 라이브 사고 수리 · Fable 결정 Q1-ⓐ).
 *   전에는 여기서 「근거 조각: store:<문서>#<sha12>」·「교사 모델: models/…gguf」 두 줄을
 *   본문 끝에 붙였다. 그 문서가 조각으로 검색돼 「참고 자료」에 실리자 모델이 자료를 옮겨 적으며
 *   **고객 답 끝에 내부 저장소 경로와 교사 모델 파일명을 그대로 옮겼다**(실측 2026-09-06 01:5x).
 *   모델이 지어낸 것이 아니라 **우리가 실어 준 것**이라, 프롬프트로는 못 막는다.
 *   ⚠ 메타 자체를 버리는 것이 아니다 — 원천은 `chat_logs`(cites·teacher)에 **그대로 남아 있고**
 *     문서 id가 `승인문답:<로그 id>`라 언제든 되짚는다(approvedQaMeta). 사본을 만들어 두 곳에
 *     적으면 어긋난다(이 저장소의 반복 병) — 그래서 **옮겨 적지 않고 가리키기만** 한다.
 *   ⚠ 이미 반입된 문서는 재반입하지 않는다(멱등 · 임베딩 비용). 그쪽은 조각을 실을 때
 *     metaleak.메타걷은조각이 걷는다(Q1-ⓑ).
 */
export function approvedQaContent(log: ChatLog): string {
  const 날짜 = new Date(log.createdAt).toISOString().slice(0, 10);
  return [
    `[승인 문답 · 주제 ${log.topic ?? "일반"} · 출처 ${ORIGIN_LABEL[log.origin] ?? log.origin} · ${날짜}]`,
    "",
    `질문: ${log.question.trim()}`,
    "",
    "답변:",
    log.answer.trim(),
  ].join("\n");
}

/**
 * 그 승인 문답이 **무엇을 근거로, 어느 두뇌로** 만들어졌나 — 본문에서 뺀 메타를 여기서 답한다.
 *
 * ★ 왜 문서 표(memory_documents)에 칸을 만들지 않았나(2026-09-06 · 정직한 보고 대상):
 *   그 표에는 이 값을 담을 칸이 없다(sourceRefs·teacher 없음). `sourcePath`에 끼워 넣으면
 *   `hasSource=true`가 되어 화면에 「원본 열기」가 뜨고 **404가 난다**(memory.listDocuments가
 *   그 칸 하나로 배지를 만든다). 새 칸을 파면 백업·복원·문서 목록까지 짝이 늘어난다.
 *   반면 이 값은 이미 `chat_logs`에 **원천으로** 있고 문서 id가 로그 id를 그대로 품는다 —
 *   사본을 만드는 대신 **원천을 가리키는 함수**를 둔다. 화면이 필요해지면 이 함수를 부른다.
 */
export function approvedQaMeta(logId: string): { cites: string[]; teacher: string | null } | null {
  const log = getChatLog(logId);
  if (!log) return null;
  return { cites: log.cites, teacher: log.teacher ?? null };
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

/**
 * 승인자 되찾기 — 재동기화 시점엔 「누가 승인했나」가 사건과 함께 이미 사라진 뒤다.
 * 후보 결정 감사 기록의 actor(표시이름)로 계정을 되짚어 등급을 살린다.
 *
 * ⚠ 왜 「정확히 한 명일 때만」인가: 표시이름은 유일하지 않다. 동명이인 중 아무나 골랐다가 그 사람이
 *   더 넓은 등급이면, 그게 바로 이 모듈이 막으려던 **등급 세탁**이다. 애매하면 포기하고 null을
 *   돌려준다 → gradeForApprover가 기밀(C)로 닫는다(fail-closed). 못 찾아서 좁아지는 건 안전하다.
 * ⚠ 감사 문구('학습 후보 결정' · target '승인' · detail 'cl:<id>')는 learncandidates.ts가 쓴다 —
 *   두 곳에 적힌 문자열이라 memorygrowth.test가 소스로 지킨다(바뀌면 조용히 null이 되어 등급만 좁아진다).
 */
const approverAuditStmt = db.prepare(
  "SELECT actor FROM audit_log WHERE action = '학습 후보 결정' AND target = '승인' AND detail = ? AND actor IS NOT NULL ORDER BY at DESC LIMIT 1"
);
const usersByDisplayNameStmt = db.prepare("SELECT id FROM users WHERE displayName = ?");
export function approverForLog(logId: string): string | null {
  try {
    const row = approverAuditStmt.get(`cl:${logId}`) as { actor: string } | undefined;
    if (!row) return null;
    const users = usersByDisplayNameStmt.all(row.actor) as { id: string }[];
    return users.length === 1 ? users[0].id : null;
  } catch {
    return null;
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

// ── 반입 큐 — **전역 직렬** (2026-09-03 유실 사고로 per-id 병렬에서 바꿈) ─────────────
// 예전엔 로그 id별로 큐를 갈랐다. id가 다르면 동시에 돌아, 일괄 승인 한 번에 1,700여 개의 임베딩
// 요청이 GPU 한 대로 몰렸다. 지금은 큐가 **하나**라 한 번에 한 건만 임베딩한다 — 채팅 모델과 GPU를
// 다투지 않고, 밀린 양이 대기중으로 그대로 보인다. 전역 FIFO라 같은 id의 승인→해제 순서도
// 저절로 지켜진다(예전 per-id 큐의 목적은 이걸로 대체된다).
//
// 성공/실패를 boolean으로 돌려주는 이유: 재동기화가 **연속 실패를 세어 스스로 멈추기** 위해서다.
// 임베딩 서버가 죽어 있으면 603건을 갈아 봐야 감사 기록만 603줄 더럽힌다.
let 큐꼬리: Promise<void> = Promise.resolve();
let 대기중 = 0;

function enqueue(id: string, job: () => Promise<void>, what: string): Promise<boolean> {
  대기중 += 1;
  const next = 큐꼬리
    .then(job)
    .then(
      () => true,
      (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[learnmemory] ${what} 실패(${id}): ${msg}`);
        recordAudit({ kind: "write", actor: "system", action: `승인 문답 ${what} 실패`, target: approvedQaDocId(id), detail: msg.slice(0, 300), result: "error" });
        return false;
      }
    )
    .finally(() => { 대기중 -= 1; });
  // 꼬리는 **절대 거부되지 않아야** 한다 — 한 번 거부된 꼬리에 이어 붙이면 뒤의 모든 작업이 job을
  // 건너뛴다(예전 per-id 큐에도 있던 함정. catch가 붙어 있어 드러나지 않았을 뿐이다).
  큐꼬리 = next.then(() => undefined, () => undefined);
  return next;
}

/** 시험·진단용 — 아직 큐에 남은 작업 수(0이면 조용하다). */
export function memoryGrowthPending(): number { return 대기중; }

/** 시험 전용 — 큐가 정말 직렬인지는 작업을 넣어 봐야 잰다(소스 문자열로는 못 증명한다). */
export function __enqueueForTests(id: string, job: () => Promise<void>, what = "시험"): Promise<boolean> {
  return enqueue(id, job, what);
}

function handle(e: ChatLogRatedEvent): void {
  if (!ENABLED) return;
  if (e.kind === "approved") {
    if (e.log.rating !== 1) { console.warn(`[learnmemory] approved 신호인데 rating≠1 — 무시: ${e.log.id}`); return; }
    void enqueue(e.log.id, () => ingest(e.log, e.approverId), "반입");
  } else {
    void enqueue(e.id, () => remove(e.id), "제거");
  }
}

/** 시험·진단용 — 큐가 비기를 기다린다. 기다리는 사이 새로 들어온 것까지 본다(그래서 while). */
export async function memoryGrowthIdle(): Promise<void> {
  while (대기중 > 0) await 큐꼬리;
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

// ── 재동기화 — 「진실은 DB」 (2026-09-03 603건 유실의 답) ──────────────────────────
// 큐는 메모리라 재시작에 증발한다. 그래서 승인의 진실은 chat_logs.rating=1 하나로 두고, 부팅 때
// 「승인됐는데 승인문답 문서가 없는」 것을 다시 채운다. incidentcases.syncIncidentCaseDocs와 같은 결이다.
const missingIdsStmt = db.prepare(
  `SELECT c.id AS id FROM chat_logs c
    WHERE c.rating = 1
      AND NOT EXISTS (SELECT 1 FROM memory_documents m WHERE m.documentId = ? || c.id)
    ORDER BY c.createdAt DESC
    LIMIT ?`
);
const approvedCountStmt = db.prepare("SELECT COUNT(*) AS n FROM chat_logs WHERE rating = 1");

/** 한 번에 살펴보는 상한 — 재동기화도 보고표도 이만큼만 본다(운영 실측 1,856건이라 여유가 크다). */
const SCAN_LIMIT = 20_000;

/**
 * 승인은 됐는데 기억 문서가 없는 로그 — 재동기화 대상.
 * ⚠ 위생에 걸리는 것(폴백·회피 답변 등)은 **대상에서 뺀다**. 안 그러면 아무리 돌려도 안 채워지는
 *   숫자가 보고표에 남아, 다들 그 칸을 무시하게 된다(이 저장소가 반복해 겪은 「거짓 숫자」).
 *   대신 몇 건이 그래서 빠졌는지 따로 돌려준다.
 */
export function missingApprovedQaLogs(limit = SCAN_LIMIT): { ingestable: ChatLog[]; hygieneBlocked: number } {
  const rows = missingIdsStmt.all(APPROVED_QA_DOC_PREFIX, limit) as { id: string }[];
  const ingestable: ChatLog[] = [];
  let hygieneBlocked = 0;
  for (const { id } of rows) {
    const log = getChatLog(id);
    if (!log) continue; // 고르는 사이에 지워졌다 — 정상
    if (반입못하는이유(log)) { hygieneBlocked += 1; continue; }
    ingestable.push(log);
  }
  return { ingestable, hygieneBlocked };
}

/**
 * 아침 보고표용 — 「승인 수 vs 문서 수 vs 차이」. 이 숫자가 매일 안 보이면 또 몇 달을 모른다.
 * missing은 위생 제외분을 뺀 **실제로 채워야 할 수**다(hygieneBlocked와 합치면 승인-문서 차이가 된다).
 */
export function approvedQaDocStats(): { approved: number; docs: number; missing: number; hygieneBlocked: number } {
  try {
    const approved = (approvedCountStmt.get() as { n: number } | undefined)?.n ?? 0;
    const { ingestable, hygieneBlocked } = missingApprovedQaLogs();
    return { approved, docs: countApprovedQaDocs(), missing: ingestable.length, hygieneBlocked };
  } catch {
    return { approved: 0, docs: 0, missing: 0, hygieneBlocked: 0 };
  }
}

/** 연속 실패가 이만큼이면 멈춘다 — 임베딩 서버가 죽었으면 남은 걸 다 갈아 봐야 감사만 더럽힌다. */
const RESYNC_ABORT_AFTER = 3;

export interface ApprovedQaSyncResult {
  candidates: number;      // 채워야 할 수(위생 제외 후)
  ingested: number;        // 이번에 채운 수
  failed: number;          // 실패한 수
  hygieneBlocked: number;  // 위생 때문에 애초에 대상이 아닌 수
  aborted: boolean;        // 연속 실패로 중단했나
}

/** 못 들어간 승인 문답을 채운다. 큐를 지나므로 살아 있는 승인과 순서·동시성을 함께 지킨다(한 번에 한 건). */
export async function syncApprovedQaDocs(limit = SCAN_LIMIT): Promise<ApprovedQaSyncResult> {
  const out: ApprovedQaSyncResult = { candidates: 0, ingested: 0, failed: 0, hygieneBlocked: 0, aborted: false };
  if (!ENABLED) return out;
  const { ingestable, hygieneBlocked } = missingApprovedQaLogs(limit);
  out.candidates = ingestable.length;
  out.hygieneBlocked = hygieneBlocked;
  if (!ingestable.length) return out;
  console.log(`[learnmemory] 승인됐는데 기억에 없는 문답 ${ingestable.length}건 재동기화 시작(위생 제외 ${hygieneBlocked}건)`);
  let 연속실패 = 0;
  for (const log of ingestable) {
    // await로 한 건씩 — 큐가 직렬이라 어차피 하나씩 돌지만, 여기서 기다려야 실패를 세어 멈출 수 있다.
    const ok = await enqueue(log.id, () => ingest(log, approverForLog(log.id)), "재동기화 반입");
    if (ok) { out.ingested += 1; 연속실패 = 0; continue; }
    out.failed += 1;
    연속실패 += 1;
    if (연속실패 >= RESYNC_ABORT_AFTER) {
      out.aborted = true;
      const 남음 = out.candidates - out.ingested - out.failed;
      recordAudit({
        kind: "write", actor: "system", action: "승인 문답 재동기화 중단",
        target: "learnmemory", detail: `연속 ${연속실패}건 실패 — 임베딩 서버 상태를 확인하세요. 남은 후보 ${남음}건`, result: "error",
      });
      console.error(`[learnmemory] 재동기화 중단 — 연속 ${연속실패}건 실패, 남은 후보 ${남음}건`);
      break;
    }
  }
  return out;
}

/** 부팅용 — 임베딩 서버가 늦게 뜨면 기다렸다 다시(incidentcases.syncIncidentCaseDocsWithRetry와 같은 결). */
export async function syncApprovedQaDocsWithRetry(attempts = 5, delayMs = 20_000): Promise<void> {
  if (!ENABLED) return;
  for (let i = 1; i <= attempts; i += 1) {
    const r = await syncApprovedQaDocs();
    if (r.candidates === 0) return; // 채울 것이 없다 — 정상(대부분의 부팅)
    if (!r.aborted && r.failed === 0) {
      console.log(`[learnmemory] 승인 문답 ${r.ingested}건을 기억에 채웠습니다(위생 제외 ${r.hygieneBlocked}건)`);
      return;
    }
    if (i === attempts) {
      console.error(`[learnmemory] 승인 문답 재동기화 미완 — 이번에 ${r.ingested}건 채움, ${r.failed}건 실패. 임베딩 서버 상태를 확인하세요(감사 기록에 사유가 있습니다)`);
      return;
    }
    console.warn(`[learnmemory] 재동기화 재시도 ${i}/${attempts - 1} (${Math.round(delayMs / 1000)}초 후) — 이번에 ${r.ingested}건 채움, ${r.failed}건 실패`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export function 기억성장_배선(): void {
  onChatLogRated(handle);
  if (!ENABLED) console.warn("[learnmemory] GIJO_MEMORY_GROWTH=0 — 승인 문답을 기억에 반입하지 않는다(학습 재료로만 쌓임)");
}
