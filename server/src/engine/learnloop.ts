// engine/learnloop.ts — 헤르메스 폐쇄형 학습 루프 (수집 → 정제 → 학습 → 배포)
//
// 사용 데이터가 폐쇄망 밖으로 나가지 않는 자가학습 사이클의 오케스트레이터:
//  ① 수집: llm.ts chat()의 remember:true 경로에서 실제 대화(질문/답변)를 chat_logs에 영속 저장.
//  ② 정제: 담당자가 👍/👎로 평가한 로그 중 긍정만 골라 데이터셋(data/datasets/loop-*.json)으로.
//  ③ 학습: finetune.ts(QLoRA, Unsloth)에 설정된 베이스 모델(기본 Hermes 3)을 주입해 실행.
//  ④ 배포: 고아 스크립트였던 scripts/export_gguf.py를 호출해 LoRA→병합→GGUF→models/ 배치 후
//     대상 에이전트에 자동 할당 — 기존에 끊겨 있던 "학습 산출물→서빙" 연결(고질 문제)을 잇는다.
//
// GPU 1대(RTX 3090) 전제: 파이프라인 시작 시 추론 llama-server 풀·임베딩 서버를 내리고(학습·병합이
// VRAM을 독점), 성공/실패와 무관하게 finally에서 재기동한다 — 실패해도 추론이 죽은 채 남지 않는다.
//
// 순환 import 주의: llm.ts가 이 모듈을 정적 import한다. 따라서 이 모듈은 llm.ts를 import하는
// dataset.ts를 정적으로 불러오면 안 된다(llm→learnloop→dataset→llm 순환) — saveDataset은
// buildDatasetFromLogs() 안에서 동적 import한다(memory.ts의 dataset 동적 import와 같은 선례).

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { llamaBinPath } from "../util/llamabin";
import { db, assertTestDb } from "../db";
import { startFinetune, isFinetuneRunning } from "./finetune";
import { pauseInferenceEngines, resumeInferenceEngines } from "./localengine";
import { setAgentModel, getAgentById } from "./agents";
import { attachProcessLogging, recordProcessOutput } from "./logs";

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
}

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
  outputModelId: string;
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
const insertLogStmt = db.prepare(
  "INSERT INTO chat_logs (id, agentId, question, answer, rating, usedInDataset, createdAt) VALUES (@id, @agentId, @question, @answer, NULL, 0, @createdAt)"
);
const listLogsStmt = db.prepare("SELECT * FROM chat_logs ORDER BY createdAt DESC LIMIT ? OFFSET ?");
const logKpiStmt = db.prepare(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS positive,
          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) AS negative,
          SUM(CASE WHEN usedInDataset = 0 AND (rating = 1 OR rating IS NULL) THEN 1 ELSE 0 END) AS unused
   FROM chat_logs`
);
const getLogStmt = db.prepare("SELECT * FROM chat_logs WHERE id = ?");
const rateLogStmt = db.prepare("UPDATE chat_logs SET rating = ? WHERE id = ?");
const deleteLogStmt = db.prepare("DELETE FROM chat_logs WHERE id = ?");
const pickLogsStmt = db.prepare(
  "SELECT * FROM chat_logs WHERE usedInDataset = 0 AND rating = 1 ORDER BY createdAt ASC"
);
const pickLogsWithUnratedStmt = db.prepare(
  "SELECT * FROM chat_logs WHERE usedInDataset = 0 AND (rating = 1 OR rating IS NULL) ORDER BY createdAt ASC"
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

const insertRunStmt = db.prepare(
  "INSERT INTO learnloop_runs (id, datasetId, baseModel, outputModelId, stage, error, startedAt, finishedAt) VALUES (@id, @datasetId, @baseModel, @outputModelId, @stage, NULL, @startedAt, NULL)"
);
const updateRunStmt = db.prepare("UPDATE learnloop_runs SET stage = ?, error = ?, finishedAt = ? WHERE id = ?");
const listRunsStmt = db.prepare("SELECT * FROM learnloop_runs ORDER BY startedAt DESC LIMIT 20");
const staleRunsStmt = db.prepare("UPDATE learnloop_runs SET stage = 'error', error = ?, finishedAt = ? WHERE stage NOT IN ('done','error')");

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

interface ChatLogRow {
  id: string;
  agentId: string;
  question: string;
  answer: string;
  rating: number | null;
  usedInDataset: number;
  createdAt: number;
}

interface RunRow {
  id: string;
  datasetId: string;
  baseModel: string;
  outputModelId: string;
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
});

const runFromRow = (r: RunRow): LearnloopRun => ({
  id: r.id,
  datasetId: r.datasetId,
  baseModel: r.baseModel,
  outputModelId: r.outputModelId,
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
const DEFAULT_CONFIG: LearnloopConfig = {
  autoCollect: true,
  baseModel: "NousResearch/Hermes-3-Llama-3.1-8B",
  modelPrefix: "hermes-sec-tuned",
  targetAgent: "model-evolution",
};

// 산출 모델 id는 <prefix>-v<N> — export_gguf.py의 규칙(^[a-z0-9][a-z0-9.-]{0,63}$)에 맞아야 한다.
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
    throw new Error("모델 접두어는 영문 소문자/숫자/하이픈 41자 이내여야 합니다 (예: hermes-sec-tuned)");
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
export function pruneChatLogs(cap = CHATLOG_MAX): number {
  const total = (countLogsStmt.get() as { n: number }).n;
  let over = total - cap;
  if (over <= 0) return 0;
  let removed = pruneSafeLogsStmt.run(over).changes;
  over -= removed;
  if (over > 0) removed += pruneOldestLogsStmt.run(over).changes;
  if (removed > 0) {
    console.warn(`[learnloop] 수집 로그 보존 상한(${cap}) 초과 — 오래된 ${removed}건 정리`);
  }
  return removed;
}

// ── ① 수집 ────────────────────────────────────────────────────────────
// llm.ts chat()의 remember:true 경로에서 호출된다. 캡처 실패가 채팅 응답을 죽이면 안 되므로
// 전체를 try/catch로 감싼다. autoCollect가 꺼져 있으면 조용히 무시.
export function recordChatLog(agentId: string, question: string, answer: string): void {
  try {
    if (!getLearnloopConfig().autoCollect) return;
    if (!question.trim() || !answer.trim()) return;
    insertLogStmt.run({
      id: "cl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      agentId,
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

export function rateChatLog(id: string, rating: 1 | -1 | 0): ChatLog {
  const row = getLogStmt.get(id) as ChatLogRow | undefined;
  if (!row) throw new Error("존재하지 않는 대화 로그입니다");
  rateLogStmt.run(rating === 0 ? null : rating, id);
  return logFromRow(getLogStmt.get(id) as ChatLogRow);
}

export function deleteChatLog(id: string): void {
  if (!(getLogStmt.get(id) as ChatLogRow | undefined)) throw new Error("존재하지 않는 대화 로그입니다");
  deleteLogStmt.run(id);
}

// ── ② 정제 → 데이터셋 ────────────────────────────────────────────────
// 긍정 평가(옵션: +미평가) 미사용 로그를 {question,answer}[]로 변환해 저장한다 — 이미 Q&A 쌍이라
// LLM 재변환이 필요 없다. 저장 성공 후 같은 트랜잭션에서 usedInDataset=1 마킹.
export async function buildDatasetFromLogs(opts: { includeUnrated?: boolean; minExamples?: number } = {}): Promise<{ datasetId: string; examples: number }> {
  const minExamples = opts.minExamples ?? 5;
  const rows = (opts.includeUnrated ? pickLogsWithUnratedStmt.all() : pickLogsStmt.all()) as ChatLogRow[];
  if (rows.length < minExamples) {
    throw new Error(
      `학습에 쓸 로그가 부족합니다 (현재 ${rows.length}건, 최소 ${minExamples}건). 대화를 더 수집하고 👍 평가를 남겨주세요.`
    );
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const datasetId = `loop-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // dataset.ts는 llm.ts를 import하므로 정적 import 시 순환(llm→learnloop→dataset→llm) — 동적 import.
  const { saveDataset } = await import("./dataset.js");
  const result = saveDataset(datasetId, rows.map((r) => ({ question: r.question, answer: r.answer })));

  const markAll = db.transaction((ids: string[]) => {
    for (const id of ids) markUsedStmt.run(id);
  });
  markAll(rows.map((r) => r.id));
  return { datasetId: result.id, examples: result.examples };
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

