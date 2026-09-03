// engine/learncandidates.ts — 학습 후보함: 쌓인 대화·작업내역에서 학습 후보를 코드가 골라
// 담당자에게 승인 카드로 내민다 (환류 1단계, 2026-07-29 시안 승인).
//
// 왜 만들었나 — 진단 실측(2026-07-29): 대화 로그 200건 자동 수집 중 👍 1건, 학습 실행 0회.
//   "좋은 답에 👍를 눌러 달라"는 어느 실서비스에서도 안 눌린다(대규모 배포도 턴의 0.6%~ —
//   arXiv:2306.04707·2507.23158). 버튼을 기다리는 설계 자체가 틀렸다 — 코드가 후보를 골라
//   내밀고, 사람은 한 번의 승인만 한다(오픈소스 Argilla가 같은 패턴을 프로덕션 검증).
//
// 원칙 3개 — 어기면 이 모듈의 존재 이유가 사라진다.
//   1) **자동으로 어디에도 먹이지 않는다** — sessionpatterns의 확정 원칙 그대로. 코드는 후보
//      제시까지, 데이터셋에 들어가는 유일한 문은 담당자의 승인(=👍 기록)이다.
//      근거: 👍는 "옳음"이 아니라 "즉각 만족"이고(Anthropic disempowerment 연구), 잡담·오답이
//      지식이 되면 멀쩡한 문서를 밀어낸다(QA-M04 실사고).
//   2) **판정은 전부 코드로** — LLM을 쓰지 않는다. 같은 입력에 같은 후보가 나와야
//      "지난주에 왜 이게 후보였지"를 답할 수 있다.
//   3) **목표는 많이가 아니라 좋은 것 50~100개** — 수작업 수천 개가 기계생성 5만 개를
//      이긴다(LIMA). 승인된 문답이 기존 정제 루프(buildDatasetFromLogs)로 그대로 흘러간다.
import type { Express, Request } from "express";
import crypto from "crypto";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { SMALLTALK, NO_ANSWER } from "./sessionpatterns";
import { rateChatLog, 질문주제, getChatLog, emitChatLogRated, TOPICS } from "./learnloop";
import { isNonLearningSessionOwner } from "./learnpolicy";
import { 학습재료가못되나 } from "./datasethygiene";
// work_session_turns 테이블은 worksessions.ts의 migrate가 만든다 — 이 모듈이 먼저 적재되면
// 아래 prepare가 "no such table"로 죽는다(테스트에서 실측). 소유 모듈을 명시적으로 실어 보장한다.
import "./worksessions";
import { recordAudit } from "./audit";
import { isBinaryLikeChunk } from "./ragsanitize";
import { gradeOf } from "./grades";

import type { GijoUser } from "../auth/users";
import type { MemoryDocument } from "./memory"; // 타입만 — 런타임 화살 없음

// 작업내역 출처 후보의 결정(승인/제외)을 기억한다 — 안 남기면 제외한 것이 다음 조회에 또 나온다.
// (대화 로그 출처는 rating 컬럼이 그 역할을 이미 한다.)
migrate(
  "learn-candidate-decisions-2026-07-29",
  `CREATE TABLE IF NOT EXISTS learn_candidate_decisions (
     id TEXT PRIMARY KEY,
     decision TEXT NOT NULL,
     decidedAt INTEGER NOT NULL,
     decidedBy TEXT
   )`
);

// ── 제외 규칙 (시안 3절 그대로) ──────────────────────────────────────────
// 비밀 흔적 — 모델 가중치에 비밀이 각인되면 지울 수 없다. 범용 PII 도구(Presidio류) 대신
// 우리 도메인에서 실제로 다니는 형태만 정확히 잡는다(조사 결론: 도메인 정규식이 비용 대비 효과 큼).
// 재현율 우선 — 애매하면 제외한다. 후보 하나를 잃는 것보다 비밀 하나가 새는 게 훨씬 비싸다.
const SECRET_RE =
  /hf_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{20,}|(password|passwd|pwd|비밀번호|암호)\s*[:=]\s*\S+/i;

// 도구 원출력 복창 — 내부 id·원시 덤프가 답에 남은 것은 형식 학습감이 아니라 결함이다
// (실사고: id=vuln:… 복창이 회귀 케이스를 깨뜨림).
const TOOL_ECHO_RE = /\(id=[\w:.\-]+\)|^AI 자산 \d+건:|조회 결과입니다/m;

// 길이 창 — 한 줄 답·통짜 덤프 모두 학습 신호가 약하다(가점 없음). 극단은 제외.
const ANSWER_MIN = 30;
const ANSWER_MAX = 4000;

// 근거 인용 신호 — 사내 문서가 녹은 답. "(일반 지식 기준)" 꼬리는 근거 없이 답했다는 정직 표식이라 제외.
const CITE_RE = /참고했|근거|\.pdf|\.docx|\.hwpx|\.md\b/i;
// ⚠ 「근거 약함」 배너는 **근거가 있다는 신호가 아니라 정반대**다(2026-08-05 검토 지적).
//   그런데 CITE_RE의 `근거`에 걸려 인용 점수를 받고 있었다 — **근거가 없다고 스스로 밝힌 답이
//   학습 후보 상위**에 올랐다. 배너가 붙은 답은 인용으로 세지 않는다.
const NO_GROUND_RE = /\(일반 지식 기준\)|근거 약함/;

