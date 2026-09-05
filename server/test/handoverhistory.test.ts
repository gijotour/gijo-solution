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
import { verifyHandover, listHandoverHistory, markHandoverCompleted, 근거이름읽기 } from "../src/engine/handover";

const 가짜Deps = (cited: boolean) => ({
  sampleOf: async () => "사내 방화벽 정책 변경 절차: 1) 신청 2) 승인 3) 반영",
  genQuestion: async () => "방화벽 정책 변경은 어떤 순서로 하나요?",
  ask: async () => ({
    output: "우리 회사 방화벽 정책 변경은 신청→승인→반영 순서입니다. (본문에 사내 내용이 실린다)",
    // sources = 기계용 **ID**(판정이 쓴다) · sourceTitles = 사람이 읽는 **제목**(증적에 남는다).
    // 서버가 둘을 같은 순서로 준다(dispatcher.sourceTitles 계약) — 흉내도 그렇게 낸다.
    sources: cited ? ["방화벽_인수인계.md", "보안운영지침.md"] : ["엉뚱한문서.md"],
    sourceTitles: cited ? ["방화벽 인수인계", "보안 운영 지침"] : ["엉뚱한 문서"],
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
      ask: async () => ({
        output: "답",
        sources: ["a.md", "b.md", "c.md", "d.md", "e.md"],
        sourceTitles: ["가 문서", "나 문서", "다 문서", "라 문서", "마 문서"],
      }),
    };
    await verifyHandover(["a.md"], deps, { actor: null });
    const row = db.prepare("SELECT sourceNames FROM handover_history").get() as { sourceNames: string };
    expect(근거이름읽기(row.sourceNames)).toHaveLength(3);
  });

  // ── B1 수리 (2026-09-06) — 증적의 「근거 문서 이름」은 **이름이어야 한다** ────────────
  //
  // ★ 무엇이 잘못이었나: 이 칸(sourceNames)에 `r.sources`, 즉 **내부 ID**를 넣고 있었다.
  //   표 정의도 주석도 「근거 문서 이름」이라고 약속했는데 「승인문답:dtmtl5b1fzj215l3」 꼴이
  //   들어갔다 — 퇴사 절차의 감사 증적을 나중에 읽는 사람에게 **아무것도 안 가리키는 키**다.
  //   같은 날 배지·협업 피드에서 고친 것(dispatcher.sourceTitles)의 **남은 자리**였다.
  // ⚠ 판정(cited)은 여전히 ID로 한다 — 이름으로 바꾸면 인수인계 검증 자체가 죽는다.
  //   그래서 이 묶음은 **둘을 함께** 문다: 이름은 이름 칸에, ID는 판정에.
  describe("★★ 증적에는 사람이 읽는 이름이 남는다 — 내부 ID가 아니라", () => {
    it("이름 칸에는 제목이 들어가고 ID는 안 들어간다", async () => {
      const deps = {
        ...가짜Deps(true),
        ask: async () => ({
          output: "답",
          sources: ["승인문답:dtmtl5b1fzj215l3", "kb:0f2b7c19aa41"],
          sourceTitles: ["보안 서약서 처리 절차", "방화벽 정책 변경 지침"],
        }),
      };
      await verifyHandover(["승인문답:dtmtl5b1fzj215l3"], deps, { actor: null });
      const row = db.prepare("SELECT sourceNames FROM handover_history").get() as { sourceNames: string };
      expect(근거이름읽기(row.sourceNames), "사람 제목이 안 남았다").toEqual(["보안 서약서 처리 절차", "방화벽 정책 변경 지침"]);
      expect(row.sourceNames, "내부 ID가 증적에 그대로 실렸다").not.toContain("승인문답:");
      expect(row.sourceNames, "내부 ID가 증적에 그대로 실렸다").not.toContain("kb:");
    });

    it("빈 제목은 뺀다 — 자리를 ID로 메우지 않는다", async () => {
      const deps = {
        ...가짜Deps(true),
        // 가운데 문서는 제목을 못 구했다(memory.사람이읽는문서제목이 빈 문자열을 준다).
        ask: async () => ({
          output: "답",
          sources: ["a.md", "승인문답:xxxx", "c.md"],
          sourceTitles: ["가 문서", "", "다 문서"],
        }),
      };
      await verifyHandover(["a.md"], deps, { actor: null });
      const row = db.prepare("SELECT sourceNames FROM handover_history").get() as { sourceNames: string };
      expect(근거이름읽기(row.sourceNames)).toEqual(["가 문서", "다 문서"]);
    });

    it("제목이 하나도 없으면 이름 칸은 비운다 — 「모른다」가 정직한 상태다", async () => {
      const deps = {
        ...가짜Deps(true),
        // 옛 경로·모듈 흉내처럼 sourceTitles가 아예 안 오는 경우.
        ask: async () => ({ output: "답", sources: ["승인문답:aaaa", "승인문답:bbbb"] }),
      };
      await verifyHandover(["a.md"], deps, { actor: null });
      const row = db.prepare("SELECT sourceNames FROM handover_history").get() as { sourceNames: string | null };
      expect(row.sourceNames, "제목을 모르면서 ID로 채웠다").toBeNull();
    });

    it("★ 판정은 그대로 ID로 한다 — 이름을 남긴다고 검증이 죽으면 안 된다", async () => {
      const deps = {
        ...가짜Deps(true),
        ask: async () => ({
          output: "답",
          sources: ["방화벽_인수인계.md"],
          sourceTitles: ["방화벽 인수인계"], // 제목은 문서 ID와 글자가 다르다
        }),
      };
      const r = await verifyHandover(["방화벽_인수인계.md"], deps, { actor: null });
      expect(r.cited, "제목으로 판정하면 여기서 0이 된다").toBe(1);
      // 조회(listHandoverHistory)도 같은 판정을 그대로 센다 — 쓰는 쪽과 읽는 쪽을 함께 본다.
      expect(listHandoverHistory()[0].passRate).toBe(100);
    });
  });

  // ── B1 짝 결함 수리 (2026-09-06, 검토관 실측) ─────────────────────────────────
  //
  // ★ 두 가지가 함께 걸렸다. **B1 수리가 데려온 것**이라 같은 자리에서 함께 잡는다.
  //   ① 이름 칸을 **쉼표로 이어 붙이고 있었다.** 담기던 값이 쉼표를 못 쓰던 내부 ID에서
  //      쉼표를 쓸 수 있는 **사람 제목**으로 바뀐 순간, 제목 하나가 둘로 읽히게 됐다.
  //   ② 그 칸을 **읽는 경로가 0이었다** — listHandoverHistory의 SELECT에 아예 없었다.
  //      증적을 남겨 놓고 꺼낼 길이 없으면 안 남긴 것과 같다(원시 SQL로만 보였다).
  describe("★★ 이름 칸은 경계가 살아 있고, 꺼내 볼 수 있다", () => {
    it("제목에 쉼표가 들어가도 항목이 안 쪼개진다", async () => {
      const deps = {
        ...가짜Deps(true),
        ask: async () => ({
          output: "답",
          sources: ["a.md", "b.md"],
          sourceTitles: ["보안 서약서, 처리 절차", "방화벽 정책"],
        }),
      };
      await verifyHandover(["a.md"], deps, { actor: null });
      const row = db.prepare("SELECT sourceNames FROM handover_history").get() as { sourceNames: string };
      expect(근거이름읽기(row.sourceNames), "쉼표 있는 제목이 둘로 쪼개졌다")
        .toEqual(["보안 서약서, 처리 절차", "방화벽 정책"]);
    });

    it("★ 조회가 이름을 함께 돌려준다 — 남기기만 하고 못 꺼내면 안 남긴 것과 같다", async () => {
      const deps = {
        ...가짜Deps(true),
        ask: async () => ({
          output: "답",
          sources: ["방화벽_인수인계.md", "b.md"],
          sourceTitles: ["방화벽 인수인계", "보안 운영 지침"],
        }),
      };
      await verifyHandover(["방화벽_인수인계.md"], deps, { actor: "정요한" });
      const 이력 = listHandoverHistory();
      expect(이력[0].sourceNames, "이력에서 근거 이름을 못 꺼낸다")
        .toEqual(["방화벽 인수인계", "보안 운영 지침"]);
      // 문서 목록은 종전대로 **ID**다 — 판정·재조회가 그 키를 쓴다(이름으로 바꾸면 죽는다).
      expect(이력[0].documents).toEqual(["방화벽_인수인계.md"]);
    });

    it("같은 이름이 여러 물음의 근거로 올라도 한 번만 센다", async () => {
      const deps = {
        ...가짜Deps(true),
        ask: async () => ({ output: "답", sources: ["a.md"], sourceTitles: ["같은 지침"] }),
      };
      await verifyHandover(["a.md", "b.md", "c.md"], deps, { actor: null });
      expect(listHandoverHistory()[0].sourceNames).toEqual(["같은 지침"]);
    });

    // ⚠ B1 수리 **이전에 쌓인 행**은 쉼표 꼴이고 내부 ID가 들어 있을 수 있다.
    //   지어내서 이름처럼 꾸미지 않고 있는 그대로 돌려준다 — 증적은 꾸미는 것이 아니다.
    it("옛 행(쉼표 꼴)도 읽힌다 — 판을 바꿨다고 옛 증적이 안 보이면 안 된다", () => {
      db.prepare(
        `INSERT INTO handover_history (batchId, verifiedAt, documentId, question, cited, sourceNames, actor)
         VALUES ('old-1', '2026-08-10T00:00:00Z', 'a.md', 'q', 1, '승인문답:dtmtl5b1, kb:0f2b7c19', null)`
      ).run();
      expect(listHandoverHistory()[0].sourceNames).toEqual(["승인문답:dtmtl5b1", "kb:0f2b7c19"]);
    });

    it("이름이 없으면 빈 배열 — null을 문자열로 흘리지 않는다", () => {
      expect(근거이름읽기(null)).toEqual([]);
      expect(근거이름읽기("")).toEqual([]);
      expect(근거이름읽기("[]")).toEqual([]);
    });
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
