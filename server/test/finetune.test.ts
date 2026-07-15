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
