import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { parseVulnReport, importVulnScan } from "../src/engine/vulnscan";
import { resetAssetsForTests, listAssets, getAsset } from "../src/engine/assets";
import { resetKevForTests } from "../src/engine/kev";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("vulnscan (Tenable Nessus 등 취약점 스캔 결과 업로드)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    resetKevForTests();
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

  it("keeps EPSS/VPR so exploit-likelihood can outrank CVSS-based severity", () => {
    // Nessus 실데이터의 핵심 패턴: Risk=Medium 인데 EPSS 0.94 (실제로는 활발히 악용됨)
    const csv =
      "Plugin ID,CVE,Risk,Host,Name,EPSS Score,VPR Score\n" +
      "189165,CVE-2022-21432,Medium,10.0.0.5,Oracle DB (Jan 2024 CPU),0.9439,8.9\n" +
      "189165,CVE-2023-38545,Medium,10.0.0.5,Oracle DB (Jan 2024 CPU),0.9439,8.9\n" +
      "777,CVE-2024-9999,Critical,10.0.0.5,조용한 Critical,0.0004,2.1\n";
    importVulnScan(csv, "csv", "nessus");
    const f = getAsset("vuln:10.0.0.5")!.findings;

    const oracle = f.find((x) => x.finding_type.startsWith("Oracle DB"))!;
    expect(oracle.severity).toBe("medium"); // CVSS 기반 등급은 낮지만
    expect(oracle.epss).toBeCloseTo(0.9439); // 실제 악용확률은 94%
    expect(oracle.vpr).toBe(8.9);

    // 악용확률로 정렬하면 Medium이 Critical보다 위로 올라온다 — 이게 이 지표를 넣은 이유
    const byEpss = [...f].sort((a, b) => (b.epss ?? -1) - (a.epss ?? -1));
    expect(byEpss[0].finding_type).toContain("Oracle DB");
    expect(byEpss[byEpss.length - 1].finding_type).toBe("조용한 Critical (CVE-2024-9999)");
  });

  it("merges a plugin found on several ports into one finding, listing the ports as context", () => {
    // 포트 스캐너 계열은 포트마다 한 줄씩 나오지만 조치 대상은 하나다(HTML 리포트 본문과 동일한 구조).
    const csv =
      "Plugin ID,Risk,Host,Protocol,Port,Name,Synopsis\n" +
      "14272,None,10.0.0.5,tcp,22,Netstat Portscanner,열린 포트\n" +
      "14272,None,10.0.0.5,tcp,111,Netstat Portscanner,열린 포트\n" +
      "14272,None,10.0.0.5,udp,53,Netstat Portscanner,열린 포트\n" +
      "999,High,10.0.0.5,tcp,1521,Oracle TNS 취약점,리스너\n" +
      "888,Critical,10.0.0.5,tcp,0,호스트 전체 이슈,전체\n";
    const result = importVulnScan(csv, "csv", "nessus");
    expect(result.rows).toBe(5);
    expect(result.findings).toBe(3); // 포트 3개짜리는 1건으로

    const f = getAsset("vuln:10.0.0.5")!.findings;
    const netstat = f.find((x) => x.finding_type.startsWith("Netstat"))!;
    expect(netstat.evidence).toContain("포트: tcp/111, tcp/22, udp/53");

    const oracle = f.find((x) => x.finding_type.startsWith("Oracle TNS"))!;
    expect(oracle.evidence).toContain("포트: tcp/1521"); // 조치에 필요한 맥락 보존

    // 포트 0은 "호스트 전체" 관례라 표기하지 않는다
    const whole = f.find((x) => x.finding_type.startsWith("호스트 전체"))!;
    expect(whole.evidence).not.toContain("포트:");
  });

  it("flags findings whose CVE is on the CISA KEV list (실제 악용 확인)", () => {
    resetKevForTests(["CVE-2021-44228", "CVE-2021-45046"]); // KEV 등재된 것으로 가정
    const csv =
      "Plugin ID,CVE,Risk,Host,Name\n" +
      "155999,CVE-2021-44228,Critical,10.0.0.5,Log4Shell\n" +
      "888,CVE-2020-0001,Critical,10.0.0.5,조용한 Critical\n";
    importVulnScan(csv, "csv", "nessus");
    const f = getAsset("vuln:10.0.0.5")!.findings;

    const log4j = f.find((x) => x.finding_type.startsWith("Log4Shell"))!;
    expect(log4j.kev).toBe(true);
    expect(log4j.kevCves).toEqual(["CVE-2021-44228"]);
    expect(log4j.evidence).toContain("CISA KEV");

    const quiet = f.find((x) => x.finding_type.startsWith("조용한"))!;
    expect(quiet.kev).toBeUndefined(); // KEV 아님
  });

  it("does not flag KEV when the list is empty (오프라인/미갱신)", () => {
    resetKevForTests([]);
    importVulnScan("Host,Name,Risk,CVE\nh,x,Critical,CVE-2021-44228\n", "csv", "s");
    expect(getAsset("vuln:h")!.findings[0].kev).toBeUndefined();
  });

  it("leaves EPSS/VPR undefined when the report has no such columns (0과 구분)", () => {
    importVulnScan("Host,Name,Risk\n10.0.0.7,항목,High\n", "csv", "s");
    const f = getAsset("vuln:10.0.0.7")!.findings[0];
    expect(f.epss).toBeUndefined();
    expect(f.vpr).toBeUndefined();
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

  it("parses a Nessus HTML report: host meta (DNS/OS) enriches the asset, vulns become findings", () => {
    // Nessus HTML 리포트의 실제 구조를 축약한 것 — 호스트 헤더 → Host Information → 취약점 블록.
    const html =
      `<div style="font-size: 22px; font-weight: 700;">192.168.219.98<div class="clear"></div></div>` +
      `<div>Host Information</div><div>DNS Name:<br>oracle.local<br>IP:<br>192.168.219.98<br>` +
      `MAC Address:<br>02:42:B0:30:1F:0C<br>OS:<br>Linux Kernel 4.18.0-553 on Red Hat Enterprise Linux release 8.10 (Ootpa)<br></div>` +
      `<div style="background: #91243E;" onclick="toggleSection('id12-container');">155999 - Apache Log4j &lt; 2.15.0 RCE<div> - </div></div>` +
      `<div id="id12-container"><div class="details-header">Synopsis</div><div>원격 코드 실행 취약점</div>` +
      `<div>Risk Factor<br>Critical</div><div>EPSS Score<br>0.9436</div><div>VPR Score<br>10.0</div>` +
      `<div>CVE-2021-44228</div><h2>tcp/0</h2></div>` +
      `<div style="background: #67ACE1;" onclick="toggleSection('id20-container');">14272 - Netstat Portscanner<div> - </div></div>` +
      `<div id="id20-container"><div class="details-header">Synopsis</div><div>열린 포트 목록</div>` +
      `<div>Risk Factor<br>None</div><h2>tcp/22</h2><h2>udp/53</h2></div>`;

    const result = importVulnScan(html, "html", "nessus-html");
    expect(result.hosts).toBe(1);
    expect(result.findings).toBe(2); // 플러그인 2개

    const asset = getAsset("vuln:192.168.219.98")!;
    // CSV로는 IP만 알 수 있던 것이 HTML에서는 이름·OS까지 채워진다
    expect(asset.name).toBe("oracle.local (192.168.219.98)");
    expect(asset.path).toBe("192.168.219.98");
    expect(asset.components.map((c) => c.name)).toContain("Red Hat Enterprise Linux release 8.10 (Ootpa)");

    const log4j = asset.findings.find((f) => f.finding_type.includes("Log4j"))!;
    expect(log4j.severity).toBe("critical"); // 색이 아니라 "Risk Factor" 텍스트로 판정
    expect(log4j.finding_type).toContain("CVE-2021-44228");
    expect(log4j.epss).toBeCloseTo(0.9436);
    expect(log4j.vpr).toBe(10);

    const netstat = asset.findings.find((f) => f.finding_type.includes("Netstat"))!;
    expect(netstat.severity).toBe("low"); // None → low
    expect(netstat.evidence).toContain("포트: tcp/22, udp/53"); // 여러 포트가 한 건으로 합쳐짐
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
