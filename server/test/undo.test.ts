// #7 원클릭 undo — 쓰기 승인 실행을 통째로 되돌린다.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { executeApprovedTool } from "../src/engine/agenttools";
import { resetAssetsForTests, registerAsset, recordFindings, getAsset, listAssets } from "../src/engine/assets";
import { resetApprovalsForTests, listFindingReviews } from "../src/engine/approvals";
import { undoSnapshot, undoCommit, performUndo, resetUndoForTests } from "../src/engine/undo";

function reviewFor(needle: string) {
  return listFindingReviews().find((r) => r.finding.finding_type.includes(needle));
}

beforeEach(() => {
  resetAssetsForTests();
  resetApprovalsForTests();
  resetUndoForTests();
  registerAsset({ id: "ai-x-01", name: "자산X", path: "-" });
  recordFindings("ai-x-01", [{ finding_type: "프롬프트 인젝션", severity: "critical", evidence: "e", source_tool: "modelscan" }]);
});

describe("undo — 자산 등록 되돌리기", () => {
  it("register_asset 승인 실행을 undo하면 자산이 삭제된다", async () => {
    const before = undoSnapshot();
    await executeApprovedTool("register_asset", { name: "임시봇", path: "models/tmp.gguf" });
    const id = "임시봇-01";
    expect(getAsset(id)).toBeDefined();
    const undoId = undoCommit("register_asset", "임시봇 등록", before);
    expect(undoId).not.toBeNull();
    const r = performUndo();
    expect(r.ok).toBe(true);
    expect(getAsset(id)).toBeUndefined(); // 되돌려져 삭제됨
  });
});

describe("undo — 취약점 조치 되돌리기", () => {
  it("assign_finding undo하면 담당자·기한이 원복된다", async () => {
    const before = undoSnapshot();
    await executeApprovedTool("assign_finding", { assetId: "ai-x-01", finding: "프롬프트 인젝션", assignee: "김보안", dueDate: "2026-08-01" });
    expect(reviewFor("프롬프트 인젝션")?.assignee).toBe("김보안");
    undoCommit("assign_finding", "프롬프트 인젝션 배정", before);
    expect(performUndo().ok).toBe(true);
    expect(reviewFor("프롬프트 인젝션")?.assignee).toBeUndefined(); // 미배정으로 원복
  });

  it("bulk_update undo하면 일괄 변경이 전부 원복된다", async () => {
    registerAsset({ id: "ai-y-02", name: "자산Y", path: "-" });
    recordFindings("ai-y-02", [{ finding_type: "critical 결함2", severity: "critical", evidence: "e", source_tool: "modelscan" }]);
    const before = undoSnapshot();
    await executeApprovedTool("bulk_update", { filter: "critical", assignee: "정요한" });
    expect(listFindingReviews().filter((r) => r.assignee === "정요한").length).toBe(2);
    undoCommit("bulk_update", "critical 일괄 배정", before);
    expect(performUndo().ok).toBe(true);
    expect(listFindingReviews().filter((r) => r.assignee === "정요한").length).toBe(0);
  });

  it("되돌릴 게 없으면 undoCommit이 null", async () => {
    const before = undoSnapshot();
    // 아무 쓰기도 안 함
    expect(undoCommit("noop", "x", before)).toBeNull();
    expect(performUndo().ok).toBe(false);
  });
});
