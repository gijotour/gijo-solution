import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAssetsForTests, recordFindings } from "../src/engine/assets";
import { resetApprovalsForTests, findingKey } from "../src/engine/approvals";
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
    expect(res.body.summary).toEqual({ total: 1, pending: 1, approved: 0, rejected: 0, overdue: 0 });
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
});
