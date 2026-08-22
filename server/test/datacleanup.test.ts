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
      smtp_config: "메일 서버 설정 — 제품 구성이다",
      cloud_llm_keys: "클라우드 열쇠 — 설정이지 업무 데이터가 아니다",
      compliance_status: "규정 준수 상태 — 파생 계산값(원천은 다른 표들)",

      // ⚠⚠ **아래는 「제외」가 아니라 「아직 판단 안 함」이다** (2026-08-22 2라운드).
      //   전수 대조로 바꾸는 순간 미분류 표가 **29개** 드러났다 — 정리 대장이 처음부터
      //   전수가 아니었다는 뜻이다. 여기서 한꺼번에 갈래를 정하지 **않는다**:
      //   잘못 넣으면 실사용 전환에서 **지우면 안 될 것이 지워진다**(되돌릴 수 없다).
      //   ★ 그래서 「오늘 아는 상태」로 못박아 둔다. 값어치는 그대로다 —
      //     **내일 새 표를 만들면 목록에 없어서 이 시험이 빨개진다.** 그게 이 감시의 목적이다.
      //   ▶ 남은 일: 아래 목록을 하나씩 갈래(지운다/안 지운다)로 옮기기. 옮길 때마다 한 줄 삭제.
      chat_logs: "⏳ 판단 대기 — 대화 기록(작업 내역 sessions와 관계 확인 필요)",
      cloud_egress_log: "⏳ 판단 대기 — 바깥으로 나간 기록. 감사 성격일 가능성이 높다",
      cloud_usage: "⏳ 판단 대기 — 사용량 집계(파생일 가능성)",
      cti_feeds: "⏳ 판단 대기 — 위협정보 구독처. 설정에 가깝다",
      learnloop_runs: "⏳ 판단 대기 — 학습 실행 이력",
      llm_activity_daily: "⏳ 판단 대기 — AI 팀 감독의 원천(현황판이 이 값을 센다)",
      ontology_triples: "⏳ 판단 대기 — 온톨로지 시드. 제품 자산에 가깝다",
      routine_feedback: "축적 자산 — 같은 결론(datacleanup.ts:24-27)",

      // db.ts 밖(각 엔진 모듈)에서 만드는 표들 — 같은 이유로 오늘은 판단을 미룬다.
      user_mfa: "2차 인증 등록 — 계정 딸림. 지우면 로그인이 막힌다",
      user_mfa_recovery: "2차 인증 복구 코드 — 계정 딸림",
      model_auth: "모델 접속 자격 — 설정이다",
      law_config: "법제처 연동 설정 — 설정이다",
      client_releases: "클라 배포 대장 — 제품 배포 기반이다(지우면 자동 업데이트가 끊긴다)",
      smtp_inbound_config: "수신 메일 설정 — 설정이다",
      alert_schedules: "⏳ 판단 대기 — 알림 예약",
      report_schedules: "⏳ 판단 대기 — 리포트 예약(업무 데이터일 가능성이 높다)",
      report_schedule_runs: "⏳ 판단 대기 — 리포트 예약 실행 이력",
      action_check_history: "축적 자산 — **일부러 안 지운다**(datacleanup.ts:24-27 결론, resetlive.test가 값으로 지킨다)",
      answer_feedback: "축적 자산 — 담당자가 남긴 지적. 지우면 학습 재료가 사라진다(같은 결론)",
      learn_candidate_decisions: "⏳ 판단 대기 — 학습 후보 승인·반려",
      lora_adapters: "⏳ 판단 대기 — 어댑터 대장(제품 자산에 가깝다)",
      model_adoptions: "⏳ 판단 대기 — 모델 채택 이력",
      doc_digests: "⏳ 판단 대기 — 문서 반입 소식",
      doc_requests: "⏳ 판단 대기 — 개발팀 요청 문서",
      handover_history: "⏳ 판단 대기 — 인수인계 기록(업무 데이터일 가능성이 높다)",
      outbound_requests: "⏳ 판단 대기 — 바깥으로 나간 요청(감사 성격일 가능성)",
      work_events: "축적 자산 — 아낀 시간 KPI의 원천. 지우면 그 숫자가 0이 된다(같은 결론)",
    };
    const 실제표 = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[]).map((r) => r.name);
    // 이 시험이 헛돌지 않는지 — 표를 실제로 읽었나.
    expect(실제표.length, "DB에서 표를 하나도 못 읽었다 — 이 시험이 저절로 통과한다").toBeGreaterThan(5);

    // ★★ **전수로 본다** (2026-08-22 2라운드 검토관 [중] 수리 — 내 첫 시험이 거짓말이었다).
    //   처음엔 「새 표를 만들면 여기서 걸린다」고 제목을 달아 놓고 실제로는 **하드코딩한 세
    //   이름**만 봤다. 그러면 새 표가 생겨도 원리상 절대 안 빨개진다 — 제목과 커밋이 거짓이 된다.
    //   이제 sqlite_master 전수를 대조한다: 대장에도 없고 제외 목록에도 없으면 실패한다.
    //   ⚠ 실패했을 때 할 일은 「제외에 밀어 넣기」가 아니라 **갈래를 판단해 적는 것**이다.
    //     그래서 제외 목록에 **이유를 강제**한다(빈 문자열이면 아래 시험이 잡는다).
    const 미분류 = 실제표.filter((t) => !대장이아는표.has(t) && !(t in 일부러제외));
    expect(
      미분류,
      "정리 대장이 모르는 표가 있다 — 각각 「업무 데이터라 지운다(TARGETS)」인지 " +
      "「지우면 안 된다(일부러제외에 이유와 함께)」인지 판단해 적을 것"
    ).toEqual([]);
    // 제외 사유가 빈칸이면 감시가 헛돈다 — 이름만 올려 두는 것을 막는다.
    for (const [이름, 이유] of Object.entries(일부러제외)) {
      expect(이유.length, `${이름}의 제외 사유가 너무 짧다`).toBeGreaterThan(8);
    }

    // ★★ **두 목록이 겹치면 안 된다** (2026-08-22 3라운드 검토관 [중] 수리).
    //   내 2라운드 목록에는 **이미 대장에 있어 실제로 지워지는 표 4개**가 「판단 대기」로
    //   중복 등재돼 있었다. 미분류 판정이 `!대장에있다 && !제외에있다`라, 두 곳 중 하나만
    //   남아도 초록이다 — 누가 대장에서 그 표를 빼도(반쪽 삭제) **이 전수 감시가 못 잡는다.**
    //   내가 고치려던 그 부류(「전수라 이름 붙였는데 안 전수」)의 사각지대를 스스로 만든 꼴이다.
    const 겹침 = Object.keys(일부러제외).filter((t) => 대장이아는표.has(t));
    expect(
      겹침,
      "정리 대장과 제외 목록에 같은 표가 둘 다 있다 — 대장에서 빠져도 이 감시가 안 빨개진다. " +
      "실제로 지우는 표라면 제외 목록에서 뺄 것"
    ).toEqual([]);
  });
});