export async function startLearnloopRun(opts: { datasetId?: string } = {}): Promise<LearnloopRun> {
  if (loopRunning) throw new Error("이미 학습 루프가 진행 중입니다");
  if (isFinetuneRunning()) throw new Error("파인튜닝이 이미 진행 중입니다 — 끝난 뒤 다시 시도하세요");

  const config = getLearnloopConfig();
  // datasetId가 없으면 수집 로그로 즉석 데이터셋을 만든다(원클릭 루프).
  const datasetId = opts.datasetId ?? (await buildDatasetFromLogs()).datasetId;
  const outputModelId = nextOutputModelId(config.modelPrefix);

  const run: LearnloopRun = {
    id: "run" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    datasetId,
    baseModel: config.baseModel,
    outputModelId,
    stage: "stopping-engines",
    startedAt: Date.now(),
  };
  insertRunStmt.run({ ...run });
  loopRunning = true;
  currentRun = run;
  broadcastRun(run);

  void runPipeline(run, config).finally(() => {
    loopRunning = false;
  });
  return run;
}

// 스모크 모드에서도 단계 전이가 비동기로 관찰되도록 한 박자 쉰다 — 이게 없으면 async 함수가
// 첫 await 없이 동기로 완주해 202 응답 전에 이미 done이 돼버린다(전이 브로드캐스트도 못 봄).
const smokeTick = () => new Promise<void>((r) => setTimeout(r, 25));

