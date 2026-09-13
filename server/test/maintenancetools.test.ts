// 정기 점검을 대화로 닫는다 — 점검서 올리기·승인/반려 (2026-08-31)
//
// 왜: 엔진(maintenance.ts)은 처음부터 다 있었는데 **대화 도구가 없어** 화면 버튼으로만
// 닫을 수 있었다. 더 나쁜 것은 화면이 담당자에게 말을 시켜 놓고(「「○○」 점검서를 올릴게」)
// 받지 못했다는 점이다 — 시킨 대로 쳤는데 아무 일도 안 일어나는 자리였다(대장 §4 끊김 3·4).
//
// ⚠ 라이브(운영 4000)로는 **끝까지 못 재운다** — 재려면 운영에 시험 점검 항목을 만들어야 하고,
//   그건 2026-08-19 리셋 이후의 「운영 데이터는 전부 실입력」 약속을 깨는 것이다.
//   그래서 여기서 등록→점검서→승인/반려 전 구간을 돈다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { createMaintenanceItem, listMaintenanceItems, submitReport, approveItem, rejectItem } from "../src/engine/maintenance";
import { 점검지연인가 } from "../src/engine/sla";
import { runSubmitMaintenanceReport, runReviewMaintenance, runMaintenanceStatus } from "../src/engine/agenttools/handlers";
import { maintenanceSummary } from "../src/engine/report";
import { todayLocal, plusDaysLocal } from "../src/util/date";

beforeEach(() => {
  // ⚠ 이벤트를 **먼저** 지운다 — maintenance_events가 items를 참조해서, 반대로 하면
  //   FOREIGN KEY로 막힌다(첫 실행에서 12건이 전부 그 이유로 실패했다).
  db.exec("DELETE FROM maintenance_events");
  db.exec("DELETE FROM maintenance_items");
});

function 점검하나(title = "방화벽 정책 점검", extra: { intervalDays?: number } = {}) {
  return createMaintenanceItem({
    title,
    productName: "방화벽 A",
    scheduleDate: "2026-09-01",
    ...extra,
  });
}

describe("점검서 올리기", () => {
  it("결과를 적어 내면 상태가 「승인 대기」로 간다", () => {
    점검하나();
    const 답 = runSubmitMaintenanceReport({ item: "방화벽 정책 점검", note: "이상 없음" });
    expect(답).toContain("점검서를 올렸습니다");
    expect(listMaintenanceItems()[0].status, "승인 대기로 안 갔다").toBe("reported");
  });

  it("★ 결과를 안 적으면 **묻는다** — 빈 점검서를 만들지 않는다", () => {
    점검하나();
    const 답 = runSubmitMaintenanceReport({ item: "방화벽 정책 점검" });
    expect(답).toContain("점검 결과");
    expect(listMaintenanceItems()[0].status, "결과 없이 상태가 바뀌었다").toBe("scheduled");
  });

  it("등록된 점검이 없으면 만들라고 알려 준다(빈손으로 안 돌려보낸다)", () => {
    const 답 = runSubmitMaintenanceReport({ item: "없는 점검", note: "x" });
    expect(답).toContain("등록된 정기 점검이 없습니다");
  });

  it("이름이 안 맞으면 **있는 것을 보여 준다** — 지어내지 않는다", () => {
    점검하나();
    const 답 = runSubmitMaintenanceReport({ item: "웹서버 점검", note: "x" });
    expect(답).toContain("못 찾았습니다");
    expect(답, "무엇이 있는지 알려 줘야 다시 칠 수 있다").toContain("방화벽 정책 점검");
  });

  it("여럿이면 고르라고 한다 — 아무거나 집지 않는다", () => {
    점검하나("방화벽 정책 점검");
    점검하나("웹서버 정기 점검");
    const 답 = runSubmitMaintenanceReport({ note: "이상 없음" });
    expect(답).toContain("어느 점검인지");
  });
});

