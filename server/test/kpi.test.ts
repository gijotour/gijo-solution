import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { computeKpiSnapshot, resetKpiForTests } from "../src/engine/kpi";
import { importVulnScan } from "../src/engine/vulnscan";
import { resetKevForTests } from "../src/engine/kev";
import { resetAssetsForTests, seedSampleAssetsIfEmpty } from "../src/engine/assets";

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
