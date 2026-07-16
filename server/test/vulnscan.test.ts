import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { parseVulnReport, importVulnScan } from "../src/engine/vulnscan";
import { resetAssetsForTests, listAssets, getAsset } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("vulnscan (Tenable Nessus 등 취약점 스캔 결과 업로드)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("parses a Nessus-style CSV with Host/Name/Risk/CVE columns via aliases", () => {
    const csv =
      "Host,Name,Risk,CVE,Synopsis\n" +
      "10.0.0.5,OpenSSL 취약점,Critical,CVE-2024-0001,원격 코드 실행\n" +
      "10.0.0.5,SMB 서명 미설정,Medium,,중간자 공격 가능\n" +
      "10.0.0.9,SSH 약한 알고리즘,Low,,\n";
    const parsed = parseVulnReport(csv, "csv");
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ host: "10.0.0.5", name: "OpenSSL 취약점", risk: "Critical", cve: "CVE-2024-0001" });
  });

  it("groups by host: one asset per host, vulnerabilities become findings with mapped severity", () => {
    const csv =
      "Host,Name,Risk,CVE\n" +
      "10.0.0.5,OpenSSL RCE,Critical,CVE-2024-0001\n" +
      "10.0.0.5,SMB signing,Medium,\n" +
      "10.0.0.9,SSH weak,Low,\n";
    const result = importVulnScan(csv, "csv", "nessus-2026-07");
    expect(result.hosts).toBe(2);
    expect(result.findings).toBe(3);

    const host5 = getAsset("vuln:10.0.0.5");
    expect(host5).toBeDefined();
    expect(host5!.assetType).toBe("infra-host");
    expect(host5!.owner).toBe("nessus-2026-07");
    expect(host5!.findings).toHaveLength(2);
    const crit = host5!.findings.find((f) => f.severity === "critical");
    expect(crit!.finding_type).toContain("CVE-2024-0001");
    expect(host5!.findings.some((f) => f.severity === "medium")).toBe(true);
  });

  it("collapses Nessus CVE-duplicated rows into one finding per plugin, keeping every CVE", () => {
    // Nessus는 플러그인 1건을 CVE 개수만큼 행으로 복제해 내보낸다(같은 Plugin ID/Name/Risk).
    const csv =
      "Plugin ID,CVE,Risk,Host,Name,Synopsis\n" +
      "189165,CVE-2022-21432,Medium,10.0.0.5,Oracle DB (January 2024 CPU),패치 누락\n" +
      "189165,CVE-2023-38545,Medium,10.0.0.5,Oracle DB (January 2024 CPU),패치 누락\n" +
      "189165,CVE-2023-38546,Medium,10.0.0.5,Oracle DB (January 2024 CPU),패치 누락\n" +
      "12345,CVE-2021-44228,Critical,10.0.0.5,Apache Log4j RCE,Log4Shell\n";
    const result = importVulnScan(csv, "csv", "nessus");

    expect(result.rows).toBe(4); // 원본 행
    expect(result.findings).toBe(2); // 실제 취약점(플러그인) — 부풀림 제거
    const host = getAsset("vuln:10.0.0.5")!;
    expect(host.findings).toHaveLength(2);

    const oracle = host.findings.find((f) => f.finding_type.startsWith("Oracle DB"))!;
    expect(oracle.finding_type).toBe("Oracle DB (January 2024 CPU) (CVE-2022-21432 외 2건)");
    // 대표 CVE만 제목에 쓰되 전체 목록은 evidence에 남아야 추적이 된다
    expect(oracle.evidence).toContain("CVE(3):");
    expect(oracle.evidence).toContain("CVE-2023-38546");
    expect(oracle.severity).toBe("medium");

    const log4j = host.findings.find((f) => f.finding_type.startsWith("Apache Log4j"))!;
    expect(log4j.finding_type).toBe("Apache Log4j RCE (CVE-2021-44228)"); // 단일 CVE는 그대로
    expect(log4j.severity).toBe("critical");
  });

  it("falls back to the finding name when the tool has no plugin id", () => {
    const csv = "Host,Name,Risk,CVE\n" + "h,같은 취약점,High,CVE-1\n" + "h,같은 취약점,High,CVE-2\n" + "h,다른 취약점,Low,\n";
    const result = importVulnScan(csv, "csv", "s");
    expect(result.rows).toBe(3);
    expect(result.findings).toBe(2); // 이름이 같으면 한 건으로 합침
  });

  it("maps risk strings to severities (critical/high/medium/low, none→low)", () => {
    const csv = "Host,Name,Risk\nh,a,High\nh,b,None\nh,c,Moderate\n";
    importVulnScan(csv, "csv", "s");
    const sevs = getAsset("vuln:h")!.findings.map((f) => f.severity).sort();
    expect(sevs).toEqual(["high", "low", "medium"]);
  });

  it("parses JSON array and {vulnerabilities:[...]} envelopes", () => {
    expect(parseVulnReport('[{"host":"1.1.1.1","name":"x","risk":"high"}]', "json")).toHaveLength(1);
    expect(parseVulnReport('{"vulnerabilities":[{"ip":"2.2.2.2","plugin_name":"y","severity":"low"}]}', "json")).toHaveLength(1);
  });

  it("POST /api/vulnscan/import works end to end and rejects bad input", async () => {
    const ok = await request(app)
      .post("/api/vulnscan/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Host,Name,Risk\n10.0.0.1,test vuln,High\n", format: "csv", source: "nessus" });
    expect(ok.status).toBe(200);
    expect(ok.body.hosts).toBe(1);
    expect(listAssets().some((a) => a.id === "vuln:10.0.0.1")).toBe(true);

    const bad = await request(app).post("/api/vulnscan/import").set("Authorization", `Bearer ${token}`).send({ format: "csv" });
    expect(bad.status).toBe(400);
  });
});
