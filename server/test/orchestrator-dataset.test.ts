// 오케스트레이터 도구 선택 파인튜닝 데이터셋 (Phase 4).
// 핵심 계약: ① 시드는 실재하는 도구의 유효한 호출만 가르친다(엉터리 학습데이터 방지)
// ② update_finding_status(약점)를 가중 ③ 승인된 쓰기가 골드로 누적돼 빌드에 포함된다.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";

const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { findAgentTool, validateToolArgs } from "../src/engine/agenttools";
import { resetAssetsForTests, getAsset } from "../src/engine/assets";
import {
  SEED_DECISIONS,
  appendApprovedDecision,
  collectDecisionPairs,
  toTrainingExample,
  buildOrchestratorDataset,
  amplifyDecisionPairs,
  goldCount,
  ORCHESTRATOR_DATASET_ID,
} from "../src/engine/orchestrator-dataset";

// vitest.config.ts가 격리한 임시 경로를 그대로 쓴다 — 운영 datasets/orchestrator-tools.json을
// 지우지 않도록(실측: afterAll이 운영 파일을 삭제해 재학습이 파일없음으로 실패한 사고).
const GOLD_PATH = process.env.GIJO_ORCH_GOLD_PATH ?? path.join("data", "orchestrator-gold.json");
const DATASET_PATH = path.join(process.env.GIJO_DATASETS_DIR ?? path.join("data", "datasets"), `${ORCHESTRATOR_DATASET_ID}.json`);

function cleanGold() {
  for (const p of [GOLD_PATH, DATASET_PATH]) {
    try { fs.rmSync(p); } catch { /* 없으면 무시 */ }
  }
}

beforeEach(() => {
  mockChat.mockReset();
  resetAssetsForTests();
  cleanGold();
});
afterAll(cleanGold);

describe("SEED_DECISIONS — 유효한 도구 호출만 가르친다", () => {
  it("tool 예시는 모두 실재 도구 + 필수 인자 충족(엉터리 학습데이터 방지)", () => {
    for (const { instruction, decision } of SEED_DECISIONS) {
      if (decision.action !== "tool") continue;
      const tool = findAgentTool(decision.tool!);
      expect(tool, `시드 지시 "${instruction}"의 도구 ${decision.tool}가 레지스트리에 없음`).toBeDefined();
      const invalid = validateToolArgs(tool!, decision.args ?? {});
      expect(invalid, `시드 "${instruction}" 인자 오류: ${invalid}`).toBeNull();
    }
  });

  it("9개 도구가 모두 최소 1회 등장 + final 음성예시 포함", () => {
    const tools = new Set(SEED_DECISIONS.filter((d) => d.decision.action === "tool").map((d) => d.decision.tool));
    for (const name of ["list_assets", "get_asset", "search", "explain", "today", "threats", "register_asset", "assign_finding", "update_finding_status"]) {
      expect(tools.has(name), `${name} 시드 예시 없음`).toBe(true);
    }
    expect(SEED_DECISIONS.some((d) => d.decision.action === "final")).toBe(true);
  });

  it("약점 update_finding_status를 가중한다(최다 도구)", () => {
    const counts = new Map<string, number>();
    for (const d of SEED_DECISIONS) {
      if (d.decision.action === "tool") counts.set(d.decision.tool!, (counts.get(d.decision.tool!) ?? 0) + 1);
    }
    const ufs = counts.get("update_finding_status") ?? 0;
    expect(ufs).toBeGreaterThanOrEqual(8);
    // 어떤 다른 도구보다도 예시가 많아야 한다(가장 못 고르는 도구를 가장 많이 가르친다).
    for (const [tool, n] of counts) {
      if (tool !== "update_finding_status") expect(ufs).toBeGreaterThanOrEqual(n);
    }
  });
});

describe("toTrainingExample — train==inference 포맷", () => {
  it("question=결정 프롬프트(지시+카탈로그), answer=파싱 가능한 결정 JSON", () => {
    const ex = toTrainingExample({ instruction: "오늘 뭐부터?", decision: { action: "tool", tool: "today", args: {} } });
    expect(ex.question).toContain("오늘 뭐부터?"); // 원 지시
    expect(ex.question).toContain("today"); // 도구 카탈로그
    expect(ex.question).toContain("update_finding_status"); // 전체 카탈로그 포함
    const parsed = JSON.parse(ex.answer);
    expect(parsed).toMatchObject({ action: "tool", tool: "today" });
  });
});

describe("appendApprovedDecision — 승인 누적(골드)", () => {
  it("승인된 쓰기가 골드로 쌓이고 collectDecisionPairs에 포함된다", () => {
    expect(goldCount()).toBe(0);
    appendApprovedDecision("ai-x-01 버전 노출 오탐이야", "update_finding_status", { assetId: "ai-x-01", finding: "버전 노출", status: "오탐" });
    expect(goldCount()).toBe(1);
    const pairs = collectDecisionPairs();
    const hit = pairs.find((p) => p.instruction === "ai-x-01 버전 노출 오탐이야");
    expect(hit?.decision.tool).toBe("update_finding_status");
  });

  it("같은 (지시+도구) 재승인은 최신 인자로 대체(중복·편향 방지)", () => {
    appendApprovedDecision("이거 배정", "assign_finding", { assetId: "a", finding: "f", assignee: "김보안" });
    appendApprovedDecision("이거 배정", "assign_finding", { assetId: "a", finding: "f", assignee: "이영희" });
    expect(goldCount()).toBe(1);
    const hit = collectDecisionPairs().find((p) => p.instruction === "이거 배정");
    expect(hit?.decision.args?.assignee).toBe("이영희");
  });

  it("지시가 비면 조용히 건너뛴다(프롬프트를 지어내지 않음)", () => {
    appendApprovedDecision("", "register_asset", { name: "x", path: "y" });
    expect(goldCount()).toBe(0);
  });
});

