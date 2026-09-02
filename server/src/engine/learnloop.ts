// engine/learnloop.ts — 헤르메스 폐쇄형 학습 루프 (수집 → 정제 → 학습 → 배포)
//
// 사용 데이터가 폐쇄망 밖으로 나가지 않는 자가학습 사이클의 오케스트레이터:
//  ① 수집: 대화창 출구(dispatcher) + 직접 채팅 API(llm.ts chat())에서 실제 대화(질문/답변)를 chat_logs에 영속 저장.
//  ② 정제: 담당자가 👍/👎로 평가한 로그 중 긍정만 골라 데이터셋(data/datasets/loop-*.json)으로.
//  ③ 학습: finetune.ts(QLoRA)에 설정된 베이스 모델(기본 Qwen3-14B — 배치 모델과 같은 계열)을 주입해 실행.
//  ④ 등록: convert_lora_to_gguf.py로 GGUF LoRA 어댑터를 구워 어댑터 등록부(adapters.ts)에
//     **미채택**으로 올린다 — 평가 게이트 통과 후 사람이 채택해야 서빙·팀원 배정에 실린다(재설계 2단계).
//
// GPU 1대(RTX 3090) 전제: 파이프라인 시작 시 추론 llama-server 풀·임베딩 서버를 내리고(학습·병합이
// VRAM을 독점), 성공/실패와 무관하게 finally에서 재기동한다 — 실패해도 추론이 죽은 채 남지 않는다.
//
// 순환 import 주의: llm.ts가 이 모듈을 정적 import한다. 따라서 이 모듈은 llm.ts를 import하는
// dataset.ts를 정적으로 불러오면 안 된다(llm→learnloop→dataset→llm 순환) — saveDataset은
// buildDatasetFromLogs() 안에서 동적 import한다(memory.ts의 dataset 동적 import와 같은 선례).

import type { Express, Request } from "express";
import type { WebSocketServer } from "ws";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import { onChatRecorded } from "./llm"; // 화살 #15 — 수집기가 추론 층에 자기를 등록한다
import { llamaBinPath } from "../util/llamabin";
import { db, assertTestDb, migrate } from "../db";
import { startFinetune, isFinetuneRunning } from "./finetune";
import { sessionArchiveDir } from "./worksessions";
import { pauseInferenceEngines, resumeInferenceEngines } from "./localengine";
import { getAgentById } from "./agents";
import { attachProcessLogging, recordProcessOutput } from "./logs";
import { airgapChildEnv } from "./airgap";
import { trainPython, probeTrainDeps, TRAIN_DEPS, hfSnapshotDir, isBaseModelCached, adapterWorkDir } from "./trainenv";

const MODELS_DIR = process.env.GIJO_MODELS_DIR ?? "models";
const SMOKE = () => process.env.GIJO_LEARNLOOP_SMOKE === "1";

// ── 타입 ──────────────────────────────────────────────────────────────
export interface ChatLog {
  id: string;
  agentId: string;
  question: string;
  answer: string;
  rating: number | null; // null=미평가, 1=긍정(학습 채택), -1=부정(제외)
  usedInDataset: boolean;
  createdAt: number;
  topic: string | null; // 주제 딱지(취약점·장비운영·사내규정·위협대응) — 애매하면 null
  origin: ChatLogOrigin; // 어떻게 생긴 문답인가(§3.6-2) — 옛 행(NULL)은 'chat'
  teacher: string | null; // 증류 행만 — 교사 모델 id(응답의 model 필드 실측값, 상수 아님)
  cites: string[]; // 증류 행만 — 근거 조각 ref(경로#sha12) 목록. 비면 []
  promptHash: string | null; // 증류 행만 — 교사에게 준 프롬프트의 해시(재현성). API로도 되짚을 수 있어야 한다
}

/** 문답의 출처. 후보함의 source(어디서 찾았나)와 다른 축이다. */
export type ChatLogOrigin = "chat" | "worksession" | "seed" | "distill";
export const CHAT_LOG_ORIGINS: readonly ChatLogOrigin[] = ["chat", "worksession", "seed", "distill"] as const;

export type LearnloopStage =
  | "stopping-engines"
  | "training"
  | "exporting"
  | "deploying"
  | "restarting-engines"
  | "done"
  | "error";

