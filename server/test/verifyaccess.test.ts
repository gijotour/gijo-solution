// 조치 검증 권한 — 보안 경계라 규칙을 테스트로 못 박는다.
// 핵심: 시스템은 자격증명이 있어 모든 자산에 접속 가능하다. 그래서 "접속되나"가 아니라
// "이 사용자가 시켜도 되나"를 판정해야 하고, 그 판정이 여기서 새면 API 우회로 뚫린다.
import { describe, it, expect, beforeEach } from "vitest";
import { canVerifyAsset } from "../src/engine/verifyaccess";
import { registerAsset, recordFindings } from "../src/engine/assets";
import { updateFindingReview, resetApprovalsForTests, findingKey } from "../src/engine/approvals";
import type { GijoUser } from "../src/auth/users";
import type { StandardFinding } from "../src/engine/bridge";

const admin: GijoUser = { id: "a1", username: "adm", passwordHash: "", displayName: "관리자", role: "admin", team: null };
const infra: GijoUser = { id: "u1", username: "inf", passwordHash: "", displayName: "김인프라", role: "security_officer", team: "인프라운영팀" };
const noTeam: GijoUser = { id: "u2", username: "nt", passwordHash: "", displayName: "박무소속", role: "security_officer", team: null };

const FINDING: StandardFinding = {
  finding_type: "OpenSSH < 9.6 (CVE-2024-6387)", severity: "high", evidence: "포트 22", source_tool: "test", key: "k-ssh",
};

const assetId = "test-web-01";
beforeEach(() => {
  resetApprovalsForTests();
  registerAsset({ id: assetId, name: "웹서버-01", path: "/srv/web", assetType: "server", owner: "인프라운영팀" });
  recordFindings(assetId, [FINDING]);
});

describe("canVerifyAsset — 권한 규칙", () => {
  it("admin은 팀과 무관하게 전체 허용", () => {
    const d = canVerifyAsset(admin, assetId);
    expect(d.allowed).toBe(true);
  });

  it("소속 팀이 자산 소유팀과 같으면 허용", () => {
    const d = canVerifyAsset(infra, assetId);
    expect(d.allowed).toBe(true);
    expect(d.reason).toContain("인프라운영팀");
  });

  it("팀이 다르면 거부 — 그리고 사유가 행동 가능해야 한다", () => {
    const other: GijoUser = { ...infra, id: "u9", displayName: "이보안", team: "보안관제팀" };
    const d = canVerifyAsset(other, assetId);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("인프라운영팀"); // 소관 팀을 알려준다
    expect(d.reason).toContain("요청");        // 다음 행동을 알려준다
  });

  it("소속 팀이 없으면 거부하고 그 사실을 알려준다(기본값이 안전)", () => {
    const d = canVerifyAsset(noTeam, assetId);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("소속 팀이 지정돼 있지 않습니다");
  });

  it("팀이 달라도 본인이 배정된 건이면 허용", () => {
    const key = findingKey(assetId, FINDING);
    updateFindingReview(assetId, key, { assignee: "이보안" }, "관리자");
    const other: GijoUser = { ...infra, id: "u9", displayName: "이보안", team: "보안관제팀" };
    expect(canVerifyAsset(other, assetId, key).allowed).toBe(true);
  });

  it("배정 확인은 findingKey를 줬을 때만 — 자산 전체 권한으로 번지지 않는다", () => {
    const key = findingKey(assetId, FINDING);
    updateFindingReview(assetId, key, { assignee: "이보안" }, "관리자");
    const other: GijoUser = { ...infra, id: "u9", displayName: "이보안", team: "보안관제팀" };
    expect(canVerifyAsset(other, assetId).allowed).toBe(false);
  });

  it("로그인 안 했으면 거부", () => {
    expect(canVerifyAsset(undefined, assetId).allowed).toBe(false);
  });

  it("없는 자산은 거부", () => {
    expect(canVerifyAsset(admin, "no-such-asset").allowed).toBe(false);
  });

  it("팀 이름의 앞뒤 공백·대소문자 차이로 조용히 실패하지 않는다", () => {
    const sloppy: GijoUser = { ...infra, team: "  인프라운영팀 " };
    expect(canVerifyAsset(sloppy, assetId).allowed).toBe(true);
  });

  it("빈 팀끼리는 매칭으로 치지 않는다(자산 owner가 비어도 아무나 열리면 안 됨)", () => {
    registerAsset({ id: "test-noowner", name: "미지정자산", path: "/x", assetType: "server", owner: "" });
    const empty: GijoUser = { ...infra, team: "" };
    expect(canVerifyAsset(empty, "test-noowner").allowed).toBe(false);
  });
});
