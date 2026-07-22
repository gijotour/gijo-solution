import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { computeKpiSnapshot, resetKpiForTests, vulnerabilityBurndown } from "../src/engine/kpi";
import { importVulnScan } from "../src/engine/vulnscan";
import { resetKevForTests } from "../src/engine/kev";
import { resetAssetsForTests, seedSampleAssetsIfEmpty } from "../src/engine/assets";
import { createTask, setTaskDone, resetTasksForTests } from "../src/engine/tasks";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("kpi (통합 보안 KPI 대시보드)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    resetKpiForTests();
    // 테스트 간 자산 상태 격리: 시드 3개로 되돌린다(취약점 임포트 테스트가 자산을 남기지 않게).
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
    resetTasksForTests();
    resetKevForTests();
    app = createApp();
    token = await login(app);
  });

  it("aggregates all domains from the seeded data into one snapshot", async () => {
    const snap = await computeKpiSnapshot();
    // 시드: 자산 3 · 점검 6 · CTI 5(4매칭·자산3) · 컴플라이언스 KISA 카탈로그
    expect(snap.assets.total).toBe(3);
    expect(snap.inspections.total).toBe(6);
    expect(snap.inspections.overdue).toBeGreaterThanOrEqual(1);
    expect(snap.cti.totalFindings).toBe(5);
    expect(snap.cti.matchedFindings).toBe(4);
    expect(snap.cti.affectedAssets).toBe(3);
    expect(snap.compliance.total).toBeGreaterThanOrEqual(20); // KISA 위협 카탈로그
    expect(snap.compliance.coverageRate).toBeGreaterThanOrEqual(0);
    // 모든 도메인 키가 존재하는지(리포트/화면이 의존)
    for (const k of ["assets", "findings", "inspections", "cti", "compliance", "learning"] as const) {
      expect(snap[k]).toBeTruthy();
    }
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("종합 보안태세 점수와 요소 값을 포함한다(0~100)", async () => {
    const snap = await computeKpiSnapshot();
    expect(snap.posture).toBeTruthy();
    expect(snap.posture.score).toBeGreaterThanOrEqual(0);
    expect(snap.posture.score).toBeLessThanOrEqual(100);
    expect(["good", "fair", "poor"]).toContain(snap.posture.band);
    expect(snap.posture.factors.length).toBe(3);
  });

  it("MTTR: 완료건 3건 미만이면 null(집계 중), 3건↑이면 평균일을 계산한다", async () => {
    // 완료건 없음 → null
    expect((await computeKpiSnapshot()).mttrDays).toBeNull();
    // vuln: 조치 태스크 3건 생성 후 완료 처리 → 완료시각 기록됨
    const t1 = createTask({ text: "조치1", ref: "vuln:10.0.0.1" });
    const t2 = createTask({ text: "조치2", ref: "vuln:10.0.0.2" });
    const t3 = createTask({ text: "조치3", ref: "vuln:10.0.0.3" });
    setTaskDone(t1.id, true); setTaskDone(t2.id, true); setTaskDone(t3.id, true);
    const snap = await computeKpiSnapshot();
    expect(snap.mttrDays).not.toBeNull();
    expect(snap.mttrDays).toBeGreaterThanOrEqual(0); // 방금 완료 → 거의 0일
  });

  it("includes vulnerability remediation metrics (active/KEV/fixed) from vuln scans", async () => {
    resetKevForTests(["CVE-2021-44228"]); // KEV 등재로 가정
    // 1차 스캔: 3건 모두 new
    importVulnScan(
      "Plugin ID,CVE,Risk,Host,Name\n" +
        "1,CVE-2021-44228,Critical,10.9.9.9,Log4Shell\n" +
        "2,CVE-2020-1,High,10.9.9.9,취약점B\n" +
        "3,,Medium,10.9.9.9,취약점C\n",
      "csv",
      "nessus"
    );
    let v = (await computeKpiSnapshot()).vulnerabilities;
    expect(v.hosts).toBe(1);
    expect(v.active).toBe(3);
    expect(v.critical).toBe(1);
    expect(v.kev).toBe(1); // Log4Shell
    expect(v.newCount).toBe(3);
    expect(v.newlyFixed).toBe(0);

    // 2차 스캔: B/C 사라짐 → fixed 2, active 1
    importVulnScan("Plugin ID,CVE,Risk,Host,Name\n1,CVE-2021-44228,Critical,10.9.9.9,Log4Shell\n", "csv", "nessus");
    v = (await computeKpiSnapshot()).vulnerabilities;
    expect(v.active).toBe(1);
    expect(v.newlyFixed).toBe(2);
    expect(v.remediationRate).toBe(67); // 2 / (1 + 2) = 67%
  });

  it("aggregates remediation SLA status from vuln-linked tasks", async () => {
    const day = 86400000;
    createTask({ text: "[조치] A", ref: "vuln:10.0.0.1", dueAt: Date.now() + 5 * day }); // 여유
    createTask({ text: "[조치] B", ref: "vuln:10.0.0.1", dueAt: Date.now() + 2 * day }); // 임박
    createTask({ text: "[조치] C", ref: "vuln:10.0.0.1", dueAt: Date.now() - 1 * day }); // 초과
    createTask({ text: "일반 할일" }); // ref 없음 → 집계 제외

    const r = (await computeKpiSnapshot()).remediation;
    expect(r.tasks).toBe(3); // ref=vuln: 인 것만
    expect(r.overdue).toBe(1);
    expect(r.dueSoon).toBe(1);
    expect(r.slaCompliance).toBe(67); // 3건 중 2건 기한 내 = 67%
  });

  it("reconstructs a vulnerability burn-down from real scan history (재스캔마다 감소)", async () => {
    resetAssetsForTests(); // 시드 자산 제거 — 이 테스트의 호스트만 집계되게
    const scan = (rows: string) => importVulnScan("Plugin ID,CVE,Risk,Host,Name\n" + rows, "csv", "s");

    scan("1,CVE-2021-1,Critical,10.0.0.5,A\n2,CVE-2021-2,High,10.0.0.5,B\n3,CVE-2021-3,Medium,10.0.0.5,C\n");
    await new Promise((r) => setTimeout(r, 3)); // scannedAt(ms)이 겹치지 않게
    scan("1,CVE-2021-1,Critical,10.0.0.5,A\n"); // B·C 고쳐짐 → 열린 것 3→1

    const bd = vulnerabilityBurndown();
    expect(bd.length).toBe(2); // 스캔 2회 = 시점 2개
    expect(bd[0].active).toBe(3);
    expect(bd[1].active).toBe(1); // 번다운: 열린 취약점 감소
    expect(bd[1].fixed).toBe(2); // 2건 고쳐짐(누적)
    expect(bd[0].at).toBeLessThan(bd[1].at); // 시간순
  });

  it("GET /api/kpi returns current + trend and persists one row per day", async () => {
    const first = await request(app).get("/api/kpi").set(auth());
    expect(first.status).toBe(200);
    expect(first.body.current.assets.total).toBe(3);
    expect(Array.isArray(first.body.trend)).toBe(true);
    expect(first.body.trend).toHaveLength(1); // 오늘 스냅샷 1건
    expect(first.body.trend[0].date).toBe(first.body.current.date);

    // 같은 날 다시 호출 → 새 행이 아니라 갱신(하루 한 행)
    const second = await request(app).get("/api/kpi").set(auth());
    expect(second.body.trend).toHaveLength(1);
  });

  it("requires auth", async () => {
    expect((await request(app).get("/api/kpi")).status).toBe(401);
  });
});
