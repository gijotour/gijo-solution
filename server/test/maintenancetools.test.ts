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
import { createMaintenanceItem, listMaintenanceItems } from "../src/engine/maintenance";
import { runSubmitMaintenanceReport, runReviewMaintenance } from "../src/engine/agenttools/handlers";

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
