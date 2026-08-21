import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";
import { resetSecurityProductsForTests, createProduct } from "../src/engine/securityproducts";

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
    // uncredentialedHosts는 비인증(원격) 스캔 경고용으로 함께 실려 온다 — 취약점 화면 업로더를
    // 없애고 인입을 대시보드 ＋로 모으면서(2026-07-27) 그 경고를 여기로 옮겼기 때문이다.
    // 이 CSV에는 인증 여부 정보가 없어 빈 배열이 정상.
    expect(res.body.vulnscan).toEqual({ hosts: 1, findings: 1, uncredentialedHosts: [] });
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
    // "방화벽" 카테고리 제품이 정확히 1개 있어야 category-single로 확정 라우팅된다(등록부 오염 방지 설계).
    createProduct({ name: "경계 방화벽", category: "방화벽" });
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

  // ── 원본 보관 토글 + 추출본(.md) 보관 (2026-08-22) ────────────────────────────
  // 왜 이 시험이 필요한가: 예전엔 이 창구(콘솔 ＋)만 sourcePath=undefined로 넘겨 **추출본도 원본도
  // 안 남았다** — 「내 문서」의 추출본 보기가 이 창구로 올린 문서에서는 늘 404였다. ingest-file
  // 창구와 잣대가 갈려 있던 것을 saveDocArtifacts 한 곳으로 합쳤고, 그 결과를 여기서 못박는다.
  // ⚠ 임베딩 서버가 없어 ingestText는 던진다(tryIngest가 삼킨다) — 그래서 hasSource(DB)가 아니라
  //   **파일이 실제로 생겼는지**를 잰다. 파일 보관은 인입 성공 여부와 무관하게 먼저 일어난다.
  describe("원본 보관 토글", () => {
    const 인입뿌리 = process.env.GIJO_INGEST_ROOT ?? "data";
    const 추출본 = (이름: string) => path.join(path.resolve(인입뿌리), "docs", "extracted", 이름 + ".md");
    const 원본 = (이름: string) => path.join(path.resolve(인입뿌리), "docs", "uploads", 이름);
    const 지우기 = (p: string) => { try { fs.unlinkSync(p); } catch { /* 없으면 그만 */ } };

    it("토글을 안 켜면 추출본(.md)만 남고 원본은 안 남는다", async () => {
      const 이름 = "보관끄기_시험.txt";
      지우기(추출본(이름)); 지우기(원본(이름));
      const res = await request(app)
        .post("/api/upload/auto")
        .set("Authorization", `Bearer ${token}`)
        .send({ filename: 이름, content: b64("사내 보안 지침 본문입니다. 원본은 보관하지 않습니다.") , forceType: "document" });
      expect(res.status).toBe(200);
      expect(fs.existsSync(추출본(이름)), "추출본(.md)은 토글과 무관하게 항상 남아야 한다").toBe(true);
      expect(fs.existsSync(원본(이름)), "토글을 안 켰는데 원본이 남았다 — 프라이버시 기본값 위반").toBe(false);
      expect(res.body.savedOriginal, "안 켰는데 savedOriginal이 참이면 화면이 거짓을 말한다").toBeFalsy();
      expect(res.body.mdSaved).toBe(true);
    });

    it("토글을 켜면 원본도 함께 남고 결과가 그 사실을 싣는다", async () => {
      // ⚠ 반드시 **새 이름**으로 잰다 — upsertDocMeta가 sourcePath를 COALESCE로 합쳐서,
      //   같은 documentId를 재사용하면 앞 시험의 상태가 섞여 결과가 오염된다.
      const 이름 = "보관켜기_시험.txt";
      지우기(추출본(이름)); 지우기(원본(이름));
      const res = await request(app)
        .post("/api/upload/auto")
        .set("Authorization", `Bearer ${token}`)
        .send({ filename: 이름, content: b64("원본까지 보관하는 문서입니다."), keepOriginal: true , forceType: "document" });
      expect(res.status).toBe(200);
      expect(fs.existsSync(추출본(이름))).toBe(true);
      expect(fs.existsSync(원본(이름)), "토글을 켰는데 원본이 안 남았다").toBe(true);
      expect(res.body.savedOriginal).toBe(true);
    });

    it("경로가 든 파일명은 basename으로 접혀 남의 자리를 못 건드린다", async () => {
      // 132f19c6이 ingest-file에서 막은 것과 같은 부류 — 이 창구에도 추출본 쓰기가 생겼으므로
      // 여기서 안 접으면 ../ 로 인입 뿌리 밖이나 형제 basename을 덮을 수 있다.
      const 실이름 = "경로접기_시험.txt";
      지우기(추출본(실이름)); 지우기(원본(실이름));
      const res = await request(app)
        .post("/api/upload/auto")
        .set("Authorization", `Bearer ${token}`)
        .send({ filename: "../../" + 실이름, content: b64("경로 조작 시도 본문"), keepOriginal: true , forceType: "document" });
      expect(res.status).toBe(200);
      expect(res.body.filename, "응답 파일명이 안 접혔다").toBe(실이름);
      expect(fs.existsSync(추출본(실이름)), "접힌 이름으로 추출본이 생겨야 한다").toBe(true);
      expect(fs.existsSync(원본(실이름))).toBe(true);
    });
  });
});
