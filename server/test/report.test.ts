import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import JSZip from "jszip";

// REPORT_DIR은 report.ts 모듈 로드 시점에 읽히므로 import 전에 임시 디렉터리로 고정한다
// (운영 data/reports에 테스트용 [mock] 리포트가 실제로 쌓여 리포트 이력 100건 상한 밖으로
// 사용자 리포트가 밀려나던 사고가 있었다 — 반드시 격리해야 함).
const tmpReportDir = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-reports-"));
process.env.GIJO_REPORT_DIR = tmpReportDir;

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] 경영진 요약 — 이번 주 특이사항 없음"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

const { createApp } = await import("../src/app");
const { resetAssetsForTests, listAssets } = await import("../src/engine/assets");
const { maintenanceSummary, collectVulnReportData, vulnCases, stripMetaPreamble, deleteReport, pruneReports, deleteAllReports, listReportHistory } = await import("../src/engine/report");
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

  // 전-6 정직 · B13(2026-09-12, B11 검토관 이관 ②) — report.ts:380·1045가 `(epss*100).toFixed(1)`을
  // 직접 계산해 EPSS 0.0004를 「EPSS 0.0%」로 적던 병(값이 있는데 없다고 단정)을 tone.epss값표기소수1
  // 단일 출처로 닫았다. 산출된 .docx를 실제로 열어(zip→document.xml) 그 병이 사라졌는지 본다 —
  // API 200만 보는 시험은 「값이 맞다」를 증명하지 못한다(2026-08-22 「내 라이브 실측이 UI를 안
  // 지난다」의 같은 함정).
  it("★ B13 — 리포트 취약점 사례의 EPSS가 0.0004를 「0.0%」로, 0.9996을 「100.0%」로 거짓 단정하지 않는다", async () => {
    resetKevForTests([]);
    importVulnScan(
      "Plugin ID,CVE,Risk,Host,Name,epss_score\n" +
        "1,CVE-2099-0001,Medium,10.9.9.1,낮은EPSS취약점,0.0004\n" +
        "2,CVE-2099-0002,Medium,10.9.9.2,높은EPSS취약점,0.9996\n",
      "csv",
      "nessus"
    );

    const res = await request(app)
      .post("/api/report/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ondemand" });
    expect(res.status).toBe(200);

    const bytes = fs.readFileSync(res.body.filePath);
    const zip = await JSZip.loadAsync(bytes);
    const docFile = zip.file("word/document.xml");
    expect(docFile, "docx에 word/document.xml이 없다 — .docx 형식이 바뀌었다").toBeTruthy();
    const xml = await docFile!.async("string");

    // 아래쪽 — 0.0004는 「0.1% 미만」이어야 하고, 옛 병(「EPSS 0.0%」)이 없어야 한다.
    expect(xml).toContain("EPSS 0.1% 미만");
    expect(xml).not.toContain("EPSS 0.0%");
    // 위쪽 — 0.9996을 반올림으로 「100.0%」라 단정하지 않고 「99.9% 초과」로 적는다.
    expect(xml).toContain("EPSS 99.9% 초과");
    expect(xml).not.toContain("EPSS 100.0%");
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

// ── 삭제는 목록과 같은 것을 지운다 (2026-08-06 사용자 신고 "리포트 삭제했는데 데이터가 보임") ──
// 이력 목록(listReportHistory)은 md도 리포트로 나열한다 — 긴 작업 답변(longanswer)·파일 인입
// 진행내역(ingestreport)이 md로 저장된다(운영 실측 278개). 그런데 삭제 3종이 docx/pdf/json만
// 지워서, 담당자가 "전체 삭제"를 눌러도 md 리포트는 목록에 그대로 남았다.
// **목록에 보이는 확장자 집합과 지우는 집합은 같아야 한다** — 이 시험이 그 계약을 지킨다.
describe("리포트 삭제 — 목록에 보이는 것은 지워진다", () => {
  const 만들기 = (base: string, exts: string[]) => {
    for (const e of exts) fs.writeFileSync(path.join(tmpReportDir, `${base}.${e}`), `내용-${base}`);
  };
  const 남은파일 = () => fs.readdirSync(tmpReportDir).filter((f) => /\.(docx|pdf|md|json)$/i.test(f));

  it("★ 개별 삭제 — md 리포트도 지워진다", async () => {
    만들기(`answer-${Date.now()}`, ["md", "json"]);
    const base = 남은파일()[0].replace(/\.[a-z]+$/i, "");
    await deleteReport(base);
    expect(남은파일().filter((f) => f.startsWith(base)), "md가 남으면 목록에 계속 보인다").toHaveLength(0);
  });

  it("★ 전체 삭제 — md만 있는 리포트도 리포트로 세고 지운다", async () => {
    만들기(`answer-${Date.now()}`, ["md"]);
    만들기(`vuln-${Date.now()}`, ["docx", "json"]);
    const r = await deleteAllReports();
    expect(r.deletedReports).toBeGreaterThanOrEqual(2); // md만 있는 것도 리포트다
    expect(남은파일()).toHaveLength(0);
    expect((await listReportHistory()).length, "지웠는데 이력에 남으면 이 신고가 재발한다").toBe(0);
  });

  it("★ 일괄(N일 이전) 삭제 — 오래된 md도 지워진다", async () => {
    const 옛 = Date.now() - 40 * 86400000;
    만들기(`answer-${옛}`, ["md"]);         // 파일명 타임스탬프가 40일 전
    만들기(`answer-${Date.now()}`, ["md"]); // 방금 것 — 남아야 한다
    const r = await pruneReports(30);
    expect(r.deletedReports).toBe(1);
    const 남은 = 남은파일();
    expect(남은).toHaveLength(1);
    expect(남은[0]).not.toContain(String(옛));
  });
});

// ── ★ 거버넌스 표의 조번호가 원문과 맞는가 (2026-09-07) ─────────────────────────────
//
// ■ 왜: 이 표는 **고객 리포트에 그대로 인쇄된다.** 틀린 조번호는 「우리가 지어낸 근거」이고,
//   금융권 담당자가 그 번호로 규정을 찾으면 전혀 다른 조문이 나온다.
//   실측(2026-09-07 위키문헌 「전자금융감독규정 (제2025-4호)」 조문 제목 대조) — 두 개가 다 틀렸다:
//     · 제37조의4 = 「침해사고 통지의 방법」(2025-02-05 신설) — 취약점 분석·평가가 아니다.
//       취약점 분석·평가는 **제37조의2**(주기·내용)와 제37조의3(전문기관 지정)이다.
//     · 제21조   = 「정보처리시스템 구축 및 전자금융거래 관련 계약」 — 보호대책이 아니다.
//       정보처리시스템 보호대책은 **제14조**다.
// ■ 규율: 조번호를 고칠 때는 **원문 조문 제목을 열어 확인**하고 이 시험도 함께 고친다.
//   (「어디선가 본 번호」로 고치면 같은 사고가 이름만 바꿔 재발한다.)
describe("★ 리포트 거버넌스 — 전자금융감독규정 조번호가 원문과 맞다", () => {
  const 소스 = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "report.ts"), "utf8");
  const 줄 = 소스.split("\n").find((l) => l.includes('framework: "전자금융감독규정"')) ?? "";

  it("이 감시가 헛돌지 않는다 — 그 항목을 실제로 읽어 온다", () => {
    expect(줄.length, "전자금융감독규정 항목을 못 찾았다 — 표가 바뀌었으면 이 시험도 같이 볼 것").toBeGreaterThan(40);
    expect(줄).toContain("control:");
  });

  it("취약점 분석·평가는 제37조의2다 (제37조의4는 침해사고 통지)", () => {
    expect(줄, "취약점 분석·평가 근거 조번호가 없다").toContain("제37조의2");
    expect(줄, "제37조의4(침해사고 통지)를 취약점 분석·평가 근거로 적었다 — 2025-02-05 신설 조문이다").not.toContain("제37조의4");
  });

  it("정보처리시스템 보호대책은 제14조다 (제21조는 구축·계약)", () => {
    expect(줄, "정보처리시스템 보호대책 조번호가 없다").toContain("제14조");
    expect(줄, "제21조(구축 및 계약)를 보호대책 근거로 적었다").not.toContain("제21조");
  });
});
