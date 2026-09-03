// test/learnlooptopic.test.ts — 주제별 전문가 학습 게이트·데이터셋 필터·어댑터 산출 배선
// (AI팀 재설계 2·3단계, 2026-08-08)
//
// 계약: ① 주제 학습은 승인 300(TOPIC_TRAIN_TARGET) 미달이면 진척 수치와 함께 거절 — 1회전
// 실측(85쌍 → 반복 루프·키 날조)이 근거 ② force 강행은 산출에 흔적이 남는다 ③ 주제 데이터셋은
// 그 주제 딱지만 담는다 ④ 산출은 병합 모델이 아니라 어댑터 등록(미채택)이다 — 소스 감시 포함.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import { createApp } from "../src/app";
import { db } from "../src/db";
import {
  recordChatLog,
  resetLearnloopForTests,
  getLearnloopStatus,
  getChatLog,
  topicTrainGate,
  TOPIC_TRAIN_TARGET,
  TOPICS,
} from "../src/engine/learnloop";
import { decideLearnCandidate } from "../src/engine/learncandidates";

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

describe("learnloop 주제별 전문가 학습 (재설계 2·3단계)", () => {
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
      fs.rmSync(path.join(process.env.GIJO_DATASETS_DIR ?? path.join("data", "datasets"), `${id}.json`), { force: true });
    }
  });

  beforeEach(async () => {
    resetLearnloopForTests();
    app = createApp();
    token = await login(app);
  });

  // 주제 딱지는 질문주제()가 결정적으로 붙인다 — "방화벽"은 장비운영, "CVE-…"는 취약점.
  async function seed장비운영(n: number) {
    for (let i = 0; i < n; i++) {
      recordChatLog("analysis", `질문 ${i}: 방화벽 룰셋 점검은 어떻게?`, `답변 ${i}: 정책 검토 후 미사용 룰을 정리합니다.`);
    }
    const res = await request(app).get("/api/learnloop/logs").set(auth()).query({ limit: 200 });
    for (const log of res.body.logs) {
      await request(app).post(`/api/learnloop/logs/${log.id}/rate`).set(auth()).send({ rating: 1 });
    }
  }

  it("topicTrainGate — 미달이면 ok:false와 진척 수치, 모르는 주제는 거절", () => {
    const gate = topicTrainGate("장비운영");
    expect(gate.ok).toBe(false);
    expect(gate.target).toBe(TOPIC_TRAIN_TARGET);
    expect(gate.남은건수).toBeGreaterThan(0);
    expect(() => topicTrainGate("요리")).toThrow(/알 수 없는 주제/);
    expect(TOPICS).toContain("장비운영");
  });

  it("주제 학습 시작은 승인 300 미달이면 400 — 진척 수치를 정직하게 말한다", async () => {
    await seed장비운영(6);
    const res = await request(app).post("/api/learnloop/run").set(auth()).send({ topic: "장비운영" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("장비운영");
    expect(res.body.error).toMatch(/6\/300/);
    expect(res.body.error).toContain("294건");
  });

  it("force 강행은 202로 시작되고 산출 id에 주제 슬러그가 붙는다", async () => {
    await seed장비운영(6);
    const res = await request(app).post("/api/learnloop/run").set(auth()).send({ topic: "장비운영", force: true });
    expect(res.status).toBe(202);
    expect(res.body.topic).toBe("장비운영");
    expect(res.body.outputModelId).toMatch(/^sec-expert-ops-v\d+$/);
    savedDatasets.push(res.body.datasetId);
    await waitUntil(() => getLearnloopStatus().running === false);
  });

  it("주제 데이터셋은 그 주제 딱지만 담는다 — 다른 주제·미분류는 제외", async () => {
    await seed장비운영(6);
    // 취약점 로그도 섞어 둔다(승인 포함) — 필터가 없으면 함께 딸려 들어간다
    recordChatLog("analysis", "CVE-2026-0001 패치 상태는?", "해당 자산 3대 중 2대 조치 완료입니다.");
    const 취약점로그 = (await request(app).get("/api/learnloop/logs").set(auth())).body.logs[0];
    await request(app).post(`/api/learnloop/logs/${취약점로그.id}/rate`).set(auth()).send({ rating: 1 });

    const res = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({ topic: "장비운영" });
    expect(res.status).toBe(200);
    expect(res.body.examples).toBe(6); // 취약점 1건은 안 들어감
    savedDatasets.push(res.body.datasetId);

    // 취약점 쪽은 아직 미사용으로 남아 있어야 한다(다음 취약점 데이터셋의 재료)
    const 남은 = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({ topic: "취약점" });
    expect(남은.status).toBe(400); // 1건뿐 — 최소 5건 미달이지만 "주제 「취약점」" 표기로 정직하게
    expect(남은.body.error).toContain("취약점");
  });

  it("추가 교육(재학습)은 이전에 쓴 승인분도 다시 담는다 — vN+1이 배운 것을 잃지 않게", async () => {
    // 2026-08-09 정책(사용자 지시 "잘 학습된 LoRA를 넣어 추가 교육"): 어댑터 vN+1은 vN을
    // **대체**하므로, 데이터셋을 "아직 안 쓴 것만"으로 지으면 이전에 배운 승인분이 통째로
    // 빠진 어댑터가 나온다(usedInDataset 필터의 함정 — 실코드 검토에서 발견).
    await seed장비운영(6);
    const 첫 = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({ topic: "장비운영" });
    expect(첫.status).toBe(200);
    expect(첫.body.examples).toBe(6);
    savedDatasets.push(첫.body.datasetId);

    // 새 승인 1건이 더 쌓인 뒤 다시 지으면 — 이전 6건을 버리지 않고 7건이어야 한다.
    recordChatLog("analysis", "추가질문: 방화벽 이중화 구성 점검은 어떻게?", "HA 상태와 정책 동기화 여부를 확인합니다.");
    const 새로그 = (await request(app).get("/api/learnloop/logs").set(auth())).body.logs[0];
    await request(app).post(`/api/learnloop/logs/${새로그.id}/rate`).set(auth()).send({ rating: 1 });
    const 둘 = await request(app).post("/api/learnloop/build-dataset").set(auth()).send({ topic: "장비운영" });
    expect(둘.status).toBe(200);
    expect(둘.body.examples).toBe(7); // usedInDataset 필터가 되살아나면 1이 나와 여기서 실패한다
    savedDatasets.push(둘.body.datasetId);
  });

  // [검토관 2026-09-03 나] 후보함 배지는 질문주제()를 매번 다시 계산하지만 진척(topics API·topicTrainGate)은 저장값을 센다.
  //   규칙이 나중에 생긴 주제(「일반」)는 그 전에 수집된 행의 topic이 NULL이라 승인해도 「일반 0/300」이 안 움직였다.
  //   계약: 승인 순간 NULL이면 같은 규칙(질문주제)으로 채워 저장한다 — 후보함(cl:)·👍 API 어느 입구든 rateChatLog 한 곳.
  it("승인 순간 저장 topic이 NULL이면 같은 규칙으로 채운다 — 「일반」 후보를 승인하면 진척이 움직인다", async () => {
    recordChatLog("orchestrator", "온프레미스가 뭐야?", "온프레미스는 서버와 데이터를 사내 설비에 두고 직접 운영하는 방식입니다. 클라우드와 달리 외부 사업자 없이 폐쇄망에서도 돌아갑니다.");
    const id = (await request(app).get("/api/learnloop/logs").set(auth())).body.logs[0].id as string;
    // 「일반」 규칙이 생기기 전에 수집된 행의 상태를 그대로 만든다(수집 규칙이 지금은 「일반」을 붙이므로 손으로 NULL로)
    db.prepare("UPDATE chat_logs SET topic = NULL WHERE id = ?").run(id);
    expect(getChatLog(id)?.topic).toBeNull();
    expect(topicTrainGate("일반").approved).toBe(0);

    decideLearnCandidate(`cl:${id}`, true, "시험"); // 후보함 승인 경로 — rateChatLog를 지난다
    expect(getChatLog(id)?.topic).toBe("일반");
    expect(topicTrainGate("일반").approved).toBe(1);
    const topics = (await request(app).get("/api/learnloop/topics").set(auth())).body.주제 as { topic: string; approved: number }[];
    expect(topics.find((t) => t.topic === "일반")?.approved).toBe(1);
  });

  it("이미 딱지가 있는 행은 승인해도 바꾸지 않는다 — 지난달 판정을 설명할 수 있어야 한다", async () => {
    recordChatLog("orchestrator", "온프레미스가 뭐야?", "온프레미스는 서버와 데이터를 사내 설비에 두고 직접 운영하는 방식입니다. 클라우드와 달리 외부 사업자 없이 폐쇄망에서도 돌아갑니다.");
    const id = (await request(app).get("/api/learnloop/logs").set(auth())).body.logs[0].id as string;
    db.prepare("UPDATE chat_logs SET topic = '장비운영' WHERE id = ?").run(id); // 옛 규칙이 붙였던 값이라 치자
    await request(app).post(`/api/learnloop/logs/${id}/rate`).set(auth()).send({ rating: 1 }); // 👍 API 입구
    expect(getChatLog(id)?.topic).toBe("장비운영");
    expect(topicTrainGate("일반").approved).toBe(0);
  });

  // [2026-09-03] 승인 문답이 기억(RAG)에 실제로 들어갔나를 같은 응답에서 본다.
  //   운영 실측 승인 1,856 vs 문서 1,253 — 차이를 보여 주는 화면이 하나도 없어 몇 달을 몰랐다.
  //   ⚠ learnmemory는 learnloop을 import하므로 라우트가 **동적 import**로 받아야 한다(정적이면 순환).
  it("topics 응답에 「기억반입」 칸이 있다 — 승인 수·문서 수·못 들어간 수를 함께 준다", async () => {
    await seed장비운영(2);
    const res = await request(app).get("/api/learnloop/topics").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.기억반입).toBeDefined();
    expect(Object.keys(res.body.기억반입).sort()).toEqual(["approved", "docs", "hygieneBlocked", "missing"]);
    for (const v of Object.values(res.body.기억반입)) expect(typeof v).toBe("number");
    const 원천 = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "learnloop.ts"), "utf8");
    expect(원천).toContain('await import("./learnmemory.js")'); // 정적 import로 되돌리면 순환이 난다
  });

  it("산출 배선 소스 감시 — 병합이 아니라 어댑터 등록(미채택)이다", () => {
    const s = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "learnloop.ts"), "utf8");
    expect(s).toContain("convert_lora_to_gguf.py"); // 병합(export_gguf) 은퇴, 어댑터 변환으로
    expect(s).toContain("registerAdapter({"); // deploying 단계 = 등록
    expect(s).not.toMatch(/setAgentModel\(config\.targetAgent/); // 자동 부착 금지 — 게이트 우회 경로 차단
    expect(s).toContain("미채택");
  });
});
