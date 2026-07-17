// 취약점 조치 쓰기 도구(assign_finding · update_finding_status) — Phase 2 완성분.
// 핵심 계약: ① finding 지목은 서버 규칙(resolveFinding)이 판단(0/2+건은 거부) ② 쓰기 실패는
// throw로 올라간다(결재판이 "실행 실패"로 표시) ③ 앞선 조회 결과에서 온 값은 found로 유지된다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { runAgentLoop } from "../src/engine/agentloop";
import { findAgentTool, buildApproval, executeApprovedTool } from "../src/engine/agenttools";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { resetApprovalsForTests, listFindingReviews } from "../src/engine/approvals";
import type { StandardFinding } from "../src/engine/bridge";

const FINDINGS: StandardFinding[] = [
  { finding_type: "프롬프트 인젝션 노출", severity: "critical", evidence: "system prompt leaked via jailbreak", source_tool: "modelscan" },
  { finding_type: "버전 정보 노출", severity: "low", evidence: "banner shows v1.2", source_tool: "nessus" },
];

function seedAssetWithFindings() {
  registerAsset({ id: "ai-secbot-01", name: "사내 챗봇", path: "models/chatbot.gguf" });
  recordFindings("ai-secbot-01", FINDINGS);
}

function reviewFor(assetId: string, needle: string) {
  return listFindingReviews().find((r) => r.assetId === assetId && r.finding.finding_type.includes(needle));
}

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

beforeEach(() => {
  mockChat.mockReset();
  resetAssetsForTests();
  resetApprovalsForTests();
  seedAssetWithFindings();
});

describe("assign_finding — 담당자·기한 배정 (승인 실행)", () => {
  it("심각도·유형으로 지목한 취약점에 담당자와 기한을 기록한다", async () => {
    const out = await executeApprovedTool("assign_finding", {
      assetId: "ai-secbot-01",
      finding: "프롬프트 인젝션",
      assignee: "김보안",
      dueDate: "2026-07-31",
    });
    expect(out).toContain("김보안");
    const r = reviewFor("ai-secbot-01", "프롬프트 인젝션");
    expect(r?.assignee).toBe("김보안");
    expect(r?.dueDate).toBe("2026-07-31");
  });

  it("기한 없이 담당자만도 배정된다", async () => {
    await executeApprovedTool("assign_finding", { assetId: "ai-secbot-01", finding: "버전 정보", assignee: "운영팀" });
    expect(reviewFor("ai-secbot-01", "버전 정보")?.assignee).toBe("운영팀");
  });

  it("기한 형식이 YYYY-MM-DD가 아니면 실패한다(쓰기 안 함)", async () => {
    await expect(
      executeApprovedTool("assign_finding", { assetId: "ai-secbot-01", finding: "프롬프트 인젝션", assignee: "김보안", dueDate: "다음주 금요일" })
    ).rejects.toThrow("YYYY-MM-DD");
    // 저장 행이 만들어지지 않아 담당자·기한이 비어 있어야 한다(listFindingReviews는 미검토도 pending으로 항상 반환).
    expect(reviewFor("ai-secbot-01", "프롬프트 인젝션")?.assignee).toBeUndefined();
    expect(reviewFor("ai-secbot-01", "프롬프트 인젝션")?.dueDate).toBeUndefined();
  });
});

describe("update_finding_status — 오탐/조치완료 판정 (승인 실행)", () => {
  it('"오탐"을 rejected로 매핑해 판정·사유를 기록한다', async () => {
    const out = await executeApprovedTool("update_finding_status", {
      assetId: "ai-secbot-01",
      finding: "버전 정보",
      status: "오탐",
      note: "내부망 전용이라 위험 없음",
    });
    expect(out).toContain("오탐");
    const r = reviewFor("ai-secbot-01", "버전 정보");
    expect(r?.status).toBe("rejected");
    expect(r?.note).toContain("내부망");
  });

  it('"조치완료"를 approved로 매핑한다', async () => {
    await executeApprovedTool("update_finding_status", { assetId: "ai-secbot-01", finding: "프롬프트 인젝션", status: "조치완료" });
    expect(reviewFor("ai-secbot-01", "프롬프트 인젝션")?.status).toBe("approved");
  });

  it("해석 못 하는 상태값은 실패한다", async () => {
    await expect(
      executeApprovedTool("update_finding_status", { assetId: "ai-secbot-01", finding: "버전 정보", status: "아마도?" })
    ).rejects.toThrow("해석하지 못했습니다");
  });
});

