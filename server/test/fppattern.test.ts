// 오탐 족보 일반화 — [2026-08-06 · 계획서 후-6 해자 슬라이스 3, 시안 승인]
//
// ★★ 이 시험이 지키는 **절대 제약**: 자동 제외 금지.
//   오탐을 잘못 일반화하면 **진짜 취약점을 숨긴다** — 최악의 실패다. 그래서:
//     ① 이 기능은 읽기만 한다(어떤 finding 상태도 바뀌지 않는다)
//     ② 답에 "자동으로 오탐 제외하지 않습니다"가 반드시 있다
//     ③ 같은 패턴이 다른 자산에서 **진짜로 판정**된 이력이 있으면 ⚠로 함께 보인다
//   ④ 보상통제(compensating_control)는 오탐이 아니다 — 섞으면 "오탐이 잦다"가 거짓이 된다
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { listFpPatterns } from "../src/engine/fppattern";
import { runFpPatterns } from "../src/engine/agenttools/handlers";
import { forcedToolFor } from "../src/engine/agentloop";

const 넣기 = (p: {
  assetId: string; key: string; status: string; reason?: string | null; type: string; at?: string; by?: string; note?: string;
}) =>
  db.prepare(
    `INSERT OR REPLACE INTO finding_approvals (assetId, findingKey, status, reviewedBy, reviewedAt, note, rejectReason, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.assetId, p.key, p.status, p.by ?? "정요한", p.at ?? "2026-08-01T00:00:00Z", p.note ?? null,
    p.reason ?? null, JSON.stringify({ finding_type: p.type, severity: "medium", evidence: "", source_tool: "t" }));

beforeEach(() => { db.prepare("DELETE FROM finding_approvals WHERE assetId LIKE 'QAfp%'").run(); });

describe("오탐 패턴 — 세기", () => {
  it("★ 2회 이상 반복된 것만 패턴이다 — 1회는 우연", () => {
    넣기({ assetId: "QAfp-1", key: "k1", status: "rejected", reason: "false_positive", type: "OpenSSH 배너 버전 오탐" });
    넣기({ assetId: "QAfp-2", key: "k2", status: "rejected", reason: "false_positive", type: "OpenSSH 배너 버전 오탐" });
    넣기({ assetId: "QAfp-3", key: "k3", status: "rejected", reason: "false_positive", type: "한 번뿐인 것" });
    const p = listFpPatterns(2).filter((x) => x.type.includes("OpenSSH") || x.type.includes("한 번"));
    expect(p).toHaveLength(1);
    expect(p[0].count).toBe(2);
    expect(p[0].assets).toBe(2);
  });

  it("★★ 보상통제는 오탐이 아니다 — 섞으면 「오탐이 잦다」가 거짓이 된다", () => {
    넣기({ assetId: "QAfp-1", key: "k1", status: "rejected", reason: "false_positive", type: "QA섞임" });
    넣기({ assetId: "QAfp-2", key: "k2", status: "rejected", reason: "compensating_control", type: "QA섞임" });
    const p = listFpPatterns(2).filter((x) => x.type === "QA섞임");
    expect(p, "보상통제를 오탐으로 세어 패턴이 만들어졌다").toHaveLength(0);
  });

  it("★★ 같은 패턴이 다른 자산에서 진짜로 판정된 이력은 ⚠로 남는다 — 일반화가 위험하다는 증거", () => {
    넣기({ assetId: "QAfp-1", key: "k1", status: "rejected", reason: "false_positive", type: "QA충돌" });
    넣기({ assetId: "QAfp-2", key: "k2", status: "rejected", reason: "false_positive", type: "QA충돌" });
    넣기({ assetId: "QAfp-9", key: "k9", status: "approved", type: "QA충돌", at: "2026-06-02T00:00:00Z", by: "이현수" });
    const p = listFpPatterns(2).find((x) => x.type === "QA충돌")!;
    expect(p.conflict).toHaveLength(1);
    expect(p.conflict[0].assetId).toBe("QAfp-9");
  });
});

describe("★★ 자동 제외 금지 — 이 계약이 깨지면 진짜 취약점이 숨는다", () => {
  it("답에 「자동으로 오탐 제외하지 않습니다」가 있다", async () => {
    넣기({ assetId: "QAfp-1", key: "k1", status: "rejected", reason: "false_positive", type: "QA문구" });
    넣기({ assetId: "QAfp-2", key: "k2", status: "rejected", reason: "false_positive", type: "QA문구" });
    const out = await runFpPatterns({});
    expect(out).toContain("자동으로 오탐 제외하지 않습니다");
  });

  it("★ 읽기만 한다 — 이 기능을 돌려도 판정이 하나도 안 바뀐다", async () => {
    넣기({ assetId: "QAfp-1", key: "k1", status: "rejected", reason: "false_positive", type: "QA불변" });
    넣기({ assetId: "QAfp-2", key: "k2", status: "pending", type: "QA불변" });
    const 전 = db.prepare("SELECT assetId, status FROM finding_approvals WHERE assetId LIKE 'QAfp%' ORDER BY assetId").all();
    await runFpPatterns({});
    listFpPatterns(2);
    const 후 = db.prepare("SELECT assetId, status FROM finding_approvals WHERE assetId LIKE 'QAfp%' ORDER BY assetId").all();
    expect(후, "패턴을 보는 것만으로 판정이 바뀌었다").toEqual(전);
  });

  it("소스에 일괄 처리·상태 변경이 없다 — 만들지 않은 것이 계약이다", async () => {
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(__dirname, "..", "src", "engine", "fppattern.ts"), "utf8"
    );
    for (const 금지 of ["UPDATE ", "INSERT ", "DELETE ", "rejectAll", "bulk"]) {
      expect(src, `읽기 전용이어야 하는데 ${금지}가 있다`).not.toContain(금지);
    }
  });

  it("이력이 없으면 없다고 말한다 — 없는 패턴을 지어내지 않는다", async () => {
    const out = await runFpPatterns({ minCount: "9" });
    expect(out).toContain("아직 없습니다");
  });
});

describe("★ 라우팅 — 조회는 못 박고, 쓰기 지시는 안 삼킨다", () => {
  it("조회 물음", () => {
    expect(forcedToolFor("오탐 자주 나는 패턴 알려줘")?.tool).toBe("fp_patterns");
    expect(forcedToolFor("자주 틀리는 탐지 뭐야?")?.tool).toBe("fp_patterns");
  });
  it("쓰기 지시는 다른 말이다", () => {
    expect(forcedToolFor("이거 오탐 처리해줘")?.tool).not.toBe("fp_patterns");
    expect(forcedToolFor("1번 오탐으로 반려해줘")?.tool).not.toBe("fp_patterns");
  });
});