export interface LearnloopRun {
  id: string;
  datasetId: string;
  baseModel: string;
  outputModelId: string; // 산출 어댑터 id (재설계 2단계부터 — 병합 모델이 아니라 GGUF LoRA)
  topic: string | null; // 주제별 전문가 학습이면 그 주제 — null이면 전 주제(범용)
  stage: LearnloopStage;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface LearnloopConfig {
  autoCollect: boolean;
  baseModel: string; // 학습 베이스(HF transformers repo id — GGUF 아님)
  modelPrefix: string; // 산출 모델 id 접두어 — <prefix>-v<N> 으로 버저닝
  targetAgent: string; // 배포 대상 에이전트 id
}

// ── prepared statements ──────────────────────────────────────────────
// 주제(업무영역) 딱지 — [2026-08-07 「전문 에이전트」 논의에서 실측이 시킨 것]
//
// 역할 딱지(agentId)는 이미 있었지만 **한쪽에만 쌓였다**: orchestrator 1,403건(66%) ·
// normaltic 562 · analysis 97 · report 57 · **scan 10 · ti 9**. 대화창 지시는 전부
// orchestrator로 가고 전문 역할은 파이프라인에서만 불리기 때문이다 — 이대로면 파일럿 4주가
// 지나도 전문가별 학습 재료는 **한 자릿수**다.
//
// 그래서 "누가 답했나"(agentId) 옆에 **"무슨 주제인가"(topic)**를 함께 남긴다. 전문가 학습의
// 진짜 재료는 답한 주체가 아니라 다뤄진 주제다 — 취약점 질문 1,000건이 모이면 그것이
// 취약점 전문가의 데이터셋이 된다(누가 답했든).
// ⚠ 판정은 **코드로만** 한다(learncandidates 원칙 2와 같은 잣대) — 같은 질문에 같은 딱지가
//   나와야 "지난달 이건 왜 취약점이었지"를 답할 수 있다.
migrate("chat-logs-topic-2026-08-07", "ALTER TABLE chat_logs ADD COLUMN topic TEXT");
// 출처(origin) — 이 문답이 **어떻게 생겼나**(증류학습 계획서 §3.6-2, 2026-09-03).
//   chat=실대화 수집 · worksession=작업내역 승인 편입 · seed=문서 시드 · distill=교사 모델 증류.
//   ⚠ 이름을 `source`로 하지 않는다 — 후보함(learncandidates)의 `source`는 「어디서 찾았나」
//   (chatlog|worksession)라 뜻이 다르다. 같은 이름 다른 값이 한 응답에 둘 있으면 반드시 헷갈린다.
//   옛 행은 NULL이고 읽을 때 'chat'으로 본다(전부 실대화 수집분이었다).
//   teacher·cites·promptHash는 증류 행에만 값이 있다 — 「이 어댑터는 무엇으로 배웠나」를 되짚는 자국.
migrate("chat-logs-origin-2026-09-03", "ALTER TABLE chat_logs ADD COLUMN origin TEXT");
migrate("chat-logs-teacher-2026-09-03", "ALTER TABLE chat_logs ADD COLUMN teacher TEXT");
migrate("chat-logs-cites-2026-09-03", "ALTER TABLE chat_logs ADD COLUMN cites TEXT");
migrate("chat-logs-prompthash-2026-09-03", "ALTER TABLE chat_logs ADD COLUMN promptHash TEXT");

const insertLogStmt = db.prepare(
  "INSERT INTO chat_logs (id, agentId, topic, question, answer, rating, usedInDataset, createdAt, origin) VALUES (@id, @agentId, @topic, @question, @answer, NULL, 0, @createdAt, 'chat')"
);
const listLogsStmt = db.prepare("SELECT * FROM chat_logs ORDER BY createdAt DESC LIMIT ? OFFSET ?");
const logKpiStmt = db.prepare(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS positive,
          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) AS negative,
          SUM(CASE WHEN usedInDataset = 0 AND (rating = 1 OR rating IS NULL) AND COALESCE(origin,'chat') <> 'distill' THEN 1 ELSE 0 END) AS unused
   FROM chat_logs`
);
const getLogStmt = db.prepare("SELECT * FROM chat_logs WHERE id = ?");
const rateLogStmt = db.prepare("UPDATE chat_logs SET rating = ? WHERE id = ?");
const deleteLogStmt = db.prepare("DELETE FROM chat_logs WHERE id = ?");
const pickLogsStmt = db.prepare(
  "SELECT * FROM chat_logs WHERE usedInDataset = 0 AND rating = 1 ORDER BY createdAt ASC"
);
// ⚠ 미평가 포함 경로는 **증류 행을 뺀다** — 증류는 rating NULL로 들어오므로(승인은 사람) 이 경로가
//   「승인 없는 학습 재료」의 유일한 우회로가 된다(검토관 2026-09-03 상 — 2026-08-01 잡담 유입 사고와 같은 문).
const pickLogsWithUnratedStmt = db.prepare(
  "SELECT * FROM chat_logs WHERE usedInDataset = 0 AND (rating = 1 OR rating IS NULL) AND COALESCE(origin,'chat') <> 'distill' ORDER BY createdAt ASC"
);
// 주제별 전문가 학습(재설계 2단계) — 그 주제 딱지가 붙은 것만 재료로 쓴다.
// ⚠ 2026-08-09부터 주제 데이터셋은 아래 pickAll* (전체 승인분)을 쓴다 — vN+1 재학습이
//   이전에 배운 것을 잃지 않게. usedInDataset 필터 판은 참고용으로 남긴다(레거시 경로 형태).
const pickAllApprovedByTopicStmt = db.prepare(
  "SELECT * FROM chat_logs WHERE rating = 1 AND topic = ? ORDER BY createdAt ASC"
);
const pickAllWithUnratedByTopicStmt = db.prepare(
  "SELECT * FROM chat_logs WHERE (rating = 1 OR rating IS NULL) AND topic = ? AND COALESCE(origin,'chat') <> 'distill' ORDER BY createdAt ASC"
);
// 학습 시작 게이트용 — usedInDataset 여부와 무관하게 그 주제의 **승인 총량**을 센다
// (게이트는 "재료가 이만큼 모였나"의 판정이지 "아직 안 쓴 게 몇 개냐"가 아니다).
const topicApprovedCountStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM chat_logs WHERE rating = 1 AND topic = ?"
);
const markUsedStmt = db.prepare("UPDATE chat_logs SET usedInDataset = 1 WHERE id = ?");
const countLogsStmt = db.prepare("SELECT COUNT(*) AS n FROM chat_logs");
// 보존 상한 초과분을 오래된 순으로 지운다 — 단, 아직 학습에 쓰지 않은 후보(👍/미평가 미사용)는
// 보호하고 "이미 학습에 쓰였거나(usedInDataset=1) 👎(rating=-1)"인 안전한 행부터 지운다.
const pruneSafeLogsStmt = db.prepare(
  `DELETE FROM chat_logs WHERE id IN (
     SELECT id FROM chat_logs WHERE usedInDataset = 1 OR rating = -1 ORDER BY createdAt ASC LIMIT ?
   )`
);
// 안전한 행을 다 지워도 여전히 상한을 넘으면(미학습 후보만 대량 적체된 극단적 경우) 최후 수단으로
// 가장 오래된 것부터 지운다 — 그래도 진짜 무한 증가만은 막는다.
const pruneOldestLogsStmt = db.prepare(
  `DELETE FROM chat_logs WHERE id IN (SELECT id FROM chat_logs ORDER BY createdAt ASC LIMIT ?)`
);

// 주제별 전문가 학습(재설계 2·3단계) — 어느 주제의 어댑터를 구운 실행인지 이력에 남긴다.
migrate("learnloop-runs-topic-2026-08-08", "ALTER TABLE learnloop_runs ADD COLUMN topic TEXT");

const insertRunStmt = db.prepare(
  "INSERT INTO learnloop_runs (id, datasetId, baseModel, outputModelId, topic, stage, error, startedAt, finishedAt) VALUES (@id, @datasetId, @baseModel, @outputModelId, @topic, @stage, NULL, @startedAt, NULL)"
);
const updateRunStmt = db.prepare("UPDATE learnloop_runs SET stage = ?, error = ?, finishedAt = ? WHERE id = ?");
const listRunsStmt = db.prepare("SELECT * FROM learnloop_runs ORDER BY startedAt DESC LIMIT 20");
const staleRunsStmt = db.prepare("UPDATE learnloop_runs SET stage = 'error', error = ?, finishedAt = ? WHERE stage NOT IN ('done','error')");

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
// Hermes 시대(2026-07) 기본값이 app_state에 저장돼 화면이 낡은 베이스를 보여 주던 것을
// 1회성으로 이행한다 — 옛 "기본값 그대로"인 저장값만 지운다(그 외 사용자 지정값은 존중).
migrate(
  "learnloop-hermes-defaults-2026-08-08",
  `DELETE FROM app_state
    WHERE (key = 'learnloop:baseModel' AND value = 'NousResearch/Hermes-3-Llama-3.1-8B')
       OR (key = 'learnloop:modelPrefix' AND value = 'hermes-sec-tuned')`
);

interface ChatLogRow {
  id: string;
  agentId: string;
  question: string;
  answer: string;
  rating: number | null;
  usedInDataset: number;
  createdAt: number;
  origin?: string | null;
  teacher?: string | null;
  cites?: string | null; // JSON 문자열
  promptHash?: string | null;
}

interface RunRow {
  id: string;
  datasetId: string;
  baseModel: string;
  outputModelId: string;
  topic: string | null;
  stage: LearnloopStage;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const logFromRow = (r: ChatLogRow): ChatLog => ({
  id: r.id,
  agentId: r.agentId,
  question: r.question,
  answer: r.answer,
  rating: r.rating,
  usedInDataset: r.usedInDataset === 1,
  createdAt: r.createdAt,
  // 후보함이 행마다 주제 배지를 단다(2026-08-08 시안 승인) — SELECT *라 값은 이미 온다.
  topic: (r as ChatLogRow & { topic?: string | null }).topic ?? null,
  // 출처(§3.6-2) — 매핑을 안 하면 SELECT *로 값이 와도 API에 안 실린다(topic 때 실제로 그랬다).
  origin: (CHAT_LOG_ORIGINS as readonly string[]).includes(r.origin ?? "") ? (r.origin as ChatLogOrigin) : "chat",
  teacher: r.teacher ?? null,
  cites: parseCites(r.cites),
  promptHash: r.promptHash ?? null,
});

function parseCites(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

// ── 승인·해제 신호(겹 1 기억 성장의 원천, 증류학습 계획서 §3.6-3) ──────────────────
// 승인 입구가 **네 곳**(후보 결정·일괄 승인·직접 평가·시드/작업내역 편입)이라 한 곳만 후크하면
// 나머지가 샌다. 그래서 「rating이 1이 되는/1에서 벗어나는」 사건을 **여기 한 곳**에서 방송하고,
// 입구들은 전부 emitChatLogRated를 부른다(짝 시험 memorygrowth.test가 소스로 지킨다).
// 청취자는 learnmemory.ts(승인 → 그 주제 지식영역에 반입, 해제/삭제 → 조각 제거)다.
// approverId: 승인한 사람(계정 id). 겹 1이 반입 문서의 **열람 등급을 승인자의 등급으로** 잠그는 데 쓴다
//   (검토관 2026-09-03 상 — 등급 NULL은 「공개」로 접혀 기밀 근거로 만든 답이 등급 밖으로 새는 세탁 경로).
//   모르면 undefined → 청취자가 가장 좁은 등급(기밀)으로 닫는다(fail-closed).
export type ChatLogRatedEvent = { kind: "approved"; log: ChatLog; approverId?: string | null } | { kind: "unapproved"; id: string };
type ChatLogRatedListener = (e: ChatLogRatedEvent) => void;
const ratedListeners: ChatLogRatedListener[] = [];
export function onChatLogRated(l: ChatLogRatedListener): void { ratedListeners.push(l); }
export function chatLogRatedListenerCount(): number { return ratedListeners.length; }
export function emitChatLogRated(e: ChatLogRatedEvent): void {
  for (const l of ratedListeners) {
    try { l(e); } catch (err) { console.warn(`[learnloop] 승인 신호 청취자 실패: ${err instanceof Error ? err.message : String(err)}`); }
  }
}
/** 로그 한 건 — 편입 경로(작업내역·시드·증류)가 INSERT 뒤 승인 신호를 보낼 때 쓴다. */
export function getChatLog(id: string): ChatLog | null {
  const row = getLogStmt.get(id) as ChatLogRow | undefined;
  return row ? logFromRow(row) : null;
}

const runFromRow = (r: RunRow): LearnloopRun => ({
  id: r.id,
  datasetId: r.datasetId,
  baseModel: r.baseModel,
  outputModelId: r.outputModelId,
  topic: r.topic ?? null,
  stage: r.stage,
  error: r.error ?? undefined,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt ?? undefined,
});

// ── WebSocket 브로드캐스트 (finetune.ts 패턴) ─────────────────────────
let wss: WebSocketServer | null = null;
export function attachLearnloopSocket(server: WebSocketServer): void {
  wss = server;
}

function broadcastRun(run: LearnloopRun): void {
  wss?.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ channel: "learnloop:progress", payload: run }));
    }
  });
}

// ── 설정 (app_state KV — localengine lastModelId 패턴) ────────────────
// 기본 베이스는 실제 1회전(2026-08-08)에 쓴 Qwen3-14B — 배치 모델과 같은 계열이어야
// 산출 어댑터를 서빙 베이스에 붙일 수 있다(LoRA는 베이스 종속).
const DEFAULT_CONFIG: LearnloopConfig = {
  autoCollect: true,
  baseModel: "Qwen/Qwen3-14B",
  modelPrefix: "sec-expert",
  targetAgent: "model-evolution",
};


// 산출 어댑터 id는 <prefix>-v<N> — convert 산출 파일명 규칙(^[a-z0-9][a-z0-9.-]{0,63}$)에 맞아야 한다.
const PREFIX_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

function stateGet(key: string): string | undefined {
  return (getStateStmt.get(`learnloop:${key}`) as { value: string } | undefined)?.value;
}

export function getLearnloopConfig(): LearnloopConfig {
  return {
    autoCollect: stateGet("autoCollect") !== "off",
    baseModel: stateGet("baseModel") ?? DEFAULT_CONFIG.baseModel,
    modelPrefix: stateGet("modelPrefix") ?? DEFAULT_CONFIG.modelPrefix,
    targetAgent: stateGet("targetAgent") ?? DEFAULT_CONFIG.targetAgent,
  };
}

export function putLearnloopConfig(patch: Partial<LearnloopConfig>): LearnloopConfig {
  if (patch.modelPrefix !== undefined && !PREFIX_RE.test(patch.modelPrefix)) {
    throw new Error("모델 접두어는 영문 소문자/숫자/하이픈 41자 이내여야 합니다 (예: sec-expert)");
  }
  if (patch.targetAgent !== undefined && !getAgentById(patch.targetAgent)) {
    throw new Error(`존재하지 않는 에이전트: ${patch.targetAgent}`);
  }
  if (patch.baseModel !== undefined && !patch.baseModel.trim()) {
    throw new Error("베이스 모델(HF repo id)이 비었습니다");
  }
  if (patch.autoCollect !== undefined) setStateStmt.run("learnloop:autoCollect", patch.autoCollect ? "on" : "off");
  if (patch.baseModel !== undefined) setStateStmt.run("learnloop:baseModel", patch.baseModel.trim());
  if (patch.modelPrefix !== undefined) setStateStmt.run("learnloop:modelPrefix", patch.modelPrefix);
  if (patch.targetAgent !== undefined) setStateStmt.run("learnloop:targetAgent", patch.targetAgent);
  return getLearnloopConfig();
}

// 수집 로그 보존 상한(무한 증가 방지). COUNT+DELETE를 매 insert마다 돌리지 않으려고 카운터로
// PRUNE_EVERY 주기에만 정리한다 — 실제 행 수는 최대 CHATLOG_MAX + PRUNE_EVERY 로 유계.
const CHATLOG_MAX = Number(process.env.GIJO_CHATLOG_MAX ?? 10000);
const PRUNE_EVERY = 200;
let insertsSincePrune = 0;

// 상한 초과분을 삭제한다. 학습 대기 후보(👍/미평가 미사용)는 보호하고 안전한 행(이미 학습됨 또는
// 👎)부터 지운 뒤, 그래도 넘치면 최후 수단으로 가장 오래된 것을 지운다. 테스트에서도 직접 부른다.
//
// 해자 슬라이스 0(2026-08-06): 예전엔 정리분이 **아카이브조차 없이 영구 소실**됐다(설계문서
// 실측). 이제 지우기 전에 session-archive/chatlogs-*.jsonl 로 내리고, **다 쓴 것을 확인한 뒤에만**
// 지운다(worksessions 아카이브와 같은 순서 계약). 내리기가 실패하면 지우지 않는다 — 캡 초과로
// 디스크가 조금 더 쓰이는 쪽이 기록 소실보다 낫다.
export function pruneChatLogs(cap = CHATLOG_MAX): number {
  const total = (countLogsStmt.get() as { n: number }).n;
  const over = total - cap;
  if (over <= 0) return 0;
  // 지울 행을 먼저 고른다(안전한 행 우선 → 오래된 순) — 지우는 것과 내리는 것이 같은 집합이어야 한다.
  const safe = db.prepare(
    "SELECT * FROM chat_logs WHERE usedInDataset = 1 OR rating = -1 ORDER BY createdAt ASC LIMIT ?"
  ).all(over) as { id: string }[];
  let doomed = safe;
  if (safe.length < over) {
    const got = new Set(safe.map((r) => r.id));
    const oldest = (db.prepare("SELECT * FROM chat_logs ORDER BY createdAt ASC LIMIT ?").all(over) as { id: string }[])
      .filter((r) => !got.has(r.id)).slice(0, over - safe.length);
    doomed = [...safe, ...oldest];
  }
  if (!doomed.length) return 0;
  try {
    const dir = sessionArchiveDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `chatlogs-${new Date().toISOString().slice(0, 7)}.jsonl`);
    fs.appendFileSync(file, doomed.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  } catch (e) {
    console.warn(`[learnloop] 정리분 아카이브 실패 — 지우지 않고 보류: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  const del = db.prepare(`DELETE FROM chat_logs WHERE id IN (${doomed.map(() => "?").join(",")})`);
  const removed = del.run(...doomed.map((r) => r.id)).changes;
  if (removed > 0) {
    console.warn(`[learnloop] 수집 로그 보존 상한(${cap}) 초과 — ${removed}건 아카이브 후 정리`);
  }
  // 삭제 입구는 둘(deleteChatLog·여기)이다 — 여기서도 승인돼 있던 행은 기억에서 뺀다(검토관 2026-09-03 상).
  //   1순위 정리 대상이 usedInDataset=1인데 그것이 곧 「승인돼 학습에 쓰인 행」이라, 신호 없이 지우면
  //   승인문답:<id> 조각이 로그 없는 고아로 영원히 남는다(되돌릴 손잡이도 사라진다).
  for (const r of doomed as { id: string; rating?: number | null }[]) {
    if (r.rating === 1) emitChatLogRated({ kind: "unapproved", id: r.id });
  }
  return removed;
}