async function runPipeline(run: LearnloopRun, config: LearnloopConfig): Promise<void> {
  let failure: string | null = null;
  try {
    // (1) 추론 엔진 정지 — 학습·병합이 GPU(VRAM)를 독점해야 한다. 진행 중 채팅/RAG은 일시 불가.
    if (SMOKE()) await smokeTick();
    else await pauseInferenceEngines();

    // (2) QLoRA 학습 — 설정된 베이스 모델(Hermes 3 기본)을 주입.
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

    // (3) GGUF 변환·배치 — 고아였던 export_gguf.py를 여기서 호출해 루프를 닫는다.
    setStage(run, "exporting");
    if (SMOKE()) await smokeTick();
    else {
      await runExport(run.datasetId, run.outputModelId);
    }

    // (4) 대상 에이전트에 새 모델 할당 — models/ live 스캔이라 서버 재시작 불필요.
    // 스모크에선 실제 gguf 파일이 없어 setAgentModel이 "배치되지 않은 모델"로 거부하므로 생략.
    setStage(run, "deploying");
    if (SMOKE()) await smokeTick();
    else {
      setAgentModel(config.targetAgent, run.outputModelId);
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

// scripts/export_gguf.py 실행 — stdout/stderr는 로그 화면(learnloop-export 소스)으로 흘린다.
function runExport(datasetId: string, outputModelId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const adapter = path.join("outputs", datasetId, "lora-adapter");
    const args = ["scripts/export_gguf.py", "--adapter", adapter, "--model-id", outputModelId];
    recordProcessOutput("learnloop-export", "log", `$ python ${args.join(" ")}`);
    // PYTHONUTF8=1: cp949 콘솔에서 한국어/특수문자 로그가 깨지거나 스크립트가 죽는 함정 방지.
    const proc = spawn("python", args, { env: { ...process.env, PYTHONUTF8: "1" } });
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
function hfHubDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.HF_HUB_CACHE) dirs.push(process.env.HF_HUB_CACHE);
  if (process.env.HF_HOME) dirs.push(path.join(process.env.HF_HOME, "hub"));
  dirs.push(path.join(os.homedir(), ".cache", "huggingface", "hub"));
  return dirs;
}

// baseModel(HF repo id)의 fp16 가중치가 허브 캐시에 받아져 있는지 — 폐쇄망 이전 전 선행 다운로드 확인.
function isBaseModelCached(baseModel: string): boolean {
  const cacheName = "models--" + baseModel.replace(/\//g, "--");
  return hfHubDirs().some((hub) => {
    const dir = path.join(hub, cacheName);
    // 스냅샷 폴더에 실제 파일이 있어야 "받아짐"으로 본다(빈 디렉터리 방어).
    const snap = path.join(dir, "snapshots");
    return fs.existsSync(snap) && fs.readdirSync(snap).length > 0;
  });
}

export function preflightCheck(): { checks: PreflightCheck[]; ready: boolean } {
  const config = getLearnloopConfig();
  const checks: PreflightCheck[] = [];

  // 1) python
  const py = spawnSync("python", ["--version"], { encoding: "utf-8" });
  const pythonOk = py.status === 0;
  checks.push({
    key: "python",
    label: "Python 실행 가능",
    ok: pythonOk,
    required: true,
    detail: pythonOk ? (py.stdout || py.stderr || "").trim() : undefined,
    hint: pythonOk ? undefined : "GPU 머신에 Python이 설치돼 있어야 합니다.",
  });

  // 2·3) 학습(unsloth)·변환(gguf) 파이썬 패키지 — find_spec으로 한 번에 확인(모듈 로드 안 함).
  let unsloth = false;
  let gguf = false;
  if (pythonOk) {
    const probe = spawnSync(
      "python",
      ["-c", "import importlib.util as u,json;print(json.dumps({'unsloth':u.find_spec('unsloth') is not None,'gguf':u.find_spec('gguf') is not None}))"],
      { encoding: "utf-8" }
    );
    try {
      const parsed = JSON.parse((probe.stdout || "").trim());
      unsloth = !!parsed.unsloth;
      gguf = !!parsed.gguf;
    } catch {
      /* 파싱 실패 시 둘 다 false 유지 */
    }
  }
  checks.push({ key: "unsloth", label: "unsloth (QLoRA 학습)", ok: unsloth, required: true, hint: unsloth ? undefined : "pip install unsloth" });
  checks.push({ key: "gguf", label: "gguf 패키지 (GGUF 변환)", ok: gguf, required: true, hint: gguf ? undefined : "pip install gguf" });

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

  // 7) 학습 데이터 준비(경고성) — 👍/미평가 미사용 로그가 최소치 이상인지.
  const unused = (pickLogsStmt.all() as ChatLogRow[]).length;
  checks.push({
    key: "training-data",
    label: "학습 데이터(👍 대화)",
    ok: unused >= 5,
    required: false,
    detail: `현재 ${unused}건`,
    hint: unused >= 5 ? undefined : "대화를 더 수집하고 👍를 남기거나, 기존 데이터셋으로 실행하세요.",
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
      res.json(rateChatLog(String(req.params.id), rating as 1 | -1 | 0));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/learnloop/logs/:id", authMiddleware, (req, res) => {
    try {
      deleteChatLog(String(req.params.id));
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
        res.json(await buildDatasetFromLogs({ includeUnrated: !!req.body?.includeUnrated }));
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
        const run = await startLearnloopRun({ datasetId: req.body?.datasetId });
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
