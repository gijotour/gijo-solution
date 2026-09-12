// 결재·승인 대기 현황 도구 — 핸들러 계약 (2026-09-11, 고객 QA 예행 2026-09-10 밤 수리)
//
// FORCED_INTENTS[88](agentloop.ts) → tool: "approval_status"가 「승인 기다리는 것 있어?」·
// 「결재 대기 있어?」처럼 종류를 안 밝힌 물음을 여기로 보낸다(라우팅 시험은 approval-routing.test.ts). 이 파일은 핸들러
// runApprovalStatus 자체의 계약만 본다 — 취약점 결재(approvals.ts)와 점검 승인(report.ts)을
// **함께**, **숫자로** 세고, 기존 폴백 문구 감시(drawer-audit.mjs FAIL_MARKS)에 안 걸린다.
//
// ★★ 2026-09-11 재작성(검토관 [상]·[중] 적발) — 첫 판은 **거울 시험**이었다.
//   구현과 **똑같은 식**(`listFindingReviews().filter(isUnassignedReview)`)을 시험이 다시 써서
//   「새로 세지 않는다」는 이름을 달고도 정작 구현이 새로 센 그 식을 확인했고, 네 개 it이
//   전부 reset 직후(0건)라 숫자 갈래를 한 번도 안 밟았다 — 그래서 「미배정이 스캔 오류까지
//   센다」는 [상] 결함을 **원리상 못 잡았다.**
//   이제 ① 자료를 심고 ② 기대값을 **화면 창구(/api/approvals가 내보내는 걸러진 목록)**에서 받는다.
//   구현이 무엇을 부르든 화면과 같은 수가 아니면 빨간불이 난다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runApprovalStatus, isRealVulnerability } from "../src/engine/agenttools/handlers";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { agenttoolsSource } from "./util/toolsrc";
import { 말투위반 } from "../src/engine/tone";
import {
  resetApprovalsForTests, listFindingReviews, approvalSummary, isUnassignedReview,
  updateFindingReview, findingKey,
} from "../src/engine/approvals";
import {
  resetMaintenanceForTests, listMaintenanceItems, createMaintenanceItem, submitReport,
} from "../src/engine/maintenance";
import { resetTasksForTests } from "../src/engine/tasks";
import { resetSecurityProductsForTests } from "../src/engine/securityproducts";
import { resetFeedsForTests } from "../src/engine/cti";
import { maintenanceSummary } from "../src/engine/report";
import type { StandardFinding } from "../src/engine/bridge";

