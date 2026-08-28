// 잃은 취약점 되살리기 — [2026-08-03 운영 실측: 자산 46개에서 4,817건 소실]
//
// ★ 어떻게 발견했나: 담당자 brian의 답변 지적("서버이름이 oracle 찾아줘"가 엉뚱하다)을 따라가니
//   오라클 서버는 등록부에 **있는데 취약점이 0건**이었다. 스캔 이력에는 2026-07-28에
//   `Oracle Server Scan.nessus`로 들어온 352건이 그대로 있었다. 그날 저녁부터 맞지도 않는
//   modelscan이 실패하며 남긴 `scan_error` 한 줄이 그것을 덮어쓴 것이다.
//
// ⚠ 이 시험이 지키는 것: **되살린 것이 "지금 상태"인 척하지 않는다.** 며칠 지난 스캔 결과이고,
//   실패 기록도 감추지 않는다. 그러지 않으면 담당자가 옛 결과를 오늘 것으로 읽고 보고에 쓴다.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { 잃은취약점찾기, 되살리기, 잃은취약점현황글 } from "../src/engine/findingsrestore";
import { registerAsset, recordFindings, getAsset } from "../src/engine/assets";
import { 모델스캔대상인가 } from "../src/engine/bridge";
import { db } from "../src/db";
import type { StandardFinding } from "../src/engine/bridge";

const 진짜 = (n: number): StandardFinding[] =>
  Array.from({ length: n }, (_, i) => ({
    finding_type: `Oracle Database Server (CPU-${i})`, severity: "high" as const,
    evidence: "포트: tcp/1521", source_tool: "Oracle Server Scan.nessus", key: `k${i}`, state: "active" as const,
  }));
const 실패 = (): StandardFinding[] => [
  { finding_type: "scan_error", severity: "low", evidence: "Error: Command failed: python modelscan_wrapper.py", source_tool: "modelscan" },
];

describe("모델스캔대상인가 — 안 맞는 자산에는 아예 안 돌린다", () => {
  it("IP 호스트는 모델 파일이 아니다 — 76번 실패한 그 자산이다", () => {
    expect(모델스캔대상인가("192.168.219.98")).toBe(false);
    expect(모델스캔대상인가("172.168.50.43")).toBe(false);
  });

  it("모델 파일은 대상이다 — 넓게 막아 진짜 스캔까지 끄면 안 된다", () => {
    for (const p of ["models/foo.gguf", "a/b/model.safetensors", "x.pkl", "y.onnx", "z.pt", "w.joblib"]) {
      expect(모델스캔대상인가(p), `${p}는 대상이어야 한다`).toBe(true);
    }
  });

  it("빈 경로·이름뿐인 자산은 대상이 아니다", () => {
    expect(모델스캔대상인가("")).toBe(false);
    expect(모델스캔대상인가("경계 방화벽")).toBe(false);
  });
});

describe("잃은취약점찾기 — 지금 진짜가 있으면 손대지 않는다", () => {
  beforeEach(() => {
    // 각 시험은 자기 자산만 본다(id를 다르게 둔다).
  });

  it("진짜 취약점이 살아 있는 자산은 후보가 아니다", () => {
    const id = "fr-alive";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 진짜(2));
    expect(잃은취약점찾기().some((c) => c.assetId === id), "덮어쓸 이유가 없다").toBe(false);
  });

  it("이력에도 진짜가 없으면 후보가 아니다 — 지어내지 않는다", () => {
    const id = "fr-empty";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 실패());
    expect(잃은취약점찾기().some((c) => c.assetId === id)).toBe(false);
  });
});

