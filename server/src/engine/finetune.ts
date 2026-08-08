// engine/finetune.ts — QLoRA 파인튜닝 파이프라인 (Unsloth 기반, 6.2절 ③단계)
// 진행률은 WebSocket으로 브로드캐스트한다 (finetune:progress).

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { spawn } from "child_process";
import { authMiddleware } from "../auth/auth";
import { recordProcessOutput } from "./logs";
import { pauseInferenceEngines, resumeInferenceEngines } from "./localengine";
import { airgapChildEnv } from "./airgap";

export interface FinetuneArgs {
  agentId: string;
  datasetId: string;
  // 학습 베이스 모델(HF repo id). 지정 시 GIJO_FT_BASE_MODEL 환경변수로 스크립트에 전달 —
  // 학습 루프(learnloop.ts)가 설정된 베이스(예: Qwen3-14B)를 주입하는 경로.
  baseModel?: string;
  // 종료 콜백(성공/실패 공통) — 학습 루프가 다음 단계(GGUF export)로 이어가기 위해 쓴다.
  // 폴링 대신 콜백인 이유: exit/error 어느 쪽으로 끝나든 정확히 한 번 호출된다.
  onComplete?: (result: { ok: boolean; message?: string }) => void;
  // 기본 true — 학습 전 추론 엔진(llama-server 풀+임베딩)을 내려 GPU를 비우고 끝나면 되돌린다.
  // learnloop.ts는 export(병합)까지 더 넓은 구간을 직접 관리하므로 false로 넘겨 이중 정지를 막는다.
  manageEngines?: boolean;
}

export interface FinetuneProgress {
  step: number;
  maxSteps: number;
  loss: number;
  status: "running" | "done" | "error";
  message?: string;
}

let wss: WebSocketServer | null = null;
export function attachFinetuneSocket(server: WebSocketServer): void {
  wss = server;
}

function broadcastProgress(progress: FinetuneProgress): void {
  wss?.clients.forEach((client) => {
    if (client.readyState === 1) client.send(JSON.stringify({ channel: "finetune:progress", payload: progress }));
  });
}

// GPU 1대(RTX 3090)가 학습을 독점하므로 동시 실행은 막는다.
let running = false;
let lastProgress: FinetuneProgress | null = null;

export function isFinetuneRunning(): boolean {
  return running;
}

// 엔진 관리 여부: 명시적으로 false면 끄고, 스모크(테스트/CI)에서는 실제 엔진이 없으므로 항상 끈다.
function shouldManageEngines(args: FinetuneArgs): boolean {
  return args.manageEngines !== false && process.env.GIJO_FINETUNE_SMOKE !== "1";
}

export function startFinetune(args: FinetuneArgs): { started: boolean; error?: string } {
  if (running) return { started: false, error: "이미 파인튜닝이 진행 중입니다" };
  if (!args.datasetId) return { started: false, error: "datasetId가 필요합니다" };

  // running을 동기적으로 세워 두 번째 요청이 즉시 거부되게 한다(엔진 정지는 비동기라 그 사이 경합 방지).
  running = true;
  lastProgress = { step: 0, maxSteps: 0, loss: 0, status: "running" };
  void runFinetuneJob(args);
  return { started: true };
}

// 학습 전 추론 엔진을 내려 GPU를 비우고(고질적 학습·추론 VRAM 충돌 방지), 프로세스가 끝나면
// 성공/실패와 무관하게 엔진을 되돌린다(finally) — 학습이 실패해도 추론이 죽은 채 남지 않는다.
async function runFinetuneJob(args: FinetuneArgs): Promise<void> {
  const manage = shouldManageEngines(args);
  try {
    if (manage) {
      recordProcessOutput("finetune", "log", "추론 엔진 일시 정지 — GPU(VRAM) 확보 (학습 중 채팅/RAG 불가)");
      await pauseInferenceEngines();
    }
    await spawnTraining(args);
  } catch (err) {
    // 여기 오는 건 엔진 정지 실패뿐(학습 프로세스 실패는 spawnTraining 내부에서 종결한다).
    running = false;
    const message = `엔진 정지 실패: ${err instanceof Error ? err.message : String(err)}`;
    lastProgress = { ...(lastProgress ?? { step: 0, maxSteps: 0, loss: 0 }), status: "error", message };
    broadcastProgress(lastProgress);
    args.onComplete?.({ ok: false, message });
  } finally {
    if (manage) {
      recordProcessOutput("finetune", "log", "추론 엔진 재기동 (학습 종료)");
      await resumeInferenceEngines().catch((err) =>
        console.error("[finetune] 엔진 재기동 실패 — 에이전트 AI 화면에서 수동 기동 필요:", err)
      );
    }
  }
}