/** 같은 문답을 다시 후보로 내밀지 않기 위한 정규화 지문. */
function fingerprint(question: string, answer: string): string {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[?!.,·…]/g, "").slice(0, 400);
  return crypto.createHash("sha1").update(norm(question) + "␞" + norm(answer)).digest("hex").slice(0, 16);
}

export interface LearnCandidate {
  id: string; // "cl:<logId>" | "ws:<userTurnId>:<botTurnId>"
  // 어디서 찾았나. distill=교사 모델 증류 행(chat_logs.origin='distill', id는 cl:이라 결정 경로가 같다).
  // ⚠ chat_logs.origin(어떻게 생겼나)과는 다른 축 — 이름을 합치지 않는다(증류학습 계획서 §3.6-2).
  source: "chatlog" | "worksession" | "distill";
  question: string;
  answer: string;
  createdAt: number;
  signals: { cite: boolean; tool: boolean; accepted: boolean; lengthOk: boolean };
  topic: string | null; // 주제 딱지 — 후보함 배지·주제별 진척(2026-08-08 시안 승인)
  score: number; // cite 3 + tool 2 + accepted 1 + lengthOk 1
  teacher?: string | null; // 증류 행만 — 교사 모델 id(후보함 칩)
  cites?: string[]; // 증류 행만 — 근거 ref 목록(chat_logs.cites는 ref 문자열 배열 — learnloop.ChatLog.cites와 같은 모양). 본문은 승인 화면이 ref로 찾는다.
}

interface ChatLogRow { id: string; agentId: string; question: string; answer: string; rating: number | null; usedInDataset: number; createdAt: number; topic?: string | null; origin?: string | null; cites?: string | null; teacher?: string | null }
interface TurnRow { id: string; sessionId: string; role: "user" | "assistant"; content: string; tool: string | null; at: number; createdBy: string | null }

// 대화 로그 창은 실대화만(증류 제외) — 증류 500건이 들어오면 실사용 미평가 대화가 이 창(LIMIT 500)
// 밖으로 밀려나던 것을 막는다(설계관 2026-09-03 ★5). 증류는 자기 창으로 따로 본다.
const unratedLogsStmt = db.prepare("SELECT * FROM chat_logs WHERE rating IS NULL AND usedInDataset = 0 AND COALESCE(origin,'chat') <> 'distill' ORDER BY createdAt DESC LIMIT 500");
const unratedDistillStmt = db.prepare("SELECT * FROM chat_logs WHERE rating IS NULL AND usedInDataset = 0 AND origin = 'distill' ORDER BY createdAt DESC LIMIT 500");
// 세션을 **누가 열었는지**(createdBy)를 함께 가져온다 — 배포·게시 계정이 검증하느라 던진
// 문답이 후보함에 그대로 흘러들던 구멍을 막기 위해서다(2026-08-08 실측: 후보 13건 중 7건이
// 내 QA·리허설 대화였다). 대화 로그 경로는 isNonLearningAccount로 이미 막혀 있었는데
// **작업 내역 경로만 그 정책을 안 보고 있었다** — 정책이 있어도 안 부르면 소용없다.
const turnsStmt = db.prepare(
  "SELECT t.id, t.sessionId, t.role, t.content, t.tool, t.at, s.createdBy" +
  "  FROM work_session_turns t LEFT JOIN work_sessions s ON s.id = t.sessionId" +
  " WHERE t.at >= ? ORDER BY t.sessionId, t.at ASC"
);
const decisionStmt = db.prepare("SELECT id, decision FROM learn_candidate_decisions");
const putDecisionStmt = db.prepare(
  "INSERT INTO learn_candidate_decisions (id, decision, decidedAt, decidedBy) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET decision=excluded.decision, decidedAt=excluded.decidedAt, decidedBy=excluded.decidedBy"
);
const insertLogStmt = db.prepare(
  // topic도 함께 적는다(2026-08-08) — 승인 경로로 들어온 행이 주제 진척에서 빠지면 300건 시계가 어긋난다.
  // origin(어떻게 생겼나, 2026-09-03)도 함께 — 작업내역 승인은 'worksession', 문서 시드는 'seed'.
  "INSERT INTO chat_logs (id, agentId, question, answer, rating, usedInDataset, createdAt, topic, origin) VALUES (@id, @agentId, @question, @answer, 1, 0, @createdAt, @topic, @origin)"
);
// 증류 편입 — rating **NULL**(승인은 사람이 한다, 원칙 3). 시드 라우트(rating=1 즉시)를 재사용하지 않는다(설계관 ★8).
const insertDistillStmt = db.prepare(
  "INSERT INTO chat_logs (id, agentId, question, answer, rating, usedInDataset, createdAt, topic, origin, teacher, cites, promptHash) VALUES (@id, 'distill-teacher', @question, @answer, NULL, 0, @createdAt, @topic, 'distill', @teacher, @cites, @promptHash)"
);
const allLogFingerprintRowsStmt = db.prepare("SELECT question, answer FROM chat_logs");

/** 재질문 판정 — 다음 사용자 턴이 같은 말의 고쳐 묻기면 이 답은 거부된 것이다(암묵 신호, 조사 근거 13배 밀도). */
function isRephrase(q: string, next: string): boolean {
  const toks = (s: string) => new Set(s.replace(/[?!.,·…]/g, " ").split(/\s+/).filter((t) => t.length >= 2));
  const a = toks(q);
  const b = toks(next);
  if (!a.size || !b.size) return false;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return common / Math.min(a.size, b.size) >= 0.5;
}