describe("★ 되살리기 — 잃은 것을 이력에서 되돌린다", () => {
  it("가드가 없던 시절 덮어써진 자산을 되살리고, 실패 기록은 함께 남긴다", () => {
    const id = "fr-lost";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 진짜(5));                       // 2026-07-28 진짜 스캔
    // 가드를 우회해 옛 사고 상태를 만든다 — 실패만 남은 현재 + 진짜가 든 이력.
    //   (제품 경로로는 이제 이 상태가 만들어지지 않는다. 그래서 이미 그렇게 된 DB를 흉내 낸다.)
    db.prepare("UPDATE assets SET findings = ? WHERE id = ?").run(JSON.stringify(실패()), id);

    const 후보 = 잃은취약점찾기().find((c) => c.assetId === id);
    expect(후보, "덮어써진 자산을 찾아야 한다").toBeTruthy();
    expect(후보!.되찾을건수).toBe(5);
    expect(후보!.출처).toContain("Oracle Server Scan.nessus");

    const r = 되살리기([id]);
    expect(r.되살린자산).toBe(1);
    expect(r.되살린건수).toBe(5);

    const a = getAsset(id)!;
    expect(a.findings.filter((f) => f.finding_type !== "scan_error").length, "진짜 5건이 돌아온다").toBe(5);
    expect(a.findings.some((f) => f.finding_type === "scan_error"), "실패 기록을 감추지 않는다").toBe(true);
  });

  it("★ 점검 보고서가 여럿이면 **출처별 최신을 합친다** — 나중 보고서가 앞 것을 대체하지 않는다", () => {
    // 2026-08-03 실측으로 고친 지점. 처음엔 "가장 최근 진짜 스캔 하나"만 되살렸는데,
    //   192.168.219.98에서 352건(Oracle Server Scan.nessus) 대신 2건(DHSAMPLE_scan.xml)만
    //   돌아왔다. 두 파일은 **서로 다른 점검**이라 뒤엣것이 앞엣것을 대신하지 않는다.
    const id = "fr-multi";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 진짜(5));                                       // 큰 점검 보고서 5건
    recordFindings(id, [
      { finding_type: "OpenSSH regreSSHion", severity: "high", evidence: "e", source_tool: "DHSAMPLE_scan.xml", key: "d1", state: "active" },
    ]);                                                                 // 다른 보고서 1건
    db.prepare("UPDATE assets SET findings = ? WHERE id = ?").run(JSON.stringify(실패()), id);

    const 후보 = 잃은취약점찾기().find((c) => c.assetId === id);
    expect(후보!.되찾을건수, "두 출처를 합쳐 6건이어야 한다 — 1건이면 큰 보고서를 잃는다").toBe(6);
    expect(후보!.출처.sort()).toEqual(["DHSAMPLE_scan.xml", "Oracle Server Scan.nessus"]);

    되살리기([id]);
    const a = getAsset(id)!;
    expect(a.findings.filter((f) => f.source_tool === "Oracle Server Scan.nessus").length).toBe(5);
    expect(a.findings.filter((f) => f.source_tool === "DHSAMPLE_scan.xml").length).toBe(1);
  });

  it("★ 같은 출처를 다시 돌려 사라진 것은 되살리지 않는다 — 고친 것은 고쳐진 채로", () => {
    // 출처별 **최신**을 쓰므로, 같은 스캐너의 새 결과가 옛 결과를 대신한다.
    // 이게 없으면 조치해서 닫힌 취약점이 복구할 때마다 되살아난다.
    const id = "fr-rescan";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 진짜(4));                                        // 1차: 4건
    recordFindings(id, 진짜(4).slice(0, 1));                            // 2차 재스캔: 1건만 남음
    db.prepare("UPDATE assets SET findings = ? WHERE id = ?").run(JSON.stringify(실패()), id);

    const 후보 = 잃은취약점찾기().find((c) => c.assetId === id);
    expect(후보!.되찾을건수, "최신 재스캔 결과인 1건만 되살린다").toBe(1);
  });

  it("부분만 돌아온 자산도 다시 후보가 된다 — 나머지를 영영 못 찾으면 안 된다", () => {
    const id = "fr-partial";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 진짜(5));
    recordFindings(id, [
      { finding_type: "OpenSSH regreSSHion", severity: "high", evidence: "e", source_tool: "DHSAMPLE_scan.xml", key: "d1", state: "active" },
    ]);
    // 옛 코드가 그랬듯 **한 출처만** 남은 상태를 만든다.
    db.prepare("UPDATE assets SET findings = ? WHERE id = ?").run(
      JSON.stringify([{ finding_type: "OpenSSH regreSSHion", severity: "high", evidence: "e", source_tool: "DHSAMPLE_scan.xml", key: "d1", state: "active" }]), id);

    const 후보 = 잃은취약점찾기().find((c) => c.assetId === id);
    expect(후보, "진짜가 1건 있어도 나머지 5건이 남았으면 후보다").toBeTruthy();
    expect(후보!.되찾을건수).toBe(5);
  });

  it("★ 같은 취약점이 파일 이름만 달라도 두 벌로 만들지 않는다", () => {
    // 2026-08-03 운영 실측: 10.10.20.41의 Zerologon(key=142960)이 `demo-scan.csv`와
    //   `demo-nessus-2026-08` 두 이름으로 각각 남아 「오늘 할 일」에 나란히 떴다.
    //   열쇠에 출처를 넣었던 것이 원인이다 — key는 스캔 사이 같은 취약점을 잇는 식별자다.
    const id = "fr-dup";
    const 같은취약점 = (src: string): StandardFinding => ({
      finding_type: "Netlogon 권한 상승 (Zerologon) (CVE-2020-1472)", severity: "critical",
      evidence: "e", source_tool: src, key: "142960", state: "new",
    });
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, [같은취약점("demo-nessus-2026-08")]);   // 이력에 남는 다른 이름의 같은 것
    db.prepare("UPDATE assets SET findings = ? WHERE id = ?").run(JSON.stringify([같은취약점("demo-scan.csv")]), id);

    되살리기([id]);
    const a = getAsset(id)!;
    expect(a.findings.filter((f) => f.key === "142960").length, "같은 취약점은 하나여야 한다").toBe(1);
    expect(a.findings[0].source_tool, "먼저 있던 것을 남긴다").toBe("demo-scan.csv");
  });

  it("되살린 뒤에는 다시 후보로 잡히지 않는다 — 두 번 되살리지 않는다", () => {
    const id = "fr-twice";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 진짜(3));
    db.prepare("UPDATE assets SET findings = ? WHERE id = ?").run(JSON.stringify(실패()), id);

    되살리기([id]);
    expect(잃은취약점찾기().some((c) => c.assetId === id)).toBe(false);
  });
});

describe("정직성 — 되살린 것이 「지금」인 척하지 않는다", () => {
  it("현황 글이 시점과 재스캔 필요를 말한다", () => {
    const id = "fr-honest";
    registerAsset({ id, name: id, path: id, assetType: "infra-host", owner: "" });
    recordFindings(id, 진짜(4));
    db.prepare("UPDATE assets SET findings = ? WHERE id = ?").run(JSON.stringify(실패()), id);

    const 글 = 잃은취약점현황글();
    expect(글, "몇 건인지 말한다").toMatch(/\d+건/);
    expect(글, "그때 스캔한 결과임을 밝힌다").toContain("그때 스캔한 결과");
    expect(글, "재스캔으로 확인하라고 말한다").toContain("재스캔");
  });

  it("되살릴 것이 없으면 없다고 말한다 — 있는 척하지 않는다", () => {
    // 앞 시험들이 만든 후보를 모두 되살린 뒤라야 0건이 된다.
    되살리기();
    expect(잃은취약점현황글()).toContain("되살릴 것이 없습니다");
  });
});
