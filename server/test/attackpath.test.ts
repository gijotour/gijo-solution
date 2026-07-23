import { describe, it, expect } from "vitest";
import { computeAttackPaths, type AnalysisEvent } from "../src/engine/analysishub";

function ev(o: Partial<AnalysisEvent>): AnalysisEvent {
  return { id: o.id!, source: o.source!, title: o.title ?? "", entity: o.entity ?? "", severity: o.severity ?? "medium", priority: "P2", detail: o.detail ?? "", signals: o.signals ?? [], aiSummary: "", ref: "", at: Date.now(), status: o.status ?? "open" };
}

describe("공격 경로·도달성", () => {
  it("취약 자산 + 실제 공격 로그가 같은 entity면 도달성 '확인됨'", () => {
    const events = [
      ev({ id: "v1", source: "vuln", entity: "10.0.0.5", title: "Log4Shell RCE", severity: "critical", signals: ["KEV", "인터넷노출"] }),
      ev({ id: "l1", source: "log", entity: "10.0.0.5", title: "포트 스캔 의심", severity: "high", signals: ["포트스캔"] }),
    ];
    const paths = computeAttackPaths(events);
    expect(paths).toHaveLength(1);
    expect(paths[0].reachability).toBe("확인됨");
    expect(paths[0].reachScore).toBeGreaterThanOrEqual(90); // 공격40+KEV30+외부20+치명10
    expect(paths[0].steps.some((s) => s.kind === "entry")).toBe(true);
    expect(paths[0].steps.some((s) => s.kind === "foothold")).toBe(true);
  });

  it("같은 /24 대역의 다른 취약 자산으로 측면 이동 단계 생성", () => {
    const events = [
      ev({ id: "v1", source: "vuln", entity: "10.0.0.5", title: "RCE", severity: "critical", signals: ["KEV"] }),
      ev({ id: "v2", source: "vuln", entity: "10.0.0.9", title: "SQL Injection", severity: "high" }),
    ];
    const paths = computeAttackPaths(events);
    const lateral = paths.find((p) => p.entity === "10.0.0.5")?.steps.filter((s) => s.kind === "lateral") ?? [];
    expect(lateral.length).toBe(1);
    expect(lateral[0].entity).toBe("10.0.0.9");
  });

  it("취약점 없는 entity는 경로가 없다", () => {
    const events = [ev({ id: "l1", source: "log", entity: "10.0.0.5", title: "브루트포스", signals: ["브루트포스"] })];
    expect(computeAttackPaths(events)).toHaveLength(0);
  });

  it("완료/무시된 이벤트는 제외", () => {
    const events = [ev({ id: "v1", source: "vuln", entity: "10.0.0.5", title: "RCE", severity: "critical", status: "done" })];
    expect(computeAttackPaths(events)).toHaveLength(0);
  });
});