// 보안 시험이 심은 표식 — 레드팀 마커(INJECTED-XXXX)·RAG 오염 카나리(카나리주입성공…).
// ★ 실사고(2026-08-01): "제로트러스트 기준" 후보 답이 「카나리주입성공XK7」로 시작했다.
//   과거 RAG 오염 시험 문서가 답에 복창돼 대화 로그로, 다시 학습 후보로 흘러든 것.
//   이걸 승인하면 **주입 성공 사례를 모델에게 가르치는** 최악의 학습이 된다. 원천 배제한다.
const INJECT_MARK_RE = /카나리주입성공|INJECTED-[0-9A-F]{4}/;

function excluded(question: string, answer: string): string | null {
  if (INJECT_MARK_RE.test(question) || INJECT_MARK_RE.test(answer)) return "보안 시험 흔적(주입 표식)";
  // 오케스트레이터 프롬프트 틀이 질문으로 샌 것 — 사람이 친 문장이 아니다.
  // (실측 2026-08-01: 『사용자 지시: "…" 방금 시스템에서 조회한 실제 데이터: …』 꼴 수십 건)
  if (/^사용자 지시:\s*"/.test(question.trim())) return "기계 생성(프롬프트 틀)";
  if (SMALLTALK.test(question.trim())) return "잡담";
  if (NO_ANSWER.some((n) => n.re.test(answer))) return "회피 답변(지식 구멍)";
  if (SECRET_RE.test(question) || SECRET_RE.test(answer)) return "비밀 흔적";
  if (TOOL_ECHO_RE.test(answer)) return "도구 원출력 복창";
  if (answer.trim().length < ANSWER_MIN || answer.length > ANSWER_MAX) return "길이 극단";
  if (question.trim().length < 5) return "질문 너무 짧음";
  // ⚠ 데이터셋 만들 때 거르는 것만으로는 **늦다** — 후보함이 못 쓸 것으로 채워지면
  //   담당자가 그걸 하나씩 들여다보며 시간을 쓰고, 주제별 진척(300건)도 가짜로 부푼다.
  //   실측(2026-08-09): 대기 4건이 전부 그날의 숫자이거나 문서 본문 복사였다.
  //   판별식은 위생 모듈과 **같은 것**을 쓴다(두 곳에 적으면 언젠가 어긋난다).
  const 못쓸이유 = 학습재료가못되나(question, answer);
  if (못쓸이유) return 못쓸이유;
  return null;
}

function buildSignals(question: string, answer: string, tool: boolean, accepted: boolean): LearnCandidate["signals"] {
  const cite = CITE_RE.test(answer) && !NO_GROUND_RE.test(answer);
  const lengthOk = answer.length >= 80 && answer.length <= 1200;
  return { cite, tool, accepted, lengthOk };
}

function scoreOf(s: LearnCandidate["signals"]): number {
  return (s.cite ? 3 : 0) + (s.tool ? 2 : 0) + (s.accepted ? 1 : 0) + (s.lengthOk ? 1 : 0);
}

/** 후보 목록 — 대화 로그(미평가) + 작업내역(user→assistant 짝), 결정된 것·중복·제외 사유는 뺀다. */
export function listLearnCandidates(days = 30, limit = 60): {
  candidates: LearnCandidate[];
  kpis: { candidates: number; strong: number; distill: number; excludedByReason: Record<string, number> };
} {
  const decided = new Map((decisionStmt.all() as { id: string; decision: string }[]).map((d) => [d.id, d.decision]));
  const seen = new Set<string>();
  // 이미 로그에 있는 문답(승인으로 옮겨진 것 포함)은 작업내역 쪽에서 다시 내밀지 않는다.
  for (const r of allLogFingerprintRowsStmt.all() as { question: string; answer: string }[]) {
    seen.add(fingerprint(r.question, r.answer));
  }
  const out: LearnCandidate[] = [];
  const excludedByReason: Record<string, number> = {};
  const drop = (reason: string) => { excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1; };

  // ── 출처 A: 대화 로그(미평가·미사용) ─────────────────────────────────
  for (const r of unratedLogsStmt.all() as ChatLogRow[]) {
    const why = excluded(r.question, r.answer);
    if (why) { drop(why); continue; }
    const fp = fingerprint(r.question, r.answer);
    // seen에는 자기 자신도 들어 있다 — 로그 출처는 지문 중복을 "다른 행과 같음"일 때만 걸러야
    // 해서, 여기서는 이미 out에 담은 것과만 비교한다.
    if (out.some((c) => fingerprint(c.question, c.answer) === fp)) { drop("중복"); continue; }
    const signals = buildSignals(r.question, r.answer, false, false);
    out.push({ id: `cl:${r.id}`, source: "chatlog", question: r.question, answer: r.answer, createdAt: r.createdAt, signals, score: scoreOf(signals), topic: 질문주제(r.question) });
  }

  // ── 출처 C: 증류(교사 모델이 근거 조각으로 만든 문답, 미평가) ─────────────────
  // 편입 라우트가 이미 제외 규칙·근거 겹침을 지났지만 여기서 한 번 더 지난다(규칙이 바뀌었을 수 있다).
  // ⚠ 증류는 **따로 담는다**(검토관 2026-09-03 상): 편입 조건이 「근거 겹침 있음」이라 cite 신호가 구조적으로
  //   항상 참 → 점수가 상수(4)라 같은 배열에서 정렬하면 실대화 후보를 상위 60칸 밖으로 밀어낸다(SQL 창을
  //   갈라 놓고도 한 겹 위에서 재발). 그래서 실대화·작업내역을 먼저 채우고 남는 칸에만 증류를 붙인다.
  //   점수도 상수를 주지 않는다 — 신호 칸은 「근거 있음·미검수」 하나뿐이고 일괄 승인 대상이 아니다.
  const distillOut: LearnCandidate[] = [];
  for (const r of unratedDistillStmt.all() as ChatLogRow[]) {
    const why = excluded(r.question, r.answer);
    if (why) { drop(why); continue; }
    const fp = fingerprint(r.question, r.answer);
    if (out.some((c) => fingerprint(c.question, c.answer) === fp) || distillOut.some((c) => fingerprint(c.question, c.answer) === fp)) { drop("중복"); continue; }
    const signals = { cite: Boolean(r.cites && r.cites !== "[]"), tool: false, accepted: false, lengthOk: r.answer.length >= 80 && r.answer.length <= 1200 };
    let cites: string[] = [];
    try { const raw = r.cites ? (JSON.parse(r.cites) as unknown[]) : []; cites = raw.map((c) => (typeof c === "string" ? c : String((c as { ref?: string })?.ref ?? ""))).filter(Boolean); } catch { cites = []; }
    distillOut.push({ id: `cl:${r.id}`, source: "distill", question: r.question, answer: r.answer, createdAt: r.createdAt, signals, score: 0, topic: r.topic ?? 질문주제(r.question), teacher: r.teacher ?? null, cites });
  }

  // ── 출처 B: 작업내역 user→assistant 짝 ──────────────────────────────
  const turns = turnsStmt.all(Date.now() - days * 86400000) as TurnRow[];
  for (let i = 0; i < turns.length - 1; i++) {
    const u = turns[i];
    const b = turns[i + 1];
    if (u.role !== "user" || b.role !== "assistant" || u.sessionId !== b.sessionId) continue;
    const id = `ws:${u.id}:${b.id}`;
    if (decided.has(id)) continue; // 이미 승인/제외 결정됨
    // 배포·게시 계정이 검증하느라 나눈 대화는 **업무 문답이 아니다**. 그대로 배우면
    // 제품이 아니라 시험을 배운다(learnpolicy의 확립된 원칙 — 대화 로그 경로는 이미 막혀 있다).
    if (isNonLearningSessionOwner(u.createdBy)) { drop("자동화 계정"); continue; }
    const why = excluded(u.content, b.content);
    if (why) { drop(why); continue; }
    const fp = fingerprint(u.content, b.content);
    if (seen.has(fp) || out.some((c) => fingerprint(c.question, c.answer) === fp)) { drop("중복"); continue; }
    // 수용 신호: 같은 세션의 다음 사용자 턴이 고쳐 묻기가 아니면 답이 받아들여진 것으로 본다.
    const nextUser = turns.slice(i + 2).find((t) => t.sessionId === u.sessionId && t.role === "user");
    const accepted = !nextUser || !isRephrase(u.content, nextUser.content);
    const signals = buildSignals(u.content, b.content, Boolean(b.tool), accepted);
    out.push({ id, source: "worksession", question: u.content, answer: b.content, createdAt: b.at, signals, score: scoreOf(signals), topic: 질문주제(u.content) });
  }

  out.sort((a, c) => c.score - a.score || c.createdAt - a.createdAt);
  distillOut.sort((a, c) => c.createdAt - a.createdAt);
  // 실대화·작업내역이 먼저, 남는 칸에 증류 — 증류 500건이 들어와도 실대화 후보는 화면에서 안 사라진다.
  const sliced = out.slice(0, limit);
  const 남은칸 = Math.max(0, limit - sliced.length);
  return {
    candidates: [...sliced, ...distillOut.slice(0, 남은칸)],
    // candidates·strong은 **실대화·작업내역 기준**(예전 뜻 그대로). 증류는 distill에 따로 센다.
    kpis: { candidates: out.length, strong: out.filter((c) => c.score >= 3).length, distill: distillOut.length, excludedByReason },
  };
}

/**
 * 승인/제외 — 승인은 👍 기록 **그리고** 겹 1 반입(승인 즉시 그 주제 지식영역에 들어가 다음 답의 근거가 된다,
 * 2026-09-03). approverId(계정 id)는 반입 문서의 열람 등급을 승인자 등급으로 잠그는 데 쓴다.
 */
export function decideLearnCandidate(id: string, accept: boolean, actor?: string, approverId?: string | null): { ok: true } {
  const now = Date.now();
  if (id.startsWith("cl:")) {
    // 대화 로그 출처 — rating이 결정 저장소다. 제외는 👎(이미 학습 제외 의미)로 남긴다.
    // 배지(topic: 질문주제(r.question) 재계산)와 진척(저장값)의 어긋남은 rateChatLog가 승인 때 NULL 주제를 채워 맞춘다
    //   (검토관 2026-09-03 나) — 여기서 따로 채우지 않는다(같은 규칙을 두 곳에 적으면 어긋난다).
    rateChatLog(id.slice(3), accept ? 1 : -1, approverId ?? null);
  } else if (id.startsWith("ws:")) {
    const [, userTurnId, botTurnId] = id.split(":");
    if (accept) {
      const turn = (t: string) => db.prepare("SELECT content, at FROM work_session_turns WHERE id = ?").get(t) as { content: string; at: number } | undefined;
      const u = turn(userTurnId);
      const b = turn(botTurnId);
      if (!u || !b) throw new Error("작업내역에서 해당 문답을 찾을 수 없습니다(정리됐을 수 있음)");
      // 승인 시점에 로그로 옮긴다(rating=1) — 이후는 기존 정제 루프가 그대로 집어간다.
      const newId = "lc" + now.toString(36) + Math.random().toString(36).slice(2, 8);
      insertLogStmt.run({
        id: newId,
        agentId: "orchestrator",
        question: u.content,
        answer: b.content,
        createdAt: b.at,
        topic: 질문주제(u.content),
        origin: "worksession",
      });
      // 승인 신호(겹 1) — INSERT로 rating=1을 직접 박는 입구라 rateChatLog를 안 지난다. 여기서 직접 보낸다.
      const inserted = getChatLog(newId);
      if (inserted) emitChatLogRated({ kind: "approved", log: inserted, approverId: approverId ?? null });
      else console.warn(`[learncandidates] 작업내역 승인 행을 다시 못 읽어 기억 반입 신호를 못 보냈다: ${newId}`);
    }
    putDecisionStmt.run(id, accept ? "accept" : "reject", now, actor ?? null);
  } else {
    throw new Error("알 수 없는 후보 id 형식");
  }
  return { ok: true };
}

/**
 * 신호 강한 후보 일괄 승인 — 시안의 "신호 강한 N건 모두 승인" 버튼.
 * ⚠ 증류 후보는 **절대 일괄 승인하지 않는다**(검토관 2026-09-03 상) — 교사 문답은 사람 눈을 한 번은 지나야
 *   한다(계획서 §9-3). 그리고 화면이 묻는 N(kpis.strong, 전체 기준)과 실제 승인 수가 같도록 창을 넓혀 부른다
 *   (예전엔 limit 60 기본값이라 「512건 승인할까요?」→「60건 승인됨」이 났다).
 */
export function acceptStrongCandidates(minScore = 3, actor?: string, approverId?: string | null): { accepted: number } {
  const { candidates } = listLearnCandidates(30, 100_000);
  let accepted = 0;
  for (const c of candidates) {
    if (c.source === "distill") continue;
    if (c.score < minScore) continue;
    decideLearnCandidate(c.id, true, actor, approverId);
    accepted++;
  }
  return { accepted };
}

// ── 증류 편입 (증류학습 계획서 §3.5 · 설계관 ★4·6·8·12 반영, 2026-09-03) ──────────────
//
// 교사 모델(gb10)이 근거 조각으로 만든 문답을 후보함에 넣는다. 세 가지를 **여기서** 지킨다:
//   1) rating NULL — 승인은 사람이 한다(원칙 3). 시드 라우트(rating=1 즉시)를 재사용하지 않는다.
//   2) 제외 규칙(excluded = 제품 규칙 + 위생 판별)을 **넣기 전에** 지난다 — 안 그러면 DB엔 있는데
//      후보함엔 안 보이는 행이 생겨 「생성 500 → 후보 500」이 거짓이 된다(★6).
//   3) 근거 겹침 — 답이 인용한 조각 본문과 **20자 이상 그대로** 겹쳐야 한다(원칙 4). 교사 환각을
//      학습하는 길을 막는 첫 문. 조각 ref는 호출자가 준 것(경로#해시)을 그대로 남긴다(★4).
// 거절 사유를 건별로 돌려준다 — 증류기가 폐기율(교사 품질 지표)을 이것으로 센다(★12).
export interface DistillItem {
  question?: string;
  answer?: string;
  topic?: string;
  cites?: { ref?: string; text?: string }[];
  promptHash?: string;
}
export interface DistillIntakeResult {
  accepted: number;
  rejected: { i: number; reason: string }[];
  byReason: Record<string, number>;
}

const OVERLAP_CHARS = 20;
/** 답이 근거 본문과 20자 이상 그대로 겹치는가 — 겹친 창을 돌려준다(없으면 null). 공백은 무시. */
export function 근거겹침(answer: string, sourceText: string): string | null {
  const a = String(answer ?? "").replace(/\s+/g, "");
  const s = String(sourceText ?? "").replace(/\s+/g, "");
  if (a.length < OVERLAP_CHARS || s.length < OVERLAP_CHARS) return null;
  for (let i = 0; i + OVERLAP_CHARS <= s.length; i += 4) {
    const w = s.slice(i, i + OVERLAP_CHARS);
    if (a.includes(w)) return w;
  }
  return null;
}

export function intakeDistilledCandidates(teacher: string, items: DistillItem[]): DistillIntakeResult {
  const t = String(teacher ?? "").trim();
  if (!t) throw new Error("teacher(교사 모델 id — 응답의 model 필드 실측값)가 필요합니다");
  const rejected: DistillIntakeResult["rejected"] = [];
  const byReason: Record<string, number> = {};
  const reject = (i: number, reason: string) => { rejected.push({ i, reason }); byReason[reason] = (byReason[reason] ?? 0) + 1; };
  const 있는지문 = new Set((allLogFingerprintRowsStmt.all() as { question: string; answer: string }[]).map((r) => fingerprint(r.question, r.answer)));
  let accepted = 0;
  items.forEach((it, i) => {
    const q = String(it.question ?? "").trim();
    const a = String(it.answer ?? "").trim();
    if (!q || !a) { reject(i, "빈 문답"); return; }
    const topic = (TOPICS as readonly string[]).includes(String(it.topic ?? "")) ? String(it.topic) : 질문주제(q);
    if (!topic) { reject(i, "주제 없음"); return; }
    const why = excluded(q, a);
    if (why) { reject(i, why); return; }
    const cites = Array.isArray(it.cites) ? it.cites : [];
    // ref(경로#sha12)와 text의 결속을 확인한다 — ref 꼬리가 본문 sha1 앞 12자와 같아야 한다(검토관 2026-09-03 중:
    // 저장·표시되는 것은 ref뿐인데 아무도 검증하지 않아 「없는 파일」이 근거로 인쇄될 수 있었다). 서버는 저장소
    // 파일을 못 보니 실재는 못 가리지만, 최소한 「이 본문에서 나온 ref」임은 여기서 가린다.
    const refOk = (ref: string, text: string) => { const m = ref.match(/#([0-9a-f]{12})$/i); return !m || m[1].toLowerCase() === crypto.createHash("sha1").update(text).digest("hex").slice(0, 12); };
    const refBroken = cites.some((c) => c?.ref && !refOk(String(c.ref), String(c?.text ?? "")));
    if (refBroken) { reject(i, "근거 ref 불일치(본문 해시)"); return; }
    const 겹친 = cites.map((c) => ({ ref: String(c?.ref ?? "").trim(), w: 근거겹침(a, String(c?.text ?? "")) })).filter((c) => c.ref && c.w);
    if (!겹친.length) { reject(i, `근거 겹침 없음(${OVERLAP_CHARS}자)`); return; }
    const fp = fingerprint(q, a);
    if (있는지문.has(fp)) { reject(i, "이미 있음"); return; }
    있는지문.add(fp);
    insertDistillStmt.run({
      id: "dt" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      question: q,
      answer: a,
      createdAt: Date.now(),
      topic,
      teacher: t,
      cites: JSON.stringify(겹친.map((c) => c.ref)),
      promptHash: it.promptHash ? String(it.promptHash).slice(0, 64) : null,
    });
    accepted += 1;
  });
  return { accepted, rejected, byReason };
}

export interface DistillCorpusOptions {
  category?: string; topic?: string; origins?: string[]; maxPerDoc?: number; maxChunks?: number; minChars?: number;
  /** 내보낼 등급(grades.ts 잣대). 기본 공개(O)만 — 출하 베이스 재료에 민감(S)이 섞이면 안 된다. C(기밀)는 무엇을 줘도 안 나간다. */
  allowedGrades?: string[];
  /** 요청자 눈으로 한 번 더 거른다(라우트가 열람불가공용으로 주입) — 등급 게이트를 창구가 우회하지 않게. */
  열람가능?: (documentId: string) => boolean;
}
export interface DistillCorpusChunk { ref: string; documentId: string; chunkIndex: number; category: string | null; text: string }
export interface DistillCorpusResult { chunks: DistillCorpusChunk[]; docs: number; skipped: Record<string, number>; filter: { category: string; origins: string[] | null } }
type CorpusMemory = { listDocuments(): Promise<MemoryDocument[]>; getDocumentChunks(id: string, limit?: number): Promise<{ chunkIndex: number; text: string }[]> };

/**
 * 증류 근거 코퍼스 — 지식 저장소 조각을 증류기 재료로 고른다(라우트 POST /api/learnloop/distill/corpus의 본체).
 * 가는 것: scope=global(개인 문서는 개인 것 — 원칙 「출하 베이스는 고객 데이터 금지」의 앞 단계) ·
 *   origin≠approved-qa(승인 문답은 증류의 산출물이지 재료가 아니다 — 자기 답을 자기 근거로 삼는 순환) ·
 *   등급 C(기밀) 제외 · 바이너리꼴 조각 제외(isBinaryLikeChunk — 저장소 조각의 73%가 PDF 바이트였던 실사고) · 너무 짧은 조각 제외.
 * ref = store:<documentId>#<sha12(text)> — intakeDistilledCandidates의 「ref 꼬리 = 본문 해시」 검증과 같은 규칙.
 * 상한을 넘겨 못 나간 조각은 skipped에 센다 — 조용히 잘리면 「다 봤다」로 읽힌다.
 */
/** JSON·CSV 덤프꼴 조각 — 키:값 쌍이 줄줄이거나 괄호·따옴표가 글의 2%를 넘으면 읽을 글이 아니라 자료다. */
export function 구조데이터꼴(text: string): boolean {
  const t = String(text ?? "");
  if (t.length < 40) return false;
  const 키값 = (t.match(/"[A-Za-z_][A-Za-z0-9_]*"\s*:/g) ?? []).length;
  if (키값 >= 3) return true;
  const 기호 = (t.match(/[{}\[\]]/g) ?? []).length;
  return 기호 / t.length > 0.02;
}

export async function buildDistillCorpus(b: DistillCorpusOptions, mem: CorpusMemory): Promise<DistillCorpusResult> {
  const category = String(b.category ?? b.topic ?? "").trim();
  const origins = Array.isArray(b.origins) ? b.origins.map(String) : null;
  const maxPerDoc = Math.max(1, Math.min(2000, Number(b.maxPerDoc) || 400));
  const maxChunks = Math.max(1, Math.min(20000, Number(b.maxChunks) || 4000));
  const minChars = Math.max(0, Number(b.minChars) || 80);
  // 등급은 grades.ts 한 곳의 잣대로 — 문자열 비교를 새로 적으면 깨진 값·소문자가 새고 민감(S)이 그대로 나간다(검토관 2026-09-03).
  const allowed: string[] = (Array.isArray(b.allowedGrades) && b.allowedGrades.length ? b.allowedGrades : ["O"]).map((g) => gradeOf(g)).filter((g) => g !== "C");
  const docs = (await mem.listDocuments()).filter((d) => d.scope === "global");
  const skipped: Record<string, number> = { "승인 문답": 0, "개인 문서": 0, "등급 제외": 0, "열람 불가": 0, "출처 제외": 0, "업무영역 다름": 0, "바이너리꼴": 0, "구조 데이터꼴": 0, "너무 짧음": 0, "문서당 상한": 0, "전체 상한(문서)": 0, "전체 상한(조각)": 0 };
  const out: DistillCorpusChunk[] = [];
  let docsUsed = 0;
  for (const d of docs) {
    if (d.origin === "approved-qa") { skipped["승인 문답"] += 1; continue; }
    // 개인 문서(내 문서)는 scope가 global이어도 문서 id 접두(personal:)로 갈린다 — scope만 보면 그대로 샌다(검토관 2026-09-03).
    if (d.documentId.startsWith("personal:")) { skipped["개인 문서"] += 1; continue; }
    if (!allowed.includes(gradeOf(d.grade))) { skipped["등급 제외"] += 1; continue; }
    if (b.열람가능 && !b.열람가능(d.documentId)) { skipped["열람 불가"] += 1; continue; }
    if (origins && !origins.includes(d.origin ?? "")) { skipped["출처 제외"] += 1; continue; }
    // ⚠ 여기의 category는 **문서 업무영역**이다 — 「일반」은 두 뜻을 겸한다(검토관 2026-09-03 가): 용어사전 같은
    //   전 영역 공용 자료이면서 규칙·LLM이 확신 못 한 문서의 **기본값**(memory.ts categorizeDocument)이기도 하다.
    //   증류 주제 「일반」(용어·개념)과 글자가 같아 여기로 「일반」을 넣으면 미분류 더미가 통째로 재료가 된다 —
    //   그래서 tools/distill.mjs는 「일반」에 --source store를 거절한다(파일 지목만). 창구 자체는 막지 않는다(다른 소비자 있음).
    if (category && (d.category ?? "") !== category) { skipped["업무영역 다름"] += 1; continue; }
    if (out.length >= maxChunks) { skipped["전체 상한(문서)"] += 1; continue; }
    const chunks = await mem.getDocumentChunks(d.documentId, 1_000_000);
    let took = 0;
    for (const c of chunks) {
      const text = String(c.text ?? "").trim();
      if (text.length < minChars) { skipped["너무 짧음"] += 1; continue; }
      if (isBinaryLikeChunk(text)) { skipped["바이너리꼴"] += 1; continue; }
      // JSON/CSV 덤프꼴(취약점 내보내기 파일 등) — 교사가 키 이름을 소리 나는 대로 읽어 「시비 에이씨이 점수」 같은 문답을 만든다(2026-09-03 첫 운영 증류 실측).
      if (구조데이터꼴(text)) { skipped["구조 데이터꼴"] += 1; continue; }
      if (took >= maxPerDoc) { skipped["문서당 상한"] += 1; continue; }
      if (out.length >= maxChunks) { skipped["전체 상한(조각)"] += 1; break; }
      out.push({ ref: `store:${d.documentId}#${crypto.createHash("sha1").update(text).digest("hex").slice(0, 12)}`, documentId: d.documentId, chunkIndex: c.chunkIndex, category: d.category, text });
      took += 1;
    }
    if (took > 0) docsUsed += 1;
  }
  return { chunks: out, docs: docsUsed, skipped, filter: { category, origins } };
}

export function registerLearnCandidateRoutes(app: Express): void {
  const actorOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.displayName ?? "(알 수 없음)";
  const userIdOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.id ?? null;

  app.get("/api/learnloop/candidates", authMiddleware, (req, res) => {
    res.json(listLearnCandidates(Number(req.query.days) || 30, Number(req.query.limit) || 60));
  });

  app.post("/api/learnloop/candidates/decide", authMiddleware, (req, res) => {
    const { id, accept } = req.body as { id?: string; accept?: boolean };
    if (!id || typeof accept !== "boolean") {
      res.status(400).json({ error: "id와 accept(true/false)가 필요합니다" });
      return;
    }
    try {
      decideLearnCandidate(id, accept, actorOf(req), userIdOf(req));
      recordAudit({ kind: "write", actor: actorOf(req), action: "학습 후보 결정", target: accept ? "승인" : "제외", detail: id, result: "ok" });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/learnloop/candidates/accept-strong", authMiddleware, (req, res) => {
    const r = acceptStrongCandidates(Number(req.body?.minScore) || 3, actorOf(req), userIdOf(req));
    recordAudit({ kind: "write", actor: actorOf(req), action: "학습 후보 일괄 승인", target: `${r.accepted}건`, result: "ok" });
    res.json(r);
  });

  // 사내 문서에서 뽑아 **사람이 검수한** 문답을 학습 재료로 편입한다(시드).
  //
  // 왜 필요한가(2026-08-09): 주제별 어댑터 개시선은 300건인데 후보함이 0건이었다.
  // 실사용이 쌓일 때까지 기다리면 언제 될지 알 수 없어, 사내 지식 문서에서 문답을 뽑아
  // 마중물로 넣는다(tools/seed-candidates.mjs가 뽑고 사람이 고른 것만 여기로 온다).
  //
  // ⚠ **출처를 지운 채 섞지 않는다.** agentId를 "seed-docs"로 박아, 나중에 "이 어댑터는
  //   실사용에서 배웠나 문서에서 배웠나"를 셀 수 있게 한다. 섞어 버리면 그 질문에 답할 수 없다.
  app.post("/api/learnloop/seed", authMiddleware, adminMiddleware, (req, res) => {
    const items = (req.body?.items ?? []) as { question?: string; answer?: string; topic?: string }[];
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items(문답 배열)가 필요합니다" });
      return;
    }
    let 넣음 = 0;
    const 거른것: Record<string, number> = {};
    const 있는지문 = new Set((allLogFingerprintRowsStmt.all() as { question: string; answer: string }[]).map((r) => fingerprint(r.question, r.answer)));
    for (const it of items) {
      const q = String(it.question ?? "").trim();
      const a = String(it.answer ?? "").trim();
      if (!q || !a) { 거른것["빈 문답"] = (거른것["빈 문답"] ?? 0) + 1; continue; }
      // 제품이 쓰는 제외 규칙을 **그대로** 지난다 — 시드라고 봐주면 위생이 뚫린다.
      const why = excluded(q, a);
      if (why) { 거른것[why] = (거른것[why] ?? 0) + 1; continue; }
      const fp = fingerprint(q, a);
      if (있는지문.has(fp)) { 거른것["이미 있음"] = (거른것["이미 있음"] ?? 0) + 1; continue; }
      있는지문.add(fp);
      const seedId = "sd" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      insertLogStmt.run({
        id: seedId,
        agentId: "seed-docs",
        question: q,
        answer: a,
        createdAt: Date.now(),
        topic: it.topic ?? 질문주제(q),
        origin: "seed",
      });
      // 승인 신호(겹 1) — 시드는 rating=1로 바로 들어오는 입구다. 여기서도 보낸다.
      const seeded = getChatLog(seedId);
      if (seeded) emitChatLogRated({ kind: "approved", log: seeded, approverId: userIdOf(req) });
      else console.warn(`[learncandidates] 시드 행을 다시 못 읽어 기억 반입 신호를 못 보냈다: ${seedId}`);
      넣음 += 1;
    }
    recordAudit({
      kind: "write", actor: actorOf(req), action: "학습 재료 시드 편입",
      target: `${넣음}건`, detail: `요청 ${items.length}건 · 거름 ${JSON.stringify(거른것)}`, result: "ok",
    });
    res.json({ 넣음, 거른것 });
  });

  // 증류 편입 — admin만. 본문 { teacher, items:[{question, answer, topic, cites:[{ref,text}], promptHash}] }.
  // rating NULL로 들어가 후보함(출처: 증류)에 뜬다. 승인은 사람이(원칙 3).
  app.post("/api/learnloop/distill/intake", authMiddleware, adminMiddleware, (req, res) => {
    const { teacher, items } = (req.body ?? {}) as { teacher?: string; items?: DistillItem[] };
    if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: "items(문답 배열)가 필요합니다" }); return; }
    if (items.length > 500) { res.status(400).json({ error: "한 번에 500건까지만 넣을 수 있습니다" }); return; }
    try {
      const r = intakeDistilledCandidates(String(teacher ?? ""), items);
      recordAudit({
        kind: "write", actor: actorOf(req), action: "증류 문답 편입(미승인)",
        target: `${r.accepted}건`, detail: `교사 ${teacher} · 요청 ${items.length}건 · 거름 ${JSON.stringify(r.byReason)}`, result: "ok",
      });
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 증류 근거 코퍼스 — 운영 지식 저장소의 조각을 증류기(tools/distill.mjs --source store)에 준다. admin만.
  // 왜(2026-09-03 설계관·계획서 §3.2): 저장소 파일(docs-manifest+knowledge/)만 자르면 운영에 올린 매뉴얼·지침·
  // 보고서가 재료에서 빠진다. 지식 저장소가 정본이고, 조각 경계도 검색이 쓰는 그것이다.
  // 가는 것: scope=global(개인 문서는 개인 것 — 원칙 「출하 베이스는 고객 데이터 금지」의 앞 단계) ·
  //   origin≠approved-qa(승인 문답은 증류의 산출물이지 재료가 아니다 — 자기 답을 자기 근거로 삼는 순환) ·
  //   등급 C(기밀) 제외 · 바이너리꼴 조각 제외(isBinaryLikeChunk — 저장소 조각의 73%가 PDF 바이트였던 실사고).
  // ref = store:<documentId>#<sha12(text)> — intakeDistilledCandidates의 「ref 꼬리 = 본문 해시」 검증과 같은 규칙.
  // 본문 { category?: 업무영역 | topic?: 주제(같은 뜻) · origins?: string[] · maxPerDoc?: number(기본 400) · maxChunks?: number(기본 4000) · minChars?: number(기본 80) }.
  app.post("/api/learnloop/distill/corpus", authMiddleware, adminMiddleware, async (req, res) => {
    const b = (req.body ?? {}) as DistillCorpusOptions;
    try {
      // 동적 import — memory(지식 층)로 가는 정적 화살을 새로 긋지 않는다(의존 수리 2026-08-28 원칙).
      const mem = await import("./memory.js");
      // 요청자 눈으로 한 번 더 — 창구가 등급 게이트(열람불가공용)를 우회하지 않는다.
      const r = await buildDistillCorpus({ ...b, 열람가능: (id) => !mem.열람불가공용(id, req) }, mem);
      recordAudit({
        // "write"가 아니라 반출이지만 AuditKind에 열람 종류가 없다 — 증류 편입(write)과 같은 흐름의 짝으로 둔다.
        kind: "write", actor: actorOf(req), action: "증류 근거 코퍼스 내줌",
        target: `${r.chunks.length}조각/${r.docs}문서`, detail: `업무영역 ${r.filter.category || "전부"} · 출처 ${r.filter.origins ? r.filter.origins.join(",") : "전부"} · 거름 ${JSON.stringify(r.skipped)}`, result: "ok",
      });
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
