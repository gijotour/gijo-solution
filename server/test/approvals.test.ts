import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// LLM은 스텁으로 대체한다(리포 공통 패턴 — agentloop·agenttools 등과 동일).
//
// 왜: 이 파일의 triage 라우트 테스트는 **라우트 계약**(200·draft 문자열·count)을 보는 것이지
// 모델 답변 품질을 보는 게 아니다. 그런데 스텁이 없어 실제 llama-server를 호출했고, 서버가
// 떠 있으면 진짜 추론을 하다 15초 제한을 넘겨 전체 병렬 실행에서 흔들렸다(2026-07-21).
// GPU 상태에 따라 통과 여부가 갈리는 테스트는 회귀를 잡아주지 못한다.
const TRIAGE_DRAFT = "1. unsafe-pickle (m1) — 즉시 조치. 근거: KEV 등재.\n2. 권장 조치 기한: 7일 이내.";
const mockChat = vi.fn(async () => TRIAGE_DRAFT);
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests, recordFindings } from "../src/engine/assets";
import { resetApprovalsForTests, findingKey, buildTriagePrompt, prioritizedReviews, approvalSummary } from "../src/engine/approvals";
import { isRealVulnerability } from "../src/engine/agenttools";
import type { StandardFinding } from "../src/engine/bridge";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

const FINDING: StandardFinding = {
  finding_type: "unsafe-pickle",
  severity: "high",
  evidence: "torch model uses pickle in weights.bin",
  source_tool: "modelscan",
};