/**
 * 질문의 업무영역을 **결정적으로** 판정한다(LLM 없이). 확신 못 하면 null — 억지로 붙이지 않는다
 * (문서 분류의 「억지 분류가 오분류보다 나쁘다」와 같은 잣대).
 *
 * ⚠ 문서 분류(categorizeByRules)와 따로 두는 이유: 문서는 본문 수천 자로 판정하지만 질문은
 *   한 줄이다. 같은 규칙을 쓰면 거의 전부 "확신 못 함"이 된다 — 질문에는 질문의 신호가 있다.
 */
// 주제(업무영역) 상수 — 질문주제 판정·주제별 학습 게이트·topics API가 같은 값을 본다.
export const TOPICS = ["취약점", "장비운영", "사내규정", "위협대응"] as const;
// 어댑터 id는 영문 제약(export_gguf 규칙과 동일)이라 주제를 슬러그로 바꾼다.
const TOPIC_SLUGS: Record<string, string> = { 취약점: "vuln", 장비운영: "ops", 사내규정: "policy", 위협대응: "threat" };
const topicSlug = (topic: string): string => TOPIC_SLUGS[topic] ?? "misc";
// 주제별 전문가 학습 개시선(승인 문답 수). LIMA 계열 근거 + 1회전 실측(85쌍은 생성 안정성이
// 무너짐 — 반복 루프·설정 키 날조)에서 나온 값. topics API의 "준비됨" 판정과 같은 값이어야 한다.
export const TOPIC_TRAIN_TARGET = 300;