describe("buildOrchestratorDataset — 시드+골드 → 학습 데이터셋", () => {
  // ★ 2026-08-01: saveDataset이 위생을 거치게 되면서 **시드 2개가 걸러진다.**
  //   "안전대부 웹서버 취약점 알려줘" · "지금 제일 급한 취약점 알려줘" — 둘 다
  //   **평가 게이트에 실제로 있는 문항**이다. 시험지를 오케스트레이터에게 가르치고 있었고,
  //   그게 바로 위생 규칙 ②가 "가장 위험"이라고 적어 둔 오염이다. 걸러지는 게 맞다.
  //   그래서 기대값을 시드 개수가 아니라 **위생 통과분**으로 잡는다.
  const 시험문항인시드 = ["안전대부 웹서버 취약점 알려줘", "지금 제일 급한 취약점 알려줘"];
  const 위생통과시드 = SEED_DECISIONS.filter((s) => !시험문항인시드.includes(s.instruction.trim())).length;

  it("시드만으로도 유효한 데이터셋 파일을 만든다 (시험 문항은 빠진다)", async () => {
    const r = await buildOrchestratorDataset();
    expect(r.datasetId).toBe(ORCHESTRATOR_DATASET_ID);
    expect(r.examples, "위생이 시험 문항을 안 걸렀거나, 멀쩡한 시드를 잘랐다").toBe(위생통과시드);
    const rows = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8"));
    expect(rows).toHaveLength(위생통과시드);
    // 게이트 문항이 학습 파일에 실제로 안 들어갔는지 눈으로 확인한다.
    const 질문들 = rows.map((x: { question: string }) => x.question).join("\n");
    for (const q of 시험문항인시드) expect(질문들, `게이트 문항이 학습에 들어갔다: ${q}`).not.toContain(q);
    expect(rows[0]).toHaveProperty("question");
    expect(rows[0]).toHaveProperty("answer");
  });

  it("골드가 있으면 예시 수가 늘어난다", async () => {
    const base = (await buildOrchestratorDataset()).examples;
    appendApprovedDecision("새 지시 오탐이야", "update_finding_status", { assetId: "a", finding: "f", status: "오탐" });
    const after = (await buildOrchestratorDataset()).examples;
    expect(after).toBe(base + 1);
  });
});

describe("amplifyDecisionPairs — 지시문만 증폭, 값 유실 변형은 버린다(과적합 완화)", () => {
  it("그라운딩(assetId·finding) 유지 변형만 채택하고 결정은 그대로 둔다", async () => {
    const pair = {
      instruction: "ai-secbot-01 버전 노출 오탐이야",
      decision: { action: "tool" as const, tool: "update_finding_status", args: { assetId: "ai-secbot-01", finding: "버전 노출", status: "오탐" } },
    };
    // 변형2는 assetId·finding이 없다 → 그라운딩 깨져 버려져야 한다.
    mockChat.mockResolvedValueOnce(JSON.stringify(["ai-secbot-01 버전 노출은 오탐으로 처리해줘", "이건 잘못 잡힌 거야"]));
    const out = await amplifyDecisionPairs([pair], () => 3);
    expect(out).toHaveLength(2); // 원본 + 유효변형1 (변형2 탈락)
    expect(out[0]).toBe(pair);
    expect(out[1].instruction).toContain("ai-secbot-01");
    expect(out[1].decision).toBe(pair.decision); // 도구·인자 불변
  });

  it("파싱 불가·빈 응답이면 원본만 남긴다(증폭 실패가 데이터셋을 깨지 않음)", async () => {
    const pair = { instruction: "오늘 뭐부터?", decision: { action: "tool" as const, tool: "today", args: {} } };
    mockChat.mockResolvedValueOnce("죄송하지만 도와드릴 수 없습니다");
    const out = await amplifyDecisionPairs([pair], () => 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(pair);
  });
});

describe("POST /api/agent/approve — 승인 시 골드 누적(통합)", () => {
  it("instruction과 함께 승인하면 골드 예시가 쌓이고 쓰기도 실행된다", async () => {
    const app = createApp();
    const login = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    const token = login.body.accessToken as string;
    const res = await request(app)
      .post("/api/agent/approve")
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "register_asset", args: { name: "사내 챗봇", path: "models/c.gguf" }, instruction: "사내 챗봇 등록해줘 경로는 models/c.gguf" });
    expect(res.status).toBe(200);
    expect(getAsset("사내-챗봇-01")).toBeDefined(); // 실제 실행됨
    expect(goldCount()).toBe(1); // 골드 누적됨
    const hit = collectDecisionPairs().find((p) => p.decision.tool === "register_asset");
    expect(hit?.instruction).toContain("사내 챗봇");
  });
});
