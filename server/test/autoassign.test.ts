// 자산 기본 담당자 자동 배정 — "다시 쌓이지 않게 하는 장치".
// 가장 중요한 계약: **사람이 정한 배정을 기계가 덮지 않는다.**
import { describe, it, expect, beforeEach } from "vitest";
import { getDefaultAssignee, setDefaultAssignee, autoAssignFindings } from "../src/engine/autoassign";
import { registerAsset, recordFindings } from "../src/engine/assets";
import { resetApprovalsForTests, listFindingReviews, updateFindingReview, findingKey } from "../src/engine/approvals";
import type { StandardFinding } from "../src/engine/bridge";

const A = "auto-web-01";
const F1: StandardFinding = { finding_type: "OpenSSH < 9.6", severity: "high", evidence: "", source_tool: "t", key: "f1", state: "active" };
const F2: StandardFinding = { finding_type: "Log4j RCE", severity: "critical", evidence: "", source_tool: "t", key: "f2", state: "new" };
const FIXED: StandardFinding = { finding_type: "이미 해결", severity: "low", evidence: "", source_tool: "t", key: "f3", state: "fixed" };

beforeEach(() => {
  resetApprovalsForTests();
  registerAsset({ id: A, name: "웹서버-01", path: "/srv", assetType: "server", owner: "인프라운영팀" });
  setDefaultAssignee(A, null); // 재등록(upsert)은 기본 담당자를 지우지 않는다 — 테스트 간 누수 차단
});

describe("기본 담당자 지정", () => {
  it("지정·조회·해제", () => {
    expect(getDefaultAssignee(A)).toBeNull();
    setDefaultAssignee(A, "김인프라");
    expect(getDefaultAssignee(A)).toBe("김인프라");
    setDefaultAssignee(A, "");
    expect(getDefaultAssignee(A)).toBeNull();
  });
  it("앞뒤 공백은 다듬는다", () => {
    setDefaultAssignee(A, "  김인프라 ");
    expect(getDefaultAssignee(A)).toBe("김인프라");
  });
});

describe("autoAssignFindings", () => {
  it("기본 담당자가 없으면 아무 일도 하지 않는다(미배정 유지)", () => {
    const r = autoAssignFindings(A, [F1, F2]);
    expect(r).toEqual({ assignee: null, assigned: 0 });
    recordFindings(A, [F1, F2]); // 목록에 보이게 한 뒤 확인
    expect(listFindingReviews().filter((x) => x.assetId === A && x.assignee).length).toBe(0);
  });

  it("기본 담당자가 있으면 새 취약점을 배정한다", () => {
    setDefaultAssignee(A, "김인프라");
    recordFindings(A, [F1, F2]); // 스캔 저장 시 자동 배정이 돈다
    const mine = listFindingReviews().filter((x) => x.assetId === A && x.assignee === "김인프라");
    expect(mine).toHaveLength(2);
  });

  // 핵심 계약
  it("이미 담당자가 있는 건은 덮지 않는다 — 사람이 정한 배정이 우선", () => {
    recordFindings(A, [F1]);
    updateFindingReview(A, findingKey(A, F1), { assignee: "이보안" }, "사람");
    setDefaultAssignee(A, "김인프라");
    const r = autoAssignFindings(A, [F1]);
    expect(r.assigned).toBe(0);
    expect(listFindingReviews().find((x) => x.findingKey === findingKey(A, F1))!.assignee).toBe("이보안");
  });

  it("이미 해결된(fixed) 항목은 배정하지 않는다", () => {
    setDefaultAssignee(A, "김인프라");
    expect(autoAssignFindings(A, [FIXED]).assigned).toBe(0);
  });

  it("배정만 하고 상태는 바꾸지 않는다 — 배정은 '누가 볼 것인가'이지 '검토했다'가 아니다", () => {
    setDefaultAssignee(A, "김인프라");
    recordFindings(A, [F1]);
    const row = listFindingReviews().find((x) => x.findingKey === findingKey(A, F1))!;
    expect(row.assignee).toBe("김인프라");
    expect(row.status).toBe("pending"); // 미검토 그대로
  });

  it("스캔(recordFindings)에서 자동으로 돈다 — 별도 호출 없이도 배정된다", () => {
    setDefaultAssignee(A, "박담당");
    recordFindings(A, [F1, F2]);
    const assigned = listFindingReviews().filter((x) => x.assetId === A && x.assignee === "박담당");
    expect(assigned).toHaveLength(2);
  });
});