describe("approvals (finding 검토 워크플로우)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    resetAssetsForTests();
    resetApprovalsForTests();
    app = createApp();
    token = await login(app);
    await request(app)
      .post("/api/assets")
      .set(auth())
      .send({ id: "m1", name: "모델1", path: "models/m1.gguf", components: [{ name: "weights.bin", version: "1", license: "MIT" }] });
    recordFindings("m1", [FINDING]); // 스캔 결과 주입
  });

  it("lists findings as pending by default with a summary", async () => {
    const res = await request(app).get("/api/approvals").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].status).toBe("pending");
    expect(res.body.reviews[0].assetName).toBe("모델1");
    // scanFailed 추가(2026-08-01) — 스캐너 오류를 취약점과 분리해 세면서 생긴 칸.
    expect(res.body.summary).toEqual({ total: 1, pending: 1, in_progress: 0, verifying: 0, approved: 0, rejected: 0, overdue: 0, scanFailed: 0 });
  });

  it("조치 관리: 담당자·기한(SLA) 배정 — status 없이 배정만 가능", async () => {
    const key = findingKey("m1", FINDING);
    // 판정 없이 담당자·기한만 배정
    const r = await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ assignee: "김보안", dueDate: "2999-12-31" });
    expect(r.status).toBe(200);
    let review = (await request(app).get("/api/approvals").set(auth())).body.reviews[0];
    expect(review.assignee).toBe("김보안");
    expect(review.dueDate).toBe("2999-12-31");
    expect(review.status).toBe("pending"); // 판정은 여전히 미검토
    expect(review.overdue).toBe(false); // 미래 기한

    // 판정(approved)을 추가해도 담당자·기한은 유지(merge)
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "approved" });
    review = (await request(app).get("/api/approvals").set(auth())).body.reviews[0];
    expect(review.status).toBe("approved");
    expect(review.assignee).toBe("김보안");
    expect(review.dueDate).toBe("2999-12-31");
  });

  it("조치 관리: 지난 기한은 overdue로 계산(rejected는 제외)", async () => {
    const key = findingKey("m1", FINDING);
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ assignee: "김보안", dueDate: "2000-01-01" });
    let body = (await request(app).get("/api/approvals").set(auth())).body;
    expect(body.reviews[0].overdue).toBe(true);
    expect(body.summary.overdue).toBe(1);

    // 오탐(rejected)으로 판정하면 조치 대상이 아니므로 overdue 아님
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "rejected" });
    body = (await request(app).get("/api/approvals").set(auth())).body;
    expect(body.reviews[0].overdue).toBe(false);
    expect(body.summary.overdue).toBe(0);
  });

  it("조치 관리: 잘못된 기한 형식은 400", async () => {
    const key = findingKey("m1", FINDING);
    const r = await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ dueDate: "2026/01/01" });
    expect(r.status).toBe(400);
  });

  it("우선순위(오늘의 조치): KEV > EPSS > VPR 순, 오탐 제외", async () => {
    const kevF: StandardFinding = { finding_type: "kev-exploited", severity: "medium", evidence: "y", source_tool: "nessus", epss: 0.5, vpr: 5, kev: true };
    const epssF: StandardFinding = { finding_type: "high-epss", severity: "medium", evidence: "z", source_tool: "nessus", epss: 0.9, vpr: 4 };
    const vprF: StandardFinding = { finding_type: "high-vpr", severity: "critical", evidence: "x", source_tool: "nessus", epss: 0.01, vpr: 9 };
    recordFindings("m1", [vprF, kevF, epssF]); // 순서 섞어 주입

    let body = (await request(app).get("/api/approvals/priorities").set(auth())).body;
    expect(body.items.map((i: { finding: StandardFinding }) => i.finding.finding_type)).toEqual(["kev-exploited", "high-epss", "high-vpr"]);
    expect(body.items[0].score).toBeGreaterThan(body.items[1].score);

    // KEV 건을 오탐 반려 → 우선순위 목록에서 제외
    await request(app).post(`/api/approvals/m1/${findingKey("m1", kevF)}`).set(auth()).send({ status: "rejected" });
    body = (await request(app).get("/api/approvals/priorities").set(auth())).body;
    expect(body.items.map((i: { finding: StandardFinding }) => i.finding.finding_type)).toEqual(["high-epss", "high-vpr"]);
  });

  it("AI triage 프롬프트: 상위 취약점·지시·온톨로지 근거를 담는다", () => {
    const top = prioritizedReviews(5);
    const prompt = buildTriagePrompt(top, "관련 규칙·관계 — (테스트 완화통제)");
    expect(prompt).toContain("오늘의 조치 브리핑");
    expect(prompt).toContain("unsafe-pickle"); // 픽스처 finding_type
    expect(prompt).toContain("권장 조치 기한"); // 지시
    expect(prompt).toContain("테스트 완화통제"); // 온톨로지 근거 주입
  });

  it("AI triage 라우트: 모델 초안을 그대로 실어 200으로 반환", async () => {
    const r = await request(app).post("/api/approvals/triage").set(auth()).send({ limit: 5 });
    expect(r.status).toBe(200);
    // 스텁 응답이 그대로 실려야 한다 — 라우트가 모델 출력을 삼키거나 바꾸지 않음을 확인.
    expect(r.body.draft).toBe(TRIAGE_DRAFT);
    expect(r.body.count).toBeGreaterThanOrEqual(1);
    // 프롬프트에 실제 조치 대상이 실려 나갔는지(빈 프롬프트로 부르지 않았는지)까지 본다.
    expect(mockChat).toHaveBeenCalled();
    const sent = mockChat.mock.calls.at(-1)?.[0] as { message: string } | undefined;
    expect(sent?.message).toContain("unsafe-pickle");
  });

  it("조치 대상이 없으면 LLM을 부르지 않고 안내 문구를 준다", async () => {
    resetApprovalsForTests();
    resetAssetsForTests();
    mockChat.mockClear();
    const r = await request(app).post("/api/approvals/triage").set(auth()).send({ limit: 5 });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(0);
    expect(r.body.draft).toContain("스캔 결과를 먼저 업로드");
    expect(mockChat).not.toHaveBeenCalled(); // 부를 이유가 없을 때 GPU를 쓰지 않는다
  });

  it("approves and rejects a finding, updating status + reviewer", async () => {
    const key = findingKey("m1", FINDING);
    const approve = await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "approved" });
    expect(approve.status).toBe(200);
    let list = (await request(app).get("/api/approvals").set(auth())).body;
    expect(list.reviews[0].status).toBe("approved");
    expect(list.reviews[0].reviewedBy).toBe("정요한");
    expect(list.summary.approved).toBe(1);

    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "rejected", note: "오탐임" });
    list = (await request(app).get("/api/approvals").set(auth())).body;
    expect(list.reviews[0].status).toBe("rejected");
    expect(list.reviews[0].note).toBe("오탐임");
    expect(list.summary.rejected).toBe(1);

    // 검토 취소 → pending 복귀(저장 행 삭제)
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "pending" });
    list = (await request(app).get("/api/approvals").set(auth())).body;
    expect(list.reviews[0].status).toBe("pending");
  });

  it("rejects an invalid status and requires auth", async () => {
    const key = findingKey("m1", FINDING);
    expect((await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "maybe" })).status).toBe(400);
    expect((await request(app).get("/api/approvals")).status).toBe(401);
  });

  it("a rejected (false-positive) finding is excluded from the SBOM; pending/approved stay in", async () => {
    const key = findingKey("m1", FINDING);
    // 처음엔 pending → SBOM knownVulns에 포함
    let sbom = (await request(app).post("/api/sbom/m1/generate").set(auth())).body;
    expect(sbom.components[0].knownVulns).toContain("unsafe-pickle");

    // 반려(오탐) → SBOM에서 제외
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "rejected" });
    sbom = (await request(app).post("/api/sbom/m1/generate").set(auth())).body;
    expect(sbom.components[0].knownVulns).toEqual([]);

    // 승인(확정)으로 바꾸면 다시 포함
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "approved" });
    sbom = (await request(app).post("/api/sbom/m1/generate").set(auth())).body;
    expect(sbom.components[0].knownVulns).toContain("unsafe-pickle");
  });

  it("approval survives a re-scan that produces the same finding (stable key)", async () => {
    const key = findingKey("m1", FINDING);
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "approved" });
    recordFindings("m1", [FINDING]); // 동일 finding 재스캔
    const list = (await request(app).get("/api/approvals").set(auth())).body;
    expect(list.reviews[0].status).toBe("approved"); // 상태 유지
  });

  it("워크플로 확장: 진행중→검증→재스캔에서 사라지면 완료로 자동 확정", async () => {
    const key = findingKey("m1", FINDING);
    // 담당자 2종 + 진행중
    await request(app).post(`/api/approvals/m1/${key}`).set(auth())
      .send({ status: "in_progress", assignee: "brian", securityOwner: "정요한", dueDate: "2999-12-31" });
    let review = (await request(app).get("/api/approvals").set(auth())).body.reviews[0];
    expect(review.status).toBe("in_progress");
    expect(review.assignee).toBe("brian");
    expect(review.securityOwner).toBe("정요한");

    // 조치 완료 보고 → 검증
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "verifying" });
    review = (await request(app).get("/api/approvals").set(auth())).body.reviews[0];
    expect(review.status).toBe("verifying");
    expect(review.verifyRequestedBy).toBe("정요한");
    expect(typeof review.verifyRequestedAt).toBe("number");

    // 재스캔에서 이 finding이 사라짐 → 완료(approved)로 자동 확정, 스냅샷으로 목록 유지
    recordFindings("m1", []); // 빈 스캔 = 해결됨
    const body = (await request(app).get("/api/approvals").set(auth())).body;
    const r = body.reviews.find((x: { findingKey: string }) => x.findingKey === key);
    expect(r.status).toBe("approved"); // 검증 통과 → 완료
    expect(r.gone).toBe(true);
    expect(r.finding.finding_type).toBe("unsafe-pickle"); // 스냅샷에서 복원
    expect(typeof r.resolvedAt).toBe("number");
  });

  it("워크플로 확장: 반려 사유(오탐/보상통제)와 승인자·날짜를 보존", async () => {
    const key = findingKey("m1", FINDING);
    await request(app).post(`/api/approvals/m1/${key}`).set(auth())
      .send({ status: "rejected", rejectReason: "compensating_control", note: "내부망 격리로 방어 중" });
    const review = (await request(app).get("/api/approvals").set(auth())).body.reviews[0];
    expect(review.status).toBe("rejected");
    expect(review.rejectReason).toBe("compensating_control");
    expect(review.note).toBe("내부망 격리로 방어 중");
    expect(review.reviewedBy).toBe("정요한"); // 승인자 보존
    expect(typeof review.reviewedAt).toBe("number"); // 날짜 보존

    // 잘못된 반려 사유는 400
    expect((await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ status: "rejected", rejectReason: "몰라" })).status).toBe(400);
  });

  it("담당자 메일 알림: 잘못된 이메일은 400, SMTP 미설정이면 안내와 함께 400", async () => {
    const key = findingKey("m1", FINDING);
    await request(app).post(`/api/approvals/m1/${key}`).set(auth()).send({ assignee: "인프라팀" });
    // 이메일 형식 오류
    const bad = await request(app).post(`/api/approvals/m1/${key}/notify`).set(auth()).send({ to: "not-an-email" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("이메일");
    // 정상 이메일이지만 SMTP 미설정 → 안내 400(메일 서버 등록 유도)
    const noSmtp = await request(app).post(`/api/approvals/m1/${key}/notify`).set(auth()).send({ to: "owner@corp.example" });
    expect(noSmtp.status).toBe(400);
    expect(noSmtp.body.error).toContain("SMTP");
  });
});

