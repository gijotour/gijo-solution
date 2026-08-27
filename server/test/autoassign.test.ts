// 자산 기본 담당자 자동 배정 — "다시 쌓이지 않게 하는 장치".
// 가장 중요한 계약: **사람이 정한 배정을 기계가 덮지 않는다.**
import { describe, it, expect, beforeEach } from "vitest";
import { getDefaultAssignee, setDefaultAssignee, autoAssignFindings } from "../src/engine/autoassign";
import { registerAsset, recordFindings, findingsRecordedListenerCount } from "../src/engine/assets";
import { 자동배정_배선 } from "../src/engine/autoassign";
import { readFileSync } from "fs";
import { join } from "path";
import { resetApprovalsForTests, listFindingReviews, updateFindingReview, findingKey } from "../src/engine/approvals";
import type { StandardFinding } from "../src/engine/bridge";

const A = "auto-web-01";
const F1: StandardFinding = { finding_type: "OpenSSH < 9.6", severity: "high", evidence: "", source_tool: "t", key: "f1", state: "active" };
const F2: StandardFinding = { finding_type: "Log4j RCE", severity: "critical", evidence: "", source_tool: "t", key: "f2", state: "new" };
const FIXED: StandardFinding = { finding_type: "이미 해결", severity: "low", evidence: "", source_tool: "t", key: "f3", state: "fixed" };

// ★ 2026-08-28(화살 #7) — 자동 배정은 이제 **등록된 훅**으로 돈다(assets가 결재 층을
//   직접 안 부른다). 운영에서는 app.ts가 부팅에 한 번 배선하고, 시험에서는 여기서 한다.
//   ⚠ 이 한 줄이 없으면 아래 「스캔에서 자동으로 돈다」 시험이 **실제로 실패한다** —
//     그게 이 구조의 안전망이다(배선을 잊으면 조용히 죽는 대신 시험이 운다).
//   중복 등록을 피해 파일 최초 1회만(청취자는 배열이라 매번 부르면 쌓인다).
자동배정_배선();

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

// ── ★ 등록 계약 (2026-08-28 화살 #7 — 두 인격 분리의 대가를 막는 그물) ────────────────
//
// 훅으로 바꾸면서 위험이 「직접 호출을 빠뜨림」에서 **「등록을 잊음」**으로 옮겨 갔다.
// 등록이 없으면 자동 배정이 **소리 없이** 죽는다(assets의 청취자 루프가 그냥 0회 돈다) —
// 화면도 오류도 멀쩡하고 미배정만 다시 쌓인다. 반증 검토(2026-08-23)가 정확히 경고한 자리다.
describe("★ 자동 배정 배선 — 등록이 없으면 소리 없이 죽는다", () => {
  it("app.ts가 자동배정_배선을 부른다 — 이 줄이 빠지면 자동 배정 전체가 죽는다", () => {
    const app = readFileSync(join(__dirname, "..", "src", "app.ts"), "utf-8");
    expect(app, "app.ts에서 자동배정_배선() 호출이 사라졌다 — 스캔이 들어와도 아무도 안 배정한다")
      .toContain("자동배정_배선()");
  });

  it("배선하면 청취자가 실제로 늘고, recordFindings가 그것을 부른다", () => {
    // 파일 최상단에서 이미 배선했다 — 청취자가 최소 1명 있어야 한다(0이면 조용히 죽는 상태).
    expect(findingsRecordedListenerCount(), "청취자 0 — 자동 배정이 소리 없이 죽는 상태").toBeGreaterThan(0);
    // 실동작: 기본 담당자가 있는 자산에 스캔이 들어오면 배정된다(직접 호출 없이)
    registerAsset({ id: "hook-web", name: "훅 검증", path: "" });
    setDefaultAssignee("hook-web", "김담당");
    recordFindings("hook-web", [F1]);
    const 배정 = listFindingReviews("hook-web").filter((r) => (r.assignee ?? "").trim());
    expect(배정.length, "훅을 걸었는데 배정이 안 됐다 — 배선이 헛돈다").toBeGreaterThan(0);
  });

  it("자산 층은 결재 층을 모른다 — assets.ts가 autoassign을 직접 import하지 않는다", () => {
    const a = readFileSync(join(__dirname, "..", "src", "engine", "assets.ts"), "utf-8");
    expect(a, "assets가 autoassign을 다시 문다 — 3자 순환이 부활한다")
      .not.toContain('from "./autoassign"');
  });
});
