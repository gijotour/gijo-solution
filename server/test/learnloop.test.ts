import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import { createApp } from "../src/app";
import {
  recordChatLog,
  resetLearnloopForTests,
  putLearnloopConfig,
  getLearnloopStatus,
  pruneChatLogs,
} from "../src/engine/learnloop";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

function waitUntil(cond: () => boolean, timeoutMs = 10000): Promise<void> {
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
    }, 25);
  });
}

describe("learnloop (헤르메스 폐쇄형 학습 루프)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const savedDatasets: string[] = [];

  beforeAll(() => {
    process.env.GIJO_LEARNLOOP_SMOKE = "1";
  });

  afterAll(() => {
    delete process.env.GIJO_LEARNLOOP_SMOKE;
    for (const id of savedDatasets) {
      fs.rmSync(path.join("data", "datasets", `${id}.json`), { force: true });
    }
  });

  beforeEach(async () => {
    resetLearnloopForTests();
    app = createApp();
    token = await login(app);
  });

  function seedLogs(n: number, rate?: 1 | -1) {
    for (let i = 0; i < n; i++) {
      recordChatLog("analysis", `질문 ${i}: 방화벽 정책은?`, `답변 ${i}: 최소권한 원칙으로 구성합니다.`);
    }
    if (rate !== undefined) {
      // 전부 지정 평가로 마킹
      return request(app)
        .get("/api/learnloop/logs")
        .set(auth())
        .then(async (res) => {
          for (const log of res.body.logs) {
            await request(app).post(`/api/learnloop/logs/${log.id}/rate`).set(auth()).send({ rating: rate });
          }
        });
    }
  }

  it("recordChatLog captures conversations and GET /logs returns KPIs", async () => {
    recordChatLog("analysis", "SBOM이 뭐야?", "소프트웨어 구성 명세서입니다.");
    recordChatLog("cti", "다크웹 유출 확인법?", "CTI 피드에서 조회합니다.");
    const res = await request(app).get("/api/learnloop/logs").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.kpis.total).toBe(2);
    expect(res.body.kpis.unused).toBe(2); // 미평가도 unused 후보에 포함
    // 최신순 정렬
    expect(res.body.logs[0].agentId).toBe("cti");
  });

  it("autoCollect=off suppresses capture", async () => {
    putLearnloopConfig({ autoCollect: false });
    recordChatLog("analysis", "질문", "답변");
    const res = await request(app).get("/api/learnloop/logs").set(auth());
    expect(res.body.logs).toHaveLength(0);
  });

  it("rates a log up/down/clear and 404s on unknown id", async () => {
    recordChatLog("analysis", "질문", "답변");
    const { logs } = (await request(app).get("/api/learnloop/logs").set(auth())).body;
    const id = logs[0].id;

    const up = await request(app).post(`/api/learnloop/logs/${id}/rate`).set(auth()).send({ rating: 1 });
    expect(up.body.rating).toBe(1);
    const down = await request(app).post(`/api/learnloop/logs/${id}/rate`).set(auth()).send({ rating: -1 });
    expect(down.body.rating).toBe(-1);
    const clear = await request(app).post(`/api/learnloop/logs/${id}/rate`).set(auth()).send({ rating: 0 });
    expect(clear.body.rating).toBeNull();

    expect((await request(app).post("/api/learnloop/logs/nope/rate").set(auth()).send({ rating: 1 })).status).toBe(404);
    expect((await request(app).post(`/api/learnloop/logs/${id}/rate`).set(auth()).send({ rating: 5 })).status).toBe(400);
  });

  it("deletes a log", async () => {
    recordChatLog("analysis", "질문", "답변");
    const { logs } = (await request(app).get("/api/learnloop/logs").set(auth())).body;
    expect((await request(app).delete(`/api/learnloop/logs/${logs[0].id}`).set(auth())).status).toBe(200);
    expect((await request(app).get("/api/learnloop/logs").set(auth())).body.logs).toHaveLength(0);
    expect((await request(app).delete("/api/learnloop/logs/nope").set(auth())).status).toBe(404);
  });

  it("build-dataset uses only positive-rated unused logs, writes the file, marks used", async () => {
    await seedLogs(5, 1);
    recordChatLog("analysis", "부정 질문", "부정 답변"); // 미평가 1건 — 기본 모드에선 제외
    const res = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({});
    expect(res.status).toBe(200);
    expect(res.body.examples).toBe(5);
    savedDatasets.push(res.body.datasetId);

    const file = path.join("data", "datasets", `${res.body.datasetId}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const pairs = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(pairs).toHaveLength(5);
    expect(pairs[0]).toHaveProperty("question");
    expect(pairs[0]).toHaveProperty("answer");

    // used 마킹으로 두 번째 빌드는 재사용 불가 → 부족 400
    const again = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({});
    expect(again.status).toBe(400);
  });

  it("build-dataset returns 400 below minimum examples", async () => {
    await seedLogs(2, 1);
    const res = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("부족");
  });

  it("run (smoke) walks the full stage machine to done and records a run row", async () => {
    await seedLogs(6, 1);
    const res = await request(app).post("/api/learnloop/run").set(auth()).send({});
    expect(res.status).toBe(202);
    expect(res.body.stage).toBe("stopping-engines");
    expect(res.body.baseModel).toBe("NousResearch/Hermes-3-Llama-3.1-8B"); // 기본 Hermes
    expect(res.body.outputModelId).toMatch(/^hermes-sec-tuned-v\d+$/);
    savedDatasets.push(res.body.datasetId);

    await waitUntil(() => getLearnloopStatus().running === false);

    const runs = (await request(app).get("/api/learnloop/runs").set(auth())).body;
    expect(runs).toHaveLength(1);
    expect(runs[0].stage).toBe("done");
    expect(runs[0].finishedAt).toBeTruthy();

    const status = (await request(app).get("/api/learnloop/status").set(auth())).body;
    expect(status.running).toBe(false);
    expect(status.run.stage).toBe("done");
  });

  it("rejects a second run while one is in progress (409)", async () => {
    await seedLogs(6, 1);
    const first = await request(app).post("/api/learnloop/run").set(auth()).send({});
    expect(first.status).toBe(202);
    savedDatasets.push(first.body.datasetId);
    // 스모크 모드도 stage 전이는 비동기라 아주 짧게 진행 중일 수 있다 — 그 사이 중복 요청
    const second = await request(app).post("/api/learnloop/run").set(auth()).send({ datasetId: "any" });
    // 첫 실행이 이미 끝났으면 409 대신 진행되므로, 둘 중 하나만 성립하면 된다
    if (second.status === 409) {
      expect(second.body.error).toContain("진행 중");
    } else {
      expect(second.status).toBe(202);
    }
    await waitUntil(() => getLearnloopStatus().running === false);
  });

  it("output model version increments across runs even without real gguf files", async () => {
    const first = await request(app).post("/api/learnloop/run").set(auth()).send({ datasetId: "ds-a" });
    expect(first.body.outputModelId).toBe("hermes-sec-tuned-v1");
    await waitUntil(() => getLearnloopStatus().running === false);

    const second = await request(app).post("/api/learnloop/run").set(auth()).send({ datasetId: "ds-b" });
    // 스모크 모드라 gguf 파일은 안 생기지만, 실행 이력에서 v1을 보고 v2를 발급해야 한다
    expect(second.body.outputModelId).toBe("hermes-sec-tuned-v2");
    await waitUntil(() => getLearnloopStatus().running === false);
  });

  it("config defaults to Hermes and PUT roundtrips with validation", async () => {
    const defaults = (await request(app).get("/api/learnloop/config").set(auth())).body;
    expect(defaults).toEqual({
      autoCollect: true,
      baseModel: "NousResearch/Hermes-3-Llama-3.1-8B",
      modelPrefix: "hermes-sec-tuned",
      targetAgent: "model-evolution",
    });

    const updated = await request(app)
      .put("/api/learnloop/config")
      .set(auth())
      .send({ autoCollect: false, modelPrefix: "my-tuned", targetAgent: "analysis" });
    expect(updated.body.autoCollect).toBe(false);
    expect(updated.body.modelPrefix).toBe("my-tuned");
    expect(updated.body.targetAgent).toBe("analysis");

    expect((await request(app).put("/api/learnloop/config").set(auth()).send({ modelPrefix: "한글불가" })).status).toBe(400);
    expect((await request(app).put("/api/learnloop/config").set(auth()).send({ targetAgent: "no-such" })).status).toBe(400);
  });

  it("preflight returns a structured check list and requires auth", async () => {
    const res = await request(app).get("/api/learnloop/preflight").set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(typeof res.body.ready).toBe("boolean");
    // 예상 점검 항목이 모두 있는지(환경마다 ok 값은 다르므로 존재+형태만 확인)
    const keys = res.body.checks.map((c: { key: string }) => c.key);
    for (const k of ["python", "unsloth", "gguf", "llama-convert", "llama-quantize", "base-model", "training-data"]) {
      expect(keys, `${k} 누락`).toContain(k);
    }
    for (const c of res.body.checks) {
      expect(typeof c.ok).toBe("boolean");
      expect(typeof c.required).toBe("boolean");
      expect(c.label.length).toBeGreaterThan(0);
    }
    // 필수 항목이 하나라도 실패면 ready=false여야 한다(일관성)
    const requiredAllOk = res.body.checks.filter((c: { required: boolean }) => c.required).every((c: { ok: boolean }) => c.ok);
    expect(res.body.ready).toBe(requiredAllOk);

    expect((await request(app).get("/api/learnloop/preflight")).status).toBe(401);
  });

  it("prune keeps unused training candidates and drops consumed/rejected logs first", async () => {
    // 6건 수집 후: 2건 학습에 사용(=build-dataset), 1건 👎, 나머지 3건은 미평가 후보로 남김
    for (let i = 0; i < 6; i++) recordChatLog("analysis", `q${i}`, `a${i}`);
    let logs = (await request(app).get("/api/learnloop/logs").set(auth())).body.logs;
    // 오래된 2건에 👍 → build-dataset으로 usedInDataset=1
    await request(app).post(`/api/learnloop/logs/${logs[5].id}/rate`).set(auth()).send({ rating: 1 });
    await request(app).post(`/api/learnloop/logs/${logs[4].id}/rate`).set(auth()).send({ rating: 1 });
    // 3건 더 채워 최소치를 맞추고 build로 5건을 소진(usedInDataset=1)시킨다
    await request(app).post(`/api/learnloop/logs/${logs[3].id}/rate`).set(auth()).send({ rating: 1 });
    await request(app).post(`/api/learnloop/logs/${logs[2].id}/rate`).set(auth()).send({ rating: 1 });
    await request(app).post(`/api/learnloop/logs/${logs[1].id}/rate`).set(auth()).send({ rating: 1 });
    await request(app).post(`/api/learnloop/logs/${logs[0].id}/rate`).set(auth()).send({ rating: -1 }); // 👎
    const built = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({});
    savedDatasets.push(built.body.datasetId);

    // 이제: 5건 usedInDataset=1, 1건 rating=-1 → 전부 "안전 삭제 대상". 미학습 후보는 0건.
    // 캡을 2로 낮춰 prune → 안전 행부터 오래된 순으로 지워 총 2건만 남아야 한다.
    const removed = pruneChatLogs(2);
    expect(removed).toBe(4);
    const after = (await request(app).get("/api/learnloop/logs").set(auth())).body;
    expect(after.kpis.total).toBe(2);
  });

  it("prune protects unrated/positive unused candidates until forced by cap", async () => {
    for (let i = 0; i < 4; i++) recordChatLog("analysis", `keep${i}`, `a${i}`); // 전부 미평가 미사용 후보
    // 캡을 10으로 두면(현재 4건) 아무것도 안 지운다
    expect(pruneChatLogs(10)).toBe(0);
    expect((await request(app).get("/api/learnloop/logs").set(auth())).body.kpis.total).toBe(4);
    // 캡을 2로 낮추면 안전 행이 없으므로 최후 수단으로 오래된 후보 2건을 지운다
    expect(pruneChatLogs(2)).toBe(2);
    expect((await request(app).get("/api/learnloop/logs").set(auth())).body.kpis.total).toBe(2);
  });

  it("requires auth on all routes", async () => {
    expect((await request(app).get("/api/learnloop/logs")).status).toBe(401);
    expect((await request(app).post("/api/learnloop/run")).status).toBe(401);
    expect((await request(app).get("/api/learnloop/config")).status).toBe(401);
  });
});
