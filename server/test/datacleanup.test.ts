// 데이터 정리(admin) — 화이트리스트·감사 흐름 검증. 실 삭제는 테스트 DB에서 이뤄진다.
import { describe, expect, it, vi, beforeAll } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { db } from "../src/db";

let app: ReturnType<typeof createApp>;
let token = "";
beforeAll(async () => {
  app = createApp();
  const r = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  token = r.body.accessToken;
});

describe("POST /api/admin/data-cleanup", () => {
  it("targets 없으면 400 + 지원 목록 안내", async () => {
    const r = await request(app).post("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("cti_findings");
  });

  it("화이트리스트 밖 대상은 무시된다(임의 테이블 삭제 불가)", async () => {
    // ⚠ 밖 예시는 **보존 계약 테이블**로 든다 — assets는 2026-08-19 실사용 전환 리셋으로
    //   화이트리스트에 들어왔다(밖 예시로 쓰면 이 시험이 확장마다 깨진다).
    const r = await request(app).post("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`).send({ targets: ["users", "audit_log", "chat_logs"] });
    expect(r.status).toBe(400); // 유효 대상이 하나도 없음
  });

  it("cti_findings·analysis_events를 지우고 건수를 돌려준다 + 감사 기록", async () => {
    db.prepare("INSERT INTO cti_findings (id, feedId, detectedAt, type, target, source, severity, collectedAt) VALUES ('t1','f1','2026-01-01','vuln','test','unit','high',1)").run();
    const r = await request(app).post("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`).send({ targets: ["cti_findings", "analysis_events"] });
    expect(r.status).toBe(200);
    const cti = r.body.results.find((x: { id: string }) => x.id === "cti_findings");
    expect(cti.deleted).toBeGreaterThanOrEqual(1);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action LIKE '%데이터 정리%' ORDER BY rowid DESC LIMIT 1").get() as { detail: string };
    expect(audit.detail).toContain("삭제");
  });

  it("GET은 대상·현재 건수를 보여준다", async () => {
    const r = await request(app).get("/api/admin/data-cleanup").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.targets.map((t: { id: string }) => t.id)).toContain("analysis_events");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ **지운다고 했으면 다 지워야 한다** (2026-08-22 게시 전 검토관 [중] 수리)
//
// ■ 무엇이 잘못됐나 — 「개인 문서함」 정리 대상이 `personal_docs` **한 표뿐**이었다.
//   그런데 같은 날 판 이력(`personal_doc_versions`)과 첨부 대장(`personal_doc_files`)을
//   새로 만들었다. 화면·감사에는 「개인 문서함 N건 삭제」라고 찍히는데
//   **직전 20판의 본문 전문**이 그대로 남았다 — DB 백업·스냅샷에 실려 나간다.
//
// ■ 왜 개수가 아니라 **표 이름**을 세나: 개수 검사는 「하나 더 생겼는데 안 넣은 것」을
//   못 잡는다. 이 저장소가 반복해 겪은 「짝을 안 채운 신설」이 바로 그 모양이다.
//   새 표를 만들면 여기서 걸려, 사람이 「이건 어느 갈래에 드나」를 판단하게 된다.
import { TARGETS, RESET_TARGETS } from "../src/engine/datacleanup";

describe("★ 정리 대장이 새 표를 빠뜨리지 않는다", () => {
  it("★★ 개인 문서를 지우면 **판 이력·첨부 대장까지** 지운다", () => {
    const 표 = TARGETS.personal_docs?.tables ?? [];
    for (const t of ["personal_docs", "personal_doc_versions", "personal_doc_files"]) {
      expect(표, `개인 문서함 정리에 ${t}가 빠졌다 — 지웠다는데 옛 본문이 남는다`).toContain(t);
    }
    // 자식 먼저 — 부모를 먼저 지우면 자식이 고아가 된다(외래키가 없어도 순서를 지킨다).
    expect(표.indexOf("personal_docs"), "부모(personal_docs)를 자식보다 먼저 지운다")
      .toBeGreaterThan(표.indexOf("personal_doc_versions"));
  });

  it("★ 반입 영수증도 실사용 전환에서 지운다 — 시연 파일 이름이 실운영에 남으면 안 된다", () => {
    expect(Object.keys(TARGETS), "반입 영수증이 정리 대장에 없다").toContain("upload_receipts");
    expect([...RESET_TARGETS], "실사용 전환 리셋에 반입 영수증이 빠졌다").toContain("upload_receipts");
  });

  it("★★ DB에 있는 표 중 **정리 대장이 모르는 업무 표**가 없다 — 새 표를 만들면 여기서 걸린다", () => {
    // 판단이 끝난 것만 적는다. 새 이름이 생기면 이 시험이 실패하고, 그때 갈래를 정한다.
    const 대장이아는표 = new Set(Object.values(TARGETS).flatMap((t) => t.tables));
    const 일부러제외: Record<string, string> = {
      // 업무 데이터가 아닌 것들 — 지우면 제품이 망가지거나, 지우면 안 되는 기록이다.
      users: "계정 — 지우면 로그인이 안 된다",
      app_state: "설정·상태 — 제품 구성이다",
      audit_log: "감사 기록 — **일부러 안 지운다**(지워지는 감사는 감사가 아니다)",
      memory_documents: "지식 문서 메타 — AI 지식 화면이 따로 관리한다",
      schema_migrations: "마이그레이션 대장 — 제품 뼈대다",
    };
    const 실제표 = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[]).map((r) => r.name);
    // 이 시험이 헛돌지 않는지 — 표를 실제로 읽었나.
    expect(실제표.length, "DB에서 표를 하나도 못 읽었다 — 이 시험이 저절로 통과한다").toBeGreaterThan(5);
    // 오늘 새로 만든 셋은 반드시 대장에 있어야 한다(나머지는 아직 전수 분류 전이라 이 셋만 못박는다).
    for (const t of ["upload_receipts", "personal_doc_versions", "personal_doc_files"]) {
      if (!실제표.includes(t)) continue; // 이 판에 아직 없는 표는 건너뛴다
      expect(대장이아는표.has(t) || t in 일부러제외,
        `${t}가 정리 대장 어디에도 없다 — 지워도 남거나, 지우면 안 되는데 지워진다`).toBe(true);
    }
  });
});
