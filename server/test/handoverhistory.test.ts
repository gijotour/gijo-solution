// 인수인계 이관 이력 — [2026-08-06 · 계획서 후-6 해자 슬라이스 2]
//
// 실태(설계문서): 검증 결과가 담당자 PC(localStorage)에만 남고 **서버는 알지 못했다**.
// 퇴사자가 떠나면 "무엇을 이관했고 그게 실제로 통했나"가 통째로 사라진다 — 조직에 남아야 할
// 자산이 개인 브라우저에 있었다. 이제 서버가 회차(batch)로 남긴다.
//
// ★ 이 시험이 지키는 개인정보 경계(설계에서 먼저 정한 것):
//   남긴다 — 문서 이름 · 자동 생성 질문 · 인용 여부 · 근거 문서 이름(3개까지) · 이관자
//   안 남긴다 — **답변 본문**. 답변에는 사내 문서 내용이 그대로 실린다. 증적에 필요한 것은
//   "통했다/아니다"이지 그때 무슨 말이 오갔는지가 아니다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { verifyHandover, listHandoverHistory, markHandoverCompleted } from "../src/engine/handover";

const 가짜Deps = (cited: boolean) => ({
  sampleOf: async () => "사내 방화벽 정책 변경 절차: 1) 신청 2) 승인 3) 반영",
  genQuestion: async () => "방화벽 정책 변경은 어떤 순서로 하나요?",
  ask: async () => ({
    output: "우리 회사 방화벽 정책 변경은 신청→승인→반영 순서입니다. (본문에 사내 내용이 실린다)",
    sources: cited ? ["방화벽_인수인계.md", "보안운영지침.md"] : ["엉뚱한문서.md"],
  }),
});

beforeEach(() => { db.prepare("DELETE FROM handover_history").run(); });

describe("이관 이력 — 서버가 안다", () => {
  it("★ 검증하면 회차가 서버에 남는다 — 브라우저가 아니라", async () => {
    const r = await verifyHandover(["방화벽_인수인계.md"], 가짜Deps(true), { actor: "정요한" });
    expect(r.batchId).toBeTruthy();
    const 이력 = listHandoverHistory();
    expect(이력).toHaveLength(1);
    expect(이력[0].total).toBe(1);
    expect(이력[0].cited).toBe(1);
    expect(이력[0].passRate).toBe(100);
    expect(이력[0].actor).toBe("정요한");
    expect(이력[0].completedAt, "검증만 했는데 완료로 보이면 안 된다").toBeNull();
  });

  it("★★ 답변 본문은 저장하지 않는다 — 증적에 필요한 것은 통했나이지 무슨 말이 오갔나가 아니다", async () => {
    await verifyHandover(["방화벽_인수인계.md"], 가짜Deps(true), { actor: "정요한" });
    const rows = db.prepare("SELECT * FROM handover_history").all() as Record<string, unknown>[];
    const 통째로 = JSON.stringify(rows);
    expect(통째로, "답변 본문이 이력에 새어 들어갔다").not.toContain("신청→승인→반영");
    expect(통째로, "본문 문구가 이력에 남았다").not.toContain("본문에 사내 내용이 실린다");
    // 남겨야 하는 것은 남아 있다
    expect(통째로).toContain("방화벽_인수인계.md");
    expect(통째로).toContain("방화벽 정책 변경은 어떤 순서로");
  });

  it("근거 문서 이름은 3개까지만 — 목록을 통째로 쌓지 않는다", async () => {
    const deps = {
      ...가짜Deps(true),
      ask: async () => ({ output: "답", sources: ["a.md", "b.md", "c.md", "d.md", "e.md"] }),
    };
    await verifyHandover(["a.md"], deps, { actor: null });
    const row = db.prepare("SELECT sourceNames FROM handover_history").get() as { sourceNames: string };
    expect(row.sourceNames.split(",")).toHaveLength(3);
  });

  it("완료 처리하면 그 회차만 마감된다 — 어느 검증이 실제 인계로 이어졌나", async () => {
    const r1 = await verifyHandover(["a.md"], 가짜Deps(true), { actor: "A" });
    await verifyHandover(["b.md"], 가짜Deps(false), { actor: "B" });
    const n = markHandoverCompleted(r1.batchId);
    expect(n).toBe(1);
    const 이력 = listHandoverHistory();
    const 마감된것 = 이력.filter((b) => b.completedAt);
    expect(마감된것).toHaveLength(1);
    expect(마감된것[0].batchId).toBe(r1.batchId);
  });

  it("통과율은 실제 인용 여부로 센다 — 안 통한 것을 통한 것처럼 세지 않는다", async () => {
    await verifyHandover(["없는문서.md"], 가짜Deps(false), { actor: null });
    expect(listHandoverHistory()[0].passRate).toBe(0);
  });

  it("시험·자동화 호출은 이력을 더럽히지 않는다(record:false)", async () => {
    await verifyHandover(["a.md"], 가짜Deps(true), { record: false });
    expect(listHandoverHistory()).toHaveLength(0);
  });
});

describe("★ 챗봇 답이 낡은 정직 문구를 그대로 두지 않는다", () => {
  it("「서버가 알지 못합니다」는 사라지고 실제 이력을 말한다", async () => {
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(__dirname, "..", "src", "engine", "agenttools", "handlers.ts"), "utf8"
    );
    const i = src.indexOf("function runHandoverStatus");
    // ⚠ 주석 줄은 뺀다 — 이 저장소는 "예전엔 이랬다"를 주석에 남기는 관례라(사고 이력 보존),
    //   주석의 인용문을 위반으로 세면 기록을 지우게 만든다(clientglobals.test와 같은 처리).
    const 본문 = src.slice(i, i + 1800).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(본문, "이력이 생겼는데 답변이 여전히 「서버가 알지 못합니다」라고 말한다").not.toContain("서버가 알지 못합니다");
    expect(본문, "이력을 읽지 않는다").toContain("listHandoverHistory");
  });
});