// 파이썬 학습 프로세스를 스폰하고 종료(exit/error)될 때까지 기다린다. 진행률 파싱·종결 처리는
// 여기서 하고, Promise는 프로세스가 끝난 뒤 resolve된다(reject하지 않음 — 실패도 정상 종결로 취급).
function spawnTraining(args: FinetuneArgs): Promise<void> {
  return new Promise<void>((resolve) => {
    const scriptArgs = ["scripts/finetune_unsloth.py", "--dataset", args.datasetId];
    // 테스트/CI 전용: GPU·unsloth 없이 파이프라인 계약만 검증
    if (process.env.GIJO_FINETUNE_SMOKE === "1") scriptArgs.push("--smoke");

    // PYTHONUTF8=1: Windows 기본 콘솔 코드페이지(cp949)로는 한국어 로그가 파이프에서 깨지고
    // em-dash 같은 문자는 UnicodeEncodeError로 스크립트를 죽인다 (modelscan_wrapper와 같은 함정).
    const proc = spawn("python", scriptArgs, {
      // 에어갭 봉인 시 HF 오프라인 강제(자식 프로세스는 fetch 관문 밖) — 봉인 아니면 무영향.
      env: { ...process.env, PYTHONUTF8: "1", ...(args.baseModel ? { GIJO_FT_BASE_MODEL: args.baseModel } : {}), ...airgapChildEnv() },
    });
    let stderrTail = "";
    let settled = false;

    recordProcessOutput("finetune", "log", `$ python ${scriptArgs.join(" ")}`);
    proc.stdout.on("data", (chunk: Buffer) => {
      recordProcessOutput("finetune", "log", chunk.toString());
      for (const line of chunk.toString().split("\n")) {
        const match = /step\s+(\d+)\/(\d+)\s+loss=([\d.]+)/.exec(line);
        if (match) {
          lastProgress = { step: Number(match[1]), maxSteps: Number(match[2]), loss: Number(match[3]), status: "running" };
          broadcastProgress(lastProgress);
        }
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      recordProcessOutput("finetune", "warn", chunk.toString());
    });
    proc.on("error", (err) => {
      // python 자체가 없을 때 등 — exit 이벤트가 안 올 수 있으므로 여기서 종결한다
      if (settled) return;
      settled = true;
      running = false;
      lastProgress = { ...(lastProgress ?? { step: 0, maxSteps: 0, loss: 0 }), status: "error", message: String(err.message) };
      broadcastProgress(lastProgress);
      args.onComplete?.({ ok: false, message: String(err.message) });
      resolve();
    });
    proc.on("exit", (code) => {
      if (settled) return; // error 핸들러가 이미 종결한 경우
      settled = true;
      running = false;
      const message = code === 0 ? undefined : stderrTail.trim().split("\n").pop();
      lastProgress = { ...(lastProgress ?? { step: 0, maxSteps: 0, loss: 0 }), status: code === 0 ? "done" : "error", message };
      broadcastProgress(lastProgress);
      args.onComplete?.({ ok: code === 0, message });
      resolve();
    });
  });
}

export function registerFinetuneRoutes(app: Express): void {
  app.post("/api/finetune/start", authMiddleware, (req, res) => {
    // 단독 학습 라우트는 항상 엔진을 관리한다(추론과의 GPU 충돌 방지) — 클라이언트 body의
    // manageEngines/onComplete 등은 받지 않고 필요한 필드만 명시적으로 전달한다.
    const { agentId, datasetId, baseModel } = req.body ?? {};
    const result = startFinetune({ agentId, datasetId, baseModel });
    if (!result.started) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ started: true });
  });
  app.get("/api/finetune/status", authMiddleware, (_req, res) => {
    res.json({ running, lastProgress });
  });
}