describe("점검 승인·반려", () => {
  it("승인하면 완료로 닫힌다", () => {
    점검하나();
    runSubmitMaintenanceReport({ item: "방화벽 정책 점검", note: "이상 없음" });
    const 답 = runReviewMaintenance({ item: "방화벽 정책 점검", decision: "승인" });
    expect(답).toContain("승인했습니다");
    expect(listMaintenanceItems().find((x) => x.title === "방화벽 정책 점검")?.status).toBe("approved");
  });

  it("★ 반복 점검이면 **다음 회차가 자동으로 생긴다**(엔진이 만든다 — 여기서 날짜를 세지 않는다)", () => {
    점검하나("주간 방화벽 점검", { intervalDays: 7 });
    runSubmitMaintenanceReport({ item: "주간 방화벽 점검", note: "이상 없음" });
    const 답 = runReviewMaintenance({ item: "주간 방화벽 점검", decision: "승인" });
    expect(답, "다음 회차를 알려 줘야 한다").toContain("다음 회차");
    const 같은이름 = listMaintenanceItems().filter((x) => x.title === "주간 방화벽 점검");
    expect(같은이름.length, "다음 회차가 안 생겼다").toBe(2);
    expect(같은이름.some((x) => x.status === "scheduled"), "새 회차가 예정 상태가 아니다").toBe(true);
  });

  it("★★ 반려는 **이유가 없으면 안 된다** — 담당자가 무엇을 다시 할지 모른다", () => {
    점검하나();
    runSubmitMaintenanceReport({ item: "방화벽 정책 점검", note: "대충 봄" });
    const 답 = runReviewMaintenance({ item: "방화벽 정책 점검", decision: "반려" });
    expect(답).toContain("이유");
    expect(listMaintenanceItems()[0].status, "이유 없이 반려됐다").toBe("reported");
  });

  it("이유를 적으면 반려되고 그 이유가 남는다", () => {
    점검하나();
    runSubmitMaintenanceReport({ item: "방화벽 정책 점검", note: "대충 봄" });
    const 답 = runReviewMaintenance({ item: "방화벽 정책 점검", decision: "반려", reason: "증적이 없습니다" });
    expect(답).toContain("반려했습니다");
    expect(답).toContain("증적이 없습니다");
    expect(listMaintenanceItems()[0].status).toBe("rejected");
  });

  it("★ 승인 대기가 아닌 것은 **엔진이 막고**, 그 말을 그대로 전한다(잣대를 두 벌로 안 만든다)", () => {
    점검하나(); // scheduled 상태 — 점검서가 안 올라왔다
    const 답 = runReviewMaintenance({ item: "방화벽 정책 점검", decision: "승인" });
    expect(답, "승인 대기가 없다고 말해야 한다").toContain("승인 대기");
    expect(listMaintenanceItems()[0].status, "대기 아닌 것이 승인됐다").toBe("scheduled");
  });
});

// ★ SLA②(2026-09-13 사장님 결정 — 「오늘 마감은 지연이 아니다」) — report.ts의 거버넌스
//   지연 잣대(maintenanceSummary)와 대화 도구(runMaintenanceStatus)의 지연 잣대가 전엔
//   각각 `scheduleDate <= today`·`scheduleDate < today`로 갈려 있었다. 같은 데이터를
//   두 소비자에게 같이 물어 같은 지연 건수가 나오는지 짝으로 잰다(slaclue.test.ts와 같은 자세).
describe("지연 잣대 통일 — report.ts와 대화 도구(runMaintenanceStatus)가 같은 수를 말한다(SLA②)", () => {
  it("오늘·어제·내일 마감을 섞어도 두 소비자의 지연 건수가 같다 — 오늘 마감은 지연이 아니다", () => {
    createMaintenanceItem({ title: "오늘마감", productName: "FW-01", scheduleDate: todayLocal() });
    createMaintenanceItem({ title: "어제마감", productName: "FW-02", scheduleDate: plusDaysLocal(-1) });
    createMaintenanceItem({ title: "내일마감", productName: "FW-03", scheduleDate: plusDaysLocal(1) });

    const ms = maintenanceSummary(listMaintenanceItems());
    expect(ms.overdue, "report.ts 잣대 — 어제 마감 1건만 지연이다").toBe(1);

    const 답 = runMaintenanceStatus({});
    const m = /기한 초과 (\d+)건/.exec(답);
    expect(m, `대화 도구 답에서 기한 초과 건수를 못 뽑았다: ${답}`).not.toBeNull();
    expect(Number(m![1]), "대화 도구 잣대 — 오늘 마감을 지연으로 세면 안 된다").toBe(1);
    expect(Number(m![1]), "report.ts와 대화 도구의 지연 건수가 같아야 한다").toBe(ms.overdue);
  });
});

