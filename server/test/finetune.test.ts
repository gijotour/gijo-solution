import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import type { WebSocketServer } from "ws";
import { attachFinetuneSocket, startFinetune, isFinetuneRunning, FinetuneProgress } from "../src/engine/finetune";

// Python이 없으면 이 파일 전체를 조용히 skip한다 (modelscan-wrapper.test.ts와 같은 패턴).
const PYTHON = process.env.GIJO_TEST_PYTHON ?? "python";
function pythonAvailable(): boolean {
  return spawnSync(PYTHON, ["--version"]).status === 0;
}

const DATASET_ID = `vitest-ft-${Date.now().toString(36)}`;
const DATASET_PATH = `data/datasets/${DATASET_ID}.json`;

// finetune.ts의 broadcastProgress가 보내는 페이로드를 가짜 WebSocketServer로 수집한다.
function fakeWss(collected: FinetuneProgress[]): WebSocketServer {
  return {
    clients: new Set([
      {
        readyState: 1,
        send: (raw: string) => collected.push(JSON.parse(raw).payload as FinetuneProgress),
      },
    ]),
  } as unknown as WebSocketServer;
}

function waitUntil(cond: () => boolean, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (cond()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("waitUntil timeout"));
      }
    }, 50);
  });
}

describe.runIf(pythonAvailable())("finetune pipeline (real python, --smoke)", () => {
  beforeAll(() => {
    fs.mkdirSync("data/datasets", { recursive: true });
    fs.writeFileSync(DATASET_PATH, JSON.stringify([{ question: "q", answer: "a" }]), "utf-8");
    process.env.GIJO_FINETUNE_SMOKE = "1";
  });

  afterAll(() => {
    fs.rmSync(DATASET_PATH, { force: true });
    delete process.env.GIJO_FINETUNE_SMOKE;
  });

  it("streams parsed progress and finishes with status=done", async () => {
    const collected: FinetuneProgress[] = [];
    attachFinetuneSocket(fakeWss(collected));

    const result = startFinetune({ agentId: "analysis", datasetId: DATASET_ID });
    expect(result.started).toBe(true);
    expect(isFinetuneRunning()).toBe(true);
    // 동시 실행 거부
    expect(startFinetune({ agentId: "analysis", datasetId: DATASET_ID }).started).toBe(false);

    await waitUntil(() => collected.some((p) => p.status === "done" || p.status === "error"));

    const final = collected[collected.length - 1];
    expect(final.status).toBe("done");
    expect(isFinetuneRunning()).toBe(false);
    // smoke는 10스텝 시뮬레이션 — 진행률이 실제로 흘렀는지
    const steps = collected.filter((p) => p.status === "running" && p.step > 0);
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps[steps.length - 1].maxSteps).toBe(10);
    expect(steps[0].loss).toBeGreaterThan(0);
  });

  it("a nonexistent dataset ends with status=error carrying the script's message", async () => {
    const collected: FinetuneProgress[] = [];
    attachFinetuneSocket(fakeWss(collected));

    expect(startFinetune({ agentId: "analysis", datasetId: "no-such-dataset" }).started).toBe(true);
    await waitUntil(() => collected.some((p) => p.status === "done" || p.status === "error"));

    const final = collected[collected.length - 1];
    expect(final.status).toBe("error");
    expect(final.message).toContain("데이터셋");
  });

  it("rejects a start without datasetId", () => {
    expect(startFinetune({ agentId: "analysis", datasetId: "" }).started).toBe(false);
  });

});

// ★ RAFT형 재료(근거가 system에 실린 행)는 길다 — 실측 p95 1,481토큰(방해 1개)·1,985(방해 2개).
//   파이썬 기본 max_seq는 1024라, 제품 경로가 값을 안 넘기면 그 행들이 render()에서 **조용히 버려진다**
//   (학습은 정상 종료되고 「사용 N쌍」만 줄어든다 — 재료가 반쯤 사라져도 아무도 모른다).
//
// ⚠ **위 describe 밖에 둔다.** 저 블록은 `python`이 있는 기계에서만 돈다(WSL에는 python3뿐이라 통째로 skip).
//   그런데 이 계약은 파이썬이 없어도 확인할 수 있다 — finetune.ts가 스폰 **직후** 명령줄을 기록에 남기고,
//   실행 파일이 없으면 그 뒤에 ENOENT로 끝날 뿐이기 때문이다. 안에 뒀다면 운영 환경(WSL)에서
//   **늘 건너뛰는 시험**이 됐을 것이다 — 초록이 뜨지만 아무것도 증명하지 않는 그 상태.
describe("학습 스폰 인자 — 최대 길이를 제품 경로가 명시한다", () => {
  beforeAll(() => {
    fs.mkdirSync("data/datasets", { recursive: true });
    fs.writeFileSync(DATASET_PATH, JSON.stringify([{ question: "q", answer: "a" }]), "utf-8");
    process.env.GIJO_FINETUNE_SMOKE = "1"; // 엔진 정지(GPU 독점)를 하지 않게 — 시험이 운영 자원을 만지면 안 된다
  });
  afterAll(() => {
    fs.rmSync(DATASET_PATH, { force: true });
    delete process.env.GIJO_FINETUNE_SMOKE;
    delete process.env.GIJO_FINETUNE_MAX_SEQ;
  });

  it("★ 학습 스폰이 --max-seq를 실제로 넘긴다 (기본 3072 · env로 조절)", async () => {
    const { listLogs, resetLogsForTests } = await import("../src/engine/logs");
    const 명령줄 = async (env?: string) => {
      resetLogsForTests();
      if (env) process.env.GIJO_FINETUNE_MAX_SEQ = env;
      else delete process.env.GIJO_FINETUNE_MAX_SEQ;
      const collected: FinetuneProgress[] = [];
      attachFinetuneSocket(fakeWss(collected));
      expect(startFinetune({ agentId: "analysis", datasetId: DATASET_ID, manageEngines: false }).started).toBe(true);
      // 파이썬이 없으면 error로, 있으면 done으로 끝난다 — 어느 쪽이든 명령줄은 이미 기록됐다.
      await waitUntil(() => collected.some((p) => p.status === "done" || p.status === "error"));
      const 줄 = listLogs().map((l) => l.message).find((m) => m.includes("finetune_qlora14b.py"));
      expect(줄, "스폰 명령줄이 기록에 안 남았다 — 이 시험이 헛돈다").toBeTruthy();
      return String(줄);
    };
    expect(await 명령줄()).toContain("--max-seq 3072");
    expect(await 명령줄("2048")).toContain("--max-seq 2048");
  });
});