export function 질문주제(question: string): string | null {
  const q = String(question ?? "");
  const 점수: Record<string, number> = {
    취약점: (q.match(/취약점|CVE-\d{4}|CVSS|EPSS|KEV|패치|스캔|익스플로잇|조치\s*기한|미조치/g) ?? []).length,
    장비운영: (q.match(/방화벽|스위치|라우터|WAF|IPS|IDS|EDR|장비|펌웨어|점검|유지보수|매뉴얼|룰셋|로그\s*필드/g) ?? []).length,
    사내규정: (q.match(/규정|지침|정책|해도\s*(되|돼)|보관\s*기간|승인\s*절차|컴플라이언스|준수|반출/g) ?? []).length,
    위협대응: (q.match(/공격|침해|피싱|랜섬웨어|악성|탐지|차단|IOC|위협|인텔|대응\s*절차/g) ?? []).length,
  };
  const 정렬 = Object.entries(점수).sort((a, b) => b[1] - a[1]);
  // 1점만 있어도 받는다(질문은 짧다). 단 **동점이면 확신하지 않는다** — 경계 질문이다.
  return 정렬[0][1] >= 1 && 정렬[0][1] > 정렬[1][1] ? 정렬[0][0] : null;
}

// ── ① 수집 ────────────────────────────────────────────────────────────
// 두 입구에서 호출된다(2026-08-07): ① 대화창 출구(dispatcher dispatchInstructionScoped) —
// 즉답·도구 답·LLM 답 가리지 않고 한 곳에서 / ② 직접 채팅 API(llm.ts chat() remember:true).
// 캡처 실패가 채팅 응답을 죽이면 안 되므로 전체를 try/catch로 감싼다. autoCollect가 꺼져 있으면 조용히 무시.
export function recordChatLog(agentId: string, question: string, answer: string): void {
  try {
    if (!getLearnloopConfig().autoCollect) return;
    if (!question.trim() || !answer.trim()) return;
    insertLogStmt.run({
      id: "cl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      agentId,
      topic: 질문주제(question),
      question,
      answer,
      createdAt: Date.now(),
    });
    if (++insertsSincePrune >= PRUNE_EVERY) {
      insertsSincePrune = 0;
      pruneChatLogs();
    }
  } catch (err) {
    console.warn("[learnloop] 대화 수집 실패(채팅에는 영향 없음):", err instanceof Error ? err.message : err);
  }
}

export function listChatLogs(limit = 50, offset = 0): { logs: ChatLog[]; kpis: { total: number; positive: number; negative: number; unused: number } } {
  const rows = listLogsStmt.all(limit, offset) as ChatLogRow[];
  const kpi = logKpiStmt.get() as { total: number; positive: number | null; negative: number | null; unused: number | null };
  return {
    logs: rows.map(logFromRow),
    kpis: { total: kpi.total, positive: kpi.positive ?? 0, negative: kpi.negative ?? 0, unused: kpi.unused ?? 0 },
  };
}

export function rateChatLog(id: string, rating: 1 | -1 | 0, approverId?: string | null): ChatLog {
  const row = getLogStmt.get(id) as ChatLogRow | undefined;
  if (!row) throw new Error("존재하지 않는 대화 로그입니다");
  rateLogStmt.run(rating === 0 ? null : rating, id);
  const after = logFromRow(getLogStmt.get(id) as ChatLogRow);
  // 승인 신호(겹 1) — 1이 되면 반입, 1에서 벗어나면 제거. 같은 값 반복은 청취자가 멱등으로 받는다.
  if (rating === 1) emitChatLogRated({ kind: "approved", log: after, approverId: approverId ?? null });
  else if (row.rating === 1) emitChatLogRated({ kind: "unapproved", id });
  return after;
}

