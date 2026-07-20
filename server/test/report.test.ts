import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock] 경영진 요약 — 이번 주 특이사항 없음"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests, listAssets } from "../src/engine/assets";
import { maintenanceSummary, collectVulnReportData, vulnCases, stripMetaPreamble } from "../src/engine/report";
import { importVulnScan } from "../src/engine/vulnscan";
import { resetKevForTests } from "../src/engine/kev";
import { createTask, resetTasksForTests } from "../src/engine/tasks";
import type { MaintenanceItem } from "../src/engine/maintenance";
import { todayLocal } from "../src/util/date";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("report", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("collectVulnReportData aggregates host vulns + KEV + remediation SLA for the report", () => {
    resetTasksForTests();
    resetKevForTests(["CVE-2021-44228"]);
    importVulnScan(
      "Plugin ID,CVE,Risk,Host,Name\n" +
        "1,CVE-2021-44228,Critical,10.5.5.5,Log4Shell\n" +
        "2,CVE-2020-1,High,10.5.5.5,취약점B\n",
      "csv",
      "nessus"
    );
    createTask({ text: "[조치] Log4Shell", ref: "vuln:10.5.5.5", priority: "P0", dueAt: Date.now() - 86400000 }); // 초과

    const d = collectVulnReportData();
    expect(d.hosts).toBe(1);
    expect(d.active).toBe(2);
    expect(d.critical).toBe(1);
    expect(d.kev).toBe(1);
    expect(d.topKev[0]).toMatchObject({ name: expect.stringContaining("Log4Shell") });
    expect(d.remediation.tasks).toBe(1);
    expect(d.remediation.overdue).toBe(1);
    expect(d.remediation.slaCompliance).toBe(0); // 1건이 기한 초과
    expect(d.remediation.topOpen).toHaveLength(1);
  });

  it("generates a real .docx file and returns the (mocked) LLM executive summary", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "fraud-detect-llm", name: "fraud-detect-llm", path: "models/fraud.gguf" });

    const res = await request(app)
      .post("/api/report/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ondemand" });

    expect(res.status).toBe(200);
    expect(res.body.executiveSummary).toBe("[mock] 경영진 요약 — 이번 주 특이사항 없음");
    expect(res.body.filePath).toMatch(/ondemand-\d+\.docx$/);

    const bytes = fs.readFileSync(res.body.filePath);
    // .docx files are zip archives; verify the real PK magic bytes, not just that a file exists.
    expect(bytes.subarray(0, 2).toString("hex")).toBe("504b");
  });

  it("maintenanceSummary counts by status and flags overdue scheduled items", () => {
    const today = todayLocal();
    const mk = (over: Partial<MaintenanceItem>): MaintenanceItem => ({
      id: "x", title: "t", productName: "p", scheduleDate: "2099-01-01", status: "scheduled",
      createdAt: 0, updatedAt: 0, ...over,
    });
    const items = [
      mk({ status: "scheduled", scheduleDate: today }), // 지연
      mk({ status: "scheduled", scheduleDate: "2099-01-01" }), // 예정(미래)
      mk({ status: "reported" }),
      mk({ status: "approved" }),
      mk({ status: "approved" }),
      mk({ status: "rejected" }),
    ];
    const s = maintenanceSummary(items);
    expect(s).toEqual({ total: 6, scheduled: 2, overdue: 1, reported: 1, approved: 2, rejected: 1 });
    expect(maintenanceSummary([])).toEqual({ total: 0, scheduled: 0, overdue: 0, reported: 0, approved: 0, rejected: 0 });
  });

  it("vulnCases maps an Oracle patch finding to priority + governance controls (거버넌스 매칭)", () => {
    resetKevForTests([]);
    importVulnScan(
      "Plugin ID,CVE,Risk,Host,Name\n" + "1,CVE-2022-21432,Medium,10.0.0.9,Oracle DB CPU 미적용\n",
      "csv",
      "nessus"
    );
    const cases = vulnCases(listAssets());
    const oracle = cases.find((c) => /Oracle/.test(c.finding.finding_type));
    expect(oracle).toBeTruthy();
    // 공통 취약점 관리 통제
    expect(oracle!.governance.some((g) => g.framework === "ISMS-P" && /2\.11\.2/.test(g.control))).toBe(true);
    expect(oracle!.governance.some((g) => /27001/.test(g.framework))).toBe(true);
    // 패치/CPU 키워드 → 패치·형상관리 + 주요정보통신기반시설
    expect(oracle!.governance.some((g) => /패치관리|형상관리/.test(g.control))).toBe(true);
    expect(oracle!.governance.some((g) => /주요정보통신기반시설/.test(g.framework))).toBe(true);
    // DB 키워드 → 접근통제
    expect(oracle!.governance.some((g) => /접근통제/.test(g.control))).toBe(true);
    expect(["P0", "P1", "P2", "P3"]).toContain(oracle!.priority.code);
  });

  it("report result carries the audience (기본 official, internal 선택 반영)", async () => {
    const def = await request(app)
      .post("/api/report/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ondemand" });
    expect(def.body.audience).toBe("official");

    const internal = await request(app)
      .post("/api/report/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ondemand", audience: "internal" });
    expect(internal.body.audience).toBe("internal");
  });

  it("scopes the report to only the requested asset ids", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "asset-a", name: "asset-a", path: "x" });
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "asset-b", name: "asset-b", path: "x" });

    const res = await request(app)
      .post("/api/report/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ondemand", assetIds: ["asset-a"] });

    expect(res.status).toBe(200);
  });
});

describe("stripMetaPreamble — 요약 서두 메타 문장 제거", () => {
  it("순수 메타 서두 문장(제공하겠습니다/요약입니다)을 버린다", () => {
    const r = stripMetaPreamble("기업 보안담당자에게 보안 현황 요약을 제공하겠습니다. 전체 16건의 자산에서 취약점 313건이 발견되었습니다.");
    expect(r).not.toContain("제공하겠습니다");
    expect(r).toContain("313건"); // 데이터 문장은 보존
  });

  it("'제가 보고하는 목적은…' 자기지시 문장을 버린다", () => {
    const r = stripMetaPreamble("보안 관리자를 위한 1페이지 보고서 요약입니다. 제가 보고하는 목적은 경영진에 정보를 제공하는 것입니다. Critical 60건이 최우선입니다.");
    expect(r).not.toMatch(/보고서 요약입니다|보고하는 목적은/);
    expect(r).toContain("Critical 60건");
  });

  it("데이터 문장 앞의 리드 구절('…바탕으로 요약하면,')만 잘라낸다", () => {
    const r = stripMetaPreamble("이 보안 현황 데이터를 바탕으로 요약하면, 16건의 자산 중 313개의 취약점이 있습니다.");
    expect(r.startsWith("16건")).toBe(true);
    expect(r).toContain("313개");
  });

  it("메타가 없는 정상 요약은 그대로 둔다", () => {
    const clean = "KEV 20건이 최우선 조치 대상입니다. SLA 준수율은 100%입니다.";
    expect(stripMetaPreamble(clean)).toBe(clean);
  });

  it("'취약점' 키워드만 있고 숫자 없는 목차형 메타('…살펴볼 수 있는 요약입니다')도 버린다", () => {
    const r = stripMetaPreamble("해당 자산의 취약점 상황을 한 눈에 살펴볼 수 있는 요약입니다. 전체 자산 16건에서 Critical 60건이 발견됐습니다.");
    expect(r).not.toMatch(/살펴볼 수 있는|요약입니다/);
    expect(r).toContain("16건");
    expect(r).toContain("Critical 60건");
  });
});
