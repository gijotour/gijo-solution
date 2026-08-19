// 실사용 전환 리셋(2026-08-19 사장님 「학습된 데이터는 두고 화면에 나오는 데이터는 삭제」).
//
// 이 기능의 위험은 둘이다: ①지우면 안 되는 것(감사·지식·학습·설정·판단·축적 자산)이 지워지는 것
// ②지웠는데 재기동 시드가 데모를 되살리는 것(정찰 실측 함정). 둘 다 계약으로 못박는다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { db } from "../src/db";
import { RESET_TARGETS, runLiveReset, 라이브모드 } from "../src/engine/datacleanup";
import { registerAsset, recordFindings, resetAssetsForTests, listAssets, seedSampleAssetsIfEmpty, seedSampleVulnHostIfEmpty } from "../src/engine/assets";
import { createTarget, resetHardeningForTests, listTargets } from "../src/engine/hardeningtargets";
import { recordAudit, listAudit } from "../src/engine/audit";

// 보존 계약 목록 — 사장님 확정(2026-08-19): 감사(법정 3년)·지식·학습·설정·계정·판단·축적 자산.
const 보존테이블 = [
  "audit_log", "cloud_egress_log",                     // 감사
  "chat_logs", "memory_documents", "doc_digests",      // 지식·학습
  "learnloop_runs", "learn_candidate_decisions", "lora_adapters", "model_adoptions", "ontology_triples",
  "answer_feedback", "work_events", "action_check_history", "routine_feedback", "handover_history",
  "users", "user_mfa", "app_state", "cti_feeds", "smtp_config", "cloud_llm_keys", "cloud_usage",
  "alert_schedules", "report_schedules", "client_releases", "schema_migrations",
  "compliance_status",                                  // 담당자가 직접 넣었을 수 있는 판단 기록
];

function 라이브모드끔() {
  db.prepare("DELETE FROM app_state WHERE key = 'gijo:live-mode'").run();
}

describe("보존 계약 — 화이트리스트가 닿을 수조차 없다", () => {
  it("★ RESET_TARGETS의 전체 테이블 목록과 보존 목록의 교집합이 0이다", async () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "datacleanup.ts"), "utf8");
    // TARGETS 선언에서 tables 배열 전부 추출 — 함수가 아니라 소스가 원천(화이트리스트 자체 검증)
    const 지움테이블 = [...src.matchAll(/tables:\s*\[([^\]]+)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    expect(지움테이블.length).toBeGreaterThanOrEqual(20);
    for (const t of 지움테이블) {
      expect(보존테이블, `«${t}»는 보존 대상인데 화이트리스트에 들어 있다`).not.toContain(t);
    }
  });
});

describe("리셋 실행 — 지울 것은 지우고 남길 것은 남는다", () => {
  beforeEach(() => {
    라이브모드끔();
    resetAssetsForTests();
    resetHardeningForTests();
  });

  it("★ 업무 데이터는 0이 되고 감사 기록은 남는다", () => {
    registerAsset({ id: "rl-a1", name: "리셋-자산", path: "-", assetType: "서버" });
    recordFindings("rl-a1", [{ finding_type: "약한 암호화", severity: "high", evidence: "e", source_tool: "s" }]);
    createTarget({ label: "리셋-장비", host: "local", port: 22, authMethod: "local" });
    recordAudit({ kind: "write", actor: "시험", action: "리셋-보존-확인", target: "-", detail: "-", result: "ok" });
    const 감사전 = listAudit({ limit: 10000 }).length;

    expect(라이브모드(), "시작 전 라이브 모드 꺼짐").toBe(false);
    const 직전 = (db.prepare("SELECT COUNT(*) AS n FROM assets").get() as { n: number }).n;
    const r = runLiveReset();
    const a = r.tables.find((t) => t.id === "assets");
    const 직후 = db.prepare("SELECT id FROM assets").all() as { id: string }[];
    expect(직후.map((x) => x.id).join(","), `직전 ${직전}행 · 그룹삭제 ${a?.deleted}건인데 남음`).toBe("");
    expect(listAssets()).toHaveLength(0);
    expect(listTargets()).toHaveLength(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n).toBe(0);
    // 감사는 오히려 늘었으면 늘었지(리셋 자체가 기록되진 않아도) 줄면 안 된다
    expect(listAudit({ limit: 10000 }).length).toBeGreaterThanOrEqual(감사전);
    // 스냅샷이 대상마다 남는다 — 못 남기면 안 지운다와 짝
    expect(r.tables.length).toBe(RESET_TARGETS.length);
    for (const t of r.tables) expect(fs.existsSync(t.snapshot), t.id).toBe(true);
  });

  it("★ 리셋 후 재기동 시드가 데모를 되살리지 않는다 — 진짜 빈 상태(사장님 선택)", () => {
    runLiveReset();
    expect(라이브모드()).toBe(true);
    seedSampleAssetsIfEmpty();
    seedSampleVulnHostIfEmpty();
    expect(listAssets(), "라이브 모드에서 시드는 무동작이어야 한다").toHaveLength(0);
  });

  it("라이브 모드가 꺼져 있으면 시드는 종전대로 동작한다(시연 복귀 스위치)", () => {
    라이브모드끔();
    seedSampleAssetsIfEmpty();
    expect(listAssets().length).toBeGreaterThan(0);
  });
});