export function deleteChatLog(id: string): void {
  const row = getLogStmt.get(id) as ChatLogRow | undefined;
  if (!row) throw new Error("존재하지 않는 대화 로그입니다");
  deleteLogStmt.run(id);
  if (row.rating === 1) emitChatLogRated({ kind: "unapproved", id }); // 승인돼 있던 것을 지우면 기억에서도 뺀다
}

// ── ② 정제 → 데이터셋 ────────────────────────────────────────────────
// 긍정 평가(옵션: +미평가) 미사용 로그를 {question,answer}[]로 변환해 저장한다 — 이미 Q&A 쌍이라
// LLM 재변환이 필요 없다. 저장 성공 후 같은 트랜잭션에서 usedInDataset=1 마킹.
export async function buildDatasetFromLogs(opts: { includeUnrated?: boolean; minExamples?: number; topic?: string } = {}): Promise<{ datasetId: string; examples: number; fingerprint: string; dropped: Record<string, number> }> {
  const minExamples = opts.minExamples ?? 5;
  // 주제 학습은 **전체 승인 데이터**로 굽는다(2026-08-09 추가 교육 정책, 사용자 지시).
  //   어댑터 vN+1은 vN을 대체하므로, "새로 쌓인 것만"으로 구우면 이전에 배운 것이 통째로
  //   빠진 어댑터가 나온다(usedInDataset=0 필터가 옛 승인분을 걸러 버림 — 실코드 검토에서 발견).
  //   LoRA에 덧학습(이어서 학습)하는 방식은 망각·과적합 함정이 커서 쓰지 않는다 —
  //   이전+새 승인분을 합쳐 처음부터 다시 굽는 재학습이 정도다.
  //   usedInDataset 마킹은 비주제(레거시) 경로에만 계속 쓴다.
  const rows = (
    opts.topic
      ? (opts.includeUnrated ? pickAllWithUnratedByTopicStmt : pickAllApprovedByTopicStmt).all(opts.topic)
      : (opts.includeUnrated ? pickLogsWithUnratedStmt : pickLogsStmt).all()
  ) as ChatLogRow[];
  if (rows.length < minExamples) {
    throw new Error(
      `학습에 쓸 로그가 부족합니다 (${opts.topic ? `주제 「${opts.topic}」 ` : ""}현재 ${rows.length}건, 최소 ${minExamples}건). 대화를 더 수집하고 👍 평가를 남겨주세요.`
    );
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const datasetId = `loop-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // ★ 위생을 통과한 것만 학습에 넣는다(계획서 중-4 · 학습환경_분리_설계 §5).
  //   중복·시험 문항·기계 생성·주입 표식을 여기서 거른다. 게이트(중-3)만 믿으면 늦다 —
  //   며칠 학습한 뒤 보류가 뜨고, 왜 나빠졌는지는 되짚을 수 없다.
  const { cleanForTraining } = await import("./datasethygiene.js");
  const 위생 = cleanForTraining(rows.map((r) => ({ question: r.question, answer: r.answer })));
  if (위생.kept.length < minExamples) {
    const 사유 = Object.entries(위생.dropped).map(([k, v]) => `${k} ${v}건`).join(" · ") || "없음";
    throw new Error(
      `위생 검사를 통과한 문답이 부족합니다 (${rows.length}건 중 ${위생.kept.length}건, 최소 ${minExamples}건).\n` +
        `걸러진 것: ${사유}\n` +
        `같은 질문이 여러 번이면 하나만 남습니다 — 서로 다른 질문을 더 모아 주세요.`
    );
  }

  // dataset.ts는 llm.ts를 import하므로 정적 import 시 순환(llm→learnloop→dataset→llm) — 동적 import.
  const { saveDataset } = await import("./dataset.js");
  const result = saveDataset(datasetId, 위생.kept);

  const markAll = db.transaction((ids: string[]) => {
    for (const id of ids) markUsedStmt.run(id);
  });
  markAll(rows.map((r) => r.id));
  // 지문·걸러진 내역을 함께 돌려준다 — 채택 원장에 남겨 "무엇으로 학습됐나"를 되짚는다.
  return { datasetId: result.id, examples: result.examples, fingerprint: 위생.fingerprint, dropped: 위생.dropped };
}

// ── ③+④ 학습→배포 파이프라인 ─────────────────────────────────────────
let loopRunning = false;
let currentRun: LearnloopRun | null = null;

export function isLearnloopRunning(): boolean {
  return loopRunning;
}

export function listLearnloopRuns(): LearnloopRun[] {
  return (listRunsStmt.all() as RunRow[]).map(runFromRow);
}

export function getLearnloopStatus(): { running: boolean; run: LearnloopRun | null } {
  return { running: loopRunning, run: currentRun ?? listLearnloopRuns()[0] ?? null };
}

// 서버 재시작 시 비종결 상태로 남은 실행을 error로 마감한다 — "training"으로 영원히 표시되는
// 유령 실행 방지(agents.ts가 status를 영속화하지 않는 것과 같은 원칙).
function markInterruptedRuns(): void {
  staleRunsStmt.run("서버 재시작으로 중단됨", Date.now());
}
markInterruptedRuns();

// <prefix>-v<N> 다음 버전 번호를 정한다. models/ 디렉터리와 실행 이력(learnloop_runs) 양쪽에서
// max를 취한다 — 파일만 보면 export가 실패했거나(gguf 미생성) 스모크 모드일 때 같은 버전을
// 재발급해 이력이 겹치고, 이력만 보면 사용자가 수동으로 gguf를 넣은 경우를 놓친다.
// 버전드 id라 롤백은 에이전트 모델 재할당으로 끝난다(이전 버전 gguf가 그대로 남아 있음).
const runModelIdsStmt = db.prepare("SELECT outputModelId FROM learnloop_runs");
function nextOutputModelId(prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-v(\\d+)$`);
  if (fs.existsSync(MODELS_DIR)) {
    for (const entry of fs.readdirSync(MODELS_DIR)) {
      const m = re.exec(entry);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  // 어댑터 산출처(data/lora)도 본다 — 재설계 2단계부터 산출이 여기로 온다(<id>.gguf).
  if (fs.existsSync(LORA_DIR)) {
    for (const entry of fs.readdirSync(LORA_DIR)) {
      const m = re.exec(entry.replace(/\.gguf$/, ""));
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  for (const row of runModelIdsStmt.all() as { outputModelId: string }[]) {
    const m = re.exec(row.outputModelId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-v${max + 1}`;
}

function setStage(run: LearnloopRun, stage: LearnloopStage, error?: string): void {
  run.stage = stage;
  run.error = error;
  const finished = stage === "done" || stage === "error";
  if (finished) run.finishedAt = Date.now();
  updateRunStmt.run(stage, error ?? null, run.finishedAt ?? null, run.id);
  broadcastRun(run);
  recordProcessOutput("learnloop", error ? "error" : "log", `[${run.id}] ${stage}${error ? ` — ${error}` : ""}`);
}

// 주제별 학습 개시 게이트(재설계 3단계) — "언제 전문가를 학습시킬 수 있나"의 단일 판정.
// force는 목표 미달 강행(관리자 실험용) — 산출 어댑터 note에 강행 사실이 남는다.
export function topicTrainGate(topic: string): { ok: boolean; approved: number; target: number; 남은건수: number } {
  if (!(TOPICS as readonly string[]).includes(topic)) {
    throw new Error(`알 수 없는 주제입니다: ${topic} — 가능한 주제: ${TOPICS.join("·")}`);
  }
  const approved = (topicApprovedCountStmt.get(topic) as { n: number }).n;
  return { ok: approved >= TOPIC_TRAIN_TARGET, approved, target: TOPIC_TRAIN_TARGET, 남은건수: Math.max(0, TOPIC_TRAIN_TARGET - approved) };
}

export async function startLearnloopRun(opts: { datasetId?: string; topic?: string; force?: boolean } = {}): Promise<LearnloopRun> {
  if (loopRunning) throw new Error("이미 학습 루프가 진행 중입니다");
  if (isFinetuneRunning()) throw new Error("파인튜닝이 이미 진행 중입니다 — 끝난 뒤 다시 시도하세요");

  // 주제별 전문가 학습이면 개시선(승인 300)을 먼저 확인한다 — 1회전 실측(85쌍 → 반복 루프·
  // 키 날조)이 이 게이트의 이유. 미달이면 진척 수치와 함께 정직하게 거절한다.
  const topic = opts.topic ?? null;
  let 강행 = false;
  if (topic) {
    const gate = topicTrainGate(topic);
    if (!gate.ok && !opts.force) {
      throw new Error(
        `주제 「${topic}」의 승인 문답이 아직 ${gate.approved}/${gate.target}건입니다 — ${gate.남은건수}건 더 모여야 전문가 학습을 시작할 수 있습니다. ` +
          `(1회전 실측: 소량 재료 학습은 답이 망가집니다. 후보함에서 좋은 문답을 승인해 주세요.)`
      );
    }
    강행 = !gate.ok; // force로 뚫었다는 사실 — 산출 어댑터 note에 남긴다
  }

  const config = getLearnloopConfig();
  // datasetId가 없으면 수집 로그로 즉석 데이터셋을 만든다(원클릭 루프). 주제가 있으면 그 주제만.
  const datasetId = opts.datasetId ?? (await buildDatasetFromLogs({ topic: topic ?? undefined })).datasetId;
  const outputModelId = nextOutputModelId(topic ? `${config.modelPrefix}-${topicSlug(topic)}` : config.modelPrefix);

  const run: LearnloopRun = {
    id: "run" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    datasetId,
    baseModel: config.baseModel,
    outputModelId,
    topic,
    stage: "stopping-engines",
    startedAt: Date.now(),
  };
  insertRunStmt.run({ ...run });
  loopRunning = true;
  currentRun = run;
  broadcastRun(run);

  void runPipeline(run, config, 강행).finally(() => {
    loopRunning = false;
  });
  return run;
}

// 스모크 모드에서도 단계 전이가 비동기로 관찰되도록 한 박자 쉰다 — 이게 없으면 async 함수가
// 첫 await 없이 동기로 완주해 202 응답 전에 이미 done이 돼버린다(전이 브로드캐스트도 못 봄).
const smokeTick = () => new Promise<void>((r) => setTimeout(r, 25));

async function runPipeline(run: LearnloopRun, config: LearnloopConfig, 목표미달강행 = false): Promise<void> {
  let failure: string | null = null;
  try {
    // (1) 추론 엔진 정지 — 학습·병합이 GPU(VRAM)를 독점해야 한다. 진행 중 채팅/RAG은 일시 불가.
    if (SMOKE()) await smokeTick();
    else await pauseInferenceEngines();

    // (2) QLoRA 학습 — 설정된 베이스 모델(Qwen3-14B 기본)을 주입.
    // manageEngines:false — 엔진 정지/재기동은 루프가 export까지 포함해 직접 관리한다(이중 정지 방지).
    setStage(run, "training");
    if (SMOKE()) await smokeTick();
    else {
      await new Promise<void>((resolve, reject) => {
        const result = startFinetune({
          agentId: config.targetAgent,
          datasetId: run.datasetId,
          baseModel: run.baseModel,
          manageEngines: false,
          onComplete: (r) => (r.ok ? resolve() : reject(new Error(r.message ?? "학습 실패"))),
        });
        if (!result.started) reject(new Error(result.error ?? "학습을 시작하지 못했습니다"));
      });
    }

    // (3) 어댑터 변환(재설계 2단계) — 병합 GGUF 대신 **GGUF LoRA 어댑터**를 굽는다.
    // 병합은 베이스 통째 복제(수 GB×버전)였고, 어댑터(수십 MB)는 베이스 1개 위에 여럿을
    // 얹을 수 있다("베이스 1 + 어댑터 N"). 병합 경로(export_gguf.py)는 은퇴 — 머지 메뉴를
    // 내린 사용자 결정(2026-08-08)과 같은 계열이다.
    setStage(run, "exporting");
    if (SMOKE()) await smokeTick();
    else {
      await runAdapterExport(run.datasetId, run.outputModelId, run.baseModel);
    }

    // (4) 등록(미채택) — **자동 부착 금지**. 어댑터 1호가 게이트 없이 나갔다면 설정 키 날조가
    // 실서비스에 실렸을 것이다(2026-08-08 실측). 평가 게이트 통과 후 사람이 채택해야
    // 서빙에 실리고 팀원에 배정할 수 있다. 스모크에선 실제 파일이 없어 생략.
    setStage(run, "deploying");
    if (SMOKE()) await smokeTick();
    else {
      const { registerAdapter } = await import("./adapters.js");
      registerAdapter({
        id: run.outputModelId,
        topic: run.topic,
        baseModelId: servingBaseModelId(),
        file: adapterOutPath(run.outputModelId),
        note:
          `미채택 — 평가 게이트(tools/evalgate) + A/B(lora-ab) 통과 후 채택하세요. ` +
          `학습 베이스 ${run.baseModel} · 데이터셋 ${run.datasetId}` +
          (목표미달강행 ? ` · ⚠개시선(${TOPIC_TRAIN_TARGET}건) 미달 강행 학습` : ""),
      });
    }
  } catch (err) {
    failure = `${run.stage} 단계 실패: ${err instanceof Error ? err.message : String(err)}`;
  }

  // (5) 성공/실패와 무관하게 추론 엔진 재기동 — 루프가 실패해도 채팅이 죽은 채 남으면 안 된다.
  setStage(run, "restarting-engines");
  if (!SMOKE()) {
    await resumeInferenceEngines().catch((err) =>
      console.error("[learnloop] 엔진 재기동 실패 — 에이전트 AI 화면에서 수동 기동 필요:", err)
    );
  }

  if (failure) setStage(run, "error", failure);
  else setStage(run, "done");
}

// 산출 어댑터 보관처 — models/(베이스)와 분리해 "베이스 1 + 어댑터 N"의 물리 구조를 그대로 둔다.
const LORA_DIR = process.env.GIJO_LORA_DIR ?? path.join("data", "lora");
export const adapterOutPath = (adapterId: string): string => path.join(LORA_DIR, `${adapterId}.gguf`);

// 산출 어댑터가 붙을 **서빙 베이스 모델 id**(GGUF, models/의 폴더명). 학습 베이스(HF repo)와
// 다른 좌표계다 — 운영자가 고른 기본 모델(defaultModelId)이 곧 어댑터가 얹힐 그릇이다.
export function servingBaseModelId(): string {
  const stored = (getStateStmt.get("defaultModelId") as { value: string } | undefined)?.value;
  // ⚠ 마지막 폴백은 localengine.ts의 DEFAULT_MODEL_ID와 **같아야 한다.** 2026-08-09에
  //   둘 다 7.6B로 낡아 있었고, 운영은 app_state가 14B를 덮어 멀쩡히 돌아 안 드러났다.
  //   어긋나면 어댑터가 엉뚱한 그릇에 얹힌다 — modeldefault.test.ts가 두 값을 대조한다.
  return stored ?? process.env.GIJO_DEFAULT_MODEL_ID ?? "qwen3-14b";
}

// llama.cpp convert_lora_to_gguf.py 실행 — HF LoRA 산출(outputs/<ds>/lora-adapter)을
// GGUF LoRA(data/lora/<id>.gguf)로 변환한다. 1회전(2026-08-08)에서 실검증된 경로.
function runAdapterExport(datasetId: string, adapterId: string, baseModel: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fs.mkdirSync(LORA_DIR, { recursive: true });
    // 학습이 떨군 자리를 그대로 읽는다(두 단계가 같은 상수를 본다 — trainenv.adapterWorkDir).
    const adapter = adapterWorkDir(datasetId);
    const args = [path.join(LLAMA_CPP_DIR, "convert_lora_to_gguf.py"), adapter, "--outfile", adapterOutPath(adapterId)];
    // --base: config.json이 든 **베이스 스냅샷 실경로**. 리포지터리 id를 그대로 주면 네트워크를
    //   타려 해 폐쇄망에서 실패한다(1회전에서 실경로로 넘겨 통과시킨 길). 캐시가 없으면
    //   지어내지 말고 여기서 멈춘다 — 사전 점검이 같은 것을 먼저 경고한다.
    const base = hfSnapshotDir(baseModel);
    if (!base) {
      reject(new Error(`베이스 모델 캐시를 찾지 못했습니다(${baseModel}) — 변환에 필요한 config가 없습니다`));
      return;
    }
    args.push("--base", base);
    const python = trainPython(); // 변환도 학습과 같은 환경(gguf 패키지가 거기 있다)
    recordProcessOutput("learnloop-export", "log", `$ ${python} ${args.join(" ")}`);
    // PYTHONUTF8=1: cp949 콘솔에서 한국어/특수문자 로그가 깨지거나 스크립트가 죽는 함정 방지.
    // 에어갭 봉인 시 HF 오프라인 강제(자식 프로세스는 fetch 관문 밖) — 봉인 아니면 무영향.
    const proc = spawn(python, args, { env: { ...process.env, PYTHONUTF8: "1", ...airgapChildEnv() } });
    attachProcessLogging(proc, "learnloop-export");
    let stderrTail = "";
    proc.stderr?.on("data", (d) => {
      stderrTail = (stderrTail + String(d)).slice(-1000);
    });
    proc.on("error", (err) =>
      reject(new Error(/ENOENT/.test(err.message) ? "python을 찾을 수 없습니다" : err.message))
    );
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrTail.trim().split("\n").pop() ?? `export 실패 (code ${code})`));
    });
  });
}

// ── 사전 점검(preflight) ──────────────────────────────────────────────
// 실제 루프 실행 전에 준비물을 확인해 "실행 중간에 실패"하는 고질 문제를 예방한다. GPU를 쓰거나
// 학습을 돌리지 않는 가벼운 검사만 한다(python 임포트 가능 여부는 find_spec으로 — 모듈을 실제로
// 로드하지 않아 빠르다).
export interface PreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean; // false면 경고성(없어도 실행은 됨)
  detail?: string;
  hint?: string;
}

const LLAMA_CPP_DIR = process.env.GIJO_LLAMA_CPP_DIR ?? "llama.cpp";

// HuggingFace 허브 캐시 경로 후보들. HF_HOME > 기본 ~/.cache/huggingface/hub.
// hfHubDirs·isBaseModelCached는 trainenv로 옮겼다 — 학습 경로 해석이 두 벌이면 어긋난다.
export function preflightCheck(): { checks: PreflightCheck[]; ready: boolean } {
  const config = getLearnloopConfig();
  const checks: PreflightCheck[] = [];

  // 1) python — **학습이 실제로 쓸 파이썬**을 본다(2026-08-08 실사고). 예전엔 그냥 `python`을
  //    검사해 서버 자신의 가상환경이 잡혔고, 정작 학습은 다른 환경이 필요해 "준비됨"이 거짓이었다.
  const python = trainPython();
  const py = spawnSync(python, ["--version"], { encoding: "utf-8" });
  const pythonOk = py.status === 0;
  checks.push({
    key: "python",
    label: "학습용 Python",
    ok: pythonOk,
    required: true,
    detail: pythonOk ? `${(py.stdout || py.stderr || "").trim()} · ${python}` : python,
    hint: pythonOk ? undefined : "학습 전용 환경(venv-train)이 필요합니다. 경로를 직접 지정하려면 GIJO_TRAIN_PYTHON.",
  });

  // 2) 학습·변환 파이썬 패키지 — find_spec으로 한 번에 확인(모듈 로드 안 함 = GPU 안 잡음).
  //    ⚠ unsloth는 더 이상 보지 않는다. 지금 학습 스크립트(finetune_qlora14b.py)는 그것 없이
  //    transformers+peft로 돈다 — 없는 것을 요구하면 "설치했는데 또 막힌다"가 된다.
  const deps = pythonOk ? probeTrainDeps(python) : Object.fromEntries(TRAIN_DEPS.map((d) => [d.key, false]));
  for (const d of TRAIN_DEPS) {
    checks.push({
      key: d.key,
      label: d.label,
      ok: !!deps[d.key],
      required: true,
      hint: deps[d.key] ? undefined : `학습 환경에 설치 필요: ${python} -m pip install ${d.key}`,
    });
  }

  // 4·5) llama.cpp 변환 스크립트 + 양자화 실행파일(export_gguf.py와 같은 경로 규칙).
  const convertOk = fs.existsSync(path.join(LLAMA_CPP_DIR, "convert_hf_to_gguf.py"));
  const quantizeOk = fs.existsSync(llamaBinPath("llama-quantize", LLAMA_CPP_DIR));
  checks.push({ key: "llama-convert", label: "llama.cpp 변환 스크립트", ok: convertOk, required: true, hint: convertOk ? undefined : "llama.cpp 클론 필요 (PC세팅 체크리스트 STEP 5)" });
  checks.push({ key: "llama-quantize", label: "llama.cpp 양자화 빌드", ok: quantizeOk, required: true, hint: quantizeOk ? undefined : "llama.cpp를 빌드하세요 (llama-quantize.exe)" });

  // 6) 베이스 모델 가중치 캐시 — 첫 실학습 전 폐쇄망 이전 전에 받아둬야 함.
  const cached = isBaseModelCached(config.baseModel);
  checks.push({
    key: "base-model",
    label: `베이스 모델 캐시 (${config.baseModel})`,
    ok: cached,
    required: true,
    hint: cached ? undefined : `hf download ${config.baseModel}`,
  });

  // 7) 학습 데이터 준비(경고성) — **승인된 문답**이 얼마나 쌓였는지.
  //    ⚠ 예전엔 "아직 학습에 안 쓴 것"만 셌다. 그래서 승인 50건이 있는데도 **0건**으로 보였다
  //    (1회전에서 쓴 표시가 붙어 제외됨 — 2026-08-08 실측). 담당자는 승인을 해도 화면이
  //    0이라 무엇이 문제인지 알 수 없었다. 주제 학습은 어차피 **전체 승인분**을 다시 굽는다
  //    (재학습 정책) — 그러니 세는 것도 승인 총량이어야 뜻이 맞는다.
  const 승인 = db.prepare("SELECT COUNT(*) AS n FROM chat_logs WHERE rating = 1").get() as { n: number };
  const 주제별 = db.prepare(
    "SELECT COALESCE(topic,'(미분류)') AS topic, COUNT(*) AS n FROM chat_logs WHERE rating = 1 GROUP BY COALESCE(topic,'(미분류)') ORDER BY n DESC LIMIT 3"
  ).all() as { topic: string; n: number }[];
  checks.push({
    key: "training-data",
    label: "학습 재료(승인된 문답)",
    ok: 승인.n >= 5,
    required: false,
    detail: `승인 ${승인.n}건` + (주제별.length ? ` · ${주제별.map((t) => `${t.topic} ${t.n}`).join(" · ")}` : ""),
    hint: 승인.n >= 5 ? undefined : "기억학습 후보함에서 좋은 문답을 승인하거나, 기존 데이터셋으로 실행하세요.",
  });

  const ready = checks.every((c) => c.ok || !c.required);
  return { checks, ready };
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetLearnloopForTests(): void {
  assertTestDb("resetLearnloopForTests");
  db.exec("DELETE FROM chat_logs; DELETE FROM learnloop_runs;");
  db.exec("DELETE FROM app_state WHERE key LIKE 'learnloop:%'");
  loopRunning = false;
  currentRun = null;
}

// ── 라우트 ────────────────────────────────────────────────────────────
export function registerLearnloopRoutes(app: Express): void {
  // 주제별 재료 현황 — **전문가 학습을 언제 시작할 수 있나**를 답한다(2026-08-07).
  // 역할(agentId)로는 못 본다: 대화창 지시가 전부 orchestrator로 가서 66%가 한 칸에 쌓인다.
  app.get("/api/learnloop/topics", authMiddleware, (_req, res) => {
    const rows = db.prepare(
      `SELECT COALESCE(topic, '(미분류)') AS topic, COUNT(*) AS total,
              SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS approved
         FROM chat_logs GROUP BY COALESCE(topic, '(미분류)') ORDER BY total DESC`
    ).all() as { topic: string; total: number; approved: number }[];
    // 전문가 LoRA는 승인된 좋은 문답 기준이다(LIMA — 수작업 수천이 기계생성 수만을 이긴다).
    // 학습 시작 게이트(startLearnloopRun)와 같은 상수를 봐야 "준비됨"과 "시작 가능"이 안 어긋난다.
    res.json({
      목표승인건수: TOPIC_TRAIN_TARGET,
      주제: rows.map((r) => ({ ...r, 준비됨: r.approved >= TOPIC_TRAIN_TARGET, 남은건수: Math.max(0, TOPIC_TRAIN_TARGET - r.approved) })),
    });
  });

  app.get("/api/learnloop/logs", authMiddleware, (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const offset = Number(req.query.offset ?? 0) || 0;
    res.json(listChatLogs(limit, offset));
  });

  app.post("/api/learnloop/logs/:id/rate", authMiddleware, (req, res) => {
    const rating = Number(req.body?.rating);
    if (![1, -1, 0].includes(rating)) {
      res.status(400).json({ error: "rating은 1(긍정), -1(부정), 0(평가 해제)만 가능합니다" });
      return;
    }
    try {
      // approverId — 겹 1이 반입 문서의 열람 등급을 승인자 등급으로 잠근다(등급 세탁 방지).
      const approverId = (req as typeof req & { user?: { id?: string } }).user?.id ?? null;
      res.json(rateChatLog(String(req.params.id), rating as 1 | -1 | 0, approverId));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/learnloop/logs/:id", authMiddleware, (req, res) => {
    try {
      deleteChatLog(String(req.params.id));
      recordAudit({ kind: "write", action: "학습 대화기록 삭제", target: String(req.params.id), actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(
    "/api/learnloop/build-dataset",
    authMiddleware,
    asyncRoute(async (req, res) => {
      try {
        res.json(await buildDatasetFromLogs({ includeUnrated: !!req.body?.includeUnrated, topic: req.body?.topic }));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  app.post(
    "/api/learnloop/run",
    authMiddleware,
    asyncRoute(async (req, res) => {
      try {
        // topic: 주제별 전문가 학습(승인 300 게이트) · force: 미달 강행(관리자 실험용 — 감사에 남김)
        if (req.body?.force) {
          recordAudit({
            kind: "config",
            actor: (req as Request & { user?: GijoUser }).user?.displayName ?? "(알 수 없음)",
            action: "학습 개시선 미달 강행",
            target: String(req.body?.topic ?? "(전체)"),
            result: "ok",
          });
        }
        const run = await startLearnloopRun({ datasetId: req.body?.datasetId, topic: req.body?.topic, force: !!req.body?.force });
        res.status(202).json(run);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(/진행 중/.test(message) ? 409 : 400).json({ error: message });
      }
    })
  );

  app.get("/api/learnloop/preflight", authMiddleware, (_req, res) => res.json(preflightCheck()));

  app.get("/api/learnloop/status", authMiddleware, (_req, res) => res.json(getLearnloopStatus()));
  app.get("/api/learnloop/runs", authMiddleware, (_req, res) => res.json(listLearnloopRuns()));

  app.get("/api/learnloop/config", authMiddleware, (_req, res) => res.json(getLearnloopConfig()));
  app.put("/api/learnloop/config", authMiddleware, (req, res) => {
    try {
      res.json(putLearnloopConfig(req.body ?? {}));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * ★ 추론 층(llm)에 대화 수집기를 꽂는다 — app.ts가 부팅 때 한 번 호출한다(2026-08-29 화살 #15).
 *
 * 그전에는 llm.ts가 recordChatLog를 **직접** 물었다. 그런데 이 파일은 학습 쪽에서 dataset을
 * 부르고 dataset은 llm을 물어 **llm → learnloop → dataset → llm** 고리가 됐다.
 * 방향을 뒤집으면 추론 층은 「누가 모으는지」를 모른다 — 수집기가 지켜보는 쪽이다.
 * ⚠ 등록이 빠지면 대화 수집이 **조용히 멈춘다**(학습 후보가 안 쌓임) — 짝 시험이 못 박는다.
 */
export function 대화수집_배선(): void {
  onChatRecorded((agentId, question, answer) => recordChatLog(agentId, question, answer));
}
