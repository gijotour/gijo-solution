import { describe, it, expect, beforeEach } from "vitest";
import { pruneResolvedEvents } from "../src/engine/analysishub";
import { db } from "../src/db";

function insertEvent(id: string, source: string) {
  db.prepare(`INSERT OR REPLACE INTO analysis_events (id,source,title,entity,severity,priority,detail,signals,aiSummary,ref,at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, source, "t", "10.0.0.1", "high", "P2", "d", "[]", "", "", Date.now());
}
function setStatus(id: string, status: string, at: number) {
  db.prepare(`INSERT OR REPLACE INTO analysis_event_status (eventId,status,note,at,by) VALUES (?,?,?,?,?)`).run(id, status, "", at, "");
}

describe("이벤트 생애주기 정리", () => {
  beforeEach(() => { db.prepare("DELETE FROM analysis_events").run(); db.prepare("DELETE FROM analysis_event_status").run(); });

  it("해결 후 보관기간 지난 log 이벤트만 삭제, 미해결·최근·vuln은 보존", () => {
    const old = Date.now() - 100 * 86400_000;
    insertEvent("old-done", "log"); setStatus("old-done", "done", old);
    insertEvent("recent-done", "log"); setStatus("recent-done", "done", Date.now());
    insertEvent("old-open", "log"); setStatus("old-open", "open", old);
    insertEvent("old-vuln", "vuln"); setStatus("old-vuln", "done", old);

    const n = pruneResolvedEvents(90);
    expect(n).toBe(1);
    const ids = (db.prepare("SELECT id FROM analysis_events").all() as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain("old-done"); // 삭제됨
    expect(ids).toContain("recent-done"); // 최근이라 보존
    expect(ids).toContain("old-open"); // 미해결이라 보존
    expect(ids).toContain("old-vuln"); // vuln이라 보존
  });
});