describe("★ 스캐너 오류는 취약점이 아니다 (2026-08-01 하루 실전에서 발견)", () => {
  // 실측: 운영 서버 finding 605건 중 **602건이 scan_error**였다.
  // 그래서 제품에서 가장 중요한 답인 "오늘 뭐부터 볼까?"의 상위 5건 중 4건이 스캔 오류였고,
  // 화면에는 "검토 대기 602건"이 떴다. **실제 일감은 3건**이다.
  // 담당자는 밀린 일이 602건인 줄 알고 손도 못 댄다 — 숫자가 틀리면 없느니만 못하다.
  //
  // 이 결함은 조용하다: 오류도 안 나고 화면도 멀쩡하며 숫자도 "그럴듯"하다.
  // 그래서 못으로 박는다.
  const 진짜 = { finding_type: "OpenSSH < 9.6 사용자 열거 (CVE-2024-6387)", severity: "high" };
  const 오류 = { finding_type: "scan_error", severity: "low" };
  const 미지원 = { finding_type: "scan_not_supported", severity: "low" };

  it("scan_error·scan_not_supported를 일감으로 세지 않는다", () => {
    expect(isRealVulnerability(진짜)).toBe(true);
    expect(isRealVulnerability(오류), "스캔 실패는 취약점이 아니다").toBe(false);
    expect(isRealVulnerability(미지원), "스캐너가 지원 안 하는 것도 취약점이 아니다").toBe(false);
  });

  it("★ 세는 자리를 나눈다 — 감추는 게 아니다", () => {
    // 스캔이 안 된 자산은 그 자체로 조치할 일이다(스캐너 설정·권한). 다만 취약점과 섞지 않는다.
    const 리뷰 = [
      { finding: 진짜, status: "pending", overdue: false },
      { finding: 오류, status: "pending", overdue: false },
      { finding: 오류, status: "pending", overdue: false },
      { finding: 미지원, status: "pending", overdue: false },
    ] as unknown as Parameters<typeof approvalSummary>[0];
    const s = approvalSummary(리뷰);
    expect(s.total, "일감은 1건이다").toBe(1);
    expect(s.pending).toBe(1);
    expect(s.scanFailed, "스캔 실패는 사라지지 않고 따로 세어진다").toBe(3);
  });
});