// ⚠ FAIL_MARKS는 **글자로 베끼지 않는다** — drawer-audit.mjs를 읽어 배열을 뽑는다.
//   베끼면 두 곳이 어긋난다(한쪽만 고쳐지는 사고, 이 저장소가 반복해 겪은 계보).
function FAIL_MARKS목록(): string[] {
  const 경로 = path.join(__dirname, "..", "..", "tools", "drawer-audit.mjs");
  const src = fs.readFileSync(경로, "utf8");
  const 시작 = src.indexOf("const FAIL_MARKS = [");
  if (시작 < 0) throw new Error("FAIL_MARKS를 못 찾았다 — drawer-audit.mjs가 낡았다(이 시험을 손볼 것)");
  const 끝 = src.indexOf("];", 시작);
  const 몸통 = src.slice(시작, 끝);
  const 마크 = [...몸통.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (마크.length === 0) throw new Error("FAIL_MARKS를 하나도 못 뽑았다 — 추출 정규식이 낡았다");
  return 마크;
}

/**
 * 화면이 세는 그대로 — `/api/approvals`가 내보내는 목록(isRealVulnerability로 거른 것)에
 * preload.isUnassignedApproval(=서버 isUnassignedReview와 같은 식)을 건다.
 * ⚠ 구현(handlers)이 무엇을 부르는지 **안 본다.** 화면 잣대를 시험이 따로 세워야 거울이 안 된다.
 */
function 화면기준_미배정(): number {
  return listFindingReviews().filter((r) => isRealVulnerability(r.finding) && isUnassignedReview(r)).length;
}

const 진짜취약점: StandardFinding = { finding_type: "unsafe-pickle", severity: "high", evidence: "weights.bin pickle", source_tool: "modelscan" };
const 스캔오류: StandardFinding = { finding_type: "scan_error", severity: "high", evidence: "접속 실패", source_tool: "openvas" };
const 조사정보: StandardFinding = { finding_type: "ssh-detected", severity: "info", evidence: "SSH 22 열림", source_tool: "openvas" };

describe("결재·승인 대기 현황 — runApprovalStatus", () => {
  beforeEach(() => {
    resetAssetsForTests();
    resetApprovalsForTests();
    resetMaintenanceForTests();
  });

  it("데이터 0에서도 두 종류 결재 대기를 **숫자로** 0건이라 말한다", () => {
    const 답 = runApprovalStatus();
    expect(답, "취약점 결재 대기 숫자가 안 보인다").toContain("취약점 결재 대기 0건");
    expect(답, "점검 승인 대기 숫자가 안 보인다").toContain("점검 승인 대기 0건");
    expect(답, "담당자 미배정 숫자가 안 보인다").toContain("담당자 미배정 0건");
  });

  it("답에 폴백·거절 문구(FAIL_MARKS)가 하나도 안 섞인다", () => {
    const 답 = runApprovalStatus();
    for (const 마크 of FAIL_MARKS목록()) {
      expect(답, `「${마크}」가 0건 답에 섞였다 — 폴백처럼 읽힌다`).not.toContain(마크);
    }
  });

  it("0건이면 「다음 걸음」 대신 마침말이다 — 갈 화면이 없는데 안내하면 추측이 된다", () => {
    // ⚠ agenttools-cross의 계약(「현황 조회엔 다음걸음을 안 붙인다」)과 짝이다.
    const 답 = runApprovalStatus();
    expect(답).not.toContain("▸ 다음:");
    expect(답).toContain("지금은 결재·승인 둘 다 대기가 없습니다");
  });

  describe("자료를 심었을 때 — 화면과 같은 수를 말한다", () => {
    beforeEach(() => {
      registerAsset({ id: "vuln:host-a", name: "웹서버-A", path: "-", assetType: "server" });
      // 스캔 오류 1 + 조사정보 1 + 진짜 취약점 1 — 2026-08-01 실측 형상(605건 중 602건이 스캔 오류)의 축소판.
      recordFindings("vuln:host-a", [스캔오류, 조사정보, 진짜취약점]);
    });

    it("★★ 미배정이 스캔 오류·조사정보(info)를 안 센다 — 화면 배지와 같은 수", () => {
      const 답 = runApprovalStatus();
      const 화면 = 화면기준_미배정();
      expect(화면, "픽스처가 잘못됐다 — 진짜 취약점 1건만 미배정이어야 한다").toBe(1);
      expect(답, "미배정이 화면(=/api/approvals 걸러진 목록)과 다른 수를 말한다").toContain(`담당자 미배정 ${화면}건`);
      expect(답, "스캔 오류·조사정보까지 세면 3건이 나온다").not.toContain("담당자 미배정 3건");
    });

    it("★★ 진행중 미배정이 있어도 「대기가 없습니다」로 닫지 않는다 — 손댈 것이 남았다", () => {
      // 미검토(pending)를 진행중으로 옮긴다. approvalSummary.pending은 0이 되지만
      // 미배정(진행중 포함)은 1이다 — 첫 판은 이때 「대기 0건(미배정 1건) … 둘 다 대기가 없습니다」를 냈다.
      updateFindingReview("vuln:host-a", findingKey("vuln:host-a", 진짜취약점), { status: "in_progress" }, "시험");
      const fa = approvalSummary(listFindingReviews());
      expect(fa.pending, "픽스처 전제 — 미검토가 0이어야 이 갈래를 잰다").toBe(0);
      expect(화면기준_미배정(), "픽스처 전제 — 진행중 미배정 1건").toBe(1);

      const 답 = runApprovalStatus();
      expect(답).toContain("담당자 미배정 1건");
      expect(답, "손댈 것이 남았는데 마침말을 내면 거짓이다").not.toContain("지금은 결재·승인 둘 다 대기가 없습니다");
      expect(답, "대기가 있으면 갈 곳 한 줄을 준다").toContain("▸ 다음:");
    });

    it("★ 괄호로 포함관계를 주장하지 않는다 — 미배정은 미검토의 부분집합이 아니다", () => {
      expect(runApprovalStatus()).not.toMatch(/대기\s*\d+건\s*\(담당자 미배정/);
    });

    it("잣대는 approvalSummary·maintenanceSummary와 맞는다", () => {
      const fa = approvalSummary(listFindingReviews());
      const ms = maintenanceSummary(listMaintenanceItems());
      const 답 = runApprovalStatus();
      expect(답).toContain(`취약점 결재 대기 ${fa.pending}건`);
      expect(답).toContain(`점검 승인 대기 ${ms.reported}건`);
    });

    // B9(2026-09-12 야간 회귀) — 이 「다음 걸음」 문장이 화면 메뉴 라벨의 ✅를 그대로 옮겨
    // tone-realanswers.test.ts를 빨갛게 만들었다(겹치는기호 ✓). 화면 이름은 낱말만 싣는다.
    it("★ B9 — 대기가 있을 때 「다음 걸음」에 겹치는기호(✅ 등)가 없다", () => {
      const 답 = runApprovalStatus();
      expect(답, "이 시험은 대기 있음 분기를 밟아야 한다").toContain("▸ 다음:");
      const 기호위반 = 말투위반(답).filter((x) => x.이름.startsWith("뜻이 겹치는 기호"));
      expect(기호위반, `겹치는기호가 다시 샜다: ${기호위반.map((x) => x.이름).join(", ")}`).toEqual([]);
    });

    it("★ 갈 곳은 제품에 실재하는 화면 이름이다 — screenguide 화면위치 표가 출처", () => {
      const 안내 = fs.readFileSync(path.join(__dirname, "../src/engine/screenguide.ts"), "utf8");
      const 답 = runApprovalStatus();
      expect(답, "대기가 있으면 갈 곳을 준다").toContain("▸ 다음:");
      // 「유지보수 점검 화면」은 제품에 없는 이름이었다(2026-09-11 검토관 [중]).
      expect(답).not.toContain("유지보수 점검 화면");
      for (const 이름 of ["조치·승인", "정기 점검"]) {
        expect(답, `갈 곳에 「${이름}」이 없다`).toContain(이름);
        expect(안내, `screenguide에 없는 이름을 안내하고 있다: ${이름}`).toContain(이름);
      }
    });
  });
});

// ★ 2026-09-13 검토관 [하] 수리 — 설계관 지시서 tests ③이 커밋에서 빠져 있었다.
//   「점검 시드가 남은 상태에서 runApprovalStatus 답에 고지가 실리는가」를 **값으로** 재는 시험이
//   하나도 없었다. 있던 것은 소스 감시(seeddisclosure.test.ts — 호출 자리 수)뿐이라, 머리말이
//   붙은 채 **답 문자열이 실제로 어떻게 나가는지는 아무도 안 봤다**(예: 두 줄이 되지 않는가).
describe("★ 시드가 남아 있으면 답 머리에 예시 고지가 실린다 — 값 시험(소스 감시의 짝)", () => {
  // ⚠ 문구 **전체를 여기 베껴 적지 않는다** — handlers.ts의 예시데이터머리말()에서 원문을 읽어
  //   앞부분을 그대로 쓴다(베끼면 문구를 고칠 때 두 곳이 어긋난다 — 위 FAIL_MARKS목록()과 같은 규율).
  //   따옴표 안 원문은 끝에 줄바꿈 표기가 붙어 있어, 문장 첫 40자만 떼어 대조한다.
  function 머리말앞부분(): string {
    const src = agenttoolsSource();
    const i = src.indexOf('"⚠ 아래는');
    if (i < 0) throw new Error("예시데이터머리말의 문구를 못 읽었다 — 함수가 바뀌었나(이 시험을 고칠 것)");
    return src.slice(i + 1, i + 41);
  }

  beforeEach(() => {
    // 판정(예시데이터뿐인가)이 보는 다섯 표를 전부 비운다 — 하나라도 시드가 남으면 갈래가 섞인다.
    resetAssetsForTests();
    resetApprovalsForTests();
    resetMaintenanceForTests();
    resetTasksForTests();
    resetSecurityProductsForTests();
    resetFeedsForTests();
  });

  it("다섯 표가 비어 있으면 고지가 없다 — 이 시험이 늘 초록이 아님을 먼저 못 박는다", () => {
    expect(runApprovalStatus(), "시드가 없는데 예시 고지가 붙었다").not.toContain(머리말앞부분());
  });

  it("★ 점검 시드 한 건(제목+제품명 그대로)이 승인 대기로 남아 있으면 답에 고지가 실린다", () => {
    // maintenance.ts:412 seedSamplesIfEmpty()가 심는 여섯 쌍 중 3번(승인 대기)과 글자까지 같다.
    const 항목 = createMaintenanceItem({ title: "프롬프트 가드레일 점검", productName: "보안 상담 챗봇", scheduleDate: "2026-01-01" });
    submitReport(항목.id, { note: "시험용 점검 보고" }, "시험");

    const 답 = runApprovalStatus();
    expect(답, "점검 승인 대기 숫자를 말하면서 예시 고지가 없다").toContain(머리말앞부분());
    expect(답.startsWith(머리말앞부분()), "고지는 답 맨 앞이다 — 중간에 있으면 못 읽는다").toBe(true);
    expect(답, "잣대는 maintenanceSummary.reported 그대로다").toContain(
      `점검 승인 대기 ${maintenanceSummary(listMaintenanceItems()).reported}건`
    );
    // ⚠ 한 줄 계약(설계관 negatives) — 두 줄이 되면 execbrief.test.ts의 「머리말 한 줄 떼기」가
    //   반쪽만 떼어 원인이 안 보이는 빨강을 낸다.
    const 머리말줄 = 답.split("\n").filter((l) => l.startsWith("⚠ 아래는")).length;
    expect(머리말줄, "예시 고지는 한 줄이다").toBe(1);
  });
});
