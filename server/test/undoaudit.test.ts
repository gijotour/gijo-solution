// 되돌리기(undo)가 **무엇을 지웠는지 남기고, 남의 것은 안 지운다** (2026-08-19 검증에서 확인)
//
// ■ 무엇이 문제였나 — 두 가지가 겹쳤다
//   ① 되돌리기가 자산을 **하드 삭제**하는데(scan_runs·finding_approvals까지) **감사에 한 줄도
//      안 남았다.** 같은 삭제를 하는 `DELETE /api/assets/:id`는 남긴다 — undo 경로만 우회했다.
//      그래서 감사만 보면 **자산이 아직 살아 있는 것으로 읽혔다**(등록은 남고 삭제는 안 남으니).
//   ② 삭제 대상이 「실행 전후 자산 목록의 **차집합**」이라, 도구가 도는 동안 **다른 담당자가
//      만든 자산까지** 섞였다. 자산 등록 통로가 여럿이고(`/api/assets`·import·스캔 인입),
//      `run_redteam`처럼 수 분 걸리는 쓰기 도구가 있어 창이 짧지도 않다.
//
// ⚠ 되돌릴 수 없는 일일수록 **기록이 유일한 흔적**이다. 이 시험은 그 흔적을 지킨다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { undoSnapshot, undoCommit, performUndo, resetUndoForTests } from "../src/engine/undo";
import { registerAsset, listAssets, resetAssetsForTests } from "../src/engine/assets";
import { listAudit, resetAuditForTests } from "../src/engine/audit";
import { db } from "../src/db";

const 소스 = fs.readFileSync(new URL("../src/engine/undo.ts", import.meta.url), "utf8");

const 자산넣기 = (id: string, name: string) =>
  registerAsset({ id, name, path: `models/${id}.gguf`, assetType: "model", owner: "테스트" });

/**
 * 등록 시각을 옮긴다 — `registerAsset`은 언제나 **지금 시각**을 쓰므로(assets.ts),
 * 「도구가 도는 동안 남이 먼저 만든 자산」을 시험에서 만들려면 여기서 직접 고쳐야 한다.
 */
const 등록시각바꾸기 = (id: string, at: number) =>
  db.prepare("UPDATE assets SET registeredAt = ? WHERE id = ?").run(at, id);

beforeEach(() => {
  resetUndoForTests();
  resetAssetsForTests();
  resetAuditForTests();
});

describe("되돌리기 — 무엇을 지웠는지 남긴다", () => {
  it("★★ 자산을 지우면 감사에 남는다 — 안 남으면 살아 있는 것으로 읽힌다", () => {
    const before = undoSnapshot();
    자산넣기("new-1", "임시봇");
    const id = undoCommit("register_asset", "자산 등록", before);
    expect(id, "되돌릴 항목이 안 쌓였다").toBeTruthy();

    performUndo(id!, "정요한");
    const 기록 = listAudit(50).filter((e) => e.action === "되돌리기 실행");
    expect(기록.length, "되돌리기가 감사에 안 남는다 — 감사만 보면 자산이 살아 있는 줄 안다").toBe(1);
    expect(기록[0].actor, "누가 되돌렸는지 안 남는다").toBe("정요한");
  });

  it("★ **무엇을** 지웠는지 이름으로 남는다 — 내부 id만 남으면 영영 못 읽는다", () => {
    // 자산 행은 하드 삭제라 지운 뒤에는 id로 이름을 되찾을 수 없다.
    const before = undoSnapshot();
    자산넣기("new-2", "결제서버-봇");
    performUndo(undoCommit("register_asset", "자산 등록", before)!, "정요한");
    const 기록 = listAudit(50).find((e) => e.action === "되돌리기 실행")!;
    expect(기록.target, "지운 자산 이름이 안 남는다").toContain("결제서버-봇");
    expect(기록.target, "내부 id도 함께 남아야 대조가 된다").toContain("new-2");
  });

  it("★ 되돌릴 수 없다는 사실을 기록에 적는다", () => {
    const before = undoSnapshot();
    자산넣기("new-3", "임시봇");
    performUndo(undoCommit("register_asset", "자산 등록", before)!, "정요한");
    const 기록 = listAudit(50).find((e) => e.action === "되돌리기 실행")!;
    expect(기록.detail, "스캔 이력까지 사라진다는 사실을 안 적는다").toMatch(/되돌릴 수 없습니다/);
  });
});

describe("★★ 남이 만든 자산을 지우지 않는다", () => {
  it("스냅샷 **이전에** 있던 자산은 삭제 대상이 아니다", () => {
    자산넣기("old-1", "원래 있던 것");
    const before = undoSnapshot();
    자산넣기("new-1", "도구가 만든 것");
    performUndo(undoCommit("register_asset", "자산 등록", before)!, "정요한");
    const 남은것 = listAssets().map((a) => a.id);
    expect(남은것, "원래 있던 자산이 지워졌다").toContain("old-1");
    expect(남은것, "도구가 만든 자산이 안 지워졌다").not.toContain("new-1");
  });

  it("★★ 스냅샷 **시각보다 앞서 등록된** 자산은 지우지 않는다 — 차집합만 보면 남의 것이 걸린다", () => {
    // 도구가 도는 동안 다른 통로로 들어온 자산은 목록엔 새로 보이지만 **등록 시각이 앞선다.**
    // (스냅샷을 뜬 뒤 목록을 다시 읽기 전에 커밋된 것 — import·스캔 인입에서 실제로 난다.)
    const before = undoSnapshot();
    // 남이 만든 것: 등록 시각을 스냅샷보다 **앞으로** 둔다.
    자산넣기("other-1", "남이 만든 것");
    등록시각바꾸기("other-1", before.at - 60_000);
    자산넣기("new-1", "도구가 만든 것");

    performUndo(undoCommit("register_asset", "자산 등록", before)!, "정요한");
    const 남은것 = listAssets().map((a) => a.id);
    expect(남은것, "★ 남이 만든 자산이 지워졌다 — 되돌릴 수 없는 사고다").toContain("other-1");
    expect(남은것, "도구가 만든 자산은 지워져야 한다").not.toContain("new-1");
  });

  it("삭제 대상이 시각으로 좁혀져 있다 — 차집합 한 겹만 쓰지 않는다", () => {
    expect(소스, "등록 시각으로 안 좁힌다").toMatch(/a\.registeredAt >= before\.at/);
    expect(소스, "스냅샷이 시각을 안 담는다").toMatch(/at: Date\.now\(\)/);
  });
});

describe("배관 — 누가 되돌렸는지가 서버까지 온다", () => {
  it("라우트가 로그인한 사람을 넘긴다", () => {
    expect(소스, "actor를 안 넘긴다 — 감사에 「누가」가 빈다").toMatch(
      /performUndo\(req\.body\?\.id, who\)/
    );
    expect(소스, "로그인한 사람을 안 읽는다").toMatch(/user\?\.displayName/);
  });

  it("★ 감사 실패가 되돌리기를 막지 않는다 — 그러나 조용히 삼키지도 않는다", () => {
    // 기록이 실패해도 되돌리기 자체는 이미 일어났다. 다만 try로 감싸 **되돌리기가 죽지 않게** 한다.
    expect(소스, "감사 호출이 안 감싸져 있다 — 기록 실패가 되돌리기를 죽인다").toMatch(
      /try \{\s*\n\s*recordAudit\(\{[\s\S]{0,600}?\}\);\s*\n\s*\} catch/
    );
  });
});