describe("resolveFinding — 지목의 판단은 서버 규칙 (LLM이 findingKey를 못 만든다)", () => {
  it("맞는 취약점이 없으면 실패하고 후보를 알려준다", async () => {
    await expect(
      executeApprovedTool("assign_finding", { assetId: "ai-secbot-01", finding: "SQL 인젝션", assignee: "김보안" })
    ).rejects.toThrow(/찾지 못했습니다/);
  });

  it("여러 건이 걸리면 실행하지 않고 더 구체적으로 지목하라고 한다", async () => {
    // "노출"은 두 finding(프롬프트 인젝션 노출·버전 정보 노출)에 모두 걸린다.
    await expect(
      executeApprovedTool("assign_finding", { assetId: "ai-secbot-01", finding: "노출", assignee: "김보안" })
    ).rejects.toThrow(/2건/);
    expect(listFindingReviews().some((r) => r.assignee)).toBe(false); // 아무것도 안 씀
  });

  it("없는 자산이면 실패하고 등록 자산 id를 알려준다", async () => {
    await expect(
      executeApprovedTool("assign_finding", { assetId: "ai-없음-99", finding: "프롬프트 인젝션", assignee: "김보안" })
    ).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe("buildApproval — 조회 결과에서 온 값은 found로 유지(되묻지 않음)", () => {
  const tool = () => findAgentTool("assign_finding")!;

  it("assetId·finding이 앞선 조회 결과에 있으면 found로 남긴다", () => {
    const toolResults = "오늘 조치 우선순위\n1. [critical] 프롬프트 인젝션 노출 @ 사내 챗봇(id=ai-secbot-01) — KEV";
    const ap = buildApproval(
      tool(),
      { assetId: "ai-secbot-01", finding: "프롬프트 인젝션", assignee: "김보안" },
      "1번 항목 김보안한테 배정해줘",
      toolResults
    );
    const by = (k: string) => ap.fields.find((f) => f.key === k)!;
    expect(by("assetId").source).toBe("found"); // 지시엔 없지만 조회 결과에 있음
    expect(by("assetId").value).toBe("ai-secbot-01"); // 되묻지 않고 유지
    expect(by("finding").source).toBe("found");
    expect(by("assignee").source).toBe("said"); // 지시문에 있음
    expect(ap.missing).toEqual([]); // 다 채워짐
  });

  it("조회 결과도 지시문도 없는 필수값은 여전히 되묻는다(환각 방어 유지)", () => {
    const ap = buildApproval(tool(), { assetId: "ai-secbot-01", finding: "프롬프트 인젝션", assignee: "김보안" }, "취약점 배정해줘");
    const by = (k: string) => ap.fields.find((f) => f.key === k)!;
    expect(by("assetId").value).toBe(""); // 근거 없음 → 빈 칸
    expect(by("assetId").source).toBe("empty");
    expect(ap.missing).toContain("assetId");
  });
});

describe("runAgentLoop — today로 찾고 assign_finding으로 이어가면 결재판이 뜬다", () => {
  it("조회→쓰기 2스텝: 실행 없이 approval, assetId는 found", async () => {
    // 1스텝: today 호출 → 2스텝: assign_finding(쓰기) → 결재판
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"today","args":{"limit":"3"}}')
      .mockResolvedValueOnce('{"action":"tool","tool":"assign_finding","args":{"assetId":"ai-secbot-01","finding":"프롬프트 인젝션","assignee":"김보안"}}');
    const r = await runAgentLoop("오늘 제일 급한 거 김보안한테 배정해줘");
    expect(r?.approval?.tool).toBe("assign_finding");
    // 승인 전에는 아무것도 쓰지 않는다.
    expect(listFindingReviews().some((rv) => rv.assignee)).toBe(false);
    // assetId는 today 결과에서 온 값이라 found로 유지(되묻지 않음).
    expect(r?.approval?.fields.find((f) => f.key === "assetId")?.source).toBe("found");
  });
});

describe("POST /api/agent/approve — 쓰기 실패는 400으로 (오발동 방지)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });

  it("정상 배정은 200 + 검토대장 반영", async () => {
    const res = await request(app)
      .post("/api/agent/approve")
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "assign_finding", args: { assetId: "ai-secbot-01", finding: "프롬프트 인젝션", assignee: "김보안", dueDate: "2026-08-01" } });
    expect(res.status).toBe(200);
    expect(reviewFor("ai-secbot-01", "프롬프트 인젝션")?.assignee).toBe("김보안");
  });

  it("모호한 지목은 400으로 거절(완료로 오인시키지 않음)", async () => {
    const res = await request(app)
      .post("/api/agent/approve")
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "assign_finding", args: { assetId: "ai-secbot-01", finding: "노출", assignee: "김보안" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("2건");
  });
});
