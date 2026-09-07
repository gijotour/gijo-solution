// 감독 화면의 「고칠 것」 칸 — /api/aiteam/supervision (통합 설계관 S-A V4).
// [전중후 계획서 정렬] 중-1 「파일럿 실사용 피드백 루프」의 신호를 감독 화면에 띄우는 자리다.
//
// 이 시험이 지키는 것 셋:
//   ⓛ 갈래별 수가 **고칠것요약과 같은 함수**에서 나온다(200 OK로 통과시키지 않고 값을 대조한다).
//   ⓜ 201건을 넣어도 집계가 200에서 안 멈춘다(「200 포화, 실제 1578」 재발 감시).
//   ★ 반증 — 지적 0건이면 **원래 있던 칸들이 글자 하나 안 바뀐다**(헛변경 0 증명).
//   ⓞ (2026-09-07 검토관 수리) 질문 원문은 **결재판을 볼 수 있는 사람에게만** — 이 창구는
//     authMiddleware만이라, 결재판에서 403인 담당자가 여기서 남의 질문을 읽고 있었다.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetUsersForTests } from "../src/auth/users";
import { recordFeedback, setFeedbackStatus, resetFeedbackForTests } from "../src/engine/answerfeedback";
import { 고칠것요약, 고칠것최근, 질문가림 } from "../src/engine/fixboard";

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body.accessToken as string;
}

describe("감독 화면 — 「고칠 것」 칸", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    resetUsersForTests();
    resetFeedbackForTests();
    app = createApp();
    token = await login(app);
  });

  it("★ 반증 — 지적 0건이면 원래 있던 칸이 그대로다(새 칸만 0으로 붙는다)", async () => {
    const r = await request(app).get("/api/aiteam/supervision?days=1").set(auth());
    expect(r.status).toBe(200);
    // 이 라운드 **전**의 출력 그대로 — 한 칸도 안 바뀌었음을 글자로 못 박는다.
    const { fixboard, ...예전칸 } = r.body as Record<string, unknown>;
    expect(예전칸).toEqual({ days: 1, calls: {}, daily: [], recentErrors: {}, citeReasons: [] });
    // 새 칸은 **늘 있다**(0건이어도 회색으로 그린다 — 사라지는 조작은 못 찾는다).
    expect(fixboard).toMatchObject({ days: 1, total: 0, open: 0, closed: 0, recent: [] });
    expect((fixboard as { kinds: { fixkind: string }[] }).kinds.map((k) => k.fixkind))
      .toEqual(["doc", "rule", "prod", "unclassified"]);
  });

  it("ⓛ 갈래별 수가 고칠것요약과 **값까지 같다**(200 OK로 통과시키지 않는다)", async () => {
    recordFeedback({ kind: "wrong", question: "백업 보관 기간?", answer: "답", noev: "자료없음" });
    const b = recordFeedback({ kind: "wrong", question: "KEV 몇 건?", answer: "답" });
    setFeedbackStatus(b.id, "resolved");
    recordFeedback({ kind: "style", question: "말투가 딱딱해", answer: "답" });

    const r = await request(app).get("/api/aiteam/supervision?days=1").set(auth());
    expect(r.status).toBe(200);
    const 정본 = 고칠것요약(1);
    expect(r.body.fixboard).toEqual({ ...정본, recent: 고칠것최근(1, 5, true) }); // jyh=admin
    // 값 자체도 확인한다 — 「같은 함수」만 보고 넘어가면 그 함수가 틀려도 초록이다.
    expect(r.body.fixboard.total).toBe(3);
    expect(r.body.fixboard.open).toBe(2);
    expect(r.body.fixboard.closed).toBe(1);
    expect(r.body.fixboard.kinds.find((k: { fixkind: string }) => k.fixkind === "doc"))
      .toMatchObject({ open: 1, closed: 0, total: 1 });
    expect(r.body.fixboard.kinds.find((k: { fixkind: string }) => k.fixkind === "rule"))
      .toMatchObject({ open: 0, closed: 0, total: 0 });
  });

  it("최근 5줄만 · 질문 앞 40자 · **답 본문과 인용 조각은 안 싣는다**(이 창구는 등급 게이트 밖)", async () => {
    for (let i = 0; i < 8; i++) {
      recordFeedback({
        kind: "wrong", question: `질문${i}${"가".repeat(80)}`, answer: `사내 기밀이 실린 답${i}`,
        quotes: [{ documentId: "기밀.pdf", text: "기밀 조각 본문" }],
      });
    }
    const r = await request(app).get("/api/aiteam/supervision?days=1").set(auth());
    expect(r.body.fixboard.recent).toHaveLength(5);
    for (const x of r.body.fixboard.recent) expect(x.q.length).toBe(40);
    const 통째 = JSON.stringify(r.body);
    expect(통째).not.toContain("기밀 조각 본문");
    expect(통째).not.toContain("사내 기밀이 실린 답");
  });

  it("★ⓞ 담당자(security_officer)에게는 질문 원문 대신 자리표가 간다", async () => {
    // 실측(검토관 honesty·wiring [중간]): 결재판에서 403을 받은 담당자가 이 창구에서
    // 남의 질문 앞 40자를 그대로 읽었다("A은행 위약금 조항이 3억이라던데…").
    await request(app).post("/api/users").set(auth())
      .send({ username: "officer9", password: "pw123456", displayName: "담당자9", role: "security_officer" });
    const 담당자 = await login(app, "officer9", "pw123456");
    recordFeedback({ kind: "wrong", question: "A은행 위약금 조항이 3억이라던데 우리 계약서 어디에", answer: "답" });

    const 결재판 = await request(app).get("/api/answer-feedback?days=7").set({ Authorization: `Bearer ${담당자}` });
    expect(결재판.status).toBe(403); // 같은 원장의 정문은 닫혀 있다

    const r = await request(app).get("/api/aiteam/supervision?days=1").set({ Authorization: `Bearer ${담당자}` });
    expect(r.status).toBe(200);
    expect(r.body.fixboard.recent[0].q).toBe(질문가림);
    expect(JSON.stringify(r.body)).not.toContain("A은행");
    // 신호(건수·갈래·상태)는 그대로 준다 — 카드가 통째로 사라지지 않는다.
    expect(r.body.fixboard.total).toBe(1);
    expect(r.body.fixboard.open).toBe(1);
    expect(r.body.fixboard.recent[0].kind).toBe("wrong");
  });

  it("days=abc면 기본 1일로 돌아온다 — 결재판과 같은 잣대(기간정리)", async () => {
    recordFeedback({ kind: "wrong", question: "질문", answer: "답" });
    const r = await request(app).get("/api/aiteam/supervision?days=abc").set(auth());
    expect(r.body.days).toBe(1);
    expect(r.body.fixboard.total).toBe(1);
    expect(r.body.fixboard.days).toBe(1);
  });

  it("ⓜ 반증 — 201건을 넣어도 집계가 200에서 안 멈춘다", async () => {
    for (let i = 0; i < 201; i++) recordFeedback({ kind: "wrong", question: `질문${i}`, answer: "답" });
    const r = await request(app).get("/api/aiteam/supervision?days=1").set(auth());
    expect(r.body.fixboard.total).toBe(201);
    expect(r.body.fixboard.open).toBe(201);
    expect(r.body.fixboard.kinds.find((k: { fixkind: string }) => k.fixkind === "unclassified").total).toBe(201);
  });
});
