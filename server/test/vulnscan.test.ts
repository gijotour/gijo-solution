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
