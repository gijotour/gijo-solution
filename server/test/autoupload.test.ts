import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";
import { resetSecurityProductsForTests } from "../src/engine/securityproducts";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("스마트 통합 업로드 — 파일 유형 자동 판별·라우팅", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    resetSecurityProductsForTests();
    app = createApp();
    token = await login(app);
  });

  it("스캔 CSV(host+risk 헤더)는 취약점 파이프라인으로 라우팅되고 자산이 등록된다", async () => {
    const res = await request(app)
      .post("/api/upload/auto")
      .set("Authorization", `Bearer ${token}`)
      .send({ filename: "scan.csv", content: b64("Host,Name,Risk,CVE\n10.9.9.9,Test Vuln,High,CVE-2024-1") });
    expect(res.status).toBe(200);
    expect(res.body.routedTo).toBe("vulnscan");
    expect(res.body.vulnscan).toEqual({ hosts: 1, findings: 1 });
    const asset = await request(app).get("/api/assets/vuln:10.9.9.9").set("Authorization", `Bearer ${token}`);
    expect(asset.status).toBe(200);
  });

  it("Nessus XML은 확장자가 달라도 내용으로 감지한다", async () => {
    const xml = `<NessusClientData_v2><Report><ReportHost name="10.9.9.8"><ReportItem pluginID="1" pluginName="V" severity="2" port="80" protocol="tcp"><risk_factor>Medium</risk_factor></ReportItem></ReportHost></Report></NessusClientData_v2>`;
    const res = await request(app)
      .post("/api/upload/auto")
      .set("Authorization", `Bearer ${token}`)
      .send({ filename: "export.xml.txt", content: b64(xml) });
    expect(res.body.routedTo).toBe("vulnscan");
    expect(res.body.reason).toContain("Nessus");
  });

  it("파일명에 '매뉴얼'이 있으면 보안제품 등록부로 라우팅된다(내용 추출 실패해도 등록은 진행)", async () => {
    const res = await request(app)
      .post("/api/upload/auto")
      .set("Authorization", `Bearer ${token}`)
      .send({ filename: "FW장비_운영매뉴얼.txt", content: b64("방화벽 운영 절차") });
    expect(res.status).toBe(200);
    expect(res.body.routedTo).toBe("product-manual");
    expect(res.body.manual.productName).toBeTruthy();
  });

  it("일반 CSV(스캔 헤더 아님)는 취약점이 아니라 문서 경로로 간다", async () => {
    const res = await request(app)
      .post("/api/upload/auto")
      .set("Authorization", `Bearer ${token}`)
      .send({ filename: "직원명단.csv", content: b64("이름,부서\n홍길동,보안팀") });
    // 문서 경로는 테스트 환경에서 임베딩 서버가 없어 400으로 떨어질 수 있다 — vulnscan으로
    // 오라우팅되지 않는 것이 검증 포인트.
    expect(res.body.routedTo === "vulnscan").toBe(false);
  });

  it("filename/content 누락은 400, 토큰 없으면 401", async () => {
    const noBody = await request(app).post("/api/upload/auto").set("Authorization", `Bearer ${token}`).send({});
    expect(noBody.status).toBe(400);
    const noAuth = await request(app).post("/api/upload/auto").send({ filename: "a.csv", content: b64("x") });
    expect(noAuth.status).toBe(401);
  });
});