// ★★ 2026-09-13 검토관 [중] 수리 — 위 짝 시험은 **날짜 차원만** 쟀다(표본이 scheduled 셋뿐).
//   실제로 갈려 있던 두 번째 차원은 **모집단**이다: report.ts는 `scheduled`만, 대화 도구·데이터
//   카드는 `approved 아님` 전부를 셌다. 제품 자신의 시드(maintenance.ts 「오탐 룰 점검」 = 3일 전
//   **반려**)만으로 같은 DB에서 리포트 1건 vs 대화 도구 2건이 나왔다. 상태를 섞어 다시 잰다.
describe("지연 모집단 통일 — 승인 대기·반려로 기한이 지난 건도 두 소비자가 똑같이 센다(SLA②)", () => {
  it("scheduled·reported·rejected·approved를 섞어도 report·대화 도구·잎 함수가 같은 수를 말한다", () => {
    createMaintenanceItem({ title: "오늘예정", productName: "FW-01", scheduleDate: todayLocal() });
    createMaintenanceItem({ title: "어제예정", productName: "FW-02", scheduleDate: plusDaysLocal(-1) });
    createMaintenanceItem({ title: "내일예정", productName: "FW-03", scheduleDate: plusDaysLocal(1) });

    // 승인 대기(reported)인데 예정일이 3일 지난 것 — 화면에선 지연으로 보인다.
    const 대기 = createMaintenanceItem({ title: "승인대기지남", productName: "FW-04", scheduleDate: plusDaysLocal(-3) });
    submitReport(대기.id, { note: "점검함" }, "정요한");

    // 반려(rejected)인데 예정일이 2일 지난 것 — 제품 시드가 실제로 가진 모양이다.
    const 반려 = createMaintenanceItem({ title: "반려지남", productName: "FW-05", scheduleDate: plusDaysLocal(-2) });
    submitReport(반려.id, { note: "대충 봄" }, "정요한");
    rejectItem(반려.id, "정요한", "증적 부족");

    // 승인 완료(approved)는 예정일이 지났어도 지연이 아니다.
    const 완료 = createMaintenanceItem({ title: "완료지남", productName: "FW-06", scheduleDate: plusDaysLocal(-5) });
    submitReport(완료.id, { note: "점검함" }, "정요한");
    approveItem(완료.id, "정요한");

    const items = listMaintenanceItems();
    const 잎 = items.filter((m) => 점검지연인가(m, todayLocal())).length;
    expect(잎, "어제예정 + 승인대기지남 + 반려지남 = 3건").toBe(3);

    const ms = maintenanceSummary(items);
    expect(ms.overdue, "report.ts가 scheduled만 세면 1이 나온다 — 모집단이 갈린 자리").toBe(3);
    expect(ms.overdue).toBe(잎);

    const 답 = runMaintenanceStatus({});
    const m = /기한 초과 (\d+)건/.exec(답);
    expect(m, `대화 도구 답에서 기한 초과 건수를 못 뽑았다: ${답}`).not.toBeNull();
    expect(Number(m![1]), "리포트와 대화 도구가 같은 수를 말해야 한다").toBe(ms.overdue);

    // ⚠ 지연은 **예정(scheduled)의 부분집합이 아니다** — 보고서 문장이 「예정 N건(지연 M)」처럼
    //   품어 적으면 거짓 포함관계가 된다(이 값이 그 증거다: 예정 3건인데 지연 3건 중 2건은 밖이다).
    expect(ms.scheduled, "scheduled는 오늘·어제·내일 셋").toBe(3);
  });
});

describe("배선 — 화면이 시킨 말이 이 도구로 온다", () => {
  it("[점검서 올리기] 단추가 넣어 주는 문장이 강제 규칙에 걸린다", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const 셸 = readFileSync(
      join(__dirname, "..", "..", "client", "src", "renderer", "pages", "maintenance.html"), "utf8");
    // 화면이 실제로 넣는 문장(바뀌면 여기서 걸린다 — 약속과 코드가 같이 움직이게)
    expect(셸, "화면이 넣어 주는 문장이 바뀌었다").toContain("점검서를 올릴게");

    const 루프 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const i = 루프.indexOf('tool: "submit_maintenance_report"');
    expect(i, "강제 규칙이 없다 — 화면이 시킨 말을 받아 줄 곳이 없다").toBeGreaterThan(-1);
    const 앞 = 루프.lastIndexOf("    re: ", i);
    const re = eval(루프.slice(앞 + 8, 루프.indexOf("\n", 앞)).replace(/,\s*$/, "").replace(/\r$/, "")) as RegExp;
    expect(re.test("「방화벽 정책 점검」 점검서를 올릴게"), "화면 문장이 안 걸린다").toBe(true);
    // ⚠ 조회는 안 삼켜야 한다 — 낱말 가로채기 계보
    expect(re.test("점검 결과 알려줘"), "조회를 삼킨다").toBe(false);
  });

  it("승인 규칙이 **다른 승인**을 안 삼킨다", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const 루프 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const i = 루프.indexOf('tool: "review_maintenance"');
    const 앞 = 루프.lastIndexOf("    re: ", i);
    const re = eval(루프.slice(앞 + 8, 루프.indexOf("\n", 앞)).replace(/,\s*$/, "").replace(/\r$/, "")) as RegExp;
    expect(re.test("「방화벽 정책 점검」 점검 승인해줘")).toBe(true);
    for (const 남의것 of ["이 조치 승인해줘", "위험수용 승인해줘", "승인 대기 뭐 있어?"]) {
      expect(re.test(남의것), `${남의것}을 삼킨다 — 낱말 가로채기`).toBe(false);
    }
  });
});
