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
import { authMiddleware } from "../auth/auth";
import { SMALLTALK, NO_ANSWER } from "./sessionpatterns";
import { rateChatLog } from "./learnloop";
// work_session_turns 테이블은 worksessions.ts의 migrate가 만든다 — 이 모듈이 먼저 적재되면
// 아래 prepare가 "no such table"로 죽는다(테스트에서 실측). 소유 모듈을 명시적으로 실어 보장한다.
import "./worksessions";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

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
const NO_GROUND_RE = /\(일반 지식 기준\)/;

/** 같은 문답을 다시 후보로 내밀지 않기 위한 정규화 지문. */
function fingerprint(question: string, answer: string): string {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[?!.,·…]/g, "").slice(0, 400);
  return crypto.createHash("sha1").update(norm(question) + "␞" + norm(answer)).digest("hex").slice(0, 16);
}

export interface LearnCandidate {
  id: string; // "cl:<logId>" | "ws:<userTurnId>:<botTurnId>"
  source: "chatlog" | "worksession";
  question: string;
  answer: string;
  createdAt: number;
  signals: { cite: boolean; tool: boolean; accepted: boolean; lengthOk: boolean };
  score: number; // cite 3 + tool 2 + accepted 1 + lengthOk 1
}

interface ChatLogRow { id: string; agentId: string; question: string; answer: string; rating: number | null; usedInDataset: number; createdAt: number }
interface TurnRow { id: string; sessionId: string; role: "user" | "assistant"; content: string; tool: string | null; at: number }

const unratedLogsStmt = db.prepare("SELECT * FROM chat_logs WHERE rating IS NULL AND usedInDataset = 0 ORDER BY createdAt DESC LIMIT 500");
const turnsStmt = db.prepare("SELECT id, sessionId, role, content, tool, at FROM work_session_turns WHERE at >= ? ORDER BY sessionId, at ASC");
const decisionStmt = db.prepare("SELECT id, decision FROM learn_candidate_decisions");
const putDecisionStmt = db.prepare(
  "INSERT INTO learn_candidate_decisions (id, decision, decidedAt, decidedBy) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET decision=excluded.decision, decidedAt=excluded.decidedAt, decidedBy=excluded.decidedBy"
);
const insertLogStmt = db.prepare(
  "INSERT INTO chat_logs (id, agentId, question, answer, rating, usedInDataset, createdAt) VALUES (@id, @agentId, @question, @answer, 1, 0, @createdAt)"
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
  kpis: { candidates: number; strong: number; excludedByReason: Record<string, number> };
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
    out.push({ id: `cl:${r.id}`, source: "chatlog", question: r.question, answer: r.answer, createdAt: r.createdAt, signals, score: scoreOf(signals) });
  }

  // ── 출처 B: 작업내역 user→assistant 짝 ──────────────────────────────
  const turns = turnsStmt.all(Date.now() - days * 86400000) as TurnRow[];
  for (let i = 0; i < turns.length - 1; i++) {
    const u = turns[i];
    const b = turns[i + 1];
    if (u.role !== "user" || b.role !== "assistant" || u.sessionId !== b.sessionId) continue;
    const id = `ws:${u.id}:${b.id}`;
    if (decided.has(id)) continue; // 이미 승인/제외 결정됨
    const why = excluded(u.content, b.content);
    if (why) { drop(why); continue; }
    const fp = fingerprint(u.content, b.content);
    if (seen.has(fp) || out.some((c) => fingerprint(c.question, c.answer) === fp)) { drop("중복"); continue; }
    // 수용 신호: 같은 세션의 다음 사용자 턴이 고쳐 묻기가 아니면 답이 받아들여진 것으로 본다.
    const nextUser = turns.slice(i + 2).find((t) => t.sessionId === u.sessionId && t.role === "user");
    const accepted = !nextUser || !isRephrase(u.content, nextUser.content);
    const signals = buildSignals(u.content, b.content, Boolean(b.tool), accepted);
    out.push({ id, source: "worksession", question: u.content, answer: b.content, createdAt: b.at, signals, score: scoreOf(signals) });
  }

  out.sort((a, c) => c.score - a.score || c.createdAt - a.createdAt);
  const sliced = out.slice(0, limit);
  return {
    candidates: sliced,
    kpis: { candidates: out.length, strong: out.filter((c) => c.score >= 3).length, excludedByReason },
  };
}

/** 승인/제외 — 승인은 👍 기록으로만 이어진다(자동 반영 없음 원칙의 문). */
export function decideLearnCandidate(id: string, accept: boolean, actor?: string): { ok: true } {
  const now = Date.now();
  if (id.startsWith("cl:")) {
    // 대화 로그 출처 — rating이 결정 저장소다. 제외는 👎(이미 학습 제외 의미)로 남긴다.
    rateChatLog(id.slice(3), accept ? 1 : -1);
  } else if (id.startsWith("ws:")) {
    const [, userTurnId, botTurnId] = id.split(":");
    if (accept) {
      const turn = (t: string) => db.prepare("SELECT content, at FROM work_session_turns WHERE id = ?").get(t) as { content: string; at: number } | undefined;
      const u = turn(userTurnId);
      const b = turn(botTurnId);
      if (!u || !b) throw new Error("작업내역에서 해당 문답을 찾을 수 없습니다(정리됐을 수 있음)");
      // 승인 시점에 로그로 옮긴다(rating=1) — 이후는 기존 정제 루프가 그대로 집어간다.
      insertLogStmt.run({
        id: "lc" + now.toString(36) + Math.random().toString(36).slice(2, 8),
        agentId: "orchestrator",
        question: u.content,
        answer: b.content,
        createdAt: b.at,
      });
    }
    putDecisionStmt.run(id, accept ? "accept" : "reject", now, actor ?? null);
  } else {
    throw new Error("알 수 없는 후보 id 형식");
  }
  return { ok: true };
}

/** 신호 강한 후보 일괄 승인 — 시안의 "신호 강한 N건 모두 승인" 버튼. */
export function acceptStrongCandidates(minScore = 3, actor?: string): { accepted: number } {
  const { candidates } = listLearnCandidates();
  let accepted = 0;
  for (const c of candidates) {
    if (c.score < minScore) continue;
    decideLearnCandidate(c.id, true, actor);
    accepted++;
  }
  return { accepted };
}

export function registerLearnCandidateRoutes(app: Express): void {
  const actorOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.displayName ?? "unknown";

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
      decideLearnCandidate(id, accept, actorOf(req));
      recordAudit({ kind: "write", actor: actorOf(req), action: "학습 후보 결정", target: accept ? "승인" : "제외", detail: id, result: "ok" });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/learnloop/candidates/accept-strong", authMiddleware, (req, res) => {
    const r = acceptStrongCandidates(Number(req.body?.minScore) || 3, actorOf(req));
    recordAudit({ kind: "write", actor: actorOf(req), action: "학습 후보 일괄 승인", target: `${r.accepted}건`, result: "ok" });
    res.json(r);
  });
}
