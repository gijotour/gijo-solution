import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// REPORT_DIR은 report.ts 모듈 로드 시점에 읽히므로 import 전에 임시 디렉터리로 고정한다
// (운영 data/reports에 테스트용 [mock] 리포트가 실제로 쌓여 리포트 이력 100건 상한 밖으로
// 사용자 리포트가 밀려나던 사고가 있었다 — 반드시 격리해야 함).
const tmpReportDir = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-reports-"));
process.env.GIJO_REPORT_DIR = tmpReportDir;

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock] 경영진 요약 — 이번 주 특이사항 없음"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

const { createApp } = await import("../src/app");
const { resetAssetsForTests, listAssets } = await import("../src/engine/assets");
const { maintenanceSummary, collectVulnReportData, vulnCases, stripMetaPreamble } = await import("../src/engine/report");
const { importVulnScan } = await import("../src/engine/vulnscan");
const { resetKevForTests } = await import("../src/engine/kev");
const { createTask, resetTasksForTests } = await import("../src/engine/tasks");
const { todayLocal } = await import("../src/util/date");
const { listAudit } = await import("../src/engine/audit");
import type { MaintenanceItem } from "../src/engine/maintenance";

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

  it("삭제·일괄삭제·전체삭제는 감사로그를 남긴다 — 실측(2026-07-21): 이 로그가 없어서 운영 리포트가 통째로 사라졌는데 누가 언제 지웠는지 전혀 알 수 없었다", async () => {
    const gen = await request(app).post("/api/report/generate").set("Authorization", `Bearer ${token}`).send({ type: "ondemand" });
    const base = /([\w-]+)\.docx$/.exec(gen.body.filePath)![1];

    const del = await request(app).delete(`/api/report/${base}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(listAudit({ kind: "write" }).some((e) => e.action === "리포트 삭제" && e.target === base)).toBe(true);

    const prune = await request(app).post("/api/report/prune").set("Authorization", `Bearer ${token}`).send({ olderThanDays: 9999 });
    expect(prune.status).toBe(200);
    expect(listAudit({ kind: "write" }).some((e) => e.action.startsWith("리포트 일괄 삭제"))).toBe(true);

    const delAll = await request(app).post("/api/report/delete-all").set("Authorization", `Bearer ${token}`);
    expect(delAll.status).toBe(200);
    expect(listAudit({ kind: "write" }).some((e) => e.action === "리포트 전체 삭제")).toBe(true);
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
