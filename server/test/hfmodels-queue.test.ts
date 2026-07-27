import { describe, it, expect } from "vitest";
import type { WebSocketServer } from "ws";
import {
  attachHfModelsSocket,
  enqueueHfDownload,
  getHfDownloadJob,
  listHfDownloadJobs,
  HfDownloadJob,
} from "../src/engine/hfmodels";

// finetune.test.ts와 같은 패턴: 진짜 잡을 돌리고(모킹 없이) WebSocket 브로드캐스트를 가짜 클라이언트로 수집한다.
function fakeWss(collected: HfDownloadJob[]): WebSocketServer {
  return {
    clients: new Set([
      {
        readyState: 1,
        send: (raw: string) => collected.push(JSON.parse(raw).payload as HfDownloadJob),
      },
    ]),
  } as unknown as WebSocketServer;
}

function waitUntil(cond: () => boolean, timeoutMs = 20000): Promise<void> {
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

describe("hfmodels 다운로드 큐 — 백그라운드 처리 + 진행률 브로드캐스트", () => {
  it("POST 큐잉은 즉시 끝나고, 존재하지 않는 저장소는 백그라운드에서 error로 끝난다", async () => {
    const collected: HfDownloadJob[] = [];
    attachHfModelsSocket(fakeWss(collected));

    const modelId = "gijo-as-test/definitely-does-not-exist-" + Date.now();
    const job = enqueueHfDownload(modelId);
    // enqueue 자체는 네트워크/다운로드를 기다리지 않고 바로 돌아온다(동기 호출).
    // processQueue()는 첫 await(네트워크 fetch) 직전까지 동기로 실행되므로, 큐가 비어 있던
    // 첫 잡은 이 시점에 이미 downloading으로 전이돼 있다 — queued로 보이는 건 앞선 잡이 있을 때뿐.
    expect(job.status).toBe("downloading");
    expect(job.modelId).toBe(modelId);
    expect(getHfDownloadJob(job.id)).toBe(job);
    expect(listHfDownloadJobs().some((j) => j.id === job.id)).toBe(true);

    await waitUntil(() => getHfDownloadJob(job.id)?.status === "error");

    const final = getHfDownloadJob(job.id)!;
    expect(final.status).toBe("error");
    // 문구를 'GGUF'로 못박지 않는다(2026-07-28): HF는 없는 저장소에 401을 주므로 인터넷이
    // 닿을 때는 "저장소를 볼 수 없습니다", 닿지 않을 때는 "받을 .gguf 파일을 찾지 못했습니다"가
    // 나온다. 둘 다 담당자가 저장소를 다시 보게 만드는 안내라는 점이 이 시험의 핵심이다.
    expect(final.error).toMatch(/저장소/);

    // 큐 처리 과정이 WebSocket으로 순서대로 브로드캐스트됐는지(queued -> downloading -> error)
    const statuses = collected.filter((j) => j.id === job.id).map((j) => j.status);
    expect(statuses).toContain("queued");
    expect(statuses).toContain("downloading");
    expect(statuses[statuses.length - 1]).toBe("error");
  });

  it("여러 잡을 연달아 큐에 넣으면 순차 처리되고 둘 다 종료 상태에 도달한다", async () => {
    const a = enqueueHfDownload("gijo-as-test/no-such-a-" + Date.now());
    const b = enqueueHfDownload("gijo-as-test/no-such-b-" + Date.now());

    await waitUntil(
      () => getHfDownloadJob(a.id)?.status === "error" && getHfDownloadJob(b.id)?.status === "error",
      20000
    );

    expect(getHfDownloadJob(a.id)?.status).toBe("error");
    expect(getHfDownloadJob(b.id)?.status).toBe("error");
  });

  it("존재하지 않는 잡 id는 undefined", () => {
    expect(getHfDownloadJob("no-such-job")).toBeUndefined();
  });
});
